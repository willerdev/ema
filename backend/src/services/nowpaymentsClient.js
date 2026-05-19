const { generateSync } = require('otplib');

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
    const extracted = extractNpErrorMessage(data);
    const msg = extracted || res.statusText || 'Payment provider request failed';
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

/** NOWPayments allows max 6 decimal places on payout amounts. */
function roundPayoutAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n * 1e6) / 1e6;
}

/** Short alphanumeric external id (no payout_description or other extra fields). */
function shortExternalId(seed) {
  const compact = String(seed || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 32);
  return compact || String(Date.now()).slice(-12);
}

/**
 * Minimal payout body per NOWPayments docs — never send payout_description.
 * Root keys allowed: ipn_callback_url, withdrawals[] with address, currency, amount, unique_external_id.
 */
function buildCreatePayoutBody({ withdrawals, ipnCallbackUrl }) {
  const rows = (withdrawals || []).map((w) => {
    const amount = roundPayoutAmount(w.amount);
    if (!amount) throw new Error('Invalid payout amount');
    const item = {
      address: String(w.address || '').trim(),
      currency: String(w.currency || '')
        .trim()
        .toLowerCase(),
      amount,
    };
    if (w.uniqueExternalId) {
      item.unique_external_id = shortExternalId(w.uniqueExternalId);
    }
    return item;
  });
  if (!rows.length) throw new Error('At least one withdrawal is required');
  const body = { withdrawals: rows };
  if (ipnCallbackUrl) body.ipn_callback_url = String(ipnCallbackUrl).trim();
  return body;
}

function extractNpErrorMessage(data) {
  if (!data) return null;
  if (typeof data.message === 'string') return data.message;
  if (Array.isArray(data.message)) return data.message.map(String).join('; ');
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error.message === 'string') return data.error.message;
  if (Array.isArray(data.validation_errors) && data.validation_errors.length) {
    return data.validation_errors.map((e) => e.message || e.field || String(e)).join('; ');
  }
  return null;
}

function createPayout({ withdrawals, ipnCallbackUrl }) {
  const body = buildCreatePayoutBody({ withdrawals, ipnCallbackUrl });
  return npFetch('/payout', { method: 'POST', body, usePayoutJwt: true });
}

function getPayout(payoutId) {
  return npFetch(`/payout/${payoutId}`, { usePayoutJwt: true });
}

/** Per-withdrawal id (for POST /payout/:id/verify) and optional batch id from create response. */
function extractPayoutIds(npResult) {
  if (!npResult || typeof npResult !== 'object') {
    return { withdrawalId: null, batchId: null };
  }
  const batchId =
    npResult.payout_id != null
      ? String(npResult.payout_id)
      : npResult.id != null
        ? String(npResult.id)
        : null;
  const withdrawals = Array.isArray(npResult.withdrawals) ? npResult.withdrawals : [];
  let withdrawalId = null;
  for (const w of withdrawals) {
    if (w?.id != null) {
      withdrawalId = String(w.id);
      break;
    }
  }
  if (!withdrawalId && withdrawals[0]?.batch_withdrawal_id != null) {
    withdrawalId = String(withdrawals[0].batch_withdrawal_id);
  }
  return { withdrawalId: withdrawalId || batchId, batchId };
}

function payoutVerifyConfigured() {
  return Boolean(
    process.env.NOWPAYMENTS_2FA_SECRET?.trim() || process.env.NOWPAYMENTS_PAYOUT_VERIFY_CODE?.trim()
  );
}

function generatePayoutVerificationCode() {
  const override = process.env.NOWPAYMENTS_PAYOUT_VERIFY_CODE?.trim();
  if (override) return override.replace(/\s/g, '');
  const secret = process.env.NOWPAYMENTS_2FA_SECRET?.trim();
  if (!secret) {
    const err = new Error('NOWPAYMENTS_2FA_SECRET is not configured');
    err.code = 'PAYOUT_VERIFY_NOT_CONFIGURED';
    throw err;
  }
  return generateSync({ secret });
}

function verifyPayout(withdrawalId, verificationCode) {
  const id = String(withdrawalId || '').trim();
  const code = String(verificationCode || '').replace(/\s/g, '');
  if (!id) throw new Error('Payout withdrawal id is required');
  if (!code) throw new Error('verification_code is required');
  return npFetch(`/payout/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
    body: { verification_code: code },
    usePayoutJwt: true,
  });
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
  if (code === 'PAYOUT_VERIFY_NOT_CONFIGURED' || code === 'PAYOUT_VERIFY_FAILED') {
    return 'Withdrawal is in progress. You will be notified when it completes.';
  }
  if (msg.includes('payout_description') || msg.includes('is not allowed')) {
    return 'Withdrawal was rejected by the payment provider. Please try again in a few minutes.';
  }
  if (msg.includes('verif')) {
    return 'Withdrawal is in progress. You will be notified when it completes.';
  }
  if (msg.includes('insufficient') || msg.includes('balance')) {
    return error.message;
  }
  if (msg.includes('invalid') || msg.includes('validation')) {
    if (error?.message && error.message.length < 120 && !msg.includes('nowpayment')) {
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
  buildCreatePayoutBody,
  getPayout,
  extractPayoutIds,
  payoutVerifyConfigured,
  generatePayoutVerificationCode,
  verifyPayout,
  toPublicPayoutError,
};
