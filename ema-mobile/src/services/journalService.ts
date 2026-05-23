import { api } from './api';

export type JournalDaySummary = {
  date: string;
  totalUsd: number;
  hasProfit: boolean;
  breakdown: { airfarming: number; vip: number; contracts: number };
};

export type JournalMonthResponse = {
  year: number;
  month: number;
  monthTotalUsd: number;
  profitDays: number;
  bestDay: { date: string; totalUsd: number } | null;
  days: Record<string, JournalDaySummary>;
};

export type JournalDayItem = {
  id: string;
  source: 'airfarming' | 'vip' | 'contracts';
  label: string;
  amountUsd: number;
  at: string;
};

export type JournalDayResponse = {
  date: string;
  totalUsd: number;
  hasProfit: boolean;
  breakdown: { airfarming: number; vip: number; contracts: number };
  items: JournalDayItem[];
};

export const journalService = {
  getMonth: (year: number, month: number) =>
    api.get<JournalMonthResponse>(`/journal/month?year=${year}&month=${month}`),
  getDay: (date: string) => api.get<JournalDayResponse>(`/journal/day?date=${encodeURIComponent(date)}`),
};
