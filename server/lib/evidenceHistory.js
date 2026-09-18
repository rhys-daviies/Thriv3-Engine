import db from '../db/client.js';
import { MESSAGE_STATE, OPEN_STATES } from '../../shared/outreachMessageState.js';
import { identityOf } from '../../shared/evidence/sequenceStrategy.js';

/**
 * WHAT THIS COACH HAS ALREADY BEEN TOLD, IN THIS CAMPAIGN.
 *
 * The one read the sequence strategy needs and the only thing in C2 that
 * touches the database. Two questions that look alike and are not:
 *
 *   sentEvidenceForContact       what the coach has READ. Accepted messages.
 *   openDraftEvidenceForContact  what is sitting unsent in the message
 *                                currently open on this relationship.
 *
 * Kept apart deliberately. A draft nobody sent has reached nobody, and folding
 * it into "already seen" would let an abandoned draft permanently retire a
 * reason the coach never heard. They are excluded for a different purpose and
 * the caller says which it is asking.
 *
 * ---------------------------------------------------------------------------
 * IT READS WHAT WAS RENDERED, NOT WHAT WAS SELECTED.
 *
 * `rendered_kinds` is derived at send time from the sentences that actually
 * reached the body, narrowed by what the send path found in the text the
 * operator handed over. The selector licenses up to three body claims and
 * composition renders one; an operator may then delete a paragraph. Only the
 * survivors are in this column, which is exactly the set a coach could have
 * read — and the only honest basis for "do not say that again".
 * ---------------------------------------------------------------------------
 */

/**
 * CAMPAIGN-LOCAL, AND THE SCOPE IS THE POINT.
 *
 * Keyed on `(programme_campaign_id, athlete_id, coach_id)`:
 *
 *   PER CAMPAIGN, so a coach an earlier campaign wrote to twice hears a new
 *   cycle's reasoning without a season-old message silencing it. A6 put the
 *   authoritative attribution on the MESSAGE rather than the relationship for
 *   exactly this, and reading `outreach.programme_campaign_id` instead would
 *   credit the campaign that first opened the relationship.
 *
 *   PER COACH, so an assistant approached after the head coach starts from
 *   nothing. We do not observe forwarding, and assuming it would silently
 *   strip the strongest reason from the second person's first email on the
 *   strength of a guess about a stranger's inbox habits.
 *
 * A NULL `programme_campaign_id` never matches — SQL equality against NULL is
 * never true — so the 41 historical messages, which predate both campaigns and
 * the snapshot columns, are invisible here without a clause of their own. That
 * is the correct answer rather than a lucky one: they were not sent under any
 * campaign, and guessing one for them is what A6 forbids.
 */
const SCOPE = `
  programme_campaign_id = @programmeCampaignId
  AND athlete_id = @athleteId
  AND coach_id = @coachId
`;

const OPEN_LIST = OPEN_STATES.map((s) => `'${s}'`).join(', ');

/**
 * Split the stored column back into kinds.
 *
 * Ordered, comma-joined at write time; order is preserved here so a caller can
 * still see which claim led, even though the strategy only asks which were
 * present. (No backticks in the SQL above or below: template literals.)
 */
const kindsOf = (rows) => {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    for (const kind of String(row.rendered_kinds ?? '').split(',')) {
      const name = kind.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
};

/**
 * Evidence this campaign has already SENT to this coach.
 *
 * ACCEPTED only, which is B2's word for "something we observed sent it" — the
 * AppleScript issued Outlook's own Send, or a person confirmed a batch they
 * sent by hand. A CANCELLED message reached nobody. A FAILED one reached
 * nobody. A DRAFT is a body in a window. None of them is a thing a coach has
 * read, and counting any of them would retire a reason on the strength of an
 * email that does not exist.
 *
 * @returns {string[]} evidence kinds, in the order they were rendered.
 */
export function sentEvidenceForContact({ programmeCampaignId, athleteId, coachId } = {}) {
  if (!programmeCampaignId || !athleteId || !coachId) return [];
  return kindsOf(db.prepare(`
    SELECT rendered_kinds FROM outreach_send
    WHERE ${SCOPE}
      AND state = '${MESSAGE_STATE.ACCEPTED}'
      AND rendered_kinds IS NOT NULL
    ORDER BY COALESCE(sent_at, drafted_at, created_at), id
  `).all({ programmeCampaignId, athleteId, coachId }));
}

/**
 * Evidence sitting in the message currently OPEN on this relationship.
 *
 * NOT "already seen" — nobody has read it. It exists so that regenerating a
 * pending follow-up is stable: without it, a draft that used the last unused
 * connection would find that connection unused again on the next regeneration,
 * choose it again, and produce the same message while reporting it as fresh.
 * Whether to exclude it is the CALLER's decision, which is why it is a second
 * function rather than a wider definition of the first.
 *
 * At most one open message per relationship — B2 made that a database
 * guarantee — so this reads one row in practice.
 */
export function openDraftEvidenceForContact({ programmeCampaignId, athleteId, coachId } = {}) {
  if (!programmeCampaignId || !athleteId || !coachId) return [];
  return kindsOf(db.prepare(`
    SELECT rendered_kinds FROM outreach_send
    WHERE ${SCOPE}
      AND state IN (${OPEN_LIST})
      AND rendered_kinds IS NOT NULL
    ORDER BY sequence, id
  `).all({ programmeCampaignId, athleteId, coachId }));
}

/**
 * WHICH MESSAGE OF THIS CAMPAIGN THIS WOULD BE, for this coach.
 *
 * Accepted messages plus one. Step 1 means nothing has been sent to this coach
 * under this campaign; step 2 means one message has.
 *
 * DERIVED, NEVER TAKEN FROM A CALLER, and never from
 * `outreach_send.sequence`. That column counts messages over the LIFETIME of
 * the athlete-coach relationship, so a coach an earlier campaign wrote to
 * twice would arrive at a new campaign already on sequence 3 — and would be
 * sent a follow-up as their first contact of a season they have heard nothing
 * about. The campaign-local count is the only one that describes the
 * conversation a coach is actually in.
 *
 * COUNTS MESSAGES, NOT CLAIMS. A generic email with no licensed evidence is
 * still a message the coach received, so this cannot be derived from
 * `sentEvidenceForContact` — that returns kinds, and a generic message
 * contributes none.
 *
 * It agrees with B6's derivation by construction: same table, same filters,
 * same ACCEPTED state. They are two readings of one fact rather than two
 * policies, and if they ever disagree B7's dry run reports it as step drift.
 */
export function campaignLocalStep({ programmeCampaignId, athleteId, coachId } = {}) {
  if (!programmeCampaignId || !athleteId || !coachId) return null;
  const { n } = db.prepare(`
    SELECT COUNT(*) AS n FROM outreach_send
    WHERE ${SCOPE} AND state = '${MESSAGE_STATE.ACCEPTED}'
  `).get({ programmeCampaignId, athleteId, coachId });
  return n + 1;
}


/* -------------------------------------------------------------------------- */
/*  LIFETIME CONTACT HISTORY, INDEPENDENT OF ANY CAMPAIGN - F9e               */
/* -------------------------------------------------------------------------- */

/**
 * WHAT THESE COACHES HAVE ALREADY BEEN TOLD, BY ANY PART OF THE PRODUCT.
 *
 * ===========================================================================
 * A SIBLING OF THE THREE ABOVE, NOT A WIDENING OF THEM.
 *
 * `SCOPE` is campaign-shaped on purpose: a coach an earlier campaign wrote to
 * twice must be able to hear that reasoning again in a new cycle, so those
 * queries deliberately cannot see anything outside their own campaign. This
 * one asks a different question, for a different caller, and answers it
 * without touching theirs - no shared predicate, no shared statement, nothing
 * of Campaign's behaviour moved.
 *
 * MANUAL OUTREACH HAS NO CYCLES. There is no campaign to scope to, no step and
 * no ceiling; the operator may write to a coach a fourth time in March for
 * reasons no policy models. So its natural scope is the LIFETIME of the
 * athlete-coach relationship, which is exactly what `outreach` is unique on.
 * ===========================================================================
 *
 * ORIGIN-BLIND BY DESIGN, AND THE ORIGIN IS STILL RETURNED. A coach's inbox
 * does not care which part of the product wrote to it, so a campaign message
 * counts here - `programmeContactHistory` reached the same conclusion for
 * display, and hiding campaign contact would let somebody write a "first
 * introduction" to a coach who had already had three. The origin travels with
 * the answer so a surface can say which it was rather than blending them.
 *
 * THIS DOES NOT MAKE CAMPAIGN SEE MANUAL HISTORY. Nothing in the campaign path
 * calls this. The asymmetry is deliberate and is F9d's decision, not an
 * oversight.
 *
 * READ-ONLY, AND THE SOURCE GUARD BELOW THIS FILE PROVES IT. Every statement
 * here is a SELECT; there is no writing verb in the module at all, no
 * transaction, and nothing in its call graph reaches `athlete_programmes`.
 */

/**
 * WHAT COUNTS AS SOMETHING A COACH WAS TOLD.
 *
 * ACCEPTED only, which is the same bar `sentEvidenceForContact` sets and for
 * the same reason: a CANCELLED message reached nobody, a FAILED one reached
 * nobody, a DRAFT is a body in a window, and an UNKNOWN_PROVIDER_RESULT is the
 * state that exists precisely because nobody knows. Counting any of them would
 * mark a claim as used on the strength of an email that may not exist.
 *
 * UNKNOWN_PROVIDER_RESULT is the uncomfortable one and is deliberately NOT
 * counted: it blocks the relationship, so it is not nothing, but calling it
 * confirmed would assert a send nobody observed. Under-marking is the error
 * this feature can survive; over-marking is the one that would make an
 * operator drop the only true thing they had to say.
 */
const CONFIRMED_SQL = `
  SELECT s.coach_id, s.rendered_kinds, s.origin,
         COALESCE(s.sent_at, s.drafted_at, s.created_at) AS at
    FROM outreach_send s
   WHERE s.athlete_id = @athleteId
     AND s.coach_id = @coachId
     AND s.state = '${MESSAGE_STATE.ACCEPTED}'
     AND s.rendered_kinds IS NOT NULL
   ORDER BY at, s.id
`;

/**
 * WHAT IS SITTING UNSENT RIGHT NOW, KEPT APART FROM THE ABOVE.
 *
 * Nobody has read it. It is worth showing - regenerating a draft that already
 * carries a claim should not be told the claim is fresh - but it is a
 * different fact and the wording must stay different. Folding the two together
 * would let a body in a window be reported as something a coach was told.
 *
 * At most one open message per relationship (`idx_outreach_send_one_open`), so
 * this reads one row per coach in practice.
 */
const OPEN_SQL = `
  SELECT s.coach_id, s.rendered_kinds, s.origin,
         COALESCE(s.drafted_at, s.created_at) AS at
    FROM outreach_send s
   WHERE s.athlete_id = @athleteId
     AND s.coach_id = @coachId
     AND s.state IN (${OPEN_LIST})
     AND s.rendered_kinds IS NOT NULL
   ORDER BY at, s.id
`;

/** How a use is known. Two facts, never one. */
export const EVIDENCE_USE = Object.freeze({
  /** An ACCEPTED message. A person or a provider said it went. */
  CONFIRMED: 'CONFIRMED',
  /** A message still open on this relationship. Nobody has read it. */
  OPEN: 'OPEN',
});

/**
 * Every kind in a stored row, with its dedupe group.
 *
 * THE GROUP IS WHAT A COACH EXPERIENCES, and it is the registry's own answer
 * rather than a second mapping invented here - `identityOf` is imported from
 * the sequence policy, which owns that definition. "You have a New Zealander
 * now" and "you have had New Zealanders before" are two kinds and one
 * connection, and a marker that missed the second because the first was
 * technically a different kind would be no marker at all.
 */
function entriesOf(row, source) {
  const out = [];
  for (const raw of String(row.rendered_kinds ?? '').split(',')) {
    const kind = raw.trim();
    if (!kind) continue;
    let group = null;
    try { group = identityOf(kind); } catch { group = null; }
    out.push({
      kind,
      group,
      source,
      coachId: row.coach_id,
      origin: row.origin ?? null,
      at: row.at ?? null,
    });
  }
  return out;
}

/**
 * Prior evidence use across a set of coaches, for one athlete.
 *
 * THE UNION IS THE CALLER'S SHAPE, NOT A COMPROMISE IN THE DATA. The manual
 * composer writes ONE body to N selected coaches, so it needs one answer; each
 * entry names the coach it came from, so a caller can say "one of the two
 * selected coaches" rather than implying all of them.
 *
 * @param {string} args.athleteId
 * @param {string[]} args.coachIds  canonical `coaches.id` values. An unknown
 *   id simply matches nothing - no row is created and no history invented.
 * @returns {{confirmed: object[], open: object[]}} one entry per (kind, coach).
 */
export function usedEvidenceForCoaches({ athleteId, coachIds = [] } = {}) {
  const ids = Array.isArray(coachIds)
    ? [...new Set(coachIds.filter((id) => typeof id === 'string' && id))]
    : [];
  if (!athleteId || !ids.length) return { confirmed: [], open: [] };

  const confirmedStmt = db.prepare(CONFIRMED_SQL);
  const openStmt = db.prepare(OPEN_SQL);

  const confirmed = [];
  const open = [];
  for (const coachId of ids) {
    const args = { athleteId, coachId };
    for (const row of confirmedStmt.all(args)) {
      confirmed.push(...entriesOf(row, EVIDENCE_USE.CONFIRMED));
    }
    for (const row of openStmt.all(args)) {
      open.push(...entriesOf(row, EVIDENCE_USE.OPEN));
    }
  }
  return { confirmed, open };
}
