/**
 * Maps known configuration/schema errors to safe, actionable HTTP responses.
 * (Production otherwise hides these behind generic 500 messages.)
 */
function mapTotpConfigurationError(error) {
  const msg = String(error?.message || '');
  const code = error?.code;

  if (msg.includes('TOTP_ENCRYPTION_KEY')) {
    return {
      status: 503,
      message:
        'Authenticator is not configured on the server. Set TOTP_ENCRYPTION_KEY to a 32-byte key (64 hex characters or standard base64) in the backend environment.',
    };
  }

  const looksLikeMissingColumn =
    code === '42703' ||
    /totp_secret_enc|totp_enabled/i.test(msg) ||
    (/column/i.test(msg) && /users/i.test(msg)) ||
    /schema cache/i.test(msg);

  if (looksLikeMissingColumn) {
    return {
      status: 503,
      message:
        'Database is missing TOTP columns. Run backend/sql/migrations/20260509_totp.sql (or apply the same columns from schema.sql) on your database.',
    };
  }

  return null;
}

module.exports = { mapTotpConfigurationError };
