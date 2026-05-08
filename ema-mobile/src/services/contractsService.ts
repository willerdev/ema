import { api } from './api';

export type ContractsSummary = {
  cashWallet: number;
  contractBalance: number;
  updatedAt: string | null;
};

export const contractsService = {
  getSummary: () => api.get<ContractsSummary>('/contracts/summary'),
  deposit: (amount: number) => api.post<ContractsSummary>('/contracts/deposit', { amount }),
  withdraw: (amount: number) => api.post<ContractsSummary>('/contracts/withdraw', { amount }),
};
