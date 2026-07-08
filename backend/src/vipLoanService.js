const {
  ensureWalletForUser,
  setWalletBalance,
  createTransaction,
  getActiveVipInvestmentForUser,
  getWalletByUserId,
} = require('./db');
const {
  VIP_LOAN_COMMISSION_RATE,
  VIP_LOAN_MIN_USD,
  VIP_LOAN_MIN_ACCRUAL_DAYS,
  VIP_LOAN_EARNINGS_WINDOW_DAYS,
  roundUsd,
} = require('./vipFarmerConstants');
const {
  newId,
  getOpenVipLoanForUser,
  insertVipLoan,
  updateVipLoan,
  getVipLoanById,
  listVipLoansAdmin,
  countLifetimeVipAccrualDays,
  sumVipAccrualsLastDays,
  loanToApi,
  insertPlatformRevenueEvent,
} = require('./vipFarmerRepository');

function badRequest(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  throw err;
}

async function getVipLoanStatus(userId) {
  const inv = await getActiveVipInvestmentForUser(userId);
  const openLoan = await getOpenVipLoanForUser(userId);
  const lifetimeAccruals = await countLifetimeVipAccrualDays(userId);
  const lastMonthEarnings = roundUsd(await sumVipAccrualsLastDays(userId, VIP_LOAN_EARNINGS_WINDOW_DAYS));
  const maxLoanUsd = lastMonthEarnings;
  const eligible =
    Boolean(inv) &&
    lifetimeAccruals >= VIP_LOAN_MIN_ACCRUAL_DAYS &&
    lastMonthEarnings >= VIP_LOAN_MIN_USD &&
    !openLoan;

  return {
    eligible,
    lifetimeAccrualDays: lifetimeAccruals,
    lastMonthEarningsUsd: lastMonthEarnings,
    maxLoanUsd,
    minLoanUsd: VIP_LOAN_MIN_USD,
    commissionRate: VIP_LOAN_COMMISSION_RATE,
    loan: loanToApi(openLoan),
    blocksWithdrawals: Boolean(openLoan),
  };
}

async function requestVipLoan(userId, amount) {
  const amt = roundUsd(amount);
  if (!Number.isFinite(amt) || amt < VIP_LOAN_MIN_USD) {
    badRequest(`Minimum loan is $${VIP_LOAN_MIN_USD}`);
  }

  const status = await getVipLoanStatus(userId);
  if (!status.eligible) badRequest('Not eligible for a VIP loan');
  if (amt > status.maxLoanUsd) badRequest(`Maximum loan is $${status.maxLoanUsd}`);

  const inv = await getActiveVipInvestmentForUser(userId);
  const commission = roundUsd(amt * VIP_LOAN_COMMISSION_RATE);
  const disbursed = roundUsd(amt - commission);

  const row = await insertVipLoan({
    id: newId(),
    user_id: userId,
    investment_id: inv?.id || null,
    amount_usd: amt,
    commission_rate: VIP_LOAN_COMMISSION_RATE,
    commission_usd: commission,
    disbursed_usd: disbursed,
    last_month_earnings_usd: status.lastMonthEarningsUsd,
    max_loan_usd: status.maxLoanUsd,
    outstanding_usd: amt,
    repaid_usd: 0,
    status: 'pending',
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

  const wallet = await ensureWalletForUser(loan.user_id);
  const cash = roundUsd(wallet?.balance);
  const disbursed = roundUsd(loan.disbursed_usd);
  await setWalletBalance(loan.user_id, roundUsd(cash + disbursed));
  await createTransaction({
    userId: loan.user_id,
    type: 'deposit',
    amount: disbursed,
    status: 'completed',
  });

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
    admin_note: adminNote || null,
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
