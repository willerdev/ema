import {
  NowpaymentsCreateDepositResponse,
  NowpaymentsDepositStatus,
  NowpaymentsSummary,
  NowpaymentsWithdrawalResponse,
} from '../types';
import { api } from './api';

export const nowpaymentsService = {
  getClientIp: () => api.get<{ ip: string }>('/nowpayments/client-ip'),
  getCurrencies: () => api.get<{ currencies: string[] }>('/nowpayments/currencies'),
  getSummary: () => api.get<NowpaymentsSummary>('/nowpayments/summary'),
  createDeposit: (priceAmount: number, payCurrency: string, priceCurrency = 'usd') =>
    api.post<NowpaymentsCreateDepositResponse>('/nowpayments/deposits', {
      priceAmount,
      priceCurrency,
      payCurrency,
    }),
  getDeposit: (id: string) => api.get<NowpaymentsDepositStatus>(`/nowpayments/deposits/${id}`),
  createWithdrawal: (currency: string, address: string, amount: number, totpCode?: string) =>
    api.post<NowpaymentsWithdrawalResponse>('/nowpayments/withdrawals', {
      currency,
      address,
      amount,
      ...(totpCode ? { totpCode } : {}),
    }),
  verifyWithdrawal: (withdrawalId: string, verificationCode: string) =>
    api.post<NowpaymentsWithdrawalResponse>(`/nowpayments/withdrawals/${withdrawalId}/verify`, {
      verificationCode: verificationCode.replace(/\s/g, ''),
    }),
};
