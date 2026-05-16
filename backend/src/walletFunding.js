const crypto = require('crypto');
const {
  getCryptoBalancesByUserId,
  getWalletByUserId,
  ensureWalletForUser,
  setWalletBalance,
  insertCryptoLedgerEntry,
  getCryptoLedgerEntryBySource,
} = require('./db');
const { normalizeCurrency } = require('./currencyNormalize');
const { isUsdtFamilyAsset, totalUsdtFamilyAvailable } = require('./usdtBalances');

const GAS_RESERVE_PERCENT = 0.05;

const CASH_FUNDABLE_ASSETS = new Set(['usdt', 'usdttrc20', 'usdterc20', 'usdtmatic']);

function newId() {
  return crypto.randomUUID();
}

function isCashFundableAsset(asset) {
  const a = normalizeCurrency(asset);
  if (CASH_FUNDABLE_ASSETS.has(a)) return true;
  return a.includes('usdt');
}

function cryptoAvailableForAsset(balances, asset) {
  const normalized = normalizeCurrency(asset);
  if (isUsdtFamilyAsset(normalized) || isUsdtFamilyAsset(asset)) {
    return totalUsdtFamilyAvailable(balances);
  }
  const row = balances.find((b) => b.asset === normalized);
  return row ? Math.max(0, Number(row.available) || 0) : 0;
}

function maxWithdrawableAmount(combinedAvailable) {
  const n = Number(combinedAvailable);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.floor(n * (1 - GAS_RESERVE_PERCENT) * 1e6) / 1e6);
}

async function getCashWalletUsd(userId) {
  const wallet = await getWalletByUserId(userId);
  return Math.max(0, Number.parseFloat(String(wallet?.balance ?? 0)) || 0);
}

async function getCombinedWithdrawable(userId, asset) {
  const normalized = normalizeCurrency(asset);
  const balances = await getCryptoBalancesByUserId(userId);
  const cryptoAvailable = cryptoAvailableForAsset(balances, normalized);
  let cashWalletUsd = 0;
  if (isCashFundableAsset(normalized)) {
    cashWalletUsd = await getCashWalletUsd(userId);
  }
  const combinedAvailable = cryptoAvailable + cashWalletUsd;
  return {
    asset: normalized,
    cryptoAvailable,
    cashWalletUsd,
    combinedAvailable,
    maxWithdrawable: maxWithdrawableAmount(combinedAvailable),
    cashFundingEnabled: isCashFundableAsset(normalized),
  };
}

/**
 * Move USD cash wallet → crypto ledger (in) so NOWPayments payout can use combined balance.
 */
async function fundPayoutFromCashWallet({ userId, asset, amount, payoutId }) {
  const normalized = normalizeCurrency(asset);
  if (!isCashFundableAsset(normalized)) {
    return { cashFunded: 0 };
  }

  const balances = await getCryptoBalancesByUserId(userId);
  const cryptoAvailable = cryptoAvailableForAsset(balances, normalized);
  const need = Number(amount);
  if (!Number.isFinite(need) || need <= 0) return { cashFunded: 0 };

  const cashBalance = await getCashWalletUsd(userId);
  const fromCash = Math.max(0, Math.min(need - cryptoAvailable, cashBalance));
  if (fromCash <= 0) return { cashFunded: 0 };

  const wallet = await ensureWalletForUser(userId);
  const current = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
  if (current < fromCash) {
    const err = new Error('Insufficient cash wallet balance');
    err.status = 400;
    throw err;
  }

  const nextCash = Math.round((current - fromCash) * 100) / 100;
  await setWalletBalance(userId, nextCash);

  await insertCryptoLedgerEntry({
    id: newId(),
    user_id: userId,
    asset: normalized,
    direction: 'in',
    amount: fromCash,
    source: 'cash_wallet',
    source_id: payoutId,
  });

  return { cashFunded: fromCash };
}

/** Restore cash wallet when a payout funded from cash fails before completion. */
async function refundCashFundingForPayout(payoutRow) {
  const cashFunded = Number(payoutRow?.cash_funded_amount ?? payoutRow?.cashFundedAmount ?? 0);
  if (!cashFunded || cashFunded <= 0 || !payoutRow?.id || !payoutRow?.user_id) return;

  const userId = payoutRow.user_id;
  const asset = normalizeCurrency(payoutRow.currency);

  const existingIn = await getCryptoLedgerEntryBySource('cash_wallet', payoutRow.id, 'in');
  if (!existingIn) return;

  const existingRefund = await getCryptoLedgerEntryBySource('cash_wallet_refund', payoutRow.id, 'out');
  if (existingRefund) return;

  await insertCryptoLedgerEntry({
    id: newId(),
    user_id: userId,
    asset,
    direction: 'out',
    amount: cashFunded,
    source: 'cash_wallet_refund',
    source_id: payoutRow.id,
  });

  const wallet = await ensureWalletForUser(userId);
  const current = Number.parseFloat(String(wallet.balance ?? 0)) || 0;
  const nextCash = Math.round((current + cashFunded) * 100) / 100;
  await setWalletBalance(userId, nextCash);
}

module.exports = {
  GAS_RESERVE_PERCENT,
  isCashFundableAsset,
  getCashWalletUsd,
  getCombinedWithdrawable,
  maxWithdrawableAmount,
  fundPayoutFromCashWallet,
  refundCashFundingForPayout,
};
