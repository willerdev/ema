const jwt = require('jsonwebtoken');

const ADMIN_PURPOSE = 'admin';

function superadminUsernames() {
  const raw = process.env.ADMIN_SUPERADMINS || process.env.ADMIN_USERNAME || 'admin';
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isSuperAdminUsername(username) {
  return superadminUsernames().includes(String(username || '').trim());
}

function requireSuperAdmin(req, res, next) {
  if (req.adminRole !== 'superadmin') {
    return res.status(403).json({ message: 'Superadmin access required' });
  }
  return next();
}

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
    req.adminRole =
      payload.role === 'superadmin' || isSuperAdminUsername(req.adminUser) ? 'superadmin' : 'admin';
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired admin session' });
  }
}

module.exports = {
  adminAuthMiddleware,
  requireSuperAdmin,
  isSuperAdminUsername,
  ADMIN_PURPOSE,
};
