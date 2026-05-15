const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROVISIONING_API_URL = process.env.MT5_METAAPI_PROVISIONING_URL || 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const DEFAULT_CLIENT_API_CANDIDATES = [
  'https://mt-client-api-v1.new-york.agiliumtrade.ai',
  'https://mt-client-api-v1.london.agiliumtrade.ai',
  'https://mt-client-api-v1.singapore.agiliumtrade.ai',
];

function getClientApiCandidates() {
  const configured = process.env.MT5_METAAPI_CLIENT_URLS || process.env.MT5_METAAPI_CLIENT_URL;
  if (!configured) return DEFAULT_CLIENT_API_CANDIDATES;
  return String(configured)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

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
      timeout: 45000,
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
  const candidates = getClientApiCandidates();
  let lastError = null;

  for (const baseUrl of candidates) {
    try {
      const response = await axios.get(
        `${baseUrl.replace(/\/+$/, '')}/users/current/accounts/${accountId}/account-information`,
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
        clientApiUrl: baseUrl,
      };
    } catch (error) {
      lastError = error;
      const msg = extractErrorMessage(error, '').toLowerCase();
      const notFound = error?.response?.status === 404 || msg.includes('account id') && msg.includes('not found');
      if (notFound) continue;
      throw error;
    }
  }

  throw lastError || new Error('Unable to fetch account information from MetaApi regional endpoints');
}

async function fetchMt5OpenPositions({ accountId }) {
  const token = getMetaApiToken();
  const candidates = getClientApiCandidates();
  let lastError = null;
  for (const baseUrl of candidates) {
    try {
      const response = await axios.get(
        `${baseUrl.replace(/\/+$/, '')}/users/current/accounts/${accountId}/positions`,
        {
          timeout: 15000,
          headers: {
            Accept: 'application/json',
            'auth-token': token,
          },
        }
      );
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      lastError = error;
      const message = extractErrorMessage(error, '').toLowerCase();
      const status = error?.response?.status;
      const accountNotFound = status === 404 || (message.includes('account id') && message.includes('not found'));
      // If provider reports no positions (or no terminal state), treat as empty list.
      if (message.includes('no position') || message.includes('positions not found') || message.includes('not synchronized')) {
        return [];
      }
      if (accountNotFound) continue;
      throw error;
    }
  }
  throw lastError || new Error('Unable to fetch positions from MetaApi regional endpoints');
}

/**
 * Place a market order via MetaApi trade RPC (same regional client API as balance).
 * @param {{ accountId: string, symbol: string, volume: number, side: 'buy'|'sell', stopLoss?: number|null, takeProfit?: number|null }} params
 */
async function placeMetaApiTrade({ accountId, symbol, volume, side, stopLoss, takeProfit }) {
  const token = getMetaApiToken();
  const actionType =
    String(side || '').toLowerCase() === 'sell' ? 'ORDER_TYPE_SELL' : 'ORDER_TYPE_BUY';
  const payload = {
    actionType,
    symbol: String(symbol || '').trim().toUpperCase(),
    volume: Number(volume),
  };
  if (stopLoss != null && stopLoss !== '' && Number.isFinite(Number(stopLoss))) {
    payload.stopLoss = Number(stopLoss);
  }
  if (takeProfit != null && takeProfit !== '' && Number.isFinite(Number(takeProfit))) {
    payload.takeProfit = Number(takeProfit);
  }

  const candidates = getClientApiCandidates();
  let lastError = null;
  for (const baseUrl of candidates) {
    try {
      const response = await axios.post(
        `${baseUrl.replace(/\/+$/, '')}/users/current/accounts/${accountId}/trade`,
        payload,
        {
          timeout: 45000,
          headers: {
            'Content-Type': 'application/json',
            'auth-token': token,
            'transaction-id': txId(),
          },
        }
      );
      return response.data || {};
    } catch (error) {
      lastError = error;
      const message = extractErrorMessage(error, '').toLowerCase();
      const status = error?.response?.status;
      const accountNotFound = status === 404 || (message.includes('account id') && message.includes('not found'));
      if (accountNotFound) continue;
      throw error;
    }
  }
  throw lastError || new Error('Unable to place trade via MetaApi regional endpoints');
}

async function metaApiRequestAcrossRegions({ method, path, data, timeout = 45000 }) {
  const token = getMetaApiToken();
  const candidates = getClientApiCandidates();
  let lastError = null;
  for (const baseUrl of candidates) {
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
      const config = {
        method,
        url,
        timeout,
        headers: {
          Accept: 'application/json',
          'auth-token': token,
          ...(method !== 'get' ? { 'Content-Type': 'application/json', 'transaction-id': txId() } : {}),
        },
        ...(data !== undefined ? { data } : {}),
      };
      const response = await axios(config);
      return response.data;
    } catch (error) {
      lastError = error;
      const message = extractErrorMessage(error, '').toLowerCase();
      const status = error?.response?.status;
      const accountNotFound = status === 404 || (message.includes('account id') && message.includes('not found'));
      if (accountNotFound) continue;
      throw error;
    }
  }
  throw lastError || new Error('MetaApi request failed on all regional endpoints');
}

/**
 * Close an open position by id (MetaApi POSITION_CLOSE_ID).
 */
async function closeMt5Position({ accountId, positionId }) {
  return metaApiRequestAcrossRegions({
    method: 'post',
    path: `/users/current/accounts/${accountId}/trade`,
    data: {
      actionType: 'POSITION_CLOSE_ID',
      positionId: String(positionId),
    },
  });
}

/**
 * Closed deals / history for the last N days (default 30).
 */
async function fetchMt5HistoryDeals({ accountId, days = 30, limit = 200, offset = 0 }) {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000);
  const startIso = encodeURIComponent(start.toISOString());
  const endIso = encodeURIComponent(end.toISOString());
  const lim = Math.min(1000, Math.max(1, Number(limit) || 200));
  const off = Math.max(0, Number(offset) || 0);
  const path = `/users/current/accounts/${accountId}/history-deals/time/${startIso}/${endIso}?limit=${lim}&offset=${off}`;
  const data = await metaApiRequestAcrossRegions({ method: 'get', path, timeout: 30000 });
  return Array.isArray(data) ? data : [];
}

function normalizeMt5Position(p) {
  const raw = p || {};
  const type = String(raw.type || '');
  const side =
    type.includes('BUY') || type === 'buy' || type === '0' ? 'buy' : type.includes('SELL') || type === 'sell' || type === '1' ? 'sell' : type;
  return {
    id: String(raw.id ?? raw.positionId ?? ''),
    symbol: String(raw.symbol || ''),
    type: side || type,
    volume: Number(raw.volume ?? 0),
    openPrice: Number(raw.openPrice ?? 0),
    currentPrice: Number(raw.currentPrice ?? 0),
    profit: Number(raw.profit ?? raw.unrealizedProfit ?? 0),
    swap: Number(raw.swap ?? 0),
    commission: Number(raw.commission ?? 0),
    time: raw.time || raw.brokerTime || raw.updateTime || null,
  };
}

function normalizeMt5Deal(d) {
  const raw = d || {};
  return {
    id: String(raw.id ?? raw.ticket ?? ''),
    symbol: String(raw.symbol || ''),
    type: String(raw.type || raw.entryType || ''),
    volume: Number(raw.volume ?? 0),
    price: Number(raw.price ?? 0),
    profit: Number(raw.profit ?? 0),
    commission: Number(raw.commission ?? 0),
    swap: Number(raw.swap ?? 0),
    time: raw.time || raw.brokerTime || null,
    positionId: raw.positionId != null ? String(raw.positionId) : null,
  };
}

module.exports = {
  ensureMetaApiAccount,
  fetchMt5Balance,
  fetchMt5OpenPositions,
  placeMetaApiTrade,
  closeMt5Position,
  fetchMt5HistoryDeals,
  normalizeMt5Position,
  normalizeMt5Deal,
  extractErrorMessage,
};
