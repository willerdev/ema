import { Account, MarketItem, Order, Position, Quote } from '../types';
import { api } from './api';

export interface OrderPayload {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  limit_price?: number;
  stop_price?: number;
  take_profit?: number;
  stop_loss?: number;
}

export const alpacaService = {
  getAccount: () => api.get<Account>('/alpaca/account'),
  getPortfolioHistory: () => api.get<{ equity: number[]; timestamp: number[] }>('/alpaca/portfolio/history'),
  getMarketOverview: () => api.get<MarketItem[]>('/alpaca/market/overview'),
  searchAssets: (query: string, assetClass: 'us_equity' | 'crypto' = 'us_equity') =>
    api.get<any[]>(`/alpaca/assets/search?q=${encodeURIComponent(query)}&assetClass=${assetClass}`),
  getQuote: (symbol: string) => api.get<Quote>(`/alpaca/quote/${symbol}`),
  getStatus: () => api.get<{ configured: boolean }>('/alpaca/status'),
  placeOrder: (payload: OrderPayload) => api.post('/alpaca/orders', payload),
  getPositions: () => api.get<Position[]>('/alpaca/positions'),
  closePosition: (symbol: string) => api.post(`/alpaca/positions/${symbol}/close`, {}),
  getOrders: () => api.get<Order[]>('/alpaca/orders'),
  validateKeys: (apiKey: string, secretKey: string) => api.post<{ valid: boolean }>('/alpaca/validate-keys', { apiKey, secretKey }),
  updateKeys: (apiKey: string, secretKey: string) => api.post('/alpaca/keys', { apiKey, secretKey }),
};
