const { getComplianceProfileByUserId } = require('../db');
const { isComplianceProfileComplete } = require('../complianceProfile');

async function requireComplianceProfile(req, res, next) {
  try {
    const row = await getComplianceProfileByUserId(req.userId);
    if (!isComplianceProfileComplete(row)) {
      return res.status(403).json({
        message: 'Complete your compliance profile in Settings before withdrawing.',
        code: 'COMPLIANCE_PROFILE_REQUIRED',
      });
    }
    return next();
  } catch (e) {
    if (e?.code === 'PGRST205') {
      return res.status(503).json({
        message: 'Compliance schema missing. Run backend/sql/migrations/20260516_user_compliance_profile.sql in Supabase.',
      });
    }
    return res.status(500).json({ message: 'Failed to verify compliance profile' });
  }
}

module.exports = { requireComplianceProfile };
