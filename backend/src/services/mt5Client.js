const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROVISIONING_API_URL = process.env.MT5_METAAPI_PROVISIONING_URL || 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const CLIENT_API_URL = process.env.MT5_METAAPI_CLIENT_URL || 'https://mt-client-api-v1.new-york.agiliumtrade.ai';

function getMetaApiToken() {
  if (process.env.MT5_METAAPI_TOKEN) return process.env.MT5_METAAPI_TOKEN;
  const tokenFile = process.env.MT5_METAAPI_TOKEN_FILE || path.resolve(__dirname, '../../sql/metaapi.txt');
  if (fs.existsSync(tokenFile)) {
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    if (token) return token;
  }
  throw new Error('MT5_METAAPI_TOKEN is not configured');
}

function txId() {
  return crypto.randomUUID().replace(/-/g, '');
}

function extractErrorMessage(error, fallback) {
  return error?.response?.data?.message || error?.response?.data?.error || error?.message || fallback;
}

async function createMetaApiAccount({ login, password, server, accountName }) {
  const token = getMetaApiToken();
  const payload = {
    login: String(login),
    password: String(password),
    name: String(accountName || `MT5-${login}`),
    server: String(server),
    platform: 'mt5',
    magic: 1000,
    reliability: 'high',
    type: 'cloud-g2',
  };

  const response = await axios.post(
    `${PROVISIONING_API_URL.replace(/\/+$/, '')}/users/current/accounts`,
    payload,
    {
      timeout: 25000,
      headers: {
        'Content-Type': 'application/json',
        'auth-token': token,
        'transaction-id': txId(),
      },
    }
  );

  if (!response.data?.id) {
    throw new Error('MetaApi account creation returned no account id');
  }
  return { accountId: response.data.id };
}

async function ensureMetaApiAccount({ metaapiAccountId, login, password, server, accountName }) {
  if (metaapiAccountId) {
    return { accountId: metaapiAccountId };
  }
  return createMetaApiAccount({ login, password, server, accountName });
}

async function fetchMt5Balance({ accountId }) {
  const token = getMetaApiToken();
  const response = await axios.get(
    `${CLIENT_API_URL.replace(/\/+$/, '')}/users/current/accounts/${accountId}/account-information`,
    {
      timeout: 15000,
      headers: {
        Accept: 'application/json',
        'auth-token': token,
      },
    }
  );

  const payload = response.data || {};
  return {
    balance: Number(payload.balance ?? 0),
    equity: Number(payload.equity ?? payload.balance ?? 0),
    currency: String(payload.currency || 'USD'),
    name: String(payload.name || ''),
    login: String(payload.login || ''),
    server: String(payload.server || ''),
  };
}

module.exports = { ensureMetaApiAccount, fetchMt5Balance, extractErrorMessage };
