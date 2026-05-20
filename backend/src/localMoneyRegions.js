/** Supported local-money regions (P2P / mobile deposit & withdraw). */
const REGIONS = {
  RW: {
    countryCode: 'RW',
    countryName: 'Rwanda',
    fiatCurrency: 'RWF',
    fiatLabel: 'FRw',
    dialCode: '250',
    /** Internal Flutterwave mobile-money network code — not shown in app UI. */
    mobileNetwork: process.env.FLUTTERWAVE_MM_NETWORK_RW || 'MTN',
    usdtToFiatRate: Number(process.env.LOCAL_MONEY_USDT_RATE_RW || 1450),
  },
  UG: {
    countryCode: 'UG',
    countryName: 'Uganda',
    fiatCurrency: 'UGX',
    fiatLabel: 'UGX',
    dialCode: '256',
    mobileNetwork: process.env.FLUTTERWAVE_MM_NETWORK_UG || 'MTN',
    usdtToFiatRate: Number(process.env.LOCAL_MONEY_USDT_RATE_UG || 3800),
  },
};

const SUPPORTED = new Set(Object.keys(REGIONS));

function getRegion(countryCode) {
  const code = String(countryCode || '')
    .trim()
    .toUpperCase();
  if (!SUPPORTED.has(code)) return null;
  const r = REGIONS[code];
  return {
    countryCode: r.countryCode,
    countryName: r.countryName,
    fiatCurrency: r.fiatCurrency,
    fiatLabel: r.fiatLabel,
    dialCode: r.dialCode,
    usdtToFiatRate: r.usdtToFiatRate,
  };
}

function fiatFromUsdt(usdtAmount, region) {
  const n = Number(usdtAmount);
  const rate = Number(region?.usdtToFiatRate);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(n * rate * 100) / 100;
}

function usdtFromFiat(fiatAmount, region) {
  const n = Number(fiatAmount);
  const rate = Number(region?.usdtToFiatRate);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((n / rate) * 1e8) / 1e8;
}

/** Normalize to digits with country dial code (no +). */
function normalizePhone(phone, dialCode) {
  let digits = String(phone || '').replace(/\D/g, '');
  const dc = String(dialCode || '').replace(/\D/g, '');
  if (!digits) return null;
  if (dc && digits.startsWith('0')) digits = dc + digits.slice(1);
  if (dc && !digits.startsWith(dc) && digits.length <= 10) digits = dc + digits;
  if (digits.length < 9) return null;
  return digits;
}

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 4) return '****';
  return `***${d.slice(-4)}`;
}

function listPublicRegions() {
  return Object.values(REGIONS).map((r) => ({
    countryCode: r.countryCode,
    countryName: r.countryName,
    dialCode: r.dialCode,
    fiatCurrency: r.fiatCurrency,
    fiatLabel: r.fiatLabel,
    usdtToFiatRate: r.usdtToFiatRate,
  }));
}

module.exports = {
  REGIONS,
  SUPPORTED,
  getRegion,
  fiatFromUsdt,
  usdtFromFiat,
  normalizePhone,
  maskPhone,
  listPublicRegions,
};
