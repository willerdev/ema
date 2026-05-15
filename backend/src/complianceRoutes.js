const {
  getComplianceProfileByUserId,
  upsertComplianceProfile,
  isMissingTableError,
} = require('./db');
const {
  validateCompliancePayload,
  isComplianceProfileComplete,
  toPublicComplianceProfile,
  SOURCE_OF_FUNDS,
  INVESTMENT_DURATIONS,
} = require('./complianceProfile');

function registerComplianceRoutes(app, { authMiddleware }) {
  const schemaErrorMessage =
    'Compliance schema missing. Run backend/sql/migrations/20260516_user_compliance_profile.sql in Supabase.';

  app.get('/compliance/profile', authMiddleware, async (req, res) => {
    try {
      const row = await getComplianceProfileByUserId(req.userId);
      const profile = toPublicComplianceProfile(row);
      return res.json({
        profile,
        complete: isComplianceProfileComplete(row),
        options: {
          sourceOfFunds: SOURCE_OF_FUNDS,
          plannedInvestmentDuration: INVESTMENT_DURATIONS,
        },
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(500).json({ message: e.message || 'Failed to load compliance profile' });
    }
  });

  app.put('/compliance/profile', authMiddleware, async (req, res) => {
    try {
      const validation = validateCompliancePayload(req.body || {});
      if (!validation.ok) {
        return res.status(400).json({ message: 'Validation failed', errors: validation.errors });
      }
      const row = await upsertComplianceProfile(req.userId, validation.normalized);
      const profile = toPublicComplianceProfile(row);
      return res.json({
        profile,
        complete: isComplianceProfileComplete(row),
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaErrorMessage });
      return res.status(500).json({ message: e.message || 'Failed to save compliance profile' });
    }
  });
}

module.exports = { registerComplianceRoutes };
