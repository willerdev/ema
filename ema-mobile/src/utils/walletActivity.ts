import type { NowpaymentsSummary, WalletActivityRow } from '../types';
import { palette } from '../theme/colors';
import { formatLedgerSource } from './walletDisplay';

export function formatAssetDisplay(asset: string): string {
  const a = String(asset || '').toLowerCase();
  if (a === 'usdttrc20' || a === 'usdt') return 'USDT';
  if (a === 'usdterc20') return 'USDT (ERC20)';
  if (a === 'eth') return 'ETH';
  if (a === 'btc') return 'BTC';
  return a.toUpperCase();
}

function formatAmountDisplay(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(8).replace(/\.?0+$/, '') || '0';
}

function mergeFromParts(summary: NowpaymentsSummary): WalletActivityRow[] {
  const items: WalletActivityRow[] = [];
  const settledPayoutIds = new Set(
    (summary.ledger ?? [])
      .filter((e) => e.source === 'payout' && e.direction === 'out')
      .map((e) => e.sourceId || e.id)
  );

  for (const e of summary.ledger ?? []) {
    items.push({
      id: `ledger-${e.id}`,
      kind: 'ledger',
      direction: e.direction,
      asset: e.asset,
      amount: e.amount,
      status: 'completed',
      source: e.source,
      createdAt: e.createdAt,
    });
  }

  for (const p of summary.payouts ?? []) {
    if (settledPayoutIds.has(p.id)) continue;
    items.push({
      id: `payout-${p.id}`,
      kind: 'payout',
      direction: 'out',
      asset: p.currency,
      amount: p.amount,
      status: p.status,
      source: 'payout',
      createdAt: p.createdAt,
    });
  }

  for (const p of summary.payments ?? []) {
    const status = String(p.status || '').toLowerCase();
    if (status === 'finished' && p.ledgerCredited) continue;
    const amount = Number(p.payAmount || p.priceAmount);
    items.push({
      id: `payment-${p.id}`,
      kind: 'payment',
      direction: 'in',
      asset: p.payCurrency,
      amount: Number.isFinite(amount) ? amount : 0,
      status: p.status,
      source: 'payment',
      createdAt: p.createdAt,
    });
  }

  return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function mergeWalletActivity(summary: NowpaymentsSummary | null | undefined): WalletActivityRow[] {
  if (!summary) return [];
  const base = summary.activity?.length
    ? [...summary.activity]
    : mergeFromParts(summary);
  return sortActivityNewestFirst(attachRunningBalances(base.map((r) => ({ ...r }))));
}

export function formatActivityStatus(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'finished') return 'Completed';
  if (s === 'awaiting_verify') return 'Awaiting verification';
  if (s === 'processing' || s === 'sending' || s === 'confirming') return 'Processing';
  if (s === 'waiting') return 'Waiting';
  if (s === 'failed' || s === 'rejected' || s === 'expired') return 'Failed';
  if (s === 'partially_paid') return 'Partial';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending';
}

export function activityHeadline(row: WalletActivityRow): string {
  const dir = row.direction === 'in' ? 'Deposit' : 'Withdrawal';
  return `${dir} ${formatAssetDisplay(row.asset)}`;
}

export function activityTimestamp(createdAt: string): string {
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function activityTypeLine(row: WalletActivityRow): string {
  const type =
    row.direction === 'in'
      ? row.kind === 'payment'
        ? 'Deposit'
        : formatLedgerSource(row.source)
      : 'Withdraw';
  if (row.availableBalance != null && Number.isFinite(row.availableBalance)) {
    return `Type ${type} · Available balance ${formatAmountDisplay(row.availableBalance)}`;
  }
  const settled = row.status === 'completed' || row.status === 'finished';
  return settled ? `Type ${type}` : `Type ${type} · ${formatActivityStatus(row.status)}`;
}

export function activityAmountText(row: WalletActivityRow): { text: string; color: string } {
  const n = formatAmountDisplay(row.amount);
  const sign = row.direction === 'in' ? '+' : '-';
  const color = row.direction === 'in' ? palette.success : palette.danger;
  return { text: `${sign}${n}`, color };
}

/** @deprecated use activityHeadline */
export function activityTitle(row: WalletActivityRow): string {
  return activityHeadline(row);
}

export function activitySubtitle(row: WalletActivityRow): string {
  return `${activityTimestamp(row.createdAt)} · ${activityTypeLine(row)}`;
}

function attachRunningBalances(items: WalletActivityRow[]): WalletActivityRow[] {
  const asc = [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const running: Record<string, number> = {};
  for (const row of asc) {
    const asset = String(row.asset || '').toLowerCase();
    if (!asset) continue;
    if (!running[asset]) running[asset] = 0;
    const n = Number(row.amount);
    if (!Number.isFinite(n)) continue;
    if (row.direction === 'in') running[asset] += n;
    else running[asset] = Math.max(0, running[asset] - n);
    if (row.status === 'completed' || row.status === 'finished') {
      row.availableBalance = running[asset];
    }
  }
  return asc.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function sortActivityNewestFirst(rows: WalletActivityRow[]): WalletActivityRow[] {
  return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
