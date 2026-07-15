const crypto = require('crypto');
const {
  ensureWalletForUser,
  setWalletBalance,
  getWalletByUserId,
  createTransaction,
  getActiveVipInvestmentForUser,
  getVipInvestmentById,
  getUsersByIds,
  createVipInvestment,
  updateVipInvestment,
  listActiveVipInvestments,
  getVipAccrualForInvestmentDay,
  insertVipAccrual,
  vipInvestmentToApi,
  vipAccrualToApi,
  listVipAccrualsForUserRecent,
  sumVipAccrualTotals,
  sumVipAccrualsForInvestment,
  utcTodayYmd,
} = require('./db');
const {
  VIP_DAILY_RATE,
  PLATFORM_FEE_VIP_RATE,
  VIP_ACCRUAL_MAX_WORKING_DAYS,
  VIP_ACCRUAL_WEEKDAYS,
  VIP_LOCK_DAYS_CALENDAR,
  VIP_MIN_INVEST_USD,
  VIP_EXIT_COMMISSION_RATE,
  roundUsd,
  maturityAtFromStart,
  availableRevenue,
  isPenaltyFreeExit,
  computeReinvestQuote,
  dailyAccrualAmounts,
} = require('./vipFarmerConstants');
const {
  isVipAccrualDayYmd,
  utcYmdFromIso,
  nextUtcYmd,
  buildVipLockProjection,
  calendarDaysSinceStart,
} = require('./vipFarmerSchedule');
const {
  newId: repoNewId,
  insertVipReinvestEvent,
  insertPlatformRevenueEvent,
  listActiveVipInvestmentsAdmin,
} = require('./vipFarmerRepository');
const { getPendingVipExitForUser } = require('./vipExitStorage');
const { getVipLoanStatus } = require('./vipLoanService');

function newId() {
  return crypto.randomUUID();
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
    lockDays: VIP_ACCRUAL_MAX_WORKING_DAYS,
    dailyRate: VIP_DAILY_RATE,
    commissionRate: PLATFORM_FEE_VIP_RATE,
    asOfYmd: today,
  });
  const calendarDays = calendarDaysSinceStart(inv.started_at, today);
  const avail = availableRevenue(inv);
  return {
    ...api,
    weekdayCount: projection.weekdaysElapsed,
    daysAccrued: projection.weekdaysElapsed,
    daysLeft: projection.weekdaysRemaining,
    calendarDaysElapsed: calendarDays,
    calendarDaysLeft: Math.max(0, VIP_LOCK_DAYS_CALENDAR - calendarDays),
    remainingAccrualDays: projection.weekdaysRemaining,
    dailyGrossUsd: projection.dailyGrossUsd,
    dailyPlatformFeeUsd: projection.dailyCommissionUsd,
    dailyInterestUsd: projection.dailyNetUsd,
    totalGrossEarnedUsd: projection.earnedSoFarGrossUsd,
    totalCommissionUsd: projection.earnedSoFarCommissionUsd,
    totalNetEarnedUsd: projection.earnedSoFarNetUsd,
    remainingInterestUsd: projection.remainingNetUsd,
    totalAccruedUsd: Number(inv.total_accrued_usd),
    availableRevenueUsd: avail,
    revenueWithdrawnUsd: Number(inv.revenue_withdrawn_usd || 0),
    paidToCashUsd: paid.totalNetEarnedUsd,
    paidWeekdayCount: paid.weekdayCount,
    startedAtYmd: projection.startedAtYmd,
    penaltyFree: isPenaltyFreeExit(inv, today),
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
  const pendingExit = await getPendingVipExitForUser(userId);
  const loanStatus = await getVipLoanStatus(userId);
  return {
    cashWalletUsd: cash,
    minInvestUsd: VIP_MIN_INVEST_USD,
    dailyRate: VIP_DAILY_RATE,
    platformFeeRate: PLATFORM_FEE_VIP_RATE,
    netDailyRate: roundUsd(VIP_DAILY_RATE * (1 - PLATFORM_FEE_VIP_RATE)),
    commissionRate: PLATFORM_FEE_VIP_RATE,
    accrualWeekdays: VIP_ACCRUAL_WEEKDAYS,
    weekendsExcluded: true,
    lockCalendarDays: VIP_LOCK_DAYS_CALENDAR,
    lockWorkingDays: VIP_ACCRUAL_MAX_WORKING_DAYS,
    lockDays: VIP_ACCRUAL_MAX_WORKING_DAYS,
    exitCommissionRate: VIP_EXIT_COMMISSION_RATE,
    investment: await enrichVipInvestmentApi(inv),
    pendingExitRequest: pendingExit
      ? {
          id: pendingExit.id,
          status: 'pending',
          mode: pendingExit.payload?.mode || 'full_stop',
        }
      : null,
    loan: loanStatus,
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
          lockDays: VIP_ACCRUAL_MAX_WORKING_DAYS,
          dailyRate: VIP_DAILY_RATE,
          commissionRate: PLATFORM_FEE_VIP_RATE,
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
    commissionRate: PLATFORM_FEE_VIP_RATE,
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

async function adminInitiateVipInvestment(userId, { principalUsd, fundFrom = 'cash', reason, adminUser }) {
  const amt = roundUsd(principalUsd);
  if (!Number.isFinite(amt) || amt < VIP_MIN_INVEST_USD) {
    const err = new Error(`Minimum investment is $${VIP_MIN_INVEST_USD}`);
    err.statusCode = 400;
    throw err;
  }

  const reasonText = String(reason || '').trim();
  if (!reasonText) {
    const err = new Error('Reason is required');
    err.statusCode = 400;
    throw err;
  }

  const existing = await getActiveVipInvestmentForUser(userId);
  if (existing) {
    const err = new Error('User already has an active VIP Farmers investment');
    err.statusCode = 400;
    throw err;
  }

  const mode = fundFrom === 'admin_credit' ? 'admin_credit' : 'cash';
  const wallet = await ensureWalletForUser(userId);
  const cash = roundUsd(wallet?.balance);

  if (mode === 'cash' && cash < amt) {
    const err = new Error('Insufficient cash wallet balance');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const maturesAt = maturityAtFromStart(now);
  if (mode === 'cash') {
    await setWalletBalance(userId, roundUsd(cash - amt));
  }

  const row = await createVipInvestment({
    userId,
    principalUsd: amt,
    startedAt: now,
    maturesAt,
  });

  console.info('[admin/vip-farmers/initiate]', {
    adminUser,
    userId,
    investmentId: row.id,
    principalUsd: amt,
    fundFrom: mode,
    reason: reasonText,
    startedAt: now,
    maturesAt,
    lockDays: VIP_ACCRUAL_MAX_WORKING_DAYS,
  });

  return {
    investment: await enrichVipInvestmentApi(row),
    cashWalletUsd: mode === 'cash' ? roundUsd(cash - amt) : cash,
    fundFrom: mode,
    lockDays: VIP_ACCRUAL_MAX_WORKING_DAYS,
    reason: reasonText,
  };
}

function adminPatchError(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  return err;
}

async function adminUpdateVipInvestment(investmentId, body = {}, adminUser) {
  const reasonText = String(body.reason || '').trim();
  if (!reasonText) throw adminPatchError('Reason is required');

  const inv = await getVipInvestmentById(investmentId);
  if (!inv) throw adminPatchError('Investment not found');

  const patch = {};
  if (body.principalUsd !== undefined) {
    const p = roundUsd(body.principalUsd);
    if (!Number.isFinite(p) || p <= 0) throw adminPatchError('principalUsd must be greater than 0');
    patch.principalUsd = p;
  }
  if (body.startedAt !== undefined) {
    const d = new Date(body.startedAt);
    if (Number.isNaN(d.getTime())) throw adminPatchError('Invalid startedAt');
    patch.startedAt = d.toISOString();
  }
  if (body.maturesAt !== undefined) {
    const d = new Date(body.maturesAt);
    if (Number.isNaN(d.getTime())) throw adminPatchError('Invalid maturesAt');
    patch.maturesAt = d.toISOString();
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!['active', 'matured', 'early_withdrawn', 'closed'].includes(status)) {
      throw adminPatchError('status must be active, matured, early_withdrawn, or closed');
    }
    patch.status = status;
  }
  if (body.totalAccruedUsd !== undefined) {
    const t = roundUsd(body.totalAccruedUsd);
    if (!Number.isFinite(t) || t < 0) throw adminPatchError('totalAccruedUsd must be >= 0');
    patch.totalAccruedUsd = t;
  }
  if (body.daysAccrued !== undefined) {
    const d = Number(body.daysAccrued);
    if (!Number.isInteger(d) || d < 0 || d > VIP_ACCRUAL_MAX_WORKING_DAYS) {
      throw adminPatchError(`daysAccrued must be an integer from 0 to ${VIP_ACCRUAL_MAX_WORKING_DAYS}`);
    }
    patch.daysAccrued = d;
  }
  if (body.revenueWithdrawnUsd !== undefined) {
    const r = roundUsd(body.revenueWithdrawnUsd);
    if (!Number.isFinite(r) || r < 0) throw adminPatchError('revenueWithdrawnUsd must be >= 0');
    patch.revenueWithdrawnUsd = r;
  }

  if (!Object.keys(patch).length) throw adminPatchError('No fields to update');

  const nextTotal = patch.totalAccruedUsd ?? Number(inv.total_accrued_usd);
  const nextRevenue = patch.revenueWithdrawnUsd ?? Number(inv.revenue_withdrawn_usd || 0);
  if (nextRevenue > nextTotal) {
    throw adminPatchError('revenueWithdrawnUsd cannot exceed totalAccruedUsd');
  }

  const row = await updateVipInvestment(investmentId, patch);
  console.info('[admin/vip-farmers/update]', {
    adminUser,
    investmentId,
    userId: inv.user_id,
    patch,
    reason: reasonText,
  });
  return { investment: await enrichVipInvestmentApi(row), reason: reasonText };
}

async function adminUpdateVipInvestmentForUser(userId, body, adminUser) {
  const inv = await getActiveVipInvestmentForUser(userId);
  if (!inv) throw adminPatchError('No active VIP investment for this user');
  return adminUpdateVipInvestment(inv.id, body, adminUser);
}

async function listAdminVipInvestments() {
  const rows = await listActiveVipInvestmentsAdmin();
  const users = await getUsersByIds(rows.map((r) => r.user_id));
  const emailById = Object.fromEntries(users.map((u) => [u.id, u.email]));
  const investments = [];
  for (const row of rows) {
    const api = await enrichVipInvestmentApi(row);
    investments.push({ ...api, userEmail: emailById[row.user_id] || null });
  }
  return { investments, count: investments.length };
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
    status: 'active',
  });

  return {
    investment: await enrichVipInvestmentApi(row),
    cashWalletUsd: roundUsd(cash - amt),
    addedUsd: amt,
    lockReset: true,
  };
}

async function reinvestVip(userId, amount) {
  const pending = await getPendingVipExitForUser(userId);
  if (pending) {
    const err = new Error('Cannot reinvest while an exit request is pending');
    err.statusCode = 400;
    throw err;
  }

  const inv = await getActiveVipInvestmentForUser(userId);
  if (!inv) {
    const err = new Error('No active VIP investment');
    err.statusCode = 400;
    throw err;
  }

  const avail = availableRevenue(inv);
  const quote = computeReinvestQuote(amount, avail);
  if (quote.grossRevenue <= 0 || quote.grossRevenue > avail) {
    const err = new Error('Invalid reinvest amount');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const maturesAt = maturityAtFromStart(now);
  const previousPrincipal = roundUsd(inv.principal_usd);
  const newPrincipal = roundUsd(previousPrincipal + quote.reinvestedUsd);
  const newRevenueWithdrawn = roundUsd(Number(inv.revenue_withdrawn_usd || 0) + quote.grossRevenue);

  const row = await updateVipInvestment(inv.id, {
    principalUsd: newPrincipal,
    startedAt: now,
    maturesAt,
    daysAccrued: 0,
    revenueWithdrawnUsd: newRevenueWithdrawn,
    status: 'active',
  });

  await insertVipReinvestEvent({
    id: repoNewId(),
    user_id: userId,
    investment_id: inv.id,
    amount_usd: quote.reinvestedUsd,
    previous_principal_usd: previousPrincipal,
    new_principal_usd: newPrincipal,
    lock_reset: true,
    created_at: now,
  }).catch(() => null);

  if (quote.commissionUsd > 0) {
    await insertPlatformRevenueEvent({
      userId,
      investmentId: inv.id,
      eventType: 'vip_reinvest_commission',
      amountUsd: quote.commissionUsd,
      meta: { grossRevenue: quote.grossRevenue },
    }).catch(() => null);
  }

  return {
    investment: await enrichVipInvestmentApi(row),
    reinvestedUsd: quote.reinvestedUsd,
    commissionUsd: quote.commissionUsd,
    grossRevenueUsd: quote.grossRevenue,
    lockReset: true,
  };
}

async function withdrawVipAtMaturity(userId) {
  const err = new Error('Use POST /vip-farmers/exit/request for withdrawals');
  err.statusCode = 400;
  throw err;
}

async function earlyWithdrawVip(userId) {
  const err = new Error('Use POST /vip-farmers/exit/request for early exit');
  err.statusCode = 400;
  throw err;
}

async function tryAccrueVipDay(inv, planDate) {
  const startYmd = utcYmdFromIso(inv.started_at);
  if (planDate < startYmd) {
    return { applied: false, skipped: true, inv };
  }
  if (!isVipAccrualDayYmd(planDate)) {
    return { applied: false, skipped: true, inv };
  }
  if (Number(inv.days_accrued) >= VIP_ACCRUAL_MAX_WORKING_DAYS) {
    return { applied: false, skipped: true, inv };
  }
  const existing = await getVipAccrualForInvestmentDay(inv.id, planDate);
  if (existing) {
    return { applied: false, skipped: true, inv };
  }

  const { gross, platformFee, net } = dailyAccrualAmounts(inv.principal_usd);
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
    commission_rate: PLATFORM_FEE_VIP_RATE,
    commission_amount: platformFee,
    created_at: new Date().toISOString(),
  });

  if (platformFee > 0) {
    await insertPlatformRevenueEvent({
      userId: inv.user_id,
      investmentId: inv.id,
      eventType: 'vip_accrual',
      amountUsd: platformFee,
      meta: { accrualDate: planDate, gross },
    });
  }

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
    while (cursor <= planDate && Number(current.days_accrued) < VIP_ACCRUAL_MAX_WORKING_DAYS) {
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
  adminInitiateVipInvestment,
  adminUpdateVipInvestment,
  adminUpdateVipInvestmentForUser,
  listAdminVipInvestments,
  addCapitalVip,
  reinvestVip,
  withdrawVipAtMaturity,
  earlyWithdrawVip,
  runVipDailyAccrual,
  enrichVipInvestmentApi,
};
