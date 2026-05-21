const jwt = require('jsonwebtoken');

const ADMIN_PURPOSE = 'admin';

function adminAuthMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Admin login required' });
  }
  try {
    const token = header.replace('Bearer ', '');
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'ema-dev-secret');
    if (payload.purpose !== ADMIN_PURPOSE) {
      return res.status(401).json({ message: 'Invalid admin session' });
    }
    req.adminUser = payload.sub || 'admin';
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired admin session' });
  }
}

module.exports = { adminAuthMiddleware, ADMIN_PURPOSE };
