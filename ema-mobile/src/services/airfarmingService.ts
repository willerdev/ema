import { api } from './api';

export type AirfarmingStatus = {
  weekStart: string;
  weeklyTarget: number;
  weeklyUsed: number;
  scheduleHours: number[];
  lastEventAt: string | null;
  history: { id: string; percent: number; createdAt: string }[];
};

export const airfarmingService = {
  getStatus: () => api.get<AirfarmingStatus>('/airfarming/status'),
};
