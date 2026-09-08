import db from '../db/client.js';
import { MESSAGE_STATE, OPEN_STATES } from '../../shared/outreachMessageState.js';

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
