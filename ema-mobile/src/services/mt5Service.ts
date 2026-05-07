import { api } from './api';
import { Mt5AccountConfig, Mt5Balance } from '../types';

export const mt5Service = {
  listAccounts: () => api.get<{ accounts: Mt5AccountConfig[] }>('/mt5/accounts'),
  saveAccount: (payload: { login: string; password: string; server: string; accountName?: string }) =>
    api.post<{ success: boolean; account: Mt5AccountConfig }>('/mt5/accounts', payload),
  getBalance: (id: string) => api.get<Mt5Balance>(`/mt5/accounts/${id}/balance`),
};
