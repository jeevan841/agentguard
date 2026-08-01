/**
 * Dashboard Routes
 * GET  /dashboard/metrics       - Comprehensive metrics snapshot (all authenticated roles)
 * GET  /dashboard/alerts        - Alert configs (all authenticated roles)
 * POST /dashboard/alerts        - Create alert config (admin | operator only)
 * PUT  /dashboard/alerts/:id    - Update alert config (admin | operator only)
 * DELETE /dashboard/alerts/:id  - Delete alert config (admin | operator only)
 * GET  /dashboard/webhooks      - List webhooks (all authenticated roles)
 * POST /dashboard/webhooks      - Create webhook (admin | operator only) — SSRF-validated
 */
const express = require('express');
const { getDashboardMetrics } = require('../services/MetricsService');
const prisma = require('../prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateWebhookUrl } = require('../utils/validateWebhookUrl');

const router = express.Router();

// GET /dashboard/metrics — all authenticated roles
router.get('/metrics', requireAuth, async (req, res, next) => {
  try {
    const metrics = await getDashboardMetrics();
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/alerts — all authenticated roles
router.get('/alerts', requireAuth, async (req, res, next) => {
  try {
    const alerts = await prisma.alertConfig.findMany({ orderBy: { created_at: 'desc' } });
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/alerts — admin | operator only; SSRF-validate webhook_url
router.post('/alerts', requireAuth, requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const { name, metric, threshold, operator, webhook_url, is_active } = req.body;
    if (!name || !metric || threshold === undefined) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name, metric, and threshold are required',
      });
    }

    // SSRF guard: validate webhook_url at creation time
    if (webhook_url) {
      try {
        await validateWebhookUrl(webhook_url);
      } catch (ssrfErr) {
        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: `Invalid webhook_url: ${ssrfErr.message}`,
        });
      }
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

// PUT /dashboard/alerts/:id — admin | operator only; SSRF-validate webhook_url on update
router.put('/alerts/:id', requireAuth, requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    // SSRF guard: if webhook_url is being changed, validate the new value
    if (req.body.webhook_url !== undefined && req.body.webhook_url !== null) {
      try {
        await validateWebhookUrl(req.body.webhook_url);
      } catch (ssrfErr) {
        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: `Invalid webhook_url: ${ssrfErr.message}`,
        });
      }
    }

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

// DELETE /dashboard/alerts/:id — admin | operator only
router.delete('/alerts/:id', requireAuth, requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    await prisma.alertConfig.delete({ where: { id: req.params.id } });
    res.json({ message: 'Alert deleted' });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/webhooks — all authenticated roles
router.get('/webhooks', requireAuth, async (req, res, next) => {
  try {
    const webhooks = await prisma.webhookConfig.findMany({ orderBy: { created_at: 'desc' } });
    res.json({ webhooks });
  } catch (err) {
    next(err);
  }
});

// POST /dashboard/webhooks — admin | operator only; SSRF-validate URL
router.post('/webhooks', requireAuth, requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const { name, url, events, secret, is_active } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: 'Bad Request', message: 'name and url are required' });
    }

    // SSRF guard: validate url at creation time
    try {
      await validateWebhookUrl(url);
    } catch (ssrfErr) {
      return res.status(422).json({
        error: 'Unprocessable Entity',
        message: `Invalid webhook url: ${ssrfErr.message}`,
      });
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
