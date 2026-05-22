const {
  listAiAllocationsByPlan,
  getUsersByIds,
  listAirfarmingDropsForUserIdsWeek,
  listAirfarmingWalletsByUserIds,
  listAirfarmingStatesByUserIds,
} = require('../db');
const { getEffectiveCaps, isEligible } = require('../airfarmingDrops');
const { pauseStatusFromState } = require('../airfarmingPause');

function mondayUtcYmdForDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const dow = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() - ((dow + 6) % 7));
  return utc.toISOString().slice(0, 10);
}

function utcYmdFromIso(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function potentialProfitNow(balance, percent, minBalance, maxBalance, maxProfit) {
  const b = Number(balance) || 0;
  if (!isEligible(b, minBalance, maxBalance)) return 0;
  const raw = (b * Number(percent)) / 100;
  return roundMoney(Math.min(raw, maxProfit));
}

async function fetchBalancesForUsers(userIds) {
  const afByUser = new Map();
  const stateByUser = new Map();
  const [wallets, states] = await Promise.all([
    listAirfarmingWalletsByUserIds(userIds),
    listAirfarmingStatesByUserIds(userIds),
  ]);
  for (const w of wallets) afByUser.set(w.user_id, Number(w.balance));
  for (const s of states) stateByUser.set(s.user_id, s);
  return { afByUser, stateByUser };
}

function deriveServiceStatus({ eligible, paused, dropsOnDate, linkedDrop, appliedAt }) {
  if (!eligible) return 'not_eligible';
  if (paused) return 'paused';
  const paidToday = dropsOnDate.filter((d) => d.status === 'paid' && d.paidOnDate);
  if (paidToday.length) {
    const profit = paidToday.reduce((s, d) => s + Number(d.profit_amount || 0), 0);
    return profit > 0 ? 'served' : 'missed';
  }
  const dueToday = dropsOnDate.filter((d) => d.dueOnDate && d.status === 'scheduled');
  if (dueToday.length) return 'due_today';
  if (linkedDrop?.status === 'scheduled') return 'scheduled';
  if (appliedAt || linkedDrop) return 'applied';
  return 'waiting';
}

/**
 * Enrich a plan with per-user drop counts, earnings, and served status for admin UI.
 */
async function buildAiPlanAdminDetail(plan, planDate) {
  if (!plan) {
    return { plan: null, planDate, allocations: [], summary: null };
  }

  const allocations = await listAiAllocationsByPlan(plan.id);
  const userIds = allocations.map((a) => a.user_id);
  const weekStart = mondayUtcYmdForDate(planDate);
  const caps = await getEffectiveCaps();

  const [users, drops, { afByUser, stateByUser }] = await Promise.all([
    getUsersByIds(userIds),
    listAirfarmingDropsForUserIdsWeek(userIds, weekStart),
    fetchBalancesForUsers(userIds),
  ]);

  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const dropsByUser = new Map();
  for (const d of drops) {
    const list = dropsByUser.get(d.user_id) || [];
    list.push({
      id: d.id,
      dropIndex: d.drop_index,
      status: d.status,
      dueAt: d.due_at,
      paidAt: d.paid_at,
      dueOnDate: utcYmdFromIso(d.due_at) === planDate,
      paidOnDate: utcYmdFromIso(d.paid_at) === planDate,
      percent: Number(d.percent),
      profitAmount: Number(d.profit_amount || 0),
      percentLocked: Boolean(d.percent_locked),
      minBalance: Number(d.min_balance),
      maxBalance: Number(d.max_balance),
    });
    dropsByUser.set(d.user_id, list);
  }

  let servedCount = 0;
  let appliedCount = 0;
  let eligibleCount = 0;
  let totalPotentialNow = 0;

  const enriched = [];
  for (const row of allocations) {
    const userId = row.user_id;
    const balance = afByUser.get(userId) ?? 0;
    const st = stateByUser.get(userId);
    const pause = pauseStatusFromState(st);
    const userDrops = dropsByUser.get(userId) || [];
    const onDate = userDrops.filter((d) => d.dueOnDate || d.paidOnDate);
    const paidOnDate = userDrops.filter((d) => d.paidOnDate);
    const dueOnDate = userDrops.filter((d) => d.dueOnDate && d.status === 'scheduled');
    const weekPaid = userDrops.filter((d) => d.status === 'paid').length;
    const weekScheduled = userDrops.filter((d) => d.status === 'scheduled').length;
    const weekMissed = userDrops.filter((d) => d.status === 'missed').length;
    const profitPaidOnDate = roundMoney(paidOnDate.reduce((s, d) => s + d.profitAmount, 0));

    let linkedDrop = null;
    if (row.drop_id) {
      linkedDrop = userDrops.find((d) => d.id === row.drop_id) || null;
    }

    const eligible = Boolean(row.eligible);
    const serviceStatus = deriveServiceStatus({
      eligible,
      paused: pause.dropsPausedNow,
      dropsOnDate: onDate,
      linkedDrop,
      appliedAt: row.applied_at,
    });

    if (eligible) eligibleCount += 1;
    if (serviceStatus === 'served') servedCount += 1;
    if (row.applied_at || row.drop_id) appliedCount += 1;

    const pct = row.percent != null ? Number(row.percent) : null;
    const minB = row.min_balance != null ? Number(row.min_balance) : null;
    const maxB = row.max_balance != null ? Number(row.max_balance) : null;
    const potentialNow =
      eligible && pct != null
        ? await potentialProfitNow(balance, pct, minB, maxB, caps.maxProfit)
        : 0;
    totalPotentialNow += potentialNow;

    const inWindow = eligible && minB != null && maxB != null && isEligible(balance, minB, maxB);

    enriched.push({
      id: row.id,
      userId,
      email: emailById.get(userId) || '—',
      bandIndex: row.band_index != null ? Number(row.band_index) : null,
      percent: pct,
      minBalance: minB,
      maxBalance: maxB,
      eligible,
      projectedProfit: roundMoney(row.projected_profit),
      potentialProfitNow: potentialNow,
      airfarmingBalance: roundMoney(balance),
      inBalanceWindow: inWindow,
      dailyDropSlots: eligible ? 1 : 0,
      dropsDueOnPlanDate: dueOnDate.length,
      dropsPaidOnPlanDate: paidOnDate.length,
      profitPaidOnPlanDate,
      weekDrops: { paid: weekPaid, scheduled: weekScheduled, missed: weekMissed, total: userDrops.length },
      appliedAt: row.applied_at || null,
      dropId: row.drop_id || null,
      linkedDropStatus: linkedDrop?.status || null,
      linkedDropDueAt: linkedDrop?.dueAt || null,
      serviceStatus,
      dropsPaused: pause.dropsPausedNow,
    });
  }

  enriched.sort((a, b) => b.projectedProfit - a.projectedProfit);

  const budgetUsd = Number(plan.budget_usd);
  const spent = Number(plan.budget_spent_usd);
  const projected = Number(plan.projected_payout_usd);

  return {
    planDate,
    plan: {
      id: plan.id,
      planDate: plan.plan_date,
      budgetUsd,
      budgetSpentUsd: spent,
      projectedPayoutUsd: projected,
      budgetRemainingUsd: roundMoney(Math.max(0, budgetUsd - spent)),
      marketSnapshot: plan.market_snapshot || {},
      status: plan.status,
      planSummary: plan.plan_summary || null,
      model: plan.model || null,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
    },
    summary: {
      allocationCount: enriched.length,
      eligibleCount,
      servedCount,
      appliedCount,
      waitingCount: enriched.filter((r) => r.serviceStatus === 'waiting' || r.serviceStatus === 'due_today').length,
      totalProjected: projected,
      totalPotentialNow: roundMoney(totalPotentialNow),
      budgetRemainingUsd: roundMoney(Math.max(0, budgetUsd - spent)),
    },
    allocations: enriched,
  };
}

module.exports = {
  buildAiPlanAdminDetail,
  mondayUtcYmdForDate,
  utcYmdFromIso,
};
