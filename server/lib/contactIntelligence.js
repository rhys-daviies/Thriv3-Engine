import db from '../db/client.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';
import { contactIntelligenceKey } from '../../shared/contactIntelligenceKey.js';

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
 * A BOUNDED WHOLE-ATHLETE READ: TWO STATEMENTS, WHATEVER THE HISTORY SIZE.
 *
 * A Top 100 page renders twenty cards at a time out of a hundred programmes,
 * and asking per card would be a hundred requests for one screen. The matching
 * page therefore makes ONE HTTP call, indexes the result by programme, and
 * every card reads a local map. The relationship dialog is the only surface
 * that asks about a single programme, and it asks about one.
 *
 * The same bound applies BELOW the endpoint, which is the part that is easy to
 * lose: an athlete with two hundred outreach records costs the same two
 * statements as one with two. A per-row lookup here would have been an N+1
 * hiding behind a correctly bounded API — invisible from the network tab, and
 * growing with exactly the athletes who have the most history.
 *
 * Grouped by (college_name, sport) because that is the key every join in this
 * product uses: `coaches.school` + `coaches.sport`,
 * `athlete_programmes.college_name` + `.sport`, and the analysis entries' own
 * name under the athlete's sport. One institution fields a men's and a
 * women's programme with different staff and different history, so the name
 * alone is not an identity.
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

/**
 * EVERY ORIGIN FOR THE ATHLETE, IN ONE STATEMENT.
 *
 * `DISTINCT` collapses the repeats, and SQLite treats NULLs as equal to one
 * another for DISTINCT, so an outreach record whose sends are all unclassified
 * yields exactly one row carrying NULL. That matters: NULL is a real value
 * here — "historical or genuinely unclassified" — and dropping it would
 * silently convert an unknown origin into no origin at all.
 */
const ORIGINS = db.prepare(`
  SELECT DISTINCT s.outreach_id, s.origin
  FROM outreach_send s
  JOIN outreach o ON o.id = s.outreach_id
  WHERE o.athlete_id = @athleteId
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

function summarise(rows, originsByOutreach) {
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
      origins: originsByOutreach.get(row.outreach_id) ?? [],
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

  /**
   * The second and last statement. Indexed once here rather than asked per
   * outreach record, so the statement count stays flat as an athlete's history
   * grows. An outreach record with no sends at all is simply absent and reads
   * back as an empty origin list, which is what it is.
   */
  const originsByOutreach = new Map();
  for (const { outreach_id: id, origin } of ORIGINS.all({ athleteId })) {
    if (!originsByOutreach.has(id)) originsByOutreach.set(id, []);
    originsByOutreach.get(id).push(origin);
  }

  const byProgramme = new Map();
  for (const row of rows) {
    const key = contactIntelligenceKey(row.college_name, row.sport);
    if (!byProgramme.has(key)) byProgramme.set(key, []);
    byProgramme.get(key).push(row);
  }
  return [...byProgramme.values()].map((group) => summarise(group, originsByOutreach));
}

/** The same summary for one programme, for the relationship dialog. */
export function contactIntelligenceForProgramme({ athleteId, collegeName, sport }) {
  if (!athleteId || !collegeName || !sport) return null;
  return contactIntelligenceForAthlete(athleteId)
    .find((p) => p.college_name === collegeName && p.sport === sport) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Prior contact, for campaign pursuit (F6c)                                   */
/* -------------------------------------------------------------------------- */

/**
 * HAS THIS ATHLETE ALREADY HAD A CONFIRMED SEND TO THIS COACH?
 *
 * A FACT, NOT A PERMISSION. It reports what is on file and decides nothing:
 * no caller is blocked by it, no cadence reads it, and it is deliberately
 * separate from the campaign-local counter that drives sequencing. One answers
 * "where is this campaign up to with this person"; this answers "has this
 * athlete ever reached them". Both can be true at once and mean different
 * things — a coach written to once inside this campaign has a campaign-local
 * count of 1 AND a lifetime prior contact, and neither number is wrong.
 *
 * ---------------------------------------------------------------------------
 * CONFIRMED MEANS WHAT F4 AND F5 ALREADY MADE IT MEAN, and this is the third
 * reader of that definition rather than a fourth definition:
 *
 *   an ACCEPTED `outreach_send` row exists          (the modern record)
 *   OR `outreach.sent_at` is set                     (the legacy one)
 *
 * `outreach.sent_at` is written `WHERE sent_at IS NULL`, so it is the FIRST
 * confirmed send and never the last — F4 renamed it for exactly that reason.
 * It is why a legacy relationship can report `hasConfirmedSend: true` with
 * `confirmedSendCount: 0`: we know a message went, and the per-message rows
 * that would say how many did not exist yet. A caller must therefore test
 * `hasConfirmedSend` and never `confirmedSendCount > 0`.
 *
 * A DRAFT IS NOT A SEND and a failed send is not one either — both are absent
 * from the count, because `state = 'accepted'` is the filter. REVOCATION DOES
 * NOT ERASE HISTORY: `revoked_at` withdraws a tracking link, and a message that
 * was sent was still sent.
 * ---------------------------------------------------------------------------
 *
 * KEYED ON `coach_id`, the canonical row, never on an address. `coaches` is
 * unique on (email, school, sport) precisely because a shared inbox like
 * msoccer@cornell.edu is one address across a staff, so counting by address
 * would report a message to one person as a message to all of them. The cost
 * runs the other way — duplicate rows for one human read as separate people —
 * which F4 documented and which collapsing safely would need a coach identity
 * model this build does not have. Consistent here, not re-litigated.
 *
 * BOUNDED: ONE statement for every coach asked about, whatever the number.
 * A pursuit plan asks about its own coaches once — at most the tier depth, so
 * three — and never per coach, and never a whole-athlete sweep per programme.
 *
 * @param {string} args.athleteId
 * @param {string[]} args.coachIds canonical `coaches.id` values.
 * @returns {Map<string, object>} coach id → the fact. Coaches with no history
 *   are ABSENT; `priorContactOf` below turns a miss into the empty fact, so no
 *   caller has to decide what a missing key means.
 */
const priorContactByArity = new Map();

function priorContactStatement(n) {
  if (!priorContactByArity.has(n)) {
    priorContactByArity.set(n, db.prepare(`
      SELECT
        o.coach_id                     AS coach_id,
        -- First-wins by design in markOutreachSent, so this IS the first.
        o.sent_at                      AS legacy_first_send_at,
        COUNT(s.id)                    AS accepted_count,
        MIN(s.sent_at)                 AS first_accepted_at,
        MAX(s.sent_at)                 AS last_accepted_at,
        /*
          The origins present, WITHOUT the vocabulary appearing in this SQL —
          a third origin added later is carried through without a query change.
          group_concat drops NULLs, which is why the unrecorded rows are counted
          separately: NULL is a real value here and must not vanish into an
          empty string.
        */
        group_concat(DISTINCT s.origin) AS origin_list,
        SUM(CASE WHEN s.id IS NOT NULL AND s.origin IS NULL THEN 1 ELSE 0 END)
                                       AS unrecorded_count
      FROM outreach o
      LEFT JOIN outreach_send s ON s.outreach_id = o.id AND s.state = ?
      WHERE o.athlete_id = ? AND o.coach_id IN (${Array(n).fill('?').join(', ')})
      GROUP BY o.coach_id
    `));
  }
  return priorContactByArity.get(n);
}

/** Deterministic: the recorded origins in order, then NULL if any row lacked one. */
function originsOf(row) {
  const named = row.origin_list ? row.origin_list.split(',').filter(Boolean).sort() : [];
  return row.unrecorded_count > 0 ? [...named, null] : named;
}

/** What a coach nobody has written to looks like. Never null, never partial. */
export const NO_PRIOR_CONTACT = Object.freeze({
  hasConfirmedSend: false,
  confirmedSendCount: 0,
  firstConfirmedSendAt: null,
  lastConfirmedSendAt: null,
  origins: Object.freeze([]),
});

export function priorContactForCoaches({ athleteId, coachIds = [] }) {
  const ids = [...new Set(coachIds.filter(Boolean))];
  const facts = new Map();
  if (!athleteId || !ids.length) return facts;

  for (const row of priorContactStatement(ids.length)
    .all(MESSAGE_STATE.ACCEPTED, athleteId, ...ids)) {
    const hasConfirmedSend = row.accepted_count > 0 || Boolean(row.legacy_first_send_at);
    if (!hasConfirmedSend) continue;   // drafts only: a relationship, not a send.
    facts.set(row.coach_id, {
      hasConfirmedSend,
      /**
       * ACCEPTED MESSAGES ON FILE. Zero alongside `hasConfirmedSend: true` is
       * the honest reading of a legacy relationship: one went, and nothing
       * recorded how many.
       */
      confirmedSendCount: row.accepted_count,
      firstConfirmedSendAt: row.legacy_first_send_at ?? row.first_accepted_at ?? null,
      lastConfirmedSendAt: row.last_accepted_at ?? row.legacy_first_send_at ?? null,
      origins: originsOf(row),
    });
  }
  return facts;
}

/** A miss is "nobody has written to them", which is a fact and not an absence. */
export function priorContactOf(facts, coachId) {
  return facts.get(coachId) ?? NO_PRIOR_CONTACT;
}
