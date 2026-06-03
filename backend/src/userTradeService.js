const {
  insertUserRecordedTrade,
  listUserRecordedTradesForUser,
  userRecordedTradeToApi,
} = require('./db');

function roundUsd(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function listTradeHistory(userId, limit = 50) {
  const rows = await listUserRecordedTradesForUser(userId, limit);
  return { trades: rows.map(userRecordedTradeToApi).filter(Boolean) };
}

async function adminCreateTradeForUser(userId, payload, adminUsername) {
  const symbol = String(payload?.symbol || '').trim();
  if (!symbol) {
    const err = new Error('Symbol is required');
    err.statusCode = 400;
    throw err;
  }
  const side = String(payload?.side || '').toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    const err = new Error('Side must be buy or sell');
    err.statusCode = 400;
    throw err;
  }
  const profitUsd = roundUsd(payload?.profitUsd);
  if (!Number.isFinite(profitUsd)) {
    const err = new Error('Profit USD is required');
    err.statusCode = 400;
    throw err;
  }
  const volume = Number(payload?.volume);
  if (!Number.isFinite(volume) || volume <= 0) {
    const err = new Error('Volume must be greater than 0');
    err.statusCode = 400;
    throw err;
  }

  let tradedAt = payload?.tradedAt ? new Date(payload.tradedAt).toISOString() : new Date().toISOString();
  if (!Number.isFinite(Date.parse(tradedAt))) tradedAt = new Date().toISOString();

  const row = await insertUserRecordedTrade({
    userId,
    symbol,
    side,
    volume,
    openPrice: payload?.openPrice,
    closePrice: payload?.closePrice,
    profitUsd,
    tradedAt,
    notes: payload?.notes,
    createdBy: adminUsername || 'admin',
  });

  return { trade: userRecordedTradeToApi(row) };
}

module.exports = { listTradeHistory, adminCreateTradeForUser };
