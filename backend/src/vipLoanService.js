const {
  ensureWalletForUser,
  setWalletBalance,
  createTransaction,
  getActiveVipInvestmentForUser,
  isAddressWhitelistedForUser,
  utcTodayYmd,
} = require('./db');
const {
  VIP_LOAN_MIN_USD,
  VIP_LOAN_MIN_PRINCIPAL_USD,
  VIP_LOAN_MIN_ACCRUAL_DAYS,
  VIP_LOAN_ESTABLISHED_COMMISSION_RATE,
  VIP_LOAN_NEW_COMMISSION_RATE,
  VIP_LOAN_NEW_USER_FACTOR,
  VIP_LOAN_DISBURSE_BUSINESS_DAYS,
  dailyAccrualAmounts,
  roundUsd,
} = require('./vipFarmerConstants');
const { countWeekdaysInclusive, utcYmdFromIso } = require('./vipFarmerSchedule');
const {
  newId,
  getOpenVipLoanForUser,
  insertVipLoan,
  updateVipLoan,
  getVipLoanById,
  listVipLoansAdmin,
  countLifetimeVipAccrualDays,
  loanToApi,
  insertPlatformRevenueEvent,
} = require('./vipFarmerRepository');

function badRequest(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  throw err;
}

function currentMonthRangeYmd(asOfYmd) {
  const [y, m] = String(asOfYmd).slice(0, 10).split('-').map(Number);
  const startYmd = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const endYmd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startYmd, endYmd };
}

function projectedMonthlyNetAccrualUsd(inv, asOfYmd) {
  const { startYmd, endYmd } = currentMonthRangeYmd(asOfYmd);
  const invStart = utcYmdFromIso(inv.started_at);
  const rangeStart = invStart > startYmd ? invStart : startYmd;
  if (rangeStart > endYmd) return 0;
  const weekdays = countWeekdaysInclusive(rangeStart, endYmd);
  const { net } = dailyAccrualAmounts(Number(inv.principal_usd));
  return roundUsd(weekdays * net);
}

function computeVipLoanQuote(inv, lifetimeAccrualDays) {
  const today = utcTodayYmd();
  const monthlyAccrualUsd = projectedMonthlyNetAccrualUsd(inv, today);
  const isEstablished = lifetimeAccrualDays >= VIP_LOAN_MIN_ACCRUAL_DAYS;
  const commissionRate = isEstablished ? VIP_LOAN_ESTABLISHED_COMMISSION_RATE : VIP_LOAN_NEW_COMMISSION_RATE;
  const grossMaxUsd = isEstablished
    ? monthlyAccrualUsd
    : roundUsd(monthlyAccrualUsd * VIP_LOAN_NEW_USER_FACTOR);
  const maxLoanUsd = grossMaxUsd;
  const sampleDisbursedUsd = roundUsd(maxLoanUsd * (1 - commissionRate));
  return {
    monthlyAccrualUsd,
    isEstablished,
    commissionRate,
    maxLoanUsd,
    sampleDisbursedUsd,
    newUserFactor: isEstablished ? 1 : VIP_LOAN_NEW_USER_FACTOR,
  };
}

function parseLoanPayoutMeta(row) {
  const raw = row?.admin_note;
  if (!raw) return { destination: 'platform', walletAddress: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      destination: parsed.payoutDestination === 'direct_wallet' ? 'direct_wallet' : 'platform',
      walletAddress: parsed.walletAddress || null,
      disburseWithinBusinessDays: parsed.disburseWithinBusinessDays || VIP_LOAN_DISBURSE_BUSINESS_DAYS,
    };
  } catch {
    return { destination: 'platform', walletAddress: null };
  }
}

function buildLoanAdminNote({ destination, walletAddress }) {
  return JSON.stringify({
    payoutDestination: destination,
    walletAddress: destination === 'direct_wallet' ? walletAddress : null,
    disburseWithinBusinessDays: VIP_LOAN_DISBURSE_BUSINESS_DAYS,
  });
}

function ineligibilityReason({ inv, principalUsd, quote, openLoan }) {
  if (openLoan) return 'You already have a pending or active VIP loan';
  if (!inv || inv.status !== 'active') return 'Active VIP Farmers investment required';
  if (principalUsd < VIP_LOAN_MIN_PRINCIPAL_USD) {
    return `Minimum VIP principal is $${VIP_LOAN_MIN_PRINCIPAL_USD.toLocaleString()}`;
  }
  if (quote.maxLoanUsd < VIP_LOAN_MIN_USD) {
    return 'Projected monthly accrual is too low for a loan';
  }
  return null;
}

async function getVipLoanStatus(userId, invOverride = null) {
  const inv = invOverride ?? (await getActiveVipInvestmentForUser(userId));
  const openLoan = await getOpenVipLoanForUser(userId);
  const lifetimeAccruals = await countLifetimeVipAccrualDays(userId);
  const hasActiveInvestment = Boolean(inv && inv.status === 'active');
  const principalUsd = roundUsd(inv?.principal_usd ?? inv?.principalUsd ?? 0);
  const quote = hasActiveInvestment ? computeVipLoanQuote(inv, lifetimeAccruals) : null;
  const reason = quote
    ? ineligibilityReason({ inv, principalUsd, quote, openLoan })
    : 'Active VIP Farmers investment required';
  const eligible = hasActiveInvestment && !reason;

  return {
    eligible,
    hasActiveInvestment,
    investmentId: inv?.id ?? null,
    ineligibilityReason: eligible ? null : reason,
    principalUsd,
    minPrincipalUsd: VIP_LOAN_MIN_PRINCIPAL_USD,
    lifetimeAccrualDays: lifetimeAccruals,
    monthlyAccrualUsd: quote?.monthlyAccrualUsd ?? 0,
    isEstablished: quote?.isEstablished ?? false,
    lastMonthEarningsUsd: quote?.monthlyAccrualUsd ?? 0,
    maxLoanUsd: quote?.maxLoanUsd ?? 0,
    minLoanUsd: VIP_LOAN_MIN_USD,
    commissionRate: quote?.commissionRate ?? VIP_LOAN_ESTABLISHED_COMMISSION_RATE,
    newUserFactor: quote?.newUserFactor ?? 1,
    disburseWithinBusinessDays: VIP_LOAN_DISBURSE_BUSINESS_DAYS,
    loan: loanToApi(openLoan),
    blocksWithdrawals: Boolean(openLoan),
  };
}

async function requestVipLoan(userId, body = {}) {
  const amt = roundUsd(body.amount);
  if (!Number.isFinite(amt) || amt < VIP_LOAN_MIN_USD) {
    badRequest(`Minimum loan is $${VIP_LOAN_MIN_USD}`);
  }

  const destination = body.destination === 'direct_wallet' ? 'direct_wallet' : 'platform';
  const walletAddress = String(body.walletAddress || '').trim();
  if (destination === 'direct_wallet' && !walletAddress) {
    badRequest('Select a whitelisted wallet for loan payout');
  }

  const status = await getVipLoanStatus(userId);
  if (!status.eligible) badRequest(status.ineligibilityReason || 'Not eligible for a VIP loan');
  if (amt > status.maxLoanUsd) badRequest(`Maximum loan is $${status.maxLoanUsd}`);

  if (destination === 'direct_wallet') {
    const ok = await isAddressWhitelistedForUser(userId, 'usdttrc20', walletAddress);
    if (!ok) badRequest('Loan payout address must be one of your whitelisted wallets');
  }

  const inv = await getActiveVipInvestmentForUser(userId);
  const commission = roundUsd(amt * status.commissionRate);
  const disbursed = roundUsd(amt - commission);

  const row = await insertVipLoan({
    id: newId(),
    user_id: userId,
    investment_id: inv?.id || null,
    amount_usd: amt,
    commission_rate: status.commissionRate,
    commission_usd: commission,
    disbursed_usd: disbursed,
    last_month_earnings_usd: status.monthlyAccrualUsd,
    max_loan_usd: status.maxLoanUsd,
    outstanding_usd: amt,
    repaid_usd: 0,
    status: 'pending',
    admin_note: buildLoanAdminNote({ destination, walletAddress }),
    requested_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return { loan: loanToApi(row) };
}

async function repayVipLoan(userId, amount) {
  const loan = await getOpenVipLoanForUser(userId);
  if (!loan || loan.status !== 'active') badRequest('No active VIP loan to repay');

  const amt = roundUsd(amount);
  if (!Number.isFinite(amt) || amt <= 0) badRequest('Invalid repay amount');

  const wallet = await ensureWalletForUser(userId);
  const cash = roundUsd(wallet?.balance);
  if (cash < amt) badRequest('Insufficient cash wallet balance');

  const outstanding = roundUsd(loan.outstanding_usd);
  const pay = roundUsd(Math.min(amt, outstanding));
  const newRepaid = roundUsd(Number(loan.repaid_usd) + pay);
  const newOutstanding = roundUsd(outstanding - pay);

  await setWalletBalance(userId, roundUsd(cash - pay));
  await createTransaction({
    userId,
    type: 'withdraw',
    amount: pay,
    status: 'completed',
  });

  const now = new Date().toISOString();
  const patch = {
    repaid_usd: newRepaid,
    outstanding_usd: newOutstanding,
    updated_at: now,
  };
  if (newOutstanding <= 0) {
    patch.status = 'repaid';
    patch.repaid_at = now;
    patch.outstanding_usd = 0;
  }

  const updated = await updateVipLoan(loan.id, patch);
  return { loan: loanToApi(updated), cashWalletUsd: roundUsd(cash - pay) };
}

async function approveVipLoan(loanId, adminNote) {
  const loan = await getVipLoanById(loanId);
  if (!loan) badRequest('Loan not found');
  if (loan.status !== 'pending') badRequest('Loan is not pending');

  const payout = parseLoanPayoutMeta(loan);
  const disbursed = roundUsd(loan.disbursed_usd);

  if (payout.destination === 'platform' && disbursed > 0) {
    const wallet = await ensureWalletForUser(loan.user_id);
    const cash = roundUsd(wallet?.balance);
    await setWalletBalance(loan.user_id, roundUsd(cash + disbursed));
    await createTransaction({
      userId: loan.user_id,
      type: 'deposit',
      amount: disbursed,
      status: 'completed',
    });
  }

  if (Number(loan.commission_usd) > 0) {
    await insertPlatformRevenueEvent({
      userId: loan.user_id,
      loanId: loan.id,
      eventType: 'vip_loan_commission',
      amountUsd: loan.commission_usd,
    });
  }

  const now = new Date().toISOString();
  const updated = await updateVipLoan(loan.id, {
    status: 'active',
    admin_note: adminNote || loan.admin_note,
    reviewed_at: now,
    disbursed_at: now,
  });
  return { loan: loanToApi(updated) };
}

async function rejectVipLoan(loanId, adminNote) {
  const loan = await getVipLoanById(loanId);
  if (!loan) badRequest('Loan not found');
  if (loan.status !== 'pending') badRequest('Loan is not pending');
  const updated = await updateVipLoan(loan.id, {
    status: 'rejected',
    admin_note: adminNote || null,
    reviewed_at: new Date().toISOString(),
  });
  return { loan: loanToApi(updated) };
}

async function listAdminVipLoans(status) {
  const rows = await listVipLoansAdmin({ status, limit: 200 });
  return { loans: rows.map(loanToApi).filter(Boolean) };
}

async function userHasVipLoanWithdrawalBlock(userId) {
  const loan = await getOpenVipLoanForUser(userId);
  return Boolean(loan);
}

module.exports = {
  getVipLoanStatus,
  requestVipLoan,
  repayVipLoan,
  approveVipLoan,
  rejectVipLoan,
  listAdminVipLoans,
  userHasVipLoanWithdrawalBlock,
};
