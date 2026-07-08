const test = require('node:test');
const assert = require('node:assert/strict');
const {
  roundUsd,
  computeReinvestQuote,
  computeExitQuote,
  dailyAccrualAmounts,
  availableRevenue,
  VIP_DAILY_RATE,
  PLATFORM_FEE_VIP_RATE,
} = require('../src/vipFarmerConstants');

test('daily accrual: 9% gross with 3% platform fee → 8.73% net', () => {
  const { gross, platformFee, net } = dailyAccrualAmounts(5000);
  assert.equal(gross, 450);
  assert.equal(platformFee, 13.5);
  assert.equal(net, 436.5);
  assert.equal(roundUsd(VIP_DAILY_RATE * (1 - PLATFORM_FEE_VIP_RATE) * 100), 8.73);
});

test('available revenue = total accrued minus withdrawn', () => {
  assert.equal(availableRevenue({ total_accrued_usd: 100, revenue_withdrawn_usd: 30 }), 70);
  assert.equal(availableRevenue({ total_accrued_usd: 50, revenue_withdrawn_usd: 80 }), 0);
});

test('reinvest example: $8,889.90 available → net $6,222.93 after $2,666.97 commission', () => {
  const quote = computeReinvestQuote(null, 8889.9);
  assert.equal(quote.grossRevenue, 8889.9);
  assert.equal(quote.commissionUsd, 2666.97);
  assert.equal(quote.reinvestedUsd, 6222.93);
});

test('exit quote applies gas on full_stop even at 0% revenue', () => {
  const quote = computeExitQuote({
    principalUsd: 5000,
    totalAccruedUsd: 1000,
    revenueWithdrawnUsd: 0,
    daysAccrued: 5,
    startedAt: '2026-01-01T00:00:00.000Z',
    mode: 'full_stop',
    revenuePercent: 0,
    asOfYmd: '2026-01-10',
  });
  assert.equal(quote.revenueSelectedUsd, 0);
  assert.ok(quote.gasFeesUsd > 0);
  assert.equal(quote.principalReturnUsd, 5000);
});

test('exit extra credit when principal > 4900 and working days > 22', () => {
  const quote = computeExitQuote({
    principalUsd: 5000,
    totalAccruedUsd: 2000,
    revenueWithdrawnUsd: 0,
    daysAccrued: 23,
    startedAt: '2026-01-01T00:00:00.000Z',
    mode: 'full_stop',
    revenuePercent: 100,
    asOfYmd: '2026-02-15',
  });
  assert.equal(quote.investmentExtraCreditUsd, 1000);
  assert.equal(quote.penaltyUsd, 0);
});
