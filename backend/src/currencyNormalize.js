const CURRENCY_ALIASES = {
  btc: 'btc',
  eth: 'eth',
  ethereum: 'eth',
  usdt: 'usdttrc20',
  usdttrc20: 'usdttrc20',
  'usdt-trc20': 'usdttrc20',
  tron: 'usdttrc20',
  usdterc20: 'usdterc20',
  'usdt-erc20': 'usdterc20',
  usdtmatic: 'usdtmatic',
  ltc: 'ltc',
  trx: 'trx',
};

function normalizeCurrency(code) {
  const key = String(code || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  return CURRENCY_ALIASES[key] || key;
}

module.exports = { normalizeCurrency, CURRENCY_ALIASES };
