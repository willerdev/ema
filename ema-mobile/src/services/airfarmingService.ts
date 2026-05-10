import { api } from './api';

export type AirfarmingPlatformHighlight = {
  /** UTC calendar date YYYY-MM-DD */
  date: string;
  percent: number;
};

export type AirfarmingStatus = {
  cashWallet: number;
  airfarmingBalance: number;
  weekStart: string;
  weeklyTarget: number;
  weeklyUsed: number;
  scheduleHours: number[];
  lastEventAt: string | null;
  platformHighlight: AirfarmingPlatformHighlight | null;
  history: { id: string; percent: number; createdAt: string }[];
};

export type AirfarmingBalances = {
  cashWallet: number;
  airfarmingBalance: number;
};

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStatus(raw: unknown): AirfarmingStatus {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const sched = r.scheduleHours;
  const hist = r.history;
  const phRaw = r.platformHighlight;
  let platformHighlight: AirfarmingPlatformHighlight | null = null;
  if (phRaw && typeof phRaw === 'object') {
    const ph = phRaw as Record<string, unknown>;
    const d = String(ph.date ?? '').trim();
    const pct = num(ph.percent);
    if (d && Number.isFinite(pct)) platformHighlight = { date: d, percent: pct };
  }
  return {
    cashWallet: num(r.cashWallet),
    airfarmingBalance: num(r.airfarmingBalance),
    weekStart: String(r.weekStart ?? ''),
    weeklyTarget: num(r.weeklyTarget),
    weeklyUsed: num(r.weeklyUsed),
    scheduleHours: Array.isArray(sched) ? sched.map((x) => num(x)) : [],
    lastEventAt: r.lastEventAt == null ? null : String(r.lastEventAt),
    platformHighlight,
    history: Array.isArray(hist)
      ? hist.map((h) => {
          const row = h && typeof h === 'object' ? (h as Record<string, unknown>) : {};
          return {
            id: String(row.id ?? ''),
            percent: num(row.percent),
            createdAt: String(row.createdAt ?? ''),
          };
        })
      : [],
  };
}

function normalizeBalances(raw: unknown): AirfarmingBalances {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    cashWallet: num(r.cashWallet),
    airfarmingBalance: num(r.airfarmingBalance),
  };
}

export const airfarmingService = {
  getStatus: async () => normalizeStatus(await api.get<unknown>('/airfarming/status')),

  activate: async (amount: number) =>
    normalizeBalances(await api.post<unknown>('/airfarming/activate', { amount })),

  returnToCash: async (amount: number) =>
    normalizeBalances(await api.post<unknown>('/airfarming/return-to-cash', { amount })),
};
