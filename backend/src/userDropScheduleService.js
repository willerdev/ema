const crypto = require('crypto');
const {
  getUserById,
  getAirfarmingWalletByUserId,
  getUserDropSchedule,
  upsertUserDropSchedule,
  userDropScheduleRowToApi,
  deleteScheduledAirfarmingDropsForUserWeek,
  getMaxAirfarmingDropIndex,
  insertAirfarmingDrop,
} = require('./db');
const { mondayUtcYmd } = require('./ai/applyPlan');
const { suggestUserDropPlan } = require('./ai/userDropPlanner');
const { isDropPausedForUser } = require('./airfarmingPause');

function ymdToUtcMs(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function weekEndMs(weekStartYmd) {
  return ymdToUtcMs(weekStartYmd) + 7 * 24 * 3600 * 1000;
}

async function getUserDropScheduleView(userId, weekStart) {
  const user = await getUserById(userId);
  if (!user) return null;
  const ws = weekStart || mondayUtcYmd();
  const [afWallet, row] = await Promise.all([
    getAirfarmingWalletByUserId(userId),
    getUserDropSchedule(userId, ws),
  ]);
  const balance = Number.parseFloat(String(afWallet?.balance ?? 0)) || 0;
  return {
    weekStart: ws,
    airfarmingBalance: balance,
    schedule: userDropScheduleRowToApi(row),
  };
}

async function saveUserDropScheduleDraft(userId, { weekStart, dropCount, targetTotalUsd }) {
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: 'User not found' };

  const ws = weekStart || mondayUtcYmd();
  const afWallet = await getAirfarmingWalletByUserId(userId);
  const balance = Number.parseFloat(String(afWallet?.balance ?? 0)) || 0;

  const row = await upsertUserDropSchedule({
    userId,
    weekStart: ws,
    dropCount,
    targetTotalUsd,
    referenceBalance: balance,
    status: 'draft',
    items: [],
    planSummary: null,
    plannerMode: null,
  });

  return { ok: true, schedule: userDropScheduleRowToApi(row) };
}

async function aiSuggestUserDropSchedule(userId, { weekStart, dropCount, targetTotalUsd }) {
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: 'User not found' };

  const ws = weekStart || mondayUtcYmd();
  const afWallet = await getAirfarmingWalletByUserId(userId);
  const balance = Number.parseFloat(String(afWallet?.balance ?? 0)) || 0;

  const suggestion = await suggestUserDropPlan({
    userId,
    weekStart: ws,
    dropCount,
    targetTotalUsd,
    balance,
  });
  if (!suggestion.ok) return suggestion;

  const row = await upsertUserDropSchedule({
    userId,
    weekStart: ws,
    dropCount,
    targetTotalUsd,
    referenceBalance: balance,
    status: 'draft',
    planSummary: suggestion.planSummary,
    plannerMode: suggestion.plannerMode,
    items: suggestion.items,
  });

  return {
    ok: true,
    schedule: userDropScheduleRowToApi(row),
    totalProjectedUsd: suggestion.totalProjectedUsd,
    plannerMode: suggestion.plannerMode,
  };
}

async function applyUserDropSchedule(userId, { weekStart } = {}) {
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: 'User not found' };

  const ws = weekStart || mondayUtcYmd();
  const row = await getUserDropSchedule(userId, ws);
  if (!row) return { ok: false, error: 'No drop plan for this week. Run AI suggest first.' };
  if (!Array.isArray(row.items) || row.items.length === 0) {
    return { ok: false, error: 'Plan has no drop items. Run AI suggest first.' };
  }

  const pause = await isDropPausedForUser(userId, row.items[0]?.bandIndex ?? 0);
  if (pause.paused) {
    return { ok: false, error: 'User drops are paused. Resume drops before applying a plan.' };
  }

  const items = row.items;
  const weekEnd = weekEndMs(ws);
  let dueMs = Date.now() + Number(items[0].intervalHours || 2) * 3600 * 1000;
  if (dueMs >= weekEnd) {
    return { ok: false, error: 'First drop falls outside the current week. Reduce intervals or drop count.' };
  }

  for (let i = 1; i < items.length; i += 1) {
    dueMs += Number(items[i].intervalHours || 2) * 3600 * 1000;
    if (dueMs >= weekEnd) {
      return { ok: false, error: 'Drop schedule exceeds the current week. Adjust intervals or drop count.' };
    }
  }

  await deleteScheduledAirfarmingDropsForUserWeek(userId, ws);
  const maxIdx = await getMaxAirfarmingDropIndex(userId, ws);
  let startIndex = maxIdx + 1;
  if (startIndex < 0) startIndex = 0;

  dueMs = Date.now() + Number(items[0].intervalHours || 2) * 3600 * 1000;
  const created = [];
  for (let i = 0; i < items.length; i += 1) {
    if (i > 0) dueMs += Number(items[i].intervalHours || 2) * 3600 * 1000;
    const it = items[i];
    const drop = await insertAirfarmingDrop({
      id: crypto.randomUUID(),
      user_id: userId,
      week_start: ws,
      drop_index: startIndex + i,
      due_at: new Date(dueMs).toISOString(),
      band_index: it.bandIndex != null ? Number(it.bandIndex) : 0,
      percent: Number(it.percent),
      min_balance: Number(it.minBalance),
      max_balance: Number(it.maxBalance),
      status: 'scheduled',
      profit_amount: 0,
      percent_locked: true,
    });
    created.push(drop);
  }

  const now = new Date().toISOString();
  const updated = await upsertUserDropSchedule({
    userId,
    weekStart: ws,
    dropCount: row.drop_count,
    targetTotalUsd: row.target_total_usd,
    referenceBalance: row.reference_balance,
    status: 'applied',
    planSummary: row.plan_summary,
    plannerMode: row.planner_mode,
    items: row.items,
    appliedAt: now,
  });

  return {
    ok: true,
    schedule: userDropScheduleRowToApi(updated),
    dropsCreated: created.length,
    dropIds: created.map((d) => d.id),
  };
}

module.exports = {
  getUserDropScheduleView,
  saveUserDropScheduleDraft,
  aiSuggestUserDropSchedule,
  applyUserDropSchedule,
};
