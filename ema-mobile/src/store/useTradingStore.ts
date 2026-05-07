import { create } from 'zustand';
import { Account, MarketItem, Order, Position, Quote } from '../types';
import { alpacaService } from '../services/alpacaService';

interface TradingState {
  account: Account | null;
  market: MarketItem[];
  positions: Position[];
  orders: Order[];
  quote: Quote | null;
  dashboardError: string | null;
  tradesError: string | null;
  loading: boolean;
  setQuoteSymbol: (symbol: string) => Promise<void>;
  refreshDashboard: () => Promise<void>;
  refreshTrades: () => Promise<void>;
}

export const useTradingStore = create<TradingState>((set) => ({
  account: null,
  market: [],
  positions: [],
  orders: [],
  quote: null,
  dashboardError: null,
  tradesError: null,
  loading: false,
  setQuoteSymbol: async (symbol: string) => {
    try {
      const quote = await alpacaService.getQuote(symbol);
      set({ quote });
    } catch (error: any) {
      set({ quote: null, tradesError: String(error?.message || 'Failed to fetch quote') });
    }
  },
  refreshDashboard: async () => {
    set({ loading: true });
    try {
      const account = await alpacaService.getAccount();
      let market: MarketItem[] = [];
      let dashboardError: string | null = null;
      try {
        market = await alpacaService.getMarketOverview();
      } catch (marketError: any) {
        dashboardError = String(marketError?.message || 'Market overview unavailable');
      }
      set({ account, market, loading: false, dashboardError });
    } catch (error: any) {
      set({ loading: false, dashboardError: String(error?.message || 'Failed to fetch dashboard data') });
    }
  },
  refreshTrades: async () => {
    try {
      const [positions, orders] = await Promise.all([alpacaService.getPositions(), alpacaService.getOrders()]);
      set({ positions, orders, tradesError: null });
    } catch (error: any) {
      set({ positions: [], orders: [], tradesError: String(error?.message || 'Failed to fetch trades') });
    }
  },
}));
