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
  if (!('eligible' in row) && !('principalUsd' in row) && !('ineligibilityReason' in row)) {
    return null;
  }
  const loan = normalizeLoanRecord(row.loan);
  return {
    eligible: Boolean(row.eligible),
    ineligibilityReason:
      row.ineligibilityReason == null ? null : String(row.ineligibilityReason),
    principalUsd: num(row.principalUsd),
    minPrincipalUsd: num(row.minPrincipalUsd, 2500),
    lifetimeAccrualDays: num(row.lifetimeAccrualDays),
    monthlyAccrualUsd: num(row.monthlyAccrualUsd),
    isEstablished: Boolean(row.isEstablished),
    lastMonthEarningsUsd: num(row.lastMonthEarningsUsd),
    maxLoanUsd: num(row.maxLoanUsd),
    minLoanUsd: num(row.minLoanUsd, 10),
    commissionRate: num(row.commissionRate, 0.3),
    newUserFactor: num(row.newUserFactor, 1),
    disburseWithinBusinessDays: num(row.disburseWithinBusinessDays, 3),
    blocksWithdrawals: Boolean(row.blocksWithdrawals),
    loan,
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
  getLoanStatus: async () => {
    const raw = await api.get<unknown>('/vip-farmers/loans/status');
    const status = normalizeVipLoanStatus(raw);
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
