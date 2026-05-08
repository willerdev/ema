import { CryptoSummary } from '../types';
import { api } from './api';

export const cryptoWalletService = {
  onboard: () =>
    api.post<{ depositAddress: string; derivationIndex: number; wallets: { asset: string; chain: string; address: string }[] }>(
      '/crypto/onboard',
      {}
    ),
  getSummary: () => api.get<CryptoSummary>('/crypto/summary'),
  refreshBalances: () => api.post<{ ok: boolean; refreshed: boolean; status: string; updatedAt: string | null }>('/crypto/refresh-balances', {}),
  send: (to: string, amount: string, asset: 'ETH' | 'USDT') => api.post<{ id: string; txId: string; completed: boolean }>('/crypto/send', { to, amount, asset }),
  getSwapStatus: () => api.get<{ enabled: boolean; message: string }>('/crypto/swap-status'),
};
