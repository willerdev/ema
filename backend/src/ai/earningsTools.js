const {
  utcTodayYmd,
  getAiDailyPlanByDate,
  getAiDailyPlanById,
  updateAiDailyPlan,
  upsertAiUserAllocation,
  listAiAllocationsByPlan,
  recalcPlanProjectedTotals,
  listUsersForAiPlannerBatch,
  listAirfarmingDropBands,
  getAirfarmingPlatformSettings,
} = require('../db');
const { clampAirfarmingPercent, getEffectiveCaps } = require('../airfarmingDrops');
const { getClient } = require('../services/alpacaClient');

const REGIME_MULTIPLIER = {
  calm: 1.05,
  normal: 1,
  volatile: 0.85,
  risk_off: 0.65,
};

function inferBandFromBalance(balance) {
  const b = Number(balance) || 0;
  if (b >= 10000) return 3;
  if (b >= 1000) return 2;
  if (b >= 100) return 0;
  return 0;
}

function pickBandConfig(bands, bandIndex) {
  const row = (bands || []).find((b) => Number(b.band_index) === Number(bandIndex));
  if (row) {
    return {
      bandIndex: Number(row.band_index),
      percent: Number(row.percent),
      minBalance: Number(row.min_balance),
      maxBalance: Number(row.max_balance),
      label: row.label,
    };
  }
  const defaults = {
    0: { min: 100, max: 145, percent: 12 },
    1: { min: 100, max: 112, percent: 10 },
    2: { min: 1000, max: 2400, percent: 22 },
    3: { min: 10000, max: 16000, percent: 30 },
  };
  const d = defaults[bandIndex] || defaults[0];
  return {
    bandIndex,
    percent: d.percent,
    minBalance: d.min,
    maxBalance: d.max,
    label: `Tier ${bandIndex}`,
  };
}

function estimateProjectedProfit(balance, percent, maxProfit) {
  const raw = (Number(balance) * Number(percent)) / 100;
  return Math.round(Math.min(raw, maxProfit) * 100) / 100;
}

async function getDailyContext(planDate) {
  const date = planDate || utcTodayYmd();
  const plan = await getAiDailyPlanByDate(date);
  const caps = await getEffectiveCaps();
  const bands = await listAirfarmingDropBands();
  const platform = await getAirfarmingPlatformSettings();

  if (!plan) {
    return {
      planDate: date,
      hasPlan: false,
      status: 'draft',
      budgetUsd: 0,
      budgetSpentUsd: 0,
      projectedPayoutUsd: 0,
      budgetRemainingUsd: 0,
      caps,
      bands: bands.map((b) => ({
        bandIndex: Number(b.band_index),
        label: b.label,
        percent: Number(b.percent),
        minBalance: Number(b.min_balance),
        maxBalance: Number(b.max_balance),
      })),
      platformSettings: {
        maxPercent: Number(platform.max_percent),
        maxProfitPerDrop: Number(platform.max_profit_per_drop),
      },
    };
  }

  const budgetUsd = Number(plan.budget_usd);
  const spent = Number(plan.budget_spent_usd);
  const projected = Number(plan.projected_payout_usd);

  return {
    planDate: date,
    planId: plan.id,
    hasPlan: true,
    status: plan.status,
    budgetUsd,
    budgetSpentUsd: spent,
    projectedPayoutUsd: projected,
    budgetRemainingUsd: Math.max(0, Math.round((budgetUsd - spent) * 100) / 100),
    marketSnapshot: plan.market_snapshot || {},
    planSummary: plan.plan_summary,
    caps,
    bands: bands.map((b) => ({
      bandIndex: Number(b.band_index),
      label: b.label,
      percent: Number(b.percent),
      minBalance: Number(b.min_balance),
      maxBalance: Number(b.max_balance),
    })),
    platformSettings: {
      maxPercent: Number(platform.max_percent),
      maxProfitPerDrop: Number(platform.max_profit_per_drop),
    },
  };
}

async function setMarketSnapshot(planId, snapshotPatch) {
  const plan = await getAiDailyPlanById(planId);
  if (!plan) return { error: 'Plan not found' };
  const merged = { ...(plan.market_snapshot || {}), ...snapshotPatch };
  await updateAiDailyPlan(planId, { marketSnapshot: merged });
  return { ok: true, marketSnapshot: merged };
}

function getAlpacaMarketClient() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return null;
  return getClient(key, secret);
}

async function fetchMarketIndicators() {
  const out = { source: 'manual', fetchedAt: new Date().toISOString(), symbols: {} };
  try {
    const client = getAlpacaMarketClient();
    if (!client?.stockBars) {
      return { ...out, note: 'Alpaca not configured; set market regime manually.' };
    }
    const res = await client.stockBars('SPY,QQQ');
    const bars = res?.data?.bars || res?.data || {};
    for (const sym of ['SPY', 'QQQ']) {
      const b = bars[sym]?.[0] || bars[sym];
      if (b) {
        const c = Number(b.c || b.close);
        const o = Number(b.o || b.open);
        if (c && o) {
          out.symbols[sym] = { close: c, open: o, changePct: Math.round(((c - o) / o) * 10000) / 100 };
        }
      }
    }
    out.source = 'alpaca';
    const avg =
      Object.values(out.symbols)
        .map((s) => s.changePct)
        .filter(Number.isFinite)
        .reduce((a, v, _, arr) => a + v / arr.length, 0) || 0;
    if (avg <= -1.5) out.suggestedRegime = 'risk_off';
    else if (avg <= -0.5) out.suggestedRegime = 'volatile';
    else if (avg >= 1) out.suggestedRegime = 'calm';
    else out.suggestedRegime = 'normal';
    return out;
  } catch (e) {
    return { ...out, error: e.message, note: 'Market fetch failed; use manual regime.' };
  }
}

async function listUsersBatch({ offset = 0, limit = 50 }) {
  return listUsersForAiPlannerBatch({ offset, limit });
}

async function proposeUserAllocation(planId, payload) {
  const plan = await getAiDailyPlanById(planId);
  if (!plan) return { error: 'Plan not found' };
  if (!['draft', 'planning'].includes(plan.status)) {
    return { error: `Cannot propose allocations while plan status is ${plan.status}` };
  }

  const caps = await getEffectiveCaps();
  const bands = await listAirfarmingDropBands();
  const eligible = payload.eligible !== false;
  const balance = Number(payload.airfarmingBalance ?? payload.balance ?? 0);

  if (!eligible || balance <= 0) {
    await upsertAiUserAllocation({
      planId,
      userId: payload.userId,
      eligible: false,
      projectedProfit: 0,
      bandIndex: null,
      percent: null,
      minBalance: null,
      maxBalance: null,
    });
    return { ok: true, eligible: false, projectedProfit: 0 };
  }

  let bandIndex =
    payload.bandIndex != null ? Number(payload.bandIndex) : inferBandFromBalance(balance);
  if (!Number.isInteger(bandIndex) || bandIndex < 0 || bandIndex > 3) {
    bandIndex = inferBandFromBalance(balance);
  }

  const cfg = pickBandConfig(bands, bandIndex);
  let percent = clampAirfarmingPercent(
    payload.percent != null ? payload.percent : cfg.percent,
    caps.maxPercent
  );

  const regime = String((plan.market_snapshot || {}).regime || 'normal').toLowerCase();
  const mult = REGIME_MULTIPLIER[regime] ?? 1;
  percent = clampAirfarmingPercent(percent * mult, caps.maxPercent);

  let minBalance = Number(payload.minBalance != null ? payload.minBalance : cfg.minBalance);
  let maxBalance = Number(payload.maxBalance != null ? payload.maxBalance : cfg.maxBalance);
  if (!Number.isFinite(minBalance)) minBalance = cfg.minBalance;
  if (!Number.isFinite(maxBalance)) maxBalance = cfg.maxBalance;
  if (maxBalance < minBalance) [minBalance, maxBalance] = [maxBalance, minBalance];

  const projectedProfit = estimateProjectedProfit(balance, percent, caps.maxProfit ?? caps.maxProfitPerDrop);

  await upsertAiUserAllocation({
    planId,
    userId: payload.userId,
    bandIndex,
    percent,
    minBalance: Math.round(minBalance * 100) / 100,
    maxBalance: Math.round(maxBalance * 100) / 100,
    projectedProfit,
    eligible: true,
  });

  return {
    ok: true,
    bandIndex,
    percent,
    minBalance,
    maxBalance,
    projectedProfit,
    eligible: true,
  };
}

async function getPlanTotals(planId) {
  const plan = await getAiDailyPlanById(planId);
  if (!plan) return { error: 'Plan not found' };
  const rows = await listAiAllocationsByPlan(planId);
  const eligible = rows.filter((r) => r.eligible);
  const projected = eligible.reduce((s, r) => s + Number(r.projected_profit || 0), 0);
  const budgetUsd = Number(plan.budget_usd);
  return {
    ok: true,
    allocationCount: rows.length,
    eligibleCount: eligible.length,
    projectedPayoutUsd: Math.round(projected * 100) / 100,
    budgetUsd,
    overBudget: projected > budgetUsd,
    budgetRemainingUsd: Math.max(0, Math.round((budgetUsd - projected) * 100) / 100),
  };
}

async function finalizePlan(planId, { planSummary } = {}) {
  const plan = await getAiDailyPlanById(planId);
  if (!plan) return { error: 'Plan not found' };

  const updated = await recalcPlanProjectedTotals(planId);
  const projected = Number(updated.projected_payout_usd);
  const budgetUsd = Number(updated.budget_usd);
  const over = projected > budgetUsd;
  const status = over ? 'pending_approval' : 'active';

  const summary =
    planSummary ||
    `Projected payouts $${projected.toFixed(2)} vs budget $${budgetUsd.toFixed(2)} (${over ? 'needs approval' : 'active'}).`;

  await updateAiDailyPlan(planId, {
    status,
    planSummary: summary,
  });

  return {
    ok: true,
    status,
    projectedPayoutUsd: projected,
    budgetUsd,
    overBudget: over,
    planSummary: summary,
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'get_daily_context',
    description: 'Get today plan budget, caps, band tiers, and remaining budget.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_market_snapshot',
    description: 'Update market snapshot fields on the plan (regime, notes, indicators).',
    parameters: {
      type: 'object',
      properties: {
        regime: { type: 'string', enum: ['calm', 'normal', 'volatile', 'risk_off'] },
        notes: { type: 'string' },
        indicators: { type: 'object' },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'fetch_market_indicators',
    description: 'Fetch optional market data from Alpaca (SPY/QQQ) for regime hints.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_users_batch',
    description: 'List users with balances for allocation (paginated).',
    parameters: {
      type: 'object',
      properties: {
        offset: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'propose_user_allocation',
    description: 'Propose drop parameters for one user.',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        airfarmingBalance: { type: 'number' },
        bandIndex: { type: 'integer' },
        percent: { type: 'number' },
        minBalance: { type: 'number' },
        maxBalance: { type: 'number' },
        eligible: { type: 'boolean' },
      },
      required: ['userId'],
    },
  },
  {
    name: 'get_plan_totals',
    description: 'Sum projected payouts vs daily budget.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'finalize_plan',
    description: 'Finalize plan: active if under budget else pending_approval.',
    parameters: {
      type: 'object',
      properties: { planSummary: { type: 'string' } },
    },
  },
];

async function executeTool(name, args, ctx) {
  const planId = ctx.planId;
  switch (name) {
    case 'get_daily_context':
      return getDailyContext(ctx.planDate);
    case 'set_market_snapshot':
      return setMarketSnapshot(planId, args || {});
    case 'fetch_market_indicators':
      return fetchMarketIndicators();
    case 'list_users_batch':
      return listUsersBatch(args || {});
    case 'propose_user_allocation':
      return proposeUserAllocation(planId, args || {});
    case 'get_plan_totals':
      return getPlanTotals(planId);
    case 'finalize_plan':
      return finalizePlan(planId, args || {});
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  getDailyContext,
  setMarketSnapshot,
  fetchMarketIndicators,
  listUsersBatch,
  proposeUserAllocation,
  getPlanTotals,
  finalizePlan,
  inferBandFromBalance,
  pickBandConfig,
  estimateProjectedProfit,
  REGIME_MULTIPLIER,
};
