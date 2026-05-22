const {
  utcTodayYmd,
  getAiDailyPlanByDate,
  upsertAiDailyPlan,
  updateAiDailyPlan,
  listAiAllocationsByPlan,
  planRowToApi,
  allocationRowToApi,
  getUsersByIds,
  isMissingTableError,
} = require('./db');
const { adminAuthMiddleware } = require('./middleware/adminAuth');
const { runDailyPlanner } = require('./ai/earningsPlanner');
const { applyActivePlan } = require('./ai/applyPlan');
const { fetchMarketIndicators } = require('./ai/earningsTools');

const REGIMES = new Set(['calm', 'normal', 'volatile', 'risk_off']);

function registerAdminAiRoutes(app) {
  const schemaMsg =
    'AI daily plans schema missing. Run backend/sql/migrations/20260604_ai_daily_earnings.sql in Supabase.';

  app.get('/admin/api/ai/daily-plan', adminAuthMiddleware, async (req, res) => {
    try {
      const planDate = String(req.query.date || utcTodayYmd()).slice(0, 10);
      const plan = await getAiDailyPlanByDate(planDate);
      if (!plan) {
        return res.json({ plan: null, allocations: [], planDate });
      }
      const allocations = await listAiAllocationsByPlan(plan.id);
      const users = await getUsersByIds(allocations.map((a) => a.user_id));
      const emailById = new Map(users.map((u) => [u.id, u.email]));
      const balanceById = new Map();
      for (const a of allocations) {
        balanceById.set(a.user_id, null);
      }
      return res.json({
        planDate,
        plan: planRowToApi(plan),
        allocations: allocations.map((row) => ({
          ...allocationRowToApi(row),
          email: emailById.get(row.user_id) || '—',
        })),
      });
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
      return res.json({ plan: planRowToApi(plan) });
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
      return res.json({ plan: planRowToApi(plan), indicators });
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
      return res.json(result);
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
      return res.json({ plan: planRowToApi(updated), apply });
    } catch (e) {
      if (isMissingTableError(e)) return res.status(503).json({ message: schemaMsg });
      return res.status(500).json({ message: e.message || 'Approve failed' });
    }
  });
}

module.exports = { registerAdminAiRoutes };
