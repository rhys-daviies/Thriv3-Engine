import db from '../db/client.js';
import { utcToday } from './time.js';
import { isSuppressed } from './suppressions.js';

/**
 * THE ONE CHECK THAT MAKES CAMPAIGN ATTRIBUTION MEAN ANYTHING.
 *
 * Two tables carry `programme_campaign_id` and they mean different things, so
 * both are written by their own module — relationship provenance by
 * `outreach.js`, per-message attribution by `outreachSend.js`. What they share
 * is the question "is this programme campaign actually the right one for this
 * athlete and this coach", and that is all this module answers.
 *
 * It lives here rather than in `server/lib/campaigns.js` deliberately: that
 * module owns campaign lifecycle and is already large, and this is not a
 * campaign operation. It is a guard the outreach side needs before it writes a
 * foreign key.
 *
 * WHAT IT PREVENTS, concretely. A programme campaign id is an opaque string
 * that arrives from a caller. Without this, one belonging to a different
 * athlete — or to Duke while the message goes to Clemson — would be written
 * without complaint, and every later reading of that campaign's sends would be
 * quietly wrong in a way nothing could detect afterwards.
 */

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const PROGRAMME_CAMPAIGN = db.prepare(`
  SELECT pc.id, pc.college_name, pc.sport, pc.campaign_id,
         pc.state, pc.state_reason,
         c.athlete_id,
         c.state          AS campaign_state,
         c.starts_on,
         -- The OUTBOUND boundary. ends_on is the wider window in which a reply
         -- may still arrive and is deliberately not read here.
         c.outreach_ends_on
  FROM programme_campaigns pc
  JOIN campaigns c ON c.id = pc.campaign_id
  WHERE pc.id = ?
`);

// `email` is selected because the gate checks suppression, which is keyed on
// the address. Without it `isSuppressed(undefined)` quietly answered false.
const COACH = db.prepare('SELECT id, full_name, email, school, sport FROM coaches WHERE id = ?');

/**
 * Resolve a programme campaign and prove it belongs to this athlete and this
 * coach's programme, or refuse.
 *
 * PROGRAMME IDENTITY IS `(college_name, sport)`, which is what every table in
 * this database joins on — `coaches.school`, `outreach_evidence.college_name`,
 * `outreach_send.college_name`, `roster_players.college_name`. All 6,347 coach
 * rows carry a non-null school and sport, and on all 96 existing outreach rows
 * `coaches.school` equals the programme name the send recorded, so the pair is
 * a sound key here rather than an approximation.
 *
 * The sport is checked as well as the name because a school fields two
 * programmes: one person can staff both the men's and the women's side, and
 * `coaches` is keyed on `(email, school, sport)` precisely so those are two
 * rows. Matching on the name alone would let a women's campaign attribute a
 * men's send.
 *
 * @returns {{id, campaign_id, athlete_id, college_name, sport}} the verified row.
 */
export function resolveProgrammeCampaignFor({ programmeCampaignId, athleteId, coachId }) {
  const pc = PROGRAMME_CAMPAIGN.get(programmeCampaignId);
  if (!pc) {
    throw fail('PROGRAMME_CAMPAIGN_NOT_FOUND', `No programme campaign ${programmeCampaignId}`);
  }

  if (pc.athlete_id !== athleteId) {
    // Deliberately does not name the other athlete.
    throw fail(
      'CAMPAIGN_ATHLETE_MISMATCH',
      `Programme campaign ${programmeCampaignId} belongs to a different athlete's campaign. `
      + 'Outreach is attributed to the campaign of the athlete it is sent for.',
    );
  }

  const coach = COACH.get(coachId);
  if (!coach) throw fail('COACH_NOT_FOUND', `No coach ${coachId}`);

  if (coach.school !== pc.college_name || coach.sport !== pc.sport) {
    throw fail(
      'CAMPAIGN_PROGRAMME_MISMATCH',
      `Programme campaign ${programmeCampaignId} is for ${pc.college_name} (${pc.sport}), `
      + `but this coach is at ${coach.school} (${coach.sport}). `
      + 'A message is attributed to the programme campaign for the programme it was sent to.',
    );
  }

  return pc;
}

/* -------------------------------------------------------------------------- */
/* The campaign safety gate                                                    */
/* -------------------------------------------------------------------------- */

/**
 * WHY A CAMPAIGN MAY NOT BE CONTACTED RIGHT NOW.
 *
 * Machine-readable and deliberately NOT collapsed into one refusal: the
 * operator screen that eventually explains "Duke is greyed out" needs to say
 * which of these it is, and a caller must never have to match on a sentence.
 *
 * The three scopes stay separate because they are separate facts about
 * different things:
 *
 *   SUPPRESSED         an ADDRESS, globally, across every athlete and campaign
 *   OUTREACH_REVOKED   one RELATIONSHIP, withdrawn
 *   PROGRAMME_STOPPED  one PROGRAMME in one campaign
 *
 * Collapsing them would lose the difference between "this coach opted out of
 * Thriv3" and "we stopped pursuing Duke for this athlete".
 */
export const CONTACT_REFUSAL = Object.freeze({
  CAMPAIGN_NOT_ACTIVE: 'CAMPAIGN_NOT_ACTIVE',
  CAMPAIGN_NOT_STARTED: 'CAMPAIGN_NOT_STARTED',
  CAMPAIGN_OUTREACH_WINDOW_CLOSED: 'CAMPAIGN_OUTREACH_WINDOW_CLOSED',
  PROGRAMME_STOPPED: 'PROGRAMME_STOPPED',
  PROGRAMME_COMPLETED: 'PROGRAMME_COMPLETED',
  OUTREACH_REVOKED: 'OUTREACH_REVOKED',
  SUPPRESSED: 'SUPPRESSED',
});

/** Programme states outreach may proceed in. Not a transition — a permission. */
const CONTACTABLE_PROGRAMME_STATES = Object.freeze(['queued', 'active']);

const OUTREACH_BY_ID = db.prepare('SELECT id, revoked_at FROM outreach WHERE id = ?');

/**
 * MAY THIS CAMPAIGN CONTACT THIS COACH TODAY?
 *
 * Returns a decision rather than throwing, so the same rules can eventually
 * answer "why is this programme greyed out" without anything having to catch.
 * `assertCampaignContactAllowed` is the throwing form and is what the write
 * path uses.
 *
 * IT DECIDES NOTHING ABOUT WHO OR WHEN. It does not choose a coach, a step, a
 * time or a depth — it answers whether a contact that something else has
 * already chosen is permitted by state we already know.
 *
 * THE DATE IS AN ARGUMENT. Campaign boundaries are timezone-free dates, and
 * resolving "today" for a campaign is a scheduler's job with a timezone it
 * does not have yet. `onDate` is explicit so that decision is visible; the
 * fallback is UTC and is named in `utcToday` rather than inlined here.
 *
 * @returns {{allowed: boolean, reason: string|null, programmeCampaign: object|null}}
 */
export function campaignContactDecision({
  programmeCampaignId, athleteId, coachId, outreachId = null, onDate = utcToday(),
}) {
  // Identity first, and through A6's own rule rather than a second copy of it:
  // the programme campaign exists, belongs to this athlete, and is for this
  // coach's programme and sport. Throws, because a mismatched id is a caller
  // bug rather than a state that changes with time.
  const pc = resolveProgrammeCampaignFor({ programmeCampaignId, athleteId, coachId });

  const refuse = (reason) => ({ allowed: false, reason, programmeCampaign: pc });

  // ---- the campaign ----
  if (pc.campaign_state !== 'active') return refuse(CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE);
  if (onDate < pc.starts_on) return refuse(CONTACT_REFUSAL.CAMPAIGN_NOT_STARTED);
  /**
   * `outreach_ends_on` is the OUTBOUND boundary and `ends_on` is not.
   *
   * They mean different things: outreach stops while the campaign stays open
   * for replies, and a coach answering in the final week is exactly what the
   * service is for. Using `ends_on` here would keep sending into that window.
   * Null means open-ended, which is a legitimate campaign.
   */
  if (pc.outreach_ends_on && onDate > pc.outreach_ends_on) {
    return refuse(CONTACT_REFUSAL.CAMPAIGN_OUTREACH_WINDOW_CLOSED);
  }

  // ---- the programme ----
  if (pc.state === 'stopped') return refuse(CONTACT_REFUSAL.PROGRAMME_STOPPED);
  if (pc.state === 'completed') return refuse(CONTACT_REFUSAL.PROGRAMME_COMPLETED);
  if (!CONTACTABLE_PROGRAMME_STATES.includes(pc.state)) {
    // Unreachable while the enum holds. Fails closed rather than open.
    return refuse(CONTACT_REFUSAL.PROGRAMME_STOPPED);
  }

  // ---- the relationship ----
  /**
   * Revocation withdrew the message. B1 found it killed the public token and
   * stopped nothing else, so a withdrawn relationship could be drafted through
   * again — and the coach would receive a message whose link deliberately does
   * not resolve. It is never cleared here; un-revoking is its own act.
   */
  if (outreachId) {
    const row = OUTREACH_BY_ID.get(outreachId);
    if (row?.revoked_at) return refuse(CONTACT_REFUSAL.OUTREACH_REVOKED);
  }

  /**
   * The address, globally. `sendOutreach` checks this too and keeps doing so —
   * that check is the one every path to a send passes through and is not being
   * moved. This one is defence in depth and, more usefully, it is what lets a
   * decision EXPLAIN a suppressed coach instead of a screen having to ask
   * separately.
   */
  const coach = COACH.get(coachId);
  if (coach && isSuppressed(coach.email)) return refuse(CONTACT_REFUSAL.SUPPRESSED);

  return { allowed: true, reason: null, programmeCampaign: pc };
}

/**
 * The same decision, as a refusal the write path cannot ignore.
 *
 * THE AUTHORITATIVE BOUNDARY. It is reached through
 * `authorisedProgrammeCampaignId` from `createOutreach` and `recordDraft` —
 * the only two functions that write a campaign-attributed row — so a future
 * execution engine cannot produce campaign outreach without passing it. The
 * pre-loop check in `sendOutreach` is a courtesy that avoids twenty identical
 * errors; it is not the guarantee.
 */
export function assertCampaignContactAllowed(args) {
  const decision = campaignContactDecision(args);
  if (!decision.allowed) {
    throw fail(decision.reason, refusalMessage(decision));
  }
  return decision.programmeCampaign;
}

function refusalMessage({ reason, programmeCampaign: pc }) {
  const where = `${pc.college_name} (${pc.sport})`;
  switch (reason) {
    case CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE:
      return `The campaign is ${pc.campaign_state}, so it may not send. Activate it first.`;
    case CONTACT_REFUSAL.CAMPAIGN_NOT_STARTED:
      return `The campaign starts on ${pc.starts_on} and has not started yet.`;
    case CONTACT_REFUSAL.CAMPAIGN_OUTREACH_WINDOW_CLOSED:
      return `The campaign stopped sending new outreach on ${pc.outreach_ends_on}.`;
    case CONTACT_REFUSAL.PROGRAMME_STOPPED:
      return `Outreach to ${where} was stopped${pc.state_reason ? ` — ${pc.state_reason}` : ''}. `
        + 'A programme-level stop covers every coach there.';
    case CONTACT_REFUSAL.PROGRAMME_COMPLETED:
      return `Outreach to ${where} is complete.`;
    case CONTACT_REFUSAL.OUTREACH_REVOKED:
      return 'This outreach was revoked. Its tracking link no longer resolves, so a further '
        + 'message would carry a dead link.';
    case CONTACT_REFUSAL.SUPPRESSED:
      return 'This address has opted out of Thriv3, across every athlete and campaign.';
    default:
      return `Contact refused: ${reason}`;
  }
}

/**
 * Verify AND authorise, or null.
 *
 * Replaces A6's `verifiedProgrammeCampaignId`, which checked identity only.
 * The two callers are unchanged in shape; what passes through them is now
 * gated as well as attributed, which is the whole of B3.
 *
 * `null` in means `null` out with NO checks: legacy and manual outreach has no
 * campaign and is deliberately left exactly as it was.
 */
export function authorisedProgrammeCampaignId({
  programmeCampaignId, athleteId, coachId, outreachId = null, onDate = undefined,
}) {
  if (programmeCampaignId === null || programmeCampaignId === undefined) return null;
  return assertCampaignContactAllowed({
    programmeCampaignId, athleteId, coachId, outreachId,
    ...(onDate === undefined ? {} : { onDate }),
  }).id;
}
