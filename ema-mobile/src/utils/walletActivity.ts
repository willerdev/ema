import type { NowpaymentsSummary, WalletActivityRow } from '../types';
import { formatLedgerSource } from './walletDisplay';

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
  if (summary.activity?.length) {
    return [...summary.activity].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  return mergeFromParts(summary);
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

export function activityTitle(row: WalletActivityRow): string {
  const dir = row.direction === 'in' ? 'Deposit' : 'Withdrawal';
  return `${dir} · ${row.asset.toUpperCase()}`;
}

export function activitySubtitle(row: WalletActivityRow): string {
  const time = Number.isFinite(Date.parse(row.createdAt))
    ? new Date(row.createdAt).toLocaleString()
    : '—';
  const status = formatActivityStatus(row.status);
  if (row.status === 'completed' || row.status === 'finished') {
    return `${time} · ${formatLedgerSource(row.source)}`;
  }
  return `${time} · ${status}`;
}
