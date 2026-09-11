import db from '../db/client.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * WHAT HAS ALREADY BEEN SENT TO THIS PROGRAMME FOR THIS ATHLETE.
 *
 * One helper, read-only, over the tables that already hold the truth. No new
 * table, nothing copied onto `athlete_programmes`: a stored "previously
 * contacted" flag is a second answer to a question `outreach` answers, and the
 * second answer is the one that goes stale.
 *
 * ---------------------------------------------------------------------------
 * IT REPORTS FACTS, AND EVERY FIELD IS NAMED FOR THE FACT IT HOLDS.
 *
 * The version this replaces got three things wrong, all of them by naming:
 *
 *   `outreach.sent_at` IS THE FIRST CONFIRMED SEND, not the last —
 *   `markOutreachSent` writes it `WHERE sent_at IS NULL` so a delivery window
 *   cannot move. It was being rendered as "last sent", which for a coach
 *   written to three times named the oldest of the three.
 *
 *   A DRAFT IS NOT A MESSAGE. The count was every `outreach_send` row, so two
 *   drafts nobody sent read as "2 messages".
 *
 *   ORIGIN WAS NOT SHOWN AT ALL, so a coach reached by a campaign looked
 *   exactly like one written to by hand.
 * ---------------------------------------------------------------------------
 *
 * CAMPAIGN CONTACT IS INCLUDED, DELIBERATELY. The operator's question is "has
 * anyone written to this coach for this athlete", and the answer does not
 * depend on which part of the product did it. Hiding campaign messages here
 * would let somebody write a "first introduction" to a coach who had already
 * had three. What matters is that the origin is SHOWN rather than blended.
 */

/**
 * ONE ROW PER `outreach` RELATIONSHIP, which is one per (athlete, coach_id).
 *
 * NOT grouped by email address, and that is a deliberate refusal rather than
 * an oversight. `coaches` is keyed on (email, school, sport) precisely because
 * a generic address like msoccer@cornell.edu is legitimately shared across a
 * staff — so collapsing on the address would merge two people into one line
 * and report a message to one of them as a message to both.
 *
 * The cost is the other direction: where duplicate `coaches` rows exist for
 * one person, they appear as separate lines. `coach_email` is returned so that
 * is VISIBLE rather than silently double-counted — two lines with the same
 * address is a legible oddity; one merged line asserting something false is
 * not. See the note on coach identity in docs terms: collapsing them safely
 * needs a coach identity model this does not have.
 */
const HISTORY = db.prepare(`
  SELECT
    c.id                AS coach_id,
    c.full_name         AS coach_name,
    c.email             AS coach_email,
    c.position_title,
    o.created_at        AS relationship_opened_at,
    o.drafted_at        AS last_drafted_at,
    -- NAMED FOR WHAT IT IS. First-wins, by design in markOutreachSent.
    o.sent_at           AS first_confirmed_send_at,
    o.revoked_at,
    (SELECT COUNT(*) FROM outreach_send s
      WHERE s.outreach_id = o.id AND s.state = @accepted)          AS accepted_count,
    (SELECT COUNT(*) FROM outreach_send s
      WHERE s.outreach_id = o.id AND s.state = @draft)             AS draft_count,
    (SELECT COUNT(*) FROM outreach_send s WHERE s.outreach_id = o.id) AS record_count,
    -- The real last one, which the relationship row cannot supply.
    (SELECT MAX(s.sent_at) FROM outreach_send s
      WHERE s.outreach_id = o.id AND s.state = @accepted)          AS last_confirmed_send_at
  FROM outreach o
  JOIN coaches c ON c.id = o.coach_id
  WHERE o.athlete_id = @athleteId AND c.school = @collegeName AND c.sport = @sport
  ORDER BY COALESCE(o.sent_at, o.drafted_at, o.created_at) DESC, c.id
`);

/**
 * Which kinds of action produced the messages on one relationship.
 *
 * NULL IS CARRIED THROUGH AS NULL rather than defaulted to anything. Every row
 * written before `origin` existed has it, and a row a future path forgets to
 * classify would have it too — inventing "manual" for either would be exactly
 * the fabrication the column was added to prevent. The caller says how to
 * word it; this only refuses to guess.
 */
const ORIGINS = db.prepare(`
  SELECT DISTINCT origin FROM outreach_send WHERE outreach_id = @outreachId
`);

const OUTREACH_IDS = db.prepare(`
  SELECT o.id, o.coach_id FROM outreach o
    JOIN coaches c ON c.id = o.coach_id
   WHERE o.athlete_id = @athleteId AND c.school = @collegeName AND c.sport = @sport
`);

/**
 * @returns {Array<object>} one entry per coach relationship, newest activity
 *   first. Empty when nobody has been written to — which is a fact, not a gap.
 */
export function historyForAthleteProgramme({ athleteId, collegeName, sport }) {
  if (!athleteId || !collegeName || !sport) return [];
  const params = { athleteId, collegeName, sport };

  const originsByCoach = new Map();
  for (const row of OUTREACH_IDS.all(params)) {
    originsByCoach.set(
      row.coach_id,
      ORIGINS.all({ outreachId: row.id }).map((r) => r.origin),
    );
  }

  return HISTORY.all({
    ...params,
    accepted: MESSAGE_STATE.ACCEPTED,
    draft: MESSAGE_STATE.DRAFT,
  }).map((row) => ({
    ...row,
    /**
     * THE ONE DERIVED FIELD, and it is derived conservatively.
     *
     * True only when a send was actually confirmed. A relationship carrying
     * three drafts and no confirmation is `false` — the operator is told a
     * body was written, never that a coach received one.
     */
    has_confirmed_send: row.accepted_count > 0 || Boolean(row.first_confirmed_send_at),
    origins: originsByCoach.get(row.coach_id) ?? [],
  }));
}
