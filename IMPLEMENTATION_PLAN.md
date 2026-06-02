# AgentGuard — Critical Security Fixes Implementation Plan

**Sprint Duration:** 1 Week (5 working days)  
**Team Size:** 1-2 developers  
**Priority:** CRITICAL — Must complete before production deployment

---

## Sprint Overview

This plan addresses the 8 critical security vulnerabilities identified in the security review. Each issue includes implementation steps, testing requirements, and acceptance criteria.

---

## Day 1: Authentication & Configuration Security

### Task 1.1: JWT Secret Validation (2 hours)
**Issue:** Weak JWT secret validation  
**File:** [`backend/src/config.js`](backend/src/config.js:17)

**Implementation Steps:**

1. **Add validation function:**
```javascript
// backend/src/config.js
function validateJWTSecret(secret) {
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
  
  const insecureDefaults = [
    'super_secret_jwt_key_change_in_production',
    'your-super-secret-32-char-key',
    'change_me',
  ];
  
  if (insecureDefaults.includes(secret)) {
    throw new Error('JWT_SECRET cannot be a default/example value');
  }
  
  // Check for sufficient entropy
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 16) {
    throw new Error('JWT_SECRET has insufficient entropy (too repetitive)');
  }
  
  return secret;
}

const config = {
  // ... other config
  jwt: {
    secret: validateJWTSecret(process.env.JWT_SECRET),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    capabilityExpiresIn: process.env.CAPABILITY_TOKEN_EXPIRES_IN || '1h',
  },
};
```

2. **Update `.env.example`:**
```bash
# Generate with: openssl rand -base64 32
JWT_SECRET=REPLACE_WITH_SECURE_32_CHAR_MINIMUM_SECRET
```

3. **Update documentation:**
```markdown
## Generating a Secure JWT Secret

```bash
# Linux/Mac
openssl rand -base64 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
```

**Testing:**
- [ ] Server fails to start with missing JWT_SECRET
- [ ] Server fails to start with short JWT_SECRET (<32 chars)
- [ ] Server fails to start with default JWT_SECRET
- [ ] Server starts successfully with valid JWT_SECRET
- [ ] All existing JWT tests still pass

**Acceptance Criteria:**
- ✅ Server validates JWT_SECRET on startup
- ✅ Clear error messages guide users to fix issues
- ✅ Documentation updated with generation instructions

---

### Task 1.2: Input Sanitization Middleware (3 hours)
**Issue:** Missing input sanitization  
**Files:** All route handlers

**Implementation Steps:**

1. **Install dependencies:**
```bash
cd backend
npm install sanitize-html validator
```

2. **Create sanitization middleware:**
```javascript
// backend/src/middleware/sanitize.js
const sanitizeHtml = require('sanitize-html');
const validator = require('validator');

/**
 * Sanitize string input to prevent XSS and injection attacks
 */
function sanitizeString(input, options = {}) {
  if (!input || typeof input !== 'string') return input;
  
  const {
    allowHtml = false,
    maxLength = 100000,
    stripScripts = true,
  } = options;
  
  // Trim and limit length
  let sanitized = input.trim().slice(0, maxLength);
  
  if (!allowHtml) {
    // Remove all HTML tags
    sanitized = sanitizeHtml(sanitized, {
      allowedTags: [],
      allowedAttributes: {},
      disallowedTagsMode: 'recursiveEscape',
    });
  } else {
    // Allow safe HTML only
    sanitized = sanitizeHtml(sanitized, {
      allowedTags: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'],
      allowedAttributes: {},
      disallowedTagsMode: 'recursiveEscape',
    });
  }
  
  // Escape special characters for log injection prevention
  sanitized = sanitized
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ');
  
  return sanitized;
}

/**
 * Recursively sanitize object properties
 */
function sanitizeObject(obj, options = {}) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, options));
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, options);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value, options);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Express middleware to sanitize request body
 */
function sanitizeMiddleware(options = {}) {
  return (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body, options);
    }
    
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query, options);
    }
    
    next();
  };
}

module.exports = {
  sanitizeString,
  sanitizeObject,
  sanitizeMiddleware,
};
```

3. **Apply middleware globally:**
```javascript
// backend/src/index.js
const { sanitizeMiddleware } = require('./middleware/sanitize');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeMiddleware()); // Add after body parsing
```

4. **Update guardrail service:**
```javascript
// backend/src/services/guardrail/GuardrailService.js
const { sanitizeString } = require('../../middleware/sanitize');

async function runGuardrailChecks(input, output = null, context = '', policyId = null) {
  // Sanitize inputs before processing
  input = sanitizeString(input, { maxLength: 50000 });
  output = output ? sanitizeString(output, { maxLength: 100000 }) : null;
  context = sanitizeString(context, { maxLength: 20000 });
  
  // ... rest of function
}
```

**Testing:**
- [ ] XSS payloads are sanitized (`<script>alert('xss')</script>`)
- [ ] SQL injection attempts are escaped
- [ ] Log injection (newlines) are removed
- [ ] Valid HTML is preserved when `allowHtml: true`
- [ ] Performance impact is minimal (<5ms per request)

**Acceptance Criteria:**
- ✅ All user inputs are sanitized before processing
- ✅ XSS attacks are prevented
- ✅ Log injection is prevented
- ✅ Existing functionality remains intact

---

## Day 2: Redis & WebSocket Security

### Task 2.1: Secure Redis Connection (2 hours)
**Issue:** Redis connection lacks authentication and TLS  
**File:** [`backend/src/redis/client.js`](backend/src/redis/client.js:8)

**Implementation Steps:**

1. **Update Redis client configuration:**
```javascript
// backend/src/redis/client.js
const Redis = require('ioredis');
const config = require('../config');

function createRedisClient(options = {}) {
  const redisConfig = {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableReadyCheck: true,
    connectTimeout: 10000,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    ...options,
  };
  
  // Add TLS in production
  if (process.env.NODE_ENV === 'production') {
    redisConfig.tls = {
      rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
    };
  }
  
  // Add password if provided
  if (process.env.REDIS_PASSWORD) {
    redisConfig.password = process.env.REDIS_PASSWORD;
  }
  
  const client = new Redis(config.redis.url, redisConfig);
  
  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });
  
  client.on('connect', () => {
    console.log('[Redis] Connected successfully');
  });
  
  client.on('ready', () => {
    console.log('[Redis] Ready to accept commands');
  });
  
  return client;
}

// ... rest of file
```

2. **Update environment variables:**
```bash
# .env.example
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_secure_redis_password
REDIS_TLS_REJECT_UNAUTHORIZED=true
```

3. **Update Docker Compose:**
```yaml
# docker-compose.yml
redis:
  image: redis:7-alpine
  container_name: agentguard_redis
  command: redis-server --requirepass ${REDIS_PASSWORD:-redis_dev_password}
  environment:
    - REDIS_PASSWORD=${REDIS_PASSWORD:-redis_dev_password}
  ports:
    - "6379:6379"
```

**Testing:**
- [ ] Redis connection works with password
- [ ] Redis connection fails with wrong password
- [ ] TLS connection works in production mode
- [ ] Retry strategy works on connection failure
- [ ] All Redis operations still function correctly

**Acceptance Criteria:**
- ✅ Redis requires authentication
- ✅ TLS enabled in production
- ✅ Connection retry logic implemented
- ✅ Clear error messages for connection issues

---

### Task 2.2: WebSocket Authentication & Rate Limiting (4 hours)
**Issue:** WebSocket connections lack authentication and rate limiting  
**File:** [`backend/src/index.js`](backend/src/index.js:36-58)

**Implementation Steps:**

1. **Create WebSocket authentication:**
```javascript
// backend/src/middleware/wsAuth.js
const jwt = require('jsonwebtoken');
const config = require('../config');
const { URL } = require('url');

// Track connections per IP
const wsConnectionLimits = new Map();
const MAX_CONNECTIONS_PER_IP = 5;
const CLEANUP_INTERVAL = 60000; // 1 minute

// Cleanup stale entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of wsConnectionLimits.entries()) {
    if (now - data.lastActivity > 300000) { // 5 minutes
      wsConnectionLimits.delete(ip);
    }
  }
}, CLEANUP_INTERVAL);

function authenticateWebSocket(ws, req) {
  const ip = req.socket.remoteAddress;
  
  // Check connection limit
  const currentData = wsConnectionLimits.get(ip) || { count: 0, lastActivity: Date.now() };
  
  if (currentData.count >= MAX_CONNECTIONS_PER_IP) {
    ws.close(1008, 'Too many connections from this IP');
    return null;
  }
  
  // Extract token from query params or headers
  const url = new URL(req.url, `ws://${req.headers.host}`);
  const token = url.searchParams.get('token') || req.headers['sec-websocket-protocol'];
  
  if (!token) {
    ws.close(1008, 'Authentication required');
    return null;
  }
  
  // Verify JWT
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    
    if (payload.type !== 'management') {
      ws.close(1008, 'Invalid token type');
      return null;
    }
    
    // Update connection count
    wsConnectionLimits.set(ip, {
      count: currentData.count + 1,
      lastActivity: Date.now(),
    });
    
    return { user: payload, ip };
  } catch (err) {
    ws.close(1008, 'Invalid or expired token');
    return null;
  }
}

function decrementConnectionCount(ip) {
  const data = wsConnectionLimits.get(ip);
  if (data) {
    data.count = Math.max(0, data.count - 1);
    data.lastActivity = Date.now();
    wsConnectionLimits.set(ip, data);
  }
}

module.exports = {
  authenticateWebSocket,
  decrementConnectionCount,
};
```

2. **Update WebSocket server:**
```javascript
// backend/src/index.js
const { authenticateWebSocket, decrementConnectionCount } = require('./middleware/wsAuth');

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

// Heartbeat interval
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
```

3. **Update frontend WebSocket connection:**
```javascript
// frontend/src/hooks/useWebSocket.js
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000';

export function useWebSocket(onMessage) {
  const wsRef = useRef(null);
  const { token } = useAuthStore();
  
  useEffect(() => {
    if (!token) return;
    
    // Include token in connection URL
    const ws = new WebSocket(`${WS_URL}/ws/metrics?token=${token}`);
    
    ws.onopen = () => {
      console.log('[WS] Connected');
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };
    
    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };
    
    ws.onclose = (event) => {
      console.log('[WS] Disconnected:', event.code, event.reason);
    };
    
    wsRef.current = ws;
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token, onMessage]);
  
  return wsRef;
}
```

**Testing:**
- [ ] WebSocket connection requires valid JWT
- [ ] Connection rejected with invalid/expired token
- [ ] Connection limit enforced (max 5 per IP)
- [ ] Dead connections are cleaned up
- [ ] Heartbeat keeps connections alive
- [ ] Frontend reconnects on disconnect

**Acceptance Criteria:**
- ✅ All WebSocket connections are authenticated
- ✅ Rate limiting prevents DoS attacks
- ✅ Dead connections are detected and cleaned up
- ✅ Frontend handles authentication properly

---

## Day 3: Data Protection & Audit Security

### Task 3.1: PII Redaction in Audit Logs (4 hours)
**Issue:** Sensitive data in audit logs  
**File:** [`backend/src/services/AuditService.js`](backend/src/services/AuditService.js:20-76)

**Implementation Steps:**

1. **Create PII redaction service:**
```javascript
// backend/src/services/PIIRedactionService.js
const { detectPII } = require('./guardrail/PIIDetector');

/**
 * Redact PII from text while preserving structure
 */
async function redactPII(text, options = {}) {
  if (!text || typeof text !== 'string') return text;
  
  const { useAI = false, preserveLength = true } = options;
  
  // Detect PII
  const piiResult = await detectPII(text, useAI);
  
  if (piiResult.passed) {
    return text; // No PII detected
  }
  
  let redacted = text;
  
  // Redact each type of PII
  for (const detection of piiResult.detections) {
    const redactionTag = `[REDACTED-${detection.type}]`;
    
    switch (detection.type) {
      case 'SSN':
        redacted = redacted.replace(
          /\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0{4})\d{4}\b/g,
          redactionTag
        );
        break;
      
      case 'CREDIT_CARD':
        redacted = redacted.replace(
          /\b(?:4[0-9]{12}(?:[0-9]{3})?|[25][1-7][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35\d{3})\d{11})\b/g,
          redactionTag
        );
        break;
      
      case 'EMAIL':
        redacted = redacted.replace(
          /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
          (match) => {
            if (preserveLength) {
              const [local, domain] = match.split('@');
              return `${local[0]}***@${domain}`;
            }
            return redactionTag;
          }
        );
        break;
      
      case 'PHONE':
        redacted = redacted.replace(
          /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
          redactionTag
        );
        break;
      
      case 'IP_ADDRESS':
        redacted = redacted.replace(
          /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
          (match) => {
            if (preserveLength) {
              const parts = match.split('.');
              return `${parts[0]}.${parts[1]}.***.***.`;
            }
            return redactionTag;
          }
        );
        break;
      
      default:
        // For other types, use generic redaction
        break;
    }
  }
  
  return redacted;
}

/**
 * Redact PII from object properties
 */
async function redactPIIFromObject(obj, options = {}) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => redactPIIFromObject(item, options)));
  }
  
  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      redacted[key] = await redactPII(value, options);
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = await redactPIIFromObject(value, options);
    } else {
      redacted[key] = value;
    }
  }
  
  return redacted;
}

module.exports = {
  redactPII,
  redactPIIFromObject,
};
```

2. **Update audit service:**
```javascript
// backend/src/services/AuditService.js
const { redactPII } = require('./PIIRedactionService');

async function writeAuditLog(data) {
  const {
    agent_id,
    user_id,
    input,
    output,
    tools_called = [],
    policy_decisions = [],
    latency_ms = 0,
    chain_of_thought,
    violation_type,
    severity,
    hallucination_score,
    metadata,
  } = data;
  
  // Hash original input/output
  const input_hash = hashText(input);
  const output_hash = hashText(output);
  
  // Redact PII from chain_of_thought before storing
  const redactedChainOfThought = chain_of_thought 
    ? await redactPII(chain_of_thought, { useAI: false, preserveLength: true })
    : null;
  
  // Redact PII from metadata
  const redactedMetadata = metadata
    ? await redactPIIFromObject(metadata, { useAI: false })
    : null;
  
  const log = await prisma.auditLog.create({
    data: {
      agent_id: agent_id || null,
      user_id: user_id || null,
      input_hash,
      output_hash,
      tools_called: tools_called || [],
      policy_decisions: policy_decisions || [],
      latency_ms: latency_ms || 0,
      chain_of_thought: redactedChainOfThought,
      violation_type: violation_type || null,
      severity: severity || null,
      hallucination_score: hallucination_score || null,
      metadata: redactedMetadata,
    },
    include: { agent: true, user: true },
  });
  
  // ... rest of function
}
```

**Testing:**
- [ ] SSN is redacted in audit logs
- [ ] Credit card numbers are redacted
- [ ] Email addresses are partially redacted
- [ ] Phone numbers are redacted
- [ ] Original hashes remain unchanged
- [ ] Performance impact is acceptable (<50ms)

**Acceptance Criteria:**
- ✅ All PII is redacted from audit logs
- ✅ Original data hashes preserved for integrity
- ✅ Redaction is consistent and reliable
- ✅ GDPR compliance improved

---

### Task 3.2: Regex DoS Protection (2 hours)
**Issue:** Complex regex patterns vulnerable to ReDoS  
**File:** [`backend/src/services/guardrail/PIIDetector.js`](backend/src/services/guardrail/PIIDetector.js:8-54)

**Implementation Steps:**

1. **Create safe regex wrapper:**
```javascript
// backend/src/utils/safeRegex.js
/**
 * Execute regex with timeout protection
 */
function safeRegexTest(pattern, text, timeoutMs = 100) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Regex timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    
    try {
      pattern.lastIndex = 0; // Reset regex state
      const result = pattern.test(text);
      clearTimeout(timeout);
      resolve(result);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

/**
 * Execute regex match with timeout protection
 */
function safeRegexMatch(pattern, text, timeoutMs = 100) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Regex timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    
    try {
      pattern.lastIndex = 0;
      const result = text.match(pattern);
      clearTimeout(timeout);
      resolve(result);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

/**
 * Batch regex operations with timeout
 */
async function safeRegexScan(patterns, text, timeoutMs = 100) {
  const results = [];
  
  for (const { type, pattern, severity } of patterns) {
    try {
      const matches = await safeRegexMatch(pattern, text, timeoutMs);
      if (matches && matches.length > 0) {
        results.push({ type, matches, severity });
      }
    } catch (err) {
      console.warn(`[SafeRegex] Pattern ${type} timed out or failed:`, err.message);
      // Continue with other patterns
    }
  }
  
  return results;
}

module.exports = {
  safeRegexTest,
  safeRegexMatch,
  safeRegexScan,
};
```

2. **Update PII detector:**
```javascript
// backend/src/services/guardrail/PIIDetector.js
const { safeRegexScan } = require('../../utils/safeRegex');

async function regexScan(text) {
  const detections = [];
  
  try {
    // Use safe regex scan with timeout
    const results = await safeRegexScan(PII_PATTERNS, text, 150);
    
    for (const { type, matches, severity } of results) {
      detections.push({
        type,
        count: matches.length,
        severity,
        samples: matches.slice(0, 2).map((m) => 
          m.replace(/./g, '*').slice(0, -4) + m.slice(-4)
        ),
      });
    }
  } catch (err) {
    console.error('[PII] Regex scan failed:', err.message);
    // Return empty detections on failure
  }
  
  return detections;
}
```

3. **Update injection detector:**
```javascript
// backend/src/services/guardrail/InjectionDetector.js
const { safeRegexScan } = require('../../utils/safeRegex');

async function patternScan(text) {
  const detections = [];
  
  try {
    const results = await safeRegexScan(INJECTION_PATTERNS, text, 150);
    
    for (const { type, severity } of results) {
      detections.push({ type, severity });
    }
  } catch (err) {
    console.error('[Injection] Pattern scan failed:', err.message);
  }
  
  return detections;
}
```

**Testing:**
- [ ] Normal inputs process within timeout
- [ ] Malicious ReDoS payloads are caught and timeout
- [ ] System remains responsive under ReDoS attack
- [ ] Error handling works correctly
- [ ] All existing tests still pass

**Acceptance Criteria:**
- ✅ Regex operations have timeout protection
- ✅ ReDoS attacks are mitigated
- ✅ System remains stable under attack
- ✅ Error handling is graceful

---

## Day 4-5: Testing, Documentation & Deployment

### Task 4.1: Comprehensive Testing (6 hours)

**Unit Tests:**
```javascript
// backend/tests/security/jwt.test.js
describe('JWT Secret Validation', () => {
  test('should reject short secrets', () => {
    process.env.JWT_SECRET = 'short';
    expect(() => require('../src/config')).toThrow('at least 32 characters');
  });
  
  test('should reject default secrets', () => {
    process.env.JWT_SECRET = 'super_secret_jwt_key_change_in_production';
    expect(() => require('../src/config')).toThrow('cannot be a default');
  });
  
  test('should accept valid secrets', () => {
    process.env.JWT_SECRET = 'a'.repeat(32);
    expect(() => require('../src/config')).not.toThrow();
  });
});

// backend/tests/security/sanitization.test.js
describe('Input Sanitization', () => {
  test('should remove XSS payloads', () => {
    const input = '<script>alert("xss")</script>Hello';
    const sanitized = sanitizeString(input);
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).toContain('Hello');
  });
  
  test('should remove log injection', () => {
    const input = 'Hello\nWorld\r\nTest';
    const sanitized = sanitizeString(input);
    expect(sanitized).not.toContain('\n');
    expect(sanitized).not.toContain('\r');
  });
});
```

**Integration Tests:**
```javascript
// backend/tests/integration/websocket.test.js
describe('WebSocket Authentication', () => {
  test('should reject connection without token', async () => {
    const ws = new WebSocket('ws://localhost:4000/ws/metrics');
    await expect(waitForClose(ws)).resolves.toMatchObject({
      code: 1008,
      reason: 'Authentication required',
    });
  });
  
  test('should accept connection with valid token', async () => {
    const token = generateTestToken();
    const ws = new WebSocket(`ws://localhost:4000/ws/metrics?token=${token}`);
    await expect(waitForOpen(ws)).resolves.toBe(true);
  });
});
```

**Security Tests:**
```javascript
// backend/tests/security/redos.test.js
describe('ReDoS Protection', () => {
  test('should timeout on malicious regex input', async () => {
    const maliciousInput = 'a'.repeat(10000) + '!';
    const start = Date.now();
    
    await detectPII(maliciousInput);
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500); // Should timeout quickly
  });
});
```

---

### Task 4.2: Documentation Updates (2 hours)

1. **Update README.md:**
```markdown
## Security Configuration

### Required Environment Variables

```bash
# Generate secure JWT secret (REQUIRED)
JWT_SECRET=$(openssl rand -base64 32)

# Redis password (REQUIRED in production)
REDIS_PASSWORD=$(openssl rand -base64 24)

# Enable TLS for Redis in production
REDIS_TLS_REJECT_UNAUTHORIZED=true
```

### Security Features

- ✅ JWT secret validation (minimum 32 characters)
- ✅ Input sanitization (XSS, log injection prevention)
- ✅ Redis authentication and TLS
- ✅ WebSocket authentication and rate limiting
- ✅ PII redaction in audit logs
- ✅ ReDoS protection with regex timeouts
- ✅ CSRF protection (coming soon)
- ✅ Rate limiting on all endpoints
```

2. **Create SECURITY.md:**
```markdown
# Security Policy

## Reporting Security Issues

Please report security vulnerabilities to: security@agentguard.io

## Security Features

### Authentication
- Multi-factor authentication (MFA) with TOTP
- JWT-based session management
- Short-lived capability tokens for agents

### Data Protection
- PII detection and redaction
- Input sanitization
- Audit log encryption
- Secure password hashing (bcrypt, 14 rounds)

### Network Security
- TLS/HTTPS in production
- Redis authentication and TLS
- WebSocket authentication
- Rate limiting and DoS protection

## Security Best Practices

1. Always use strong JWT secrets (32+ characters)
2. Enable Redis password authentication
3. Use TLS in production
4. Regularly rotate secrets and credentials
5. Monitor audit logs for suspicious activity
```

---

### Task 4.3: Deployment Checklist (2 hours)

**Pre-Deployment Checklist:**

```markdown
## Production Deployment Security Checklist

### Environment Configuration
- [ ] JWT_SECRET is 32+ characters and randomly generated
- [ ] REDIS_PASSWORD is set and strong
- [ ] DATABASE_URL uses SSL/TLS connection
- [ ] ANTHROPIC_API_KEY is properly secured
- [ ] All default passwords changed

### Security Features
- [ ] Input sanitization enabled
- [ ] WebSocket authentication enabled
- [ ] Redis authentication enabled
- [ ] PII redaction enabled
- [ ] Rate limiting configured
- [ ] CORS properly configured

### Infrastructure
- [ ] HTTPS/TLS enabled
- [ ] Firewall rules configured
- [ ] Database backups enabled
- [ ] Monitoring and alerting set up
- [ ] Log aggregation configured

### Testing
- [ ] All security tests passing
- [ ] Load testing completed
- [ ] Penetration testing completed
- [ ] Security scan completed (npm audit, Snyk)

### Documentation
- [ ] Security policy published
- [ ] Incident response plan documented
- [ ] Runbook created
- [ ] Team trained on security procedures
```

---

## Rollout Strategy

### Phase 1: Development Environment (Day 1-2)
1. Implement all critical fixes
2. Run comprehensive test suite
3. Manual security testing

### Phase 2: Staging Environment (Day 3-4)
1. Deploy to staging
2. Run integration tests
3. Performance testing
4. Security scanning

### Phase 3: Production Deployment (Day 5)
1. Final security review
2. Deploy during maintenance window
3. Monitor for issues
4. Rollback plan ready

---

## Success Metrics

- ✅ All 8 critical security issues resolved
- ✅ 100% test coverage for security features
- ✅ Zero security vulnerabilities in npm audit
- ✅ Performance impact <5% on average response time
- ✅ Zero production incidents during rollout

---

## Rollback Plan

If critical issues are discovered:

1. **Immediate Actions:**
   - Revert to previous version
   - Notify team and stakeholders
   - Document the issue

2. **Investigation:**
   - Analyze logs and metrics
   - Identify root cause
   - Create fix plan

3. **Resolution:**
   - Implement fix in development
   - Test thoroughly
   - Schedule new deployment

---

## Post-Deployment

### Week 1:
- Monitor error rates and performance
- Review security logs daily
- Address any issues immediately

### Week 2-4:
- Continue monitoring
- Gather feedback
- Plan next security improvements

### Ongoing:
- Regular security audits
- Dependency updates
- Penetration testing (quarterly)
- Security training for team
