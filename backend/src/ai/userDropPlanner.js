const crypto = require('crypto');
const { listAirfarmingDropBands } = require('../db');
const {
  clampAirfarmingPercent,
  getEffectiveCaps,
  generateDropSpec,
} = require('../airfarmingDrops');
const { hasLlmCredentials, aiModel, aiProvider, providerConfig, apiKeyForProvider } = require('./llmClient');

const INTERVAL_OPTIONS = [2, 3, 4, 5, 6, 8, 12, 24];

function roundUsd(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function estimateProfit(balance, percent, maxProfit) {
  const raw = (Number(balance) * Number(percent)) / 100;
  return roundUsd(Math.min(raw, maxProfit));
}

function inferBandFromBalance(balance) {
  const b = Number(balance) || 0;
  if (b >= 10000) return 3;
  if (b >= 1000) return 2;
  if (b >= 100) return 1;
  return 0;
}

async function bandWindowForUser(userId, weekStart, bandIndex, balance) {
  const spec = await generateDropSpec(userId, weekStart, 0);
  const idx = bandIndex != null ? Number(bandIndex) : inferBandFromBalance(balance);
  try {
    const bands = await listAirfarmingDropBands();
    const row = bands.find((b) => Number(b.band_index) === idx);
    if (row) {
      return {
        bandIndex: idx,
        minBalance: Number(row.min_balance),
        maxBalance: Number(row.max_balance),
      };
    }
  } catch {
    /* bands table optional */
  }
  return {
    bandIndex: idx,
    minBalance: Number(spec.min_balance),
    maxBalance: Number(spec.max_balance),
  };
}

function normalizeItems(rawItems, dropCount, balance, caps) {
  const items = [];
  for (let i = 0; i < dropCount; i += 1) {
    const src = rawItems[i] || {};
    const percent = clampAirfarmingPercent(src.percent ?? src.percentage ?? 10, caps.maxPercent);
    let intervalHours = Number(src.intervalHours ?? src.interval_hours ?? src.durationHours);
    if (!Number.isFinite(intervalHours) || intervalHours < 1) {
      intervalHours = INTERVAL_OPTIONS[i % INTERVAL_OPTIONS.length];
    }
    intervalHours = Math.min(72, Math.max(1, Math.round(intervalHours)));
    items.push({
      slot: i,
      percent,
      intervalHours,
      projectedProfit: estimateProfit(balance, percent, caps.maxProfit),
      bandIndex: src.bandIndex != null ? Number(src.bandIndex) : null,
      minBalance: src.minBalance != null ? Number(src.minBalance) : null,
      maxBalance: src.maxBalance != null ? Number(src.maxBalance) : null,
    });
  }
  return items;
}

function scaleItemsToTarget(items, balance, targetTotalUsd, caps) {
  const target = roundUsd(targetTotalUsd);
  if (target <= 0 || !items.length) return items;

  let sum = roundUsd(items.reduce((s, it) => s + it.projectedProfit, 0));
  if (sum <= 0) return items;

  const ratio = target / sum;
  const scaled = items.map((it) => {
    let pct = clampAirfarmingPercent(it.percent * ratio, caps.maxPercent);
    let profit = estimateProfit(balance, pct, caps.maxProfit);
    return { ...it, percent: pct, projectedProfit: profit };
  });

  sum = roundUsd(scaled.reduce((s, it) => s + it.projectedProfit, 0));
  const diff = roundUsd(target - sum);
  if (Math.abs(diff) >= 0.01 && scaled.length) {
    const last = scaled[scaled.length - 1];
    const adjustedPct = clampAirfarmingPercent(
      last.percent + (balance > 0 ? (diff / balance) * 100 : 0),
      caps.maxPercent
    );
    scaled[scaled.length - 1] = {
      ...last,
      percent: adjustedPct,
      projectedProfit: estimateProfit(balance, adjustedPct, caps.maxProfit),
    };
  }
  return scaled;
}

async function runDeterministicUserDropPlan({ userId, weekStart, dropCount, targetTotalUsd, balance }) {
  const caps = await getEffectiveCaps();
  const bandIndex = inferBandFromBalance(balance);
  const avgPct =
    balance > 0
      ? clampAirfarmingPercent((targetTotalUsd / balance) * (100 / dropCount), caps.maxPercent)
      : 10;

  const weights = [];
  let wSum = 0;
  for (let i = 0; i < dropCount; i += 1) {
    const w = 0.85 + (i % 3) * 0.1;
    weights.push(w);
    wSum += w;
  }

  const rawItems = weights.map((w, i) => ({
    percent: clampAirfarmingPercent((avgPct * w * dropCount) / wSum, caps.maxPercent),
    intervalHours: INTERVAL_OPTIONS[i % INTERVAL_OPTIONS.length],
    bandIndex,
  }));

  let items = normalizeItems(rawItems, dropCount, balance, caps);
  items = scaleItemsToTarget(items, balance, targetTotalUsd, caps);

  const totalProjected = roundUsd(items.reduce((s, it) => s + it.projectedProfit, 0));
  return {
    plannerMode: 'deterministic',
    planSummary: `${dropCount} drops targeting ${totalProjected} USD (deterministic split).`,
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
      temperature: 0.2,
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
Return JSON only: { "summary": string, "items": [ { "percent": number, "intervalHours": number } ] }.
Rules:
- items.length must equal dropCount
- percent between 0.01 and maxPercent; vary percents naturally across drops
- intervalHours is hours until the NEXT drop (first item is hours from now); use 2–24h typically
- projected profits should approximate targetTotalUsd on referenceBalance (platform caps profit per drop)
- respect maxProfitPerDrop when reasoning about feasibility`;

async function runAiUserDropPlan(ctx) {
  const caps = await getEffectiveCaps();
  const payload = {
    dropCount: ctx.dropCount,
    targetTotalUsd: ctx.targetTotalUsd,
    referenceBalance: ctx.balance,
    maxPercent: caps.maxPercent,
    maxProfitPerDrop: caps.maxProfit,
    weekStart: ctx.weekStart,
  };

  if (!hasLlmCredentials()) {
    return runDeterministicUserDropPlan(ctx);
  }

  try {
    const parsed = await callJsonChat(SYSTEM_PROMPT, payload);
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    let items = normalizeItems(rawItems, ctx.dropCount, ctx.balance, caps);
    items = scaleItemsToTarget(items, ctx.balance, ctx.targetTotalUsd, caps);

    for (let i = 0; i < items.length; i += 1) {
      const win = await bandWindowForUser(ctx.userId, ctx.weekStart, items[i].bandIndex, ctx.balance);
      items[i].bandIndex = win.bandIndex;
      items[i].minBalance = win.minBalance;
      items[i].maxBalance = win.maxBalance;
    }

    const totalProjected = roundUsd(items.reduce((s, it) => s + it.projectedProfit, 0));
    return {
      plannerMode: 'llm',
      planSummary: parsed.summary || `AI plan: ${ctx.dropCount} drops ≈ ${totalProjected} USD.`,
      items,
      totalProjectedUsd: totalProjected,
    };
  } catch (e) {
    console.warn('[user-drop-planner] LLM failed, using deterministic fallback:', e.message);
    return runDeterministicUserDropPlan(ctx);
  }
}

async function enrichItemsWithBands(userId, weekStart, items, balance) {
  const out = [];
  for (const it of items) {
    const win = await bandWindowForUser(userId, weekStart, it.bandIndex, balance);
    out.push({
      ...it,
      bandIndex: win.bandIndex,
      minBalance: win.minBalance,
      maxBalance: win.maxBalance,
    });
  }
  return out;
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
  result.items = await enrichItemsWithBands(userId, weekStart, result.items, bal);
  result.totalProjectedUsd = roundUsd(result.items.reduce((s, it) => s + it.projectedProfit, 0));
  return { ok: true, ...result };
}

module.exports = {
  suggestUserDropPlan,
  runDeterministicUserDropPlan,
  estimateProfit,
  roundUsd,
};
