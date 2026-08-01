/**
 * AlertService
 * Monitors metrics and fires webhook / Slack alerts when thresholds are exceeded
 */
const config = require('../config');
const prisma = require('../prisma/client');
const { validateWebhookUrl } = require('../utils/validateWebhookUrl');

let fetch;
(async () => {
  fetch = (await import('node-fetch')).default;
})();

/**
 * Send a webhook notification.
 * Re-validates the URL immediately before dispatch to guard against DNS rebinding:
 * a hostname that resolved to a public IP at registration time could be re-pointed
 * to an internal address before the next metrics broadcast cycle (every 10 s).
 */
async function sendWebhook(url, payload) {
  if (!url || !fetch) return false;

  // Send-time SSRF re-check (DNS rebinding guard)
  try {
    await validateWebhookUrl(url);
  } catch (ssrfErr) {
    console.warn(`[Alert] Webhook SSRF guard blocked send to ${url}: ${ssrfErr.message}`);
    return false;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (err) {
    console.error('[Alert] Webhook failed:', err.message);
    return false;
  }
}

/**
 * Send a Slack alert
 */
async function sendSlackAlert(message, severity = 'warning') {
  const url = config.alerts.slackWebhookUrl;
  if (!url) return false;

  const color = severity === 'critical' ? '#FF0000' : severity === 'high' ? '#FF6600' : '#FFA500';

  return sendWebhook(url, {
    attachments: [
      {
        color,
        title: '🛡️ AgentGuard Alert',
        text: message,
        footer: 'AgentGuard Monitoring',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

/**
 * Check all active alert configs against current metrics
 */
async function checkAlerts(metrics) {
  try {
    const configs = await prisma.alertConfig.findMany({ where: { is_active: true } });

    for (const alertConfig of configs) {
      let currentValue = null;

      switch (alertConfig.metric) {
        case 'guardrail_hit_rate':
          currentValue = metrics.guardrail_stats?.hit_rate || 0;
          break;
        case 'avg_latency_ms':
          currentValue = metrics.latency?.avg || 0;
          break;
        case 'requests_per_min': {
          const latest = metrics.requests_per_minute?.slice(-1)[0];
          currentValue = latest?.requests || 0;
          break;
        }
        default:
          continue;
      }

      let triggered = false;
      switch (alertConfig.operator) {
        case 'gt': triggered = currentValue > alertConfig.threshold; break;
        case 'lt': triggered = currentValue < alertConfig.threshold; break;
        case 'eq': triggered = currentValue === alertConfig.threshold; break;
      }

      if (triggered) {
        const message = `⚠️ Alert "${alertConfig.name}": ${alertConfig.metric} is ${currentValue.toFixed(2)} (threshold: ${alertConfig.operator} ${alertConfig.threshold})`;
        console.log('[Alert]', message);

        // Send to configured webhook
        if (alertConfig.webhook_url) {
          await sendWebhook(alertConfig.webhook_url, {
            alert: alertConfig.name,
            metric: alertConfig.metric,
            current_value: currentValue,
            threshold: alertConfig.threshold,
            timestamp: new Date().toISOString(),
          });
        }

        // Send to global Slack
        await sendSlackAlert(message, currentValue > alertConfig.threshold * 1.5 ? 'critical' : 'warning');
      }
    }
  } catch (err) {
    console.warn('[Alert] Check failed:', err.message);
  }
}

module.exports = { sendSlackAlert, sendWebhook, checkAlerts };
