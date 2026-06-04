const test = require('node:test');
const assert = require('node:assert/strict');
const { getMinDeposit, validateBotType, validateTradingPassword } = require('../src/services/liveTradingValidation');
const { computeLiveBalances, snapshotFresh } = require('../src/services/mt5BridgeService');

test('getMinDeposit by bot type', () => {
  assert.equal(getMinDeposit('synthetix_ea'), 1000);
  assert.equal(getMinDeposit('quantix_ea'), 200);
});

test('validateBotType rejects unknown', () => {
  assert.throws(() => validateBotType('unknown'), (e) => e.statusCode === 400);
  assert.equal(validateBotType('quantix_ea'), 'quantix_ea');
});

test('validateTradingPassword rules', () => {
  assert.throws(() => validateTradingPassword('short'), (e) => e.statusCode === 400);
  assert.equal(validateTradingPassword('Abcd1234'), 'Abcd1234');
});

test('computeLiveBalances uses snapshot profit when fresh', () => {
  const now = new Date().toISOString();
  const account = {
    ea_snapshot_at: now,
    ea_positions_snapshot: [{ id: '1', symbol: 'EURUSD', side: 'buy', volume: 1, profit: 12.5 }],
  };
  const wallet = { balance: 1000 };
  const b = computeLiveBalances(account, wallet);
  assert.equal(b.depositedBalance, 1000);
  assert.equal(b.openProfit, 12.5);
  assert.equal(b.displayBalance, 1012.5);
  assert.equal(b.snapshotFresh, true);
});

test('computeLiveBalances ignores profit when stale', () => {
  const old = new Date(Date.now() - 300000).toISOString();
  const account = {
    ea_snapshot_at: old,
    ea_positions_snapshot: [{ id: '1', profit: 50 }],
  };
  assert.equal(snapshotFresh(account), false);
  const b = computeLiveBalances(account, { balance: 500 });
  assert.equal(b.openProfit, 0);
  assert.equal(b.displayBalance, 500);
});
