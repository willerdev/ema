const crypto = require('crypto');
const {
  getAirfarmingStateByUserId,
  upsertAirfarmingState,
  insertAirfarmingEvent,
  listAirfarmingEventsByUserId,
  getAirfarmingWalletByUserId,
  upsertAirfarmingWalletRow,
  insertAirfarmingTransfer,
  ensureWalletForUser,
  setWalletBalance,
  isMissingTableError,
} = require('./db');

function newId() {
  return crypto.randomUUID();
}

function hash32(input) {
  let h = 2166136261;
  const s = String(input);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mondayUtcYmd(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const offset = (dow + 6) % 7; // Monday -> 0
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function ymdToUtcMs(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function buildFourOffsets(seed) {
  const set = new Set();
  let x = seed >>> 0;
  let guard = 0;
  while (set.size < 4 && guard < 50) {
    guard += 1;
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    const hr = 28 + (x % 120); // 28..147 hours from week start
    set.add(hr);
  }
  return [...set].sort((a, b) => a - b);
}

function weeklyTargetFromSeed(seed) {
  return 2 + (seed % 3); // 2..4
}

async function ensureWeekState(userId) {
  const weekYmd = mondayUtcYmd();
  let row = await getAirfarmingStateByUserId(userId);
  if (!row || row.week_start !== weekYmd) {
    const seed = hash32(`${userId}:${weekYmd}`);
    const weekly_event_target = weeklyTargetFromSeed(seed);
    const event_offsets_hours = buildFourOffsets(seed ^ 0x9e3779b9);
    row = await upsertAirfarmingState({
      user_id: userId,
      week_start: weekYmd,
      weekly_event_target,
      weekly_events_used: 0,
      event_offsets_hours,
      last_event_at: null,
      updated_at: new Date().toISOString(),
    });
  }
  return row;
}

async function maybeFireEvents(userId, row) {
  const weekStartMs = ymdToUtcMs(row.week_start);
  let rawOffsets = row.event_offsets_hours;
  if (typeof rawOffsets === 'string') {
    try {
      rawOffsets = JSON.parse(rawOffsets);
    } catch {
      rawOffsets = [];
    }
  }
  const offsets = Array.isArray(rawOffsets) ? rawOffsets.map(Number) : [];
  let used = Number(row.weekly_events_used || 0);
  const target = Number(row.weekly_event_target || 2);
  const now = Date.now();
  let lastAt = row.last_event_at;

  while (used < target && used < offsets.length) {
    const due = weekStartMs + offsets[used] * 3600 * 1000;
    if (now < due) break;
    const pct = 30 + (hash32(`${userId}:${row.week_start}:${used}:${lastAt || 0}`) % 471);
    await insertAirfarmingEvent({
      id: newId(),
      user_id: userId,
      percent: Number(pct.toFixed(2)),
    });
    used += 1;
    lastAt = new Date().toISOString();
  }

  if (used !== Number(row.weekly_events_used || 0) || lastAt !== row.last_event_at) {
    await upsertAirfarmingState({
      user_id: userId,
      week_start: row.week_start,
      weekly_event_target: row.weekly_event_target,
      weekly_events_used: used,
      event_offsets_hours: row.event_offsets_hours,
      last_event_at: lastAt,
      updated_at: new Date().toISOString(),
    });
    row = await getAirfarmingStateByUserId(userId);
  }
  return row;
}

function registerAirfarmingRoutes(app, { authMiddleware }) {
  const schemaMsg =
    'Airfarming schema missing. Run backend/sql/schema.sql in Supabase (airfarming_state, airfarming_events, airfarming_wallets, airfarming_transfers).';

  async function balancesForUser(userId) {
    const wallet = await ensureWalletForUser(userId);
    const cashWallet = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
    const af = await getAirfarmingWalletByUserId(userId);
    const airfarmingBalance = Number.parseFloat(String(af?.balance ?? 0)) || 0;
    return { cashWallet, airfarmingBalance };
  }

  app.get('/airfarming/status', authMiddleware, async (req, res) => {
    try {
      let state = await ensureWeekState(req.userId);
      state = await maybeFireEvents(req.userId, state);
      const history = await listAirfarmingEventsByUserId(req.userId, 25);
      const { cashWallet, airfarmingBalance } = await balancesForUser(req.userId);
      return res.json({
        cashWallet,
        airfarmingBalance,
        weekStart: state.week_start,
        weeklyTarget: state.weekly_event_target,
        weeklyUsed: state.weekly_events_used,
        scheduleHours: state.event_offsets_hours,
        lastEventAt: state.last_event_at,
        history: history.map((e) => ({
          id: e.id,
          percent: Number(e.percent),
          createdAt: e.created_at,
        })),
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Airfarming status failed' });
    }
  });

  app.post('/airfarming/activate', authMiddleware, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

      const wallet = await ensureWalletForUser(req.userId);
      const cash = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
      if (cash < amount) return res.status(400).json({ message: 'Insufficient cash wallet balance' });

      const af = await getAirfarmingWalletByUserId(req.userId);
      const nextAf = (Number.parseFloat(String(af?.balance ?? 0)) || 0) + amount;
      const now = new Date().toISOString();

      await setWalletBalance(req.userId, cash - amount);
      await upsertAirfarmingWalletRow({
        user_id: req.userId,
        balance: nextAf,
        updated_at: now,
      });
      await insertAirfarmingTransfer({
        id: newId(),
        user_id: req.userId,
        direction: 'to_airfarming',
        amount,
        created_at: now,
      });

      return res.json({
        cashWallet: cash - amount,
        airfarmingBalance: nextAf,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Activate failed' });
    }
  });

  app.post('/airfarming/return-to-cash', authMiddleware, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

      const wallet = await ensureWalletForUser(req.userId);
      const cash = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
      const af = await getAirfarmingWalletByUserId(req.userId);
      const afBal = Number.parseFloat(String(af?.balance ?? 0)) || 0;
      if (afBal < amount) return res.status(400).json({ message: 'Insufficient airfarming balance' });

      const nextAf = afBal - amount;
      const now = new Date().toISOString();

      await upsertAirfarmingWalletRow({
        user_id: req.userId,
        balance: nextAf,
        updated_at: now,
      });
      await setWalletBalance(req.userId, cash + amount);
      await insertAirfarmingTransfer({
        id: newId(),
        user_id: req.userId,
        direction: 'to_cash',
        amount,
        created_at: now,
      });

      return res.json({
        cashWallet: cash + amount,
        airfarmingBalance: nextAf,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Return to cash failed' });
    }
  });
}

module.exports = { registerAirfarmingRoutes };
