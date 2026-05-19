import type {
  NowpaymentsSummary,
  TransactionCategory,
  TransactionHistoryTab,
  WalletActivityRow,
  WalletTransaction,
} from '../types';
import { palette } from '../theme/colors';
import { formatLedgerSource } from './walletDisplay';

export function formatAssetDisplay(asset: string): string {
  const a = String(asset || '').toLowerCase();
  if (a === 'usd' || a === 'cash') return 'USD';
  if (a === 'usdttrc20' || a === 'usdt') return 'USDT';
  if (a === 'usdterc20') return 'USDT (ERC20)';
  if (a === 'eth') return 'ETH';
  if (a === 'btc') return 'BTC';
  return a.toUpperCase();
}

function formatAmountDisplay(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '0';
  if (String(amount).includes('.') && n < 1000) {
    return n.toFixed(2).replace(/\.?0+$/, '') || '0';
  }
  return n.toFixed(8).replace(/\.?0+$/, '') || '0';
}

function inferCategory(row: {
  kind: WalletActivityRow['kind'];
  direction: 'in' | 'out';
  source: string;
  asset: string;
}): TransactionCategory {
  const src = String(row.source || '').toLowerCase();
  if (row.kind === 'cash') {
    if (src.includes('peer')) return 'transfer';
    if (row.direction === 'in') return 'deposit';
    return 'withdraw';
  }
  if (src.includes('local_') || src.includes('mobile') || src.includes('fiat')) return 'fiat';
  if (src.includes('p2p')) return 'p2p';
  if (src.includes('peer')) return 'transfer';
  if (row.kind === 'payment' || (row.direction === 'in' && row.kind === 'ledger')) return 'deposit';
  if (row.kind === 'payout' || row.direction === 'out') return 'withdraw';
  return row.direction === 'in' ? 'deposit' : 'withdraw';
}

function methodLabelFor(row: WalletActivityRow): string {
  if (row.methodLabel) return row.methodLabel;
  if (row.kind === 'cash') {
    if (row.category === 'transfer') return 'Member transfer';
    return row.category === 'deposit' ? 'Trading wallet deposit' : 'Trading wallet withdrawal';
  }
  if (row.category === 'fiat') return 'Mobile money';
  if (row.category === 'transfer') return 'Internal transfer';
  if (row.kind === 'payment') return 'On-chain deposit';
  if (row.kind === 'payout') return 'On-chain withdrawal';
  return formatLedgerSource(row.source);
}

function mergeFromParts(summary: NowpaymentsSummary): WalletActivityRow[] {
  const items: WalletActivityRow[] = [];
  const payoutById = new Map((summary.payouts ?? []).map((p) => [p.id, p]));
  const paymentById = new Map((summary.payments ?? []).map((p) => [p.id, p]));
  const settledPayoutIds = new Set(
    (summary.ledger ?? [])
      .filter((e) => e.source === 'payout' && e.direction === 'out')
      .map((e) => e.sourceId || e.id)
  );

  for (const e of summary.ledger ?? []) {
    const base = {
      id: `ledger-${e.id}`,
      kind: 'ledger' as const,
      direction: e.direction,
      asset: e.asset,
      amount: e.amount,
      status: 'completed',
      source: e.source,
      createdAt: e.createdAt,
    };
    const category = inferCategory(base);
    items.push({
      ...base,
      category,
      methodLabel: methodLabelFor({ ...base, category, methodLabel: undefined } as WalletActivityRow),
    });
  }

  for (const p of summary.payouts ?? []) {
    if (settledPayoutIds.has(p.id)) continue;
    const base = {
      id: `payout-${p.id}`,
      kind: 'payout' as const,
      direction: 'out' as const,
      asset: p.currency,
      amount: p.amount,
      status: p.status,
      source: 'payout',
      createdAt: p.createdAt,
      address: p.address,
    };
    const category = inferCategory(base);
    items.push({
      ...base,
      category,
      methodLabel: 'On-chain withdrawal',
      address: p.address,
    });
  }

  for (const p of summary.payments ?? []) {
    const status = String(p.status || '').toLowerCase();
    if (status === 'finished' && p.ledgerCredited) continue;
    const amount = Number(p.payAmount || p.priceAmount);
    const base = {
      id: `payment-${p.id}`,
      kind: 'payment' as const,
      direction: 'in' as const,
      asset: p.payCurrency,
      amount: Number.isFinite(amount) ? amount : 0,
      status: p.status,
      source: 'payment',
      createdAt: p.createdAt,
      address: p.payAddress || undefined,
    };
    const category = inferCategory(base);
    items.push({
      ...base,
      category,
      methodLabel: 'On-chain deposit',
      address: p.payAddress || undefined,
    });
  }

  void payoutById;
  void paymentById;
  return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function cashTransactionsToActivityRows(transactions: WalletTransaction[]): WalletActivityRow[] {
  return transactions.map((tx) => {
    const direction: 'in' | 'out' =
      tx.type === 'deposit' || tx.type === 'peer_receive' ? 'in' : 'out';
    const base = {
      id: `cash-${tx.id}`,
      kind: 'cash' as const,
      direction,
      asset: 'usd',
      amount: Number(tx.amount),
      status: tx.status.startsWith('completed') ? 'completed' : tx.status,
      source: tx.type,
      createdAt: tx.created_at,
    };
    const category = inferCategory(base);
    const methodLabel =
      tx.type === 'peer_send' || tx.type === 'peer_receive'
        ? 'Member transfer'
        : tx.type === 'deposit'
          ? 'Trading wallet deposit'
          : 'Trading wallet withdrawal';
    return {
      ...base,
      category,
      methodLabel,
    };
  });
}

export function mergeAllWalletActivity(
  summary: NowpaymentsSummary | null | undefined,
  cashTransactions?: WalletTransaction[]
): WalletActivityRow[] {
  const crypto = mergeWalletActivity(summary);
  const cash = cashTransactions ? cashTransactionsToActivityRows(cashTransactions) : [];
  return sortActivityNewestFirst([...crypto, ...cash]);
}

export function mergeWalletActivity(summary: NowpaymentsSummary | null | undefined): WalletActivityRow[] {
  if (!summary) return [];
  const base = summary.activity?.length
    ? summary.activity.map((r) => enrichActivityRow(r, summary))
    : mergeFromParts(summary);
  return sortActivityNewestFirst(attachRunningBalances(base.map((r) => ({ ...r }))));
}

function enrichActivityRow(row: WalletActivityRow, summary: NowpaymentsSummary): WalletActivityRow {
  const category = row.category ?? inferCategory(row);
  let address = row.address;
  if (!address && row.kind === 'payout') {
    const id = row.id.replace(/^payout-/, '');
    address = summary.payouts?.find((p) => p.id === id)?.address;
  }
  if (!address && row.kind === 'payment') {
    const id = row.id.replace(/^payment-/, '');
    address = summary.payments?.find((p) => p.id === id)?.payAddress || undefined;
  }
  return {
    ...row,
    category,
    address,
    methodLabel: row.methodLabel ?? methodLabelFor({ ...row, category }),
  };
}

export function isActivityToday(createdAt: string): boolean {
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return false;
  const d = new Date(ms);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function filterActivityToday(rows: WalletActivityRow[], limit?: number): WalletActivityRow[] {
  const today = rows.filter((r) => isActivityToday(r.createdAt));
  return limit != null ? today.slice(0, limit) : today;
}

export function filterActivityByTab(rows: WalletActivityRow[], tab: TransactionHistoryTab): WalletActivityRow[] {
  if (tab === 'all') return rows;
  if (tab === 'deposit') return rows.filter((r) => r.category === 'deposit');
  if (tab === 'withdraw') return rows.filter((r) => r.category === 'withdraw');
  if (tab === 'transfer') return rows.filter((r) => r.category === 'transfer');
  if (tab === 'p2p') return rows.filter((r) => r.category === 'p2p');
  if (tab === 'fiat') return rows.filter((r) => r.category === 'fiat');
  return rows;
}

export function filterActivityByAsset(rows: WalletActivityRow[], assetFilter: string): WalletActivityRow[] {
  if (!assetFilter || assetFilter === 'all') return rows;
  const key = assetFilter.toLowerCase();
  return rows.filter((r) => {
    const a = String(r.asset || '').toLowerCase();
    if (key === 'usdt') return a.includes('usdt');
    return a === key;
  });
}

export function filterActivityByMethod(rows: WalletActivityRow[], methodFilter: string): WalletActivityRow[] {
  if (!methodFilter || methodFilter === 'all') return rows;
  const key = methodFilter.toLowerCase();
  return rows.filter((r) => {
    const label = (r.methodLabel || methodLabelFor(r)).toLowerCase();
    if (key === 'onchain') return label.includes('on-chain');
    if (key === 'internal') return label.includes('member') || label.includes('internal');
    if (key === 'mobile') return label.includes('mobile');
    return label.includes(key);
  });
}

export function uniqueAssets(rows: WalletActivityRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const a = String(r.asset || '').toLowerCase();
    if (!a) continue;
    if (a.includes('usdt')) set.add('usdt');
    else set.add(a);
  }
  return ['all', ...Array.from(set).sort()];
}

export function formatActivityStatus(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'finished') return 'Completed';
  if (s.startsWith('completed')) return 'Completed';
  if (s === 'in_progress') return 'In progress';
  if (s === 'awaiting_verify') return 'In progress';
  if (s === 'processing' || s === 'sending' || s === 'confirming' || s === 'pending' || s === 'creating' || s === 'waiting')
    return 'In progress';
  if (s === 'waiting') return 'Waiting';
  if (s === 'failed' || s === 'rejected' || s === 'expired') return 'Failed';
  if (s === 'partially_paid') return 'Partial';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending';
}

export function activityStatusLabel(row: WalletActivityRow): string {
  const cat = row.category;
  const settled = row.status === 'completed' || row.status === 'finished' || String(row.status).startsWith('completed');
  const prefix =
    cat === 'deposit'
      ? 'Deposit'
      : cat === 'withdraw'
        ? 'Withdrawal'
        : cat === 'transfer'
          ? 'Transfer'
          : cat === 'fiat'
            ? 'Mobile money'
            : 'Transaction';
  return settled ? `${prefix} completed` : `${prefix} · ${formatActivityStatus(row.status)}`;
}

export function activityIsCompleted(row: WalletActivityRow): boolean {
  const s = String(row.status || '').toLowerCase();
  return s === 'completed' || s === 'finished' || s.startsWith('completed');
}

export function activityHeadline(row: WalletActivityRow): string {
  if (row.category === 'transfer') {
    return row.direction === 'in' ? `Received ${formatAssetDisplay(row.asset)}` : `Sent ${formatAssetDisplay(row.asset)}`;
  }
  const dir = row.direction === 'in' ? 'Deposit' : 'Withdrawal';
  return `${dir} ${formatAssetDisplay(row.asset)}`;
}

export function activityListTitle(row: WalletActivityRow): string {
  return formatAssetDisplay(row.asset);
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
  const settled = activityIsCompleted(row);
  return settled ? `Type ${type}` : `Type ${type} · ${formatActivityStatus(row.status)}`;
}

export function activityAmountText(row: WalletActivityRow): { text: string; color: string } {
  const n = formatAmountDisplay(row.amount);
  const sign = row.direction === 'in' ? '+' : '-';
  const color = row.direction === 'in' ? palette.success : palette.danger;
  return { text: `${sign}${n}`, color };
}

export function activityAmountPlain(row: WalletActivityRow): string {
  return `${formatAmountDisplay(row.amount)} ${formatAssetDisplay(row.asset)}`;
}

export function activitySubtitle(row: WalletActivityRow): string {
  return `${activityTimestamp(row.createdAt)} · ${activityTypeLine(row)}`;
}

export function blockchainExplorerUrl(row: WalletActivityRow): string | null {
  if (!row.txHash) return null;
  const hash = row.txHash.trim();
  const asset = String(row.asset || '').toLowerCase();
  if (asset.includes('trc20') || asset === 'trx') return `https://tronscan.org/#/transaction/${hash}`;
  if (asset === 'eth' || asset.includes('erc20')) return `https://etherscan.io/tx/${hash}`;
  if (asset === 'btc') return `https://mempool.space/tx/${hash}`;
  return null;
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
    if (activityIsCompleted(row)) {
      row.availableBalance = running[asset];
    }
  }
  return asc.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function sortActivityNewestFirst(rows: WalletActivityRow[]): WalletActivityRow[] {
  return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
