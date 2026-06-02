/**
 * Audit Routes
 * POST /audit/log      - Write an audit event
 * GET  /audit/logs     - Paginated + filtered log search
 * GET  /audit/stats    - Aggregate statistics
 * GET  /audit/export   - Export to CSV
 */
const express = require('express');
const { writeAuditLog, queryAuditLogs, getAuditStats, exportToCSV } = require('../services/AuditService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /audit/log
router.post('/log', requireAuth, async (req, res, next) => {
  try {
    const log = await writeAuditLog({
      agent_id: req.body.agent_id,
      user_id: req.user?.id,
      input: req.body.input,
      output: req.body.output,
      tools_called: req.body.tools_called || [],
      policy_decisions: req.body.policy_decisions || [],
      latency_ms: req.body.latency_ms || 0,
      chain_of_thought: req.body.chain_of_thought,
      violation_type: req.body.violation_type,
      severity: req.body.severity,
      hallucination_score: req.body.hallucination_score,
      metadata: req.body.metadata,
    });
    res.status(201).json({ log });
  } catch (err) {
    next(err);
  }
});

// GET /audit/logs
router.get('/logs', requireAuth, async (req, res, next) => {
  try {
    const {
      page, limit, agent_id, user_id,
      violation_type, severity,
      start_date, end_date, search,
    } = req.query;

    const result = await queryAuditLogs({
      page, limit, agent_id, user_id,
      violation_type, severity,
      start_date, end_date, search,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /audit/stats
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const stats = await getAuditStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// GET /audit/export?format=csv
router.get('/export', requireAuth, async (req, res, next) => {
  try {
    const { format = 'csv', agent_id, violation_type, start_date, end_date } = req.query;

    if (format === 'csv') {
      const csv = await exportToCSV({ agent_id, violation_type, start_date, end_date });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="agentguard-audit-${new Date().toISOString().slice(0, 10)}.csv"`
      );
      res.send(csv);
    } else {
      res.status(400).json({ error: 'Bad Request', message: 'Supported formats: csv' });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
