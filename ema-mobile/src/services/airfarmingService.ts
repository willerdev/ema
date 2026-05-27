import { api } from './api';

export type AirfarmingPlatformHighlight = {
  /** UTC calendar date YYYY-MM-DD */
  date: string;
  percent: number;
};

export type WithdrawalTrustFactor = {
  key: string;
  label: string;
  impact: number;
  count?: number;
  ratio?: number;
  amountUsd?: number;
  note?: string;
};

export type WithdrawalTrustScore = {
  score: number;
  band: 'excellent' | 'good' | 'fair' | 'low' | 'poor';
  label: string;
  dropPotentialMultiplier: number;
  dropPotentialPercent: number;
  factors: WithdrawalTrustFactor[];
  stats: {
    withdrawCount7d: number;
    withdrawCount30d: number;
    withdrawCountLifetime: number;
    withdrawAmount7d: number;
    withdrawAmount90d: number;
    depositAmount90d: number;
    illegalCount90d: number;
  };
  affectsDrops: boolean;
  message: string;
};

export type AirfarmingDropPhase = 'waiting' | 'preparing' | 'processing' | 'rewarding' | 'idle';

export type AirfarmingUpcomingDrop = {
  id: string | null;
  previewKey: string;
  dropIndex: number;
  dueAt: string;
  secondsRemaining: number;
  minBalance: number;
  maxBalance: number;
  percentLocked: boolean;
  isProjected: boolean;
  hasSnapshot: boolean;
  eligibilitySnapshotBalance: number | null;
  percent: number | null;
  eligibleNow: boolean | null;
  projectedProfit: number | null;
  projectedProfitBase?: number | null;
  dropPotentialMultiplier?: number;
  dropPhase?: AirfarmingDropPhase;
  autoFundPrepared?: boolean;
  autoFundInProgress?: boolean;
};

export type AirfarmingNextDrop = AirfarmingUpcomingDrop;

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

export type AirfarmingLastSettledDrop = AirfarmingDropHistoryRow & {
  dropPhase?: AirfarmingDropPhase;
  dueAt?: string;
  secondsRemaining?: number;
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
  upcomingDrops?: AirfarmingUpcomingDrop[];
  eligibilityNotice?: string | null;
  lastSettledDrop?: AirfarmingLastSettledDrop | null;
  pollIntervalSec?: number;
  withdrawalTrustScore?: WithdrawalTrustScore | null;
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

function normalizeUpcomingDrop(raw: unknown): AirfarmingUpcomingDrop | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const dueAt = String(r.dueAt ?? '');
  if (!dueAt) return null;
  const percentLocked = Boolean(r.percentLocked);
  const percentRaw = r.percent;
  const percent = percentRaw != null && percentRaw !== '' ? num(percentRaw) : null;
  const eligibleRaw = r.eligibleNow;
  const eligibleNow =
    eligibleRaw === true || eligibleRaw === false ? Boolean(eligibleRaw) : null;
  const phaseRaw = r.dropPhase;
  const dropPhase =
    phaseRaw === 'waiting' ||
    phaseRaw === 'preparing' ||
    phaseRaw === 'processing' ||
    phaseRaw === 'rewarding' ||
    phaseRaw === 'idle'
      ? phaseRaw
      : undefined;
  return {
    id: r.id != null && String(r.id) ? String(r.id) : null,
    previewKey: String(r.previewKey ?? r.id ?? `${dueAt}:${num(r.dropIndex)}`),
    dropIndex: num(r.dropIndex),
    dueAt,
    secondsRemaining: num(r.secondsRemaining),
    minBalance: num(r.minBalance),
    maxBalance: num(r.maxBalance),
    percentLocked,
    isProjected: Boolean(r.isProjected),
    hasSnapshot: Boolean(r.hasSnapshot),
    eligibilitySnapshotBalance:
      r.eligibilitySnapshotBalance != null ? num(r.eligibilitySnapshotBalance) : null,
    percent,
    eligibleNow,
    projectedProfit: r.projectedProfit != null ? num(r.projectedProfit) : null,
    projectedProfitBase: r.projectedProfitBase != null ? num(r.projectedProfitBase) : null,
    dropPotentialMultiplier: r.dropPotentialMultiplier != null ? num(r.dropPotentialMultiplier) : undefined,
    dropPhase,
    autoFundPrepared: r.autoFundPrepared != null ? Boolean(r.autoFundPrepared) : undefined,
    autoFundInProgress: r.autoFundInProgress != null ? Boolean(r.autoFundInProgress) : undefined,
  };
}

function normalizeNextDrop(raw: unknown): AirfarmingNextDrop | null {
  return normalizeUpcomingDrop(raw);
}

function normalizeTrustScore(raw: unknown): WithdrawalTrustScore | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const band = r.band;
  const validBand =
    band === 'excellent' || band === 'good' || band === 'fair' || band === 'low' || band === 'poor'
      ? band
      : 'fair';
  const factorsRaw = Array.isArray(r.factors) ? r.factors : [];
  const statsRaw = r.stats && typeof r.stats === 'object' ? (r.stats as Record<string, unknown>) : {};
  return {
    score: num(r.score),
    band: validBand,
    label: String(r.label ?? 'Fair'),
    dropPotentialMultiplier: num(r.dropPotentialMultiplier, 1),
    dropPotentialPercent: num(r.dropPotentialPercent, num(r.score)),
    factors: factorsRaw.map((f) => {
      const row = f && typeof f === 'object' ? (f as Record<string, unknown>) : {};
      return {
        key: String(row.key ?? ''),
        label: String(row.label ?? ''),
        impact: num(row.impact),
        count: row.count != null ? num(row.count) : undefined,
        ratio: row.ratio != null ? num(row.ratio) : undefined,
        amountUsd: row.amountUsd != null ? num(row.amountUsd) : undefined,
        note: row.note != null ? String(row.note) : undefined,
      };
    }),
    stats: {
      withdrawCount7d: num(statsRaw.withdrawCount7d),
      withdrawCount30d: num(statsRaw.withdrawCount30d),
      withdrawCountLifetime: num(statsRaw.withdrawCountLifetime),
      withdrawAmount7d: num(statsRaw.withdrawAmount7d),
      withdrawAmount90d: num(statsRaw.withdrawAmount90d),
      depositAmount90d: num(statsRaw.depositAmount90d),
      illegalCount90d: num(statsRaw.illegalCount90d),
    },
    affectsDrops: Boolean(r.affectsDrops),
    message: String(r.message ?? ''),
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
    upcomingDrops: Array.isArray(r.upcomingDrops)
      ? (r.upcomingDrops as unknown[])
          .map((d) => normalizeUpcomingDrop(d))
          .filter((d): d is AirfarmingUpcomingDrop => d != null)
      : undefined,
    eligibilityNotice: r.eligibilityNotice != null ? String(r.eligibilityNotice) : null,
    lastSettledDrop:
      r.lastSettledDrop && typeof r.lastSettledDrop === 'object'
        ? {
            ...normalizeHistoryItem(r.lastSettledDrop as Record<string, unknown>),
            dropPhase:
              (r.lastSettledDrop as Record<string, unknown>).dropPhase === 'rewarding'
                ? 'rewarding'
                : undefined,
            dueAt:
              (r.lastSettledDrop as Record<string, unknown>).dueAt != null
                ? String((r.lastSettledDrop as Record<string, unknown>).dueAt)
                : undefined,
          }
        : null,
    pollIntervalSec: r.pollIntervalSec != null ? num(r.pollIntervalSec, 45) : 45,
    withdrawalTrustScore: normalizeTrustScore(r.withdrawalTrustScore),
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
