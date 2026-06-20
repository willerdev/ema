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
  VIP_COMMISSION_RATE,
  VIP_ACCRUAL_WEEKDAYS,
  VIP_LOCK_DAYS,
  VIP_MIN_INVEST_USD,
  VIP_EARLY_PENALTY_RATE,
  vipInvestmentToApi,
  vipAccrualToApi,
  listVipAccrualsForUserRecent,
  sumVipAccrualTotals,
  sumVipAccrualsForInvestment,
  utcTodayYmd,
} = require('./db');
const {
  addUtcWeekdays,
  isVipAccrualDayYmd,
  utcYmdFromIso,
  nextUtcYmd,
  buildVipLockProjection,
} = require('./vipFarmerSchedule');

function newId() {
  return crypto.randomUUID();
}

function roundUsd(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function maturityAtFromStart(startedAt) {
  return addUtcWeekdays(startedAt, VIP_LOCK_DAYS);
}

async function enrichVipInvestmentApi(inv) {
  const api = vipInvestmentToApi(inv);
  if (!api || inv.status !== 'active') return api;
  const today = utcTodayYmd();
  const todayIsAccrualDay = isVipAccrualDayYmd(today);
  const todayAccrued = todayIsAccrualDay
    ? Boolean(await getVipAccrualForInvestmentDay(inv.id, today))
    : false;
  const paid = await sumVipAccrualsForInvestment(inv.id);
  const projection = buildVipLockProjection({
    startedAt: inv.started_at,
    maturesAt: inv.matures_at,
    principalUsd: inv.principal_usd,
    lockDays: VIP_LOCK_DAYS,
    dailyRate: VIP_DAILY_RATE,
    commissionRate: VIP_COMMISSION_RATE,
    asOfYmd: today,
  });
  return {
    ...api,
    weekdayCount: projection.weekdaysElapsed,
    daysAccrued: projection.weekdaysElapsed,
    daysLeft: projection.weekdaysRemaining,
    remainingAccrualDays: projection.weekdaysRemaining,
    dailyGrossUsd: projection.dailyGrossUsd,
    dailyPlatformFeeUsd: projection.dailyCommissionUsd,
    dailyInterestUsd: projection.dailyNetUsd,
    totalGrossEarnedUsd: projection.earnedSoFarGrossUsd,
    totalCommissionUsd: projection.earnedSoFarCommissionUsd,
    totalNetEarnedUsd: projection.earnedSoFarNetUsd,
    remainingInterestUsd: projection.remainingNetUsd,
    totalAccruedUsd: projection.earnedSoFarNetUsd,
    paidToCashUsd: paid.totalNetEarnedUsd,
    paidWeekdayCount: paid.weekdayCount,
    startedAtYmd: projection.startedAtYmd,
    projection,
    todayIsAccrualDay,
    todayAccrued,
    todayInterestUsd: todayIsAccrualDay && !todayAccrued ? projection.dailyNetUsd : 0,
  };
}

async function getVipSummary(userId) {
  const wallet = await ensureWalletForUser(userId);
  const cash = roundUsd(wallet?.balance);
  const inv = await getActiveVipInvestmentForUser(userId);
  return {
    cashWalletUsd: cash,
    minInvestUsd: VIP_MIN_INVEST_USD,
    dailyRate: VIP_DAILY_RATE,
    commissionRate: VIP_COMMISSION_RATE,
    accrualWeekdays: VIP_ACCRUAL_WEEKDAYS,
    lockDays: VIP_LOCK_DAYS,
    earlyPenaltyRate: VIP_EARLY_PENALTY_RATE,
    investment: await enrichVipInvestmentApi(inv),
  };
}

async function listVipAccrualHistory(userId, limit = 60) {
  const rows = await listVipAccrualsForUserRecent(userId, limit);
  const accruals = rows.map(vipAccrualToApi).filter(Boolean);
  const inv = await getActiveVipInvestmentForUser(userId);
  const paid =
    inv != null
      ? await sumVipAccrualsForInvestment(inv.id)
      : sumVipAccrualTotals(rows);
  const today = utcTodayYmd();
  const projection =
    inv != null
      ? buildVipLockProjection({
          startedAt: inv.started_at,
          maturesAt: inv.matures_at,
          principalUsd: inv.principal_usd,
          lockDays: VIP_LOCK_DAYS,
          dailyRate: VIP_DAILY_RATE,
          commissionRate: VIP_COMMISSION_RATE,
          asOfYmd: today,
        })
      : null;
  const earned =
    projection != null
      ? {
          weekdayCount: projection.weekdaysElapsed,
          totalGrossEarnedUsd: projection.earnedSoFarGrossUsd,
          totalCommissionUsd: projection.earnedSoFarCommissionUsd,
          totalNetEarnedUsd: projection.earnedSoFarNetUsd,
        }
      : {
          weekdayCount: paid.weekdayCount,
          totalGrossEarnedUsd: paid.totalGrossEarnedUsd,
          totalCommissionUsd: paid.totalCommissionUsd,
          totalNetEarnedUsd: paid.totalNetEarnedUsd,
        };
  return {
    commissionRate: VIP_COMMISSION_RATE,
    accruals,
    projection,
    totals: {
      weekdayCount: earned.weekdayCount,
      grossUsd: earned.totalGrossEarnedUsd,
      commissionUsd: earned.totalCommissionUsd,
      netUsd: earned.totalNetEarnedUsd,
      paidToCashUsd: paid.totalNetEarnedUsd,
      remainingNetUsd: projection?.remainingNetUsd ?? 0,
      fullLockNetUsd: projection?.fullLockNetUsd ?? 0,
    },
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
  const maturesAt = maturityAtFromStart(now);
  await setWalletBalance(userId, roundUsd(cash - amt));
  const row = await createVipInvestment({
    userId,
    principalUsd: amt,
    startedAt: now,
    maturesAt,
  });

  return { investment: await enrichVipInvestmentApi(row), cashWalletUsd: roundUsd(cash - amt) };
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
  const maturesAt = maturityAtFromStart(now);
  const newPrincipal = roundUsd(Number(inv.principal_usd) + amt);
  await setWalletBalance(userId, roundUsd(cash - amt));
  const row = await updateVipInvestment(inv.id, {
    principalUsd: newPrincipal,
    startedAt: now,
    maturesAt,
    daysAccrued: 0,
    totalAccruedUsd: 0,
    status: 'active',
  });

  return {
    investment: await enrichVipInvestmentApi(row),
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
  const accrualsComplete = Number(inv.days_accrued) >= VIP_LOCK_DAYS;
  const calendarMature = Date.now() >= new Date(inv.matures_at).getTime();
  if (!accrualsComplete && !calendarMature) {
    const err = new Error('Investment is still locked until all weekday accruals complete');
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

async function tryAccrueVipDay(inv, planDate) {
  const startYmd = utcYmdFromIso(inv.started_at);
  if (planDate < startYmd) {
    return { applied: false, skipped: true, inv };
  }
  if (!isVipAccrualDayYmd(planDate)) {
    return { applied: false, skipped: true, inv };
  }
  if (Number(inv.days_accrued) >= VIP_LOCK_DAYS) {
    return { applied: false, skipped: true, inv };
  }
  const existing = await getVipAccrualForInvestmentDay(inv.id, planDate);
  if (existing) {
    return { applied: false, skipped: true, inv };
  }

  const principal = roundUsd(inv.principal_usd);
  const gross = roundUsd(principal * VIP_DAILY_RATE);
  const commission = roundUsd(gross * VIP_COMMISSION_RATE);
  const net = roundUsd(gross - commission);
  if (net <= 0) {
    return { applied: false, skipped: true, inv };
  }

  const wallet = await getWalletByUserId(inv.user_id);
  const cash = roundUsd(wallet?.balance);
  await setWalletBalance(inv.user_id, roundUsd(cash + net));
  await createTransaction({
    userId: inv.user_id,
    type: 'deposit',
    amount: net,
    status: 'completed',
  });

  await insertVipAccrual({
    id: newId(),
    investment_id: inv.id,
    user_id: inv.user_id,
    accrual_date: planDate,
    rate: VIP_DAILY_RATE,
    amount: net,
    gross_amount: gross,
    commission_rate: VIP_COMMISSION_RATE,
    commission_amount: commission,
    created_at: new Date().toISOString(),
  });

  const updated = await updateVipInvestment(inv.id, {
    totalAccruedUsd: roundUsd(Number(inv.total_accrued_usd) + net),
    daysAccrued: Number(inv.days_accrued) + 1,
  });

  return { applied: true, skipped: false, inv: updated };
}

async function runVipDailyAccrual(planDate = utcTodayYmd()) {
  const rows = await listActiveVipInvestments();
  let applied = 0;
  let skipped = 0;

  for (const inv of rows) {
    const startYmd = utcYmdFromIso(inv.started_at);
    let cursor = startYmd;
    let current = inv;
    while (cursor <= planDate && Number(current.days_accrued) < VIP_LOCK_DAYS) {
      const result = await tryAccrueVipDay(current, cursor);
      if (result.applied) {
        applied += 1;
        current = result.inv;
      } else if (result.skipped) {
        skipped += 1;
      }
      cursor = nextUtcYmd(cursor);
    }
  }

  return {
    ok: true,
    planDate,
    isAccrualDay: isVipAccrualDayYmd(planDate),
    investmentsChecked: rows.length,
    accrualsApplied: applied,
    skipped,
  };
}

module.exports = {
  getVipSummary,
  listVipAccrualHistory,
  investVip,
  addCapitalVip,
  withdrawVipAtMaturity,
  earlyWithdrawVip,
  runVipDailyAccrual,
};
