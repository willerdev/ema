const {
  listPaidAirfarmingDropsForUserBetween,
  listContractAccrualsForUserBetween,
  listContractAccrualsForUserOnDate,
  listVipAccrualsForUserBetween,
  listVipAccrualsForUserOnDate,
} = require('./db');

function roundUsd(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function dayKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function monthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  const startYmd = start.toISOString().slice(0, 10);
  const endYmd = end.toISOString().slice(0, 10);
  return { startYmd, endYmd, startIso: start.toISOString(), endIso: end.toISOString(), daysInMonth: end.getUTCDate() };
}

function emptyBreakdown() {
  return { airfarming: 0, vip: 0, contracts: 0 };
}

function buildMonthDaysMap(year, month) {
  const { daysInMonth } = monthBounds(year, month);
  const days = {};
  for (let d = 1; d <= daysInMonth; d += 1) {
    const ymd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days[ymd] = {
      date: ymd,
      totalUsd: 0,
      hasProfit: false,
      breakdown: emptyBreakdown(),
    };
  }
  return days;
}

function addToDay(days, ymd, source, amount) {
  if (!ymd || !days[ymd]) return;
  const n = roundUsd(amount);
  if (n <= 0) return;
  days[ymd].breakdown[source] = roundUsd(days[ymd].breakdown[source] + n);
  days[ymd].totalUsd = roundUsd(days[ymd].totalUsd + n);
  days[ymd].hasProfit = days[ymd].totalUsd > 0;
}

async function getJournalMonth(userId, year, month) {
  const { startYmd, endYmd, startIso, endIso } = monthBounds(year, month);
  const days = buildMonthDaysMap(year, month);

  const [drops, contracts, vipRows] = await Promise.all([
    listPaidAirfarmingDropsForUserBetween(userId, startIso, endIso),
    listContractAccrualsForUserBetween(userId, startYmd, endYmd),
    listVipAccrualsForUserBetween(userId, startYmd, endYmd),
  ]);

  for (const d of drops) {
    addToDay(days, dayKey(d.paid_at), 'airfarming', d.profit_amount);
  }
  for (const c of contracts) {
    addToDay(days, String(c.accrual_date).slice(0, 10), 'contracts', c.amount);
  }
  for (const v of vipRows) {
    addToDay(days, String(v.accrual_date).slice(0, 10), 'vip', v.amount);
  }

  const dayList = Object.values(days);
  const monthTotal = roundUsd(dayList.reduce((s, d) => s + d.totalUsd, 0));
  const profitDays = dayList.filter((d) => d.hasProfit).length;
  let bestDay = null;
  for (const d of dayList) {
    if (!d.hasProfit) continue;
    if (!bestDay || d.totalUsd > bestDay.totalUsd) bestDay = { date: d.date, totalUsd: d.totalUsd };
  }

  return {
    year: Number(year),
    month: Number(month),
    monthTotalUsd: monthTotal,
    profitDays,
    bestDay,
    days,
  };
}

async function getJournalDay(userId, dateYmd) {
  const date = String(dateYmd).slice(0, 10);
  const startIso = `${date}T00:00:00.000Z`;
  const endIso = `${date}T23:59:59.999Z`;

  const [drops, contracts, vipRows] = await Promise.all([
    listPaidAirfarmingDropsForUserBetween(userId, startIso, endIso),
    listContractAccrualsForUserOnDate(userId, date),
    listVipAccrualsForUserOnDate(userId, date),
  ]);

  const items = [];
  for (const d of drops) {
    const amt = roundUsd(d.profit_amount);
    if (amt <= 0) continue;
    items.push({
      id: d.id,
      source: 'airfarming',
      label: `Airfarming drop (${Number(d.percent)}%)`,
      amountUsd: amt,
      at: d.paid_at,
    });
  }
  for (const c of contracts) {
    items.push({
      id: c.id,
      source: 'contracts',
      label: 'Contracts daily accrual',
      amountUsd: roundUsd(c.amount),
      at: c.created_at || `${date}T12:00:00.000Z`,
    });
  }
  for (const v of vipRows) {
    items.push({
      id: v.id,
      source: 'vip',
      label: 'VIP Farmers daily payout',
      amountUsd: roundUsd(v.amount),
      at: v.created_at || `${date}T12:00:00.000Z`,
    });
  }

  items.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const breakdown = emptyBreakdown();
  for (const item of items) {
    breakdown[item.source] = roundUsd(breakdown[item.source] + item.amountUsd);
  }
  const totalUsd = roundUsd(items.reduce((s, i) => s + i.amountUsd, 0));

  return {
    date,
    totalUsd,
    hasProfit: totalUsd > 0,
    breakdown,
    items,
  };
}

module.exports = { getJournalMonth, getJournalDay, monthBounds };
