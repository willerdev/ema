/**
 * Pure-logic checks for airfarming drop rules (no DB).
 * Run: node --test test/airfarmingDrops.logic.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

function hash32(input) {
  let h = 2166136261;
  const s = String(input);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function generateDropSpec(userId, weekStart, dropIndex) {
  const h = hash32(`${userId}:${weekStart}:${dropIndex}:dropSpec`);
  const h2 = hash32(`${userId}:${weekStart}:${dropIndex}:range`);
  const percent = 1 + (h % 100);
  const band = h2 % 4;
  let minBalance;
  let maxBalance;
  if (band === 0) {
    minBalance = 100;
    maxBalance = 100 + 5 + (h % 41);
  } else if (band === 1) {
    minBalance = 100;
    maxBalance = 100 + 4 + (h % 9);
  } else if (band === 2) {
    minBalance = 1000;
    maxBalance = 1000 + 400 + (h % 1001);
  } else {
    minBalance = 10000;
    maxBalance = 10000 + 5000 + (h % 6001);
  }
  return { percent, min_balance: minBalance, max_balance: maxBalance };
}

function isEligible(balance, minBalance, maxBalance) {
  const b = Number(balance);
  return b >= Number(minBalance) && b <= Number(maxBalance);
}

function computeProfit(balance, percent) {
  const raw = (Number(balance) * Number(percent)) / 100;
  return Math.min(raw, 5000);
}

test('drop spec is stable for same seed inputs', () => {
  const a = generateDropSpec('user-a', '2026-05-19', 0);
  const b = generateDropSpec('user-a', '2026-05-19', 0);
  assert.deepEqual(a, b);
});

test('eligibility requires exact range', () => {
  const spec = { min_balance: 100, max_balance: 145 };
  assert.equal(isEligible(100, spec.min_balance, spec.max_balance), true);
  assert.equal(isEligible(145, spec.min_balance, spec.max_balance), true);
  assert.equal(isEligible(146, spec.min_balance, spec.max_balance), false);
  assert.equal(isEligible(99, spec.min_balance, spec.max_balance), false);
});

test('profit is percent of balance capped at 5000', () => {
  assert.equal(computeProfit(1000, 10), 100);
  assert.equal(computeProfit(100000, 100), 5000);
});
