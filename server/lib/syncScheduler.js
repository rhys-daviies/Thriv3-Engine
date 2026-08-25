/**
 * Runs the edge sync unprompted.
 *
 * `npm run sync` and the button behind `POST /api/engagement/sync` are only
 * ever pressed by a person, which is why the edge token allowlist sat empty
 * for four days in August without anybody noticing: every tracked link in the
 * wild was dead and the only thing that would have said so was a command
 * nobody had a reason to run.
 *
 * A timer inside the server rather than launchd or cron. It runs whenever the
 * app runs, needs no install, and cannot drift out of step with the code —
 * and during a pilot the app is open. The trade is honest and worth stating:
 * **nothing syncs while the server is stopped**, so `lastResult` reports how
 * stale it is rather than leaving that to be assumed.
 *
 * Failures are held and surfaced, never swallowed. A scheduler that quietly
 * retries forever reproduces the exact problem it was built to solve.
 */
import { syncWithEdge, isEdgeConfigured } from './edgeSync.js';
import { SYNC_INTERVAL_MINUTES } from './config.js';
import { utcNow } from './time.js';

/** Consecutive failures after which the interval is backed off. */
const BACKOFF_AFTER = 3;
const MAX_BACKOFF_MULTIPLIER = 8;

const state = {
  running: false,
  timer: null,
  inFlight: false,
  consecutiveFailures: 0,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastResult: null,
  lastError: null,
};

/** Everything a health endpoint or an operator needs to judge staleness. */
export function syncStatus() {
  return {
    running: state.running,
    intervalMinutes: SYNC_INTERVAL_MINUTES,
    inFlight: state.inFlight,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    consecutiveFailures: state.consecutiveFailures,
    // The number that matters. Null means it has never succeeded, which is a
    // different and worse thing than "a while ago".
    minutesSinceSuccess: state.lastSuccessAt
      ? Math.round((Date.now() - Date.parse(state.lastSuccessAt)) / 60_000)
      : null,
    lastResult: state.lastResult,
  };
}

/**
 * One pass. Never overlaps itself: a sync that takes longer than the interval
 * would otherwise stack up runs that fight over the same cursor.
 */
export async function runOnce({ log = console } = {}) {
  if (state.inFlight) return { skipped: 'already running' };
  state.inFlight = true;
  state.lastAttemptAt = utcNow();
  try {
    const result = await syncWithEdge();
    state.lastSuccessAt = state.lastAttemptAt;
    state.lastResult = result;
    state.lastError = null;
    state.consecutiveFailures = 0;

    const parts = [`${result.tokens?.pushed ?? 0} token(s) pushed`, `${result.events?.pulled ?? 0} event(s) pulled`];
    if (result.suppressions?.added) parts.push(`${result.suppressions.added} opt-out(s)`);
    // A token count the edge disagrees with is the shape of the August
    // failure, so it is said out loud rather than folded into a total.
    if (result.tokens?.liveAtEdge != null && result.tokens.liveAtEdge !== result.tokens.pushed) {
      log.warn?.(`[sync] MISMATCH: pushed ${result.tokens.pushed}, edge reports ${result.tokens.liveAtEdge} live`);
    }
    if (result.suppressions?.unresolved?.length) {
      log.warn?.(`[sync] ${result.suppressions.unresolved.length} opt-out(s) could not be matched to a coach`);
    }
    log.log?.(`[sync] ${parts.join(', ')}`);
    return result;
  } catch (err) {
    state.consecutiveFailures++;
    state.lastError = { message: err.message, at: utcNow() };
    log.error?.(`[sync] failed (${state.consecutiveFailures} in a row): ${err.message}`);
    throw err;
  } finally {
    state.inFlight = false;
  }
}

function nextDelayMs() {
  const base = SYNC_INTERVAL_MINUTES * 60_000;
  if (state.consecutiveFailures < BACKOFF_AFTER) return base;
  // Backing off a failing edge rather than hammering it, capped so recovery
  // is never more than a few intervals away.
  const multiplier = Math.min(MAX_BACKOFF_MULTIPLIER, 2 ** (state.consecutiveFailures - BACKOFF_AFTER + 1));
  return base * multiplier;
}

function schedule(log) {
  state.timer = setTimeout(async () => {
    try { await runOnce({ log }); } catch { /* recorded in state, already logged */ }
    if (state.running) schedule(log);
  }, nextDelayMs());
  // Never hold the process open on the scheduler's account.
  state.timer.unref?.();
}

/**
 * Starts the timer, or explains why it did not.
 *
 * Off unless THRIV3_SYNC_INTERVAL_MINUTES is set, so a test run or a local
 * poke at the database never reaches out to production of its own accord.
 */
export function startSyncScheduler({ log = console } = {}) {
  if (state.running) return { started: false, reason: 'already running' };
  if (!SYNC_INTERVAL_MINUTES || SYNC_INTERVAL_MINUTES <= 0) {
    return { started: false, reason: 'THRIV3_SYNC_INTERVAL_MINUTES is unset — engagement data will only sync when you run it by hand' };
  }
  if (!isEdgeConfigured()) {
    return { started: false, reason: 'no edge configured — nothing to sync with' };
  }
  state.running = true;
  schedule(log);
  return { started: true, intervalMinutes: SYNC_INTERVAL_MINUTES };
}

export function stopSyncScheduler() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.running = false;
}

/** Test seam: forget everything learned so far. */
export function resetSyncScheduler() {
  stopSyncScheduler();
  Object.assign(state, {
    inFlight: false, consecutiveFailures: 0,
    lastAttemptAt: null, lastSuccessAt: null, lastResult: null, lastError: null,
  });
}
