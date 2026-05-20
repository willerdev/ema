const bcrypt = require('bcryptjs');
const {
  getUserByEmail,
  getComplianceProfileByUserId,
  updateUserPasswordHash,
} = require('./db');
const { getRegion, normalizePhone, REGIONS } = require('./localMoneyRegions');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** All comparable digit forms for UG/RW (256…, 250…, or local without leading 0). */
function allNormalizedForms(phoneRaw) {
  const forms = new Set();
  const raw = String(phoneRaw || '').replace(/\D/g, '');
  if (!raw) return forms;
  forms.add(raw);
  for (const code of Object.keys(REGIONS)) {
    const region = getRegion(code);
    const normalized = normalizePhone(phoneRaw, region.dialCode);
    if (normalized) forms.add(normalized);
  }
  return forms;
}

function validatePhoneInput(phoneRaw) {
  const forms = allNormalizedForms(phoneRaw);
  const valid = [...forms].some((d) => d.length >= 9);
  if (!valid) {
    return {
      ok: false,
      status: 400,
      message: 'Enter a valid mobile number saved on your profile (e.g. 766532251 or 256766532251).',
    };
  }
  return { ok: true };
}

function phonesMatch(inputPhone, profilePhone) {
  const inputForms = allNormalizedForms(inputPhone);
  const profileForms = allNormalizedForms(profilePhone);
  for (const a of inputForms) {
    if (profileForms.has(a)) return true;
  }
  return false;
}

async function phoneMatchesUserProfile(userId, phoneRaw) {
  const profile = await getComplianceProfileByUserId(userId);
  if (!profile?.phone) return false;
  return phonesMatch(phoneRaw, profile.phone);
}

async function recoverPassword({ email, phone, password }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, status: 400, message: 'Enter a valid email address' };
  }

  const phoneCheck = validatePhoneInput(phone);
  if (!phoneCheck.ok) return phoneCheck;

  if (!password || String(password).length < 6) {
    return { ok: false, status: 400, message: 'Password must be at least 6 characters' };
  }

  const user = await getUserByEmail(normalized);
  const phoneOk = user ? await phoneMatchesUserProfile(user.id, phone) : false;

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
  app.post('/auth/recover-password', async (req, res) => {
    try {
      const result = await recoverPassword({
        email: req.body?.email,
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

module.exports = { registerPasswordResetRoutes, recoverPassword, allNormalizedForms, phonesMatch };
