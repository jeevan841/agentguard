/**
 * Red-Team Routes
 * POST /redteam/run    - Trigger a red-team suite for an agent
 * GET  /redteam/runs   - List past runs
 * GET  /redteam/runs/:id - Get a specific run
 * GET  /redteam/attacks - List available attack categories
 */
const express = require('express');
const { runRedTeamSuite, ATTACK_LIBRARY } = require('../services/RedTeamService');
const { generateRedTeamPdf } = require('../services/PdfService');
const prisma = require('../prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /redteam/run — trigger a red-team suite (admin | operator only)
router.post('/run', requireAuth, requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const { agent_id, attack_types } = req.body;
    if (!agent_id) {
      return res.status(400).json({ error: 'Bad Request', message: 'agent_id is required' });
    }

    // Run async — respond immediately with run ID
    const run = await prisma.redTeamRun.create({
      data: {
        agent_id,
        status: 'pending',
        attack_types: attack_types || Object.keys(ATTACK_LIBRARY),
        total_tests: 0,
      },
    });

    // Kick off async (don't await)
    runRedTeamSuite(agent_id, attack_types)
      .then((completed) => {
        console.log(`[RedTeam] Run ${completed.id} completed. Pass rate: ${completed.pass_rate?.toFixed(1)}%`);
      })
      .catch((err) => {
        console.error('[RedTeam] Run failed:', err.message);
        prisma.redTeamRun.update({
          where: { id: run.id },
          data: { status: 'failed' },
        }).catch(() => {});
      });

    res.status(202).json({
      run_id: run.id,
      status: 'pending',
      message: 'Red-team suite started. Poll GET /redteam/runs/:id for status.',
    });
  } catch (err) {
    next(err);
  }
});

// GET /redteam/runs
router.get('/runs', requireAuth, async (req, res, next) => {
  try {
    const { agent_id, status, page = 1, limit = 20 } = req.query;
    const where = {};

    if (agent_id) where.agent_id = agent_id;
    if (status) where.status = status;

    const [runs, total] = await Promise.all([
      prisma.redTeamRun.findMany({
        where,
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { created_at: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.redTeamRun.count({ where }),
    ]);

    res.json({ runs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /redteam/runs/:id
router.get('/runs/:id', requireAuth, async (req, res, next) => {
  try {
    const run = await prisma.redTeamRun.findUnique({
      where: { id: req.params.id },
      include: { agent: { select: { id: true, name: true } } },
    });
    if (!run) return res.status(404).json({ error: 'Not Found', message: 'Run not found' });
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

// GET /redteam/runs/:id/export
router.get('/runs/:id/export', requireAuth, async (req, res, next) => {
  try {
    const run = await prisma.redTeamRun.findUnique({
      where: { id: req.params.id },
      include: { agent: { select: { id: true, name: true } } },
    });
    if (!run) return res.status(404).json({ error: 'Not Found', message: 'Run not found' });

    const pdfBuffer = await generateRedTeamPdf(run);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="redteam-report-${run.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// GET /redteam/attacks - List attack library
router.get('/attacks', requireAuth, (req, res) => {
  const summary = Object.entries(ATTACK_LIBRARY).map(([type, attacks]) => ({
    type,
    count: attacks.length,
    attacks: attacks.map((a) => ({
      id: a.id,
      name: a.name,
      severity: a.severity,
    })),
  }));
  res.json({ categories: summary, total: Object.values(ATTACK_LIBRARY).flat().length });
});

module.exports = router;
