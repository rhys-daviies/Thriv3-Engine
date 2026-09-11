import db from '../db/client.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * WHAT AN OPERATOR SHOULD KNOW BEFORE WRITING TO A PROGRAMME AGAIN.
 *
 * Derived on every read from `outreach`, `outreach_send` and
 * `engagement_rollup`. Nothing is stored and no column is added anywhere — a
 * "contacted" flag on `athlete_programmes` would be a second answer to a
 * question these tables already answer, and the second answer is the one that
 * goes stale.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PRODUCT ACTUALLY TRACKS, WHICH IS NOT WHAT A CRM TRACKS.
 *
 * There is NO EMAIL OPEN TRACKING. No pixel exists. There is no click
 * tracking in the email sense either. What exists is a PROFILE VISIT: the
 * coach followed their own tracked link, the athlete's page loaded, and the
 * tracker recorded what happened on it.
 *
 * So the vocabulary here is deliberately not opened/clicked/replied:
 *
 *   PROFILE VISIT     trustworthy, and stronger than an open would be.
 *                     `visit_start` is explicitly non-qualifying because that
 *                     is exactly what a Safe Links scanner produces; only
 *                     `visit_qualified` counts, and sessions inside the
 *                     collapse window merge into one visit. So the count is
 *                     neither raw events nor scanner noise.
 *
 *   VIDEO COVERAGE    trustworthy. How much of the highlight reel was watched.
 *
 *   REPLY             OPERATOR-ASSERTED ONLY. `engagement_rollup.responded_at`
 *                     is set by a person through
 *                     /api/engagement/outreach/:id/responded. Nothing ingests
 *                     replies and nothing classifies them, so this is reported
 *                     as "a reply was recorded" and never as an observation.
 *
 * Anything else — delivered, inboxed, bounced, opened — this build does not
 * know, and nothing here implies it.
 * ---------------------------------------------------------------------------
 */

/**
 * ONE QUERY FOR A WHOLE ATHLETE. This is the N+1 answer.
 *
 * A Top 100 page renders twenty cards at a time out of a hundred programmes,
 * and asking per card would be a hundred requests for one screen. The matching
 * page therefore makes ONE call, indexes the result by programme, and every
 * card reads a local map. The relationship dialog is the only surface that
 * asks about a single programme, and it asks about one.
 *
 * Grouped by (college_name, sport) because that is the key every join in this
 * product uses: `coaches.school`, `athlete_programmes.college_name`, and the
 * analysis entries' own `name`.
 */
const ROWS = db.prepare(`
  SELECT
    c.school                          AS college_name,
    c.sport                           AS sport,
    c.id                              AS coach_id,
    c.full_name                       AS coach_name,
    c.position_title,
    o.id                              AS outreach_id,
    o.drafted_at,
    o.sent_at,
    o.revoked_at,
    (SELECT COUNT(*) FROM outreach_send s
      WHERE s.outreach_id = o.id AND s.state = @accepted)   AS accepted_count,
    (SELECT MAX(s.sent_at) FROM outreach_send s
      WHERE s.outreach_id = o.id AND s.state = @accepted)   AS last_confirmed_send_at,
    COALESCE(r.qualified_visits, 0)   AS qualified_visits,
    COALESCE(r.best_coverage_pct, 0)  AS best_coverage_pct,
    r.last_qualified_at,
    r.responded_at
  FROM outreach o
  JOIN coaches c ON c.id = o.coach_id
  LEFT JOIN engagement_rollup r ON r.outreach_id = o.id
  WHERE o.athlete_id = @athleteId AND c.school IS NOT NULL
`);

const ORIGINS = db.prepare(`
  SELECT DISTINCT origin FROM outreach_send WHERE outreach_id = @outreachId
`);

/** Latest of a set of ISO strings, ignoring nulls. */
const latest = (...values) => values.filter(Boolean).sort().at(-1) ?? null;

/**
 * THE LATEST MEANINGFUL INTERACTION, AND ITS PRIORITY ORDER.
 *
 *   reply           a person recorded one. The strongest thing on file.
 *   profile_visit   the coach followed their link and the page qualified.
 *   confirmed_send  a message was accepted for sending.
 *   draft           a body exists. Nobody has confirmed it went anywhere.
 *
 * There is no `open` rung and no `click` rung, because neither is a fact this
 * system holds. Ordered by what it says about the COACH rather than by
 * recency: a visit last month means more than a draft this morning, and
 * sorting purely by timestamp would rank our own activity above theirs.
 */
function lastActivity({ respondedAt, lastVisitAt, lastSendAt, lastDraftAt }) {
  if (respondedAt) return { at: respondedAt, kind: 'reply' };
  if (lastVisitAt) return { at: lastVisitAt, kind: 'profile_visit' };
  if (lastSendAt) return { at: lastSendAt, kind: 'confirmed_send' };
  if (lastDraftAt) return { at: lastDraftAt, kind: 'draft' };
  return { at: null, kind: null };
}

function summarise(rows) {
  const coaches = rows.map((row) => {
    const hasConfirmedSend = row.accepted_count > 0 || Boolean(row.sent_at);
    return {
      coach_id: row.coach_id,
      coach_name: row.coach_name,
      position_title: row.position_title,
      has_confirmed_send: hasConfirmedSend,
      confirmed_send_count: row.accepted_count,
      last_confirmed_send_at: row.last_confirmed_send_at ?? row.sent_at ?? null,
      last_drafted_at: row.drafted_at,
      revoked_at: row.revoked_at,
      origins: ORIGINS.all({ outreachId: row.outreach_id }).map((r) => r.origin),
      engagement: {
        /**
         * Scanner-filtered and session-collapsed by the rollup. A count here
         * is VISITS, not events, which is why showing it is safe where showing
         * a raw event total would not be.
         */
        profile_visits: row.qualified_visits,
        last_visit_at: row.last_qualified_at,
        best_coverage_pct: row.best_coverage_pct,
        /** Operator-asserted. Never inferred, never observed. */
        reply_recorded: Boolean(row.responded_at),
        reply_recorded_at: row.responded_at,
      },
    };
  });

  const confirmedSendCount = coaches.reduce((n, c) => n + c.confirmed_send_count, 0);
  const hasConfirmedSend = coaches.some((c) => c.has_confirmed_send);
  const lastConfirmedSendAt = latest(...coaches.map((c) => c.last_confirmed_send_at));
  const lastDraftedAt = latest(...coaches.map((c) => c.last_drafted_at));
  const lastVisitAt = latest(...coaches.map((c) => c.engagement.last_visit_at));
  const repliedAt = latest(...coaches.map((c) => c.engagement.reply_recorded_at));

  const activity = lastActivity({
    respondedAt: repliedAt,
    lastVisitAt,
    lastSendAt: lastConfirmedSendAt,
    lastDraftAt: lastDraftedAt,
  });

  return {
    college_name: rows[0].college_name,
    sport: rows[0].sport,
    /** An outreach record exists. It does NOT mean a coach received anything. */
    contacted: true,
    has_confirmed_send: hasConfirmedSend,
    /**
     * A body was written and nothing was ever confirmed. Reported separately
     * because "contacted" reads as "they heard from us", and this is precisely
     * the case where they did not.
     */
    draft_only: !hasConfirmedSend && Boolean(lastDraftedAt),
    confirmed_send_count: confirmedSendCount,
    coach_count: coaches.length,
    last_confirmed_send_at: lastConfirmedSendAt,
    last_drafted_at: lastDraftedAt,
    revoked_count: coaches.filter((c) => c.revoked_at).length,
    origins: [...new Set(coaches.flatMap((c) => c.origins))],
    engagement: {
      profile_visits: coaches.reduce((n, c) => n + c.engagement.profile_visits, 0),
      last_visit_at: lastVisitAt,
      best_coverage_pct: coaches.reduce((b, c) => Math.max(b, c.engagement.best_coverage_pct), 0),
      reply_recorded: coaches.some((c) => c.engagement.reply_recorded),
      reply_recorded_at: repliedAt,
    },
    last_activity_at: activity.at,
    last_activity_kind: activity.kind,
    coaches,
  };
}

/**
 * Every programme this athlete has any outreach history with.
 *
 * @returns {Array<object>} one summary per (college_name, sport). Programmes
 *   with no history are ABSENT rather than present-and-empty: the caller keys
 *   a map on the name, and a miss is the honest representation of "nobody has
 *   written to them".
 */
export function contactIntelligenceForAthlete(athleteId) {
  if (!athleteId) return [];
  const rows = ROWS.all({ athleteId, accepted: MESSAGE_STATE.ACCEPTED });

  const byProgramme = new Map();
  for (const row of rows) {
    const key = `${row.college_name} ${row.sport}`;
    if (!byProgramme.has(key)) byProgramme.set(key, []);
    byProgramme.get(key).push(row);
  }
  return [...byProgramme.values()].map(summarise);
}

/** The same summary for one programme, for the relationship dialog. */
export function contactIntelligenceForProgramme({ athleteId, collegeName, sport }) {
  if (!athleteId || !collegeName || !sport) return null;
  return contactIntelligenceForAthlete(athleteId)
    .find((p) => p.college_name === collegeName && p.sport === sport) ?? null;
}
