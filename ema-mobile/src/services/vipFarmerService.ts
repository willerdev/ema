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
  matured: boolean;
  dailyRate: number;
  lockDays: number;
};

export type VipSummary = {
  cashWalletUsd: number;
  minInvestUsd: number;
  dailyRate: number;
  lockDays: number;
  earlyPenaltyRate: number;
  investment: VipInvestment | null;
};

export const vipFarmerService = {
  getSummary: () => api.get<VipSummary>('/vip-farmers/summary'),
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
