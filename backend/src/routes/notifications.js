/**
 * Notifications Routes
 * GET    /notifications           - Get user notifications
 * GET    /notifications/unread    - Get unread count
 * POST   /notifications/:id/read  - Mark as read
 * POST   /notifications/read-all  - Mark all as read
 * DELETE /notifications/old       - Clear old notifications
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getUserNotifications,
  getGlobalNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  clearOldNotifications,
} = require('../services/NotificationService');

const router = express.Router();

// GET /notifications - Get user notifications
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { limit = 20, unread_only = false, global = false } = req.query;
    
    let notifications;
    if (global === 'true') {
      notifications = await getGlobalNotifications({ limit: parseInt(limit) });
    } else {
      notifications = await getUserNotifications(req.user.id, {
        limit: parseInt(limit),
        unreadOnly: unread_only === 'true',
      });
    }
    
    res.json({ notifications, count: notifications.length });
  } catch (err) {
    next(err);
  }
});

// GET /notifications/unread - Get unread count
router.get('/unread', requireAuth, async (req, res, next) => {
  try {
    const count = await getUnreadCount(req.user.id);
    res.json({ unread_count: count });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/:id/read - Mark notification as read
router.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const success = await markAsRead(req.user.id, req.params.id);
    res.json({ success, message: success ? 'Marked as read' : 'Failed to mark as read' });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/read-all - Mark all as read
router.post('/read-all', requireAuth, async (req, res, next) => {
  try {
    const success = await markAllAsRead(req.user.id);
    res.json({ success, message: success ? 'All marked as read' : 'Failed to mark all as read' });
  } catch (err) {
    next(err);
  }
});

// DELETE /notifications/old - Clear old notifications
router.delete('/old', requireAuth, async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const cleared = await clearOldNotifications(req.user.id, parseInt(days));
    res.json({ cleared, message: `Cleared ${cleared} old notifications` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// Made with Bob
