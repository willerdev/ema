const crypto = require('crypto');

/** Platform-reported milestones merged into `history` on GET `/airfarming/status`. Calendar dates UTC YYYY-MM-DD. */
const AIRFARMING_PLATFORM_HIGHLIGHTS = Object.freeze([
  { date: '2026-05-09', percent: 34.49 },
]);

const AIRFARMING_PLATFORM_HIGHLIGHT = AIRFARMING_PLATFORM_HIGHLIGHTS[0] ?? null;

const {
  getAirfarmingStateByUserId,
  upsertAirfarmingState,
  updateAirfarmingAutoFundSetting,
  listAirfarmingDropsForWeek,
  getAirfarmingWalletByUserId,
  upsertAirfarmingWalletRow,
  insertAirfarmingTransfer,
  ensureWalletForUser,
  setWalletBalance,
  isMissingTableError,
} = require('./db');
const { buildDropStatus, dropToHistoryRow } = require('./airfarmingDrops');
const { getWithdrawalTrustScoreForUser } = require('./services/withdrawalTrustScore');

function newId() {
  return crypto.randomUUID();
}

function mondayUtcYmd(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const offset = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

async function ensureWeekState(userId) {
  const weekYmd = mondayUtcYmd();
  let row = await getAirfarmingStateByUserId(userId);
  if (!row || row.week_start !== weekYmd) {
    row = await upsertAirfarmingState({
      user_id: userId,
      week_start: weekYmd,
      weekly_event_target: 2,
      weekly_events_used: row?.weekly_events_used ?? 0,
      event_offsets_hours: row?.event_offsets_hours ?? [],
      last_event_at: row?.last_event_at ?? null,
      auto_fund_enabled: Boolean(row?.auto_fund_enabled),
      drops_paused: Boolean(row?.drops_paused),
      drops_pause_from: row?.drops_pause_from ?? null,
      drops_pause_until: row?.drops_pause_until ?? null,
      drops_pause_band_indexes: row?.drops_pause_band_indexes ?? null,
      updated_at: new Date().toISOString(),
    });
  }
  return row;
}

function mergeAirfarmingHistory(dropRows, highlights, limit = 25) {
  const rows = (dropRows || []).map((d) => dropToHistoryRow(d));
  for (const h of highlights) {
    const date = String(h?.date ?? '').trim();
    const pct = Number(h?.percent);
    if (!date || !Number.isFinite(pct)) continue;
    rows.push({
      id: `platform:${date}:${pct}`,
      percent: Number(pct.toFixed(2)),
      createdAt: `${date}T12:00:00.000Z`,
      source: 'platform',
    });
  }
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows.slice(0, limit);
}

function registerAirfarmingRoutes(app, { authMiddleware }) {
  const schemaMsg =
    'Airfarming schema missing. Run backend/sql/migrations/20260525_airfarming_drops.sql, 20260526_airfarming_auto_fund.sql, and 20260528_airfarming_drop_bands.sql in Supabase.';

  async function balancesForUser(userId) {
    const wallet = await ensureWalletForUser(userId);
    const cashWallet = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
    const af = await getAirfarmingWalletByUserId(userId);
    const airfarmingBalance = Number.parseFloat(String(af?.balance ?? 0)) || 0;
    return { cashWallet, airfarmingBalance };
  }

  app.get('/airfarming/status', authMiddleware, async (req, res) => {
    try {
      const state = await ensureWeekState(req.userId);
      let { cashWallet, airfarmingBalance } = await balancesForUser(req.userId);
      const autoFundEnabled = Boolean(state.auto_fund_enabled);
      const withdrawalTrustScore = await getWithdrawalTrustScoreForUser(req.userId);
      const { nextDrop, upcomingDrops, eligibilityNotice, lastSettledDrop, pollIntervalSec } =
        await buildDropStatus(req.userId, state.week_start, airfarmingBalance, { autoFundEnabled });
      ({ cashWallet, airfarmingBalance } = await balancesForUser(req.userId));
      const settled = await listAirfarmingDropsForWeek(req.userId, state.week_start, 50);
      const paidCount = settled.filter((d) => d.status === 'paid').length;
      const missedCount = settled.filter((d) => d.status === 'missed').length;
      const history = mergeAirfarmingHistory(settled, AIRFARMING_PLATFORM_HIGHLIGHTS, 25);
      const dropHistory = settled.map((d) => dropToHistoryRow(d));

      return res.json({
        cashWallet,
        airfarmingBalance,
        weekStart: state.week_start,
        weeklyTarget: nextDrop ? 1 : 0,
        weeklyUsed: paidCount + missedCount,
        dropsPaid: paidCount,
        dropsMissed: missedCount,
        scheduleHours: [],
        lastEventAt: settled[0]?.paid_at || settled[0]?.due_at || null,
        autoFundEnabled,
        dropsPaused: require('./airfarmingPause').pauseStatusFromState(state).dropsPausedNow,
        platformHighlight: AIRFARMING_PLATFORM_HIGHLIGHT,
        nextDrop,
        upcomingDrops,
        eligibilityNotice,
        lastSettledDrop,
        pollIntervalSec,
        withdrawalTrustScore,
        history,
        dropHistory,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Airfarming status failed' });
    }
  });

  app.post('/airfarming/auto-fund', authMiddleware, async (req, res) => {
    try {
      await ensureWeekState(req.userId);
      const enabled = Boolean(req.body?.enabled);
      const state = await updateAirfarmingAutoFundSetting(req.userId, enabled);
      return res.json({ autoFundEnabled: Boolean(state.auto_fund_enabled) });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e?.message || 'Auto-fund update failed' });
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
