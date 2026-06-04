const SNAPSHOT_FRESH_MS = 120 * 1000;

function positionsFromAccountRow(account) {
  const raw = account?.ea_positions_snapshot;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      id: String(p.id ?? p.ticket ?? p.positionId ?? ''),
      symbol: String(p.symbol || ''),
      side: String(p.side || p.type || '').toLowerCase(),
      volume: Number(p.volume || 0),
      openPrice: Number(p.openPrice ?? p.price_open ?? p.price ?? 0),
      profit: Number(p.profit ?? 0),
      time: p.time || p.openedAt || null,
    }))
    .filter((p) => p.id);
}

function snapshotFresh(account, nowMs = Date.now()) {
  if (!account?.ea_snapshot_at) return false;
  const t = new Date(account.ea_snapshot_at).getTime();
  return Number.isFinite(t) && nowMs - t < SNAPSHOT_FRESH_MS;
}

function sumOpenProfit(positions) {
  return positions.reduce((s, p) => s + (Number(p.profit) || 0), 0);
}

function computeLiveBalances(account, walletRow) {
  const deposited = Number(walletRow?.balance || 0);
  const positions = positionsFromAccountRow(account);
  const fresh = snapshotFresh(account);
  const openProfit = fresh ? sumOpenProfit(positions) : 0;
  return {
    depositedBalance: deposited,
    openProfit,
    displayBalance: deposited + openProfit,
    snapshotFresh: fresh,
    positions,
  };
}

module.exports = {
  SNAPSHOT_FRESH_MS,
  positionsFromAccountRow,
  snapshotFresh,
  computeLiveBalances,
};
