const ELIGIBILITY_SNAPSHOT_MS = 24 * 3600 * 1000;

function snapshotBalanceFromRow(row) {
  if (row?.eligibility_snapshot_balance == null) return null;
  const n = Number(row.eligibility_snapshot_balance);
  return Number.isFinite(n) ? n : null;
}

function isPercentLockedForDrop(row, nowMs = Date.now()) {
  if (!row?.due_at) return false;
  return nowMs >= new Date(row.due_at).getTime();
}

function isSnapshotCaptureDue(row, nowMs = Date.now()) {
  if (!row?.due_at || row.eligibility_snapshot_at != null) return false;
  const dueMs = new Date(row.due_at).getTime();
  return nowMs >= dueMs - ELIGIBILITY_SNAPSHOT_MS;
}

module.exports = {
  ELIGIBILITY_SNAPSHOT_MS,
  snapshotBalanceFromRow,
  isPercentLockedForDrop,
  isSnapshotCaptureDue,
};
