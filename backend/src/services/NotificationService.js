/**
 * NotificationService
 * Real-time notification system for critical events
 */
const { getRedis } = require('../redis/client');
const prisma = require('../prisma/client');

// Notification types
const NOTIFICATION_TYPES = {
  CRITICAL_VIOLATION: 'critical_violation',
  AGENT_HEALTH_DEGRADED: 'agent_health_degraded',
  REDTEAM_FAILED: 'redteam_failed',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  SYSTEM_ALERT: 'system_alert',
  AGENT_CREATED: 'agent_created',
  POLICY_UPDATED: 'policy_updated',
};

// Notification priorities
const PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

/**
 * Create a notification
 */
async function createNotification({
  type,
  title,
  message,
  priority = PRIORITY.MEDIUM,
  userId = null,
  metadata = {},
  actionUrl = null,
}) {
  try {
    const redis = getRedis();
    
    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      priority,
      userId,
      metadata,
      actionUrl,
      read: false,
      createdAt: new Date().toISOString(),
    };
    
    // Store in Redis with 7-day expiry
    const key = userId ? `notifications:user:${userId}` : 'notifications:global';
    await redis.lpush(key, JSON.stringify(notification));
    await redis.ltrim(key, 0, 99); // Keep last 100 notifications
    await redis.expire(key, 7 * 24 * 60 * 60); // 7 days
    
    // Publish to WebSocket subscribers
    await redis.publish('notifications', JSON.stringify({
      type: 'new_notification',
      notification,
    }));
    
    // For critical notifications, also send to alert service
    if (priority === PRIORITY.CRITICAL) {
      const { sendAlert } = require('./AlertService');
      await sendAlert({
        title,
        message,
        severity: 'critical',
        metadata,
      }).catch(err => console.warn('[Notification] Alert send failed:', err.message));
    }
    
    return notification;
  } catch (err) {
    console.error('[Notification] Failed to create notification:', err.message);
    throw err;
  }
}

/**
 * Get notifications for a user
 */
async function getUserNotifications(userId, { limit = 20, unreadOnly = false } = {}) {
  try {
    const redis = getRedis();
    const key = `notifications:user:${userId}`;
    
    const notifications = await redis.lrange(key, 0, limit - 1);
    const parsed = notifications.map(n => JSON.parse(n));
    
    if (unreadOnly) {
      return parsed.filter(n => !n.read);
    }
    
    return parsed;
  } catch (err) {
    console.error('[Notification] Failed to get notifications:', err.message);
    return [];
  }
}

/**
 * Get global notifications
 */
async function getGlobalNotifications({ limit = 20 } = {}) {
  try {
    const redis = getRedis();
    const notifications = await redis.lrange('notifications:global', 0, limit - 1);
    return notifications.map(n => JSON.parse(n));
  } catch (err) {
    console.error('[Notification] Failed to get global notifications:', err.message);
    return [];
  }
}

/**
 * Mark notification as read
 */
async function markAsRead(userId, notificationId) {
  try {
    const redis = getRedis();
    const key = `notifications:user:${userId}`;
    
    const notifications = await redis.lrange(key, 0, -1);
    const updated = notifications.map(n => {
      const parsed = JSON.parse(n);
      if (parsed.id === notificationId) {
        parsed.read = true;
      }
      return JSON.stringify(parsed);
    });
    
    // Replace the list
    await redis.del(key);
    if (updated.length > 0) {
      await redis.rpush(key, ...updated);
    }
    
    return true;
  } catch (err) {
    console.error('[Notification] Failed to mark as read:', err.message);
    return false;
  }
}

/**
 * Mark all notifications as read
 */
async function markAllAsRead(userId) {
  try {
    const redis = getRedis();
    const key = `notifications:user:${userId}`;
    
    const notifications = await redis.lrange(key, 0, -1);
    const updated = notifications.map(n => {
      const parsed = JSON.parse(n);
      parsed.read = true;
      return JSON.stringify(parsed);
    });
    
    await redis.del(key);
    if (updated.length > 0) {
      await redis.rpush(key, ...updated);
    }
    
    return true;
  } catch (err) {
    console.error('[Notification] Failed to mark all as read:', err.message);
    return false;
  }
}

/**
 * Get unread count
 */
async function getUnreadCount(userId) {
  try {
    const notifications = await getUserNotifications(userId, { unreadOnly: true });
    return notifications.length;
  } catch (err) {
    console.error('[Notification] Failed to get unread count:', err.message);
    return 0;
  }
}

/**
 * Clear old notifications
 */
async function clearOldNotifications(userId, daysOld = 7) {
  try {
    const redis = getRedis();
    const key = `notifications:user:${userId}`;
    
    const notifications = await redis.lrange(key, 0, -1);
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    
    const filtered = notifications.filter(n => {
      const parsed = JSON.parse(n);
      return new Date(parsed.createdAt) > cutoffDate;
    });
    
    await redis.del(key);
    if (filtered.length > 0) {
      await redis.rpush(key, ...filtered);
    }
    
    return notifications.length - filtered.length;
  } catch (err) {
    console.error('[Notification] Failed to clear old notifications:', err.message);
    return 0;
  }
}

/**
 * Helper: Notify on critical violation
 */
async function notifyCriticalViolation(agentId, violationType, severity) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  
  return createNotification({
    type: NOTIFICATION_TYPES.CRITICAL_VIOLATION,
    title: `Critical Violation Detected`,
    message: `Agent "${agent?.name || agentId}" triggered a ${severity} ${violationType} violation`,
    priority: PRIORITY.CRITICAL,
    metadata: { agentId, violationType, severity },
    actionUrl: `/audit?agent_id=${agentId}&violation_type=${violationType}`,
  });
}

/**
 * Helper: Notify on agent health degradation
 */
async function notifyAgentHealthDegraded(agentId, errorRate, status) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  
  return createNotification({
    type: NOTIFICATION_TYPES.AGENT_HEALTH_DEGRADED,
    title: `Agent Health Degraded`,
    message: `Agent "${agent?.name || agentId}" health is ${status} (${(errorRate * 100).toFixed(1)}% error rate)`,
    priority: status === 'critical' ? PRIORITY.CRITICAL : PRIORITY.HIGH,
    metadata: { agentId, errorRate, status },
    actionUrl: `/agents/${agentId}`,
  });
}

/**
 * Helper: Notify on red-team test failure
 */
async function notifyRedTeamFailed(runId, agentId, passRate) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  
  return createNotification({
    type: NOTIFICATION_TYPES.REDTEAM_FAILED,
    title: `Red-Team Test Failed`,
    message: `Agent "${agent?.name || agentId}" failed red-team assessment (${passRate.toFixed(1)}% pass rate)`,
    priority: passRate < 50 ? PRIORITY.CRITICAL : PRIORITY.HIGH,
    metadata: { runId, agentId, passRate },
    actionUrl: `/redteam/runs/${runId}`,
  });
}

module.exports = {
  NOTIFICATION_TYPES,
  PRIORITY,
  createNotification,
  getUserNotifications,
  getGlobalNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  clearOldNotifications,
  notifyCriticalViolation,
  notifyAgentHealthDegraded,
  notifyRedTeamFailed,
};

// Made with Bob
