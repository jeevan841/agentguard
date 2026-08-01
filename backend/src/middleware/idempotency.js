/**
 * idempotency.js — Idempotency-Key middleware for POST endpoints
 *
 * Prevents duplicate resource creation when a client retries a request due to
 * a network timeout, load-balancer failover, or transient error.
 *
 * Protocol:
 *   Client sends: Idempotency-Key: <uuid>
 *   First request: processed normally; response is cached in Redis with 24h TTL
 *   Repeat request (same key): original response is returned immediately,
 *                               no handler is called again
 *
 * Cache key: `idempotency:<userId>:<idempotencyKey>`
 *   - Scoped to the authenticated user so two users can use the same key
 *     independently without collisions.
 *
 * If no Idempotency-Key header is present, the middleware is a no-op (calls next).
 *
 * Apply selectively to mutating POST endpoints that create resources:
 *   POST /v1/agents
 *   POST /v1/redteam/run
 *   POST /v1/guardrail/policies
 *   POST /v1/dashboard/webhooks
 */
'use strict';

const { getRedis } = require('../redis/client');

const TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Express middleware factory. Apply after requireAuth so req.user is populated.
 *
 * @returns {Function} Express middleware
 */
function idempotency() {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];
    if (!key) return next(); // No key — pass through

    // Scope to authenticated user to prevent cross-user collisions
    const userId = req.user?.id || 'anonymous';
    const redisKey = `idempotency:${userId}:${key}`;
    const redis = getRedis();

    try {
      const cached = await redis.get(redisKey);
      if (cached) {
        // Replay cached response
        const { status, body } = JSON.parse(cached);
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(status).json(body);
      }

      // Intercept the response to cache it
      const originalJson = res.json.bind(res);
      res.json = async (body) => {
        // Only cache successful (2xx) responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          await redis
            .setex(redisKey, TTL_SECONDS, JSON.stringify({ status: res.statusCode, body }))
            .catch(() => {}); // Non-fatal if Redis is down
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      // Redis down — let the request through rather than blocking it
      console.warn('[Idempotency] Redis error, bypassing cache:', err.message);
      next();
    }
  };
}

module.exports = { idempotency };
