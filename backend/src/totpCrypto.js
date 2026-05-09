const crypto = require('crypto');

function getKeyBuffer() {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TOTP_ENCRYPTION_KEY is required in production');
    }
    return crypto.createHash('sha256').update('ema-dev-totp-key').digest();
  }
  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'base64');
  }
  if (buf.length !== 32) {
    throw new Error('TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes (use 64-char hex or 44-char base64)');
  }
  return buf;
}

function encryptTotpSecret(plain) {
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([iv, ciphertext]).toString('base64');
}

function decryptTotpSecret(encB64) {
  const key = getKeyBuffer();
  const buf = Buffer.from(encB64, 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('Invalid encrypted secret');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(12, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encryptTotpSecret, decryptTotpSecret };
