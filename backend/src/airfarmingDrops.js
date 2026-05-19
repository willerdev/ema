const crypto = require('crypto');
const {
  getScheduledAirfarmingDrop,
  getLastAirfarmingDropForWeek,
  insertAirfarmingDrop,
  updateAirfarmingDrop,
  ensureWalletForUser,
  setWalletBalance,
  insertAirfarmingTransfer,
  getCryptoBalancesByUserId,
  insertCryptoLedgerEntry,
  getAirfarmingWalletByUserId,
  upsertAirfarmingWalletRow,
} = require('./db');
const { debitUsdtFamily, totalUsdtFamilyAvailable } = require('./usdtBalances');

const INTERVAL_HOURS = [2, 3, 5];
const MAX_PROFIT_PER_DROP = 5000;

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

function ymdToUtcMs(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function weekEndMs(weekStartYmd) {
  return ymdToUtcMs(weekStartYmd) + 7 * 24 * 3600 * 1000;
}

function pickIntervalHours(userId, weekStart, dropIndex) {
  const h = hash32(`${userId}:${weekStart}:${dropIndex}:interval`);
  return INTERVAL_HOURS[h % INTERVAL_HOURS.length];
}

/** Seeded percent 1..100 and balance band for a drop slot. */
function generateDropSpec(userId, weekStart, dropIndex) {
  const h = hash32(`${userId}:${weekStart}:${dropIndex}:dropSpec`);
  const h2 = hash32(`${userId}:${weekStart}:${dropIndex}:range`);
  const percent = 1 + (h % 100);

  const band = h2 % 4;
  let minBalance;
  let maxBalance;
  if (band === 0) {
    minBalance = 100;
    maxBalance = 100 + 5 + (h % 41);
  } else if (band === 1) {
    minBalance = 100;
    maxBalance = 100 + 4 + (h % 9);
  } else if (band === 2) {
    minBalance = 1000;
    maxBalance = 1000 + 400 + (h % 1001);
  } else {
    minBalance = 10000;
    maxBalance = 10000 + 5000 + (h % 6001);
  }

  return {
    percent: Number(percent.toFixed(2)),
    min_balance: Number(minBalance.toFixed(2)),
    max_balance: Number(maxBalance.toFixed(2)),
  };
}

function isEligible(balance, minBalance, maxBalance) {
  const b = Number(balance);
  return b >= Number(minBalance) && b <= Number(maxBalance);
}

function computeProfit(balance, percent) {
  const raw = (Number(balance) * Number(percent)) / 100;
  const capped = Math.min(raw, MAX_PROFIT_PER_DROP);
  return Math.round(capped * 100) / 100;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toPublicNextDrop(row, airfarmingBalance, nowMs = Date.now()) {
  if (!row) return null;
  const dueMs = new Date(row.due_at).getTime();
  const secondsRemaining = Math.max(0, Math.floor((dueMs - nowMs) / 1000));
  const bal = Number(airfarmingBalance) || 0;
  const eligibleNow = isEligible(bal, row.min_balance, row.max_balance);
  const projectedProfit = eligibleNow ? computeProfit(bal, row.percent) : 0;
  return {
    id: row.id,
    dropIndex: row.drop_index,
    dueAt: row.due_at,
    secondsRemaining,
    percent: Number(row.percent),
    minBalance: Number(row.min_balance),
    maxBalance: Number(row.max_balance),
    eligibleNow,
    projectedProfit,
  };
}

function dropToHistoryRow(row) {
  return {
    id: String(row.id),
    percent: Number(row.percent),
    minBalance: Number(row.min_balance),
    maxBalance: Number(row.max_balance),
    status: row.status,
    eligibleBalance: row.eligible_balance != null ? Number(row.eligible_balance) : null,
    profitAmount: Number(row.profit_amount || 0),
    autoFundedCash: Number(row.auto_funded_cash || 0),
    autoFundedCrypto: Number(row.auto_funded_crypto || 0),
    createdAt: row.paid_at || row.due_at,
    source: 'drop',
  };
}

async function ensureNextScheduledDrop(userId, weekStart) {
  const existing = await getScheduledAirfarmingDrop(userId, weekStart);
  if (existing) return existing;

  const weekEnd = weekEndMs(weekStart);
  const now = Date.now();
  if (now >= weekEnd) return null;

  const last = await getLastAirfarmingDropForWeek(userId, weekStart);
  const dropIndex = last ? Number(last.drop_index) + 1 : 0;
  const intervalH = pickIntervalHours(userId, weekStart, dropIndex);
  const spec = generateDropSpec(userId, weekStart, dropIndex);

  let dueMs;
  if (!last) {
    dueMs = now + intervalH * 3600 * 1000;
  } else {
    const baseMs = Math.max(now, new Date(last.due_at).getTime());
    dueMs = baseMs + intervalH * 3600 * 1000;
  }
  if (dueMs >= weekEnd) return null;

  return insertAirfarmingDrop({
    id: newId(),
    user_id: userId,
    week_start: weekStart,
    drop_index: dropIndex,
    due_at: new Date(dueMs).toISOString(),
    percent: spec.percent,
    min_balance: spec.min_balance,
    max_balance: spec.max_balance,
    status: 'scheduled',
    profit_amount: 0,
  });
}

async function autoFundToMinimum(userId, drop, currentBalance) {
  const minBalance = Number(drop.min_balance);
  const maxBalance = Number(drop.max_balance);
  const balance = Number(currentBalance) || 0;
  if (balance >= minBalance || balance > maxBalance) {
    return { balance, cash: 0, crypto: 0 };
  }

  const needed = roundMoney(minBalance - balance);
  if (needed <= 0) return { balance, cash: 0, crypto: 0 };

  const [wallet, cryptoBalances] = await Promise.all([
    ensureWalletForUser(userId),
    getCryptoBalancesByUserId(userId),
  ]);
  const cashAvailable = Math.max(0, Number.parseFloat(String(wallet.balance ?? 0)) || 0);
  const cryptoAvailable = totalUsdtFamilyAvailable(cryptoBalances);
  const useCash = cashAvailable >= needed;
  const useCrypto = !useCash && cryptoAvailable >= needed;
  if (!useCash && !useCrypto) {
    return { balance, cash: 0, crypto: 0 };
  }

  const cashTake = useCash ? needed : 0;
  const cryptoTake = useCrypto ? needed : 0;
  const now = new Date().toISOString();

  if (cashTake > 0) {
    await setWalletBalance(userId, roundMoney(cashAvailable - cashTake));
    await insertAirfarmingTransfer({
      id: newId(),
      user_id: userId,
      direction: 'to_airfarming',
      amount: cashTake,
      created_at: now,
    });
  }

  if (cryptoTake > 0) {
    await debitUsdtFamily({
      userId,
      amount: cryptoTake,
      source: 'airfarming_auto_fund',
      sourceId: drop.id,
      insertCryptoLedgerEntry,
      getCryptoBalancesByUserId,
      newId,
    });
    await insertAirfarmingTransfer({
      id: newId(),
      user_id: userId,
      direction: 'to_airfarming',
      amount: cryptoTake,
      created_at: now,
    });
  }

  const nextBalance = roundMoney(balance + cashTake + cryptoTake);
  await upsertAirfarmingWalletRow({
    user_id: userId,
    balance: nextBalance,
    updated_at: now,
  });

  return { balance: nextBalance, cash: cashTake, crypto: cryptoTake };
}

async function settleDrop(userId, drop, options = {}) {
  const af = await getAirfarmingWalletByUserId(userId);
  let balance = Number.parseFloat(String(af?.balance ?? 0)) || 0;
  const now = new Date().toISOString();
  let autoFunded = { cash: 0, crypto: 0 };
  if (!isEligible(balance, drop.min_balance, drop.max_balance) && options.autoFundEnabled) {
    autoFunded = await autoFundToMinimum(userId, drop, balance);
    balance = autoFunded.balance;
  }
  const eligible = isEligible(balance, drop.min_balance, drop.max_balance);

  if (eligible) {
    const profit = computeProfit(balance, drop.percent);
    const nextBal = roundMoney(balance + profit);
    await upsertAirfarmingWalletRow({
      user_id: userId,
      balance: nextBal,
      updated_at: now,
    });
    return updateAirfarmingDrop(drop.id, {
      status: 'paid',
      eligible_balance: balance,
      profit_amount: profit,
      auto_funded_cash: autoFunded.cash,
      auto_funded_crypto: autoFunded.crypto,
      paid_at: now,
    });
  }

  return updateAirfarmingDrop(drop.id, {
    status: 'missed',
    eligible_balance: balance,
    profit_amount: 0,
    auto_funded_cash: autoFunded.cash,
    auto_funded_crypto: autoFunded.crypto,
    paid_at: now,
  });
}

/** Process all overdue scheduled drops; schedule the next one after each settlement. */
async function processDueDrops(userId, weekStart, options = {}) {
  let processed = 0;
  const guardMax = 20;
  while (processed < guardMax) {
    let scheduled = await getScheduledAirfarmingDrop(userId, weekStart);
    if (!scheduled) {
      scheduled = await ensureNextScheduledDrop(userId, weekStart);
      if (!scheduled) break;
    }
    const dueMs = new Date(scheduled.due_at).getTime();
    if (Date.now() < dueMs) break;

    await settleDrop(userId, scheduled, options);
    processed += 1;
    await ensureNextScheduledDrop(userId, weekStart);
  }
  return processed;
}

async function buildDropStatus(userId, weekStart, airfarmingBalance, options = {}) {
  await processDueDrops(userId, weekStart, options);
  let scheduled = await getScheduledAirfarmingDrop(userId, weekStart);
  if (!scheduled) {
    scheduled = await ensureNextScheduledDrop(userId, weekStart);
  }
  const af = await getAirfarmingWalletByUserId(userId);
  const latestBalance = Number.parseFloat(String(af?.balance ?? airfarmingBalance ?? 0)) || 0;
  const nextDrop = toPublicNextDrop(scheduled, latestBalance);
  return { nextDrop };
}

module.exports = {
  generateDropSpec,
  isEligible,
  computeProfit,
  autoFundToMinimum,
  toPublicNextDrop,
  ensureNextScheduledDrop,
  settleDrop,
  processDueDrops,
  buildDropStatus,
  dropToHistoryRow,
  MAX_PROFIT_PER_DROP,
};
