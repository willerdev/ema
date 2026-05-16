const { getComplianceProfileByUserId, createAppNotification } = require('./db');
const { sendSms, smsEnabled, twilioConfigured } = require('./services/twilioSms');

const APP_LABEL = 'AirFarmerPro';

function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return n.toFixed(2);
}

async function smsToUser(userId, body) {
  try {
    const profile = await getComplianceProfileByUserId(userId);
    const phone = profile?.phone ? String(profile.phone).trim() : '';
    if (!phone) return false;
    if (!smsEnabled() || !twilioConfigured()) return false;
    const result = await sendSms(phone, `${APP_LABEL}: ${body}`);
    return Boolean(result?.sent);
  } catch (e) {
    console.warn('Peer transfer SMS failed', userId, e.message);
    return false;
  }
}

/**
 * Operational SMS + in-app notification for Send-by-ID (not premium-gated).
 */
async function notifyPeerTransfer({ senderUserId, recipientUserId, amount, recipientCode }) {
  if (!senderUserId || !recipientUserId) {
    return { sender: { notification: false, sms: false }, recipient: { notification: false, sms: false } };
  }

  const amountStr = formatAmount(amount);
  const codeLabel = recipientCode ? String(recipientCode).trim() : 'member';

  const senderBody = `You sent $${amountStr} to ${codeLabel}.`;
  const recipientBody = `You received $${amountStr} from a member transfer.`;

  let senderNotification = false;
  let recipientNotification = false;

  try {
    await createAppNotification({
      userId: senderUserId,
      title: 'Transfer sent',
      body: senderBody,
    });
    senderNotification = true;
  } catch (e) {
    console.warn('Sender in-app notification failed', e.message);
  }

  try {
    await createAppNotification({
      userId: recipientUserId,
      title: 'Transfer received',
      body: recipientBody,
    });
    recipientNotification = true;
  } catch (e) {
    console.warn('Recipient in-app notification failed', e.message);
  }

  const senderSms = await smsToUser(senderUserId, senderBody);
  const recipientSms = await smsToUser(recipientUserId, recipientBody);

  return {
    sender: { notification: senderNotification, sms: senderSms },
    recipient: { notification: recipientNotification, sms: recipientSms },
  };
}

module.exports = { notifyPeerTransfer };
