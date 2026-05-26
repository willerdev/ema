import type { NavigatorScreenParams } from '@react-navigation/native';

export type ExtraStackParamList = {
  ExtraHub: undefined;
  P2P: undefined;
  SendById: undefined;
  LocalMoney: undefined;
  MT5: undefined;
  Settings: { openSecurity?: boolean } | undefined;
};

export type RootTabParamList = {
  Home: undefined;
  Journal: undefined;
  Trades: undefined;
  Wallet: undefined;
  Extra: NavigatorScreenParams<ExtraStackParamList> | undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<RootTabParamList> | undefined;
  AlpacaTrade: undefined;
  AirfarmingTrade: undefined;
  VipFarmersTrade: undefined;
  ContractsTrade: undefined;
  ExpertAutoTrading: undefined;
  Notifications: undefined;
  TransactionHistory: { initialTab?: TransactionHistoryTab } | undefined;
  TransactionDetail: { row: WalletActivityRow };
  CryptoDepositPayment: { deposit: NowpaymentsCreateDepositResponse };
  Support: { category?: 'withdraw' | 'deposit' | 'daily_earning' | 'transfer' | 'general' } | undefined;
};

export interface NotificationPreferences {
  premiumAlertsEnabled: boolean;
  notifySms: boolean;
  notifyEmail: boolean;
  premiumTermsAcceptedAt: string | null;
}

export interface NotificationPreferencesResponse {
  preferences: NotificationPreferences;
  weeklyPriceUsd: number;
}

export type TransactionHistoryTab = 'all' | 'deposit' | 'withdraw' | 'transfer' | 'p2p' | 'fiat';

export type AppNotification = {
  id: string;
  userId: string | null;
  audience: 'broadcast' | 'user';
  title: string;
  body: string;
  createdAt: string;
};

export type ActivityFeedItem = {
  id: string;
  title: string;
  subtitle: string;
  amountLabel?: string;
  directionLabel?: 'incoming' | 'outgoing' | 'neutral';
  timestampLabel?: string;
  kind: 'alpaca_order' | 'crypto_tx' | 'placeholder';
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
  type: 'deposit' | 'withdraw' | 'peer_send' | 'peer_receive';
  amount: number;
  status: string;
  created_at: string;
}

export interface CryptoBalanceRow {
  asset: string;
  balance: string;
}

export interface CryptoWalletRow {
  asset: 'ETH' | 'USDT' | string;
  chain: string;
  address: string;
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
  wallets?: CryptoWalletRow[];
  balances: CryptoBalanceRow[];
  balanceSync?: {
    status: string;
    message: string | null;
    updatedAt: string | null;
    refreshIntervalSec?: number;
  };
  activity: CryptoActivityRow[];
  swap: { enabled: boolean; message: string };
}

export interface NowpaymentsBalanceRow {
  asset: string;
  available: string;
  totalIn: string;
  totalOut: string;
  reserved: string;
}

export interface NowpaymentsPaymentRow {
  id: string;
  paymentId: string | null;
  orderId: string;
  status: string;
  payCurrency: string;
  payAmount: string | null;
  payAddress: string | null;
  priceAmount: number;
  priceCurrency: string;
  ledgerCredited?: boolean;
  createdAt: string;
}

export type WalletActivityKind = 'ledger' | 'payment' | 'payout' | 'cash';

export type TransactionCategory = 'deposit' | 'withdraw' | 'transfer' | 'p2p' | 'fiat' | 'other';

export interface WalletActivityRow {
  id: string;
  kind: WalletActivityKind;
  direction: 'in' | 'out';
  asset: string;
  amount: number;
  status: string;
  source: string;
  createdAt: string;
  category: TransactionCategory;
  availableBalance?: number;
  address?: string;
  txHash?: string;
  fee?: number;
  methodLabel?: string;
}

export interface NowpaymentsPayoutRow {
  id: string;
  payoutId: string | null;
  status: string;
  currency: string;
  address: string;
  amount: number;
  createdAt: string;
}

export interface NowpaymentsLedgerRow {
  id: string;
  asset: string;
  direction: 'in' | 'out';
  amount: number;
  source: string;
  sourceId?: string;
  createdAt: string;
}

export interface NowpaymentsSummary {
  balances: NowpaymentsBalanceRow[];
  /** Internal USD cash wallet (airfarming / trading); funds USDT crypto withdrawals 1:1 when set. */
  cashWalletUsd?: number;
  maxWithdrawableUsdt?: number;
  cashFundsCryptoWithdrawals?: boolean;
  activity?: WalletActivityRow[];
  payments: NowpaymentsPaymentRow[];
  payouts: NowpaymentsPayoutRow[];
  ledger: NowpaymentsLedgerRow[];
  configured: boolean;
}

export interface NowpaymentsCreateDepositResponse {
  id: string;
  paymentId: string | null;
  orderId: string;
  payAddress: string | null;
  payAmount: string | null;
  payCurrency: string;
  priceAmount: number;
  priceCurrency: string;
  status: string;
  expirationEstimateDate: string | null;
}

export interface NowpaymentsDepositStatus {
  id: string;
  paymentId: string | null;
  status: string;
  payAddress: string | null;
  payAmount: string | null;
  payCurrency: string;
  ledgerCredited: boolean;
}

export interface NowpaymentsWithdrawalResponse {
  id: string;
  payoutId: string | null;
  batchPayoutId?: string | null;
  status: string;
  currency: string;
  address: string;
  amount: number;
  requiresVerification?: boolean;
  verified?: boolean;
}

export type SourceOfFunds =
  | 'employment'
  | 'business'
  | 'savings'
  | 'investment_returns'
  | 'inheritance'
  | 'other';

export type PlannedInvestmentDuration = 'under_1y' | '1_3y' | '3_5y' | 'over_5y';

export interface ComplianceProfile {
  legalFirstName: string;
  legalLastName: string;
  country: string;
  profession: string;
  sourceOfFunds: SourceOfFunds | string;
  sourceOfFundsDetail: string | null;
  plannedInvestmentAmount: number | null;
  plannedInvestmentCurrency: string;
  plannedInvestmentDuration: PlannedInvestmentDuration | string;
  dateOfBirth: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  acceptedTermsAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

export interface ComplianceProfilePayload {
  legalFirstName: string;
  legalLastName: string;
  country: string;
  profession: string;
  sourceOfFunds: string;
  sourceOfFundsDetail?: string;
  plannedInvestmentAmount: number;
  plannedInvestmentCurrency?: string;
  plannedInvestmentDuration: string;
  dateOfBirth?: string;
  phone?: string;
  addressLine?: string;
  city?: string;
  acceptedTerms: boolean;
}

export interface ComplianceProfileResponse {
  profile: ComplianceProfile | null;
  complete: boolean;
  options?: {
    sourceOfFunds: string[];
    plannedInvestmentDuration: string[];
  };
}

export interface WhitelistedWallet {
  id: string;
  label: string;
  currency: string;
  address: string;
  createdAt: string;
}

export interface WhitelistedWalletsResponse {
  wallets: WhitelistedWallet[];
  maxWallets: number;
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
  swap?: number;
  commission?: number;
  time?: string | null;
}

export interface Mt5HistoryDeal {
  id: string;
  symbol: string;
  type: string;
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  time: string | null;
  positionId: string | null;
}
