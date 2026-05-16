/** User-facing labels — never expose payment provider names. */
export function formatLedgerSource(source: string): string {
  const s = String(source || '').toLowerCase();
  if (!s || s.includes('nowpayment') || s.includes('np_')) return 'Wallet';
  if (s.includes('local_deposit')) return 'Mobile deposit';
  if (s.includes('local_withdraw')) return 'Mobile withdrawal';
  if (s.includes('cash_wallet')) return 'Cash wallet';
  if (s.includes('deposit')) return 'Deposit';
  if (s.includes('withdraw') || s.includes('payout')) return 'Withdrawal';
  if (s.includes('airfarm')) return 'Airfarming';
  if (s.includes('contract')) return 'Contracts';
  return 'Transfer';
}

export const GAS_RESERVE_PERCENT = 0.05;

export function maxWithdrawableAmount(availableBalance: number): number {
  if (!Number.isFinite(availableBalance) || availableBalance <= 0) return 0;
  return Math.max(0, availableBalance * (1 - GAS_RESERVE_PERCENT));
}

export function findBalanceForNetwork(
  balances: { asset: string; available: string }[] | undefined,
  networkCode: string
): number {
  if (!balances?.length) return 0;
  const code = networkCode.toLowerCase();
  const row =
    balances.find((b) => b.asset.toLowerCase() === code) ||
    balances.find((b) => code.includes('usdt') && b.asset.toLowerCase().includes('usdt')) ||
    balances.find((b) => b.asset.toLowerCase().includes(code));
  return Number(row?.available ?? 0) || 0;
}

/** Crypto ledger + cash wallet (USD) for USDT-family networks. */
export function combinedWithdrawableForNetwork(
  summary: { balances?: { asset: string; available: string }[]; cashWalletUsd?: number } | null | undefined,
  networkCode: string
): number {
  const crypto = findBalanceForNetwork(summary?.balances, networkCode);
  const code = networkCode.toLowerCase();
  const cash = code.includes('usdt') ? Number(summary?.cashWalletUsd ?? 0) || 0 : 0;
  return crypto + cash;
}
