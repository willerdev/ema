import { WalletTransaction } from '../types';
import { api } from './api';

export const walletService = {
  getWallet: () => api.get<{ balance: number; transactions: WalletTransaction[] }>('/wallet'),
  getTransferCode: () => api.get<{ transferCode: string }>('/wallet/transfer-code'),
  lookupTransferCode: (code: string) =>
    api.get<{ found: boolean; recipientFirstName?: string | null; self?: boolean }>(
      `/wallet/transfer-lookup?code=${encodeURIComponent(code.trim())}`
    ),
  transferToCode: (
    toTransferCode: string,
    amount: number,
    opts?: { totpCode?: string; idempotencyKey?: string }
  ) =>
    api.post<{ transferId: string; balance: number; idempotent: boolean }>('/wallet/transfer', {
      toTransferCode,
      amount,
      ...opts,
    }),
  deposit: (amount: number, method: string, referenceId: string) => api.post('/wallet/deposit', { amount, method, referenceId }),
  withdraw: (
    amount: number,
    method: string,
    opts?: { network?: string; destinationAddress?: string; totpCode?: string }
  ) => api.post('/wallet/withdraw', { amount, method, ...opts }),
  resetWallet: (token: string) => api.post('/wallet/reset', {}, { 'x-dev-reset-token': token }),
};
