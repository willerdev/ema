import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppNotification } from '../types';
import { api } from './api';

const STORAGE_KEY = 'ema_saved_notifications_v1';

export const notificationService = {
  fetchInbox: () => api.get<{ notifications: AppNotification[] }>('/notifications'),

  async loadSaved(): Promise<AppNotification[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as AppNotification[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async mergeAndSave(incoming: AppNotification[]): Promise<AppNotification[]> {
    const existing = await notificationService.loadSaved();
    const map = new Map<string, AppNotification>();
    for (const n of [...existing, ...incoming]) {
      if (n?.id) map.set(n.id, n);
    }
    const merged = [...map.values()].sort(
      (a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged.slice(0, 200)));
    return merged;
  },

  async clearSaved() {
    await AsyncStorage.removeItem(STORAGE_KEY);
  },
};
