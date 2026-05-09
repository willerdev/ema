const jwt = require('jsonwebtoken');

const TOTP_PENDING_PURPOSE = 'totp_pending';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing token' });
  }

  try {
    const token = header.replace('Bearer ', '');
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'ema-dev-secret');
    if (payload.purpose === TOTP_PENDING_PURPOSE) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function totpPendingMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing token' });
  }

  try {
    const token = header.replace('Bearer ', '');
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'ema-dev-secret');
    if (payload.purpose !== TOTP_PENDING_PURPOSE) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

module.exports = { authMiddleware, totpPendingMiddleware, TOTP_PENDING_PURPOSE };
