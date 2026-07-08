/** VIP Farmers accrue interest Mon–Fri UTC only. */

function isWeekdayUtc(date) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

function isVipAccrualDayYmd(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return isWeekdayUtc(new Date(Date.UTC(y, m - 1, d)));
}

function addUtcWeekdays(startIso, weekdayCount) {
  const target = Math.max(0, Number(weekdayCount) || 0);
  const d = new Date(startIso);
  let added = 0;
  while (added < target) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWeekdayUtc(d)) added += 1;
  }
  return d.toISOString();
}

function utcYmdFromIso(iso) {
  return String(iso || '').slice(0, 10);
}

function nextUtcYmd(ymd) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function countWeekdaysInclusive(startYmd, endYmd) {
  const start = String(startYmd || '').slice(0, 10);
  const end = String(endYmd || '').slice(0, 10);
  if (!start || !end || end < start) return 0;
  let count = 0;
  let cursor = start;
  while (cursor <= end) {
    if (isVipAccrualDayYmd(cursor)) count += 1;
    cursor = nextUtcYmd(cursor);
  }
  return count;
}

function calendarDaysSinceStart(startedAt, asOfYmd) {
  const startYmd = utcYmdFromIso(startedAt);
  const endYmd = String(asOfYmd || '').slice(0, 10);
  if (!startYmd || !endYmd || endYmd < startYmd) return 0;
  const startMs = Date.parse(`${startYmd}T00:00:00.000Z`);
  const endMs = Date.parse(`${endYmd}T00:00:00.000Z`);
  return Math.floor((endMs - startMs) / 86400000) + 1;
}

function weekdaysElapsedSinceStart(startedAt, asOfYmd, lockDays = 22) {
  const startYmd = utcYmdFromIso(startedAt);
  const endYmd = String(asOfYmd || '').slice(0, 10);
  if (!startYmd || !endYmd || endYmd < startYmd) return 0;
  return Math.min(Math.max(0, Number(lockDays) || 0), countWeekdaysInclusive(startYmd, endYmd));
}

function vipEarningsForWeekdays(principalUsd, weekdayCount, dailyRate, commissionRate = 0) {
  const principal = Math.round(Number(principalUsd || 0) * 100) / 100;
  const count = Math.max(0, Number(weekdayCount) || 0);
  const rate = Number(dailyRate) || 0;
  const feeRate = Math.max(0, Number(commissionRate) || 0);
  const dailyGrossUsd = Math.round(principal * rate * 100) / 100;
  const dailyPlatformFeeUsd = Math.round(dailyGrossUsd * feeRate * 100) / 100;
  const dailyInterestUsd = Math.round((dailyGrossUsd - dailyPlatformFeeUsd) * 100) / 100;
  const totalGrossEarnedUsd = Math.round(dailyGrossUsd * count * 100) / 100;
  const totalCommissionUsd = Math.round(dailyPlatformFeeUsd * count * 100) / 100;
  const totalNetEarnedUsd = Math.round(dailyInterestUsd * count * 100) / 100;
  return {
    weekdayCount: count,
    dailyGrossUsd,
    dailyPlatformFeeUsd,
    dailyInterestUsd,
    totalGrossEarnedUsd,
    totalCommissionUsd,
    totalNetEarnedUsd,
  };
}

function buildVipLockProjection({
  startedAt,
  maturesAt,
  principalUsd,
  lockDays = 22,
  dailyRate = 0.09,
  commissionRate = 0,
  asOfYmd,
}) {
  const startYmd = utcYmdFromIso(startedAt);
  const today = String(asOfYmd || '').slice(0, 10);
  const weekdaysElapsed = weekdaysElapsedSinceStart(startedAt, today, lockDays);
  const weekdaysRemaining = Math.max(0, lockDays - weekdaysElapsed);
  const earned = vipEarningsForWeekdays(principalUsd, weekdaysElapsed, dailyRate, commissionRate);
  const remaining = vipEarningsForWeekdays(principalUsd, weekdaysRemaining, dailyRate, commissionRate);
  const fullLock = vipEarningsForWeekdays(principalUsd, lockDays, dailyRate, commissionRate);
  return {
    startedAt,
    startedAtYmd: startYmd,
    maturesAt,
    maturesAtYmd: utcYmdFromIso(maturesAt),
    asOfDate: today,
    lockWeekdays: lockDays,
    weekdaysElapsed,
    weekdaysRemaining,
    progressPercent: lockDays > 0 ? Math.round((weekdaysElapsed / lockDays) * 1000) / 10 : 0,
    dailyGrossUsd: earned.dailyGrossUsd,
    dailyCommissionUsd: earned.dailyPlatformFeeUsd,
    dailyNetUsd: earned.dailyInterestUsd,
    earnedSoFarGrossUsd: earned.totalGrossEarnedUsd,
    earnedSoFarCommissionUsd: earned.totalCommissionUsd,
    earnedSoFarNetUsd: earned.totalNetEarnedUsd,
    remainingGrossUsd: remaining.totalGrossEarnedUsd,
    remainingCommissionUsd: remaining.totalCommissionUsd,
    remainingNetUsd: remaining.totalNetEarnedUsd,
    fullLockGrossUsd: fullLock.totalGrossEarnedUsd,
    fullLockCommissionUsd: fullLock.totalCommissionUsd,
    fullLockNetUsd: fullLock.totalNetEarnedUsd,
  };
}

function vipInterestProjection(principalUsd, daysAccrued, lockDays, dailyRate, commissionRate = 0) {
  const principal = Math.round(Number(principalUsd || 0) * 100) / 100;
  const rate = Number(dailyRate) || 0;
  const feeRate = Math.max(0, Number(commissionRate) || 0);
  const lock = Math.max(0, Number(lockDays) || 0);
  const accrued = Math.max(0, Number(daysAccrued) || 0);
  const dailyGrossUsd = Math.round(principal * rate * 100) / 100;
  const dailyPlatformFeeUsd = Math.round(dailyGrossUsd * feeRate * 100) / 100;
  const dailyInterestUsd = Math.round((dailyGrossUsd - dailyPlatformFeeUsd) * 100) / 100;
  const remainingAccrualDays = Math.max(0, lock - accrued);
  const remainingInterestUsd = Math.round(dailyInterestUsd * remainingAccrualDays * 100) / 100;
  return {
    dailyGrossUsd,
    dailyPlatformFeeUsd,
    dailyInterestUsd,
    remainingAccrualDays,
    remainingInterestUsd,
  };
}

module.exports = {
  isWeekdayUtc,
  isVipAccrualDayYmd,
  addUtcWeekdays,
  utcYmdFromIso,
  nextUtcYmd,
  countWeekdaysInclusive,
  calendarDaysSinceStart,
  weekdaysElapsedSinceStart,
  vipEarningsForWeekdays,
  buildVipLockProjection,
  vipInterestProjection,
};
