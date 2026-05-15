const { getUserById } = require('./db');
const { decryptTotpSecret } = require('./totpCrypto');
const { verifySync } = require('otplib');

/**
 * @param {string} userId
 * @param {string|undefined} totpCode
 * @param {{ required?: boolean }} [opts] — when required, user must have 2FA enabled and supply a valid code
 */
async function verifyUserTotp(userId, totpCode, opts = {}) {
  const required = Boolean(opts.required);
  const user = await getUserById(userId);
  if (!user) return { ok: false, status: 404, message: 'User not found' };

  if (required && !user.totp_enabled) {
    return {
      ok: false,
      status: 403,
      message: 'Enable two-factor authentication in Settings to continue.',
      code: 'TOTP_REQUIRED',
    };
  }

  if (!user.totp_enabled) return { ok: true };

  const code = totpCode != null ? String(totpCode).replace(/\s/g, '') : '';
  if (!code || code.length < 6) {
    return { ok: false, status: 400, message: 'Authenticator code is required' };
  }
  if (!user.totp_secret_enc) {
    return { ok: false, status: 500, message: 'Server configuration error' };
  }
  let secret;
  try {
    secret = decryptTotpSecret(user.totp_secret_enc);
  } catch {
    return { ok: false, status: 500, message: 'Server configuration error' };
  }
  const totpResult = verifySync({ secret, token: code, epochTolerance: 1 });
  if (!totpResult.valid) {
    return { ok: false, status: 401, message: 'Invalid authenticator code' };
  }
  return { ok: true };
}

module.exports = { verifyUserTotp };
