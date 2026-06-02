/**
 * Guardrail Routes
 * POST /guardrail/check - Run full guardrail pipeline
 */
const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { runGuardrailChecks } = require('../services/guardrail/GuardrailService');
const { writeAuditLog } = require('../services/AuditService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Stricter rate limit for guardrail checks (100 req/min per IP)
const guardrailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too Many Requests', message: 'Guardrail rate limit exceeded (100/min)' },
  standardHeaders: true,
  legacyHeaders: false,
});

const GuardrailCheckSchema = z.object({
  input: z.string().min(1, 'Input is required').max(50000, 'Input too long'),
  output: z.string().max(100000).optional().nullable(),
  context: z.string().max(20000).optional().default(''),
  policy_id: z.string().uuid().optional().nullable(),
  agent_id: z.string().uuid().optional().nullable(),
  log: z.boolean().default(true),
});

// POST /guardrail/check
router.post('/check', requireAuth, guardrailLimiter, async (req, res, next) => {
  try {
    const { input, output, context, policy_id, agent_id, log } = GuardrailCheckSchema.parse(req.body);

    const start = Date.now();
    const results = await runGuardrailChecks(input, output, context, policy_id);
    const latency = Date.now() - start;

    // Write to audit log if requested
    if (log) {
      writeAuditLog({
        agent_id,
        user_id: req.user?.id,
        input,
        output,
        tools_called: [],
        policy_decisions: results.checks.map((c) => ({
          check: c.check,
          passed: c.passed,
          reason: c.reason,
          confidence: c.confidence,
        })),
        latency_ms: latency,
        chain_of_thought: results.failed_checks.length > 0
          ? `Guardrail violations: ${results.failed_checks.map((c) => `${c.check}: ${c.reason}`).join(' | ')}`
          : 'All guardrail checks passed.',
        violation_type: results.violation_summary[0] || null,
        severity: results.severity,
        hallucination_score: results.hallucination_score,
      }).catch((err) => console.warn('[Guardrail] Audit log failed:', err.message));
    }

    res.json({
      passed: results.passed,
      overall_confidence: results.overall_confidence,
      checks: results.checks,
      failed_checks: results.failed_checks,
      violation_summary: results.violation_summary,
      severity: results.severity,
      hallucination_score: results.hallucination_score,
      hallucination_reasoning: results.hallucination_reasoning,
      latency_ms: results.latency_ms,
    });
  } catch (err) {
    next(err);
  }
});

// POST /guardrail/test
router.post('/test', requireAuth, guardrailLimiter, async (req, res, next) => {
  try {
    const { input, output, context, policy_id } = GuardrailCheckSchema.parse(req.body);

    const start = Date.now();
    const results = await runGuardrailChecks(input, output, context, policy_id);
    const latency = Date.now() - start;

    res.json({
      passed: results.passed,
      overall_confidence: results.overall_confidence,
      checks: results.checks,
      failed_checks: results.failed_checks,
      violation_summary: results.violation_summary,
      severity: results.severity,
      hallucination_score: results.hallucination_score,
      hallucination_reasoning: results.hallucination_reasoning,
      latency_ms: latency,
    });
  } catch (err) {
    next(err);
  }
});

// GET /guardrail/policies - List all policies
router.get('/policies', requireAuth, async (req, res, next) => {
  try {
    const prisma = require('../prisma/client');
    const policies = await prisma.policy.findMany({ orderBy: { created_at: 'desc' } });
    res.json({ policies });
  } catch (err) {
    next(err);
  }
});

// POST /guardrail/policies - Create a policy
router.post('/policies', requireAuth, async (req, res, next) => {
  try {
    const { name, description, rules } = req.body;
    if (!name) return res.status(400).json({ error: 'Bad Request', message: 'name is required' });

    const prisma = require('../prisma/client');
    const policy = await prisma.policy.create({
      data: {
        name,
        description: description || null,
        rules: rules || {
          check_pii: true,
          check_injection: true,
          check_output: true,
          blocklist: [],
          restricted_topics: [],
        },
      },
    });
    res.status(201).json({ policy });
  } catch (err) {
    next(err);
  }
});

// PUT /guardrail/policies/:id
router.put('/policies/:id', requireAuth, async (req, res, next) => {
  try {
    const { name, description, rules, is_active } = req.body;
    const prisma = require('../prisma/client');
    const policy = await prisma.policy.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(rules && { rules }),
        ...(is_active !== undefined && { is_active }),
      },
    });
    res.json({ policy });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
