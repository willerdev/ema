const crypto = require('crypto');
const {
  getAirfarmingDropById,
  getAirfarmingWalletByUserId,
  upsertAirfarmingWalletRow,
  insertAirfarmingTransfer,
  updateAirfarmingDrop,
} = require('./db');

function newId() {
  return crypto.randomUUID();
}

function roundUsd(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function badRequest(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  throw err;
}

function dropNetProfit(drop) {
  const gross = roundUsd(drop?.profit_amount);
  const clawback = roundUsd(drop?.profit_clawback_usd);
  return roundUsd(Math.max(0, gross - clawback));
}

async function adminClawbackDropProfit(userId, dropId, { amount, reason }) {
  const amt = roundUsd(amount);
  const note = String(reason || '').trim();
  if (!note) badRequest('Reason is required');
  if (!Number.isFinite(amt) || amt <= 0) badRequest('Invalid deduction amount');

  const drop = await getAirfarmingDropById(dropId);
  if (!drop || drop.user_id !== userId) badRequest('Drop not found');
  if (drop.status !== 'paid') badRequest('Only paid drops can be deducted');
  if (roundUsd(drop.profit_amount) <= 0) badRequest('This drop has no profit to deduct');

  const gross = roundUsd(drop.profit_amount);
  const already = roundUsd(drop.profit_clawback_usd);
  const remaining = roundUsd(gross - already);
  if (remaining <= 0) badRequest('No remaining profit on this drop');
  if (amt > remaining) badRequest(`Maximum deduction is $${remaining.toFixed(2)}`);

  const wallet = await getAirfarmingWalletByUserId(userId);
  const balance = roundUsd(wallet?.balance);
  if (balance < amt) {
    badRequest(`Insufficient airfarming balance ($${balance.toFixed(2)} available)`);
  }

  const now = new Date().toISOString();
  const newBalance = roundUsd(balance - amt);
  await upsertAirfarmingWalletRow({
    user_id: userId,
    balance: newBalance,
    updated_at: now,
  });
  await insertAirfarmingTransfer({
    id: newId(),
    user_id: userId,
    direction: 'to_cash',
    amount: amt,
    created_at: now,
  });

  const newClawback = roundUsd(already + amt);
  const updated = await updateAirfarmingDrop(dropId, {
    profit_clawback_usd: newClawback,
    clawback_reason: note,
    clawback_at: now,
  });

  return {
    dropId,
    deductedUsd: amt,
    grossProfitUsd: gross,
    totalClawbackUsd: newClawback,
    remainingProfitUsd: dropNetProfit(updated),
    airfarmingBalanceUsd: newBalance,
    reason: note,
  };
}

module.exports = { adminClawbackDropProfit, dropNetProfit };
