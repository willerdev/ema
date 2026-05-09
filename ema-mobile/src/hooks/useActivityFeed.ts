import { useMemo } from 'react';
import type { ActivityFeedItem, CryptoActivityRow, Order } from '../types';

function parseOrderTime(o: Order): number {
  const t = o.submitted_at || '';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

function parseCryptoTime(c: CryptoActivityRow): number {
  const ms = Date.parse(c.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function formatTs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Unknown time';
  return new Date(ms).toLocaleString();
}

export function buildActivityFeed(orders: Order[], cryptoActivity: CryptoActivityRow[], maxItems = 20): ActivityFeedItem[] {
  type Entry = { item: ActivityFeedItem; ts: number };
  const entries: Entry[] = [];

  for (const o of orders) {
    entries.push({
      ts: parseOrderTime(o),
      item: {
        id: `alpaca:${o.id}`,
        title: `${o.symbol} ${String(o.side).toUpperCase()}`,
        subtitle: o.status || 'order',
        amountLabel: `Qty ${o.qty}`,
        directionLabel: String(o.side).toLowerCase() === 'buy' ? 'incoming' : 'outgoing',
        timestampLabel: formatTs(parseOrderTime(o)),
        kind: 'alpaca_order',
      },
    });
  }

  for (const c of cryptoActivity) {
    entries.push({
      ts: parseCryptoTime(c),
      item: {
        id: `crypto:${c.id}`,
        title: `${c.direction === 'in' ? 'Receive' : 'Send'} ${c.asset}`,
        subtitle: (c.txHash || '').slice(0, 14) + (c.txHash && c.txHash.length > 14 ? '…' : ''),
        amountLabel: c.amountDisplay,
        directionLabel: c.direction === 'in' ? 'incoming' : 'outgoing',
        timestampLabel: formatTs(parseCryptoTime(c)),
        kind: 'crypto_tx',
      },
    });
  }

  entries.sort((a, b) => b.ts - a.ts);
  return entries.slice(0, maxItems).map((e) => e.item);
}

export function useActivityFeed(orders: Order[], cryptoActivity: CryptoActivityRow[]) {
  return useMemo(() => {
    const merged = buildActivityFeed(orders, cryptoActivity, 25);
    if (merged.length) return merged;
    return [
      {
        id: 'placeholder:1',
        title: 'Activity feed',
        subtitle: 'Your unified timeline will appear here soon.',
        directionLabel: 'neutral',
        timestampLabel: '—',
        kind: 'placeholder',
      },
    ] as ActivityFeedItem[];
  }, [orders, cryptoActivity]);
}
