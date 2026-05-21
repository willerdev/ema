const bcrypt = require('bcryptjs');
const {
  getUserByEmail,
  getComplianceProfileByUserId,
  updateUserPasswordHash,
} = require('./db');
const { isComplianceProfileComplete } = require('./complianceProfile');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** Comparable digit forms (strips formatting; handles optional leading 0 / country prefix). */
function allNormalizedForms(phoneRaw) {
  const forms = new Set();
  const raw = String(phoneRaw || '').replace(/\D/g, '');
  if (!raw) return forms;
  forms.add(raw);
  if (raw.startsWith('0')) forms.add(raw.slice(1));
  if (raw.length > 9 && raw.startsWith('00')) forms.add(raw.replace(/^00+/, ''));
  for (const len of [3, 2, 1]) {
    if (raw.length > 9) forms.add(raw.slice(len));
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
      message: 'Enter the mobile number saved on your compliance profile.',
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

async function verifyRecoverCredentials({ email, phone }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, status: 400, message: 'Enter a valid email address' };
  }

  const phoneCheck = validatePhoneInput(phone);
  if (!phoneCheck.ok) return phoneCheck;

  const user = await getUserByEmail(normalized);
  if (!user) {
    return {
      ok: false,
      status: 400,
      message:
        'We could not verify your details. Use the email and phone from your account compliance profile.',
    };
  }

  const profile = await getComplianceProfileByUserId(user.id);
  if (!isComplianceProfileComplete(profile)) {
    return {
      ok: false,
      status: 400,
      message:
        'Complete your compliance profile in Settings before resetting your password, then try again.',
    };
  }

  if (!profile?.phone || !phonesMatch(phone, profile.phone)) {
    return {
      ok: false,
      status: 400,
      message:
        'We could not verify your details. Use the same email and phone number saved on your compliance profile.',
    };
  }

  return { ok: true, verified: true };
}

async function recoverPassword({ email, phone, password }) {
  const verify = await verifyRecoverCredentials({ email, phone });
  if (!verify.ok) return verify;

  if (!password || String(password).length < 6) {
    return { ok: false, status: 400, message: 'Password must be at least 6 characters' };
  }

  const user = await getUserByEmail(normalizeEmail(email));
  const passwordHash = await bcrypt.hash(String(password), 10);
  await updateUserPasswordHash(user.id, passwordHash);

  return { ok: true, message: 'Password updated. You can sign in with your new password.' };
}

function registerPasswordResetRoutes(app) {
  app.post('/auth/recover-password/verify', async (req, res) => {
    try {
      const result = await verifyRecoverCredentials({
        email: req.body?.email,
        phone: req.body?.phone,
      });
      if (!result.ok) return res.status(result.status).json({ message: result.message });
      return res.json({ verified: true, message: 'Verified. You can set a new password.' });
    } catch (e) {
      console.error('[auth/recover-password/verify]', e);
      return res.status(500).json({ message: 'Could not verify your details. Try again later.' });
    }
  });

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

module.exports = {
  registerPasswordResetRoutes,
  recoverPassword,
  verifyRecoverCredentials,
  allNormalizedForms,
  phonesMatch,
};
