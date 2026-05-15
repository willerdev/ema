import { api } from './api';
import { Mt5AccountConfig, Mt5Balance, Mt5HistoryDeal, Mt5Position } from '../types';

export const mt5Service = {
  listAccounts: () => api.get<{ accounts: Mt5AccountConfig[] }>('/mt5/accounts'),
  saveAccount: (payload: { login: string; password: string; server: string; accountName?: string }) =>
    api.post<{ success: boolean; account: Mt5AccountConfig }>('/mt5/accounts', payload),
  getBalance: (id: string) => api.get<Mt5Balance>(`/mt5/accounts/${id}/balance`),
  refreshBalance: (id: string) => api.post<Mt5Balance>(`/mt5/accounts/${id}/refresh-balance`, {}),
  getPositions: (id: string) => api.get<{ positions: Mt5Position[] }>(`/mt5/accounts/${id}/positions`),
  closePosition: (accountId: string, positionId: string) =>
    api.post<{ ok: boolean }>(`/mt5/accounts/${accountId}/positions/close`, { positionId }),
  getHistory: (accountId: string, days = 30) =>
    api.get<{ deals: Mt5HistoryDeal[]; days: number }>(`/mt5/accounts/${accountId}/history?days=${days}`),
};
