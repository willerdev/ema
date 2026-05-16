const { normalizeCurrency } = require('./currencyNormalize');

const MIN_MOMO_USDT = 2;
const GAS_RESERVE = 0.05;

function isUsdtFamilyAsset(asset) {
  const a = String(asset || '').toLowerCase();
  return a === 'usdt' || a.includes('usdt');
}

function totalUsdtFamilyAvailable(balances) {
  let total = 0;
  for (const b of balances || []) {
    if (!isUsdtFamilyAsset(b.asset)) continue;
    total += Number(b.available ?? 0) || 0;
  }
  return total;
}

function maxWithdrawableUsdt(available) {
  if (!Number.isFinite(available) || available <= 0) return 0;
  return Math.max(0, available * (1 - GAS_RESERVE));
}

function minFiatForMomo(regionDef) {
  const rate = Number(regionDef?.usdtToFiatRate);
  if (!Number.isFinite(rate) || rate <= 0) return 100;
  return Math.ceil(MIN_MOMO_USDT * rate);
}

/** Debit USDT-family balance across ledger assets (largest available first). */
async function debitUsdtFamily({ userId, amount, source, sourceId, insertCryptoLedgerEntry, getCryptoBalancesByUserId, newId }) {
  const need = Number(amount);
  if (!Number.isFinite(need) || need <= 0) {
    const err = new Error('Invalid amount');
    err.status = 400;
    throw err;
  }

  const balances = await getCryptoBalancesByUserId(userId);
  const rows = (balances || [])
    .filter((b) => isUsdtFamilyAsset(b.asset) && Number(b.available) > 0)
    .sort((a, b) => Number(b.available) - Number(a.available));

  let remaining = need;
  for (const row of rows) {
    if (remaining <= 1e-9) break;
    const avail = Number(row.available) || 0;
    if (avail <= 0) continue;
    const take = Math.min(remaining, avail);
    await insertCryptoLedgerEntry({
      id: newId(),
      user_id: userId,
      asset: row.asset,
      direction: 'out',
      amount: take,
      source,
      source_id: sourceId,
    });
    remaining -= take;
  }

  if (remaining > 1e-9) {
    const err = new Error(
      `Insufficient balance. Maximum withdrawable (after fee reserve): ${Math.floor(maxWithdrawableUsdt(totalUsdtFamilyAvailable(balances)))} USDT.`
    );
    err.status = 400;
    throw err;
  }
}

function canonicalUsdtAsset() {
  return normalizeCurrency('usdt');
}

module.exports = {
  MIN_MOMO_USDT,
  isUsdtFamilyAsset,
  totalUsdtFamilyAvailable,
  maxWithdrawableUsdt,
  minFiatForMomo,
  debitUsdtFamily,
  canonicalUsdtAsset,
};
