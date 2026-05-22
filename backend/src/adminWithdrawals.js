const {
  getUsersByIds,
  getTransactionById,
  updateTransaction,
  getNowpaymentsPayoutById,
  updateNowpaymentsPayout,
  getLocalMoneyOrderById,
  updateLocalMoneyOrder,
  ensureWalletForUser,
  setWalletBalance,
  insertCryptoLedgerEntry,
  getCryptoLedgerEntryBySource,
} = require('./db');
const { refundCashFundingForPayout } = require('./walletFunding');
const { submitPayoutToProvider } = require('./nowpaymentsPayoutFlow');
const { notifyWithdrawalOutcome } = require('./depositNotifications');
const { getRegion, maskPhone } = require('./localMoneyRegions');
const { sendSms } = require('./services/twilioSms');
const crypto = require('crypto');

function newId() {
  return crypto.randomUUID();
}

async function refundLocalMoneyWithdraw(order) {
  if (!order?.ledger_posted) return;
  const existing = await getCryptoLedgerEntryBySource('local_withdraw_refund', order.id, 'in');
  if (existing) return;
  await insertCryptoLedgerEntry({
    id: newId(),
    user_id: order.user_id,
    asset: String(order.crypto_asset || 'usdt').toLowerCase(),
    direction: 'in',
    amount: Number(order.crypto_amount),
    source: 'local_withdraw_refund',
    source_id: order.id,
  });
}

async function approveWithdrawal({ source, id }) {
  if (source === 'cash_wallet') {
    const tx = await getTransactionById(id);
    if (!tx || tx.type !== 'withdraw') {
      const err = new Error('Withdrawal not found');
      err.status = 404;
      throw err;
    }
    const st = String(tx.status || '');
    if (!st.startsWith('pending')) {
      const err = new Error('Withdrawal is not pending approval');
      err.status = 400;
      throw err;
    }
    const meta = st.slice('pending:'.length) || 'bank_transfer';
    const updated = await updateTransaction(id, {
      status: `completed:${meta}`,
    });
    void notifyWithdrawalOutcome({
      userId: tx.user_id,
      amount: Number(tx.amount),
      asset: 'usd',
      status: 'finished',
    });
    return { source, id, status: updated.status };
  }

  if (source === 'nowpayments') {
    const row = await getNowpaymentsPayoutById(id);
    if (!row) {
      const err = new Error('Withdrawal not found');
      err.status = 404;
      throw err;
    }
    if (String(row.status).toLowerCase() !== 'awaiting_approval') {
      const err = new Error('Withdrawal is not awaiting approval');
      err.status = 400;
      throw err;
    }
    const updated = await submitPayoutToProvider(row);
    void notifyWithdrawalOutcome({
      userId: row.user_id,
      amount: Number(row.amount),
      asset: row.currency,
      status: 'in_progress',
    });
    return { source, id, status: updated.status, payoutId: updated.payout_id };
  }

  if (source === 'local_money') {
    const order = await getLocalMoneyOrderById(id);
    if (!order || order.type !== 'withdraw') {
      const err = new Error('Withdrawal not found');
      err.status = 404;
      throw err;
    }
    if (String(order.status).toLowerCase() !== 'awaiting_approval') {
      const err = new Error('Withdrawal is not awaiting approval');
      err.status = 400;
      throw err;
    }
    const updated = await updateLocalMoneyOrder(id, { status: 'processing' });
    const region = getRegion(updated.country_code);
    const label = region?.fiatLabel || updated.fiat_currency;
    const smsInit = `Ema: Your withdrawal of ${updated.crypto_amount} USDT (~${updated.fiat_amount} ${label}) to ${maskPhone(updated.phone)} was approved and is being processed.`;
    try {
      await sendSms(updated.phone, smsInit);
    } catch {
      /* ignore */
    }
    void notifyWithdrawalOutcome({
      userId: updated.user_id,
      amount: Number(updated.crypto_amount),
      asset: updated.crypto_asset || 'usdt',
      status: 'in_progress',
    });
    return { source, id, status: updated.status };
  }

  const err = new Error('Unknown withdrawal source');
  err.status = 400;
  throw err;
}

async function rejectWithdrawal({ source, id, note }) {
  const adminNote = note ? String(note).trim().slice(0, 500) : null;

  if (source === 'cash_wallet') {
    const tx = await getTransactionById(id);
    if (!tx || tx.type !== 'withdraw') {
      const err = new Error('Withdrawal not found');
      err.status = 404;
      throw err;
    }
    const st = String(tx.status || '');
    if (!st.startsWith('pending')) {
      const err = new Error('Withdrawal is not pending approval');
      err.status = 400;
      throw err;
    }
    const wallet = await ensureWalletForUser(tx.user_id);
    const current = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
    const amount = Number(tx.amount);
    await setWalletBalance(tx.user_id, Math.round((current + amount) * 100) / 100);
    const meta = st.slice('pending:'.length) || 'bank_transfer';
    const status = adminNote ? `rejected:${meta}:${adminNote}` : `rejected:${meta}`;
    const updated = await updateTransaction(id, { status });
    void notifyWithdrawalOutcome({
      userId: tx.user_id,
      amount,
      asset: 'usd',
      status: 'failed',
    });
    return { source, id, status: updated.status, refunded: true };
  }

  if (source === 'nowpayments') {
    const row = await getNowpaymentsPayoutById(id);
    if (!row) {
      const err = new Error('Withdrawal not found');
      err.status = 404;
      throw err;
    }
    if (String(row.status).toLowerCase() !== 'awaiting_approval') {
      const err = new Error('Withdrawal is not awaiting approval');
      err.status = 400;
      throw err;
    }
    await refundCashFundingForPayout(row);
    const updated = await updateNowpaymentsPayout(row.id, {
      status: 'rejected',
      reserve_released: true,
      raw_last_ipn: adminNote ? { adminRejected: true, note: adminNote } : { adminRejected: true },
    });
    void notifyWithdrawalOutcome({
      userId: row.user_id,
      amount: Number(row.amount),
      asset: row.currency,
      status: 'failed',
    });
    return { source, id, status: updated.status, refunded: true };
  }

  if (source === 'local_money') {
    const order = await getLocalMoneyOrderById(id);
    if (!order || order.type !== 'withdraw') {
      const err = new Error('Withdrawal not found');
      err.status = 404;
      throw err;
    }
    if (String(order.status).toLowerCase() !== 'awaiting_approval') {
      const err = new Error('Withdrawal is not awaiting approval');
      err.status = 400;
      throw err;
    }
    await refundLocalMoneyWithdraw(order);
    const updated = await updateLocalMoneyOrder(id, {
      status: 'cancelled',
      ledger_posted: false,
    });
    void notifyWithdrawalOutcome({
      userId: order.user_id,
      amount: Number(order.crypto_amount),
      asset: order.crypto_asset || 'usdt',
      status: 'failed',
    });
    return { source, id, status: updated.status, refunded: true };
  }

  const err = new Error('Unknown withdrawal source');
  err.status = 400;
  throw err;
}

module.exports = {
  approveWithdrawal,
  rejectWithdrawal,
};
