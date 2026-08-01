/**
 * Agents Routes
 * POST   /agents           - Register an agent
 * GET    /agents           - List all agents
 * GET    /agents/:id       - Get agent by ID
 * PUT    /agents/:id       - Update agent
 * DELETE /agents/:id       - Deactivate agent
 * POST   /agents/:id/token - Issue capability token
 * POST   /agents/:id/delegate - Delegate child capability token
 */
const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma/client');
const { requireAuth, requireRole, generateCapabilityToken } = require('../middleware/auth');
const { idempotency } = require('../middleware/idempotency');

const router = express.Router();

const AgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  allowed_tools: z.array(z.string()).default([]),
  max_token_budget: z.number().int().min(256).max(200000).default(4096),
  allowed_data_scopes: z.array(z.string()).default(['public']),
  policy_id: z.string().uuid().optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
});

// POST /agents — create agent (admin | operator only)
router.post('/', requireAuth, requireRole('admin', 'operator'), idempotency(), async (req, res, next) => {
  try {
    const data = AgentSchema.parse(req.body);
    const agent = await prisma.agent.create({ data, include: { policy: true } });
    res.status(201).json({ agent });
  } catch (err) {
    next(err);
  }
});

// GET /agents
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { active, search, page = 1, limit = 50 } = req.query;
    const where = {};

    if (active !== undefined) where.is_active = active === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [agents, total] = await Promise.all([
      prisma.agent.findMany({
        where,
        include: { policy: { select: { id: true, name: true } } },
        orderBy: { created_at: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.agent.count({ where }),
    ]);

    res.json({ agents, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /agents/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: { policy: true },
    });
    if (!agent) return res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
    res.json({ agent });
  } catch (err) {
    next(err);
  }
});

// PUT /agents/:id — update agent (admin | operator only)
router.put('/:id', requireAuth, requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const data = AgentSchema.partial().parse(req.body);
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data,
      include: { policy: true },
    });
    res.json({ agent });
  } catch (err) {
    next(err);
  }
});

// DELETE /agents/:id — deactivate agent (admin | operator only)
router.delete('/:id', requireAuth, requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    await prisma.agent.update({
      where: { id: req.params.id },
      data: { is_active: false },
    });
    res.json({ message: 'Agent deactivated successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /agents/:id/token — issue capability token (admin | operator only)
router.post('/:id/token', requireAuth, requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: 'Not Found', message: 'Agent not found' });
    if (!agent.is_active) {
      return res.status(400).json({ error: 'Bad Request', message: 'Agent is not active' });
    }

    const token = generateCapabilityToken(agent);
    res.json({ token, agent_id: agent.id, expires_in: '1h' });
  } catch (err) {
    next(err);
  }
});

// POST /agents/:id/delegate — delegate child capability token (admin | operator only)
router.post('/:id/delegate', requireAuth, requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const { child_agent_id } = req.body;
    if (!child_agent_id) {
      return res.status(400).json({ error: 'Bad Request', message: 'child_agent_id is required' });
    }

    const [parent, child] = await Promise.all([
      prisma.agent.findUnique({ where: { id: req.params.id } }),
      prisma.agent.findUnique({ where: { id: child_agent_id } }),
    ]);

    if (!parent || !child) {
      return res.status(404).json({ error: 'Not Found', message: 'Parent or child agent not found' });
    }

    // Parent capability is derived from the parent agent itself
    const parentCapability = {
      agent_id: parent.id,
      allowed_tools: parent.allowed_tools,
      allowed_data_scopes: parent.allowed_data_scopes,
    };

    const token = generateCapabilityToken(child, parentCapability);
    res.json({
      token,
      parent_agent_id: parent.id,
      child_agent_id: child.id,
      delegated_tools: child.allowed_tools.filter((t) => parent.allowed_tools.includes(t)),
      expires_in: '1h',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
