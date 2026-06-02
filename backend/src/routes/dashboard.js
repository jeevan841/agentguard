/**
 * Dashboard Routes
 * GET /dashboard/metrics - Comprehensive metrics snapshot
 * GET /dashboard/alerts  - Alert configs
 * POST /dashboard/alerts - Create alert config
 * PUT /dashboard/alerts/:id - Update alert config
 */
const express = require('express');
const { getDashboardMetrics } = require('../services/MetricsService');
const prisma = require('../prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /dashboard/metrics
router.get('/metrics', requireAuth, async (req, res, next) => {
  try {
    const metrics = await getDashboardMetrics();
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/alerts
router.get('/alerts', requireAuth, async (req, res, next) => {
  try {
    const alerts = await prisma.alertConfig.findMany({ orderBy: { created_at: 'desc' } });
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/alerts
router.post('/alerts', requireAuth, async (req, res, next) => {
  try {
    const { name, metric, threshold, operator, webhook_url, is_active } = req.body;
    if (!name || !metric || threshold === undefined) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name, metric, and threshold are required',
      });
    }
    const alert = await prisma.alertConfig.create({
      data: {
        name,
        metric,
        threshold: parseFloat(threshold),
        operator: operator || 'gt',
        webhook_url: webhook_url || null,
        is_active: is_active !== false,
      },
    });
    res.status(201).json({ alert });
  } catch (err) {
    next(err);
  }
});

// PUT /dashboard/alerts/:id
router.put('/alerts/:id', requireAuth, async (req, res, next) => {
  try {
    const alert = await prisma.alertConfig.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.name && { name: req.body.name }),
        ...(req.body.metric && { metric: req.body.metric }),
        ...(req.body.threshold !== undefined && { threshold: parseFloat(req.body.threshold) }),
        ...(req.body.operator && { operator: req.body.operator }),
        ...(req.body.webhook_url !== undefined && { webhook_url: req.body.webhook_url }),
        ...(req.body.is_active !== undefined && { is_active: req.body.is_active }),
      },
    });
    res.json({ alert });
  } catch (err) {
    next(err);
  }
});

// DELETE /dashboard/alerts/:id
router.delete('/alerts/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.alertConfig.delete({ where: { id: req.params.id } });
    res.json({ message: 'Alert deleted' });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/webhooks
router.get('/webhooks', requireAuth, async (req, res, next) => {
  try {
    const webhooks = await prisma.webhookConfig.findMany({ orderBy: { created_at: 'desc' } });
    res.json({ webhooks });
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/webhooks
router.post('/webhooks', requireAuth, async (req, res, next) => {
  try {
    const { name, url, events, secret, is_active } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: 'Bad Request', message: 'name and url are required' });
    }
    const webhook = await prisma.webhookConfig.create({
      data: { name, url, events: events || [], secret: secret || null, is_active: is_active !== false },
    });
    res.status(201).json({ webhook });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
