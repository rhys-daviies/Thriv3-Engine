import db from '../db/client.js';
import { utcToday } from './time.js';
import { isSuppressed } from './suppressions.js';
import { campaignStanceDecision, CONTACT_REFUSAL as STANCE_REFUSAL } from './manualOutreachSafety.js';

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
 *
 * F6a adds the two RELATIONSHIP STANCES, and they stay apart from each other
 * for the same reason:
 *
 *   RELATIONSHIP_DO_NOT_CONTACT  nobody may write to this programme, by any
 *                                route. An operator seeing this must change the
 *                                stance or write to somebody else.
 *   RELATIONSHIP_MANUAL_ONLY     the CAMPAIGN may not. A person still may, and
 *                                the operator seeing this is being told which
 *                                button to use, not that the door is shut.
 *
 * One of those is a refusal and the other is a redirection, and a screen that
 * printed the same sentence for both would send an operator to change a safety
 * setting when all they had to do was press Relationship Outreach.
 */
export const CONTACT_REFUSAL = Object.freeze({
  CAMPAIGN_NOT_ACTIVE: 'CAMPAIGN_NOT_ACTIVE',
  CAMPAIGN_NOT_STARTED: 'CAMPAIGN_NOT_STARTED',
  CAMPAIGN_OUTREACH_WINDOW_CLOSED: 'CAMPAIGN_OUTREACH_WINDOW_CLOSED',
  PROGRAMME_STOPPED: 'PROGRAMME_STOPPED',
  PROGRAMME_COMPLETED: 'PROGRAMME_COMPLETED',
  OUTREACH_REVOKED: 'OUTREACH_REVOKED',
  /** Spelled once, in the module that owns the stance vocabulary. */
  RELATIONSHIP_DO_NOT_CONTACT: STANCE_REFUSAL.DO_NOT_CONTACT,
  RELATIONSHIP_MANUAL_ONLY: STANCE_REFUSAL.MANUAL_ONLY,
  SUPPRESSED: 'SUPPRESSED',
});

/**
 * IS THIS REFUSAL WAITING FOR A DAY, OR IS IT A DECISION?
 *
 * Two kinds, because callers need to act on them differently and only the
 * module that owns the codes can classify them without copying the rules.
 *
 *   TIMING       a date or a lifecycle state. The campaign is still a draft,
 *                or has not started, or its outreach window is closed — all
 *                facts about WHEN, all changeable by activating a campaign or
 *                editing its dates. Planning against one is legitimate: that is
 *                exactly how a campaign is prepared before it is activated.
 *
 *   PROHIBITION  a decision about the programme, the relationship or the
 *                person. Stopped, completed, revoked, suppressed, or a stance
 *                the athlete's operator set. Waiting changes none of them, and
 *                recording an intent to pursue somebody nobody may pursue is an
 *                artefact a later execution engine would read back as a queue.
 *
 * The distinction is NOT "would it stop a send" — both kinds do. It is whether
 * the refusal is about time.
 */
export const REFUSAL_KIND = Object.freeze({ TIMING: 'TIMING', PROHIBITION: 'PROHIBITION' });

const TIMING_REFUSALS = Object.freeze(new Set([
  'CAMPAIGN_NOT_ACTIVE',
  'CAMPAIGN_NOT_STARTED',
  'CAMPAIGN_OUTREACH_WINDOW_CLOSED',
]));

/**
 * Every refusal is a prohibition unless it is one of the three dates above.
 *
 * THE CODE ALONE IS NOT ALWAYS ENOUGH, and `CAMPAIGN_NOT_ACTIVE` is the one
 * case: it covers a campaign that has not started yet and one that has ended,
 * which are opposite facts under the same name. This map gives the kind a code
 * carries when nothing refines it; the DECISION is the authority, because only
 * it has read the campaign's state. See the refusal itself below.
 */
export function refusalKindOf(reason) {
  if (!reason) return null;
  return TIMING_REFUSALS.has(reason) ? REFUSAL_KIND.TIMING : REFUSAL_KIND.PROHIBITION;
}

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
  /**
   * WHETHER THE THREE DATE AND LIFECYCLE CHECKS APPLY — see `standingProhibition`.
   *
   * True for every caller that is deciding whether to SEND. False only for the
   * one caller asking a different question: whether a standing prohibition
   * exists at all, irrespective of what day it is.
   */
  timing = true,
}) {
  // Identity first, and through A6's own rule rather than a second copy of it:
  // the programme campaign exists, belongs to this athlete, and is for this
  // coach's programme and sport. Throws, because a mismatched id is a caller
  // bug rather than a state that changes with time.
  const pc = resolveProgrammeCampaignFor({ programmeCampaignId, athleteId, coachId });

  const refuse = (reason, kind = refusalKindOf(reason)) => ({
    allowed: false, reason, kind, programmeCampaign: pc,
  });

  // ---- the campaign ----
  /**
   * DRAFT IS A STATE A CAMPAIGN PASSES THROUGH. CLOSED IS WHERE IT ENDS.
   *
   * One refusal code covers both, which is right for a caller deciding a send —
   * neither may send, and `campaign_state` is on the decision for a screen that
   * wants to say which. It is NOT right for the kind: a draft becomes active by
   * being activated, and a closed campaign becomes nothing. Classifying both as
   * timing let `standingProhibition` skip the check for a campaign that had
   * already ended, so a finished campaign could still record an intent to
   * pursue somebody.
   *
   * So the state refines the kind, and a terminal one is never skipped.
   */
  if (pc.campaign_state !== 'active') {
    const preparing = pc.campaign_state === 'draft';
    if (timing || !preparing) {
      return refuse(
        CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE,
        preparing ? REFUSAL_KIND.TIMING : REFUSAL_KIND.PROHIBITION,
      );
    }
  }
  if (timing && onDate < pc.starts_on) return refuse(CONTACT_REFUSAL.CAMPAIGN_NOT_STARTED);
  /**
   * `outreach_ends_on` is the OUTBOUND boundary and `ends_on` is not.
   *
   * They mean different things: outreach stops while the campaign stays open
   * for replies, and a coach answering in the final week is exactly what the
   * service is for. Using `ends_on` here would keep sending into that window.
   * Null means open-ended, which is a legitimate campaign.
   */
  if (timing && pc.outreach_ends_on && onDate > pc.outreach_ends_on) {
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

  const coach = COACH.get(coachId);

  /**
   * THE ATHLETE'S OWN STANCE ON THIS PROGRAMME — F6a.
   *
   * Read here, which is the ONE place both halves of the campaign machinery
   * pass through: the planner asks this for its dry run, and
   * `authorisedProgrammeCampaignId` asks it from inside `createOutreach` and
   * `recordDraft`, the only two functions that write a campaign-attributed
   * row. So planning and writing cannot disagree, and a future execution
   * engine that never touches the send route still cannot get past it.
   *
   * BEFORE F6a NEITHER STANCE WAS VISIBLE HERE. `do_not_contact` was enforced
   * only inside the send route, so a dry run reported a do-not-contact
   * programme as executable and a direct `recordDraft` wrote through it
   * unchallenged. `manual_only` was enforced nowhere at all.
   *
   * THE IDENTITY IS THE VERIFIED ONE. `pc.college_name` and `pc.sport` come
   * from `resolveProgrammeCampaignFor` above, which has already proved this
   * coach is at that programme — so no request body, email label or origin
   * string reaches the stance lookup. The two stances then differ in REACH,
   * which is the stance module's decision and not re-implemented here.
   */
  const stance = campaignStanceDecision({
    athleteId,
    collegeName: pc.college_name,
    sport: pc.sport,
    coachEmail: coach?.email ?? null,
  });
  if (!stance.allowed) {
    return { ...refuse(stance.reason), stanceProgramme: stance.programme };
  }

  /**
   * The address, globally. `sendOutreach` checks this too and keeps doing so —
   * that check is the one every path to a send passes through and is not being
   * moved. This one is defence in depth and, more usefully, it is what lets a
   * decision EXPLAIN a suppressed coach instead of a screen having to ask
   * separately.
   */
  if (coach && isSuppressed(coach.email)) return refuse(CONTACT_REFUSAL.SUPPRESSED);

  return { allowed: true, reason: null, kind: null, programmeCampaign: pc };
}

/**
 * IS ANYTHING STANDING IN THE WAY, WHATEVER DAY IT IS? — F6b.
 *
 * The same rules as `campaignContactDecision` with the three date and
 * lifecycle checks skipped, so what comes back is a PROHIBITION or nothing.
 *
 * WHY IT EXISTS. Refusals are reported widest-first — a draft campaign whose
 * programme is also stopped reports the campaign, so an operator fixes the
 * outer problem first. That is right for a send, and wrong for the one caller
 * that is not deciding a send: `materialiseNextContactAttempt` records an
 * INTENT, and a campaign being a draft is exactly the state intents are
 * recorded in. Asked the ordinary way, a draft campaign's timing refusal would
 * mask a manual-only or do-not-contact stance underneath it, and the intent
 * would be written against a decision somebody had already made.
 *
 * So this asks the question that caller actually has, through the same
 * function and the same rules rather than a second copy of them.
 */
export function standingProhibition(args) {
  return campaignContactDecision({ ...args, timing: false });
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

function refusalMessage({ reason, programmeCampaign: pc, stanceProgramme = null }) {
  const where = `${pc.college_name} (${pc.sport})`;
  switch (reason) {
    case CONTACT_REFUSAL.RELATIONSHIP_DO_NOT_CONTACT:
      return `${stanceProgramme ?? where} is set to do-not-contact for this athlete. `
        + (stanceProgramme && stanceProgramme !== pc.college_name
          ? `This campaign is for ${where}, but the recipient is on record at `
            + `${stanceProgramme}. `
          : '')
        + 'Nothing was drafted or sent. Change the contact stance on the relationship first.';
    case CONTACT_REFUSAL.RELATIONSHIP_MANUAL_ONLY:
      return `${where} is set to manual contact only for this athlete, so an automated `
        + 'campaign may not write to it. A person still may — send it from Relationship '
        + 'Outreach or Email Coaches, or change the contact stance on the relationship.';
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
