import { api } from './api';

export type VipInvestment = {
  id: string;
  principalUsd: number;
  startedAt: string;
  maturesAt: string;
  status: string;
  totalAccruedUsd: number;
  daysAccrued: number;
  daysLeft: number;
  calendarDaysLeft?: number;
  matured: boolean;
  dailyRate: number;
  lockDays: number;
  accrualWeekdays?: number;
  commissionRate?: number;
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
};

export type VipEarningsTotals = {
  weekdayCount: number;
  grossUsd: number;
  commissionUsd: number;
  netUsd: number;
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
  commissionRate?: number;
  accrualWeekdays?: number;
  lockDays: number;
  earlyPenaltyRate: number;
  investment: VipInvestment | null;
};

export const vipFarmerService = {
  getSummary: () => api.get<VipSummary>('/vip-farmers/summary'),
  getAccruals: (limit = 60) =>
    api.get<{ commissionRate: number; accruals: VipAccrual[]; totals: VipEarningsTotals }>(
      `/vip-farmers/accruals?limit=${limit}`
    ),
  invest: (amount: number) =>
    api.post<{ investment: VipInvestment; cashWalletUsd: number }>('/vip-farmers/invest', { amount }),
  addCapital: (amount: number) =>
    api.post<{ investment: VipInvestment; cashWalletUsd: number; addedUsd: number; lockReset: boolean }>(
      '/vip-farmers/add-capital',
      { amount }
    ),
  withdraw: () =>
    api.post<{ principalReturned: number; cashWalletUsd: number; investment: VipInvestment }>(
      '/vip-farmers/withdraw',
      {}
    ),
  earlyWithdraw: () =>
    api.post<{ available: number; penalty: number; payout: number; cashWalletUsd: number }>(
      '/vip-farmers/early-withdraw',
      {}
    ),
};
