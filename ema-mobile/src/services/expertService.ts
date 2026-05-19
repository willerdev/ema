import { api } from './api';

export type ExpertMarketGroup = 'derived' | 'metals';

export type ExpertSummary = {
  cashWallet: number;
  expertBalance: number;
  marketGroup: ExpertMarketGroup | null;
  updatedAt: string | null;
};

export const expertService = {
  getSummary: () => api.get<ExpertSummary>('/expert/summary'),
  fund: (amount: number, marketGroup: ExpertMarketGroup) =>
    api.post<ExpertSummary>('/expert/fund', { amount, marketGroup }),
  returnToCash: (amount: number) => api.post<ExpertSummary>('/expert/return-to-cash', { amount }),
};
