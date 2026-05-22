const {
  utcTodayYmd,
  getAiDailyPlanByDate,
  upsertAiDailyPlan,
  updateAiDailyPlan,
  planRowToApi,
  getUsersByIds,
  isMissingTableError,
  listAiDailyPlansAdmin,
} = require('./db');
const { adminAuthMiddleware } = require('./middleware/adminAuth');
const { runDailyPlanner } = require('./ai/earningsPlanner');
const { applyActivePlan } = require('./ai/applyPlan');
const { fetchMarketIndicators } = require('./ai/earningsTools');
const { buildAiPlanAdminDetail } = require('./ai/planAdminView');

const REGIMES = new Set(['calm', 'normal', 'volatile', 'risk_off']);

function registerAdminAiRoutes(app) {
  const schemaMsg =
    'AI daily plans schema missing. Run backend/sql/migrations/20260604_ai_daily_earnings.sql in Supabase.';

  app.get('/admin/api/ai/plans', adminAuthMiddleware, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 45;
      const rows = await listAiDailyPlansAdmin({ limit });
      return res.json({
        plans: rows.map((row) => {
          const budgetUsd = Number(row.budget_usd);
          const spent = Number(row.budget_spent_usd);
          return {
            ...planRowToApi(row),
            budgetRemainingUsd: Math.max(0, Math.round((budgetUsd - spent) * 100) / 100),
          };
        }),
      });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      console.error('[admin/ai/plans]', e);
      return res.status(500).json({ message: e.message || 'Failed to list plans' });
    }
  });

  app.get('/admin/api/ai/daily-plan', adminAuthMiddleware, async (req, res) => {
    try {
      const planDate = String(req.query.date || utcTodayYmd()).slice(0, 10);
      const plan = await getAiDailyPlanByDate(planDate);
      const detail = await buildAiPlanAdminDetail(plan, planDate);
      return res.json(detail);
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      console.error('[admin/ai/daily-plan]', e);
      return res.status(500).json({ message: e.message || 'Failed to load AI plan' });
    }
  });

  app.post('/admin/api/ai/daily-plan/budget', adminAuthMiddleware, async (req, res) => {
    try {
      const planDate = String(req.body?.planDate || utcTodayYmd()).slice(0, 10);
      const budgetUsd = Number(req.body?.budgetUsd);
      if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
        return res.status(400).json({ message: 'budgetUsd must be a non-negative number' });
      }
      const regime = req.body?.regime ? String(req.body.regime).toLowerCase() : undefined;
      const notes = req.body?.notes != null ? String(req.body.notes) : undefined;
      const existing = await getAiDailyPlanByDate(planDate);
      const snapshot = { ...(existing?.market_snapshot || {}) };
      if (regime) {
        if (!REGIMES.has(regime)) return res.status(400).json({ message: 'Invalid regime' });
        snapshot.regime = regime;
      }
      if (notes !== undefined) snapshot.notes = notes;

      const plan = await upsertAiDailyPlan({
        planDate,
        budgetUsd,
        marketSnapshot: snapshot,
        status: existing?.status === 'active' ? 'active' : existing?.status || 'draft',
      });
      const detail = await buildAiPlanAdminDetail(plan, planDate);
      return res.json({ plan: detail.plan, ...detail });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Failed to save budget' });
    }
  });

  app.post('/admin/api/ai/daily-plan/fetch-market', adminAuthMiddleware, async (req, res) => {
    try {
      const planDate = String(req.body?.planDate || utcTodayYmd()).slice(0, 10);
      const indicators = await fetchMarketIndicators();
      const existing = await getAiDailyPlanByDate(planDate);
      const snapshot = {
        ...(existing?.market_snapshot || {}),
        indicators,
        fetchedAt: indicators.fetchedAt,
      };
      if (indicators.suggestedRegime) snapshot.regime = indicators.suggestedRegime;
      const plan = await upsertAiDailyPlan({
        planDate,
        budgetUsd: existing?.budget_usd ?? 0,
        marketSnapshot: snapshot,
        status: existing?.status || 'draft',
      });
      const detail = await buildAiPlanAdminDetail(plan, planDate);
      return res.json({ plan: detail.plan, indicators, ...detail });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Market fetch failed' });
    }
  });

  app.post('/admin/api/ai/daily-plan/run', adminAuthMiddleware, async (req, res) => {
    try {
      const planDate = String(req.body?.planDate || utcTodayYmd()).slice(0, 10);
      const result = await runDailyPlanner(planDate, {
        forceDeterministic: Boolean(req.body?.deterministic),
      });
      if (!result.ok) return res.status(400).json({ message: result.error });
      const plan = await getAiDailyPlanByDate(planDate);
      const detail = await buildAiPlanAdminDetail(plan, planDate);
      return res.json({ ...result, ...detail });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      console.error('[admin/ai/run]', e);
      return res.status(500).json({ message: e.message || 'Planner run failed' });
    }
  });

  app.post('/admin/api/ai/daily-plan/approve', adminAuthMiddleware, async (req, res) => {
    try {
      const planDate = String(req.body?.planDate || utcTodayYmd()).slice(0, 10);
      const plan = await getAiDailyPlanByDate(planDate);
      if (!plan) return res.status(404).json({ message: 'No plan for this date' });
      if (plan.status !== 'pending_approval') {
        return res.status(400).json({ message: 'Plan is not pending approval' });
      }
      const note = req.body?.note ? String(req.body.note) : '';
      const summary = [plan.plan_summary, note ? `Admin override: ${note}` : 'Admin approved over budget.']
        .filter(Boolean)
        .join(' ');
      await updateAiDailyPlan(plan.id, { status: 'active', planSummary: summary });
      const apply = await applyActivePlan(planDate);
      const updated = await getAiDailyPlanByDate(planDate);
      const detail = await buildAiPlanAdminDetail(updated, planDate);
      return res.json({ apply, ...detail });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Approve failed' });
    }
  });
}

module.exports = { registerAdminAiRoutes };
