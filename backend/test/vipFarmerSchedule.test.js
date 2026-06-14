const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isVipAccrualDayYmd,
  addUtcWeekdays,
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

test('vipInterestProjection applies 3% platform fee to remaining net interest', () => {
  const p = vipInterestProjection(1000, 5, 30, 0.09, 0.03);
  assert.equal(p.dailyGrossUsd, 90);
  assert.equal(p.dailyPlatformFeeUsd, 2.7);
  assert.equal(p.dailyInterestUsd, 87.3);
  assert.equal(p.remainingAccrualDays, 25);
  assert.equal(p.remainingInterestUsd, 2182.5);
});
