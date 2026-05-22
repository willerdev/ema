const crypto = require('crypto');
const np = require('./services/nowpaymentsClient');
const {
  insertNowpaymentsPayout,
  updateNowpaymentsPayout,
  getCryptoBalancesByUserId,
} = require('./db');
const { fundPayoutFromCashWallet, refundCashFundingForPayout } = require('./walletFunding');
const { normalizeCurrency } = require('./currencyNormalize');

function newId() {
  return crypto.randomUUID();
}

function payoutIpnUrl() {
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}/webhooks/nowpayments/payout` : '';
}

async function getAvailableForAsset(userId, asset) {
  const balances = await getCryptoBalancesByUserId(userId);
  const row = balances.find((b) => b.asset === asset);
  return row ? Number(row.available) : 0;
}

/**
 * Reserve funds and queue crypto payout for admin approval (no NOWPayments API call yet).
 */
async function createPayoutAwaitingApproval({ userId, currency, address, amount }) {
  const payoutId = newId();
  const uniqueExternalId = newId().replace(/-/g, '').slice(0, 24);
  let cashFunded = 0;

  const funding = await fundPayoutFromCashWallet({
    userId,
    asset: currency,
    amount,
    payoutId,
  });
  cashFunded = funding.cashFunded;

  const available = await getAvailableForAsset(userId, currency);
  if (available < amount) {
    if (cashFunded > 0) {
      await refundCashFundingForPayout({
        id: payoutId,
        user_id: userId,
        currency,
        cash_funded_amount: cashFunded,
      });
    }
    const err = new Error('Insufficient balance after funding');
    err.status = 400;
    err.details = { available, requested: amount };
    throw err;
  }

  return insertNowpaymentsPayout({
    id: payoutId,
    user_id: userId,
    payout_id: null,
    unique_external_id: uniqueExternalId,
    currency,
    address,
    amount,
    cash_funded_amount: cashFunded,
    status: 'awaiting_approval',
    reserve_released: false,
    raw_last_ipn: null,
  });
}

/**
 * Send an admin-approved payout to NOWPayments.
 */
async function submitPayoutToProvider(payoutRow) {
  if (!payoutRow) {
    const err = new Error('Payout not found');
    err.status = 404;
    throw err;
  }
  if (String(payoutRow.status).toLowerCase() !== 'awaiting_approval') {
    const err = new Error('Payout is not awaiting approval');
    err.status = 400;
    throw err;
  }
  if (payoutRow.payout_id) {
    const err = new Error('Payout was already submitted to the provider');
    err.status = 400;
    throw err;
  }

  if (!np.configured()) {
    const err = new Error('NOWPayments is not configured');
    err.status = 503;
    throw err;
  }
  if (!np.payoutAuthConfigured()) {
    const err = new Error('NOWPayments payout auth is not configured');
    err.status = 503;
    throw err;
  }

  const uniqueExternalId = payoutRow.unique_external_id;
  const ipnUrl = payoutIpnUrl();

  let npResult;
  try {
    npResult = await np.createPayout({
      ipnCallbackUrl: ipnUrl || undefined,
      withdrawals: [
        {
          uniqueExternalId,
          address: payoutRow.address,
          currency: payoutRow.currency,
          amount: Number(payoutRow.amount),
        },
      ],
    });
  } catch (e) {
    await refundCashFundingForPayout(payoutRow);
    await updateNowpaymentsPayout(payoutRow.id, {
      status: 'failed',
      reserve_released: true,
      raw_last_ipn: { error: e.message },
    });
    throw e;
  }

  const { withdrawalId, batchId } = np.extractPayoutIds(npResult);
  if (!withdrawalId) {
    await refundCashFundingForPayout(payoutRow);
    await updateNowpaymentsPayout(payoutRow.id, {
      status: 'failed',
      reserve_released: true,
      raw_last_ipn: { error: 'No withdrawal id in payout response', npResult },
    });
    const err = new Error('Provider did not return a payout id');
    err.status = 502;
    throw err;
  }

  const npStatus = String(npResult.status || 'processing').toLowerCase();
  let status = npStatus === 'finished' ? 'finished' : 'in_progress';
  let verifyRaw = null;

  if (process.env.NOWPAYMENTS_AUTO_VERIFY_PAYOUT === '1' && np.payoutVerifyConfigured()) {
    try {
      const verificationCode = np.generatePayoutVerificationCode();
      verifyRaw = await np.verifyPayout(withdrawalId, verificationCode);
      const verifiedStatus = String(verifyRaw?.status || npStatus).toLowerCase();
      status = verifiedStatus === 'finished' ? 'finished' : 'in_progress';
    } catch (verifyErr) {
      console.warn('Payout auto-verify failed', verifyErr.message);
      status = 'in_progress';
    }
  }

  return updateNowpaymentsPayout(payoutRow.id, {
    payout_id: withdrawalId,
    batch_payout_id: batchId,
    status,
    raw_last_ipn: verifyRaw ? { create: npResult, verify: verifyRaw } : npResult,
  });
}

module.exports = {
  createPayoutAwaitingApproval,
  submitPayoutToProvider,
};
