const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  getUserByEmail,
  getComplianceProfileByUserId,
  replacePasswordResetCode,
  consumePasswordResetCode,
  updateUserPasswordHash,
  isMissingTableError,
} = require('./db');
const { getRegion, normalizePhone, listPublicRegions, REGIONS } = require('./localMoneyRegions');
const { sendSms, smsEnabled, twilioConfigured } = require('./services/twilioSms');

const RESET_CODE_TTL_MS = 30 * 60 * 1000;

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function hashResetCode(code) {
  return crypto.createHash('sha256').update(String(code).replace(/\s/g, '')).digest('hex');
}

function generateResetCode() {
  return String(crypto.randomInt(100000, 1000000));
}

/** Resolve mobile to international digits only, e.g. 256766532251 (no +, no leading 0). */
function resolveSmsPhone(countryCode, phoneRaw) {
  const region = getRegion(countryCode);
  if (!region) {
    return { ok: false, status: 400, message: 'Select a supported country' };
  }
  const digits = normalizePhone(phoneRaw, region.dialCode);
  if (!digits) {
    return {
      ok: false,
      status: 400,
      message: `Enter your mobile number without + or leading 0. We add country code ${region.dialCode} automatically.`,
    };
  }
  return { ok: true, digits, dialCode: region.dialCode, region };
}

/** True if normalized SMS digits match phone saved on the user's compliance profile. */
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

async function requestPasswordReset({ email, countryCode, phone }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, status: 400, message: 'Enter a valid email address' };
  }

  const phoneResolved = resolveSmsPhone(countryCode, phone);
  if (!phoneResolved.ok) return phoneResolved;

  const generic = {
    ok: true,
    message: 'If an account exists with this email and phone, a reset code has been sent by SMS.',
  };

  const user = await getUserByEmail(normalized);
  if (!user) return generic;

  const phoneOk = await phoneMatchesUserProfile(user.id, phoneResolved.digits);
  if (!phoneOk) return generic;

  const code = generateResetCode();
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();
  await replacePasswordResetCode({
    userId: user.id,
    codeHash: hashResetCode(code),
    expiresAt,
  });

  const smsBody = `Ema: Your password reset code is ${code}. It expires in 30 minutes.`;
  const smsResult = await sendSms(phoneResolved.digits, smsBody);

  if (!smsResult.sent) {
    if (!smsEnabled() || !twilioConfigured()) {
      if (process.env.NODE_ENV === 'production') {
        console.warn('[auth/forgot-password] SMS not configured');
        return generic;
      }
      console.log('[dev] password reset SMS to', phoneResolved.digits, ':', code);
      return generic;
    }
    console.warn('[auth/forgot-password] SMS delivery failed for', phoneResolved.digits);
  }

  return generic;
}

async function resetPasswordWithCode({ email, countryCode, phone, code, password }) {
  const normalized = normalizeEmail(email);
  const normalizedCode = String(code || '').replace(/\s/g, '');
  if (!normalized || normalizedCode.length < 6) {
    return { ok: false, status: 400, message: 'Email and SMS reset code are required' };
  }

  const phoneResolved = resolveSmsPhone(countryCode, phone);
  if (!phoneResolved.ok) return phoneResolved;

  if (!password || String(password).length < 6) {
    return { ok: false, status: 400, message: 'Password must be at least 6 characters' };
  }

  const user = await getUserByEmail(normalized);
  if (!user) {
    return { ok: false, status: 400, message: 'Invalid email, phone, or reset code' };
  }

  const phoneOk = await phoneMatchesUserProfile(user.id, phoneResolved.digits);
  if (!phoneOk) {
    return { ok: false, status: 400, message: 'Invalid email, phone, or reset code' };
  }

  const consumed = await consumePasswordResetCode({
    userId: user.id,
    codeHash: hashResetCode(normalizedCode),
  });
  if (!consumed) {
    return { ok: false, status: 400, message: 'Invalid or expired reset code' };
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  await updateUserPasswordHash(user.id, passwordHash);

  return { ok: true, message: 'Password updated. You can sign in with your new password.' };
}

function registerPasswordResetRoutes(app) {
  app.get('/auth/password-reset/regions', (_req, res) => {
    return res.json({ regions: listPublicRegions() });
  });

  app.post('/auth/forgot-password', async (req, res) => {
    try {
      const result = await requestPasswordReset({
        email: req.body?.email,
        countryCode: req.body?.countryCode,
        phone: req.body?.phone,
      });
      if (!result.ok) return res.status(result.status).json({ message: result.message });
      return res.json({ message: result.message });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({
          message:
            'Password reset is not available yet. Run backend/sql/migrations/20260529_password_reset_and_percent_cap.sql in Supabase.',
        });
      }
      console.error('[auth/forgot-password]', e);
      return res.status(500).json({ message: 'Could not process reset request' });
    }
  });

  app.post('/auth/reset-password', async (req, res) => {
    try {
      const result = await resetPasswordWithCode({
        email: req.body?.email,
        countryCode: req.body?.countryCode,
        phone: req.body?.phone,
        code: req.body?.code,
        password: req.body?.password,
      });
      if (!result.ok) return res.status(result.status).json({ message: result.message });
      return res.json({ message: result.message });
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({
          message:
            'Password reset is not available yet. Run backend/sql/migrations/20260529_password_reset_and_percent_cap.sql in Supabase.',
        });
      }
      console.error('[auth/reset-password]', e);
      return res.status(500).json({ message: 'Could not reset password' });
    }
  });
}

module.exports = { registerPasswordResetRoutes, requestPasswordReset, resetPasswordWithCode, resolveSmsPhone };
