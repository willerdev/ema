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
  loan: {
    id: string;
    amountUsd: number;
    disbursedUsd: number;
    outstandingUsd: number;
    repaidUsd: number;
    status: string;
    payoutDestination?: 'platform' | 'direct_wallet';
    walletAddress?: string | null;
    disburseWithinBusinessDays?: number;
  } | null;
};

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
  getLoanStatus: () => api.get<VipLoanStatus>('/vip-farmers/loans/status'),
  requestLoan: (body: {
    amount: number;
    destination?: 'platform' | 'direct_wallet';
    walletAddress?: string;
  }) => api.post<{ loan: VipLoanStatus['loan'] }>('/vip-farmers/loans/request', body),
  repayLoan: (amount: number) =>
    api.post<{ loan: VipLoanStatus['loan']; cashWalletUsd: number }>('/vip-farmers/loans/repay', { amount }),
};
