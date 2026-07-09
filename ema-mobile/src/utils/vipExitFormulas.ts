import type { VipExitQuote, VipInvestment } from '../services/vipFarmerService';

const VIP_LOCK_DAYS_CALENDAR = 38;
const VIP_ACCRUAL_MAX_WORKING_DAYS = 22;
const VIP_EXIT_PENALTY_RATE = 0.3;
const VIP_EXIT_COMMISSION_RATE = 0.3;
const VIP_GAS_RATE_PER_CHARGE = 0.000396;
const VIP_GAS_CHARGES_PER_DAY = 40;
const VIP_GAS_REWARD_RATE = 0.3;
const VIP_GAS_DEFAULT_WORKING_DAYS = 38;
const VIP_INVESTMENT_EXTRA_CREDIT_USD = 1000;
const VIP_INVESTMENT_EXTRA_CREDIT_MIN_PRINCIPAL = 4900;
const VIP_INVESTMENT_EXTRA_CREDIT_MIN_WORKING_DAYS = 22;
export const VIP_EXIT_REVENUE_PERCENTS = [50, 60, 70, 80, 90, 100] as const;

function roundUsd(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function utcTodayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function calendarDaysSinceStart(startedAt: string, asOfYmd: string) {
  const startYmd = String(startedAt).slice(0, 10);
  const startMs = Date.parse(`${startYmd}T00:00:00.000Z`);
  const endMs = Date.parse(`${asOfYmd}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 86400000));
}

export function computeVipExitQuote({
  investment,
  availableRevenue,
  mode,
  revenuePercent,
  destination,
  asOfYmd = utcTodayYmd(),
}: {
  investment: VipInvestment;
  availableRevenue: number;
  mode: 'full_stop' | 'partial_continue';
  revenuePercent: number;
  destination: 'platform' | 'direct_wallet';
  asOfYmd?: string;
}): VipExitQuote {
  const principal = roundUsd(investment.principalUsd);
  const revenueWithdrawn = Number(investment.revenueWithdrawnUsd || 0);
  const totalAccrued = Number(investment.totalAccruedUsd || 0);
  const revenueBase = roundUsd(Math.max(0, availableRevenue ?? totalAccrued - revenueWithdrawn));
  const pct = Number(revenuePercent);
  const revenueSelected = roundUsd((revenueBase * pct) / 100);
  const workingDays = Number(investment.daysAccrued || 0);
  const calendarDays = calendarDaysSinceStart(investment.startedAt, asOfYmd);
  const penaltyFree =
    workingDays >= VIP_ACCRUAL_MAX_WORKING_DAYS || calendarDays >= VIP_LOCK_DAYS_CALENDAR;
  const penalty = penaltyFree ? 0 : roundUsd(revenueSelected * VIP_EXIT_PENALTY_RATE);
  const gasWorkingDays = workingDays > 0 ? workingDays : VIP_GAS_DEFAULT_WORKING_DAYS;
  const gasFees =
    mode === 'full_stop'
      ? roundUsd(principal * VIP_GAS_RATE_PER_CHARGE * VIP_GAS_CHARGES_PER_DAY * gasWorkingDays)
      : 0;
  const commission = roundUsd(revenueSelected * VIP_EXIT_COMMISSION_RATE);
  const gasReward = roundUsd(gasFees * VIP_GAS_REWARD_RATE);
  const netRevenue = roundUsd(Math.max(0, revenueSelected - penalty - gasFees - commission + gasReward));
  const principalReturn = mode === 'full_stop' ? principal : 0;
  const investmentExtraCredit =
    mode === 'full_stop' &&
    principal > VIP_INVESTMENT_EXTRA_CREDIT_MIN_PRINCIPAL &&
    workingDays > VIP_INVESTMENT_EXTRA_CREDIT_MIN_WORKING_DAYS
      ? VIP_INVESTMENT_EXTRA_CREDIT_USD
      : 0;
  const netTotal = roundUsd(netRevenue + principalReturn + investmentExtraCredit);

  return {
    mode,
    revenuePercent: pct,
    destination,
    penaltyFree,
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
    revenuePercents: [...VIP_EXIT_REVENUE_PERCENTS],
  };
}
