/**
 * AgentGuard Backend — Express + WebSocket Server
 *
 * IMPORTANT: telemetry.js MUST be the very first require so OpenTelemetry
 * auto-instrumentation patches are applied before any other module loads.
 */
require('./telemetry');         // P1#8 — OTel must come first
require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const WebSocket = require('ws');
const Sentry = require('@sentry/node');
const config = require('./config');
const { getRedis, getSubscriber } = require('./redis/client');
const prisma = require('./prisma/client');
const { getDashboardMetrics } = require('./services/MetricsService');
const { checkAlerts } = require('./services/AlertService');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { requestId } = require('./middleware/requestId');
const { httpTimingMiddleware, router: metricsRouter, setPiscinaPool } = require('./routes/metrics');
const { _pool: piscinaPool } = require('./utils/safeRegex');
const { startWorker, stopWorker } = require('./queues/redteamQueue');

// ─── Sentry (P1#7) ────────────────────────────────────────────────────────────
// No-op when SENTRY_DSN is absent (safe for dev)
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  environment: config.nodeEnv,
  enabled: !!process.env.SENTRY_DSN,
});

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const agentsRoutes      = require('./routes/agents');
const guardrailRoutes   = require('./routes/guardrail');
const auditRoutes       = require('./routes/audit');
const redteamRoutes     = require('./routes/redteam');
const dashboardRoutes   = require('./routes/dashboard');
const notificationsRoutes = require('./routes/notifications');

const app = express();
const server = http.createServer(app);

// ── Trust Proxy (P0#5-from-R3) ────────────────────────────────────────────────
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
  const auth = authenticateWebSocket(ws, req);
  if (!auth) return;
  
  const { user, ip } = auth;
  console.log(`[WS] Client connected: ${user.email} from ${ip}. Total: ${wss.clients.size}`);
  wsClients.add(ws);

  getDashboardMetrics()
    .then((metrics) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'metrics', data: metrics }));
      }
    })
    .catch(() => {});

  const cleanup = () => {
    wsClients.delete(ws);
    decrementConnectionCount(ip);
    console.log(`[WS] Client disconnected: ${user.email}. Total: ${wss.clients.size}`);
  };

  ws.on('close', cleanup);
  ws.on('error', (err) => { console.error('[WS] Error:', err.message); cleanup(); });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeatInterval));

function broadcastToWS(data) {
  const message = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

// ─── Redis Pub/Sub ────────────────────────────────────────────────────────────
async function setupRedisSub() {
  try {
    const sub = getSubscriber();
    await sub.subscribe('guardrail:events', 'audit:events');
    sub.on('message', (channel, message) => {
      try { broadcastToWS({ type: channel, data: JSON.parse(message) }); } catch (e) {}
    });
    console.log('[Redis] Subscribed to: guardrail:events, audit:events');
  } catch (err) {
    console.warn('[Redis] Pub/sub setup failed (will retry):', err.message);
  }
}

// ─── Metrics broadcast every 10 seconds ───────────────────────────────────────
let metricsInterval;
function startMetricsBroadcast() {
  metricsInterval = setInterval(async () => {
    if (wsClients.size === 0) return;
    try {
      const metrics = await getDashboardMetrics();
      broadcastToWS({ type: 'metrics', data: metrics });
      checkAlerts(metrics).catch(() => {});
    } catch (err) {
      console.warn('[WS] Metrics broadcast error:', err.message);
    }
  }, 10000);
}

// ─── Redis-backed Rate Limit store factory (P0#1) ─────────────────────────────
// All rate limiters share a single Redis connection so counters are consistent
// across every process instance behind a load balancer.
function makeRedisStore(prefix) {
  return new RedisStore({
    // RedisStore for rate-limit-redis@6 uses sendCommand
    sendCommand: async (...args) => getRedis().call(...args),
    prefix,
  });
}

// ─── Express Middleware ───────────────────────────────────────────────────────
// P1#5 — Request IDs must be first so all subsequent middleware can read req.id
app.use(requestId);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: [config.frontendUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization', 'X-Capability-Token', 'X-Agent-Token',
      'X-Request-ID', 'Idempotency-Key',
    ],
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Input sanitization (must be after body parsing)
const { sanitizeMiddleware } = require('./middleware/sanitize');
app.use(sanitizeMiddleware());

// P1#6 — HTTP timing histogram (before Morgan so timings are accurate)
app.use(httpTimingMiddleware);
setPiscinaPool(piscinaPool);  // inject pool reference for queue-size gauge

// Morgan request logging — include request ID in every log line
morgan.token('reqid', (req) => req.id);
app.use(morgan(
  config.isDev
    ? ':reqid :method :url :status :response-time ms'
    : ':reqid :remote-addr :method :url :status :res[content-length] :response-time ms'
));

// ─── Rate Limiting (P0#1 — Redis-backed, shared across all instances) ─────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too Many Requests', message: 'Rate limit exceeded, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore('rl:api:'),
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too Many Requests', message: 'Too many auth attempts' },
  store: makeRedisStore('rl:auth:'),
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let dbOk = false;
  let redisOk = false;

  try { await prisma.$queryRaw`SELECT 1`; dbOk = true; } catch (e) {}
  try { await getRedis().ping(); redisOk = true; } catch (e) {}

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

// ─── Prometheus metrics (P1#6) — not under /api/ rate limiter ────────────────
app.use('/metrics', metricsRouter);

// ─── API Routes (v1 prefix — P3#14) ──────────────────────────────────────────
// Legacy bare-path routes redirect to /v1/ with 301 for a 90-day grace period.
app.use('/auth',           authLimiter, authRoutes);
app.use('/agents',         agentsRoutes);
app.use('/guardrail',      guardrailRoutes);
app.use('/audit',          auditRoutes);
app.use('/redteam',        redteamRoutes);
app.use('/dashboard',      dashboardRoutes);
app.use('/notifications',  notificationsRoutes);

// v1 aliases (authoritative going forward)
app.use('/v1/auth',          authLimiter, authRoutes);
app.use('/v1/agents',        agentsRoutes);
app.use('/v1/guardrail',     guardrailRoutes);
app.use('/v1/audit',         auditRoutes);
app.use('/v1/redteam',       redteamRoutes);
app.use('/v1/dashboard',     dashboardRoutes);
app.use('/v1/notifications', notificationsRoutes);

// ─── Error Handlers ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Server Start ─────────────────────────────────────────────────────────────
async function start() {
  try {
    await prisma.$connect();
    console.log('[DB] PostgreSQL connected');
  } catch (err) {
    console.warn('[DB] Connection failed — continuing without DB:', err.message);
  }

  try {
    const redis = getRedis();
    await redis.connect().catch(() => {});
    await setupRedisSub();
  } catch (err) {
    console.warn('[Redis] Setup failed:', err.message);
  }

  // Start BullMQ red-team worker (P2#9)
  startWorker();

  server.listen(config.port, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║     🛡️  AgentGuard Backend Started        ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  HTTP:      http://localhost:${config.port}         ║`);
    console.log(`║  WebSocket: ws://localhost:${config.port}/ws/metrics║`);
    console.log(`║  Health:    http://localhost:${config.port}/health  ║`);
    console.log(`║  Metrics:   http://localhost:${config.port}/metrics ║`);
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

// ─── Graceful Shutdown (P0#3) ─────────────────────────────────────────────────
// Handles both SIGTERM (container orchestrators) and SIGINT (Ctrl-C in dev).
// Sequence:
//   1. Stop accepting new connections
//   2. Close WebSocket server
//   3. Stop metrics broadcast
//   4. Drain in-flight HTTP requests (max 30s)
//   5. Close BullMQ worker (drains jobs)
//   6. Disconnect Prisma
//   7. Quit Redis clients
//   8. Destroy Piscina worker pool
//   9. Exit

const DRAIN_TIMEOUT_MS = 30_000;

async function shutdown(signal) {
  console.log(`[Shutdown] ${signal} received — shutting down gracefully...`);

  // 1 & 2. Stop accepting new HTTP + WS connections
  wss.close(() => console.log('[Shutdown] WebSocket server closed'));
  clearInterval(heartbeatInterval);

  // 3. Stop metrics broadcast
  clearInterval(metricsInterval);

  // 4. Drain in-flight HTTP requests with a hard timeout
  await new Promise((resolve) => {
    const forceExit = setTimeout(() => {
      console.warn('[Shutdown] Drain timeout — forcing exit');
      resolve();
    }, DRAIN_TIMEOUT_MS);

    server.close(() => {
      clearTimeout(forceExit);
      console.log('[Shutdown] HTTP server closed');
      resolve();
    });
  });

  // 5. BullMQ worker — drain current jobs gracefully
  await stopWorker().catch((e) => console.warn('[Shutdown] BullMQ drain error:', e.message));

  // 6. Prisma
  await prisma.$disconnect().catch((e) => console.warn('[Shutdown] Prisma disconnect error:', e.message));

  // 7. Redis
  try {
    const redis = getRedis();
    await redis.quit();
    const sub = getSubscriber();
    await sub.quit();
    console.log('[Shutdown] Redis connections closed');
  } catch (e) {
    console.warn('[Shutdown] Redis quit error:', e.message);
  }

  // 8. Piscina worker pool
  if (piscinaPool) {
    await piscinaPool.destroy().catch((e) => console.warn('[Shutdown] Piscina destroy error:', e.message));
    console.log('[Shutdown] Piscina pool destroyed');
  }

  console.log('[Shutdown] Clean exit');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
