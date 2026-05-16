const {
  getNotificationPreferencesByUserId,
  upsertNotificationPreferences,
  isMissingTableError,
} = require('./db');

const SCHEMA_MSG =
  'Notification preferences schema missing. Run backend/sql/migrations/20260522_user_notification_preferences.sql in Supabase.';

function toPublicPrefs(row) {
  if (!row) {
    return {
      premiumAlertsEnabled: false,
      notifySms: false,
      notifyEmail: false,
      premiumTermsAcceptedAt: null,
    };
  }
  return {
    premiumAlertsEnabled: Boolean(row.premium_alerts_enabled),
    notifySms: Boolean(row.notify_sms),
    notifyEmail: Boolean(row.notify_email),
    premiumTermsAcceptedAt: row.premium_terms_accepted_at || null,
  };
}

function registerNotificationPreferencesRoutes(app, { authMiddleware }) {
  app.get('/notification-preferences', authMiddleware, async (req, res) => {
    try {
      const row = await getNotificationPreferencesByUserId(req.userId);
      return res.json({
        preferences: toPublicPrefs(row),
        weeklyPriceUsd: 2,
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: SCHEMA_MSG });
      return res.status(500).json({ message: e.message || 'Failed to load notification preferences' });
    }
  });

  app.put('/notification-preferences', authMiddleware, async (req, res) => {
    try {
      const body = req.body || {};
      const wantsPremium = Boolean(body.premiumAlertsEnabled);
      const acceptTerms = Boolean(body.acceptPremiumTerms);

      if (wantsPremium && !acceptTerms) {
        const existing = await getNotificationPreferencesByUserId(req.userId);
        if (!existing?.premium_terms_accepted_at) {
          return res.status(400).json({
            message: 'Accept the $2/week alert subscription terms before enabling premium notifications.',
          });
        }
      }

      if ((body.notifySms || body.notifyEmail) && !wantsPremium) {
        const existing = await getNotificationPreferencesByUserId(req.userId);
        if (!existing?.premium_alerts_enabled) {
          return res.status(400).json({
            message: 'Enable premium alerts ($2/week) before choosing SMS or email channels.',
          });
        }
      }

      const row = await upsertNotificationPreferences(req.userId, {
        premiumAlertsEnabled: body.premiumAlertsEnabled,
        notifySms: body.notifySms,
        notifyEmail: body.notifyEmail,
        acceptPremiumTerms: acceptTerms,
      });

      return res.json({ preferences: toPublicPrefs(row), weeklyPriceUsd: 2 });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: SCHEMA_MSG });
      return res.status(500).json({ message: e.message || 'Failed to save notification preferences' });
    }
  });
}

module.exports = { registerNotificationPreferencesRoutes };
