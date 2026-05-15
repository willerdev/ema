const DEFAULT_BASE = 'https://api.nowpayments.io/v1';

/** Short-lived payout JWT (NOWPayments /auth, ~5 min). */
let payoutJwtCache = { token: null, expiresAt: 0 };

function getApiKey() {
  const key = process.env.NOWPAYMENTS_API_KEY;
  if (!key) throw new Error('NOWPAYMENTS_API_KEY is not configured');
  return key;
}

function getBaseUrl() {
  return (process.env.NOWPAYMENTS_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
}

function configured() {
  try {
    getApiKey();
    return true;
  } catch {
    return false;
  }
}

function payoutAuthConfigured() {
  return Boolean(process.env.NOWPAYMENTS_EMAIL && process.env.NOWPAYMENTS_PASSWORD);
}

async function fetchPayoutJwt() {
  const email = process.env.NOWPAYMENTS_EMAIL;
  const password = process.env.NOWPAYMENTS_PASSWORD;
  if (!email || !password) {
    const err = new Error('PAYOUT_AUTH_NOT_CONFIGURED');
    err.code = 'PAYOUT_AUTH_NOT_CONFIGURED';
    throw err;
  }

  const now = Date.now();
  if (payoutJwtCache.token && payoutJwtCache.expiresAt > now + 30_000) {
    return payoutJwtCache.token;
  }

  const res = await fetch(`${getBaseUrl()}/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
    },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || 'Payout authentication failed';
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.code = 'PAYOUT_AUTH_FAILED';
    throw err;
  }

  const token = data?.token;
  if (!token) {
    const err = new Error('Payout authentication returned no token');
    err.code = 'PAYOUT_AUTH_FAILED';
    throw err;
  }

  payoutJwtCache = { token, expiresAt: now + 4 * 60 * 1000 };
  return token;
}

async function npFetch(path, { method = 'GET', body, usePayoutJwt = false } = {}) {
  const headers = {
    'x-api-key': getApiKey(),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
  if (usePayoutJwt) {
    headers.Authorization = `Bearer ${await fetchPayoutJwt()}`;
  }

  const res = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || 'Payment provider request failed';
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.nowpayments = data;
    throw err;
  }
  return data;
}

function getStatus() {
  return npFetch('/status');
}

function getCurrencies() {
  return npFetch('/currencies');
}

function createPayment(params) {
  return npFetch('/payment', { method: 'POST', body: params });
}

function getPayment(paymentId) {
  return npFetch(`/payment/${paymentId}`);
}

function createPayout(params) {
  return npFetch('/payout', { method: 'POST', body: params, usePayoutJwt: true });
}

function getPayout(payoutId) {
  return npFetch(`/payout/${payoutId}`, { usePayoutJwt: true });
}

/** User-safe message for mobile (no JWT / provider internals). */
function toPublicPayoutError(error) {
  const code = error?.code;
  if (code === 'PAYOUT_AUTH_NOT_CONFIGURED') {
    return 'Withdrawals are not fully enabled yet. Please try again later or contact support.';
  }
  if (code === 'PAYOUT_AUTH_FAILED') {
    return 'Withdrawal service could not be authenticated. Please try again later.';
  }
  const msg = String(error?.message || '').toLowerCase();
  if (msg.includes('authorization header') || msg.includes('bearer') || msg.includes('jwt')) {
    return 'Withdrawals are temporarily unavailable. Please try again later.';
  }
  if (msg.includes('insufficient') || msg.includes('balance')) {
    return error.message;
  }
  if (
    msg.includes('payout') ||
    msg.includes('withdrawal') ||
    msg.includes('invalid') ||
    msg.includes('validation')
  ) {
    if (error?.message && error.message.length < 160 && !msg.includes('nowpayment')) {
      return error.message;
    }
  }
  const npMsg = error?.nowpayments?.message || error?.nowpayments?.error;
  if (typeof npMsg === 'string' && npMsg.length < 160 && !npMsg.toLowerCase().includes('nowpayment')) {
    return npMsg;
  }
  if (error?.message && error.message.length < 120 && !msg.includes('nowpayment')) {
    return error.message;
  }
  return 'Withdrawal could not be completed. Please try again later.';
}

module.exports = {
  configured,
  payoutAuthConfigured,
  getApiKey,
  getBaseUrl,
  getStatus,
  getCurrencies,
  createPayment,
  getPayment,
  createPayout,
  getPayout,
  toPublicPayoutError,
};
