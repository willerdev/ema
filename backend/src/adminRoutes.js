const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const {
  listScheduledAirfarmingDropsAdmin,
  getAirfarmingDropById,
  updateAirfarmingDrop,
  getUsersByIds,
  getUserById,
  updateUserPasswordHash,
  listUsersAdmin,
  getAdminUserDetail,
  getAdminUserChartSeries,
  updateAirfarmingUserDropPause,
  getAirfarmingDropsPausedByUserIds,
  adminMoveCashToAirfarming,
  listSupportTicketsAdmin,
  getSupportTicketById,
  updateSupportTicketStatus,
  getActiveGlobalDropPauses,
  listGlobalDropPauses,
  insertGlobalDropPause,
  endGlobalDropPauseEarly,
  isMissingTableError,
} = require('./db');
const { adminAuthMiddleware, ADMIN_PURPOSE } = require('./middleware/adminAuth');
const { clampAirfarmingPercent, MAX_AIRFARMING_PERCENT } = require('./airfarmingDrops');
const { parsePauseRange, pauseStatusFromState } = require('./airfarmingPause');

const SUPPORT_STATUSES = new Set(['under_review', 'in_progress', 'resolved', 'closed']);

function ticketToAdminRow(row, emailByUserId) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: emailByUserId.get(row.user_id) || '—',
    category: row.category,
    status: row.status,
    payload: row.payload || {},
    relatedActivityId: row.related_activity_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function adminCredentials() {
  return {
    username: String(process.env.ADMIN_USERNAME || 'admin').trim(),
    password: String(process.env.ADMIN_PASSWORD || 'admin'),
  };
}

function dropToAdminRow(row, emailByUserId, pausedByUserId) {
  const dueMs = new Date(row.due_at).getTime();
  const secondsRemaining = Math.max(0, Math.floor((dueMs - Date.now()) / 1000));
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: emailByUserId.get(row.user_id) || '—',
    dropsPaused: Boolean(pausedByUserId?.get(row.user_id)),
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

  app.get('/admin/api/users', adminAuthMiddleware, async (req, res) => {
    try {
      const search = String(req.query.q || req.query.search || '').trim();
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const users = await listUsersAdmin({ limit, search });
      return res.json({ users, count: users.length });
    } catch (e) {
      console.error('[admin/users]', e);
      return res.status(500).json({ message: e.message || 'Failed to load users' });
    }
  });

  app.get('/admin/api/users/:id', adminAuthMiddleware, async (req, res) => {
    try {
      const detail = await getAdminUserDetail(req.params.id);
      if (!detail) return res.status(404).json({ message: 'User not found' });
      return res.json(detail);
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Database schema not ready. Run Supabase migrations.' });
      }
      console.error('[admin/users/:id]', e);
      return res.status(500).json({ message: 'Failed to load user' });
    }
  });

  app.get('/admin/api/users/:id/charts', adminAuthMiddleware, async (req, res) => {
    try {
      const user = await getUserById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
      const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
      const series = await getAdminUserChartSeries(req.params.id, days);
      return res.json(series);
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Database schema not ready. Run Supabase migrations.' });
      }
      console.error('[admin/users/:id/charts]', e);
      return res.status(500).json({ message: e.message || 'Failed to load charts' });
    }
  });

  app.post('/admin/api/users/:id/password', adminAuthMiddleware, async (req, res) => {
    try {
      const user = await getUserById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const password = String(req.body?.password || '');
      const confirm = String(req.body?.confirmPassword || req.body?.passwordConfirm || '');
      if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }
      if (confirm && password !== confirm) {
        return res.status(400).json({ message: 'Passwords do not match' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await updateUserPasswordHash(user.id, passwordHash);
      return res.json({ ok: true, message: 'Password updated for ' + user.email });
    } catch (e) {
      console.error('[admin/users/password]', e);
      return res.status(500).json({ message: e.message || 'Failed to update password' });
    }
  });

  app.post('/admin/api/users/:id/wallets/move-to-airfarming', adminAuthMiddleware, async (req, res) => {
    try {
      const detail = await getAdminUserDetail(req.params.id);
      if (!detail) return res.status(404).json({ message: 'User not found' });
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Valid amount is required' });
      }
      const result = await adminMoveCashToAirfarming(req.params.id, amount);
      return res.json({
        userId: req.params.id,
        amount: result.amount,
        cashBalance: result.cashWallet,
        airfarmingBalance: result.airfarmingBalance,
      });
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Wallet schema not ready. Run migrations.' });
      }
      console.error('[admin/users/move-to-airfarming]', e);
      return res.status(500).json({ message: 'Failed to move funds' });
    }
  });

  app.patch('/admin/api/users/:id/airfarming', adminAuthMiddleware, async (req, res) => {
    try {
      const detail = await getAdminUserDetail(req.params.id);
      if (!detail) return res.status(404).json({ message: 'User not found' });

      let state;
      if (req.body?.clearPause) {
        state = await updateAirfarmingUserDropPause(req.params.id, { clearPause: true });
      } else if (req.body?.dropsPaused !== undefined && !req.body?.pauseFrom && !req.body?.pauseUntil) {
        const pause = Boolean(req.body.dropsPaused);
        state = pause
          ? await updateAirfarmingUserDropPause(req.params.id, { indefinitePause: true })
          : await updateAirfarmingUserDropPause(req.params.id, { clearPause: true });
      } else if (
        req.body?.pauseFrom !== undefined ||
        req.body?.pauseUntil !== undefined ||
        req.body?.bandIndexes !== undefined
      ) {
        const range = parsePauseRange(req.body);
        if (range.error) return res.status(400).json({ message: range.error });
        state = await updateAirfarmingUserDropPause(req.params.id, {
          pauseFrom: range.pauseFrom,
          pauseUntil: range.pauseUntil,
          bandIndexes: req.body.bandIndexes,
          indefinitePause: false,
        });
      } else {
        return res.status(400).json({
          message:
            'Send clearPause, dropsPaused (indefinite), or pauseFrom/pauseUntil with optional bandIndexes (0–3)',
        });
      }

      const pause = pauseStatusFromState(state);
      return res.json({
        userId: req.params.id,
        ...pause,
      });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Airfarming schema not ready. Run migrations.' });
      }
      console.error('[admin/users/airfarming]', e);
      return res.status(500).json({ message: e.message || 'Failed to update airfarming settings' });
    }
  });

  app.get('/admin/api/airfarming/global-pause', adminAuthMiddleware, async (req, res) => {
    try {
      const active = await getActiveGlobalDropPauses();
      const recent = await listGlobalDropPauses({ limit: 15 });
      const mapRow = (r) => ({
        id: r.id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        bandIndexes: r.band_indexes || [],
        note: r.note || null,
        createdAt: r.created_at,
        activeNow: active.some((a) => a.id === r.id),
      });
      return res.json({
        active: active.map(mapRow),
        recent: recent.map(mapRow),
      });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({
          message: 'Run migration 20260601_airfarming_scheduled_pauses.sql in Supabase.',
        });
      }
      console.error('[admin/global-pause]', e);
      return res.status(500).json({ message: e.message || 'Failed to load global pause' });
    }
  });

  app.post('/admin/api/airfarming/global-pause', adminAuthMiddleware, async (req, res) => {
    try {
      const range = parsePauseRange({
        pauseFrom: req.body?.startsAt,
        pauseUntil: req.body?.endsAt,
      });
      if (range.error) return res.status(400).json({ message: range.error });
      if (!range.pauseFrom || !range.pauseUntil) {
        return res.status(400).json({ message: 'startsAt and endsAt are required' });
      }
      const row = await insertGlobalDropPause({
        startsAt: range.pauseFrom,
        endsAt: range.pauseUntil,
        bandIndexes: req.body?.bandIndexes,
        note: req.body?.note,
      });
      return res.status(201).json({
        pause: {
          id: row.id,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          bandIndexes: row.band_indexes || [],
          note: row.note || null,
        },
      });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Global pause table missing. Run migrations.' });
      }
      console.error('[admin/global-pause/post]', e);
      return res.status(500).json({ message: e.message || 'Failed to create global pause' });
    }
  });

  app.post('/admin/api/airfarming/global-pause/:id/end', adminAuthMiddleware, async (req, res) => {
    try {
      const row = await endGlobalDropPauseEarly(req.params.id);
      if (!row) return res.status(404).json({ message: 'Pause not found or already ended' });
      return res.json({
        pause: {
          id: row.id,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          bandIndexes: row.band_indexes || [],
        },
      });
    } catch (e) {
      console.error('[admin/global-pause/end]', e);
      return res.status(500).json({ message: e.message || 'Failed to end global pause' });
    }
  });

  app.get('/admin/api/support/tickets', adminAuthMiddleware, async (req, res) => {
    try {
      const status = String(req.query.status || '').trim() || undefined;
      const category = String(req.query.category || '').trim() || undefined;
      const search = String(req.query.q || req.query.search || '').trim() || undefined;
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
      const rows = await listSupportTicketsAdmin({ limit, status, category, search });
      const users = await getUsersByIds(rows.map((r) => r.user_id));
      const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
      const tickets = rows.map((r) => ticketToAdminRow(r, emailByUserId));
      return res.json({ tickets, count: tickets.length });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.json({
          tickets: [],
          count: 0,
          schemaNote: 'Support tickets table missing. Run 20260524_support_tickets.sql in Supabase.',
        });
      }
      console.error('[admin/support/tickets]', e);
      return res.status(500).json({ message: e.message || 'Failed to load support tickets' });
    }
  });

  app.get('/admin/api/support/tickets/:id', adminAuthMiddleware, async (req, res) => {
    try {
      const row = await getSupportTicketById(req.params.id);
      if (!row) return res.status(404).json({ message: 'Ticket not found' });
      const users = await getUsersByIds([row.user_id]);
      const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
      return res.json({ ticket: ticketToAdminRow(row, emailByUserId) });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: 'Support schema not ready.' });
      console.error('[admin/support/tickets/:id]', e);
      return res.status(500).json({ message: 'Failed to load ticket' });
    }
  });

  app.patch('/admin/api/support/tickets/:id', adminAuthMiddleware, async (req, res) => {
    try {
      const existing = await getSupportTicketById(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Ticket not found' });
      const status = String(req.body?.status || '').trim();
      if (!SUPPORT_STATUSES.has(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      const updated = await updateSupportTicketStatus(existing.id, status);
      const users = await getUsersByIds([updated.user_id]);
      const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
      return res.json({ ticket: ticketToAdminRow(updated, emailByUserId) });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: 'Support schema not ready.' });
      console.error('[admin/support/tickets/patch]', e);
      return res.status(500).json({ message: 'Failed to update ticket' });
    }
  });

  app.get('/admin/api/airfarming/drops', adminAuthMiddleware, async (req, res) => {
    try {
      const upcomingOnly = String(req.query.upcoming || '1') !== '0';
      const rows = await listScheduledAirfarmingDropsAdmin({ upcomingOnly, limit: 500 });
      const userIds = rows.map((r) => r.user_id);
      const users = await getUsersByIds(userIds);
      const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
      const pausedByUserId = await getAirfarmingDropsPausedByUserIds(userIds);
      const drops = rows.map((r) => dropToAdminRow(r, emailByUserId, pausedByUserId));
      const schemaNote =
        rows.length === 0
          ? 'No scheduled drops. If you expect data, run airfarming migrations in Supabase.'
          : undefined;
      return res.json({ drops, count: drops.length, maxPercent: MAX_AIRFARMING_PERCENT, schemaNote });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.json({
          drops: [],
          count: 0,
          maxPercent: MAX_AIRFARMING_PERCENT,
          schemaNote: 'Airfarming drops table missing. Run backend/sql/migrations for airfarming_drops in Supabase.',
        });
      }
      console.error('[admin/airfarming/drops]', e);
      return res.status(500).json({ message: e.message || 'Failed to load drops' });
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
      const pausedByUserId = await getAirfarmingDropsPausedByUserIds([updated.user_id]);
      return res.json({ drop: dropToAdminRow(updated, emailByUserId, pausedByUserId) });
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
