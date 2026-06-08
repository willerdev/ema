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
  vipInterestProjection,
};
