const crypto = require('crypto');
const {
  insertAirfarmingDrop,
  getMaxAirfarmingDropIndex,
  listScheduledAirfarmingDropsForUser,
} = require('./db');
const { clampAirfarmingPercent, getEffectiveCaps } = require('./airfarmingDrops');
const { mondayUtcYmd } = require('./ai/applyPlan');

function newId() {
  return crypto.randomUUID();
}

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/**
 * Schedule a one-off VIP-priority drop for a user (due before any other scheduled drops this week).
 */
async function createDirectDropForUser(userId, body) {
  const delayMinutes = Math.max(0, Number(body?.delayMinutes) || 0);
  const minBalance = roundMoney(body?.minBalance);
  const maxBalance = roundMoney(body?.maxBalance);
  if (!Number.isFinite(minBalance) || !Number.isFinite(maxBalance) || maxBalance < minBalance) {
    const err = new Error('Invalid balance window (max must be >= min)');
    err.statusCode = 400;
    throw err;
  }

  const caps = await getEffectiveCaps();
  const percent = clampAirfarmingPercent(Number(body?.percent), caps.maxPercent);
  if (!Number.isFinite(percent) || percent <= 0) {
    const err = new Error('Invalid drop percent');
    err.statusCode = 400;
    throw err;
  }

  const weekStart = mondayUtcYmd();
  const now = Date.now();
  let dueMs = now + delayMinutes * 60 * 1000;

  const scheduled = await listScheduledAirfarmingDropsForUser(userId, weekStart, 50);
  if (scheduled.length) {
    const earliestMs = new Date(scheduled[0].due_at).getTime();
    if (dueMs >= earliestMs) {
      dueMs = earliestMs - 60 * 1000;
      if (dueMs <= now) dueMs = now + 60 * 1000;
    }
  }

  const dropIndex = (await getMaxAirfarmingDropIndex(userId, weekStart)) + 1;
  const bandIndex =
    body?.bandIndex != null && Number.isFinite(Number(body.bandIndex)) ? Number(body.bandIndex) : 0;

  const row = await insertAirfarmingDrop({
    id: newId(),
    user_id: userId,
    week_start: weekStart,
    drop_index: dropIndex,
    due_at: new Date(dueMs).toISOString(),
    band_index: bandIndex,
    percent,
    min_balance: minBalance,
    max_balance: maxBalance,
    percent_locked: true,
    status: 'scheduled',
    profit_amount: 0,
  });

  return row;
}

module.exports = { createDirectDropForUser };
