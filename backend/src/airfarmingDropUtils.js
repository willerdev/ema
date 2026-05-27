const ELIGIBILITY_SNAPSHOT_MS = 24 * 3600 * 1000;
const AUTO_FUND_PREP_MS = 5 * 60 * 1000;
const AUTO_FUND_PREP_SEC = Math.floor(AUTO_FUND_PREP_MS / 1000);

function computeDropPhase(row, nowMs = Date.now()) {
  if (!row?.due_at) return 'idle';
  if (row.status && row.status !== 'scheduled') return 'idle';
  const dueMs = new Date(row.due_at).getTime();
  const secondsRemaining = Math.max(0, Math.floor((dueMs - nowMs) / 1000));
  if (nowMs >= dueMs) return 'processing';
  if (secondsRemaining > 0 && secondsRemaining <= AUTO_FUND_PREP_SEC) return 'preparing';
  if (secondsRemaining > AUTO_FUND_PREP_SEC) return 'waiting';
  return 'idle';
}

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
  AUTO_FUND_PREP_MS,
  AUTO_FUND_PREP_SEC,
  computeDropPhase,
  snapshotBalanceFromRow,
  isPercentLockedForDrop,
  isSnapshotCaptureDue,
};
