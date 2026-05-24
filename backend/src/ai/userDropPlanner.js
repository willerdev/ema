const { listAirfarmingDropBands } = require('../db');
const {
  clampAirfarmingPercent,
  getEffectiveCaps,
  generateDropSpec,
  isEligible,
} = require('../airfarmingDrops');
const { hasLlmCredentials, aiModel, aiProvider, providerConfig, apiKeyForProvider } = require('./llmClient');

const INTERVAL_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 18, 24];

function roundUsd(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function estimateProfit(balance, percent, maxProfit) {
  const raw = (Number(balance) * Number(percent)) / 100;
  return roundUsd(Math.min(raw, maxProfit));
}

function profitWeights(dropCount) {
  const weights = [];
  for (let i = 0; i < dropCount; i += 1) {
    weights.push(0.7 + (i % 3) * 0.15 + ((i * 17) % 7) * 0.05);
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

function distributeProfits(dropCount, targetTotalUsd) {
  const target = roundUsd(targetTotalUsd);
  if (target <= 0 || dropCount < 1) return [];
  const weights = profitWeights(dropCount);
  const shares = weights.map((w) => roundUsd(target * w));
  const sum = roundUsd(shares.reduce((s, n) => s + n, 0));
  const diff = roundUsd(target - sum);
  if (Math.abs(diff) >= 0.01) {
    shares[shares.length - 1] = roundUsd(shares[shares.length - 1] + diff);
  }
  return shares;
}

async function bandWindowForSlot(userId, weekStart, slot, balance) {
  const spec = await generateDropSpec(userId, weekStart, slot);
  let bandIndex = Number(spec.band_index);
  let minBalance = Number(spec.min_balance);
  let maxBalance = Number(spec.max_balance);

  try {
    const bands = await listAirfarmingDropBands();
    const row = bands.find((b) => Number(b.band_index) === bandIndex);
    if (row) {
      minBalance = Number(row.min_balance);
      maxBalance = Number(row.max_balance);
      if (maxBalance > minBalance) {
        const spanCents = Math.floor((maxBalance - minBalance) * 100);
        const h = Math.abs(slot * 7919 + bandIndex * 997) % (spanCents + 1);
        maxBalance = Number((minBalance + h / 100).toFixed(2));
      }
    }
  } catch {
    /* bands optional */
  }

  return { bandIndex, minBalance, maxBalance };
}

function balanceRefForDrop(userBalance, minBalance, maxBalance) {
  const bal = Number(userBalance) || 0;
  if (isEligible(bal, minBalance, maxBalance)) return bal;
  if (bal < minBalance) return minBalance;
  if (bal > maxBalance) return maxBalance;
  return bal > 0 ? bal : (minBalance + maxBalance) / 2;
}

function percentFromProfit(profitUsd, balanceRef, maxPercent) {
  if (balanceRef <= 0) return 1;
  return clampAirfarmingPercent((profitUsd / balanceRef) * 100, maxPercent);
}

async function buildItemFromShare(ctx, slot, profitShare, caps, overrides = {}) {
  const win = await bandWindowForSlot(ctx.userId, ctx.weekStart, slot, ctx.balance);
  const bandIndex =
    overrides.bandIndex != null ? Number(overrides.bandIndex) : win.bandIndex;
  const minBalance = overrides.minBalance != null ? Number(overrides.minBalance) : win.minBalance;
  const maxBalance = overrides.maxBalance != null ? Number(overrides.maxBalance) : win.maxBalance;

  let intervalHours = Number(overrides.intervalHours);
  if (!Number.isFinite(intervalHours) || intervalHours < 1) {
    intervalHours = INTERVAL_OPTIONS[slot % INTERVAL_OPTIONS.length];
  }
  intervalHours = Math.min(72, Math.max(1, Math.round(intervalHours)));

  const balanceRef = balanceRefForDrop(ctx.balance, minBalance, maxBalance);
  let plannedProfit = roundUsd(overrides.projectedProfitUsd ?? profitShare);
  plannedProfit = Math.min(plannedProfit, caps.maxProfit);

  const percent =
    overrides.percent != null
      ? clampAirfarmingPercent(overrides.percent, caps.maxPercent)
      : percentFromProfit(plannedProfit, balanceRef, caps.maxPercent);

  return {
    slot,
    percent,
    intervalHours,
    projectedProfit: plannedProfit,
    bandIndex,
    minBalance,
    maxBalance,
  };
}

async function buildVariedItems(ctx, rawItems, caps) {
  const profitShares = distributeProfits(ctx.dropCount, ctx.targetTotalUsd);
  const items = [];

  for (let i = 0; i < ctx.dropCount; i += 1) {
    const src = rawItems[i] || {};
    items.push(
      await buildItemFromShare(ctx, i, profitShares[i], caps, {
        bandIndex: src.bandIndex ?? src.band_index,
        minBalance: src.minBalance ?? src.min_balance,
        maxBalance: src.maxBalance ?? src.max_balance,
        intervalHours: src.intervalHours ?? src.interval_hours,
        percent: src.percent ?? src.percentage,
        projectedProfitUsd: src.projectedProfitUsd ?? src.projected_profit_usd,
      })
    );
  }

  return rebalanceProfitsToTarget(items, ctx.targetTotalUsd, caps, ctx.balance);
}

function rebalanceProfitsToTarget(items, targetTotalUsd, caps, userBalance) {
  const target = roundUsd(targetTotalUsd);
  if (!items.length || target <= 0) return items;

  let sum = roundUsd(items.reduce((s, it) => s + it.projectedProfit, 0));
  if (Math.abs(sum - target) < 0.02) return items;

  const ratio = target / (sum || 1);
  const adjusted = items.map((it) => {
    const planned = roundUsd(Math.min(it.projectedProfit * ratio, caps.maxProfit));
    const balanceRef = balanceRefForDrop(userBalance, it.minBalance, it.maxBalance);
    const percent = percentFromProfit(planned, balanceRef, caps.maxPercent);
    return { ...it, projectedProfit: planned, percent };
  });

  sum = roundUsd(adjusted.reduce((s, it) => s + it.projectedProfit, 0));
  const diff = roundUsd(target - sum);
  if (Math.abs(diff) >= 0.01 && adjusted.length) {
    const last = adjusted[adjusted.length - 1];
    const newProfit = roundUsd(Math.min(last.projectedProfit + diff, caps.maxProfit));
    const balanceRef = balanceRefForDrop(userBalance, last.minBalance, last.maxBalance);
    adjusted[adjusted.length - 1] = {
      ...last,
      projectedProfit: newProfit,
      percent: percentFromProfit(newProfit, balanceRef, caps.maxPercent),
    };
  }

  return adjusted;
}

async function runDeterministicUserDropPlan(ctx) {
  const caps = await getEffectiveCaps();
  const rawItems = [];
  for (let i = 0; i < ctx.dropCount; i += 1) {
    rawItems.push({ intervalHours: INTERVAL_OPTIONS[(i * 2) % INTERVAL_OPTIONS.length] });
  }
  const items = await buildVariedItems(ctx, rawItems, caps);
  const totalProjected = roundUsd(items.reduce((s, it) => s + it.projectedProfit, 0));
  const tierSummary = [...new Set(items.map((it) => it.bandIndex))].join(', ');
  return {
    plannerMode: 'deterministic',
    planSummary:
      `${ctx.dropCount} drops · ${totalProjected} USD projected · tiers ${tierSummary} · ` +
      `${items.map((it) => it.intervalHours + 'h').join(', ')} spacing`,
    items,
    totalProjectedUsd: totalProjected,
  };
}

function extractJsonObject(text) {
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI response did not contain JSON');
  return JSON.parse(body.slice(start, end + 1));
}

async function callJsonChat(system, userPayload) {
  const cfg = providerConfig();
  const key = apiKeyForProvider(aiProvider());
  const root = String(cfg.baseUrl()).replace(/\/$/, '');
  const url = root.endsWith('/v1') ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: aiModel(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      temperature: 0.35,
      response_format: { type: 'json_object' },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || res.statusText);
  }
  const content = data.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}

const SYSTEM_PROMPT = `You plan upcoming airfarming drops for one user.
Return JSON only:
{
  "summary": string,
  "items": [
    {
      "percent": number,
      "intervalHours": number,
      "bandIndex": 0-3,
      "projectedProfitUsd": number,
      "minBalance": number (optional),
      "maxBalance": number (optional)
    }
  ]
}
Rules:
- items.length must equal dropCount
- VARY bandIndex across drops when it fits the plan (0=low, 1=mid-low, 2=mid-high, 3=high balance tiers)
- VARY projectedProfitUsd across drops; they must sum to approximately targetTotalUsd (within 2%)
- Each projectedProfitUsd must be <= maxProfitPerDrop
- percent should match projectedProfitUsd relative to referenceBalance and the tier window
- intervalHours: hours until the NEXT drop (first = hours from now); use different values per drop (2–24h)
- Do NOT use identical projectedProfitUsd or bandIndex for every drop unless dropCount is 1`;

async function runAiUserDropPlan(ctx) {
  const caps = await getEffectiveCaps();

  if (!hasLlmCredentials()) {
    return runDeterministicUserDropPlan(ctx);
  }

  try {
    const bands = await listAirfarmingDropBands().catch(() => []);
    const parsed = await callJsonChat(SYSTEM_PROMPT, {
      dropCount: ctx.dropCount,
      targetTotalUsd: ctx.targetTotalUsd,
      referenceBalance: ctx.balance,
      maxPercent: caps.maxPercent,
      maxProfitPerDrop: caps.maxProfit,
      weekStart: ctx.weekStart,
      tiers: bands.map((b) => ({
        bandIndex: Number(b.band_index),
        minBalance: Number(b.min_balance),
        maxBalance: Number(b.max_balance),
        defaultPercent: Number(b.percent),
      })),
    });

    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items = await buildVariedItems(ctx, rawItems, caps);
    const totalProjected = roundUsd(items.reduce((s, it) => s + it.projectedProfit, 0));

    return {
      plannerMode: 'llm',
      planSummary:
        parsed.summary ||
        `AI plan: ${ctx.dropCount} drops, ${totalProjected} USD across mixed tiers.`,
      items,
      totalProjectedUsd: totalProjected,
    };
  } catch (e) {
    console.warn('[user-drop-planner] LLM failed, using deterministic fallback:', e.message);
    return runDeterministicUserDropPlan(ctx);
  }
}

async function suggestUserDropPlan({ userId, weekStart, dropCount, targetTotalUsd, balance }) {
  const n = Number(dropCount);
  const target = roundUsd(targetTotalUsd);
  const bal = roundUsd(balance);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    return { ok: false, error: 'dropCount must be 1–12' };
  }
  if (target < 0) return { ok: false, error: 'targetTotalUsd must be non-negative' };
  if (bal <= 0) return { ok: false, error: 'User needs a positive airfarming balance' };

  const ctx = { userId, weekStart, dropCount: n, targetTotalUsd: target, balance: bal };
  const result = await runAiUserDropPlan(ctx);
  return { ok: true, ...result };
}

module.exports = {
  suggestUserDropPlan,
  runDeterministicUserDropPlan,
  estimateProfit,
  roundUsd,
};
