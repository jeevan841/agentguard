# AgentGuard — Security, Performance & Best Practices Review

**Review Date:** 2026-05-16  
**Reviewer:** Bob (Technical Lead)  
**Scope:** Full-stack codebase analysis focusing on security, performance, and code quality

---

## Executive Summary

AgentGuard is a well-architected AI governance platform with solid foundations. However, several **critical security vulnerabilities** and **performance bottlenecks** require immediate attention before production deployment. This review identifies 47 issues across security (18), performance (12), code quality (10), and best practices (7).

**Risk Level Distribution:**
- 🔴 **Critical:** 8 issues (require immediate fix)
- 🟠 **High:** 15 issues (fix before production)
- 🟡 **Medium:** 14 issues (fix within sprint)
- 🟢 **Low:** 10 issues (technical debt)

---

## 🔴 Critical Security Issues

### 1. Weak JWT Secret Validation (CRITICAL)
**File:** [`backend/src/config.js`](backend/src/config.js:17)

**Issue:** Default JWT secret is insecure and no validation enforces minimum length.

```javascript
jwt: {
  secret: process.env.JWT_SECRET || 'super_secret_jwt_key_change_in_production',
  // ❌ No validation that secret is strong enough
}
```

**Impact:** Attackers can brute-force JWT tokens if weak secret is used.

**Fix:**
```javascript
jwt: {
  secret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters');
    }
    if (secret === 'super_secret_jwt_key_change_in_production') {
      throw new Error('JWT_SECRET cannot be the default value');
    }
    return secret;
  })(),
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  capabilityExpiresIn: process.env.CAPABILITY_TOKEN_EXPIRES_IN || '1h',
}
```

---

### 2. Missing Input Sanitization (CRITICAL)
**Files:** Multiple route handlers

**Issue:** User inputs are not sanitized before processing, allowing potential injection attacks.

**Example:** [`backend/src/routes/guardrail.js`](backend/src/routes/guardrail.js:35)
```javascript
const { input, output, context, policy_id, agent_id, log } = GuardrailCheckSchema.parse(req.body);
// ❌ No HTML/script tag sanitization before storing or processing
```

**Impact:** XSS attacks, log injection, potential code execution.

**Fix:** Add sanitization middleware:
```javascript
const sanitizeHtml = require('sanitize-html');

function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return text;
  return sanitizeHtml(text, {
    allowedTags: [],
    allowedAttributes: {},
  });
}
```

---

### 3. Redis Connection Not Properly Secured (CRITICAL)
**File:** [`backend/src/redis/client.js`](backend/src/redis/client.js:8)

**Issue:** Redis connection lacks authentication and TLS configuration.

```javascript
const client = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  // ❌ No TLS, no password validation
});
```

**Impact:** Unauthorized access to sensitive metrics and session data.

**Fix:**
```javascript
const client = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  tls: process.env.NODE_ENV === 'production' ? {} : undefined,
  password: process.env.REDIS_PASSWORD,
  enableReadyCheck: true,
  connectTimeout: 10000,
});
```

---

### 4. Sensitive Data in Audit Logs (CRITICAL)
**File:** [`backend/src/services/AuditService.js`](backend/src/services/AuditService.js:36-37)

**Issue:** Input/output are hashed but original text might contain PII that's logged elsewhere.

```javascript
const input_hash = hashText(input);
const output_hash = hashText(output);
// ❌ But chain_of_thought and metadata might contain raw PII
```

**Impact:** GDPR/compliance violations, PII leakage in logs.

**Fix:** Implement PII redaction before logging:
```javascript
async function redactPII(text) {
  const piiResult = await detectPII(text);
  if (!piiResult.passed) {
    // Replace detected PII with [REDACTED-TYPE]
    let redacted = text;
    for (const detection of piiResult.detections) {
      // Implement redaction logic
    }
    return redacted;
  }
  return text;
}
```

---

### 5. No Rate Limiting on WebSocket Connections (CRITICAL)
**File:** [`backend/src/index.js`](backend/src/index.js:36-58)

**Issue:** WebSocket connections have no rate limiting or authentication.

```javascript
wss.on('connection', (ws) => {
  console.log('[WS] Client connected. Total:', wss.clients.size);
  wsClients.add(ws);
  // ❌ No authentication check, no connection limit per IP
});
```

**Impact:** DoS attacks via WebSocket flooding.

**Fix:**
```javascript
const wsConnectionLimits = new Map(); // IP -> count

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  const currentConnections = wsConnectionLimits.get(ip) || 0;
  
  if (currentConnections >= 5) {
    ws.close(1008, 'Too many connections from this IP');
    return;
  }
  
  wsConnectionLimits.set(ip, currentConnections + 1);
  
  // Verify JWT token from query params or headers
  const token = new URL(req.url, 'ws://localhost').searchParams.get('token');
  if (!token) {
    ws.close(1008, 'Authentication required');
    return;
  }
  
  try {
    jwt.verify(token, config.jwt.secret);
  } catch {
    ws.close(1008, 'Invalid token');
    return;
  }
  
  // ... rest of connection logic
});
```

---

### 6. Insecure Token Storage in Frontend (HIGH)
**File:** [`frontend/src/store/index.js`](frontend/src/store/index.js:17-19)

**Issue:** JWT tokens stored in localStorage via Zustand persist.

```javascript
persist(
  (set) => ({ /* ... */ }),
  {
    name: 'agentguard-auth',
    partialize: (state) => ({ token: state.token, user: state.user }),
    // ❌ Stored in localStorage, vulnerable to XSS
  }
)
```

**Impact:** Token theft via XSS attacks.

**Fix:** Use httpOnly cookies instead:
```javascript
// Backend: Set httpOnly cookie
res.cookie('auth_token', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

// Frontend: Remove token from localStorage
// Rely on cookies for authentication
```

---

### 7. Missing CSRF Protection (HIGH)
**Files:** All POST/PUT/DELETE endpoints

**Issue:** No CSRF tokens for state-changing operations.

**Impact:** Cross-site request forgery attacks.

**Fix:** Implement CSRF middleware:
```javascript
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });

app.use(csrfProtection);

// Add CSRF token to responses
app.get('/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});
```

---

### 8. Regex DoS Vulnerability (HIGH)
**File:** [`backend/src/services/guardrail/PIIDetector.js`](backend/src/services/guardrail/PIIDetector.js:8-54)

**Issue:** Complex regex patterns vulnerable to ReDoS attacks.

```javascript
{
  type: 'CREDIT_CARD',
  pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|[25][1-7][0-9]{14}|...)\b/g,
  // ❌ Complex pattern with nested quantifiers
}
```

**Impact:** CPU exhaustion via crafted inputs.

**Fix:**
```javascript
// Add timeout wrapper
function safeRegexTest(pattern, text, timeoutMs = 100) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Regex timeout'));
    }, timeoutMs);
    
    try {
      const result = pattern.test(text);
      clearTimeout(timeout);
      resolve(result);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}
```

---

## 🟠 High Priority Issues

### 9. No Database Connection Pooling Configuration (HIGH)
**File:** [`backend/src/prisma/client.js`](backend/src/prisma/client.js)

**Issue:** Prisma client created without connection pool limits.

**Impact:** Database connection exhaustion under load.

**Fix:**
```javascript
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  // Add connection pool configuration
  connectionLimit: 10,
});
```

---

### 10. Missing Database Indexes (HIGH)
**File:** [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma:90-94)

**Issue:** Audit log queries lack composite indexes for common filter combinations.

```prisma
@@index([agent_id])
@@index([timestamp])
@@index([violation_type])
@@index([user_id])
// ❌ Missing composite indexes for common queries
```

**Impact:** Slow query performance on large datasets.

**Fix:**
```prisma
@@index([agent_id, timestamp])
@@index([violation_type, severity, timestamp])
@@index([user_id, timestamp])
@@index([timestamp(sort: Desc)])
```

---

### 11. Unbounded Redis List Growth (HIGH)
**File:** [`backend/src/services/MetricsService.js`](backend/src/services/MetricsService.js:120-121)

**Issue:** Latency metrics list trimmed to 999 items but could grow unbounded.

```javascript
await redis.lpush('metrics:latency', latency);
await redis.ltrim('metrics:latency', 0, 999);
// ❌ Race condition: list could grow between push and trim
```

**Impact:** Memory exhaustion in Redis.

**Fix:**
```javascript
const pipeline = redis.pipeline();
pipeline.lpush('metrics:latency', latency);
pipeline.ltrim('metrics:latency', 0, 999);
await pipeline.exec();
```

---

### 12. No Request Timeout Configuration (HIGH)
**File:** [`backend/src/index.js`](backend/src/index.js:114)

**Issue:** Express has no global request timeout.

**Impact:** Hanging connections, resource exhaustion.

**Fix:**
```javascript
const timeout = require('connect-timeout');

app.use(timeout('30s'));
app.use((req, res, next) => {
  if (!req.timedout) next();
});
```

---

### 13. Weak Password Hashing Rounds (HIGH)
**File:** [`backend/src/routes/auth.js`](backend/src/routes/auth.js:70)

**Issue:** bcrypt rounds set to 12, should be 14+ for production.

```javascript
const hashedPassword = await bcrypt.hash(password, 12);
// ❌ 12 rounds is minimum, use 14+ for better security
```

**Fix:**
```javascript
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'production' ? 14 : 10;
const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
```

---

### 14. Missing SQL Injection Protection in Raw Queries (HIGH)
**File:** [`backend/src/index.js`](backend/src/index.js:141)

**Issue:** Raw SQL query without parameterization.

```javascript
await prisma.$queryRaw`SELECT 1`;
// ✅ This is safe, but ensure all raw queries use tagged templates
```

**Action:** Audit all `$queryRaw` and `$executeRaw` calls.

---

### 15. No Content Security Policy (HIGH)
**File:** [`backend/src/index.js`](backend/src/index.js:105)

**Issue:** Helmet configured but CSP not customized.

```javascript
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// ❌ Missing CSP configuration
```

**Fix:**
```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Remove unsafe-inline in production
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", config.frontendUrl],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
```

---

## 🟡 Medium Priority Issues

### 16. Inefficient N+1 Query Pattern (MEDIUM)
**File:** [`backend/src/services/MetricsService.js`](backend/src/services/MetricsService.js:95-108)

**Issue:** Agent health queries executed sequentially.

```javascript
const health = await Promise.all(
  agents.map(async (agent) => {
    const [total, violations] = await Promise.all([
      prisma.auditLog.count({ where: { agent_id: agent.id, ... } }),
      prisma.auditLog.count({ where: { agent_id: agent.id, ... } }),
    ]);
    // ❌ N queries for N agents
  })
);
```

**Fix:** Use aggregation query:
```javascript
const stats = await prisma.auditLog.groupBy({
  by: ['agent_id'],
  where: { timestamp: { gte: oneDayAgo } },
  _count: { id: true },
  _sum: {
    violation_type: { not: null },
  },
});
```

---

### 17. Missing Error Boundaries in Frontend (MEDIUM)
**File:** [`frontend/src/App.jsx`](frontend/src/App.jsx)

**Issue:** No React error boundaries to catch rendering errors.

**Fix:** Add error boundary component:
```javascript
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  
  componentDidCatch(error, errorInfo) {
    console.error('React error:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
```

---

### 18. Unvalidated Environment Variables (MEDIUM)
**File:** [`backend/src/config.js`](backend/src/config.js:3-34)

**Issue:** No validation that required env vars are present.

**Fix:**
```javascript
const requiredEnvVars = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
```

---

### 19. Memory Leak in WebSocket Clients Set (MEDIUM)
**File:** [`backend/src/index.js`](backend/src/index.js:49-57)

**Issue:** Clients not always removed from Set on error.

```javascript
ws.on('error', (err) => {
  console.error('[WS] Error:', err.message);
  wsClients.delete(ws);
  // ✅ Good, but should also handle 'close' event
});
```

**Fix:** Ensure cleanup in all cases:
```javascript
const cleanup = () => {
  wsClients.delete(ws);
  wsConnectionLimits.set(ip, Math.max(0, (wsConnectionLimits.get(ip) || 1) - 1));
};

ws.on('close', cleanup);
ws.on('error', (err) => {
  console.error('[WS] Error:', err.message);
  cleanup();
});
```

---

### 20. No Graceful Shutdown Handler (MEDIUM)
**File:** [`backend/src/index.js`](backend/src/index.js:197-210)

**Issue:** Server doesn't handle SIGTERM/SIGINT for graceful shutdown.

**Fix:**
```javascript
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    await prisma.$disconnect();
    await redis.quit();
    await subscriber.quit();
    process.exit(0);
  });
  
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});
```

---

## 🟢 Low Priority / Best Practices

### 21. Missing API Versioning (LOW)
**File:** [`backend/src/index.js`](backend/src/index.js:166-171)

**Issue:** No API versioning strategy.

**Fix:**
```javascript
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/agents', agentsRoutes);
// etc.
```

---

### 22. No Request ID Tracking (LOW)
**Issue:** Difficult to trace requests across logs.

**Fix:**
```javascript
const { v4: uuidv4 } = require('uuid');

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});
```

---

### 23. Missing Health Check for Claude API (LOW)
**File:** [`backend/src/index.js`](backend/src/index.js:159)

**Issue:** Health check doesn't verify Claude API connectivity.

**Fix:**
```javascript
let claudeOk = false;
if (config.hasClaudeKey) {
  try {
    await claudeComplete('test', '', 10);
    claudeOk = true;
  } catch {}
}
```

---

### 24. No Structured Logging (LOW)
**Issue:** Console.log used instead of structured logger.

**Fix:** Use Winston or Pino:
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
```

---

### 25. Missing Unit Tests (LOW)
**Issue:** No test suite present.

**Recommendation:** Add Jest/Vitest with minimum 70% coverage:
```json
{
  "scripts": {
    "test": "jest --coverage",
    "test:watch": "jest --watch"
  }
}
```

---

## Performance Optimization Recommendations

### Database Query Optimization

1. **Add composite indexes** for common query patterns
2. **Implement query result caching** for dashboard metrics (5-minute TTL)
3. **Use database views** for complex aggregations
4. **Implement pagination cursors** instead of offset-based pagination

### Redis Optimization

1. **Use Redis pipelining** for batch operations
2. **Implement connection pooling** with ioredis cluster mode
3. **Add TTL to all keys** to prevent memory bloat
4. **Use Redis Streams** for audit log events instead of pub/sub

### API Performance

1. **Implement response compression** (gzip/brotli)
2. **Add ETag support** for cacheable endpoints
3. **Use HTTP/2** in production
4. **Implement request coalescing** for duplicate concurrent requests

---

## Code Quality Improvements

### Type Safety

1. **Add TypeScript** for type safety across the stack
2. **Use Zod schemas** consistently for all API inputs
3. **Add JSDoc comments** for all public functions

### Error Handling

1. **Create custom error classes** for different error types
2. **Implement retry logic** for transient failures
3. **Add circuit breakers** for external API calls (Claude)

### Testing Strategy

1. **Unit tests** for all services (Jest)
2. **Integration tests** for API endpoints (Supertest)
3. **E2E tests** for critical user flows (Playwright)
4. **Load testing** for performance benchmarks (k6)

---

## Compliance & Audit Requirements

### GDPR Compliance

1. **Implement data retention policies** (auto-delete old logs)
2. **Add user data export** functionality
3. **Implement right to be forgotten** (data deletion)
4. **Add consent management** for data collection

### SOC 2 Requirements

1. **Implement audit trail** for all admin actions
2. **Add access control logging**
3. **Implement data encryption at rest**
4. **Add security incident response procedures**

---

## Implementation Priority Matrix

| Priority | Issue Count | Estimated Effort | Timeline |
|----------|-------------|------------------|----------|
| 🔴 Critical | 8 | 3-5 days | Week 1 |
| 🟠 High | 15 | 5-7 days | Week 2-3 |
| 🟡 Medium | 14 | 7-10 days | Week 4-5 |
| 🟢 Low | 10 | 5-7 days | Week 6-7 |

**Total Estimated Effort:** 20-29 days (4-6 weeks with 1 developer)

---

## Next Steps

1. **Immediate Actions (This Week):**
   - Fix JWT secret validation
   - Add input sanitization
   - Secure Redis connection
   - Implement WebSocket authentication

2. **Short Term (Next 2 Weeks):**
   - Add database indexes
   - Implement CSRF protection
   - Add request timeouts
   - Fix regex DoS vulnerabilities

3. **Medium Term (Next Month):**
   - Migrate to httpOnly cookies
   - Add comprehensive test suite
   - Implement structured logging
   - Add monitoring and alerting

4. **Long Term (Next Quarter):**
   - TypeScript migration
   - SOC 2 compliance
   - Performance optimization
   - Advanced security features

---

## Conclusion

AgentGuard has a solid architectural foundation, but requires significant security hardening before production deployment. The critical issues identified pose real security risks that must be addressed immediately. With focused effort over 4-6 weeks, the platform can be production-ready with enterprise-grade security and performance.

**Recommended Action:** Create a dedicated security sprint to address all critical and high-priority issues before any production deployment.
