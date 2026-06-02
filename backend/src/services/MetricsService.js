/**
 * MetricsService
 * Collects and serves real-time metrics from Redis
 */
const { getRedis } = require('../redis/client');
const prisma = require('../prisma/client');

/**
 * Get requests per minute for the last N minutes
 */
async function getRequestsPerMinute(windowMinutes = 30) {
  const redis = getRedis();
  const now = Math.floor(Date.now() / 60000);
  const data = [];

  for (let i = windowMinutes - 1; i >= 0; i--) {
    const bucket = now - i;
    const count = await redis.get(`metrics:requests:${bucket}`);
    const minuteAgo = new Date((bucket) * 60000);
    data.push({
      time: minuteAgo.toISOString(),
      label: `${minuteAgo.getHours()}:${String(minuteAgo.getMinutes()).padStart(2, '0')}`,
      requests: parseInt(count || '0'),
    });
  }

  return data;
}

/**
 * Get guardrail hit rates by violation type
 */
async function getGuardrailHitRates() {
  const redis = getRedis();
  const types = ['pii', 'injection', 'output', 'none'];
  const rates = {};

  for (const type of types) {
    const count = await redis.get(`metrics:violations:${type}`);
    rates[type] = parseInt(count || '0');
  }

  const passed = parseInt((await redis.get('metrics:guardrail:passed')) || '0');
  const failed = parseInt((await redis.get('metrics:guardrail:failed')) || '0');
  const total = passed + failed;

  return {
    violation_counts: rates,
    total_checks: total,
    passed,
    failed,
    hit_rate: total > 0 ? (failed / total) : 0,
  };
}

/**
 * Get average latency from the last N samples
 */
async function getLatencyStats() {
  const redis = getRedis();
  const samples = await redis.lrange('metrics:latency', 0, 99);
  const numbers = samples.map(Number);

  if (numbers.length === 0) {
    return { avg: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }

  numbers.sort((a, b) => a - b);
  const p = (pct) => numbers[Math.floor((pct / 100) * numbers.length)] || 0;

  return {
    avg: Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length),
    p50: p(50),
    p95: p(95),
    p99: p(99),
    min: numbers[0],
    max: numbers[numbers.length - 1],
    samples: numbers.length,
  };
}

/**
 * Get agent health metrics (per-agent error rate)
 */
async function getAgentHealth() {
  try {
    const agents = await prisma.agent.findMany({
      where: { is_active: true },
      select: { id: true, name: true },
    });

    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const health = await Promise.all(
      agents.map(async (agent) => {
        const [total, violations] = await Promise.all([
          prisma.auditLog.count({
            where: { agent_id: agent.id, timestamp: { gte: oneDayAgo } },
          }),
          prisma.auditLog.count({
            where: {
              agent_id: agent.id,
              timestamp: { gte: oneDayAgo },
              violation_type: { not: null },
            },
          }),
        ]);

        const errorRate = total > 0 ? violations / total : 0;
        const status =
          errorRate > 0.5 ? 'critical' :
          errorRate > 0.2 ? 'warning' :
          errorRate > 0.05 ? 'degraded' : 'healthy';

        return {
          agent_id: agent.id,
          agent_name: agent.name,
          total_requests: total,
          violations,
          error_rate: errorRate,
          status,
        };
      })
    );

    return health;
  } catch (err) {
    console.warn('[Metrics] Could not compute agent health:', err.message);
    return [];
  }
}

/**
 * Get violation trend over time (last 24 hours, hourly)
 */
async function getViolationTrend(hours = 24) {
  try {
    const now = new Date();
    const trend = [];

    for (let i = hours - 1; i >= 0; i--) {
      const start = new Date(now - (i + 1) * 3600000);
      const end = new Date(now - i * 3600000);

      const [total, violations] = await Promise.all([
        prisma.auditLog.count({ where: { timestamp: { gte: start, lte: end } } }),
        prisma.auditLog.count({
          where: { timestamp: { gte: start, lte: end }, violation_type: { not: null } },
        }),
      ]);

      trend.push({
        time: end.toISOString(),
        label: `${end.getHours()}:00`,
        total,
        violations,
        rate: total > 0 ? violations / total : 0,
      });
    }

    return trend;
  } catch (err) {
    console.warn('[Metrics] Could not compute violation trend:', err.message);
    return [];
  }
}

/**
 * Get comprehensive dashboard metrics snapshot
 */
async function getDashboardMetrics() {
  const [requestsPerMin, hitRates, latency, agentHealth, violationTrend] = await Promise.all([
    getRequestsPerMinute(30),
    getGuardrailHitRates(),
    getLatencyStats(),
    getAgentHealth(),
    getViolationTrend(24),
  ]);

  // DB-level counts
  const dbCounts = await prisma.auditLog.count().catch(() => 0);
  const activeAgents = await prisma.agent.count({ where: { is_active: true } }).catch(() => 0);
  const redTeamRuns = await prisma.redTeamRun.count().catch(() => 0);

  return {
    summary: {
      total_logs: dbCounts,
      active_agents: activeAgents,
      red_team_runs: redTeamRuns,
      guardrail_hit_rate: hitRates.hit_rate,
      avg_latency_ms: latency.avg,
    },
    requests_per_minute: requestsPerMin,
    guardrail_stats: hitRates,
    latency,
    agent_health: agentHealth,
    violation_trend: violationTrend,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  getDashboardMetrics,
  getRequestsPerMinute,
  getGuardrailHitRates,
  getLatencyStats,
  getAgentHealth,
  getViolationTrend,
};
