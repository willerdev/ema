export type RootTabParamList = {
  Home: undefined;
  Trades: undefined;
  Wallet: undefined;
  MT5: undefined;
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

export interface CryptoBalanceRow {
  currency: string;
  accountBalance: string;
  availableBalance: string;
}

export interface CryptoActivityRow {
  id: string;
  direction: 'in' | 'out';
  asset: string;
  amountDisplay: string;
  txHash: string;
  createdAt: string;
}

export interface CryptoSummary {
  onboarded: boolean;
  depositAddress: string | null;
  balances: CryptoBalanceRow[];
  activity: CryptoActivityRow[];
  swap: { enabled: boolean; message: string };
}

export interface Mt5AccountConfig {
  id?: string;
  login: string;
  server: string;
  metaapiAccountId?: string;
  accountName?: string;
  cachedBalance?: number | null;
  cachedEquity?: number | null;
  cachedCurrency?: string | null;
  balanceLastUpdatedAt?: string | null;
  updatedAt?: string;
}

export interface Mt5Balance {
  isLive?: boolean;
  hasSnapshot?: boolean;
  balance: number;
  equity: number;
  currency: string;
  login: string;
  server: string;
  accountName?: string;
  updatedAt?: string;
}

export interface Mt5Position {
  id?: string;
  symbol?: string;
  type?: string;
  volume?: number;
  openPrice?: number;
  currentPrice?: number;
  profit?: number;
}
