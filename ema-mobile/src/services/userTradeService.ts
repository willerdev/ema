import { api } from './api';

export type RecordedTrade = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  openPrice: number | null;
  closePrice: number | null;
  profitUsd: number;
  tradedAt: string;
  notes: string | null;
  createdAt: string;
};

export const userTradeService = {
  getHistory: (limit = 50) =>
    api.get<{ trades: RecordedTrade[] }>(`/user-trades/history?limit=${limit}`),
};
