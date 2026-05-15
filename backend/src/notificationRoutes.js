const { listNotificationsForUser, createAppNotification, isMissingTableError } = require('./db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** NULL = broadcast; invalid id also treated as broadcast. */
function normalizeTargetUserId(raw) {
  if (raw == null || raw === '') return null;
  const id = String(raw).trim();
  return UUID_RE.test(id) ? id : null;
}

function toPublicNotification(row) {
  return {
    id: row.id,
    userId: row.user_id || null,
    audience: row.user_id ? 'user' : 'broadcast',
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
  };
}

function registerNotificationRoutes(app, { authMiddleware }) {
  const schemaMsg = 'Notifications schema missing. Run backend/sql/migrations/20260518_app_notifications.sql in Supabase.';

  app.get('/notifications', authMiddleware, async (req, res) => {
    try {
      const rows = await listNotificationsForUser(req.userId, 100);
      return res.json({
        notifications: rows.map(toPublicNotification),
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to load notifications' });
    }
  });

  /** Create notification (admin/dev). Broadcast if userId missing or not a valid UUID. */
  app.post('/notifications', authMiddleware, async (req, res) => {
    try {
      const adminToken = process.env.NOTIFICATIONS_ADMIN_TOKEN || process.env.DEV_RESET_TOKEN;
      const provided = req.headers['x-admin-token'] || req.body?.adminToken;
      if (!adminToken || provided !== adminToken) {
        return res.status(403).json({ message: 'Admin token required to create notifications' });
      }

      const title = String(req.body?.title || '').trim();
      const body = String(req.body?.body || '').trim();
      if (!title || !body) {
        return res.status(400).json({ message: 'title and body are required' });
      }

      const userId = normalizeTargetUserId(req.body?.userId ?? req.body?.user_id);
      const row = await createAppNotification({ userId, title, body });
      return res.status(201).json({ notification: toPublicNotification(row) });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to create notification' });
    }
  });
}

module.exports = { registerNotificationRoutes, normalizeTargetUserId };
