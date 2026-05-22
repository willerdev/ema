const {
  utcTodayYmd,
  getAiDailyPlanByDate,
  listAiAllocationsByPlan,
  getScheduledAirfarmingDrop,
  updateAirfarmingDrop,
  upsertAiUserAllocation,
} = require('../db');
const { isDropPausedForUser } = require('../airfarmingPause');

function mondayUtcYmd(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const offset = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Apply active plan allocations to existing scheduled airfarming drops.
 * New drops pick up AI params in ensureNextScheduledDrop when users open the app.
 */
async function applyActivePlan(planDate = utcTodayYmd()) {
  const plan = await getAiDailyPlanByDate(planDate);
  if (!plan || plan.status !== 'active') {
    return { ok: false, error: 'No active plan for date', planDate };
  }

  const weekStart = mondayUtcYmd();
  const rows = await listAiAllocationsByPlan(plan.id);
  const now = new Date().toISOString();
  let applied = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.eligible) {
      skipped += 1;
      continue;
    }

    const bandIndex = row.band_index != null ? Number(row.band_index) : 0;
    const pause = await isDropPausedForUser(row.user_id, bandIndex);
    if (pause.paused) {
      skipped += 1;
      continue;
    }

    const scheduled = await getScheduledAirfarmingDrop(row.user_id, weekStart);
    if (!scheduled) {
      skipped += 1;
      continue;
    }

    await updateAirfarmingDrop(scheduled.id, {
      band_index: bandIndex,
      percent: Number(row.percent),
      min_balance: Number(row.min_balance),
      max_balance: Number(row.max_balance),
      percent_locked: true,
    });

    await upsertAiUserAllocation({
      planId: plan.id,
      userId: row.user_id,
      dropId: scheduled.id,
      appliedAt: now,
    });
    applied += 1;
  }

  return { ok: true, planDate, planId: plan.id, applied, skipped, total: rows.length };
}

module.exports = { applyActivePlan, mondayUtcYmd };
