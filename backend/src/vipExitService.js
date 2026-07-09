const crypto = require('crypto');
const {
  ensureWalletForUser,
  setWalletBalance,
  createTransaction,
  getActiveVipInvestmentForUser,
  updateVipInvestment,
  utcTodayYmd,
  isMissingTableError,
} = require('./db');
const {
  VIP_EXIT_REVENUE_PERCENTS,
  computeExitQuote,
  roundUsd,
} = require('./vipFarmerConstants');
const {
  getPendingVipExitForUser,
  listVipExitRequestsForUser,
  insertVipExitRequest,
  updateVipExitRequest,
  getVipExitRequestById,
  listVipExitRequestsAdmin,
  exitRequestToApi,
} = require('./vipExitStorage');

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
    userId,
    inv,
    mode,
    revenuePercent,
    destination,
    walletAddress,
    quote,
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

function quoteFromTicket(row) {
  const p = row.payload || {};
  return {
    revenueSelectedUsd: Number(p.revenueSelectedUsd),
    penaltyUsd: Number(p.penaltyUsd),
    gasFeesUsd: Number(p.gasFeesUsd),
    commissionUsd: Number(p.commissionUsd),
    gasRewardUsd: Number(p.gasRewardUsd),
    investmentExtraCreditUsd: Number(p.investmentExtraCreditUsd),
    principalReturnUsd: Number(p.principalReturnUsd),
  };
}

async function previewApproveVipExit(exitId, overrides = {}) {
  const row = await getVipExitRequestById(exitId);
  if (!row) badRequest('Exit request not found');
  if (!mapPending(row.status)) badRequest('Exit request is not pending');
  const applied = applyExitOverrides(quoteFromTicket(row), overrides);
  return { request: exitRequestToApi(row), applied };
}

function mapPending(status) {
  return status === 'under_review' || status === 'in_progress';
}

async function safeUpdateVipInvestment(investmentId, patch) {
  try {
    return await updateVipInvestment(investmentId, patch);
  } catch (e) {
    if (patch.revenueWithdrawnUsd !== undefined && isMissingTableError(e)) {
      const { revenueWithdrawnUsd, ...rest } = patch;
      if (Object.keys(rest).length === 0) return null;
      return updateVipInvestment(investmentId, rest);
    }
    throw e;
  }
}

async function approveVipExit(exitId, { adminNote, overrides } = {}) {
  const row = await getVipExitRequestById(exitId);
  if (!row) badRequest('Exit request not found');
  if (!mapPending(row.status)) badRequest('Exit request is not pending');

  const p = row.payload || {};
  const inv = await getActiveVipInvestmentForUser(row.user_id);
  if (!inv || inv.id !== p.investmentId) badRequest('Investment no longer active');

  const applied = applyExitOverrides(quoteFromTicket(row), overrides || {});
  const now = new Date().toISOString();

  if (p.destination === 'platform' && applied.netTotalUsd > 0) {
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

  const revenueWithdrawn = roundUsd(
    Number(inv.revenue_withdrawn_usd || 0) + Number(p.revenueSelectedUsd || 0)
  );
  const invPatch = { revenueWithdrawnUsd: revenueWithdrawn };
  if (p.mode === 'full_stop') {
    invPatch.status = p.penaltyFree ? 'closed' : 'early_withdrawn';
  }
  await safeUpdateVipInvestment(inv.id, invPatch);

  const updated = await updateVipExitRequest(row.id, {
    status: 'completed',
    admin_note: adminNote || null,
    reviewed_at: now,
    applied,
  });

  return { request: exitRequestToApi(updated) };
}

async function rejectVipExit(exitId, adminNote) {
  const row = await getVipExitRequestById(exitId);
  if (!row) badRequest('Exit request not found');
  if (!mapPending(row.status)) badRequest('Exit request is not pending');
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
