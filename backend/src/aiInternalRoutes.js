const { utcTodayYmd, getAiDailyPlanByDate, isMissingTableError } = require('./db');
const { runDailyPlanner } = require('./ai/earningsPlanner');

function requireCronSecret(req) {
  const expected = process.env.INTERNAL_CRON_SECRET;
  if (!expected) return false;
  const got = req.headers['x-internal-cron-secret'] || req.body?.secret;
  return String(got || '') === String(expected);
}

function registerAiInternalRoutes(app) {
  app.post('/internal/ai/daily-plan', async (req, res) => {
    try {
      if (!requireCronSecret(req)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const planDate = String(req.body?.planDate || utcTodayYmd()).slice(0, 10);
      const plan = await getAiDailyPlanByDate(planDate);
      if (!plan) {
        return res.json({ ok: false, skipped: true, reason: 'no_plan', planDate });
      }
      if (!(Number(plan.budget_usd) > 0)) {
        return res.json({ ok: false, skipped: true, reason: 'no_budget', planDate });
      }
      if (plan.status === 'active' || plan.status === 'closed') {
        return res.json({ ok: true, skipped: true, reason: 'already_final', status: plan.status, planDate });
      }
      const result = await runDailyPlanner(planDate);
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (e) {
      if (isMissingTableError(e)) {
        return res.status(503).json({
          message: 'AI plans schema missing. Run 20260604_ai_daily_earnings.sql.',
        });
      }
      console.error('[internal/ai/daily-plan]', e);
      return res.status(500).json({ message: e.message || 'Daily plan cron failed' });
    }
  });
}

module.exports = { registerAiInternalRoutes };
