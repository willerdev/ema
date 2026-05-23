export type TradeHubItemId = 'forex' | 'airfarming' | 'vip' | 'contracts' | 'expert';

export type TradeHubItem = {
  id: TradeHubItemId;
  title: string;
  meta: string;
  roi: string;
  route: 'AlpacaTrade' | 'AirfarmingTrade' | 'VipFarmersTrade' | 'ContractsTrade' | 'ExpertAutoTrading';
};

export const TRADE_HUB_ITEMS: TradeHubItem[] = [
  {
    id: 'airfarming',
    title: 'Airfarmers',
    meta: 'Normal drop opportunities (2–4 per week)',
    roi: 'Event range: 20% to 85%',
    route: 'AirfarmingTrade',
  },
  {
    id: 'vip',
    title: 'Live VIP Farmers',
    meta: '30-day lock · 9% daily on principal to cash',
    roi: 'Locked yield program',
    route: 'VipFarmersTrade',
  },
  {
    id: 'forex',
    title: 'Trade on forex market',
    meta: 'Stocks and crypto via your linked broker',
    roi: 'Illustrative ROI range: -1% to +100%',
    route: 'AlpacaTrade',
  },
  {
    id: 'contracts',
    title: 'Trade Contracts',
    meta: 'Dedicated contract balance — accrues daily while funded',
    roi: 'Daily accrual: 2%',
    route: 'ContractsTrade',
  },
  {
    id: 'expert',
    title: 'Expert Account Manager',
    meta: 'Managed MT5 trading — set risk limits and enable the expert',
    roi: 'Connect MT5, configure risk, then activate',
    route: 'ExpertAutoTrading',
  },
];

export const TRADE_HUB_HIDDEN_STORAGE_KEY = 'ema_trade_hub_hidden_v2';
export const TRADE_HUB_DEFAULT_HIDDEN: TradeHubItemId[] = ['forex', 'contracts', 'expert'];
