import { WhitelistedWallet, WhitelistedWalletsResponse } from '../types';
import { api } from './api';

export const WHITELIST_WALLET_LIMIT = 3;

export const whitelistWalletService = {
  list: () => api.get<WhitelistedWalletsResponse>('/whitelist-wallets'),
  add: (payload: { label?: string; currency: string; address: string }) =>
    api.post<{ wallet: WhitelistedWallet; wallets: WhitelistedWallet[]; maxWallets: number }>(
      '/whitelist-wallets',
      payload
    ),
  remove: (id: string) =>
    api.delete<{ success: boolean; wallets: WhitelistedWallet[]; maxWallets: number }>(
      `/whitelist-wallets/${id}`
    ),
};
