const { computeWithdrawalTrustScore } = require('./withdrawalTrustScoreCompute');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const noWithdraw = {
  withdrawCount7d: 0,
  withdrawCount30d: 0,
  withdrawCountLifetime: 0,
  withdrawAmount7d: 0,
  withdrawAmount90d: 0,
  depositAmount90d: 5000,
  illegalCount90d: 0,
};

const heavy = {
  withdrawCount7d: 5,
  withdrawCount30d: 8,
  withdrawCountLifetime: 20,
  withdrawAmount7d: 1200,
  withdrawAmount90d: 8000,
  depositAmount90d: 2000,
  illegalCount90d: 0,
};

const illegal = {
  ...heavy,
  illegalCount90d: 3,
};

const excellent = computeWithdrawalTrustScore(noWithdraw);
assert(excellent.score === 100, `expected 100 got ${excellent.score}`);
assert(excellent.dropPotentialMultiplier === 1, 'multiplier should be 1');

const poor = computeWithdrawalTrustScore(heavy);
assert(poor.score < 70, `heavy withdrawer should score under 70, got ${poor.score}`);

const flagged = computeWithdrawalTrustScore(illegal);
assert(flagged.score < poor.score, 'illegal withdrawals should score lower than heavy alone');

console.log('withdrawalTrustScore tests passed');
