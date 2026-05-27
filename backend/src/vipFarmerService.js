const crypto = require('crypto');
const {
  ensureWalletForUser,
  setWalletBalance,
  getWalletByUserId,
  createTransaction,
  getActiveVipInvestmentForUser,
  getVipInvestmentById,
  createVipInvestment,
  updateVipInvestment,
  listActiveVipInvestments,
  getVipAccrualForInvestmentDay,
  insertVipAccrual,
  VIP_DAILY_RATE,
  VIP_LOCK_DAYS,
  VIP_MIN_INVEST_USD,
  VIP_EARLY_PENALTY_RATE,
  vipInvestmentToApi,
  utcTodayYmd,
} = require('./db');

function newId() {
  return crypto.randomUUID();
}

function roundUsd(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function addDaysUtc(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

async function getVipSummary(userId) {
  const wallet = await ensureWalletForUser(userId);
  const cash = roundUsd(wallet?.balance);
  const inv = await getActiveVipInvestmentForUser(userId);
  return {
    cashWalletUsd: cash,
    minInvestUsd: VIP_MIN_INVEST_USD,
    dailyRate: VIP_DAILY_RATE,
    lockDays: VIP_LOCK_DAYS,
    earlyPenaltyRate: VIP_EARLY_PENALTY_RATE,
    investment: vipInvestmentToApi(inv),
  };
}

async function investVip(userId, amount) {
  const amt = roundUsd(amount);
  if (!Number.isFinite(amt) || amt < VIP_MIN_INVEST_USD) {
    const err = new Error(`Minimum investment is $${VIP_MIN_INVEST_USD}`);
    err.statusCode = 400;
    throw err;
  }

  const existing = await getActiveVipInvestmentForUser(userId);
  if (existing) {
    const err = new Error('You already have an active VIP Farmers investment');
    err.statusCode = 400;
    throw err;
  }

  const wallet = await ensureWalletForUser(userId);
  const cash = roundUsd(wallet?.balance);
  if (cash < amt) {
    const err = new Error('Insufficient cash wallet balance');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const maturesAt = addDaysUtc(now, VIP_LOCK_DAYS);
  await setWalletBalance(userId, roundUsd(cash - amt));
  const row = await createVipInvestment({
    userId,
    principalUsd: amt,
    startedAt: now,
    maturesAt,
  });

  return { investment: vipInvestmentToApi(row), cashWalletUsd: roundUsd(cash - amt) };
}

async function addCapitalVip(userId, amount) {
  const amt = roundUsd(amount);
  if (!Number.isFinite(amt) || amt < VIP_MIN_INVEST_USD) {
    const err = new Error(`Minimum add is $${VIP_MIN_INVEST_USD}`);
    err.statusCode = 400;
    throw err;
  }

  const inv = await getActiveVipInvestmentForUser(userId);
  if (!inv) {
    const err = new Error('No active VIP investment to add capital to');
    err.statusCode = 400;
    throw err;
  }

  const wallet = await ensureWalletForUser(userId);
  const cash = roundUsd(wallet?.balance);
  if (cash < amt) {
    const err = new Error('Insufficient cash wallet balance');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const maturesAt = addDaysUtc(now, VIP_LOCK_DAYS);
  const newPrincipal = roundUsd(Number(inv.principal_usd) + amt);
  await setWalletBalance(userId, roundUsd(cash - amt));
  const row = await updateVipInvestment(inv.id, {
    principalUsd: newPrincipal,
    startedAt: now,
    maturesAt,
    daysAccrued: 0,
    status: 'active',
  });

  return {
    investment: vipInvestmentToApi(row),
    cashWalletUsd: roundUsd(cash - amt),
    addedUsd: amt,
    lockReset: true,
  };
}

async function withdrawVipAtMaturity(userId) {
  const inv = await getActiveVipInvestmentForUser(userId);
  if (!inv) {
    const err = new Error('No active VIP investment');
    err.statusCode = 400;
    throw err;
  }
  if (Date.now() < new Date(inv.matures_at).getTime()) {
    const err = new Error('Investment is still locked until maturity date');
    err.statusCode = 400;
    throw err;
  }

  const principal = roundUsd(inv.principal_usd);
  const wallet = await ensureWalletForUser(userId);
  const cash = roundUsd(wallet?.balance);
  const nextCash = roundUsd(cash + principal);
  await setWalletBalance(userId, nextCash);
  await createTransaction({
    userId,
    type: 'deposit',
    amount: principal,
    status: 'completed',
  });
  await updateVipInvestment(inv.id, { status: 'closed' });

  return {
    principalReturned: principal,
    cashWalletUsd: nextCash,
    investment: vipInvestmentToApi({ ...inv, status: 'closed' }),
  };
}

async function earlyWithdrawVip(userId) {
  const inv = await getActiveVipInvestmentForUser(userId);
  if (!inv) {
    const err = new Error('No active VIP investment');
    err.statusCode = 400;
    throw err;
  }
  if (Date.now() >= new Date(inv.matures_at).getTime()) {
    const err = new Error('Use normal withdraw after maturity');
    err.statusCode = 400;
    throw err;
  }

  const available = roundUsd(inv.principal_usd);
  const penalty = roundUsd(available * VIP_EARLY_PENALTY_RATE);
  const payout = roundUsd(available - penalty);

  const wallet = await ensureWalletForUser(userId);
  const cash = roundUsd(wallet?.balance);
  const nextCash = roundUsd(cash + payout);
  await setWalletBalance(userId, nextCash);
  if (payout > 0) {
    await createTransaction({
      userId,
      type: 'deposit',
      amount: payout,
      status: 'completed',
    });
  }
  await updateVipInvestment(inv.id, { status: 'early_withdrawn' });

  return {
    available,
    penalty,
    payout,
    cashWalletUsd: nextCash,
    investment: vipInvestmentToApi({ ...inv, status: 'early_withdrawn' }),
  };
}

async function runVipDailyAccrual(planDate = utcTodayYmd()) {
  const rows = await listActiveVipInvestments();
  let applied = 0;
  let skipped = 0;

  for (const inv of rows) {
    if (Number(inv.days_accrued) >= VIP_LOCK_DAYS) {
      skipped += 1;
      continue;
    }
    const existing = await getVipAccrualForInvestmentDay(inv.id, planDate);
    if (existing) {
      skipped += 1;
      continue;
    }

    const principal = roundUsd(inv.principal_usd);
    const amount = roundUsd(principal * VIP_DAILY_RATE);
    if (amount <= 0) {
      skipped += 1;
      continue;
    }

    const wallet = await getWalletByUserId(inv.user_id);
    const cash = roundUsd(wallet?.balance);
    await setWalletBalance(inv.user_id, roundUsd(cash + amount));
    await createTransaction({
      userId: inv.user_id,
      type: 'deposit',
      amount,
      status: 'completed',
    });

    await insertVipAccrual({
      id: newId(),
      investment_id: inv.id,
      user_id: inv.user_id,
      accrual_date: planDate,
      rate: VIP_DAILY_RATE,
      amount,
      created_at: new Date().toISOString(),
    });

    await updateVipInvestment(inv.id, {
      totalAccruedUsd: roundUsd(Number(inv.total_accrued_usd) + amount),
      daysAccrued: Number(inv.days_accrued) + 1,
    });

    applied += 1;
  }

  return { ok: true, planDate, investmentsChecked: rows.length, accrualsApplied: applied, skipped };
}

module.exports = {
  getVipSummary,
  investVip,
  addCapitalVip,
  withdrawVipAtMaturity,
  earlyWithdrawVip,
  runVipDailyAccrual,
};
