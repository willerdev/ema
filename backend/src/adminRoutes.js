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
  adminAdjustUserWallet,
  listSupportTicketsAdmin,
  getSupportTicketById,
  updateSupportTicketStatus,
  getActiveGlobalDropPauses,
  listGlobalDropPauses,
  insertGlobalDropPause,
  endGlobalDropPauseEarly,
  isMissingTableError,
  listAirfarmingDropBandsAdmin,
  updateAirfarmingDropBand,
  getAirfarmingPlatformSettings,
  updateAirfarmingPlatformSettings,
  listPendingWithdrawalsAdmin,
  createAppNotification,
  getUserByEmail,
} = require('./db');
const { normalizeTargetUserId } = require('./notificationRoutes');
const { approveWithdrawal, rejectWithdrawal } = require('./adminWithdrawals');
const { adminAuthMiddleware, ADMIN_PURPOSE } = require('./middleware/adminAuth');
const {
  clampAirfarmingPercent,
  MAX_AIRFARMING_PERCENT,
  clearAirfarmingSettingsCache,
  getEffectiveCaps,
} = require('./airfarmingDrops');
const { parsePauseRange, pauseStatusFromState } = require('./airfarmingPause');
const { registerAdminAiRoutes } = require('./adminAiRoutes');
const { getJournalMonth, getJournalDay } = require('./journalService');
const {
  getUserDropScheduleView,
  saveUserDropScheduleDraft,
  aiSuggestUserDropSchedule,
  applyUserDropSchedule,
} = require('./userDropScheduleService');

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

function bandToAdminRow(row) {
  return {
    bandIndex: Number(row.band_index),
    label: row.label,
    balanceHint: row.balance_hint,
    percent: Number(row.percent),
    minBalance: Number(row.min_balance ?? 0),
    maxBalance: Number(row.max_balance ?? 0),
    active: Boolean(row.active),
    updatedAt: row.updated_at,
  };
}

function settingsToAdminRow(row) {
  return {
    maxPercent: Number(row.max_percent),
    maxProfitPerDrop: Number(row.max_profit_per_drop),
    updatedAt: row.updated_at,
  };
}

async function validateDropPatch(body) {
  const caps = await getEffectiveCaps();
  const maxPct = caps.maxPercent;
  const patch = {};
  if (body.percent !== undefined) {
    const p = Number(body.percent);
    if (!Number.isFinite(p) || p < 0.01 || p > maxPct) {
      return { error: `Percent must be between 0.01 and ${maxPct}` };
    }
    patch.percent = clampAirfarmingPercent(p, maxPct);
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
  registerAdminAiRoutes(app);
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

  app.get('/admin/api/users/:id/journal/month', adminAuthMiddleware, async (req, res) => {
    try {
      const user = await getUserById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
      const now = new Date();
      const year = Number(req.query.year) || now.getUTCFullYear();
      const month = Number(req.query.month) || now.getUTCMonth() + 1;
      if (month < 1 || month > 12) return res.status(400).json({ message: 'Invalid month' });
      const data = await getJournalMonth(req.params.id, year, month);
      return res.json(data);
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Journal schema not ready.' });
      }
      return res.status(500).json({ message: e.message || 'Failed to load journal' });
    }
  });

  app.get('/admin/api/users/:id/journal/day', adminAuthMiddleware, async (req, res) => {
    try {
      const user = await getUserById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
      const date = String(req.query.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: 'date query required (YYYY-MM-DD)' });
      }
      const data = await getJournalDay(req.params.id, date);
      return res.json(data);
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Journal schema not ready.' });
      }
      return res.status(500).json({ message: e.message || 'Failed to load journal day' });
    }
  });

  const dropScheduleSchemaMsg =
    'User drop schedules schema missing. Run backend/sql/migrations/20260606_user_drop_schedules.sql in Supabase.';

  app.get('/admin/api/users/:id/drop-schedule', adminAuthMiddleware, async (req, res) => {
    try {
      const weekStart = req.query.weekStart ? String(req.query.weekStart).slice(0, 10) : undefined;
      const view = await getUserDropScheduleView(req.params.id, weekStart);
      if (!view) return res.status(404).json({ message: 'User not found' });
      return res.json(view);
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: dropScheduleSchemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to load drop schedule' });
    }
  });

  app.post('/admin/api/users/:id/drop-schedule', adminAuthMiddleware, async (req, res) => {
    try {
      const dropCount = Number(req.body?.dropCount);
      const targetTotalUsd = Number(req.body?.targetTotalUsd);
      const weekStart = req.body?.weekStart ? String(req.body.weekStart).slice(0, 10) : undefined;
      if (!Number.isInteger(dropCount) || dropCount < 1 || dropCount > 12) {
        return res.status(400).json({ message: 'dropCount must be 1–12' });
      }
      if (!Number.isFinite(targetTotalUsd) || targetTotalUsd < 0) {
        return res.status(400).json({ message: 'targetTotalUsd must be a non-negative number' });
      }
      const result = await saveUserDropScheduleDraft(req.params.id, { weekStart, dropCount, targetTotalUsd });
      if (!result.ok) return res.status(400).json({ message: result.error });
      return res.json(result);
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: dropScheduleSchemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to save drop schedule' });
    }
  });

  app.post('/admin/api/users/:id/drop-schedule/ai-suggest', adminAuthMiddleware, async (req, res) => {
    try {
      const dropCount = Number(req.body?.dropCount);
      const targetTotalUsd = Number(req.body?.targetTotalUsd);
      const weekStart = req.body?.weekStart ? String(req.body.weekStart).slice(0, 10) : undefined;
      if (!Number.isInteger(dropCount) || dropCount < 1 || dropCount > 12) {
        return res.status(400).json({ message: 'dropCount must be 1–12' });
      }
      if (!Number.isFinite(targetTotalUsd) || targetTotalUsd < 0) {
        return res.status(400).json({ message: 'targetTotalUsd must be a non-negative number' });
      }
      const result = await aiSuggestUserDropSchedule(req.params.id, { weekStart, dropCount, targetTotalUsd });
      if (!result.ok) return res.status(400).json({ message: result.error });
      return res.json(result);
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: dropScheduleSchemaMsg });
      console.error('[admin/drop-schedule/ai-suggest]', e);
      return res.status(500).json({ message: e.message || 'AI suggest failed' });
    }
  });

  app.post('/admin/api/users/:id/drop-schedule/apply', adminAuthMiddleware, async (req, res) => {
    try {
      const weekStart = req.body?.weekStart ? String(req.body.weekStart).slice(0, 10) : undefined;
      const result = await applyUserDropSchedule(req.params.id, { weekStart });
      if (!result.ok) return res.status(400).json({ message: result.error });
      return res.json(result);
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: dropScheduleSchemaMsg });
      console.error('[admin/drop-schedule/apply]', e);
      return res.status(500).json({ message: e.message || 'Apply failed' });
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

  app.post('/admin/api/users/:id/wallets/adjust', adminAuthMiddleware, async (req, res) => {
    try {
      const detail = await getAdminUserDetail(req.params.id);
      if (!detail) return res.status(404).json({ message: 'User not found' });

      const wallet = String(req.body?.wallet || '').toLowerCase();
      const mode = req.body?.mode === 'adjust' ? 'adjust' : 'set';
      const direction = req.body?.direction === 'remove' ? 'remove' : 'add';
      let amount = Number(req.body?.amount);
      if (mode === 'adjust' && Number.isFinite(amount)) {
        amount = Math.abs(amount);
        if (direction === 'remove') amount = -amount;
      }
      const reason = String(req.body?.reason || req.body?.note || '').trim();

      const result = await adminAdjustUserWallet(req.params.id, {
        wallet,
        mode,
        amount,
        reason,
      });

      const updated = await getAdminUserDetail(req.params.id);
      return res.json({
        ok: true,
        adjustment: result,
        cashBalance: updated.cashBalance,
        airfarmingBalance: updated.airfarmingBalance,
        usdtBalance: updated.usdtBalance,
        user: updated.user,
      });
    } catch (e) {
      if (e.statusCode === 400) return res.status(400).json({ message: e.message });
      if (isMissingTableError(e)) {
        return res.status(503).json({ message: 'Wallet schema not ready. Run migrations.' });
      }
      console.error('[admin/users/wallets/adjust]', e);
      return res.status(500).json({ message: e.message || 'Failed to adjust balance' });
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

  app.get('/admin/api/airfarming/settings', adminAuthMiddleware, async (_req, res) => {
    try {
      const [settings, bands] = await Promise.all([
        getAirfarmingPlatformSettings(),
        listAirfarmingDropBandsAdmin(),
      ]);
      const caps = await getEffectiveCaps();
      return res.json({
        settings: settingsToAdminRow(settings),
        bands: bands.map(bandToAdminRow),
        defaults: { maxPercent: MAX_AIRFARMING_PERCENT, maxProfitPerDrop: 5000 },
        effectiveCaps: caps,
      });
    } catch (e) {
      console.error('[admin/airfarming/settings GET]', e);
      return res.status(500).json({ message: e.message || 'Failed to load drop settings' });
    }
  });

  app.patch('/admin/api/airfarming/settings', adminAuthMiddleware, async (req, res) => {
    try {
      const body = req.body || {};
      const maxPercent = body.maxPercent !== undefined ? Number(body.maxPercent) : undefined;
      const maxProfitPerDrop =
        body.maxProfitPerDrop !== undefined ? Number(body.maxProfitPerDrop) : undefined;

      if (maxPercent !== undefined) {
        if (!Number.isFinite(maxPercent) || maxPercent < 0.01 || maxPercent > 100) {
          return res.status(400).json({ message: 'maxPercent must be between 0.01 and 100' });
        }
      }
      if (maxProfitPerDrop !== undefined) {
        if (!Number.isFinite(maxProfitPerDrop) || maxProfitPerDrop <= 0) {
          return res.status(400).json({ message: 'maxProfitPerDrop must be greater than 0' });
        }
      }

      const settings = await updateAirfarmingPlatformSettings({
        maxPercent: maxPercent !== undefined ? Math.round(maxPercent * 100) / 100 : undefined,
        maxProfitPerDrop:
          maxProfitPerDrop !== undefined ? Math.round(maxProfitPerDrop * 100) / 100 : undefined,
      });
      clearAirfarmingSettingsCache();
      return res.json({ settings: settingsToAdminRow(settings) });
    } catch (e) {
      console.error('[admin/airfarming/settings PATCH]', e);
      return res.status(500).json({ message: e.message || 'Failed to save platform caps' });
    }
  });

  app.patch('/admin/api/airfarming/bands/:index', adminAuthMiddleware, async (req, res) => {
    try {
      const bandIndex = Number(req.params.index);
      if (!Number.isInteger(bandIndex) || bandIndex < 0 || bandIndex > 3) {
        return res.status(400).json({ message: 'band index must be 0–3' });
      }
      const body = req.body || {};
      const caps = await getEffectiveCaps();
      const patch = {};

      if (body.percent !== undefined) {
        const p = Number(body.percent);
        if (!Number.isFinite(p) || p < 0.01 || p > caps.maxPercent) {
          return res.status(400).json({ message: `percent must be between 0.01 and ${caps.maxPercent}` });
        }
        patch.percent = clampAirfarmingPercent(p, caps.maxPercent);
      }
      if (body.minBalance !== undefined) {
        const n = Number(body.minBalance);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: 'minBalance must be >= 0' });
        patch.minBalance = Math.round(n * 100) / 100;
      }
      if (body.maxBalance !== undefined) {
        const n = Number(body.maxBalance);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: 'maxBalance must be >= 0' });
        patch.maxBalance = Math.round(n * 100) / 100;
      }
      if (body.label !== undefined) patch.label = body.label;
      if (body.balanceHint !== undefined) patch.balanceHint = body.balanceHint;
      if (body.active !== undefined) patch.active = body.active;

      if (patch.minBalance != null && patch.maxBalance != null && patch.maxBalance < patch.minBalance) {
        return res.status(400).json({ message: 'maxBalance must be >= minBalance' });
      }

      const existing = (await listAirfarmingDropBandsAdmin()).find((b) => Number(b.band_index) === bandIndex);
      if (!existing) return res.status(404).json({ message: 'Band not found' });

      const minBal =
        patch.minBalance != null ? patch.minBalance : Number(existing.min_balance ?? existing.min ?? 0);
      const maxBal =
        patch.maxBalance != null ? patch.maxBalance : Number(existing.max_balance ?? existing.max ?? 0);
      if (Number.isFinite(minBal) && Number.isFinite(maxBal) && maxBal < minBal) {
        return res.status(400).json({ message: 'maxBalance must be >= minBalance' });
      }

      if (!Object.keys(patch).length) {
        return res.status(400).json({ message: 'No valid fields to update' });
      }

      const updated = await updateAirfarmingDropBand(bandIndex, patch);
      clearAirfarmingSettingsCache();
      return res.json({ band: bandToAdminRow(updated) });
    } catch (e) {
      console.error('[admin/airfarming/bands PATCH]', e);
      return res.status(500).json({ message: e.message || 'Failed to update band' });
    }
  });

  app.get('/admin/api/withdrawals/pending', adminAuthMiddleware, async (req, res) => {
    try {
      const withdrawals = await listPendingWithdrawalsAdmin({
        limit: Number(req.query.limit) || 200,
      });
      return res.json({ withdrawals, count: withdrawals.length });
    } catch (e) {
      console.error('[admin/withdrawals/pending]', e);
      return res.status(500).json({ message: e.message || 'Failed to load pending withdrawals' });
    }
  });

  app.post('/admin/api/withdrawals/:source/:id/approve', adminAuthMiddleware, async (req, res) => {
    try {
      const result = await approveWithdrawal({
        source: req.params.source,
        id: req.params.id,
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[admin/withdrawals/approve]', e);
      return res.status(status).json({ message: e.message || 'Failed to approve withdrawal' });
    }
  });

  app.post('/admin/api/withdrawals/:source/:id/reject', adminAuthMiddleware, async (req, res) => {
    try {
      const result = await rejectWithdrawal({
        source: req.params.source,
        id: req.params.id,
        note: req.body?.note,
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[admin/withdrawals/reject]', e);
      return res.status(status).json({ message: e.message || 'Failed to reject withdrawal' });
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
      const caps = await getEffectiveCaps();
      return res.json({ drops, count: drops.length, maxPercent: caps.maxPercent, schemaNote });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.json({
          drops: [],
          count: 0,
          maxPercent: MAX_AIRFARMING_PERCENT,
          maxProfitPerDrop: 5000,
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

      const { patch, error } = await validateDropPatch(req.body || {});
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

  const notificationsSchemaMsg =
    'Notifications schema missing. Run backend/sql/migrations/20260518_app_notifications.sql in Supabase.';

  function notificationToAdmin(row) {
    return {
      id: row.id,
      userId: row.user_id || null,
      audience: row.user_id ? 'user' : 'broadcast',
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
    };
  }

  app.post('/admin/api/notifications', adminAuthMiddleware, async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim();
      const body = String(req.body?.body || '').trim();
      if (!title || !body) {
        return res.status(400).json({ message: 'title and body are required' });
      }

      const broadcast = Boolean(req.body?.broadcast);
      let userId = null;
      if (!broadcast) {
        userId = normalizeTargetUserId(req.body?.userId ?? req.body?.user_id);
        const email = String(req.body?.userEmail || req.body?.email || '')
          .trim()
          .toLowerCase();
        if (!userId && email) {
          const user = await getUserByEmail(email);
          if (!user) return res.status(404).json({ message: 'User not found for that email' });
          userId = user.id;
        }
        if (!userId) {
          return res.status(400).json({
            message: 'Provide userEmail or userId, or set broadcast to send to all users',
          });
        }
      }

      const row = await createAppNotification({ userId, title, body });
      return res.status(201).json({ notification: notificationToAdmin(row) });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: notificationsSchemaMsg });
      console.error('[admin/notifications]', e);
      return res.status(500).json({ message: e.message || 'Failed to send notification' });
    }
  });
}

module.exports = { registerAdminRoutes };
