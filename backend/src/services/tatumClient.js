const TATUM_BASE = 'https://api.tatum.io';

const USDT_ETHEREUM_MAINNET = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

function getApiKey() {
  const key = process.env.TATUM_API_KEY;
  if (!key) throw new Error('TATUM_API_KEY is not configured');
  return key;
}

function getMasterMnemonic() {
  const m = process.env.TATUM_ETH_MASTER_MNEMONIC;
  if (!m) throw new Error('TATUM_ETH_MASTER_MNEMONIC is not configured');
  return m;
}

async function tatumFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${TATUM_BASE}${path}`, {
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
    const msg = data?.message || data?.errorCode || res.statusText || 'Tatum request failed';
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.tatum = data;
    throw err;
  }
  return data;
}

function createSubscriptionV4(body) {
  return tatumFetch('/v4/subscription', { method: 'POST', body });
}

function incomingNativeSubscription({ address, webhookUrl }) {
  return createSubscriptionV4({
    type: 'INCOMING_NATIVE_TX',
    templateId: 'enriched',
    attr: {
      chain: 'ethereum-mainnet',
      address,
      url: webhookUrl,
    },
  });
}

function incomingFungibleSubscription({ address, webhookUrl }) {
  return createSubscriptionV4({
    type: 'INCOMING_FUNGIBLE_TX',
    templateId: 'enriched',
    attr: {
      chain: 'ethereum-mainnet',
      address,
      url: webhookUrl,
    },
  });
}

module.exports = {
  USDT_ETHEREUM_MAINNET,
  getApiKey,
  getMasterMnemonic,
  tatumFetch,
  incomingNativeSubscription,
  incomingFungibleSubscription,
};
