export type RootTabParamList = {
  Home: undefined;
  Trades: undefined;
  Wallet: undefined;
  Settings: undefined;
};

export type TradeSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';

export interface User {
  id: string;
  email: string;
}

export interface Account {
  equity: string;
  buying_power: string;
  cash: string;
  portfolio_value?: string;
  last_equity?: string;
}

export interface Quote {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  spread?: number;
}

export interface MarketItem {
  symbol: string;
  price: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  changePercent: number;
}

export interface Position {
  symbol: string;
  qty: string;
  unrealized_pl?: string;
  market_value?: string;
}

export interface Order {
  id: string;
  symbol: string;
  side: string;
  qty: string;
  status: string;
  submitted_at?: string;
}

export interface WalletTransaction {
  id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  status: string;
  created_at: string;
}
