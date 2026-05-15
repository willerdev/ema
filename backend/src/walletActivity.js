/**
 * Unified wallet timeline: ledger entries + in-flight deposits/withdrawals.
 */

function buildWalletActivity({ ledger = [], payments = [], payouts = [] }) {
  const items = [];
  const payoutIdsSettledInLedger = new Set(
    ledger
      .filter((e) => e.source === 'payout' && e.direction === 'out')
      .map((e) => String(e.source_id))
  );

  for (const e of ledger) {
    items.push({
      id: `ledger-${e.id}`,
      kind: 'ledger',
      direction: e.direction,
      asset: String(e.asset || '').toLowerCase(),
      amount: Number(e.amount),
      status: 'completed',
      source: e.source,
      createdAt: e.created_at,
    });
  }

  for (const p of payouts) {
    if (payoutIdsSettledInLedger.has(String(p.id))) continue;
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    items.push({
      id: `payout-${p.id}`,
      kind: 'payout',
      direction: 'out',
      asset: String(p.currency || '').toLowerCase(),
      amount,
      status: String(p.status || 'pending').toLowerCase(),
      source: 'payout',
      createdAt: p.created_at,
    });
  }

  for (const p of payments) {
    const status = String(p.payment_status || '').toLowerCase();
    if (status === 'finished' && p.ledger_credited) continue;
    const amount = Number(p.actually_paid || p.pay_amount || p.price_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      if (status !== 'waiting' && status !== 'confirming') continue;
    }
    items.push({
      id: `payment-${p.id}`,
      kind: 'payment',
      direction: 'in',
      asset: String(p.pay_currency || '').toLowerCase(),
      amount: Number.isFinite(amount) && amount > 0 ? amount : Number(p.pay_amount || p.price_amount) || 0,
      status,
      source: 'payment',
      createdAt: p.created_at,
    });
  }

  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return items;
}

function mapPublicActivity(row) {
  return {
    id: row.id,
    kind: row.kind,
    direction: row.direction,
    asset: row.asset,
    amount: row.amount,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt,
  };
}

module.exports = { buildWalletActivity, mapPublicActivity };
