function normalizeSymbol(symbol) {
  return String(symbol || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function priceRowFromPayload(item) {
  const symbol = normalizeSymbol(item?.symbol);
  if (!symbol) return null;
  const bid = Number(item.bid ?? item.Bid ?? item.price);
  const ask = Number(item.ask ?? item.Ask ?? bid);
  if (!Number.isFinite(bid)) return null;
  return {
    symbol,
    bid,
    ask: Number.isFinite(ask) ? ask : bid,
    dayOpen: item.dayOpen != null ? Number(item.dayOpen) : null,
    dayHigh: item.dayHigh != null ? Number(item.dayHigh) : null,
    dayLow: item.dayLow != null ? Number(item.dayLow) : null,
  };
}

function mapPricesForApi(rows) {
  return (rows || []).map((r) => ({
    symbol: r.symbol,
    bid: Number(r.bid),
    ask: Number(r.ask),
    updatedAt: r.updated_at,
    dayOpen: r.day_open != null ? Number(r.day_open) : null,
    dayHigh: r.day_high != null ? Number(r.day_high) : null,
    dayLow: r.day_low != null ? Number(r.day_low) : null,
  }));
}

module.exports = { normalizeSymbol, priceRowFromPayload, mapPricesForApi };
