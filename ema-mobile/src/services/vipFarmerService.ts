import { api } from './api';

export type VipLockProjection = {
  startedAt: string;
  startedAtYmd: string;
  maturesAt: string;
  maturesAtYmd: string;
  asOfDate: string;
  lockWeekdays: number;
  weekdaysElapsed: number;
  weekdaysRemaining: number;
  progressPercent: number;
  dailyGrossUsd: number;
  dailyCommissionUsd: number;
  dailyNetUsd: number;
  earnedSoFarGrossUsd: number;
  earnedSoFarCommissionUsd: number;
  earnedSoFarNetUsd: number;
  remainingGrossUsd: number;
  remainingCommissionUsd: number;
  remainingNetUsd: number;
  fullLockGrossUsd: number;
  fullLockCommissionUsd: number;
  fullLockNetUsd: number;
};

export type VipInvestment = {
  id: string;
  principalUsd: number;
  startedAt: string;
  maturesAt: string;
  status: string;
  totalAccruedUsd: number;
  availableRevenueUsd?: number;
  revenueWithdrawnUsd?: number;
  daysAccrued: number;
  daysLeft: number;
  calendarDaysElapsed?: number;
  calendarDaysLeft?: number;
  penaltyFree?: boolean;
  matured: boolean;
  dailyRate: number;
  lockDays: number;
  lockCalendarDays?: number;
  lockWorkingDays?: number;
  accrualWeekdays?: number;
  weekendsExcluded?: boolean;
  commissionRate?: number;
  platformFeeRate?: number;
  exitCommissionRate?: number;
  dailyGrossUsd?: number;
  dailyPlatformFeeUsd?: number;
  dailyInterestUsd?: number;
  remainingInterestUsd?: number;
  remainingAccrualDays?: number;
  todayIsAccrualDay?: boolean;
  todayAccrued?: boolean;
  todayInterestUsd?: number;
  weekdayCount?: number;
  totalGrossEarnedUsd?: number;
  totalCommissionUsd?: number;
  totalNetEarnedUsd?: number;
  paidToCashUsd?: number;
  paidWeekdayCount?: number;
  startedAtYmd?: string;
  projection?: VipLockProjection;
};

export type VipExitQuote = {
  mode: 'full_stop' | 'partial_continue';
  revenuePercent: number;
  destination: 'platform' | 'direct_wallet';
  penaltyFree: boolean;
  principalUsd: number;
  revenueBaseUsd: number;
  revenueSelectedUsd: number;
  penaltyUsd: number;
  gasFeesUsd: number;
  commissionUsd: number;
  gasRewardUsd: number;
  netRevenueUsd: number;
  principalReturnUsd: number;
  investmentExtraCreditUsd: number;
  netTotalUsd: number;
  workingDays: number;
  calendarDays: number;
  revenuePercents: number[];
};

export type VipExitRequest = {
  id: string;
  mode: string;
  revenuePercent: number;
  destination: string;
  status: string;
  netTotalUsd: number;
  penaltyUsd: number;
  gasFeesUsd: number;
  commissionUsd: number;
  createdAt: string;
};

export type VipLoanRecord = {
  id: string;
  amountUsd: number;
  disbursedUsd: number;
  outstandingUsd: number;
  repaidUsd: number;
  status: string;
  payoutDestination?: 'platform' | 'direct_wallet';
  walletAddress?: string | null;
  disburseWithinBusinessDays?: number;
};

export type VipLoanStatus = {
  eligible: boolean;
  hasActiveInvestment?: boolean;
  investmentId?: string | null;
  ineligibilityReason?: string | null;
  principalUsd: number;
  minPrincipalUsd: number;
  lifetimeAccrualDays: number;
  monthlyAccrualUsd: number;
  isEstablished: boolean;
  lastMonthEarningsUsd: number;
  maxLoanUsd: number;
  minLoanUsd: number;
  commissionRate: number;
  newUserFactor: number;
  disburseWithinBusinessDays: number;
  blocksWithdrawals: boolean;
  loan: VipLoanRecord | null;
};

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeLoanRecord(raw: unknown): VipLoanRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (!row.id && !row.status) return null;
  return {
    id: String(row.id || ''),
    amountUsd: num(row.amountUsd),
    disbursedUsd: num(row.disbursedUsd),
    outstandingUsd: num(row.outstandingUsd),
    repaidUsd: num(row.repaidUsd),
    status: String(row.status || 'unknown'),
    payoutDestination:
      row.payoutDestination === 'direct_wallet' ? 'direct_wallet' : 'platform',
    walletAddress: row.walletAddress ? String(row.walletAddress) : null,
    disburseWithinBusinessDays: num(row.disburseWithinBusinessDays, 3),
  };
}

export function normalizeVipLoanStatus(raw: unknown): VipLoanStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !('eligible' in row) &&
    !('principalUsd' in row) &&
    !('principal_usd' in row) &&
    !('ineligibilityReason' in row) &&
    !('ineligibility_reason' in row)
  ) {
    return null;
  }
  const loan = normalizeLoanRecord(row.loan);
  const principalUsd = num(row.principalUsd ?? row.principal_usd);
  const hasActiveInvestment = Boolean(
    row.hasActiveInvestment ??
      row.has_active_investment ??
      row.investmentId ??
      row.investment_id ??
      principalUsd > 0
  );
  return {
    eligible: Boolean(row.eligible),
    hasActiveInvestment,
    investmentId:
      row.investmentId != null
        ? String(row.investmentId)
        : row.investment_id != null
          ? String(row.investment_id)
          : null,
    ineligibilityReason:
      row.ineligibilityReason == null && row.ineligibility_reason == null
        ? null
        : String(row.ineligibilityReason ?? row.ineligibility_reason ?? ''),
    principalUsd,
    minPrincipalUsd: num(row.minPrincipalUsd ?? row.min_principal_usd, 2500),
    lifetimeAccrualDays: num(row.lifetimeAccrualDays ?? row.lifetime_accrual_days),
    monthlyAccrualUsd: num(row.monthlyAccrualUsd ?? row.monthly_accrual_usd),
    isEstablished: Boolean(row.isEstablished ?? row.is_established),
    lastMonthEarningsUsd: num(row.lastMonthEarningsUsd ?? row.last_month_earnings_usd),
    maxLoanUsd: num(row.maxLoanUsd ?? row.max_loan_usd),
    minLoanUsd: num(row.minLoanUsd ?? row.min_loan_usd, 10),
    commissionRate: num(row.commissionRate ?? row.commission_rate, 0.3),
    newUserFactor: num(row.newUserFactor ?? row.new_user_factor, 1),
    disburseWithinBusinessDays: num(
      row.disburseWithinBusinessDays ?? row.disburse_within_business_days,
      3
    ),
    blocksWithdrawals: Boolean(row.blocksWithdrawals ?? row.blocks_withdrawals),
    loan,
  };
}

export function mergeVipLoanStatus(
  status: VipLoanStatus | null,
  fallback?: {
    investmentPrincipalUsd?: number;
    hasActiveInvestment?: boolean;
  }
): VipLoanStatus | null {
  if (!status) return null;
  const investmentPrincipalUsd = num(fallback?.investmentPrincipalUsd);
  const principalUsd =
    status.principalUsd > 0
      ? status.principalUsd
      : investmentPrincipalUsd > 0
        ? investmentPrincipalUsd
        : status.principalUsd;
  const hasActiveInvestment = Boolean(
    status.hasActiveInvestment ?? fallback?.hasActiveInvestment ?? principalUsd > 0
  );
  return {
    ...status,
    principalUsd,
    hasActiveInvestment,
  };
}

export type VipEarningsTotals = {
  weekdayCount: number;
  grossUsd: number;
  commissionUsd: number;
  netUsd: number;
  paidToCashUsd?: number;
  remainingNetUsd?: number;
  fullLockNetUsd?: number;
};

export type VipAccrual = {
  id: string;
  investmentId: string;
  accrualDate: string;
  rate: number;
  grossUsd: number;
  commissionRate: number;
  commissionUsd: number;
  netUsd: number;
  createdAt: string;
};

export type VipSummary = {
  cashWalletUsd: number;
  minInvestUsd: number;
  dailyRate: number;
  platformFeeRate?: number;
  netDailyRate?: number;
  commissionRate?: number;
  exitCommissionRate?: number;
  accrualWeekdays?: number;
  lockDays: number;
  lockCalendarDays?: number;
  lockWorkingDays?: number;
  weekendsExcluded?: boolean;
  investment: VipInvestment | null;
  pendingExitRequest?: { id: string; status: string; mode: string } | null;
  loan?: VipLoanStatus;
};

export const vipFarmerService = {
  getSummary: () => api.get<VipSummary>('/vip-farmers/summary'),
  getAccruals: (limit = 60) =>
    api.get<{ commissionRate: number; accruals: VipAccrual[]; projection: VipLockProjection | null; totals: VipEarningsTotals }>(
      `/vip-farmers/accruals?limit=${limit}`
    ),
  invest: (amount: number) =>
    api.post<{ investment: VipInvestment; cashWalletUsd: number }>('/vip-farmers/invest', { amount }),
  addCapital: (amount: number) =>
    api.post<{ investment: VipInvestment; cashWalletUsd: number; addedUsd: number; lockReset: boolean }>(
      '/vip-farmers/add-capital',
      { amount }
    ),
  reinvest: (amount?: number) =>
    api.post<{ investment: VipInvestment; reinvestedUsd: number; commissionUsd: number; grossRevenueUsd: number }>(
      '/vip-farmers/reinvest',
      amount != null ? { amount } : {}
    ),
  previewExit: (body: {
    mode: 'full_stop' | 'partial_continue';
    revenuePercent: number;
    destination?: 'platform' | 'direct_wallet';
  }) => api.post<VipExitQuote>('/vip-farmers/exit/preview', body),
  requestExit: (body: {
    mode: 'full_stop' | 'partial_continue';
    revenuePercent: number;
    destination: 'platform' | 'direct_wallet';
    walletAddress?: string;
  }) => api.post<{ request: VipExitRequest }>('/vip-farmers/exit/request', body),
  getExitRequests: () => api.get<{ requests: VipExitRequest[] }>('/vip-farmers/exit/requests'),
  getLoanStatus: async (fallback?: {
    investmentPrincipalUsd?: number;
    hasActiveInvestment?: boolean;
  }) => {
    const raw = await api.get<unknown>('/vip-farmers/loans/status');
    const status = mergeVipLoanStatus(normalizeVipLoanStatus(raw), fallback);
    if (!status) throw new Error('Loan status response was invalid. Please try again.');
    return status;
  },
  requestLoan: (body: {
    amount: number;
    destination?: 'platform' | 'direct_wallet';
    walletAddress?: string;
  }) => api.post<{ loan: VipLoanStatus['loan'] }>('/vip-farmers/loans/request', body),
  repayLoan: (amount: number) =>
    api.post<{ loan: VipLoanStatus['loan']; cashWalletUsd: number }>('/vip-farmers/loans/repay', { amount }),
};
