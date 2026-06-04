const { listScheduledAirfarmingDropsForUser, updateAirfarmingDrop } = require('./db');
const { mondayUtcYmd } = require('./ai/applyPlan');

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function updateUserScheduledDropsBalanceWindow(userId, minBalance, maxBalance) {
  const min = roundMoney(minBalance);
  const max = roundMoney(maxBalance);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    const err = new Error('Invalid balance window (max must be >= min)');
    err.statusCode = 400;
    throw err;
  }

  const weekStart = mondayUtcYmd();
  const rows = await listScheduledAirfarmingDropsForUser(userId, weekStart, 50);
  if (!rows.length) {
    const err = new Error('No scheduled drops to update for this user');
    err.statusCode = 400;
    throw err;
  }

  const updated = [];
  for (const row of rows) {
    const u = await updateAirfarmingDrop(row.id, {
      min_balance: min,
      max_balance: max,
      percent_locked: true,
    });
    updated.push(u);
  }

  return { updatedCount: updated.length, drops: updated };
}

module.exports = { updateUserScheduledDropsBalanceWindow };
