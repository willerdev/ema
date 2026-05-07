const axios = require('axios');

const paperURL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const liveURL = process.env.ALPACA_LIVE_URL || 'https://api.alpaca.markets';
const marketURL = process.env.ALPACA_MARKET_URL || 'https://data.alpaca.markets';

function headers(apiKey, secretKey) {
  return {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': secretKey,
  };
}

function buildClient(baseURL, apiKey, secretKey) {
  const commonHeaders = headers(apiKey, secretKey);

  return {
    account: () => axios.get(`${baseURL}/v2/account`, { headers: commonHeaders }),
    positions: () => axios.get(`${baseURL}/v2/positions`, { headers: commonHeaders }),
    orders: () => axios.get(`${baseURL}/v2/orders?status=all&limit=50&direction=desc`, { headers: commonHeaders }),
    order: (payload) => axios.post(`${baseURL}/v2/orders`, payload, { headers: commonHeaders }),
    closePosition: (symbol) => axios.delete(`${baseURL}/v2/positions/${symbol}`, { headers: commonHeaders }),
    portfolioHistory: (period = '1M', timeframe = '1D') => axios.get(`${baseURL}/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}`, { headers: commonHeaders }),
    assets: (query, assetClass = 'us_equity') =>
      axios
        .get(`${baseURL}/v2/assets?status=active&asset_class=${assetClass}`, { headers: commonHeaders })
        .then((res) =>
          res.data
            .filter((asset) => asset.symbol.includes(query.toUpperCase()) || asset.name?.toUpperCase().includes(query.toUpperCase()))
            .slice(0, 12)
        ),
    stockQuote: (symbol) => axios.get(`${marketURL}/v2/stocks/quotes/latest?symbols=${symbol.toUpperCase()}`, { headers: commonHeaders }),
    stockBars: (symbolsCsv) => axios.get(`${marketURL}/v2/stocks/bars/latest?symbols=${symbolsCsv}`, { headers: commonHeaders }),
    cryptoQuote: (symbol) => axios.get(`${marketURL}/v1beta3/crypto/us/latest/quotes?symbols=${symbol}`, { headers: commonHeaders }),
    validateKeys: () => axios.get(`${baseURL}/v2/account`, { headers: commonHeaders }),
  };
}

function getClient(apiKey, secretKey) {
  return buildClient(paperURL, apiKey, secretKey);
}

async function getAuthorizedClient(apiKey, secretKey) {
  const candidates = [
    { environment: 'paper', baseURL: paperURL },
    { environment: 'live', baseURL: liveURL },
  ].filter((entry, idx, arr) => arr.findIndex((x) => x.baseURL === entry.baseURL) === idx);

  let lastError = null;
  for (const candidate of candidates) {
    const client = buildClient(candidate.baseURL, apiKey, secretKey);
    try {
      await client.account();
      return { client, environment: candidate.environment, baseURL: candidate.baseURL };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Alpaca authorization failed for both paper and live environments');
}

module.exports = { getClient, getAuthorizedClient };
