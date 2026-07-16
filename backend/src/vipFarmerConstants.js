/** VIP Farmers business constants — 9% gross daily (product), spec-aligned lock/exit/loan rules. */

const VIP_DAILY_RATE = 0.09;
const PLATFORM_FEE_VIP_RATE = 0.03;
const VIP_NET_ACCRUAL_MULTIPLIER = 1 - PLATFORM_FEE_VIP_RATE; // 97% of gross

const VIP_LOCK_DAYS_CALENDAR = 38;
const VIP_ACCRUAL_MAX_WORKING_DAYS = 22;
const VIP_ACCRUAL_WEEKDAYS = 5;
const VIP_MIN_INVEST_USD = 100;

const VIP_EXIT_PENALTY_RATE = 0.3;
const VIP_EXIT_COMMISSION_RATE = 0.3;
const VIP_GAS_RATE_PER_CHARGE = 0.000396;
const VIP_GAS_CHARGES_PER_DAY = 40;
const VIP_GAS_REWARD_RATE = 0.3;
const VIP_GAS_DEFAULT_WORKING_DAYS = 38;
const VIP_INVESTMENT_EXTRA_CREDIT_USD = 1000;
const VIP_INVESTMENT_EXTRA_CREDIT_MIN_PRINCIPAL = 4900;
const VIP_INVESTMENT_EXTRA_CREDIT_MIN_WORKING_DAYS = 22;
const VIP_EXIT_REVENUE_PERCENTS = [50, 60, 70, 80, 90, 100];

const VIP_LOAN_COMMISSION_RATE = 0.3;
const VIP_LOAN_ESTABLISHED_COMMISSION_RATE = 0.3;
const VIP_LOAN_NEW_COMMISSION_RATE = 0.1;
const VIP_LOAN_NEW_USER_FACTOR = 0.5;
const VIP_LOAN_MIN_PRINCIPAL_USD = 2500;
const VIP_LOAN_MIN_ACCRUAL_DAYS = 22;
const VIP_LOAN_EARNINGS_WINDOW_DAYS = 30;
const VIP_LOAN_DISBURSE_BUSINESS_DAYS = 3;
const VIP_LOAN_APPROVAL_MAX_DAYS = 2;
const VIP_LOAN_MIN_USD = 10;
const VIP_LOAN_RECIPIENT_EXEMPT_DEPOSIT_USD = 5000;
const VIP_LOAN_RECIPIENT_DEPOSIT_WINDOW_DAYS = 3;

/** @deprecated use VIP_ACCRUAL_MAX_WORKING_DAYS */
const VIP_LOCK_DAYS = VIP_ACCRUAL_MAX_WORKING_DAYS;
/** @deprecated use PLATFORM_FEE_VIP_RATE for accrual */
const VIP_COMMISSION_RATE = PLATFORM_FEE_VIP_RATE;
const VIP_EARLY_PENALTY_RATE = VIP_EXIT_PENALTY_RATE;

function roundUsd(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function maturityAtFromStart(startedAt) {
  const d = new Date(startedAt);
  d.setUTCDate(d.getUTCDate() + VIP_LOCK_DAYS_CALENDAR);
  return d.toISOString();
}

function availableRevenue(inv) {
  const total = Number(inv?.total_accrued_usd ?? 0);
  const withdrawn = Number(inv?.revenue_withdrawn_usd ?? 0);
  return roundUsd(Math.max(0, total - withdrawn));
}

const { calendarDaysSinceStart } = require('./vipFarmerSchedule');

function isPenaltyFreeExit(inv, asOfYmd) {
  const workingDays = Number(inv?.days_accrued ?? 0);
  const calendarDays = calendarDaysSinceStart(inv.started_at, asOfYmd);
  return (
    workingDays >= VIP_ACCRUAL_MAX_WORKING_DAYS ||
    calendarDays >= VIP_LOCK_DAYS_CALENDAR
  );
}

function computeExitQuote({
  principalUsd,
  totalAccruedUsd,
  revenueWithdrawnUsd,
  daysAccrued,
  startedAt,
  mode,
  revenuePercent,
  asOfYmd,
}) {
  const principal = roundUsd(principalUsd);
  const revenueBase = roundUsd(Math.max(0, Number(totalAccruedUsd) - Number(revenueWithdrawnUsd)));
  const pct = Number(revenuePercent);
  const revenueSelected = roundUsd((revenueBase * pct) / 100);
  const workingDays = Number(daysAccrued) || 0;
  const calendarDays = calendarDaysSinceStart(startedAt, asOfYmd);
  const penaltyFree = workingDays >= VIP_ACCRUAL_MAX_WORKING_DAYS || calendarDays >= VIP_LOCK_DAYS_CALENDAR;
  const penalty = penaltyFree ? 0 : roundUsd(revenueSelected * VIP_EXIT_PENALTY_RATE);
  const gasWorkingDays = workingDays > 0 ? workingDays : VIP_GAS_DEFAULT_WORKING_DAYS;
  const gasFees =
    mode === 'full_stop'
      ? roundUsd(principal * VIP_GAS_RATE_PER_CHARGE * VIP_GAS_CHARGES_PER_DAY * gasWorkingDays)
      : 0;
  const commission = roundUsd(revenueSelected * VIP_EXIT_COMMISSION_RATE);
  const gasReward = roundUsd(gasFees * VIP_GAS_REWARD_RATE);
  const netRevenue = roundUsd(
    Math.max(0, revenueSelected - penalty - gasFees - commission + gasReward)
  );
  const principalReturn = mode === 'full_stop' ? principal : 0;
  const investmentExtraCredit =
    mode === 'full_stop' &&
    principal > VIP_INVESTMENT_EXTRA_CREDIT_MIN_PRINCIPAL &&
    workingDays > VIP_INVESTMENT_EXTRA_CREDIT_MIN_WORKING_DAYS
      ? VIP_INVESTMENT_EXTRA_CREDIT_USD
      : 0;
  const netTotal = roundUsd(netRevenue + principalReturn + investmentExtraCredit);

  return {
    principalUsd: principal,
    revenueBaseUsd: revenueBase,
    revenueSelectedUsd: revenueSelected,
    penaltyUsd: penalty,
    gasFeesUsd: gasFees,
    commissionUsd: commission,
    gasRewardUsd: gasReward,
    netRevenueUsd: netRevenue,
    principalReturnUsd: principalReturn,
    investmentExtraCreditUsd: investmentExtraCredit,
    netTotalUsd: netTotal,
    workingDays,
    calendarDays,
    penaltyFree,
  };
}

function computeReinvestQuote(amountUsd, available) {
  const grossRevenue = roundUsd(amountUsd != null ? amountUsd : available);
  const commission = roundUsd(grossRevenue * VIP_EXIT_COMMISSION_RATE);
  const reinvestedUsd = roundUsd(grossRevenue - commission);
  return { grossRevenue, commissionUsd: commission, reinvestedUsd };
}

function dailyAccrualAmounts(principalUsd) {
  const principal = roundUsd(principalUsd);
  const gross = roundUsd(principal * VIP_DAILY_RATE);
  const platformFee = roundUsd(gross * PLATFORM_FEE_VIP_RATE);
  const net = roundUsd(gross - platformFee);
  return { gross, platformFee, net };
}

module.exports = {
  VIP_DAILY_RATE,
  PLATFORM_FEE_VIP_RATE,
  VIP_NET_ACCRUAL_MULTIPLIER,
  VIP_LOCK_DAYS_CALENDAR,
  VIP_ACCRUAL_MAX_WORKING_DAYS,
  VIP_ACCRUAL_WEEKDAYS,
  VIP_MIN_INVEST_USD,
  VIP_EXIT_PENALTY_RATE,
  VIP_EXIT_COMMISSION_RATE,
  VIP_GAS_RATE_PER_CHARGE,
  VIP_GAS_CHARGES_PER_DAY,
  VIP_GAS_REWARD_RATE,
  VIP_GAS_DEFAULT_WORKING_DAYS,
  VIP_INVESTMENT_EXTRA_CREDIT_USD,
  VIP_INVESTMENT_EXTRA_CREDIT_MIN_PRINCIPAL,
  VIP_INVESTMENT_EXTRA_CREDIT_MIN_WORKING_DAYS,
  VIP_EXIT_REVENUE_PERCENTS,
  VIP_LOAN_COMMISSION_RATE,
  VIP_LOAN_ESTABLISHED_COMMISSION_RATE,
  VIP_LOAN_NEW_COMMISSION_RATE,
  VIP_LOAN_NEW_USER_FACTOR,
  VIP_LOAN_MIN_PRINCIPAL_USD,
  VIP_LOAN_MIN_ACCRUAL_DAYS,
  VIP_LOAN_EARNINGS_WINDOW_DAYS,
  VIP_LOAN_DISBURSE_BUSINESS_DAYS,
  VIP_LOAN_APPROVAL_MAX_DAYS,
  VIP_LOAN_MIN_USD,
  VIP_LOAN_RECIPIENT_EXEMPT_DEPOSIT_USD,
  VIP_LOAN_RECIPIENT_DEPOSIT_WINDOW_DAYS,
  VIP_LOCK_DAYS,
  VIP_COMMISSION_RATE,
  VIP_EARLY_PENALTY_RATE,
  roundUsd,
  maturityAtFromStart,
  availableRevenue,
  isPenaltyFreeExit,
  computeExitQuote,
  computeReinvestQuote,
  dailyAccrualAmounts,
};
