import { WalletTransaction } from '../types';
import { api } from './api';

export const walletService = {
  getWallet: () => api.get<{ balance: number; transactions: WalletTransaction[] }>('/wallet'),
  deposit: (amount: number, method: string, referenceId: string) => api.post('/wallet/deposit', { amount, method, referenceId }),
  withdraw: (amount: number, method: string, opts?: { network?: string; destinationAddress?: string }) =>
    api.post('/wallet/withdraw', { amount, method, ...opts }),
  resetWallet: (token: string) => api.post('/wallet/reset', {}, { 'x-dev-reset-token': token }),
};
