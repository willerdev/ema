const DEFAULT_BASE = 'https://api.nowpayments.io/v1';

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

async function npFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      'x-api-key': getApiKey(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
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
    const msg = data?.message || data?.error || res.statusText || 'NOWPayments request failed';
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
  return npFetch('/payout', { method: 'POST', body: params });
}

function getPayout(payoutId) {
  return npFetch(`/payout/${payoutId}`);
}

module.exports = {
  configured,
  getApiKey,
  getBaseUrl,
  getStatus,
  getCurrencies,
  createPayment,
  getPayment,
  createPayout,
  getPayout,
};
