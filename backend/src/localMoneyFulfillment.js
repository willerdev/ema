const crypto = require('crypto');
const {
  insertCryptoLedgerEntry,
  getCryptoLedgerEntryBySource,
  updateLocalMoneyOrder,
} = require('./db');
const { getRegion, maskPhone } = require('./localMoneyRegions');
const { sendSms } = require('./services/twilioSms');

const COMPLETED_STATUSES = new Set(['completed', 'successful', 'success', 'succeeded']);

function newId() {
  return crypto.randomUUID();
}

async function creditDepositLedger(order) {
  if (order.ledger_posted || order.type !== 'deposit') return order;
  const usdt = Number(order.crypto_amount);
  if (!Number.isFinite(usdt) || usdt <= 0) return order;

  const existing = await getCryptoLedgerEntryBySource('local_deposit', order.id, 'in');
  if (existing) {
    return updateLocalMoneyOrder(order.id, { ledger_posted: true });
  }

  await insertCryptoLedgerEntry({
    id: newId(),
    user_id: order.user_id,
    asset: 'usdt',
    direction: 'in',
    amount: usdt,
    source: 'local_deposit',
    source_id: order.id,
  });
  return updateLocalMoneyOrder(order.id, { ledger_posted: true });
}

async function notifyOrderSms(order, message) {
  if (!order?.phone) return;
  try {
    await sendSms(order.phone, message);
  } catch {
    /* non-fatal */
  }
}

/**
 * Mark order completed/failed and credit wallet on successful deposit.
 */
async function fulfillLocalMoneyOrder(order, nextStatus, providerPayload) {
  if (!order) return null;
  const status = String(nextStatus || '').toLowerCase();
  const patch = { status };
  if (providerPayload) patch.provider_payload = providerPayload;

  let updated = await updateLocalMoneyOrder(order.id, patch);

  if (order.type === 'deposit' && COMPLETED_STATUSES.has(status)) {
    updated = await creditDepositLedger(updated);
    const region = getRegion(updated.country_code);
    const label = region?.fiatLabel || updated.fiat_currency;
    await notifyOrderSms(
      updated,
      `Ema: Your deposit of ${updated.fiat_amount} ${label} is complete.`
    );
  }

  if (order.type === 'withdraw' && COMPLETED_STATUSES.has(status)) {
    const region = getRegion(updated.country_code);
    const label = region?.fiatLabel || updated.fiat_currency;
    await notifyOrderSms(
      updated,
      `Ema: Your withdrawal of ${updated.crypto_amount} USDT (~${updated.fiat_amount} ${label}) to ${maskPhone(updated.phone)} is complete.`
    );
  }

  return updated;
}

module.exports = {
  COMPLETED_STATUSES,
  creditDepositLedger,
  fulfillLocalMoneyOrder,
};
