const { getComplianceProfileByUserId, createAppNotification } = require('./db');
const { sendSms, smsEnabled, twilioConfigured } = require('./services/twilioSms');

const APP_LABEL = 'AirFarmerPro';

const FAILED_PAYOUT_STATUSES = ['failed', 'rejected', 'expired', 'refunded'];

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

async function deliverUserAlert({ userId, title, body }) {
  if (!userId) return { notification: false, sms: false };

  let notification = false;
  let sms = false;

  try {
    await createAppNotification({ userId, title, body });
    notification = true;
  } catch (e) {
    console.warn('In-app notification failed', e.message);
  }

  try {
    const profile = await getComplianceProfileByUserId(userId);
    const phone = profile?.phone ? String(profile.phone).trim() : '';
    if (!phone) {
      console.warn('SMS skipped: no phone on compliance profile', { userId });
    } else if (!smsEnabled() || !twilioConfigured()) {
      console.warn('SMS skipped: Twilio not enabled or not configured');
    } else {
      const result = await sendSms(phone, `${APP_LABEL}: ${body}`);
      sms = Boolean(result?.sent);
    }
  } catch (e) {
    console.warn('SMS delivery failed', e.message);
  }

  return { notification, sms };
}

/**
 * SMS + in-app notification when a deposit is credited (crypto or mobile money).
 */
async function notifyDepositCredited({ userId, amount, asset, body: bodyOverride }) {
  const assetLabel = formatAssetLabel(asset);
  const amountStr = formatAmount(amount);
  const title = 'Deposit received';
  const body =
    bodyOverride ||
    `Your deposit of ${amountStr} ${assetLabel} has been credited to your wallet.`;
  return deliverUserAlert({ userId, title, body });
}

/**
 * SMS + in-app notification when a withdrawal reaches a terminal state (IPN listener).
 */
async function notifyWithdrawalOutcome({ userId, amount, asset, status }) {
  const st = String(status || '').toLowerCase();
  const assetLabel = formatAssetLabel(asset);
  const amountStr = formatAmount(amount);
  const failed = FAILED_PAYOUT_STATUSES.includes(st);

  if (st !== 'finished' && !failed) return { notification: false, sms: false };

  const title = failed ? 'Withdrawal failed' : 'Withdrawal completed';
  const body = failed
    ? `Your withdrawal of ${amountStr} ${assetLabel} could not be completed. Funds remain in your wallet.`
    : `Your withdrawal of ${amountStr} ${assetLabel} was processed successfully.`;

  return deliverUserAlert({ userId, title, body });
}

function payoutOutcomeAlreadyNotified(row) {
  const raw = row?.raw_last_ipn;
  if (!raw || typeof raw !== 'object') return false;
  return Boolean(raw.outcome_notified);
}

module.exports = {
  notifyDepositCredited,
  notifyWithdrawalOutcome,
  payoutOutcomeAlreadyNotified,
  formatAssetLabel,
  formatAmount,
  deliverUserAlert,
};
