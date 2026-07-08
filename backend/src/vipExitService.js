const crypto = require('crypto');
const {
  ensureWalletForUser,
  setWalletBalance,
  getWalletByUserId,
  createTransaction,
  getActiveVipInvestmentForUser,
  updateVipInvestment,
  utcTodayYmd,
} = require('./db');
const {
  VIP_EXIT_REVENUE_PERCENTS,
  VIP_EXIT_COMMISSION_RATE,
  computeExitQuote,
  roundUsd,
  isPenaltyFreeExit,
} = require('./vipFarmerConstants');
const {
  newId,
  getPendingVipExitForUser,
  listVipExitRequestsForUser,
  insertVipExitRequest,
  updateVipExitRequest,
  getVipExitRequestById,
  listVipExitRequestsAdmin,
  exitRequestToApi,
  insertPlatformRevenueEvent,
} = require('./vipFarmerRepository');

function badRequest(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  throw err;
}

async function previewVipExit(userId, body) {
  const inv = await getActiveVipInvestmentForUser(userId);
  if (!inv) badRequest('No active VIP investment');
  const mode = body?.mode === 'partial_continue' ? 'partial_continue' : 'full_stop';
  const revenuePercent = Number(body?.revenuePercent);
  if (!VIP_EXIT_REVENUE_PERCENTS.includes(revenuePercent)) {
    badRequest('revenuePercent must be one of: ' + VIP_EXIT_REVENUE_PERCENTS.join(', '));
  }
  const today = utcTodayYmd();
  const quote = computeExitQuote({
    principalUsd: inv.principal_usd,
    totalAccruedUsd: inv.total_accrued_usd,
    revenueWithdrawnUsd: inv.revenue_withdrawn_usd,
    daysAccrued: inv.days_accrued,
    startedAt: inv.started_at,
    mode,
    revenuePercent,
    asOfYmd: today,
  });
  return {
    mode,
    revenuePercent,
    destination: body?.destination === 'direct_wallet' ? 'direct_wallet' : 'platform',
    penaltyFree: quote.penaltyFree,
    ...quote,
    revenuePercents: VIP_EXIT_REVENUE_PERCENTS,
  };
}

async function requestVipExit(userId, body) {
  const pending = await getPendingVipExitForUser(userId);
  if (pending) badRequest('You already have a pending exit request');

  const inv = await getActiveVipInvestmentForUser(userId);
  if (!inv) badRequest('No active VIP investment');

  const mode = body?.mode === 'partial_continue' ? 'partial_continue' : 'full_stop';
  const revenuePercent = Number(body?.revenuePercent);
  const destination = body?.destination === 'direct_wallet' ? 'direct_wallet' : 'platform';
  const walletAddress = String(body?.walletAddress || '').trim();

  if (!VIP_EXIT_REVENUE_PERCENTS.includes(revenuePercent)) {
    badRequest('revenuePercent must be one of: ' + VIP_EXIT_REVENUE_PERCENTS.join(', '));
  }
  if (destination === 'direct_wallet' && !walletAddress) {
    badRequest('TRC20 wallet address is required for direct wallet destination');
  }

  const today = utcTodayYmd();
  const quote = computeExitQuote({
    principalUsd: inv.principal_usd,
    totalAccruedUsd: inv.total_accrued_usd,
    revenueWithdrawnUsd: inv.revenue_withdrawn_usd,
    daysAccrued: inv.days_accrued,
    startedAt: inv.started_at,
    mode,
    revenuePercent,
    asOfYmd: today,
  });

  if (quote.revenueBaseUsd <= 0 && mode === 'partial_continue') {
    badRequest('No available revenue to withdraw');
  }

  const row = await insertVipExitRequest({
    id: newId(),
    user_id: userId,
    investment_id: inv.id,
    mode,
    revenue_percent: revenuePercent,
    destination,
    wallet_address: destination === 'direct_wallet' ? walletAddress : null,
    principal_usd: quote.principalUsd,
    revenue_base_usd: quote.revenueBaseUsd,
    revenue_selected_usd: quote.revenueSelectedUsd,
    penalty_usd: quote.penaltyUsd,
    gas_fees_usd: quote.gasFeesUsd,
    commission_usd: quote.commissionUsd,
    gas_reward_usd: quote.gasRewardUsd,
    net_revenue_usd: quote.netRevenueUsd,
    principal_return_usd: quote.principalReturnUsd,
    net_total_usd: quote.netTotalUsd,
    investment_extra_credit_usd: quote.investmentExtraCreditUsd,
    working_days: quote.workingDays,
    calendar_days: quote.calendarDays,
    penalty_free: quote.penaltyFree,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return { request: exitRequestToApi(row) };
}

async function listUserVipExitRequests(userId) {
  const rows = await listVipExitRequestsForUser(userId, 20);
  return { requests: rows.map(exitRequestToApi).filter(Boolean) };
}

function applyExitOverrides(quote, overrides = {}) {
  const penaltyUsd = overrides.penaltyUsd != null ? roundUsd(overrides.penaltyUsd) : quote.penaltyUsd;
  const gasFeesUsd = overrides.gasFeesUsd != null ? roundUsd(overrides.gasFeesUsd) : quote.gasFeesUsd;
  const commissionUsd =
    overrides.commissionUsd != null ? roundUsd(overrides.commissionUsd) : quote.commissionUsd;
  const gasRewardUsd = overrides.gasRewardUsd != null ? roundUsd(overrides.gasRewardUsd) : quote.gasRewardUsd;
  const investmentExtraCreditUsd =
    overrides.investmentExtraCreditUsd != null
      ? roundUsd(overrides.investmentExtraCreditUsd)
      : quote.investmentExtraCreditUsd;
  const netRevenueUsd = roundUsd(
    Math.max(0, quote.revenueSelectedUsd - penaltyUsd - gasFeesUsd - commissionUsd + gasRewardUsd)
  );
  const netTotalUsd = roundUsd(netRevenueUsd + quote.principalReturnUsd + investmentExtraCreditUsd);
  return {
    penaltyUsd,
    gasFeesUsd,
    commissionUsd,
    gasRewardUsd,
    investmentExtraCreditUsd,
    netRevenueUsd,
    netTotalUsd,
  };
}

async function previewApproveVipExit(exitId, overrides = {}) {
  const row = await getVipExitRequestById(exitId);
  if (!row) badRequest('Exit request not found');
  if (row.status !== 'pending') badRequest('Exit request is not pending');
  const applied = applyExitOverrides(
    {
      revenueSelectedUsd: Number(row.revenue_selected_usd),
      penaltyUsd: Number(row.penalty_usd),
      gasFeesUsd: Number(row.gas_fees_usd),
      commissionUsd: Number(row.commission_usd),
      gasRewardUsd: Number(row.gas_reward_usd),
      investmentExtraCreditUsd: Number(row.investment_extra_credit_usd),
      principalReturnUsd: Number(row.principal_return_usd),
    },
    overrides
  );
  return { request: exitRequestToApi(row), applied };
}

async function approveVipExit(exitId, { adminNote, overrides } = {}) {
  const row = await getVipExitRequestById(exitId);
  if (!row) badRequest('Exit request not found');
  if (row.status !== 'pending') badRequest('Exit request is not pending');

  const inv = await getActiveVipInvestmentForUser(row.user_id);
  if (!inv || inv.id !== row.investment_id) badRequest('Investment no longer active');

  const applied = applyExitOverrides(
    {
      revenueSelectedUsd: Number(row.revenue_selected_usd),
      penaltyUsd: Number(row.penalty_usd),
      gasFeesUsd: Number(row.gas_fees_usd),
      commissionUsd: Number(row.commission_usd),
      gasRewardUsd: Number(row.gas_reward_usd),
      investmentExtraCreditUsd: Number(row.investment_extra_credit_usd),
      principalReturnUsd: Number(row.principal_return_usd),
    },
    overrides || {}
  );

  const now = new Date().toISOString();
  if (row.destination === 'platform' && applied.netTotalUsd > 0) {
    const wallet = await ensureWalletForUser(row.user_id);
    const cash = roundUsd(wallet?.balance);
    await setWalletBalance(row.user_id, roundUsd(cash + applied.netTotalUsd));
    await createTransaction({
      userId: row.user_id,
      type: 'deposit',
      amount: applied.netTotalUsd,
      status: 'completed',
    });
  }

  const revenueWithdrawn = roundUsd(Number(inv.revenue_withdrawn_usd) + Number(row.revenue_selected_usd));
  const invPatch = { revenueWithdrawnUsd: revenueWithdrawn };

  if (row.mode === 'full_stop') {
    invPatch.status = row.penalty_free ? 'closed' : 'early_withdrawn';
  }

  await updateVipInvestment(inv.id, invPatch);

  if (applied.commissionUsd > 0) {
    await insertPlatformRevenueEvent({
      userId: row.user_id,
      investmentId: inv.id,
      eventType: 'vip_exit_commission',
      amountUsd: applied.commissionUsd,
      meta: { exitRequestId: row.id },
    });
  }

  const updated = await updateVipExitRequest(row.id, {
    status: 'completed',
    admin_note: adminNote || null,
    reviewed_at: now,
    applied_penalty_usd: applied.penaltyUsd,
    applied_gas_fees_usd: applied.gasFeesUsd,
    applied_commission_usd: applied.commissionUsd,
    applied_gas_reward_usd: applied.gasRewardUsd,
    applied_investment_extra_credit_usd: applied.investmentExtraCreditUsd,
    applied_net_revenue_usd: applied.netRevenueUsd,
    applied_net_total_usd: applied.netTotalUsd,
  });

  return { request: exitRequestToApi(updated) };
}

async function rejectVipExit(exitId, adminNote) {
  const row = await getVipExitRequestById(exitId);
  if (!row) badRequest('Exit request not found');
  if (row.status !== 'pending') badRequest('Exit request is not pending');
  const updated = await updateVipExitRequest(row.id, {
    status: 'rejected',
    admin_note: adminNote || null,
    reviewed_at: new Date().toISOString(),
  });
  return { request: exitRequestToApi(updated) };
}

async function listAdminVipExitRequests(status = 'pending') {
  const rows = await listVipExitRequestsAdmin({ status, limit: 200 });
  return { requests: rows.map(exitRequestToApi).filter(Boolean) };
}

module.exports = {
  previewVipExit,
  requestVipExit,
  listUserVipExitRequests,
  previewApproveVipExit,
  approveVipExit,
  rejectVipExit,
  listAdminVipExitRequests,
};
