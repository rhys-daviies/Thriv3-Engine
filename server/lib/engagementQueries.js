import db from '../db/client.js';
import { collapseSessions } from './engagementRollup.js';

/**
 * Read models for Tab 3.
 *
 * Everything here reads engagement_rollup and the qualified sessions behind
 * it. Nothing exposes a raw pageview — brief §9 rule 8 forbids surfacing one
 * in a chart, tooltip, export or debug view, because a page load is what a
 * security scanner produces and presenting it as interest is the exact lie
 * this system exists to avoid.
 */

const QUALIFIED_SESSIONS = `
  SELECT
    e.outreach_id,
    e.session_id,
    MIN(e.created_at)                                              AS started_at,
    MAX(e.created_at)                                              AS ended_at,
    MAX(COALESCE(e.coverage_pct, 0))                               AS coverage_pct,
    MAX(COALESCE(e.watched_seconds, 0))                            AS watched_seconds,
    MAX(COALESCE(e.duration_seconds, 0))                           AS duration_seconds,
    MAX(COALESCE(e.rewinds, 0))                                    AS rewinds
  FROM tracking_events e
  WHERE e.outreach_id IN (SELECT id FROM outreach WHERE athlete_id = ?)
  GROUP BY e.outreach_id, e.session_id
  HAVING MAX(CASE WHEN e.event_type = 'visit_qualified' THEN 1 ELSE 0 END) = 1
`;

/**
 * Sent -> Qualified view -> Watched >50% -> Returned.
 *
 * "Sent" counts live outreach rows: a row exists precisely because a link was
 * minted for that coach. Revoked rows drop out.
 */
export function outreachFunnel(athleteId) {
  const row = db.prepare(`
    SELECT
      COUNT(*)                                                        AS sent,
      SUM(CASE WHEN r.qualified_visits > 0  THEN 1 ELSE 0 END)        AS qualified,
      SUM(CASE WHEN r.best_coverage_pct > 50 THEN 1 ELSE 0 END)       AS watched_half,
      SUM(CASE WHEN r.qualified_visits >= 2 THEN 1 ELSE 0 END)        AS returned
    FROM outreach o
    LEFT JOIN engagement_rollup r ON r.outreach_id = o.id
    WHERE o.athlete_id = ? AND o.revoked_at IS NULL
  `).get(athleteId);

  return {
    sent: row.sent || 0,
    qualified: row.qualified || 0,
    watchedHalf: row.watched_half || 0,
    returned: row.returned || 0,
  };
}

/** One row per coach, default sorted by score descending. */
export function coachEngagement(athleteId) {
  return db.prepare(`
    SELECT
      o.id                              AS outreach_id,
      c.id                              AS coach_id,
      c.full_name                       AS coach_name,
      c.school,
      c.division,
      c.position_title,
      o.sent_at,
      COALESCE(r.qualified_visits, 0)   AS qualified_visits,
      COALESCE(r.best_coverage_pct, 0)  AS best_coverage_pct,
      COALESCE(r.total_rewinds, 0)      AS total_rewinds,
      COALESCE(r.chapter_jumps, 0)      AS chapter_jumps,
      COALESCE(r.engagement_score, 0)   AS engagement_score,
      COALESCE(r.tier, 'cold')          AS tier,
      r.last_qualified_at,
      r.responded_at
    FROM outreach o
    JOIN coaches c ON c.id = o.coach_id
    LEFT JOIN engagement_rollup r ON r.outreach_id = o.id
    WHERE o.athlete_id = ? AND o.revoked_at IS NULL
    ORDER BY r.engagement_score DESC NULLS LAST, c.full_name ASC
  `).all(athleteId);
}

/** Chronological session timeline for one coach — what staff read before advising a family. */
export function coachSessions(outreachId) {
  const sessions = db.prepare(`
    SELECT
      session_id,
      MIN(created_at)                       AS started_at,
      MAX(created_at)                       AS ended_at,
      MAX(COALESCE(coverage_pct, 0))        AS coverage_pct,
      MAX(COALESCE(watched_seconds, 0))     AS watched_seconds,
      MAX(COALESCE(rewinds, 0))             AS rewinds,
      MAX(COALESCE(skips, 0))               AS skips
    FROM tracking_events
    WHERE outreach_id = ?
    GROUP BY session_id
    HAVING MAX(CASE WHEN event_type = 'visit_qualified' THEN 1 ELSE 0 END) = 1
    ORDER BY started_at DESC
  `).all(outreachId);

  const jumps = db.prepare(`
    SELECT session_id, payload FROM tracking_events
    WHERE outreach_id = ? AND event_type = 'chapter_jump'
  `).all(outreachId);

  const bySession = new Map();
  for (const jump of jumps) {
    const label = safeJson(jump.payload)?.label;
    if (!label) continue;
    if (!bySession.has(jump.session_id)) bySession.set(jump.session_id, []);
    bySession.get(jump.session_id).push(label);
  }

  // Number each session by the visit it belongs to, using the same collapse
  // rule the rollup uses. Without this the timeline would call two sessions
  // seven minutes apart two return visits while the coach table, correctly,
  // counted them as one — and a number that contradicts itself is worse than
  // no number.
  const ascending = [...sessions].reverse();
  const visitOf = new Map();
  collapseSessions(ascending).forEach((visit, index) => {
    for (const s of visit.sessions) visitOf.set(s.session_id, index + 1);
  });

  const firstSeen = new Set();
  const ordered = ascending.map((s) => {
    const visitNumber = visitOf.get(s.session_id) ?? 1;
    const startsVisit = !firstSeen.has(visitNumber);
    firstSeen.add(visitNumber);
    return {
      ...s,
      visit_number: visitNumber,
      starts_visit: startsVisit,
      duration_seconds: Math.max(0, Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000)),
      chapters: bySession.get(s.session_id) || [],
    };
  });

  return ordered.reverse();
}

/**
 * Aggregate watch coverage across every coach who watched this athlete's reel,
 * plotted against video timestamp.
 *
 * Built from the run-length encoded played seconds each session reports, which
 * is the only thing that can answer "does everyone stop at 0:40". A session
 * contributes at most once, via its richest report.
 */
export function retentionCurve(athleteId, { buckets = 120 } = {}) {
  const rows = db.prepare(`
    SELECT e.session_id, e.event_type, e.payload, e.duration_seconds, e.created_at
    FROM tracking_events e
    WHERE e.outreach_id IN (SELECT id FROM outreach WHERE athlete_id = ?)
      AND e.payload LIKE '%coverageRanges%'
    ORDER BY e.created_at
  `).all(athleteId);

  const qualified = new Set(
    db.prepare(QUALIFIED_SESSIONS).all(athleteId).map((s) => s.session_id)
  );

  // Keep the widest report per session — a later milestone supersedes an earlier one.
  const bySession = new Map();
  let duration = 0;
  for (const row of rows) {
    if (!qualified.has(row.session_id)) continue;
    const ranges = safeJson(row.payload)?.coverageRanges;
    if (!Array.isArray(ranges) || ranges.length === 0) continue;
    const covered = ranges.reduce((sum, [from, to]) => sum + (to - from + 1), 0);
    const existing = bySession.get(row.session_id);
    if (!existing || covered > existing.covered) bySession.set(row.session_id, { ranges, covered });
    if (row.duration_seconds > duration) duration = row.duration_seconds;
  }

  const viewers = bySession.size;
  if (viewers === 0 || duration === 0) {
    return { viewers: 0, durationSeconds: duration, points: [], chapters: chaptersFor(athleteId) };
  }

  const size = Math.max(1, Math.ceil(duration / buckets));
  const counts = new Array(Math.ceil(duration / size)).fill(0);

  for (const { ranges } of bySession.values()) {
    const touched = new Set();
    for (const [from, to] of ranges) {
      for (let b = Math.floor(from / size); b <= Math.floor(Math.min(to, duration - 1) / size); b++) {
        if (b >= 0 && b < counts.length) touched.add(b);
      }
    }
    for (const b of touched) counts[b]++;
  }

  return {
    viewers,
    durationSeconds: duration,
    bucketSeconds: size,
    points: counts.map((count, i) => ({
      t: i * size,
      viewers: count,
      pct: Math.round((count / viewers) * 100),
    })),
    chapters: chaptersFor(athleteId),
  };
}

/** Which labelled clips coaches jump to, ranked. */
export function chapterEngagement(athleteId) {
  const rows = db.prepare(`
    SELECT e.payload, e.outreach_id
    FROM tracking_events e
    WHERE e.outreach_id IN (SELECT id FROM outreach WHERE athlete_id = ?)
      AND e.event_type = 'chapter_jump'
  `).all(athleteId);

  const byLabel = new Map();
  for (const row of rows) {
    const payload = safeJson(row.payload);
    const label = payload?.label;
    if (!label) continue;
    if (!byLabel.has(label)) byLabel.set(label, { label, t: payload.toSeconds ?? null, jumps: 0, coaches: new Set() });
    const entry = byLabel.get(label);
    entry.jumps++;
    entry.coaches.add(row.outreach_id);
  }

  return [...byLabel.values()]
    .map((e) => ({ label: e.label, t: e.t, jumps: e.jumps, coaches: e.coaches.size }))
    .sort((a, b) => b.jumps - a.jumps || a.label.localeCompare(b.label));
}

function chaptersFor(athleteId) {
  const row = db.prepare('SELECT video_chapters FROM players WHERE id = ?').get(athleteId);
  const list = safeJson(row?.video_chapters) || [];
  return Array.isArray(list) ? list.filter((c) => Number.isFinite(Number(c?.t))) : [];
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Everything Tab 3 needs, in one read. */
export function athleteEngagement(athleteId) {
  return {
    funnel: outreachFunnel(athleteId),
    coaches: coachEngagement(athleteId),
    retention: retentionCurve(athleteId),
    chapters: chapterEngagement(athleteId),
  };
}
