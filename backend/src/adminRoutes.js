const jwt = require('jsonwebtoken');
const {
  listScheduledAirfarmingDropsAdmin,
  getAirfarmingDropById,
  updateAirfarmingDrop,
  getUsersByIds,
  isMissingTableError,
} = require('./db');
const { adminAuthMiddleware, ADMIN_PURPOSE } = require('./middleware/adminAuth');
const { clampAirfarmingPercent, MAX_AIRFARMING_PERCENT } = require('./airfarmingDrops');

function adminCredentials() {
  return {
    username: String(process.env.ADMIN_USERNAME || 'admin').trim(),
    password: String(process.env.ADMIN_PASSWORD || 'admin'),
  };
}

function dropToAdminRow(row, emailByUserId) {
  const dueMs = new Date(row.due_at).getTime();
  const secondsRemaining = Math.max(0, Math.floor((dueMs - Date.now()) / 1000));
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: emailByUserId.get(row.user_id) || '—',
    weekStart: row.week_start,
    dropIndex: Number(row.drop_index),
    dueAt: row.due_at,
    secondsRemaining,
    percent: Number(row.percent),
    minBalance: Number(row.min_balance),
    maxBalance: Number(row.max_balance),
    bandIndex: row.band_index != null ? Number(row.band_index) : null,
    percentLocked: Boolean(row.percent_locked),
    status: row.status,
  };
}

function validateDropPatch(body) {
  const patch = {};
  if (body.percent !== undefined) {
    const p = Number(body.percent);
    if (!Number.isFinite(p) || p < 0.01 || p > MAX_AIRFARMING_PERCENT) {
      return { error: `Percent must be between 0.01 and ${MAX_AIRFARMING_PERCENT}` };
    }
    patch.percent = clampAirfarmingPercent(p);
    patch.percent_locked = true;
  }
  if (body.minBalance !== undefined) {
    const n = Number(body.minBalance);
    if (!Number.isFinite(n) || n < 0) return { error: 'minBalance must be >= 0' };
    patch.min_balance = Math.round(n * 100) / 100;
  }
  if (body.maxBalance !== undefined) {
    const n = Number(body.maxBalance);
    if (!Number.isFinite(n) || n < 0) return { error: 'maxBalance must be >= 0' };
    patch.max_balance = Math.round(n * 100) / 100;
  }
  if (body.dueAt !== undefined) {
    const t = new Date(body.dueAt).getTime();
    if (!Number.isFinite(t)) return { error: 'dueAt must be a valid date/time' };
    patch.due_at = new Date(t).toISOString();
  }
  if (body.percentLocked !== undefined) {
    patch.percent_locked = Boolean(body.percentLocked);
  }
  if (Object.keys(patch).length === 0) {
    return { error: 'No valid fields to update' };
  }
  return { patch };
}

function registerAdminRoutes(app) {
  app.post('/admin/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const creds = adminCredentials();
    if (String(username || '').trim() !== creds.username || String(password || '') !== creds.password) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }
    const token = jwt.sign(
      { purpose: ADMIN_PURPOSE, sub: creds.username },
      process.env.JWT_SECRET || 'ema-dev-secret',
      { expiresIn: '12h' }
    );
    return res.json({ token, expiresInHours: 12 });
  });

  app.get('/admin/api/me', adminAuthMiddleware, (req, res) => {
    return res.json({ username: req.adminUser });
  });

  app.get('/admin/api/airfarming/drops', adminAuthMiddleware, async (req, res) => {
    try {
      const upcomingOnly = String(req.query.upcoming || '1') !== '0';
      const rows = await listScheduledAirfarmingDropsAdmin({ upcomingOnly, limit: 500 });
      const users = await getUsersByIds(rows.map((r) => r.user_id));
      const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
      const drops = rows.map((r) => dropToAdminRow(r, emailByUserId));
      return res.json({ drops, count: drops.length, maxPercent: MAX_AIRFARMING_PERCENT });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Airfarming drops schema not ready. Run Supabase migrations.' });
      }
      console.error('[admin/airfarming/drops]', e);
      return res.status(500).json({ message: 'Failed to load drops' });
    }
  });

  app.patch('/admin/api/airfarming/drops/:id', adminAuthMiddleware, async (req, res) => {
    try {
      const existing = await getAirfarmingDropById(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Drop not found' });
      if (existing.status !== 'scheduled') {
        return res.status(400).json({ message: 'Only scheduled drops can be edited' });
      }

      const { patch, error } = validateDropPatch(req.body || {});
      if (error) return res.status(400).json({ message: error });

      const minBal = patch.min_balance != null ? patch.min_balance : Number(existing.min_balance);
      const maxBal = patch.max_balance != null ? patch.max_balance : Number(existing.max_balance);
      if (maxBal < minBal) {
        return res.status(400).json({ message: 'maxBalance must be >= minBalance' });
      }

      const updated = await updateAirfarmingDrop(existing.id, patch);
      const users = await getUsersByIds([updated.user_id]);
      const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
      return res.json({ drop: dropToAdminRow(updated, emailByUserId) });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Airfarming drops schema not ready.' });
      }
      console.error('[admin/airfarming/drops/patch]', e);
      return res.status(500).json({ message: 'Failed to update drop' });
    }
  });
}

module.exports = { registerAdminRoutes };
