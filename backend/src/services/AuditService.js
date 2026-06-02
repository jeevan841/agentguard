/**
 * AuditService
 * Manages append-only audit log writes, reads, and exports
 */
const crypto = require('crypto');
const prisma = require('../prisma/client');
const { getRedis } = require('../redis/client');

/**
 * Hash text using SHA-256
 */
function hashText(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/**
 * Write a new audit log entry
 */
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

  const input_hash = hashText(input);
  const output_hash = hashText(output);

  const log = await prisma.auditLog.create({
    data: {
      agent_id: agent_id || null,
      user_id: user_id || null,
      input_hash,
      output_hash,
      tools_called: tools_called || [],
      policy_decisions: policy_decisions || [],
      latency_ms: latency_ms || 0,
      chain_of_thought: chain_of_thought || null,
      violation_type: violation_type || null,
      severity: severity || null,
      hallucination_score: hallucination_score || null,
      metadata: metadata || null,
    },
    include: { agent: true, user: true },
  });

  // Publish to Redis for real-time dashboard
  try {
    const redis = getRedis();
    await redis.publish(
      'audit:events',
      JSON.stringify({
        type: 'new_log',
        log_id: log.id,
        agent_id,
        violation_type,
        severity,
        timestamp: log.timestamp,
      })
    );
  } catch (err) {
    // Non-critical
  }

  return log;
}

/**
 * Query audit logs with pagination and filters
 */
async function queryAuditLogs({
  page = 1,
  limit = 20,
  agent_id,
  user_id,
  violation_type,
  severity,
  start_date,
  end_date,
  search,
} = {}) {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const where = {};

  if (agent_id) where.agent_id = agent_id;
  if (user_id) where.user_id = user_id;
  if (violation_type) where.violation_type = violation_type;
  if (severity) where.severity = severity;

  if (start_date || end_date) {
    where.timestamp = {};
    if (start_date) where.timestamp.gte = new Date(start_date);
    if (end_date) where.timestamp.lte = new Date(end_date);
  }

  if (search) {
    where.OR = [
      { chain_of_thought: { contains: search, mode: 'insensitive' } },
      { violation_type: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { timestamp: 'desc' },
      include: { agent: { select: { id: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  };
}

/**
 * Get audit log statistics for dashboard
 */
async function getAuditStats() {
  const now = new Date();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const [total, lastHour, lastDay, violationBreakdown, severityBreakdown] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.count({ where: { timestamp: { gte: oneHourAgo } } }),
    prisma.auditLog.count({ where: { timestamp: { gte: oneDayAgo } } }),
    prisma.auditLog.groupBy({
      by: ['violation_type'],
      _count: { violation_type: true },
      where: { violation_type: { not: null } },
    }),
    prisma.auditLog.groupBy({
      by: ['severity'],
      _count: { severity: true },
      where: { severity: { not: null } },
    }),
  ]);

  return {
    total,
    last_hour: lastHour,
    last_day: lastDay,
    violation_breakdown: violationBreakdown.map((v) => ({
      type: v.violation_type,
      count: v._count.violation_type,
    })),
    severity_breakdown: severityBreakdown.map((s) => ({
      severity: s.severity,
      count: s._count.severity,
    })),
  };
}

/**
 * Export logs to CSV format
 */
async function exportToCSV(filters = {}) {
  const { logs } = await queryAuditLogs({ ...filters, limit: 10000, page: 1 });

  const headers = [
    'ID', 'Timestamp', 'Agent', 'User ID',
    'Input Hash', 'Output Hash', 'Violation Type',
    'Severity', 'Latency (ms)', 'Hallucination Score',
    'Tools Called', 'Chain of Thought',
  ];

  const rows = logs.map((log) => [
    log.id,
    log.timestamp.toISOString(),
    log.agent?.name || log.agent_id || 'Unknown',
    log.user_id || 'N/A',
    log.input_hash,
    log.output_hash || 'N/A',
    log.violation_type || 'none',
    log.severity || 'N/A',
    log.latency_ms,
    log.hallucination_score ?? 'N/A',
    Array.isArray(log.tools_called) ? log.tools_called.join(';') : '[]',
    (log.chain_of_thought || '').replace(/,/g, ';').replace(/\n/g, ' '),
  ]);

  const csvLines = [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))];
  return csvLines.join('\n');
}

module.exports = { writeAuditLog, queryAuditLogs, getAuditStats, exportToCSV, hashText };
