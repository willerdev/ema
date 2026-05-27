const crypto = require('crypto');
const {
  getScheduledAirfarmingDrop,
  listScheduledAirfarmingDropsForUser,
  getLastAirfarmingDropForWeek,
  insertAirfarmingDrop,
  updateAirfarmingDrop,
  ensureWalletForUser,
  setWalletBalance,
  insertAirfarmingTransfer,
  getCryptoBalancesByUserId,
  insertCryptoLedgerEntry,
  getAirfarmingWalletByUserId,
  upsertAirfarmingWalletRow,
  getAirfarmingDropBandByIndex,
  getAirfarmingStateByUserId,
  listAirfarmingDropBands,
  getAirfarmingPlatformSettings,
  getActiveAiAllocationForUserToday,
  getAiDailyPlanByDate,
  incrementAiDailyBudgetSpent,
  utcTodayYmd,
} = require('./db');
const { isDropPausedForUser } = require('./airfarmingPause');
const { debitUsdtFamily, totalUsdtFamilyAvailable } = require('./usdtBalances');
const { getWithdrawalTrustScoreForUser } = require('./services/withdrawalTrustScore');

const {
  ELIGIBILITY_SNAPSHOT_MS,
  AUTO_FUND_PREP_MS,
  AUTO_FUND_PREP_SEC,
  computeDropPhase,
  snapshotBalanceFromRow,
  isPercentLockedForDrop,
} = require('./airfarmingDropUtils');
const INTERVAL_HOURS = [2, 3, 5];
const MAX_UPCOMING_PROJECTED = 24;
const ELIGIBILITY_NOTICE =
  'Required balance ranges are fixed in advance. Your eligibility is based on your airfarming balance recorded 24 hours before each drop — not on funds added right before the drop window. This prevents gaming the schedule by depositing only when a range is shown.';
const MAX_PROFIT_PER_DROP = 5000;
/** Default maximum airfarming drop interest % (overridden by platform settings). */
const MAX_AIRFARMING_PERCENT = 57.9;

const BAND_BALANCE_DEFAULTS = {
  0: { min: 100, max: 145 },
  1: { min: 100, max: 112 },
  2: { min: 1000, max: 2400 },
  3: { min: 10000, max: 16000 },
};

let capsCache = null;
let capsCacheAt = 0;
let bandRangesCache = null;
let bandRangesCacheAt = 0;
const SETTINGS_CACHE_MS = 60_000;

async function getEffectiveCaps() {
  if (capsCache && Date.now() - capsCacheAt < SETTINGS_CACHE_MS) return capsCache;
  try {
    const s = await getAirfarmingPlatformSettings();
    capsCache = {
      maxPercent: Number(s?.max_percent) || MAX_AIRFARMING_PERCENT,
      maxProfit: Number(s?.max_profit_per_drop) || MAX_PROFIT_PER_DROP,
    };
  } catch {
    capsCache = { maxPercent: MAX_AIRFARMING_PERCENT, maxProfit: MAX_PROFIT_PER_DROP };
  }
  capsCacheAt = Date.now();
  return capsCache;
}

function clearAirfarmingSettingsCache() {
  capsCache = null;
  capsCacheAt = 0;
  bandRangesCache = null;
  bandRangesCacheAt = 0;
}

async function getBandRangeMap() {
  if (bandRangesCache && Date.now() - bandRangesCacheAt < SETTINGS_CACHE_MS) return bandRangesCache;
  const map = new Map(Object.entries(BAND_BALANCE_DEFAULTS).map(([k, v]) => [Number(k), { ...v }]));
  try {
    const bands = await listAirfarmingDropBands();
    for (const row of bands) {
      const idx = Number(row.band_index);
      const min = Number(row.min_balance);
      const max = Number(row.max_balance);
      if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
        map.set(idx, { min, max });
      }
    }
  } catch {
    /* bands table or columns may be missing until migration */
  }
  bandRangesCache = map;
  bandRangesCacheAt = Date.now();
  return map;
}

function clampAirfarmingPercent(value, maxPercent = MAX_AIRFARMING_PERCENT) {
  const n = Number(value);
  const cap = Number(maxPercent) || MAX_AIRFARMING_PERCENT;
  if (!Number.isFinite(n)) return 1;
  return Math.min(cap, Math.max(0.01, Math.round(n * 100) / 100));
}

function newId() {
  return crypto.randomUUID();
}

function hash32(input) {
  let h = 2166136261;
  const s = String(input);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function ymdToUtcMs(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function weekEndMs(weekStartYmd) {
  return ymdToUtcMs(weekStartYmd) + 7 * 24 * 3600 * 1000;
}

function pickIntervalHours(userId, weekStart, dropIndex) {
  const h = hash32(`${userId}:${weekStart}:${dropIndex}:interval`);
  return INTERVAL_HOURS[h % INTERVAL_HOURS.length];
}

/** Infer balance tier from scheduled min/max (for legacy rows missing band_index). */
function inferBandIndex(minBalance, maxBalance) {
  const min = Number(minBalance);
  const max = Number(maxBalance);
  if (min >= 10000) return 3;
  if (min >= 1000) return 2;
  if (min >= 100 && max <= 112) return 1;
  if (min >= 100) return 0;
  return 0;
}

/** Seeded balance window for a drop slot; ranges from airfarming_drop_bands (admin-editable). */
async function generateDropSpec(userId, weekStart, dropIndex) {
  const h = hash32(`${userId}:${weekStart}:${dropIndex}:dropSpec`);
  const h2 = hash32(`${userId}:${weekStart}:${dropIndex}:range`);
  const fallbackPercent = 1 + (h % 100);
  const caps = await getEffectiveCaps();

  const band = h2 % 4;
  const rangeMap = await getBandRangeMap();
  const cfg = rangeMap.get(band) || BAND_BALANCE_DEFAULTS[band] || BAND_BALANCE_DEFAULTS[0];
  const bandMin = cfg.min;
  const bandMax = cfg.max;
  let minBalance = bandMin;
  let maxBalance = bandMax;
  if (bandMax > bandMin) {
    const spanCents = Math.floor((bandMax - bandMin) * 100);
    const offset = spanCents > 0 ? (h % (spanCents + 1)) / 100 : 0;
    maxBalance = Number((bandMin + offset).toFixed(2));
  }

  return {
    band_index: band,
    percent: clampAirfarmingPercent(fallbackPercent, caps.maxPercent),
    min_balance: Number(minBalance.toFixed(2)),
    max_balance: Number(maxBalance.toFixed(2)),
  };
}

async function resolvePercentForBand(bandIndex, fallbackPercent) {
  const caps = await getEffectiveCaps();
  try {
    const row = await getAirfarmingDropBandByIndex(bandIndex);
    if (row && row.percent != null) return clampAirfarmingPercent(row.percent, caps.maxPercent);
  } catch {
    /* bands table may be missing until migration runs */
  }
  return clampAirfarmingPercent(fallbackPercent, caps.maxPercent);
}

/** Apply DB tier percent to a scheduled drop (skipped when percent_locked). */
async function syncScheduledDropPercent(drop) {
  if (!drop || drop.status !== 'scheduled') return drop;
  if (drop.percent_locked) return drop;

  const bandIndex =
    drop.band_index != null ? Number(drop.band_index) : inferBandIndex(drop.min_balance, drop.max_balance);
  const percent = await resolvePercentForBand(bandIndex, drop.percent);
  const patch = {};
  if (drop.band_index == null) patch.band_index = bandIndex;
  if (Math.abs(percent - Number(drop.percent)) >= 0.005) patch.percent = percent;
  if (Object.keys(patch).length === 0) return drop;
  return updateAirfarmingDrop(drop.id, patch);
}

function isEligible(balance, minBalance, maxBalance) {
  const b = Number(balance);
  return b >= Number(minBalance) && b <= Number(maxBalance);
}

async function computeProfit(balance, percent) {
  const caps = await getEffectiveCaps();
  const raw = (Number(balance) * Number(percent)) / 100;
  const capped = Math.min(raw, caps.maxProfit);
  return Math.round(capped * 100) / 100;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function captureEligibilitySnapshotIfDue(userId, drop) {
  if (!drop || drop.status !== 'scheduled') return drop;
  if (drop.eligibility_snapshot_at != null) return drop;

  const dueMs = new Date(drop.due_at).getTime();
  const nowMs = Date.now();
  if (nowMs < dueMs - ELIGIBILITY_SNAPSHOT_MS) return drop;

  const af = await getAirfarmingWalletByUserId(userId);
  const balance = roundMoney(Number.parseFloat(String(af?.balance ?? 0)) || 0);
  const now = new Date().toISOString();

  try {
    return await updateAirfarmingDrop(drop.id, {
      eligibility_snapshot_at: now,
      eligibility_snapshot_balance: balance,
    });
  } catch (e) {
    if (String(e?.message || '').includes('eligibility_snapshot')) return drop;
    throw e;
  }
}

async function captureSnapshotsForScheduled(userId, drops) {
  const out = [];
  for (const d of drops || []) {
    out.push(await captureEligibilitySnapshotIfDue(userId, d));
  }
  return out;
}

/**
 * @param {object} row - DB row or projected preview
 * @param {{ userId?: string, airfarmingBalance?: number, nowMs?: number, isProjected?: boolean }} ctx
 */
async function toPublicUpcomingDrop(row, ctx = {}) {
  if (!row) return null;
  const nowMs = ctx.nowMs ?? Date.now();
  const dueMs = new Date(row.due_at).getTime();
  const secondsRemaining = Math.max(0, Math.floor((dueMs - nowMs) / 1000));
  const percentLocked = isPercentLockedForDrop(row, nowMs);
  const isProjected = Boolean(ctx.isProjected);
  const snapshotBal = snapshotBalanceFromRow(row);
  const liveBal = Number(ctx.airfarmingBalance) || 0;

  const dropPhase = isProjected ? 'waiting' : computeDropPhase(row, nowMs);
  const autoFundPrepared = Boolean(row.auto_fund_prepared_at);

  const base = {
    id: row.id ? String(row.id) : null,
    previewKey: row.previewKey || (row.id ? String(row.id) : `${ctx.userId}:${row.week_start}:${row.drop_index}`),
    dropIndex: Number(row.drop_index),
    dueAt: row.due_at,
    secondsRemaining,
    minBalance: Number(row.min_balance),
    maxBalance: Number(row.max_balance),
    percentLocked,
    isProjected,
    hasSnapshot: snapshotBal != null,
    eligibilitySnapshotBalance: snapshotBal,
    dropPhase,
    autoFundPrepared,
    autoFundInProgress: dropPhase === 'preparing' && !autoFundPrepared,
  };

  const synced = row.id ? await syncScheduledDropPercent(row) : row;
  const percent = Number(synced?.percent ?? row.percent);
  const eligibilityBal = snapshotBal != null ? snapshotBal : liveBal;
  const eligibleNow = isEligible(eligibilityBal, synced.min_balance, synced.max_balance);

  // Keep profit estimates for when the drop is live (optional UI), but always expose percent + eligibility.
  let projectedProfitBase = 0;
  let projectedProfit = null;
  let dropPotentialMultiplier = 1;
  if (percentLocked && eligibleNow && Number.isFinite(percent)) {
    projectedProfitBase = await computeProfit(eligibilityBal, percent);
    projectedProfit = projectedProfitBase;
    if (ctx.userId) {
      const trust = await getWithdrawalTrustScoreForUser(ctx.userId);
      dropPotentialMultiplier = trust.dropPotentialMultiplier;
      projectedProfit = roundMoney(projectedProfitBase * dropPotentialMultiplier);
    }
  }

  return {
    ...base,
    percent: Number.isFinite(percent) ? percent : null,
    eligibleNow,
    projectedProfit,
    projectedProfitBase: projectedProfitBase || 0,
    dropPotentialMultiplier,
  };
}

async function toPublicNextDrop(row, airfarmingBalance, userId, nowMs = Date.now()) {
  return toPublicUpcomingDrop(row, { userId, airfarmingBalance, nowMs, isProjected: false });
}

async function projectUpcomingDropsForWeek(userId, weekStart, scheduledRows) {
  const weekEnd = weekEndMs(weekStart);
  const projected = [];
  const pauseCheck = await isDropPausedForUser(userId, 0);
  if (pauseCheck.paused) return projected;

  let last = scheduledRows.length
    ? scheduledRows[scheduledRows.length - 1]
    : await getLastAirfarmingDropForWeek(userId, weekStart);

  let dropIndex = last ? Number(last.drop_index) + 1 : 0;
  let dueMs = last
    ? Math.max(Date.now(), new Date(last.due_at).getTime()) + pickIntervalHours(userId, weekStart, dropIndex) * 3600 * 1000
    : Date.now() + pickIntervalHours(userId, weekStart, dropIndex) * 3600 * 1000;

  const existingDue = new Set((scheduledRows || []).map((r) => r.due_at));

  for (let guard = 0; guard < MAX_UPCOMING_PROJECTED && dueMs < weekEnd; guard += 1) {
    const spec = await generateDropSpec(userId, weekStart, dropIndex);
    const dueAt = new Date(dueMs).toISOString();
    if (!existingDue.has(dueAt)) {
      projected.push({
        previewKey: `${userId}:${weekStart}:${dropIndex}`,
        user_id: userId,
        week_start: weekStart,
        drop_index: dropIndex,
        due_at: dueAt,
        min_balance: spec.min_balance,
        max_balance: spec.max_balance,
        percent: spec.percent,
        band_index: spec.band_index,
        status: 'scheduled',
      });
      existingDue.add(dueAt);
    }
    dropIndex += 1;
    dueMs += pickIntervalHours(userId, weekStart, dropIndex) * 3600 * 1000;
  }

  return projected;
}

async function buildUpcomingDropsQueue(userId, weekStart, airfarmingBalance, options = {}) {
  const nowMs = Date.now();
  let scheduled = await listScheduledAirfarmingDropsForUser(userId, weekStart);
  if (!scheduled.length) {
    const one = await ensureNextScheduledDrop(userId, weekStart);
    if (one) scheduled = [one];
  }

  scheduled = await Promise.all(scheduled.map((d) => syncScheduledDropPercent(d)));
  scheduled = await captureSnapshotsForScheduled(userId, scheduled);

  if (options.autoFundEnabled) {
    const prepared = [];
    for (const d of scheduled) {
      prepared.push(await prepareDropAutoFundIfDue(userId, d, options));
    }
    scheduled = prepared;
  }

  const projected = await projectUpcomingDropsForWeek(userId, weekStart, scheduled);
  const allRows = [...scheduled, ...projected].sort(
    (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
  );

  const ctx = { userId, airfarmingBalance, nowMs };
  const upcomingDrops = [];
  for (const row of allRows) {
    const isProjected = !row.id;
    const pub = await toPublicUpcomingDrop(row, { ...ctx, isProjected });
    if (pub) upcomingDrops.push(pub);
  }

  return { upcomingDrops, eligibilityNotice: ELIGIBILITY_NOTICE };
}

function dropToHistoryRow(row) {
  return {
    id: String(row.id),
    percent: Number(row.percent),
    minBalance: Number(row.min_balance),
    maxBalance: Number(row.max_balance),
    status: row.status,
    eligibleBalance: row.eligible_balance != null ? Number(row.eligible_balance) : null,
    profitAmount: Number(row.profit_amount || 0),
    autoFundedCash: Number(row.auto_funded_cash || 0),
    autoFundedCrypto: Number(row.auto_funded_crypto || 0),
    createdAt: row.paid_at || row.due_at,
    source: 'drop',
  };
}

async function ensureNextScheduledDrop(userId, weekStart) {
  const existing = await getScheduledAirfarmingDrop(userId, weekStart);
  if (existing) return existing;

  const weekEnd = weekEndMs(weekStart);
  const now = Date.now();
  if (now >= weekEnd) return null;

  const last = await getLastAirfarmingDropForWeek(userId, weekStart);
  const dropIndex = last ? Number(last.drop_index) + 1 : 0;
  const intervalH = pickIntervalHours(userId, weekStart, dropIndex);
  let spec = await generateDropSpec(userId, weekStart, dropIndex);
  let percentLocked = false;
  const { plan: aiPlan, allocation: aiAlloc } = await getActiveAiAllocationForUserToday(userId);
  if (aiPlan && aiAlloc?.eligible && aiAlloc.percent != null && aiAlloc.min_balance != null) {
    spec = {
      band_index: Number(aiAlloc.band_index ?? 0),
      percent: Number(aiAlloc.percent),
      min_balance: Number(aiAlloc.min_balance),
      max_balance: Number(aiAlloc.max_balance),
    };
    percentLocked = true;
  }

  const pauseCheck = await isDropPausedForUser(userId, spec.band_index);
  if (pauseCheck.paused) return null;

  const caps = await getEffectiveCaps();
  let percent = percentLocked
    ? clampAirfarmingPercent(spec.percent, caps.maxPercent)
    : await resolvePercentForBand(spec.band_index, spec.percent);

  let dueMs;
  if (!last) {
    dueMs = now + intervalH * 3600 * 1000;
  } else {
    const baseMs = Math.max(now, new Date(last.due_at).getTime());
    dueMs = baseMs + intervalH * 3600 * 1000;
  }
  if (dueMs >= weekEnd) return null;

  return insertAirfarmingDrop({
    id: newId(),
    user_id: userId,
    week_start: weekStart,
    drop_index: dropIndex,
    due_at: new Date(dueMs).toISOString(),
    band_index: spec.band_index,
    percent,
    min_balance: spec.min_balance,
    max_balance: spec.max_balance,
    percent_locked: percentLocked,
    status: 'scheduled',
    profit_amount: 0,
  });
}

async function autoAdjustToRange(userId, drop, currentBalance) {
  const minBalance = Number(drop.min_balance);
  const maxBalance = Number(drop.max_balance);
  const balance = Number(currentBalance) || 0;
  const now = new Date().toISOString();

  if (balance > maxBalance) {
    const excess = roundMoney(balance - maxBalance);
    if (excess <= 0) return { balance, cash: 0, crypto: 0, returnedCash: 0 };

    const wallet = await ensureWalletForUser(userId);
    const cashAvailable = Math.max(0, Number.parseFloat(String(wallet.balance ?? 0)) || 0);
    await setWalletBalance(userId, roundMoney(cashAvailable + excess));
    await upsertAirfarmingWalletRow({
      user_id: userId,
      balance: roundMoney(balance - excess),
      updated_at: now,
    });
    await insertAirfarmingTransfer({
      id: newId(),
      user_id: userId,
      direction: 'to_cash',
      amount: excess,
      created_at: now,
    });
    return { balance: roundMoney(balance - excess), cash: 0, crypto: 0, returnedCash: excess };
  }

  if (balance >= minBalance) {
    return { balance, cash: 0, crypto: 0, returnedCash: 0 };
  }

  const needed = roundMoney(minBalance - balance);
  if (needed <= 0) return { balance, cash: 0, crypto: 0, returnedCash: 0 };

  const [wallet, cryptoBalances] = await Promise.all([
    ensureWalletForUser(userId),
    getCryptoBalancesByUserId(userId),
  ]);
  const cashAvailable = Math.max(0, Number.parseFloat(String(wallet.balance ?? 0)) || 0);
  const cryptoAvailable = totalUsdtFamilyAvailable(cryptoBalances);
  const totalAvailable = roundMoney(cashAvailable + cryptoAvailable);
  if (totalAvailable < needed) {
    return { balance, cash: 0, crypto: 0, returnedCash: 0 };
  }

  const cashTake = roundMoney(Math.min(cashAvailable, needed));
  const cryptoTake = roundMoney(needed - cashTake);

  if (cashTake > 0) {
    await setWalletBalance(userId, roundMoney(cashAvailable - cashTake));
    await insertAirfarmingTransfer({
      id: newId(),
      user_id: userId,
      direction: 'to_airfarming',
      amount: cashTake,
      created_at: now,
    });
  }

  if (cryptoTake > 0) {
    await debitUsdtFamily({
      userId,
      amount: cryptoTake,
      source: 'airfarming_auto_fund',
      sourceId: drop.id,
      insertCryptoLedgerEntry,
      getCryptoBalancesByUserId,
      newId,
    });
    await insertAirfarmingTransfer({
      id: newId(),
      user_id: userId,
      direction: 'to_airfarming',
      amount: cryptoTake,
      created_at: now,
    });
  }

  const nextBalance = roundMoney(balance + cashTake + cryptoTake);
  await upsertAirfarmingWalletRow({
    user_id: userId,
    balance: nextBalance,
    updated_at: now,
  });

  return { balance: nextBalance, cash: cashTake, crypto: cryptoTake, returnedCash: 0 };
}

async function prepareDropAutoFundIfDue(userId, drop, options = {}) {
  if (!options.autoFundEnabled || !drop?.id || drop.status !== 'scheduled') return drop;
  if (drop.auto_fund_prepared_at) return drop;

  const nowMs = Date.now();
  const dueMs = new Date(drop.due_at).getTime();
  const prepStart = dueMs - AUTO_FUND_PREP_MS;
  if (nowMs < prepStart || nowMs >= dueMs) return drop;

  const af = await getAirfarmingWalletByUserId(userId);
  let liveBalance = Number.parseFloat(String(af?.balance ?? 0)) || 0;
  const minBalance = Number(drop.min_balance);
  const maxBalance = Number(drop.max_balance);
  const now = new Date().toISOString();

  let autoFunded = { cash: 0, crypto: 0, returnedCash: 0 };
  if (liveBalance < minBalance || liveBalance > maxBalance) {
    const adjusted = await autoAdjustToRange(userId, drop, liveBalance);
    autoFunded = adjusted;
    liveBalance = adjusted.balance;
  }

  try {
    return await updateAirfarmingDrop(drop.id, {
      auto_fund_prepared_at: now,
      auto_funded_cash: autoFunded.cash,
      auto_funded_crypto: autoFunded.crypto,
    });
  } catch (e) {
    if (String(e?.message || '').includes('auto_fund_prepared')) return drop;
    throw e;
  }
}

function settledDropToPublic(row) {
  if (!row) return null;
  return {
    ...dropToHistoryRow(row),
    dropPhase: 'rewarding',
    dueAt: row.due_at,
    secondsRemaining: 0,
  };
}

async function settleDrop(userId, drop, options = {}) {
  drop = await syncScheduledDropPercent(drop);
  drop = await captureEligibilitySnapshotIfDue(userId, drop);

  const af = await getAirfarmingWalletByUserId(userId);
  let liveBalance = Number.parseFloat(String(af?.balance ?? 0)) || 0;
  const now = new Date().toISOString();
  let autoFunded = { cash: 0, crypto: 0 };

  const minBalance = Number(drop.min_balance);
  const maxBalance = Number(drop.max_balance);
  if (options.autoFundEnabled && !drop.auto_fund_prepared_at) {
    if (liveBalance < minBalance || liveBalance > maxBalance) {
      const adjusted = await autoAdjustToRange(userId, drop, liveBalance);
      autoFunded = { cash: adjusted.cash, crypto: adjusted.crypto, returnedCash: adjusted.returnedCash };
      liveBalance = adjusted.balance;
    }
  }

  const snapshotBal = snapshotBalanceFromRow(drop);
  const eligibilityBalance = snapshotBal != null ? snapshotBal : liveBalance;
  const eligible = isEligible(eligibilityBalance, drop.min_balance, drop.max_balance);

  if (eligible) {
    const planDate = utcTodayYmd();
    const dailyPlan = await getAiDailyPlanByDate(planDate);
    if (dailyPlan && dailyPlan.status !== 'active') {
      return updateAirfarmingDrop(drop.id, {
        status: 'missed',
        eligible_balance: eligibilityBalance,
        profit_amount: 0,
        auto_funded_cash: autoFunded.cash,
        auto_funded_crypto: autoFunded.crypto,
        paid_at: now,
      });
    }

    let profit = await computeProfit(eligibilityBalance, drop.percent);
    const trust = await getWithdrawalTrustScoreForUser(userId);
    profit = roundMoney(profit * trust.dropPotentialMultiplier);
    if (dailyPlan?.status === 'active') {
      const budgetUsd = Number(dailyPlan.budget_usd);
      const spent = Number(dailyPlan.budget_spent_usd);
      const remaining = Math.max(0, roundMoney(budgetUsd - spent));
      if (remaining <= 0) {
        return updateAirfarmingDrop(drop.id, {
          status: 'missed',
          eligible_balance: eligibilityBalance,
          profit_amount: 0,
          auto_funded_cash: autoFunded.cash,
          auto_funded_crypto: autoFunded.crypto,
          paid_at: now,
        });
      }
      if (profit > remaining) {
        console.warn('[airfarming] capping drop profit to daily budget remaining', {
          userId,
          dropId: drop.id,
          profit,
          remaining,
        });
        profit = remaining;
      }
    }

    const nextBal = roundMoney(liveBalance + profit);
    await upsertAirfarmingWalletRow({
      user_id: userId,
      balance: nextBal,
      updated_at: now,
    });
    const paid = await updateAirfarmingDrop(drop.id, {
      status: 'paid',
      eligible_balance: eligibilityBalance,
      profit_amount: profit,
      auto_funded_cash: autoFunded.cash,
      auto_funded_crypto: autoFunded.crypto,
      paid_at: now,
    });
    if (dailyPlan?.status === 'active' && profit > 0) {
      await incrementAiDailyBudgetSpent(planDate, profit);
    }
    return paid;
  }

  return updateAirfarmingDrop(drop.id, {
    status: 'missed',
    eligible_balance: eligibilityBalance,
    profit_amount: 0,
    auto_funded_cash: autoFunded.cash,
    auto_funded_crypto: autoFunded.crypto,
    paid_at: now,
  });
}

/** Process all overdue scheduled drops; schedule the next one after each settlement. */
async function processDueDrops(userId, weekStart, options = {}) {
  let processed = 0;
  let lastSettled = null;
  const guardMax = 20;
  while (processed < guardMax) {
    let scheduled = await getScheduledAirfarmingDrop(userId, weekStart);
    if (!scheduled) {
      scheduled = await ensureNextScheduledDrop(userId, weekStart);
      if (!scheduled) break;
    }
    const dueMs = new Date(scheduled.due_at).getTime();
    if (Date.now() < dueMs) break;

    scheduled = await syncScheduledDropPercent(scheduled);
    scheduled = await captureEligibilitySnapshotIfDue(userId, scheduled);
    const bandIndex =
      scheduled.band_index != null
        ? Number(scheduled.band_index)
        : inferBandIndex(scheduled.min_balance, scheduled.max_balance);
    const pauseCheck = await isDropPausedForUser(userId, bandIndex);
    if (pauseCheck.paused) break;

    lastSettled = await settleDrop(userId, scheduled, options);
    processed += 1;
    await ensureNextScheduledDrop(userId, weekStart);
  }
  return { processed, lastSettled };
}

const LAST_SETTLED_UI_MS = 45_000;

async function buildDropStatus(userId, weekStart, airfarmingBalance, options = {}) {
  const { lastSettled } = await processDueDrops(userId, weekStart, options);
  const af = await getAirfarmingWalletByUserId(userId);
  const latestBalance = Number.parseFloat(String(af?.balance ?? airfarmingBalance ?? 0)) || 0;
  const { upcomingDrops, eligibilityNotice } = await buildUpcomingDropsQueue(
    userId,
    weekStart,
    latestBalance,
    options
  );
  const nextDrop = upcomingDrops[0] || null;
  let lastSettledDrop = null;
  if (lastSettled?.paid_at) {
    const paidMs = new Date(lastSettled.paid_at).getTime();
    if (Date.now() - paidMs < LAST_SETTLED_UI_MS) {
      lastSettledDrop = settledDropToPublic(lastSettled);
    }
  }
  const phase = nextDrop?.dropPhase;
  const pollIntervalSec =
    phase === 'preparing' || phase === 'processing' || lastSettledDrop ? 5 : 45;
  return { nextDrop, upcomingDrops, eligibilityNotice, lastSettledDrop, pollIntervalSec };
}

module.exports = {
  generateDropSpec,
  inferBandIndex,
  resolvePercentForBand,
  syncScheduledDropPercent,
  isEligible,
  computeProfit,
  autoAdjustToRange,
  toPublicNextDrop,
  toPublicUpcomingDrop,
  buildUpcomingDropsQueue,
  captureEligibilitySnapshotIfDue,
  projectUpcomingDropsForWeek,
  ELIGIBILITY_NOTICE,
  ensureNextScheduledDrop,
  prepareDropAutoFundIfDue,
  settleDrop,
  processDueDrops,
  buildDropStatus,
  AUTO_FUND_PREP_SEC,
  dropToHistoryRow,
  MAX_PROFIT_PER_DROP,
  MAX_AIRFARMING_PERCENT,
  clampAirfarmingPercent,
  clearAirfarmingSettingsCache,
  getEffectiveCaps,
};
