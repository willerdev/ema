const { isPercentLockedForDrop, snapshotBalanceFromRow } = require('./airfarmingDropUtils');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const futureDue = new Date(Date.now() + 3600_000).toISOString();
const pastDue = new Date(Date.now() - 1000).toISOString();

assert(!isPercentLockedForDrop({ due_at: futureDue }), 'future drop percent not locked');
assert(isPercentLockedForDrop({ due_at: pastDue }), 'past due drop percent locked');

assert(snapshotBalanceFromRow({ eligibility_snapshot_balance: 120 }) === 120, 'snapshot parse');
assert(snapshotBalanceFromRow({}) === null, 'no snapshot');

console.log('airfarmingUpcomingDrops tests passed');
