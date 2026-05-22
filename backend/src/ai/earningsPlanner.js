const {
  utcTodayYmd,
  getAiDailyPlanByDate,
  getAiDailyPlanById,
  updateAiDailyPlan,
  clearAiAllocationsForPlan,
  planRowToApi,
  listAiAllocationsByPlan,
  allocationRowToApi,
  getUsersByIds,
} = require('../db');
const {
  executeTool,
  finalizePlan,
  fetchMarketIndicators,
  setMarketSnapshot,
  listUsersBatch,
  proposeUserAllocation,
} = require('./earningsTools');
const { applyActivePlan } = require('./applyPlan');
const { hasLlmCredentials, plannerStep, appendToolResults, aiModel } = require('./llmClient');

const MAX_LLM_STEPS = 40;
const SYSTEM_PROMPT = `You are Ema's daily airfarming earnings allocator.
Respect the daily budget_usd, platform caps (max_percent, max_profit_per_drop), and user pause flags.
In risk_off or volatile regimes use lower percents and tighter balance windows; in calm markets you may use higher tiers for larger balances.
Distribute opportunities fairly across balance tiers.
Workflow:
1) get_daily_context
2) optionally fetch_market_indicators and set_market_snapshot with regime
3) list_users_batch in pages; for each user call propose_user_allocation (skip paused or zero balance)
4) get_plan_totals
5) finalize_plan with a short planSummary
Never skip finalize_plan.`;

async function runDeterministicPlanner(ctx, plan) {
  const regime = String((plan.market_snapshot || {}).regime || 'normal').toLowerCase();
  await executeTool('set_market_snapshot', { regime }, ctx);

  let offset = 0;
  const limit = 50;
  for (;;) {
    const batch = await listUsersBatch({ offset, limit });
    for (const u of batch.users || []) {
      if (u.dropsPaused || u.airfarmingBalance <= 0) {
        await proposeUserAllocation(ctx.planId, { userId: u.id, eligible: false, airfarmingBalance: u.airfarmingBalance });
      } else {
        await proposeUserAllocation(ctx.planId, {
          userId: u.id,
          airfarmingBalance: u.airfarmingBalance,
        });
      }
    }
    if (!batch.hasMore) break;
    offset += limit;
  }
}

async function runLlmPlanner(ctx, plan) {
  const messages = [
    {
      role: 'user',
      content: `Plan date ${ctx.planDate}. Budget USD ${plan.budget_usd}. Current market: ${JSON.stringify(plan.market_snapshot || {})}. Begin allocation.`,
    },
  ];

  for (let step = 0; step < MAX_LLM_STEPS; step += 1) {
    const result = await plannerStep({ messages, system: SYSTEM_PROMPT });
    if (result.done) return { steps: step + 1, finished: true, text: result.text };

    const toolResults = [];
    for (const tc of result.toolCalls || []) {
      const output = await executeTool(tc.name, tc.arguments || {}, ctx);
      toolResults.push({
        toolCallId: tc.id,
        toolUseId: tc.id,
        name: tc.name,
        output,
      });
      if (tc.name === 'finalize_plan' && output?.ok) {
        return { steps: step + 1, finalized: output };
      }
    }
    appendToolResults(messages, result, toolResults);
  }

  return { steps: MAX_LLM_STEPS, finished: false, note: 'max_steps_reached' };
}

async function runDailyPlanner(planDate, options = {}) {
  const date = planDate || utcTodayYmd();
  let plan = await getAiDailyPlanByDate(date);
  if (!plan) {
    return { ok: false, error: 'No plan for this date. Set daily budget in admin first.' };
  }
  if (!(Number(plan.budget_usd) > 0)) {
    return { ok: false, error: 'Daily budget must be greater than zero.' };
  }
  if (plan.status === 'closed') {
    return { ok: false, error: 'Plan is closed for this date.' };
  }

  await updateAiDailyPlan(plan.id, { status: 'planning', model: options.model || aiModel() });
  await clearAiAllocationsForPlan(plan.id);

  const ctx = { planId: plan.id, planDate: date };
  let plannerMode = 'deterministic';

  if (options.forceDeterministic !== true && hasLlmCredentials()) {
    try {
      const indicators = await fetchMarketIndicators();
      if (indicators.suggestedRegime && !(plan.market_snapshot || {}).regime) {
        await setMarketSnapshot(plan.id, {
          regime: indicators.suggestedRegime,
          indicators,
        });
        plan = await getAiDailyPlanById(plan.id);
      }
      await runLlmPlanner(ctx, plan);
      plannerMode = 'llm';
    } catch (e) {
      console.warn('[ai-planner] LLM run failed, using deterministic fallback:', e.message);
      await runDeterministicPlanner(ctx, plan);
    }
  } else {
    await runDeterministicPlanner(ctx, plan);
  }

  const fin = await finalizePlan(plan.id, {
    planSummary: options.planSummary || `Planner run (${plannerMode}) for ${date}.`,
  });

  let applyResult = null;
  if (fin.status === 'active') {
    applyResult = await applyActivePlan(date);
  }

  plan = await getAiDailyPlanById(plan.id);
  const allocations = await listAiAllocationsByPlan(plan.id);
  const userIds = allocations.map((a) => a.user_id);
  const users = await getUsersByIds(userIds);
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return {
    ok: true,
    planDate: date,
    plannerMode,
    plan: planRowToApi(plan),
    finalize: fin,
    apply: applyResult,
    allocations: allocations.map((row) => ({
      ...allocationRowToApi(row),
      email: emailById.get(row.user_id) || '—',
    })),
  };
}

module.exports = { runDailyPlanner, runDeterministicPlanner, SYSTEM_PROMPT };
