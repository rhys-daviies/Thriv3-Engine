import db from '../db/client.js';
import { utcNow } from './time.js';
import { ROLLUP_DEBOUNCE_MS, SESSION_COLLAPSE_MINUTES } from './config.js';

/**
 * Rebuilds engagement_rollup from the append-only event log.
 *
 * Tab 3 reads only from here, never from raw events, and nothing in this file
 * counts an unqualified session. A page load is not engagement — brief §8
 * makes visit_start explicitly non-qualifying because that is exactly what a
 * Safe Links scanner produces.
 */

const TIERS = [
  { tier: 'priority', min: 80 },
  { tier: 'hot', min: 50 },
  { tier: 'warm', min: 20 },
  { tier: 'cold', min: 0 },
];

/**
 * Per-session aggregates.
 *
 * watched_seconds, rewinds and skips arrive as running totals — the tracker
 * sends the session's cumulative figure with every event — so the per-session
 * value is the MAX, not the SUM. Summing the rows would multiply a single
 * session's watch time by its event count.
 */
const sessionsFor = db.prepare(`
  SELECT
    session_id,
    MIN(created_at)                                            AS started_at,
    MAX(created_at)                                            AS ended_at,
    MAX(COALESCE(coverage_pct, 0))                             AS coverage_pct,
    MAX(COALESCE(watched_seconds, 0))                          AS watched_seconds,
    MAX(COALESCE(rewinds, 0))                                  AS rewinds,
    SUM(CASE WHEN event_type = 'chapter_jump' THEN 1 ELSE 0 END) AS chapter_jumps,
    MAX(CASE WHEN event_type = 'visit_qualified' THEN 1 ELSE 0 END) AS qualified,
    MIN(CASE WHEN event_type = 'visit_qualified' THEN created_at END) AS qualified_at
  FROM tracking_events
  WHERE outreach_id = ?
  GROUP BY session_id
  ORDER BY started_at
`);

/**
 * Groups qualified sessions into visits, merging any that begin within the
 * collapse window of the previous one's last activity.
 */
export function collapseSessions(sessions, windowMinutes = SESSION_COLLAPSE_MINUTES) {
  const windowMs = windowMinutes * 60 * 1000;
  const visits = [];

  for (const session of sessions) {
    const startedAt = Date.parse(session.started_at);
    const previous = visits[visits.length - 1];

    if (previous && startedAt - Date.parse(previous.ended_at) < windowMs) {
      previous.sessions.push(session);
      if (Date.parse(session.ended_at) > Date.parse(previous.ended_at)) {
        previous.ended_at = session.ended_at;
      }
    } else {
      visits.push({ started_at: session.started_at, ended_at: session.ended_at, sessions: [session] });
    }
  }

  return visits;
}

/** Brief §10. Return visits carry the most weight, deliberately. */
export function engagementScore({ qualifiedVisits, bestCoveragePct, totalRewinds, chapterJumps, totalWatchedSeconds }) {
  const returnVisits = Math.max(0, qualifiedVisits - 1);
  const score =
    40 * Math.min(1, returnVisits / 2)
    + 25 * (bestCoveragePct / 100)
    + 20 * Math.min(1, totalRewinds / 3)
    + 10 * Math.min(1, chapterJumps / 3)
    + 5 * Math.min(1, totalWatchedSeconds / 180);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function tierFor(score, respondedAt = null) {
  if (respondedAt) return 'responded'; // staff-set, overrides the score
  return TIERS.find((t) => score >= t.min).tier;
}

/** Recomputes one outreach row from scratch. Never mutates tracking_events. */
export function rebuildRollup(outreachId) {
  const all = sessionsFor.all(outreachId);
  const qualified = all.filter((s) => s.qualified === 1);
  const visits = collapseSessions(qualified);

  // Cumulative counters are per-session maxima, summed across sessions.
  const totalWatchedSeconds = qualified.reduce((sum, s) => sum + s.watched_seconds, 0);
  const totalRewinds = qualified.reduce((sum, s) => sum + s.rewinds, 0);
  const chapterJumps = qualified.reduce((sum, s) => sum + s.chapter_jumps, 0);
  const bestCoveragePct = qualified.reduce((best, s) => Math.max(best, s.coverage_pct), 0);

  const qualifiedTimes = qualified.map((s) => s.qualified_at).filter(Boolean).sort();
  const existing = db.prepare('SELECT responded_at FROM engagement_rollup WHERE outreach_id = ?').get(outreachId);
  const respondedAt = existing?.responded_at ?? null;

  const score = engagementScore({
    qualifiedVisits: visits.length,
    bestCoveragePct,
    totalRewinds,
    chapterJumps,
    totalWatchedSeconds,
  });

  const row = {
    outreach_id: outreachId,
    qualified_visits: visits.length,
    first_qualified_at: qualifiedTimes[0] ?? null,
    last_qualified_at: qualifiedTimes[qualifiedTimes.length - 1] ?? null,
    best_coverage_pct: bestCoveragePct,
    total_watched_seconds: totalWatchedSeconds,
    total_rewinds: totalRewinds,
    chapter_jumps: chapterJumps,
    engagement_score: score,
    tier: tierFor(score, respondedAt),
    responded_at: respondedAt,
    updated_at: utcNow(),
  };

  db.prepare(`
    INSERT INTO engagement_rollup
      (outreach_id, qualified_visits, first_qualified_at, last_qualified_at, best_coverage_pct,
       total_watched_seconds, total_rewinds, chapter_jumps, engagement_score, tier, responded_at, updated_at)
    VALUES
      (@outreach_id, @qualified_visits, @first_qualified_at, @last_qualified_at, @best_coverage_pct,
       @total_watched_seconds, @total_rewinds, @chapter_jumps, @engagement_score, @tier, @responded_at, @updated_at)
    ON CONFLICT(outreach_id) DO UPDATE SET
      qualified_visits      = excluded.qualified_visits,
      first_qualified_at    = excluded.first_qualified_at,
      last_qualified_at     = excluded.last_qualified_at,
      best_coverage_pct     = excluded.best_coverage_pct,
      total_watched_seconds = excluded.total_watched_seconds,
      total_rewinds         = excluded.total_rewinds,
      chapter_jumps         = excluded.chapter_jumps,
      engagement_score      = excluded.engagement_score,
      tier                  = excluded.tier,
      updated_at            = excluded.updated_at
  `).run(row);

  return row;
}

/**
 * Rebuilds every outreach row that has events, and every row that already has
 * a rollup. The second half matters: if events are removed, the outreach no
 * longer appears in tracking_events, and skipping it would strand a rollup
 * still claiming engagement that the log no longer supports.
 */
export function rebuildAllRollups() {
  const ids = db.prepare(`
    SELECT outreach_id FROM tracking_events WHERE outreach_id IS NOT NULL
    UNION
    SELECT outreach_id FROM engagement_rollup
  `).all();
  return ids.map((r) => rebuildRollup(r.outreach_id));
}

/**
 * Staff-set reply flag. Brief §10: Responded overrides the score and is never
 * auto-detected in v1.
 */
export function markResponded(outreachId, at = utcNow()) {
  rebuildRollup(outreachId);
  db.prepare('UPDATE engagement_rollup SET responded_at = ?, tier = ?, updated_at = ? WHERE outreach_id = ?')
    .run(at, 'responded', utcNow(), outreachId);
  return db.prepare('SELECT * FROM engagement_rollup WHERE outreach_id = ?').get(outreachId);
}

export function clearResponded(outreachId) {
  db.prepare('UPDATE engagement_rollup SET responded_at = NULL WHERE outreach_id = ?').run(outreachId);
  return rebuildRollup(outreachId);
}

// --- write-triggered rebuild -------------------------------------------------

const pending = new Map();

/**
 * Debounced rebuild, called by the collector after each accepted event. A
 * watching coach emits a burst of events; rebuilding once the burst settles
 * keeps the work proportional to sessions rather than to events.
 */
export function scheduleRollup(outreachId, delay = ROLLUP_DEBOUNCE_MS) {
  clearTimeout(pending.get(outreachId));
  const timer = setTimeout(() => {
    pending.delete(outreachId);
    try {
      rebuildRollup(outreachId);
    } catch (err) {
      console.error('[rollup]', err.message);
    }
  }, delay);
  // Never hold the process open for a pending rebuild.
  if (typeof timer.unref === 'function') timer.unref();
  pending.set(outreachId, timer);
}

/** Runs every pending rebuild immediately. For tests and for shutdown. */
export function flushScheduledRollups() {
  for (const [outreachId, timer] of pending) {
    clearTimeout(timer);
    pending.delete(outreachId);
    rebuildRollup(outreachId);
  }
}
