const { getComplianceProfileByUserId, createAppNotification } = require('./db');
const { sendSms } = require('./services/twilioSms');

const APP_LABEL = 'AirFarmerPro';

function formatAssetLabel(asset) {
  const a = String(asset || '').toLowerCase();
  if (a === 'usdttrc20' || a === 'usdt') return 'USDT';
  if (a === 'usdterc20') return 'USDT (ERC20)';
  return a.toUpperCase();
}

function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  const s = n.toFixed(8).replace(/\.?0+$/, '');
  return s || '0';
}

/**
 * SMS + in-app notification when a deposit is credited (crypto or mobile money).
 */
async function notifyDepositCredited({ userId, amount, asset, body: bodyOverride }) {
  if (!userId) return;

  const assetLabel = formatAssetLabel(asset);
  const amountStr = formatAmount(amount);
  const title = 'Deposit received';
  const body =
    bodyOverride ||
    `Your deposit of ${amountStr} ${assetLabel} has been credited to your wallet.`;

  try {
    await createAppNotification({ userId, title, body });
  } catch (e) {
    console.warn('Deposit in-app notification failed', e.message);
  }

  try {
    const profile = await getComplianceProfileByUserId(userId);
    const phone = profile?.phone ? String(profile.phone).trim() : '';
    if (phone) {
      await sendSms(phone, `${APP_LABEL}: ${body}`);
    }
  } catch (e) {
    console.warn('Deposit SMS failed', e.message);
  }
}

module.exports = { notifyDepositCredited, formatAssetLabel, formatAmount };
