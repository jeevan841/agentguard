/**
 * metrics.js — Prometheus metrics endpoint
 *
 * Exposes infrastructure-level metrics at GET /metrics in Prometheus text format.
 *
 * Metrics exported:
 *   - Default Node.js metrics (CPU, memory, GC, event-loop lag) via prom-client
 *   - http_request_duration_seconds — histogram per method/route/status
 *   - guardrail_check_duration_seconds — histogram for guardrail pipeline latency
 *   - piscina_pool_queue_size — gauge: tasks waiting for a worker thread
 *   - piscina_pool_utilization — gauge: threads currently busy (0–1)
 *
 * The /metrics route is intentionally NOT behind the /api/ rate limiter so
 * a Prometheus scraper (which runs on a fixed schedule) can always reach it.
 * Restrict access at the network/ingress level in production if needed.
 */
'use strict';

const express = require('express');
const client = require('prom-client');

const router = express.Router();

// ── Prometheus default metrics (CPU, memory, GC, event loop) ─────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ── HTTP request duration histogram ───────────────────────────────────────────
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// ── Guardrail check latency histogram ─────────────────────────────────────────
const guardrailDuration = new client.Histogram({
  name: 'guardrail_check_duration_seconds',
  help: 'Duration of guardrail check pipeline in seconds',
  labelNames: ['policy', 'passed'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

// ── Piscina pool metrics ───────────────────────────────────────────────────────
const piscinaQueueSize = new client.Gauge({
  name: 'piscina_pool_queue_size',
  help: 'Number of tasks waiting in the Piscina worker pool queue',
  registers: [register],
});

const piscinaUtilization = new client.Gauge({
  name: 'piscina_pool_utilization',
  help: 'Fraction of Piscina pool threads currently executing tasks (0–1)',
  registers: [register],
});

// Update pool gauges on each scrape. Pool is injected lazily to avoid a
// circular dependency (safeRegex imports nothing from here).
let _pool = null;
function setPiscinaPool(pool) {
  _pool = pool;
}

// ── HTTP timing middleware ────────────────────────────────────────────────────
/**
 * Express middleware that starts a timer on each request and records the
 * duration + status code when the response finishes.
 */
function httpTimingMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // Normalise dynamic route segments to avoid high cardinality.
    // Express stores the matched route pattern on req.route.path.
    const route = req.route?.path || req.path || 'unknown';
    end({ method: req.method, route, status_code: res.statusCode });
  });
  next();
}

// ── /metrics endpoint ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  // Refresh Piscina gauges just before responding so the scrape gets fresh data.
  if (_pool) {
    piscinaQueueSize.set(_pool.queueSize ?? 0);
    const threads = _pool.threads?.length ?? 1;
    const busy = _pool.utilization ?? (_pool.queueSize > 0 ? 1 : 0);
    piscinaUtilization.set(typeof busy === 'number' ? busy : 0);
  }

  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

module.exports = {
  router,
  register,
  httpDuration,
  guardrailDuration,
  httpTimingMiddleware,
  setPiscinaPool,
};
