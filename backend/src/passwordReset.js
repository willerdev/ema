const bcrypt = require('bcryptjs');
const {
  getUserByEmail,
  getComplianceProfileByUserId,
  updateUserPasswordHash,
} = require('./db');
const { getRegion, normalizePhone, listPublicRegions, REGIONS } = require('./localMoneyRegions');

const SUPPORTED_COUNTRY_CODES = new Set(['UG', 'RW']);

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** Resolve mobile to international digits only, e.g. 256766532251 (no +, no leading 0). */
function resolveAccountPhone(countryCode, phoneRaw) {
  const code = String(countryCode || '')
    .trim()
    .toUpperCase();
  if (!SUPPORTED_COUNTRY_CODES.has(code)) {
    return { ok: false, status: 400, message: 'Select Uganda or Rwanda' };
  }
  const region = getRegion(code);
  if (!region) {
    return { ok: false, status: 400, message: 'Select Uganda or Rwanda' };
  }
  const digits = normalizePhone(phoneRaw, region.dialCode);
  if (!digits) {
    return {
      ok: false,
      status: 400,
      message: `Enter your mobile number without + or leading 0. We use country code ${region.dialCode} (e.g. ${region.dialCode}766532251).`,
    };
  }
  return { ok: true, digits, region };
}

/** True if normalized digits match phone saved on the user's compliance profile. */
async function phoneMatchesUserProfile(userId, smsDigits) {
  const profile = await getComplianceProfileByUserId(userId);
  if (!profile?.phone) return false;
  for (const code of Object.keys(REGIONS)) {
    const region = getRegion(code);
    const normalized = normalizePhone(profile.phone, region.dialCode);
    if (normalized && normalized === smsDigits) return true;
  }
  const stored = String(profile.phone).replace(/\D/g, '');
  return stored === smsDigits;
}

async function recoverPassword({ email, countryCode, phone, password }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, status: 400, message: 'Enter a valid email address' };
  }

  const phoneResolved = resolveAccountPhone(countryCode, phone);
  if (!phoneResolved.ok) return phoneResolved;

  if (!password || String(password).length < 6) {
    return { ok: false, status: 400, message: 'Password must be at least 6 characters' };
  }

  const user = await getUserByEmail(normalized);
  const phoneOk = user ? await phoneMatchesUserProfile(user.id, phoneResolved.digits) : false;

  if (!user || !phoneOk) {
    return {
      ok: false,
      status: 400,
      message:
        'Could not verify your account. Use the same email and mobile number saved on your Ema profile (Settings / verification).',
    };
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  await updateUserPasswordHash(user.id, passwordHash);

  return { ok: true, message: 'Password updated. You can sign in with your new password.' };
}

function registerPasswordResetRoutes(app) {
  app.get('/auth/password-reset/regions', (_req, res) => {
    const regions = listPublicRegions().filter((r) => SUPPORTED_COUNTRY_CODES.has(r.countryCode));
    return res.json({ regions });
  });

  app.post('/auth/recover-password', async (req, res) => {
    try {
      const result = await recoverPassword({
        email: req.body?.email,
        countryCode: req.body?.countryCode,
        phone: req.body?.phone,
        password: req.body?.password,
      });
      if (!result.ok) return res.status(result.status).json({ message: result.message });
      return res.json({ message: result.message });
    } catch (e) {
      console.error('[auth/recover-password]', e);
      return res.status(500).json({ message: 'Could not reset password. Try again or contact support.' });
    }
  });
}

module.exports = { registerPasswordResetRoutes, recoverPassword, resolveAccountPhone };
