import { api } from './api';

export const LIVE_TRADING_MIN_DEPOSIT = {
  synthetix_ea: 1000,
  quantix_ea: 200,
} as const;

export type LiveTradingBotType = keyof typeof LIVE_TRADING_MIN_DEPOSIT;

export type LiveTradingAccount = {
  id: string;
  botType: LiveTradingBotType;
  accountName: string;
  login: string;
  depositedBalance: number;
  openProfit: number;
  displayBalance: number;
  snapshotFresh: boolean;
  minDepositUsd: number;
  createdAt: string;
};

export type LivePrice = {
  symbol: string;
  bid: number;
  ask: number;
  updatedAt: string;
  dayOpen?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
};

export type LivePosition = {
  id: string;
  symbol: string;
  side: string;
  volume: number;
  openPrice: number;
  profit: number;
  time: string | null;
};

export function accountDisplayBalance(account: LiveTradingAccount) {
  return Number(account.displayBalance ?? account.depositedBalance ?? 0);
}

export const liveTradingService = {
  listAccounts: () => api.get<{ accounts: LiveTradingAccount[] }>('/live-trading/accounts'),
  createAccount: (body: { botType: LiveTradingBotType; password: string; accountName?: string; leverage?: number }) =>
    api.post<{ account: LiveTradingAccount }>('/live-trading/accounts', body),
  getSummary: (id: string) => api.get<LiveTradingAccount>(`/live-trading/accounts/${id}/summary`),
  fund: (id: string, amount: number) =>
    api.post<{ cashWalletUsd: number; account: LiveTradingAccount }>(`/live-trading/accounts/${id}/fund`, { amount }),
  returnToCash: (id: string, amount: number) =>
    api.post<{ cashWalletUsd: number; account: LiveTradingAccount }>(
      `/live-trading/accounts/${id}/return-to-cash`,
      { amount }
    ),
  getPrices: () => api.get<{ prices: LivePrice[] }>('/live-trading/prices'),
  getPositions: (id: string) => api.get<{ positions: LivePosition[] }>(`/live-trading/accounts/${id}/positions`),
  closePosition: (id: string, positionId: string) =>
    api.post<{ ok: boolean }>(`/live-trading/accounts/${id}/positions/close`, { positionId }),
};
