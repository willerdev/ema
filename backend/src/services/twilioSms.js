const axios = require('axios');

function smsEnabled() {
  const v = String(process.env.TWILIO_SMS_ENABLED || '0').trim();
  return v === '1' || v.toLowerCase() === 'true';
}

function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_FROM_NUMBER || process.env.PHONE_NUMBER)
  );
}

/**
 * Twilio requires E.164 on the wire (+256...).
 * App/storage format: international digits only, e.g. 256766532251 (no +, no leading 0).
 */
function toE164(phoneDigits) {
  const d = String(phoneDigits || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d;
  return `+${d}`;
}

async function sendSms(toPhoneDigits, body) {
  if (!smsEnabled() || !twilioConfigured()) {
    return { sent: false, skipped: true };
  }
  const normalized = String(toPhoneDigits || '').replace(/\D/g, '');
  const to = toE164(normalized);
  const from = process.env.TWILIO_FROM_NUMBER || process.env.PHONE_NUMBER;
  if (!to || !from) return { sent: false, skipped: true };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams();
  params.set('To', to);
  params.set('From', from);
  params.set('Body', String(body).slice(0, 1600));

  await axios.post(url, params.toString(), {
    auth: { username: sid, password: token },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
  });
  return { sent: true };
}

module.exports = { sendSms, smsEnabled, twilioConfigured, toE164 };
