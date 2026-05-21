const {
  getActiveAppAnnouncement,
  publishAppAnnouncement,
  clearActiveAppAnnouncement,
  listAppAnnouncementsAdmin,
  isMissingTableError,
} = require('./db');

function toPublicAnnouncement(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
  };
}

function registerAnnouncementRoutes(app, { adminAuthMiddleware } = {}) {
  const schemaMsg = 'Announcements schema missing. Run backend/sql/migrations/20260602_app_announcements.sql';

  app.get('/announcement/active', async (_req, res) => {
    try {
      const row = await getActiveAppAnnouncement();
      return res.json({ announcement: toPublicAnnouncement(row) });
    } catch (e) {
      if (isMissingTableError(e) || isSchemaMissing(e)) {
        return res.json({ announcement: null });
      }
      console.error('[announcement/active]', e);
      return res.status(500).json({ message: 'Failed to load announcement' });
    }
  });

  if (!adminAuthMiddleware) return;

  app.get('/admin/api/announcements', adminAuthMiddleware, async (_req, res) => {
    try {
      const rows = await listAppAnnouncementsAdmin(30);
      return res.json({
        active: toPublicAnnouncement(rows.find((r) => r.active) || null),
        history: rows.map(toPublicAnnouncement),
      });
    } catch (e) {
      if (isMissingTableError(e) || isSchemaMissing(e)) {
        return res.status(503).json({ message: schemaMsg });
      }
      return res.status(500).json({ message: e.message || 'Failed to load announcements' });
    }
  });

  app.post('/admin/api/announcements', adminAuthMiddleware, async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim();
      const body = String(req.body?.body || '').trim();
      if (!title || !body) {
        return res.status(400).json({ message: 'title and body are required' });
      }
      const row = await publishAppAnnouncement({ title, body });
      return res.status(201).json({ announcement: toPublicAnnouncement(row) });
    } catch (e) {
      if (isMissingTableError(e) || isSchemaMissing(e)) {
        return res.status(503).json({ message: schemaMsg });
      }
      return res.status(500).json({ message: e.message || 'Failed to publish announcement' });
    }
  });

  app.delete('/admin/api/announcements/active', adminAuthMiddleware, async (_req, res) => {
    try {
      await clearActiveAppAnnouncement();
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ message: e.message || 'Failed to clear announcement' });
    }
  });
}

function isSchemaMissing(e) {
  const msg = String(e?.message || e?.details || '');
  return /app_announcements/i.test(msg) && /does not exist|Could not find/i.test(msg);
}

module.exports = { registerAnnouncementRoutes };
