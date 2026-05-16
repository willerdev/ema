const crypto = require('crypto');
const {
  insertCryptoLedgerEntry,
  getCryptoLedgerEntryBySource,
  updateLocalMoneyOrder,
} = require('./db');
const { getRegion, maskPhone } = require('./localMoneyRegions');
const { canonicalUsdtAsset } = require('./usdtBalances');
const { sendSms } = require('./services/twilioSms');
const { notifyDepositCredited, notifyWithdrawalOutcome, formatAmount } = require('./depositNotifications');

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
    asset: canonicalUsdtAsset(),
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
    const beforePosted = updated.ledger_posted;
    updated = await creditDepositLedger(updated);
    if (!beforePosted && updated.ledger_posted) {
      const region = getRegion(updated.country_code);
      const label = region?.fiatLabel || updated.fiat_currency;
      void notifyDepositCredited({
        userId: updated.user_id,
        amount: updated.crypto_amount,
        asset: updated.crypto_asset || 'usdt',
        body: `Your deposit of ${updated.fiat_amount} ${label} is complete. ${formatAmount(updated.crypto_amount)} USDT added to your wallet.`,
      });
    }
  }

  if (order.type === 'withdraw' && COMPLETED_STATUSES.has(status)) {
    const region = getRegion(updated.country_code);
    const label = region?.fiatLabel || updated.fiat_currency;
    void notifyWithdrawalOutcome({
      userId: updated.user_id,
      amount: updated.crypto_amount,
      asset: updated.crypto_asset || 'usdt',
      status: 'finished',
    });
    await notifyOrderSms(
      updated,
      `Your withdrawal of ${formatAmount(updated.crypto_amount)} USDT (~${updated.fiat_amount} ${label}) to ${maskPhone(updated.phone)} is complete.`
    );
  }

  if (order.type === 'withdraw' && (status === 'failed' || status === 'cancelled')) {
    void notifyWithdrawalOutcome({
      userId: updated.user_id,
      amount: updated.crypto_amount,
      asset: updated.crypto_asset || 'usdt',
      status: 'failed',
    });
  }

  return updated;
}

module.exports = {
  COMPLETED_STATUSES,
  creditDepositLedger,
  fulfillLocalMoneyOrder,
};
