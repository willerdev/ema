const { getAirfarmingStateByUserId, getActiveGlobalDropPauses } = require('./db');

function parseMs(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function inPauseWindow(fromIso, untilIso, nowMs = Date.now()) {
  const from = parseMs(fromIso);
  const until = parseMs(untilIso);
  if (from == null && until == null) return false;
  if (from != null && nowMs < from) return false;
  if (until != null && nowMs >= until) return false;
  return true;
}

/** null/empty bands = all tiers; otherwise only listed band indexes. */
function bandMatches(pauseBands, bandIndex) {
  if (bandIndex == null || bandIndex === '') return true;
  const bands = Array.isArray(pauseBands) ? pauseBands : [];
  if (!bands.length) return true;
  return bands.map(Number).includes(Number(bandIndex));
}

function pauseStatusFromState(state, nowMs = Date.now()) {
  if (!state) {
    return {
      dropsPausedIndefinite: false,
      dropsPauseFrom: null,
      dropsPauseUntil: null,
      dropsPauseBandIndexes: [],
      dropsPausedNow: false,
      pauseMode: 'none',
    };
  }
  const bands = state.drops_pause_band_indexes || [];
  const inWindow = inPauseWindow(state.drops_pause_from, state.drops_pause_until, nowMs);
  const indefinite =
    Boolean(state.drops_paused) &&
    !state.drops_pause_from &&
    !state.drops_pause_until;
  const dropsPausedNow = indefinite || inWindow;
  let pauseMode = 'none';
  if (indefinite) pauseMode = 'indefinite';
  else if (inWindow) pauseMode = 'scheduled';

  return {
    dropsPausedIndefinite: indefinite,
    dropsPauseFrom: state.drops_pause_from || null,
    dropsPauseUntil: state.drops_pause_until || null,
    dropsPauseBandIndexes: bands.map(Number),
    dropsPausedNow,
    pauseMode,
  };
}

async function isDropPausedForUser(userId, bandIndex, now = new Date()) {
  const nowMs = now.getTime();
  const bi = bandIndex != null ? Number(bandIndex) : null;

  try {
    const globalPauses = await getActiveGlobalDropPauses(now);
    for (const g of globalPauses) {
      if (bandMatches(g.band_indexes, bi) && inPauseWindow(g.starts_at, g.ends_at, nowMs)) {
        return { paused: true, reason: 'global', globalPauseId: g.id };
      }
    }
  } catch {
    /* global pause table may be missing */
  }

  const state = await getAirfarmingStateByUserId(userId);
  if (!state) return { paused: false };

  const status = pauseStatusFromState(state, nowMs);
  if (!status.dropsPausedNow) return { paused: false };

  if (bandMatches(state.drops_pause_band_indexes, bi)) {
    return {
      paused: true,
      reason: status.pauseMode === 'indefinite' ? 'user_indefinite' : 'user_scheduled',
    };
  }

  return { paused: false };
}

/** @deprecated Use isDropPausedForUser; true if any drop tier is paused now. */
async function isAnyDropPausedForUser(userId, now = new Date()) {
  for (const band of [0, 1, 2, 3]) {
    const r = await isDropPausedForUser(userId, band, now);
    if (r.paused) return true;
  }
  const r = await isDropPausedForUser(userId, null, now);
  return r.paused;
}

function normalizeBandIndexes(raw) {
  if (raw == null) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 3))];
  return out.length ? out : null;
}

function parsePauseRange(body) {
  const pauseFrom = body.pauseFrom ?? body.dropsPauseFrom;
  const pauseUntil = body.pauseUntil ?? body.dropsPauseUntil;
  if (pauseFrom == null && pauseUntil == null) return { pauseFrom: null, pauseUntil: null };
  const fromMs = pauseFrom ? parseMs(pauseFrom) : null;
  const untilMs = pauseUntil ? parseMs(pauseUntil) : null;
  if (pauseFrom && fromMs == null) return { error: 'Invalid pauseFrom' };
  if (pauseUntil && untilMs == null) return { error: 'Invalid pauseUntil' };
  if (fromMs != null && untilMs != null && untilMs <= fromMs) {
    return { error: 'pauseUntil must be after pauseFrom' };
  }
  return {
    pauseFrom: pauseFrom ? new Date(fromMs).toISOString() : null,
    pauseUntil: pauseUntil ? new Date(untilMs).toISOString() : null,
  };
}

module.exports = {
  inPauseWindow,
  bandMatches,
  pauseStatusFromState,
  isDropPausedForUser,
  isAnyDropPausedForUser,
  normalizeBandIndexes,
  parsePauseRange,
};
