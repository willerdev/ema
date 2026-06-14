const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isVipAccrualDayYmd,
  addUtcWeekdays,
  countWeekdaysInclusive,
  weekdaysElapsedSinceStart,
  vipEarningsForWeekdays,
  vipInterestProjection,
} = require('../src/vipFarmerSchedule');

test('isVipAccrualDayYmd is true Mon–Fri UTC', () => {
  assert.equal(isVipAccrualDayYmd('2026-06-01'), true); // Monday
  assert.equal(isVipAccrualDayYmd('2026-06-05'), true); // Friday
  assert.equal(isVipAccrualDayYmd('2026-06-06'), false); // Saturday
  assert.equal(isVipAccrualDayYmd('2026-06-07'), false); // Sunday
});

test('addUtcWeekdays skips weekends', () => {
  const start = '2026-06-05T12:00:00.000Z'; // Friday
  const end = addUtcWeekdays(start, 1);
  assert.equal(new Date(end).getUTCDay(), 1); // next Monday
});

test('countWeekdaysInclusive counts from deposit day through today', () => {
  assert.equal(countWeekdaysInclusive('2026-06-02', '2026-06-02'), 1); // Mon only
  assert.equal(countWeekdaysInclusive('2026-06-05', '2026-06-08'), 2); // Fri + Mon
  assert.equal(countWeekdaysInclusive('2026-06-06', '2026-06-07'), 0); // Sat–Sun only
});

test('weekdaysElapsedSinceStart caps at lock days', () => {
  const count = weekdaysElapsedSinceStart('2026-01-01T10:00:00.000Z', '2026-06-01', 30);
  assert.equal(count, 30);
});

test('vipEarningsForWeekdays totals from weekday count', () => {
  const e = vipEarningsForWeekdays(1000, 3, 0.09, 0.03);
  assert.equal(e.weekdayCount, 3);
  assert.equal(e.totalGrossEarnedUsd, 270);
  assert.equal(e.totalCommissionUsd, 8.1);
  assert.equal(e.totalNetEarnedUsd, 261.9);
});
test('vipInterestProjection applies 3% platform fee to remaining net interest', () => {
  const p = vipInterestProjection(1000, 5, 30, 0.09, 0.03);
  assert.equal(p.dailyGrossUsd, 90);
  assert.equal(p.dailyPlatformFeeUsd, 2.7);
  assert.equal(p.dailyInterestUsd, 87.3);
  assert.equal(p.remainingAccrualDays, 25);
  assert.equal(p.remainingInterestUsd, 2182.5);
});
