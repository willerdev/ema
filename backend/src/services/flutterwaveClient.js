const crypto = require('crypto');
const axios = require('axios');

let cachedToken = null;
let tokenExpiresAt = 0;

function sandboxMode() {
  const v = String(process.env.FLUTTERWAVE_SANDBOX || '1').trim();
  return v === '1' || v.toLowerCase() === 'true';
}

function apiBaseUrl() {
  if (process.env.FLUTTERWAVE_V4_BASE_URL) {
    return process.env.FLUTTERWAVE_V4_BASE_URL.replace(/\/+$/, '');
  }
  return sandboxMode()
    ? 'https://developersandbox-api.flutterwave.com'
    : 'https://api.flutterwave.com';
}

function configured() {
  return Boolean(process.env.FLUTTERWAVE_CLIENT_ID && process.env.FLUTTERWAVE_CLIENT_SECRET);
}

async function getAccessToken() {
  if (!configured()) return null;
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) return cachedToken;

  const tokenUrl =
    process.env.FLUTTERWAVE_TOKEN_URL ||
    'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token';
  const params = new URLSearchParams();
  params.set('client_id', process.env.FLUTTERWAVE_CLIENT_ID);
  params.set('client_secret', process.env.FLUTTERWAVE_CLIENT_SECRET);
  params.set('grant_type', 'client_credentials');

  const { data } = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 25000,
  });
  cachedToken = data.access_token;
  const expiresIn = Number(data.expires_in) || 300;
  tokenExpiresAt = now + expiresIn * 1000;
  return cachedToken;
}

async function apiRequest(method, path, body, idempotencyKey) {
  const token = await getAccessToken();
  if (!token) return { mock: true, status: 'pending', reference: `mock_${crypto.randomUUID()}` };

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Trace-Id': crypto.randomUUID(),
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const { data } = await axios({
    method,
    url: `${apiBaseUrl()}${path}`,
    headers,
    data: body,
    timeout: 30000,
  });
  return data;
}

async function ensureCustomer({ email, phoneDigits, firstName, lastName }) {
  const idempotencyKey = crypto.randomUUID();
  const payload = {
    email: email || `user_${crypto.randomUUID().slice(0, 8)}@ema.app`,
    name: {
      first: firstName || 'Ema',
      last: lastName || 'User',
    },
    phone: {
      country_code: String(phoneDigits).slice(0, 3),
      number: String(phoneDigits).slice(3),
    },
  };
  const res = await apiRequest('POST', '/customers', payload, idempotencyKey);
  if (res.mock) return { customerId: `mock_cus_${crypto.randomUUID().slice(0, 8)}` };
  const customerId = res?.data?.id || res?.data?.customer?.id;
  if (!customerId) throw new Error('Payment provider did not return a customer id');
  return { customerId };
}

async function createMobileMoneyPaymentMethod({ phoneDigits, dialCode, network }) {
  const idempotencyKey = crypto.randomUUID();
  const localNumber = String(phoneDigits).startsWith(String(dialCode))
    ? String(phoneDigits).slice(String(dialCode).length)
    : phoneDigits;
  const payload = {
    type: 'mobile_money',
    mobile_money: {
      country_code: String(dialCode),
      network: network || 'MTN',
      phone_number: localNumber,
    },
  };
  const res = await apiRequest('POST', '/payment-methods', payload, idempotencyKey);
  if (res.mock) return { paymentMethodId: `mock_pmd_${crypto.randomUUID().slice(0, 8)}` };
  const paymentMethodId = res?.data?.id;
  if (!paymentMethodId) throw new Error('Payment provider did not return a payment method id');
  return { paymentMethodId, raw: res };
}

async function initiateMobileMoneyCharge({
  customerId,
  paymentMethodId,
  amount,
  currency,
  reference,
  email,
}) {
  const idempotencyKey = crypto.randomUUID();
  const payload = {
    reference: reference || crypto.randomUUID(),
    currency,
    customer_id: customerId,
    payment_method_id: paymentMethodId,
    amount: Number(amount),
    meta: { channel: 'ema_local_deposit' },
  };
  const res = await apiRequest('POST', '/charges', payload, idempotencyKey);
  if (res.mock) {
    return {
      chargeId: `mock_ch_${crypto.randomUUID().slice(0, 8)}`,
      status: 'pending',
      reference: payload.reference,
      raw: res,
    };
  }
  const chargeId = res?.data?.id;
  const status = res?.data?.status || 'pending';
  return { chargeId, status, reference: payload.reference, raw: res };
}

/**
 * Collect local fiat via mobile money (customer approves on device).
 */
async function collectMobileMoneyDeposit(opts) {
  const { email, phoneDigits, dialCode, network, amount, currency, firstName, lastName } = opts;
  const reference = crypto.randomUUID();
  const { customerId } = await ensureCustomer({ email, phoneDigits, firstName, lastName });
  const { paymentMethodId } = await createMobileMoneyPaymentMethod({
    phoneDigits,
    dialCode,
    network,
  });
  const charge = await initiateMobileMoneyCharge({
    customerId,
    paymentMethodId,
    amount,
    currency,
    reference,
    email,
  });
  return { reference, ...charge, customerId, paymentMethodId };
}

module.exports = {
  configured,
  collectMobileMoneyDeposit,
};
