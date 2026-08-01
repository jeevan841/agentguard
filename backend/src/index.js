/**
 * AgentGuard Backend — Express + WebSocket Server
 */
require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const config = require('./config');
const { getRedis, getSubscriber } = require('./redis/client');
const prisma = require('./prisma/client');
const { getDashboardMetrics } = require('./services/MetricsService');
const { checkAlerts } = require('./services/AlertService');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const agentsRoutes = require('./routes/agents');
const guardrailRoutes = require('./routes/guardrail');
const auditRoutes = require('./routes/audit');
const redteamRoutes = require('./routes/redteam');
const dashboardRoutes = require('./routes/dashboard');
const notificationsRoutes = require('./routes/notifications');

const app = express();
const server = http.createServer(app);

// ─── Trust Proxy ──────────────────────────────────────────────────────────────
// Set to the number of reverse-proxy hops in front of this service.
// TRUST_PROXY_HOPS=1  → trust exactly one hop (nginx / ALB / Cloudflare)
// TRUST_PROXY_HOPS=0  → direct exposure; ignore X-Forwarded-For (default)
// Without this, express-rate-limit sees the proxy IP instead of the real client
// IP, collapsing per-client limits into one shared bucket.
const trustProxyHops = parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
if (trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
  console.log(`[Config] trust proxy = ${trustProxyHops} hop(s)`);
}

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws/metrics' });
const { authenticateWebSocket, decrementConnectionCount } = require('./middleware/wsAuth');

const wsClients = new Set();

wss.on('connection', (ws, req) => {
  // Authenticate connection
  const auth = authenticateWebSocket(ws, req);
  if (!auth) {
    return; // Connection already closed by authenticateWebSocket
  }
  
  const { user, ip } = auth;
  console.log(`[WS] Client connected: ${user.email} from ${ip}. Total: ${wss.clients.size}`);
  
  wsClients.add(ws);

  // Send initial metrics
  getDashboardMetrics()
    .then((metrics) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'metrics', data: metrics }));
      }
    })
    .catch(() => {});

  // Cleanup function
  const cleanup = () => {
    wsClients.delete(ws);
    decrementConnectionCount(ip);
    console.log(`[WS] Client disconnected: ${user.email}. Total: ${wss.clients.size}`);
  };

  ws.on('close', cleanup);

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
    cleanup();
  });
  
  // Heartbeat to detect dead connections
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// Heartbeat interval to detect dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

function broadcastToWS(data) {
  const message = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ─── Redis Pub/Sub for real-time events ───────────────────────────────────────
async function setupRedisSub() {
  try {
    const sub = getSubscriber();
    await sub.subscribe('guardrail:events', 'audit:events');

    sub.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        broadcastToWS({ type: channel, data });
      } catch (e) {}
    });

    console.log('[Redis] Subscribed to: guardrail:events, audit:events');
  } catch (err) {
    console.warn('[Redis] Pub/sub setup failed (will retry):', err.message);
  }
}

// ─── Push metrics every 10 seconds ───────────────────────────────────────────
let metricsInterval;
function startMetricsBroadcast() {
  metricsInterval = setInterval(async () => {
    if (wsClients.size === 0) return;
    try {
      const metrics = await getDashboardMetrics();
      broadcastToWS({ type: 'metrics', data: metrics });
      // Check alerts
      checkAlerts(metrics).catch(() => {});
    } catch (err) {
      console.warn('[WS] Metrics broadcast error:', err.message);
    }
  }, 10000);
}

// ─── Express Middleware ───────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: [config.frontendUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Capability-Token', 'X-Agent-Token'],
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Input sanitization (must be after body parsing)
const { sanitizeMiddleware } = require('./middleware/sanitize');
app.use(sanitizeMiddleware());

app.use(morgan(config.isDev ? 'dev' : 'combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: { error: 'Too Many Requests', message: 'Rate limit exceeded, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Stricter rate limit for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too Many Requests', message: 'Too many auth attempts' },
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let dbOk = false;
  let redisOk = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (e) {}

  try {
    const redis = getRedis();
    await redis.ping();
    redisOk = true;
  } catch (e) {}

  const status = dbOk && redisOk ? 200 : 503;
  res.status(status).json({
    status: status === 200 ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      database: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      claude: config.hasClaudeKey ? 'configured' : 'not configured (rule-based fallback active)',
    },
    websocket_clients: wsClients.size,
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRoutes);
app.use('/agents', agentsRoutes);
app.use('/guardrail', guardrailRoutes);
app.use('/audit', auditRoutes);
app.use('/redteam', redteamRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/notifications', notificationsRoutes);

// ─── Error Handlers ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Server Start ─────────────────────────────────────────────────────────────
async function start() {
  try {
    // Test DB connection
    await prisma.$connect();
    console.log('[DB] PostgreSQL connected');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    console.warn('[DB] Continuing without DB — some features will be unavailable');
  }

  // Connect Redis
  try {
    const redis = getRedis();
    await redis.connect().catch(() => {}); // already auto-connects
    await setupRedisSub();
  } catch (err) {
    console.warn('[Redis] Setup failed:', err.message);
  }

  server.listen(config.port, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║     🛡️  AgentGuard Backend Started        ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  HTTP:      http://localhost:${config.port}         ║`);
    console.log(`║  WebSocket: ws://localhost:${config.port}/ws/metrics║`);
    console.log(`║  Health:    http://localhost:${config.port}/health  ║`);
    console.log(`║  Claude AI: ${config.hasClaudeKey ? '✅ Configured' : '⚠️  Not configured'}              ║`);
    console.log(`║  Env:       ${config.nodeEnv}                  ║`);
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    startMetricsBroadcast();
  });
}

start().catch((err) => {
  console.error('[Fatal] Server failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Shutdown] SIGTERM received, shutting down gracefully...');
  clearInterval(metricsInterval);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
});
