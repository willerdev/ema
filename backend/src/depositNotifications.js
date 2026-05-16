const {
  getComplianceProfileByUserId,
  createAppNotification,
  getNotificationPreferencesByUserId,
  getUserById,
} = require('./db');
const { sendSms, smsEnabled, twilioConfigured } = require('./services/twilioSms');
const { sendEmail } = require('./services/emailNotify');

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

async function loadPremiumChannels(userId) {
  try {
    const prefs = await getNotificationPreferencesByUserId(userId);
    if (!prefs?.premium_alerts_enabled) {
      return { premium: false, sms: false, email: false };
    }
    return {
      premium: true,
      sms: Boolean(prefs.notify_sms),
      email: Boolean(prefs.notify_email),
    };
  } catch {
    return { premium: false, sms: false, email: false };
  }
}

/**
 * In-app alert for all users; SMS/email only when premium channels are enabled ($2/week).
 */
async function deliverUserAlert({ userId, title, body }) {
  if (!userId) return { notification: false, sms: false, email: false };

  let notification = false;
  let sms = false;
  let email = false;

  try {
    await createAppNotification({ userId, title, body });
    notification = true;
  } catch (e) {
    console.warn('In-app notification failed', e.message);
  }

  const channels = await loadPremiumChannels(userId);
  if (!channels.premium) {
    return { notification, sms, email };
  }

  if (channels.sms) {
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
  }

  if (channels.email) {
    try {
      const user = await getUserById(userId);
      const to = user?.email ? String(user.email).trim() : '';
      if (!to) {
        console.warn('Email skipped: no user email', { userId });
      } else {
        const result = await sendEmail({ to, subject: `${APP_LABEL}: ${title}`, text: body });
        email = Boolean(result?.sent);
      }
    } catch (e) {
      console.warn('Email delivery failed', e.message);
    }
  }

  return { notification, sms, email };
}

async function notifyDepositCredited({ userId, amount, asset, body: bodyOverride }) {
  const assetLabel = formatAssetLabel(asset);
  const amountStr = formatAmount(amount);
  const title = 'Deposit received';
  const body =
    bodyOverride ||
    `Your deposit of ${amountStr} ${assetLabel} has been credited to your wallet.`;
  return deliverUserAlert({ userId, title, body });
}

async function notifyWithdrawalOutcome({ userId, amount, asset, status }) {
  const st = String(status || '').toLowerCase();
  const assetLabel = formatAssetLabel(asset);
  const amountStr = formatAmount(amount);
  const failed = FAILED_PAYOUT_STATUSES.includes(st);

  if (st !== 'finished' && !failed) return { notification: false, sms: false, email: false };

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
