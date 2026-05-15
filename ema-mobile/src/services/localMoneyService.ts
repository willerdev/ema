import { api } from './api';

export type LocalMoneyRegion = {
  countryCode: string;
  countryName: string;
  fiatCurrency: string;
  fiatLabel: string;
  usdtToFiatRate: number;
};

export type LocalMoneyConfigResponse = {
  supported: boolean;
  countryCode?: string;
  message?: string;
  region?: LocalMoneyRegion;
  usdtPairLabel?: string;
  sampleOffers?: P2POfferFromApi[];
  regions?: LocalMoneyRegion[];
};

export type P2POfferFromApi = {
  id: string;
  side: 'buy' | 'sell';
  asset: string;
  fiat: string;
  price: number;
  limitMin: number;
  limitMax: number;
  paymentMethods: string[];
  trader: string;
  completedTrades: number;
  rating: number;
};

export type LocalMoneyOrder = {
  id: string;
  type: 'deposit' | 'withdraw';
  countryCode: string;
  fiatCurrency: string;
  fiatAmount: number;
  cryptoAsset: string;
  cryptoAmount: number | null;
  phoneMasked: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export const localMoneyService = {
  getRegions: () => api.get<{ regions: LocalMoneyRegion[] }>('/local-money/regions'),
  getConfig: (countryCode: string) =>
    api.get<LocalMoneyConfigResponse>(`/local-money/config?countryCode=${encodeURIComponent(countryCode)}`),
  listOrders: () => api.get<{ orders: LocalMoneyOrder[] }>('/local-money/orders'),
  deposit: (body: { countryCode: string; phone: string; fiatAmount: number }) =>
    api.post<{ order: LocalMoneyOrder; message: string }>('/local-money/deposit', body),
  withdraw: (body: { countryCode: string; phone: string; cryptoAmount: number; totpCode: string }) =>
    api.post<{ order: LocalMoneyOrder; message: string; fiatAmount: number; fiatLabel: string }>(
      '/local-money/withdraw',
      body
    ),
};

export function isTotpRequiredError(e: unknown): boolean {
  const err = e as Error & { code?: string; status?: number };
  return err?.code === 'TOTP_REQUIRED' || (err?.status === 403 && /two-factor/i.test(String(err.message)));
}
