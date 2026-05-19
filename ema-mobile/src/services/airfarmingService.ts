import { api } from './api';

export type AirfarmingPlatformHighlight = {
  /** UTC calendar date YYYY-MM-DD */
  date: string;
  percent: number;
};

export type AirfarmingNextDrop = {
  id: string;
  dropIndex: number;
  dueAt: string;
  secondsRemaining: number;
  percent: number;
  minBalance: number;
  maxBalance: number;
  eligibleNow: boolean;
  projectedProfit: number;
};

export type AirfarmingDropHistoryRow = {
  id: string;
  percent: number;
  minBalance?: number;
  maxBalance?: number;
  status?: 'paid' | 'missed' | 'scheduled';
  eligibleBalance?: number | null;
  profitAmount?: number;
  autoFundedCash?: number;
  autoFundedCrypto?: number;
  createdAt: string;
  source?: 'drop' | 'platform';
};

export type AirfarmingStatus = {
  cashWallet: number;
  airfarmingBalance: number;
  weekStart: string;
  weeklyTarget: number;
  weeklyUsed: number;
  dropsPaid?: number;
  dropsMissed?: number;
  autoFundEnabled: boolean;
  scheduleHours: number[];
  lastEventAt: string | null;
  platformHighlight: AirfarmingPlatformHighlight | null;
  nextDrop: AirfarmingNextDrop | null;
  history: AirfarmingDropHistoryRow[];
  dropHistory?: AirfarmingDropHistoryRow[];
};

export type AirfarmingBalances = {
  cashWallet: number;
  airfarmingBalance: number;
};

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeNextDrop(raw: unknown): AirfarmingNextDrop | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const dueAt = String(r.dueAt ?? '');
  if (!dueAt) return null;
  return {
    id: String(r.id ?? ''),
    dropIndex: num(r.dropIndex),
    dueAt,
    secondsRemaining: num(r.secondsRemaining),
    percent: num(r.percent),
    minBalance: num(r.minBalance),
    maxBalance: num(r.maxBalance),
    eligibleNow: Boolean(r.eligibleNow),
    projectedProfit: num(r.projectedProfit),
  };
}

function normalizeHistoryItem(row: Record<string, unknown>): AirfarmingDropHistoryRow {
  const source = row.source === 'platform' ? 'platform' : row.source === 'drop' ? 'drop' : undefined;
  return {
    id: String(row.id ?? ''),
    percent: num(row.percent),
    minBalance: row.minBalance != null ? num(row.minBalance) : undefined,
    maxBalance: row.maxBalance != null ? num(row.maxBalance) : undefined,
    status:
      row.status === 'paid' || row.status === 'missed' || row.status === 'scheduled'
        ? row.status
        : undefined,
    eligibleBalance: row.eligibleBalance != null ? num(row.eligibleBalance) : null,
    profitAmount: row.profitAmount != null ? num(row.profitAmount) : undefined,
    autoFundedCash: row.autoFundedCash != null ? num(row.autoFundedCash) : undefined,
    autoFundedCrypto: row.autoFundedCrypto != null ? num(row.autoFundedCrypto) : undefined,
    createdAt: String(row.createdAt ?? ''),
    ...(source ? { source } : {}),
  };
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
  const history: AirfarmingDropHistoryRow[] = Array.isArray(hist)
    ? hist.map((h) => normalizeHistoryItem(h && typeof h === 'object' ? (h as Record<string, unknown>) : {}))
    : [];

  return {
    cashWallet: num(r.cashWallet),
    airfarmingBalance: num(r.airfarmingBalance),
    weekStart: String(r.weekStart ?? ''),
    weeklyTarget: num(r.weeklyTarget),
    weeklyUsed: num(r.weeklyUsed),
    dropsPaid: r.dropsPaid != null ? num(r.dropsPaid) : undefined,
    dropsMissed: r.dropsMissed != null ? num(r.dropsMissed) : undefined,
    autoFundEnabled: Boolean(r.autoFundEnabled),
    scheduleHours: Array.isArray(sched) ? sched.map((x) => num(x)) : [],
    lastEventAt: r.lastEventAt == null ? null : String(r.lastEventAt),
    platformHighlight,
    nextDrop: normalizeNextDrop(r.nextDrop),
    history,
    dropHistory: Array.isArray(r.dropHistory)
      ? (r.dropHistory as unknown[]).map((h) =>
          normalizeHistoryItem(h && typeof h === 'object' ? (h as Record<string, unknown>) : {})
        )
      : undefined,
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

  updateAutoFund: async (enabled: boolean) => {
    const r = await api.post<unknown>('/airfarming/auto-fund', { enabled });
    return Boolean((r && typeof r === 'object' ? (r as Record<string, unknown>) : {}).autoFundEnabled);
  },
};

/** Format seconds as HH:MM:SS for drop countdown. */
export function formatDropCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}
