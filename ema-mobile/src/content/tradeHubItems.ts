export type TradeHubItemId = 'airfarming' | 'vip';

export type TradeHubItem = {
  id: TradeHubItemId;
  title: string;
  meta: string;
  roi: string;
  route: 'AirfarmingTrade' | 'VipFarmersTrade';
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
    meta: '38-day lock · 9% gross weekday accrual on principal',
    roi: 'Locked yield program',
    route: 'VipFarmersTrade',
  },
];
