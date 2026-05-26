const INTERNAL_PATTERNS = [
  'supabase',
  'metaapi',
  'nowpayments',
  'tatum',
  'render.com',
  'schema missing',
  'migration',
  'api base url',
  'server returned html',
  'backend route',
  'postgresql',
  'jwt_secret',
  'webhook',
  'provisioning',
  'authorization header',
  'bearer',
  'jwt',
  'jwttoken',
  'payout_description',
  'is not allowed',
];

export function sanitizeUserFacingError(raw: string, fallback = 'Something went wrong. Please try again.'): string {
  const text = String(raw || '').trim();
  if (!text) return fallback;
  const lower = text.toLowerCase();
  if (INTERNAL_PATTERNS.some((p) => lower.includes(p))) return fallback;
  if (text.length > 140) return fallback;
  if (lower.includes('network request failed') || lower.includes('failed to fetch')) {
    return 'Unable to reach Airfarms right now. Check your connection and try again.';
  }
  if (lower.includes('cannot delete') || lower.includes('cannot post')) {
    return 'This action is not available yet. Update the app or try again after the server has been updated.';
  }
  return text;
}

export function formatNetworkLabel(code: string): string {
  const c = String(code || '').toLowerCase();
  const map: Record<string, string> = {
    usdttrc20: 'USDT (TRC20)',
    btc: 'Bitcoin',
    eth: 'Ethereum',
    ltc: 'Litecoin',
    trx: 'TRON',
  };
  return map[c] || code.toUpperCase();
}
