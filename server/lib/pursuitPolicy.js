import db from '../db/client.js';
import {
  classifyRole, hasUsableEmail, titleOf, CONTACT_LADDER,
} from '../../shared/coachRoles.js';
import { isSuppressed } from './suppressions.js';
import {
  campaignContactDecision, standingProhibition, REFUSAL_KIND,
} from './campaignAttribution.js';
import {
  attemptsForProgrammeCampaign, attemptForCoach, createContactAttempt,
  reconcileContactAttemptStep,
} from './contactAttempts.js';
import { outboundBudgetDecision, outboundBudgetDecisionForAthlete } from './outboundBudget.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';
import { priorContactForCoaches, priorContactOf } from './contactIntelligence.js';
import { approvalStatus, APPROVAL_STATUS } from './firstTouchApprovals.js';
import { utcNow, utcToday } from './time.js';

/**
 * WHAT A CAMPAIGN INTENDS TO DO AT ONE PROGRAMME, AND WHY.
 *
 * The first layer that expresses product behaviour rather than safety. B3 says
 * whether a message MAY be sent; B5 says whether there is capacity for one;
 * this says what the next one WOULD be. Three different questions, answered by
 * three modules, composed rather than merged — see the `safety` and `budget`
 * blocks on the plan.
 *
 * ---------------------------------------------------------------------------
 * IT IS PURE. ASKING WHAT THRIV3 WOULD DO WRITES NOTHING.
 *
 * `programmePursuitPlan` performs no INSERT, no UPDATE, mints no token, creates
 * no contact attempt and consumes no budget. That is not tidiness — B7's
 * dry-run runs this across a Top 100, and a planner that materialised as it
 * looked would create three hundred attempts and three hundred permanent
 * tracking tokens for a campaign nobody had approved.
 *
 * `materialiseNextContactAttempt` is the separate, explicit command, and it
 * creates ONE attempt for the ONE coach the plan named.
 * ---------------------------------------------------------------------------
 *
 * WHAT TIER MEANS HERE, since it is the thing most easily misread. Tier is
 * PURSUIT DEPTH: how many people at a programme Thriv3 is willing to approach
 * before it accepts that cold outreach has run out. It is not message quality,
 * not volume, not simultaneity. A Tier C programme gets the same email a Tier A
 * programme gets; it gets it from one person's inbox instead of three.
 */

/**
 * The policy in force, following `OUTREACH_POLICY_VERSION`'s convention: a
 * short opaque token, one constant, no framework.
 *
 * PP1 — the first pursuit policy. Depth 3/2/1 by tier, one initial message and
 * one follow-up per coach, head-coach-first ordering with a recruiting signal
 * ordering assistants, sequential pursuit, four policy days between the
 * initial message and its follow-up.
 *
 * It exists so that changing any of those numbers later cannot silently
 * reinterpret a campaign planned under these. Where a version should eventually
 * be PINNED is a separate question from having one — see the note at the foot
 * of this file.
 */
export const PURSUIT_POLICY_VERSION = 'PP1';

/**
 * HOW MANY PEOPLE MAY BE APPROACHED AT ONE PROGRAMME. A ceiling, not a target.
 *
 * Chosen against the coach data rather than assumed. Across 1,987 programmes
 * the eligible-staff depth is: 1.9% have nobody reachable, 13.4% have one,
 * 35.8% two, 27.1% three and 21.7% four or more. So:
 *
 *   A (ranks 1-20)   3   fully reachable at 48.8% of programmes, and at 72%
 *                        of D1 programmes, which is where a Tier A sits most
 *                        often. A shallower staff simply exhausts sooner.
 *   B (ranks 21-50)  2   reachable at 84.6% of programmes.
 *   C (ranks 51-100) 1   reachable at 98.1%.
 *
 * Read against the depth histogram, three is the point where the marginal
 * coach starts being a goalkeeping specialist or a second assistant rather
 * than someone with a say — and it is the most the brief permits without a
 * compelling reason, which the data does not supply.
 */
export const TIER_COACH_DEPTH = Object.freeze({ A: 3, B: 2, C: 1 });

/**
 * Messages per coach: one initial approach and one follow-up. Two.
 *
 * The existing per-inbox cap is three messages in thirty days and its comment
 * calls that "one full A/B/C sequence" — so the repository's own standing
 * assumption was three. This is deliberately more conservative than that: two
 * is persistence, three to one person who has not answered is pressure, and
 * nothing in the data argues for the third. It also leaves a message of
 * headroom under a cap that exists to protect the recipient.
 */
export const MESSAGES_PER_COACH = 2;

/**
 * POLICY DAYS between the initial message and its follow-up. Not a clock time.
 *
 * Four days is long enough that a coach who was travelling has been back at a
 * desk, and short enough that the follow-up still reads as part of the same
 * conversation.
 *
 * CALENDAR DAYS, NOT WORKING DAYS, and that is a deliberate narrowing. Working
 * days would need a weekend rule and then a holiday calendar, in whichever
 * country the recipient is in — none of which exists here and none of which
 * should be invented for a delay this coarse. The consequence is real and
 * small: a Thursday message becomes eligible on Monday rather than Wednesday.
 *
 * It is a NUMBER OF DAYS and is never resolved into an instant here. Resolving
 * one needs the recipient's or the sender's timezone, which nothing in this
 * build knows, and a UTC arithmetic result would look like a decision that had
 * been made rather than one that had been skipped. Phase E resolves it.
 */
export const FOLLOW_UP_DELAY_DAYS = 4;


/**
 * WHAT WOULD HAPPEN NEXT AT THIS PROGRAMME. Four outcomes, and no more.
 *
 *   INITIAL_OUTREACH          first message of this campaign to the current coach
 *   FOLLOW_UP                 the one permitted second message to that coach
 *   AWAITING_OPERATOR         a response was recorded; a person takes it from here
 *   NO_FURTHER_COLD_OUTREACH  this programme's cold options are used up
 *
 * There is deliberately NO `ADVANCE_TO_NEXT_COACH`. Moving to the next coach is
 * not an action anybody takes — it produces no message and reaches nobody. It
 * is a change in WHO the next action is addressed to, which the plan already
 * says by naming a different current coach and giving PREVIOUS_COACH_EXHAUSTED
 * as the reason. An action that sends nothing would need a step of its own to
 * live on, and B4 was explicit that coach advancement must not become a fake
 * message step.
 */
export const PURSUIT_ACTION = Object.freeze({
  INITIAL_OUTREACH: 'INITIAL_OUTREACH',
  FOLLOW_UP: 'FOLLOW_UP',
  AWAITING_OPERATOR: 'AWAITING_OPERATOR',
  NO_FURTHER_COLD_OUTREACH: 'NO_FURTHER_COLD_OUTREACH',
});

/** Machine-readable, because a screen must never have to match on a sentence. */
export const PURSUIT_REASON = Object.freeze({
  FIRST_CONTACT: 'FIRST_CONTACT',
  NO_RESPONSE_TO_INITIAL: 'NO_RESPONSE_TO_INITIAL',
  PREVIOUS_COACH_EXHAUSTED: 'PREVIOUS_COACH_EXHAUSTED',
  RESPONSE_OBSERVED: 'RESPONSE_OBSERVED',
  /**
   * A MESSAGE TO THIS COACH IS UNRESOLVED — D4.8.
   *
   * Its provider result is unknown, so it may already be in their inbox. The
   * programme is not blocked because a rule says so; it is blocked because
   * nobody knows what happened, and the only honest next action is a person
   * reconciling it. It is deliberately NOT a reason to move to the next coach:
   * the ambiguity belongs to this relationship and follows it.
   */
  UNRESOLVED_SEND: 'UNRESOLVED_SEND',
  TIER_DEPTH_REACHED: 'TIER_DEPTH_REACHED',
  NO_ELIGIBLE_COACHES: 'NO_ELIGIBLE_COACHES',
  ALL_COACHES_EXHAUSTED: 'ALL_COACHES_EXHAUSTED',
});

/**
 * WHY A PERSON HAS TO LOOK BEFORE THIS CAMPAIGN WRITES — F6d.
 *
 * PRIOR_CONFIRMED_CONTACT is the only one so far, and it is not a refusal. The
 * campaign is about to send what reads as a first approach to somebody this
 * athlete has already written to — by hand, or under a campaign that has since
 * closed. Sending it is very often still right; sending it WITHOUT ANYBODY
 * KNOWING is not, because the message will introduce an athlete the coach has
 * already met.
 */
export const FIRST_TOUCH_REVIEW = Object.freeze({
  PRIOR_CONFIRMED_CONTACT: 'PRIOR_CONFIRMED_CONTACT',
});

/**
 * THE REFUSAL CODE FOR THAT HOLD, WHEREVER IT BITES. Spelled once, here.
 *
 * Three things refuse on it and they must be the same refusal, not three that
 * happen to read alike: `campaignFirstTouchGate` stops a campaign-attributed
 * send, `contactAttemptPreparation` stops an intent being recorded, and the
 * prepare endpoint reports it. The gate re-exports this under its own name so
 * its callers are unchanged; it lives here because this module owns the
 * derivation that decides the hold in the first place.
 */
export const FIRST_TOUCH_REVIEW_REQUIRED = 'CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED';

/**
 * WHY A NEW CONTACT ATTEMPT MAY NOT BE PREPARED — F9b-2.
 *
 * Only the reasons this module has to NAME itself. Everything B3 can say is
 * quoted from `CONTACT_REFUSAL` rather than repeated, so a stance or a stopped
 * programme reaches a caller under the code B3 gave it.
 *
 *   ALREADY_PREPARED      an attempt exists for the coach the plan names. NOT a
 *                         prohibition and not an error: there is simply nothing
 *                         NEW to prepare, which is why it refuses the decision
 *                         while the endpoint still answers 200 with the row.
 *   NO_ELIGIBLE_COACH     nobody at this programme is a candidate — every
 *                         address suppressed, unusable, or nobody on file.
 *   NO_ACTION_TO_PREPARE  there is a coach, but no cold message to prepare: a
 *                         reply is waiting for a person, or the programme's
 *                         allowance is spent.
 */
export const PREPARATION_REFUSAL = Object.freeze({
  ALREADY_PREPARED: 'ALREADY_PREPARED',
  NO_ELIGIBLE_COACH: 'NO_ELIGIBLE_COACH',
  NO_ACTION_TO_PREPARE: 'NO_ACTION_TO_PREPARE',
  FIRST_TOUCH_REVIEW_REQUIRED,
});

const NO_REVIEW_NEEDED = Object.freeze({
  status: APPROVAL_STATUS.NONE, approvedAt: null, approvedByOperatorId: null,
});
const NO_FIRST_TOUCH_REVIEW = Object.freeze({
  required: false, reason: null, approval: NO_REVIEW_NEEDED,
});

/**
 * DOES THIS FIRST APPROACH NEED A PERSON FIRST?
 *
 * GATED ON INITIAL_OUTREACH, and that gate is the whole rule. After this
 * campaign's own step 1, prior contact is EXPECTED to be true — the campaign
 * put it there — so applying this to a follow-up would stop every second
 * message in the product on evidence of its own first one.
 *
 * READS `hasConfirmedSend`, NEVER THE COUNT. A relationship older than the
 * per-message table reports `confirmedSendCount: 0` with a confirmed send on
 * file, so counting would wave through exactly the coaches with the longest
 * history — see the note on that field in contactIntelligence.js.
 *
 * IT CONSUMES THE FACT F6c ALREADY PUT ON THE COACH, so the history costs no
 * query here and there is no second definition of "confirmed". The only read
 * is one indexed point lookup for the approval, and only where a review would
 * otherwise be required — a campaign with no prior contact anywhere asks this
 * table nothing.
 *
 * AN APPROVAL CLEARS THE HOLD AND NOTHING ELSE. It is reported either way, so
 * a screen can tell an unreviewed first touch from one a person has already
 * looked at, and a STALE approval — history has moved since it was given —
 * from no approval at all.
 */
function firstTouchReviewFor(nextAction, coach, programmeCampaignId) {
  if (nextAction !== PURSUIT_ACTION.INITIAL_OUTREACH) return NO_FIRST_TOUCH_REVIEW;
  if (coach?.priorContact?.hasConfirmedSend !== true) return NO_FIRST_TOUCH_REVIEW;

  const approval = approvalStatus({
    programmeCampaignId, coachId: coach.coachId, priorContact: coach.priorContact,
  });
  return Object.freeze({
    /**
     * STALE IS NOT APPROVED. Somebody reviewed two messages and three are on
     * file now, so the sentence they agreed to is no longer true of what is
     * there — and the honest state is unreviewed, not approved-enough.
     */
    required: approval.status !== APPROVAL_STATUS.CURRENT,
    reason: approval.status === APPROVAL_STATUS.CURRENT
      ? null
      : FIRST_TOUCH_REVIEW.PRIOR_CONFIRMED_CONTACT,
    approval,
  });
}

/** Why somebody on the staff list is not a candidate for cold pursuit. */
export const INELIGIBLE_REASON = Object.freeze({
  ROLE_NOT_PURSUED: 'ROLE_NOT_PURSUED',
  NO_USABLE_EMAIL: 'NO_USABLE_EMAIL',
  DUPLICATE_ADDRESS: 'DUPLICATE_ADDRESS',
  SUPPRESSED: 'SUPPRESSED',
  TEAM_INBOX_NOT_NEEDED: 'TEAM_INBOX_NOT_NEEDED',
});

/**
 * The roles a cold campaign approaches, and the roles it does not.
 *
 * Taken from the shipped classifier rather than a second opinion of it:
 * volunteers, graduate assistants, operations, support and performance staff
 * are already excluded there, and 5.2% of rows are graduate assistants and
 * 3.4% volunteers — a policy that reached them would spend an athlete's single
 * approach on somebody with no say.
 *
 * A goalkeeper coach is pursued only for a goalkeeper, which is `shouldContact`'s
 * existing rule and is applied here through the athlete's own position.
 */
const PURSUED_ROLES = Object.freeze(['head', 'associate-head', 'assistant']);

/**
 * A shared team inbox is a LAST RESORT, never one of several approaches.
 *
 * 168 programmes list one and 35 programmes have nothing else at all — for
 * those it is the difference between reaching the programme and skipping it.
 * But it is not a person, so it must never be coach two of three alongside
 * real staff: that is one recipient receiving the campaign twice.
 */
const FALLBACK_ROLE = 'team-email';

const norm = (email) => (email || '').trim().toLowerCase();

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/* -------------------------------------------------------------------------- */
/* Facts                                                                       */
/* -------------------------------------------------------------------------- */

const PROGRAMME_CAMPAIGN = db.prepare(`
  SELECT pc.id, pc.campaign_id, pc.college_name, pc.sport, pc.rank, pc.tier,
         pc.tier_source, pc.state,
         c.athlete_id, c.state AS campaign_state, c.starts_on,
         p.position AS athlete_position
  FROM programme_campaigns pc
  JOIN campaigns c ON c.id = pc.campaign_id
  JOIN players p ON p.id = c.athlete_id
  WHERE pc.id = ?
`);

// ORDER BY id so the base list is stable before policy sorts it. Without it
// the tie-break below would be applied to whatever order the page happened to
// return, and 91 programmes list more than one head coach.
const STAFF = db.prepare(
  'SELECT * FROM coaches WHERE school = ? AND sport = ? ORDER BY id',
);

/**
 * ACCEPTED MESSAGES TO THIS COACH UNDER THIS CAMPAIGN. The campaign-local count.
 *
 * Filtered on `programme_campaign_id`, which is what makes it campaign-local
 * rather than lifetime. A coach written to three times by last season's
 * campaign has three rows in `outreach_send` and ZERO here, so this campaign's
 * first message to them is its step one — which is precisely the distinction
 * A6 put the column on the message for, and the one B4 said must not collapse.
 *
 * ACCEPTED only. A draft is not a message that happened, and planning around
 * one would let an unsent draft consume a coach's allowance.
 */
const ACCEPTED_FOR_COACH = db.prepare(`
  SELECT COUNT(*) AS n, MAX(sent_at) AS last_accepted_at FROM outreach_send
  WHERE coach_id = @coachId AND athlete_id = @athleteId
    AND programme_campaign_id = @programmeCampaignId
    AND state = '${MESSAGE_STATE.ACCEPTED}'
`);

/**
 * WHAT ELSE HAPPENED TO THIS CAMPAIGN'S MESSAGES TO THIS COACH — D4.8.
 *
 * ===========================================================================
 * AN EXECUTION THAT DID NOT LAND IS STILL SOMETHING THAT HAPPENED.
 *
 * `messagesSent` counts ACCEPTED and nothing else, which is right — only an
 * accepted message advances a step or starts a follow-up clock. But it left a
 * programme where a send was definitely refused looking identical to one where
 * nothing had ever been attempted, and an operator reading "FIRST_CONTACT"
 * after a rejection is being told a fiction.
 *
 * So the other outcomes are counted BESIDE it and act on nothing. `failed` is
 * reported so the screen can say a send was attempted and refused; `unresolved`
 * is reported AND blocks, because a message that may be in somebody's inbox is
 * not a state a campaign may write past.
 *
 * Deliberately no change to step arithmetic, coach depth or exhaustion.
 * ===========================================================================
 */
const EXECUTION_OUTCOMES_FOR_COACH = db.prepare(`
  SELECT
    SUM(CASE WHEN state = '${MESSAGE_STATE.FAILED}' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN state = '${MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT}' THEN 1 ELSE 0 END) AS unresolved,
    MAX(CASE WHEN state = '${MESSAGE_STATE.FAILED}' THEN drafted_at END) AS last_failed_at
  FROM outreach_send
  WHERE coach_id = @coachId AND athlete_id = @athleteId
    AND programme_campaign_id = @programmeCampaignId
`);

/**
 * Whether a person recorded that this coach replied.
 *
 * The only truthful reply fact in the build. It is operator-set through
 * /api/engagement/outreach/:id/responded, it lives on the relationship rather
 * than on a message, and there are two of them on file. Nothing ingests
 * replies, nothing classifies them, and this claims neither.
 */
const RESPONDED = db.prepare(`
  SELECT r.responded_at FROM engagement_rollup r
  JOIN outreach o ON o.id = r.outreach_id
  WHERE o.athlete_id = @athleteId AND o.coach_id = @coachId
    AND r.responded_at IS NOT NULL
  ORDER BY r.responded_at LIMIT 1
`);

const OUTREACH_FOR = db.prepare(
  'SELECT id FROM outreach WHERE athlete_id = ? AND coach_id = ?',
);

/* -------------------------------------------------------------------------- */
/* Eligibility and ordering                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Which assistant, when a programme lists several — and 847 of them do.
 *
 * The same ladder `pickBestContact` already uses, kept identical on purpose so
 * the planner's first coach is the person the drafting CLI would have written
 * to. A recruiting coordinator is the one whose job this email is; 99 rows
 * carry the signal, across 97 programmes.
 *
 * IT DOES NOT PROMOTE THEM ABOVE THE HEAD COACH, and that is a deliberate
 * refusal of an obvious-looking improvement. The signal covers 4.9% of
 * programmes, 63 of its 99 rows are assistants who would be reached anyway at
 * Tier A depth, and there is no outcome data on file that says a coordinator
 * answers more often than a head coach. Promoting them would change first
 * contact for 97 programmes on a hunch, and disagree with every email the
 * system has already sent. It is a question for the learning layer.
 */
const ASSISTANT_PRIORITY = [
  [/recruit/i, 0],
  [/\bfirst\b|\bsenior\b|associate/i, 1],
];

function assistantRank(title) {
  for (const [pattern, rank] of ASSISTANT_PRIORITY) if (pattern.test(title || '')) return rank;
  return 2;
}

/**
 * THE ORDER STAFF ARE APPROACHED IN, and it is total.
 *
 *   1. the contact ladder    head, associate head, assistant, goalkeeper
 *   2. recruiting signal     among assistants only
 *   3. name                  so a programme with two head coaches is stable
 *   4. coach id              so two coaches with one name still order
 *
 * Rungs 3 and 4 are the part that matters most and reads as least important.
 * `pickBestContact` stops at rung 2 and takes whatever the query returned
 * first, which is fine when it is choosing ONE contact and is not fine when a
 * plan has to produce the same sequence of three every time it is asked.
 */
function pursuitOrder(a, b) {
  const rung = (c) => {
    const i = CONTACT_LADDER.indexOf(c.role);
    return i === -1 ? CONTACT_LADDER.length : i;
  };
  return rung(a) - rung(b)
    || (a.role === 'assistant' ? assistantRank(a.title) - assistantRank(b.title) : 0)
    || (a.name || '').localeCompare(b.name || '')
    || a.coachId.localeCompare(b.coachId);
}

/**
 * WHO MAY BE PURSUED AT THIS PROGRAMME, in order, and who may not, with why.
 *
 * Uses existing coach facts only: the classified role, the address, its status
 * and the global suppression list. There is no preferred-contact intelligence
 * to consult and none is invented.
 *
 * `emailStatus` travels with every candidate and NOTHING TREATS `inferred` AS
 * CONFIRMED. 18.3% of addresses were derived from a programme's pattern rather
 * than read off a page, and they are pursued — the drafting CLI has always
 * included them, and `--skip-inferred` is opt-in — but the plan says which is
 * which so a caller can decide differently without this having decided for it.
 */
function candidates(staff, { athletePosition }) {
  const ineligible = [];
  const isKeeper = String(athletePosition || '').toUpperCase().startsWith('GOALKEEP');

  const rows = staff.map((c) => ({
    coachId: c.id,
    name: c.full_name,
    email: c.email,
    title: titleOf(c),
    role: classifyRole(c.position_title),
    emailStatus: c.email_status || 'unknown',
    usable: hasUsableEmail(c),
  }));

  const contactable = [];
  for (const c of rows) {
    if (!c.usable) { ineligible.push({ ...c, reason: INELIGIBLE_REASON.NO_USABLE_EMAIL }); continue; }
    const pursued = PURSUED_ROLES.includes(c.role) || (c.role === 'goalkeeper' && isKeeper);
    if (!pursued && c.role !== FALLBACK_ROLE) {
      ineligible.push({ ...c, reason: INELIGIBLE_REASON.ROLE_NOT_PURSUED });
      continue;
    }
    contactable.push(c);
  }

  /**
   * SORTED BEFORE DEDUPLICATED, and the order of those two steps is the whole
   * correctness of this function.
   *
   * ONE ADDRESS, ONE APPROACH: `soccer@duke.edu` listed once as a team inbox
   * and once beside a named coach is ONE RECIPIENT, and pursuing both would
   * send the same programme the same campaign twice — from one athlete, on the
   * same day, which no per-inbox cap keyed on distinct athletes would even
   * notice.
   *
   * WHICH ROW SURVIVES IS NOT ARBITRARY. Deduplicating first would keep
   * whichever row the query happened to return earliest and drop the other, so
   * a shared address could keep the anonymous team-inbox row and discard the
   * head coach who shares it — losing the name the greeting needs, and making
   * the plan depend on row order. Sorting first makes the survivor the
   * highest-priority row for that address, every time.
   */
  contactable.sort(pursuitOrder);

  const eligible = [];
  const fallback = [];
  const seen = new Set();
  for (const c of contactable) {
    const key = norm(c.email);
    if (seen.has(key)) { ineligible.push({ ...c, reason: INELIGIBLE_REASON.DUPLICATE_ADDRESS }); continue; }
    seen.add(key);

    if (isSuppressed(c.email)) {
      ineligible.push({ ...c, reason: INELIGIBLE_REASON.SUPPRESSED });
      continue;
    }

    if (c.role === FALLBACK_ROLE) fallback.push(c);
    else eligible.push(c);
  }

  // The shared inbox joins the list only when there is nobody else, and then
  // only one of them. 35 programmes have nothing else on file.
  if (!eligible.length && fallback.length) {
    eligible.push(fallback[0]);
    for (const c of fallback.slice(1)) {
      ineligible.push({ ...c, reason: INELIGIBLE_REASON.TEAM_INBOX_NOT_NEEDED });
    }
  } else {
    for (const c of fallback) {
      ineligible.push({ ...c, reason: INELIGIBLE_REASON.TEAM_INBOX_NOT_NEEDED });
    }
  }

  return { eligible, ineligible };
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * WHAT THIS CAMPAIGN WOULD DO NEXT AT THIS PROGRAMME.
 *
 * Deterministic and side-effect free: the same rows always produce the same
 * plan, and asking never changes anything.
 *
 * TIER, NEVER RANK. Depth comes from `programme_campaigns.tier`, which an
 * operator may have changed. A programme the model ranked 45th and an operator
 * promoted to A receives Tier A depth; recomputing the tier from the rank here
 * would quietly discard the operator's decision, which is the one thing the
 * mutable column exists to record.
 *
 * @param {string}  args.programmeCampaignId
 * @param {string}  [args.onDate]           passed to B3, never used by policy
 * @param {string}  [args.sendingIdentity]  when given, B5 budget is reported
 * @param {object}  [args.window]           the budget window, B5's shape
 */
export function programmePursuitPlan({
  programmeCampaignId, onDate = undefined, sendingIdentity = null, window = undefined,
} = {}) {
  const pc = PROGRAMME_CAMPAIGN.get(programmeCampaignId);
  if (!pc) {
    throw fail('PROGRAMME_CAMPAIGN_NOT_FOUND', `No programme campaign ${programmeCampaignId}`);
  }

  const depth = TIER_COACH_DEPTH[pc.tier];
  if (depth === undefined) {
    // Unreachable while the tier CHECK holds. Fails closed rather than
    // silently pursuing nobody or everybody.
    throw fail('UNKNOWN_TIER', `No pursuit depth is defined for tier ${JSON.stringify(pc.tier)}`);
  }

  const staff = STAFF.all(pc.college_name, pc.sport);
  const { eligible, ineligible } = candidates(staff, { athletePosition: pc.athlete_position });

  // Attempts already on file, for explainability. The plan does NOT depend on
  // them: policy reads execution history, so a plan is right even where
  // nothing has advanced B4's counter. See `step` below.
  const attempts = attemptsForProgrammeCampaign(programmeCampaignId);
  const attemptByCoach = new Map(attempts.map((a) => [a.coach_id, a]));

  /**
   * WHERE EACH CANDIDATE STANDS, from what actually happened.
   *
   * `messagesSent` is the campaign-local count of ACCEPTED messages. It is the
   * authority for the policy step, in preference to B4's stored `step`,
   * because it cannot be wrong: it is a count of messages that exist. The
   * stored step is reported beside it as the attempt's own record, and B7 is
   * what will keep the two in step when it executes.
   */
  /**
   * LIFETIME PRIOR CONTACT, IN ONE STATEMENT FOR THE WHOLE PLAN — F6c.
   *
   * Asked once for the coaches this plan could name, never per coach and never
   * as a whole-athlete sweep per programme: a hundred-programme dry run adds a
   * hundred bounded statements, not a hundred times the depth.
   *
   * IT CHANGES NOTHING BELOW IT. `messagesSent`, `step`, `exhausted` and the
   * action are computed exactly as they were, from the campaign-local count.
   * This rides alongside as a fact, and what a campaign should DO about a coach
   * who has heard from this athlete before is a separate decision nobody has
   * made yet.
   */
  const pursued = eligible.slice(0, Math.max(depth, 0));
  const priorContact = priorContactForCoaches({
    athleteId: pc.athlete_id, coachIds: pursued.map((c) => c.coachId),
  });

  const withHistory = pursued.map((c, i) => {
    const accepted = ACCEPTED_FOR_COACH.get({
      coachId: c.coachId, athleteId: pc.athlete_id, programmeCampaignId,
    });
    const messagesSent = accepted.n;
    const outcomes = EXECUTION_OUTCOMES_FOR_COACH.get({
      coachId: c.coachId, athleteId: pc.athlete_id, programmeCampaignId,
    });
    const responded = RESPONDED.get({ athleteId: pc.athlete_id, coachId: c.coachId })?.responded_at ?? null;
    /**
     * A RESPONSE COUNTS ONLY IF IT CAME AFTER THIS CAMPAIGN STARTED.
     *
     * `responded_at` sits on the lifetime relationship, so a reply to last
     * season's campaign would otherwise silence this one for ever — and the
     * standing rule is that a new campaign cycle may legitimately re-engage a
     * coach an older campaign spoke to. Compared as a date because
     * `starts_on` is a timezone-free date and there is nothing here to
     * resolve it with.
     */
    const respondedThisCampaign = Boolean(responded)
      && String(responded).slice(0, 10) >= pc.starts_on;
    const attempt = attemptByCoach.get(c.coachId) ?? null;
    return {
      ...c,
      order: i + 1,
      messagesSent,
      /**
       * WHEN THE LAST ACCEPTED MESSAGE OF THIS CAMPAIGN WENT TO THEM.
       *
       * Reported rather than acted on: this module owns how many days a
       * follow-up waits and never resolves that into an instant. It is here
       * because the campaign-local message history is this module's question,
       * and a caller working out follow-up eligibility should not have to ask
       * it a second time with a query of its own.
       *
       * Null where a message was accepted without a timestamp, which is not
       * reachable through `acceptSend` and is exactly the case a caller must
       * not silently treat as "due now".
       */
      lastAcceptedAt: accepted.last_accepted_at ?? null,
      /**
       * EXECUTIONS THAT DID NOT LAND — D4.8. Reported, never counted as
       * messages. `failedSends` distinguishes "nothing was attempted" from "an
       * attempt was refused before the provider accepted it"; `unresolvedSends`
       * is the one that blocks, below.
       */
      failedSends: outcomes.failed ?? 0,
      unresolvedSends: outcomes.unresolved ?? 0,
      lastFailedAt: outcomes.last_failed_at ?? null,
      respondedAt: respondedThisCampaign ? responded : null,
      priorCampaignResponseAt: responded && !respondedThisCampaign ? responded : null,
      /**
       * WHAT THIS ATHLETE HAS EVER SENT THIS COACH, from any origin and any
       * campaign, including this one. Reported beside the campaign-local count
       * and deliberately not merged with it: a coach on message one of this
       * campaign who was written to by hand last month has `messagesSent: 0`
       * and `priorContact.hasConfirmedSend: true`, and both are correct.
       */
      priorContact: priorContactOf(priorContact, c.coachId),
      attemptId: attempt?.id ?? null,
      attemptState: attempt?.state ?? null,
      attemptStep: attempt?.step ?? null,
      /** When the intent was recorded. B7 reports it; nothing here acts on it. */
      attemptCreatedAt: attempt?.created_at ?? null,
      stopped: attempt?.state === 'stopped',
      exhausted: messagesSent >= MESSAGES_PER_COACH,
    };
  });

  const beyondDepth = eligible.slice(Math.max(depth, 0)).map((c) => ({
    ...c, reason: PURSUIT_REASON.TIER_DEPTH_REACHED,
  }));

  const plan = {
    policyVersion: PURSUIT_POLICY_VERSION,
    programmeCampaign: {
      id: pc.id,
      collegeName: pc.college_name,
      sport: pc.sport,
      rank: pc.rank,
      tier: pc.tier,
      tierSource: pc.tier_source,
      state: pc.state,
    },
    campaign: { id: pc.campaign_id, athleteId: pc.athlete_id, state: pc.campaign_state },
    coachDepth: depth,
    messagesPerCoach: MESSAGES_PER_COACH,
    followUpDelayDays: FOLLOW_UP_DELAY_DAYS,
    coaches: withHistory,
    beyondDepth,
    ineligible,
    attempts,
    current: null,
    step: null,
    nextAction: PURSUIT_ACTION.NO_FURTHER_COLD_OUTREACH,
    reason: PURSUIT_REASON.NO_ELIGIBLE_COACHES,
    exhausted: true,
    /**
     * SIDE BY SIDE WITH THE ACTION, NEVER FOLDED INTO IT. The action, the step
     * and the reason are what policy would do; this is whether somebody should
     * look first. Collapsing them would make a campaign that pauses for review
     * indistinguishable from one with nothing left to say.
     */
    firstTouchReview: NO_FIRST_TOUCH_REVIEW,
    /** B3 with the dates skipped — see `prohibitionFrom`. Always present. */
    prohibition: { allowed: false, reason: 'NO_CURRENT_COACH', kind: null },
  };

  /**
   * ONE COACH AT A TIME, WHICH IS THE PRODUCT RULE THIS SHAPE ENFORCES.
   *
   * The plan names exactly one current coach and exactly one next action, so
   * it is structurally incapable of proposing that two people at a programme
   * be written to at once. The next coach becomes reachable only once the
   * previous one's allowance is spent, and "spent" is counted in messages that
   * exist rather than in intentions.
   */
  const responder = withHistory.find((c) => c.respondedAt);
  if (responder) {
    /**
     * A REPLY STOPS THE PROGRAMME, NOT JUST THE COACH. The programme is the
     * decision unit above the individual: once somebody at Duke has answered,
     * cold-emailing two more people at Duke is not persistence, it is a
     * conversation being ignored by the thing that started it.
     *
     * It says AWAITING_OPERATOR rather than stopping anything, because nothing
     * here knows what the reply said. Reading intent out of a recorded reply
     * is classification, and there is none.
     */
    return {
      ...plan,
      current: responder,
      step: null,
      nextAction: PURSUIT_ACTION.AWAITING_OPERATOR,
      reason: PURSUIT_REASON.RESPONSE_OBSERVED,
      exhausted: false,
      ...safetyAndBudget({ pc, coach: responder, onDate, sendingIdentity, window }),
    };
  }

  /**
   * ---- A MESSAGE NOBODY CAN ACCOUNT FOR STOPS THE PROGRAMME — D4.8 --------
   *
   * ===========================================================================
   * IT BLOCKS, AND IT DOES NOT MOVE TO THE NEXT COACH.
   *
   * A send in UNKNOWN_PROVIDER_RESULT may already be in that coach's inbox. So
   * the honest next action is not another email to them, and it is not an email
   * to their colleague either: moving down the staff list would turn "we do not
   * know what we sent" into a reason to send more, which is the opposite of
   * what the state means. The ambiguity belongs to this relationship and the
   * programme waits with it.
   *
   * ASKED BEFORE THE CURRENT COACH IS CHOSEN, and the unresolved coach is
   * returned as `current`, so a screen shows the person who needs reconciling
   * rather than the next one in the queue.
   *
   * AWAITING_OPERATOR, following the reply branch above: nothing here can
   * resolve it, and only a person looking at a sent mailbox can. D4.4's states
   * are the authority; this reads them and adds no flag of its own.
   * ===========================================================================
   */
  const unresolved = withHistory.find((c) => c.unresolvedSends > 0);
  if (unresolved) {
    return {
      ...plan,
      current: unresolved,
      step: null,
      nextAction: PURSUIT_ACTION.AWAITING_OPERATOR,
      reason: PURSUIT_REASON.UNRESOLVED_SEND,
      exhausted: false,
      ...safetyAndBudget({ pc, coach: unresolved, onDate, sendingIdentity, window }),
    };
  }

  const current = withHistory.find((c) => !c.exhausted && !c.stopped);
  if (!current) {
    return {
      ...plan,
      reason: withHistory.length
        ? PURSUIT_REASON.ALL_COACHES_EXHAUSTED
        : PURSUIT_REASON.NO_ELIGIBLE_COACHES,
      ...safetyAndBudget({ pc, coach: null, onDate, sendingIdentity, window }),
    };
  }

  const step = current.messagesSent + 1;
  const isFirstCoach = current.order === 1;
  const nextAction = step === 1 ? PURSUIT_ACTION.INITIAL_OUTREACH : PURSUIT_ACTION.FOLLOW_UP;
  return {
    ...plan,
    current,
    // The CAMPAIGN-LOCAL step: 1 means the initial message is next, 2 means the
    // follow-up is. It is derived, and it never inherits a lifetime sequence.
    step,
    nextAction,
    reason: step > 1
      ? PURSUIT_REASON.NO_RESPONSE_TO_INITIAL
      : (isFirstCoach ? PURSUIT_REASON.FIRST_CONTACT : PURSUIT_REASON.PREVIOUS_COACH_EXHAUSTED),
    exhausted: false,
    firstTouchReview: firstTouchReviewFor(nextAction, current, pc.id),
    ...safetyAndBudget({ pc, coach: current, onDate, sendingIdentity, window }),
  };
}

/**
 * WOULD is not MAY, and MAY is not CAN AFFORD TO.
 *
 * Composed, never merged and never re-derived. B3 owns whether a contact is
 * permitted and B5 owns whether there is capacity; this asks them and reports
 * what they said. A plan therefore still EXISTS for a draft campaign, a
 * stopped programme or an exhausted budget — it simply is not executable, and
 * the reason says which of the three it is.
 */
function safetyAndBudget({ pc, coach, onDate, sendingIdentity, window }) {
  if (!coach) {
    return {
      safety: { evaluated: false, reason: 'NO_CURRENT_COACH', allowed: false, kind: null },
      budget: { evaluated: false, reason: 'NO_CURRENT_COACH' },
      // Nothing to prohibit and nobody to prohibit it for. The preparation
      // decision refuses on the missing coach, not on this.
      prohibition: { allowed: false, reason: 'NO_CURRENT_COACH', kind: null },
      executableNow: false,
    };
  }

  /**
   * The RELATIONSHIP is handed to B3 when there is one, and that is not
   * optional decoration: revocation is a fact about a relationship, and B3
   * cannot see it without the id. Omitting it left a revoked outreach looking
   * contactable — the plan would have proposed a message whose tracking link
   * deliberately no longer resolves.
   */
  const relationshipForSafety = OUTREACH_FOR.get(pc.athlete_id, coach.coachId);

  let safety;
  try {
    const decision = campaignContactDecision({
      programmeCampaignId: pc.id,
      athleteId: pc.athlete_id,
      coachId: coach.coachId,
      outreachId: relationshipForSafety?.id ?? null,
      ...(onDate === undefined ? {} : { onDate }),
    });
    safety = {
      evaluated: true, allowed: decision.allowed, reason: decision.reason, kind: decision.kind,
    };
  } catch (err) {
    /**
     * Identity refusals throw in B3 because they are caller bugs. Reported
     * rather than swallowed, and never re-implemented here.
     *
     * Classed as a PROHIBITION without asking: a mismatched athlete or a
     * programme campaign that does not exist is not a thing that becomes true
     * tomorrow, and the conservative reading is the right one for a class that
     * decides whether an intent may be recorded.
     */
    safety = {
      evaluated: true,
      allowed: false,
      reason: err.code ?? 'CONTACT_CHECK_FAILED',
      kind: REFUSAL_KIND.PROHIBITION,
    };
  }

  const budget = budgetStatus({ pc, coach, sendingIdentity, window });
  return {
    safety,
    budget,
    prohibition: prohibitionFrom(safety, { pc, coach, outreachId: relationshipForSafety?.id ?? null }),
    executableNow: safety.allowed && budget.allowed === true,
  };
}

/**
 * IS ANYTHING STANDING IN THE WAY, WHATEVER DAY IT IS — derived, not re-asked.
 *
 * `safety` above is B3 asked the way a SEND asks it, with the dates. Preparation
 * asks the same rules with the three date and lifecycle checks skipped, and in
 * two of the three cases the answer is already in front of us:
 *
 *   ALLOWED       every check passed, and timing=false runs a strict SUBSET of
 *                 them, so it passes too.
 *   PROHIBITION   the refusal is already one of the checks timing=false keeps,
 *                 and it sits after the skipped ones — so the same code comes
 *                 back for the same reason.
 *   TIMING        and only here. A date refusal MASKS whatever is underneath it:
 *                 a draft campaign whose programme is also stopped reports the
 *                 campaign. This is the one case that has to be asked properly,
 *                 and it is asked through `standingProhibition` — B3's own
 *                 function with its own rules, never a copy of them here.
 *
 * SO IT COSTS NOTHING ON AN ACTIVE CAMPAIGN and one decision per programme on a
 * draft one, which is exactly where preparing is the point. Before this the
 * materialiser asked B3 a second time on EVERY call, including the common case
 * where the first answer already settled it.
 */
function prohibitionFrom(safety, { pc, coach, outreachId }) {
  if (!safety.evaluated) return { allowed: false, reason: safety.reason, kind: safety.kind };
  if (safety.allowed) return { allowed: true, reason: null, kind: null, programmeCampaign: null };
  if (safety.kind !== REFUSAL_KIND.TIMING) {
    return { allowed: false, reason: safety.reason, kind: safety.kind };
  }
  return standingProhibition({
    programmeCampaignId: pc.id,
    athleteId: pc.athlete_id,
    coachId: coach.coachId,
    outreachId,
  });
}

/**
 * B5's answer, asked properly or not asked at all.
 *
 * TWO ENTRY POINTS, ONE RULE. `outboundBudgetDecision` identifies the athlete
 * through a RELATIONSHIP, because a consuming caller must never be able to name
 * one; `outboundBudgetDecisionForAthlete` is the read-only form that takes the
 * athlete directly. A first approach has no relationship yet — creating one
 * mints a permanent token, which planning must never do — so the read-only form
 * is what a dry run uses, and both reach the same `used < limit` in B5 rather
 * than a copy of it here.
 *
 * The athlete passed to it is the CAMPAIGN'S OWN, read from the campaign row
 * rather than accepted from a caller, so nothing here can spend or even report
 * against somebody else's budget by being asked nicely.
 *
 * NOTHING IS CONSUMED. This module never calls `recordOutboundAttempt`.
 */
function budgetStatus({ pc, coach, sendingIdentity, window }) {
  if (!sendingIdentity) return { evaluated: false, reason: 'NO_SENDING_IDENTITY_SUPPLIED' };

  const relationship = OUTREACH_FOR.get(pc.athlete_id, coach.coachId);
  const decision = relationship
    ? outboundBudgetDecision({
      outreachId: relationship.id,
      athleteId: pc.athlete_id,
      sendingIdentity,
      ...(window ? { window } : {}),
    })
    : outboundBudgetDecisionForAthlete({
      athleteId: pc.athlete_id,
      sendingIdentity,
      ...(window ? { window } : {}),
    });
  return {
    evaluated: true,
    allowed: decision.allowed,
    reason: decision.reason,
    athleteUsed: decision.athlete.used,
    athleteLimit: decision.athlete.limit,
    mailboxUsed: decision.mailbox.used,
    mailboxLimit: decision.mailbox.limit,
  };
}

/* -------------------------------------------------------------------------- */
/* Preparation — the one decision, shared                                      */
/* -------------------------------------------------------------------------- */

/**
 * MAY A NEW CONTACT ATTEMPT BE PREPARED FOR THIS PLAN? — F9b-2.
 *
 * ONE AUTHORITY, THREE CALLERS. `materialiseNextContactAttempt` acts on it, B7's
 * execution plan reports it as `preparableNow`, and the prepare endpoint
 * translates it into a status code. Before this the materialiser held the rules
 * privately, so a screen could only guess whether the button would work —
 * and the guess available to it, `executableNow`, was the wrong question.
 *
 * ---------------------------------------------------------------------------
 * PREPARING IS NOT SENDING, AND THE DIFFERENCE IS THE WHOLE SHAPE OF THIS.
 *
 * It IGNORES timing and capacity, deliberately: the campaign start date, the
 * outreach window, whether a follow-up is due, the mailbox limit, the athlete's
 * daily budget and whether a sending identity exists at all. None of those is a
 * reason not to record what a campaign intends — a draft campaign is precisely
 * the state intents are recorded in, and an operator preparing tomorrow's
 * follow-up today is doing their job.
 *
 * It REFUSES everything that makes the intent itself wrong: a person has not
 * reviewed a first touch to somebody already written to, a stance, a
 * suppression, a revocation, a stopped or completed programme, a closed
 * campaign, nobody to write to, or nothing to say.
 *
 * SO IT IS NEVER `executableNow`, AND MUST NOT BE CONFUSED FOR IT. That field
 * answers "could this be sent right now", and the two disagree in both
 * directions — a draft campaign is preparable and not executable; an already
 * prepared programme is executable and not preparable.
 * ---------------------------------------------------------------------------
 *
 * PURE. It reads the plan it is given and asks nothing of its own: the
 * prohibition and the review are already derived on the plan, and the existing
 * attempt is already on the current coach. So B7 gets this for a hundred
 * programmes without a hundred extra queries.
 *
 * @param {object} plan a `programmePursuitPlan`
 * @returns {{allowed: boolean, reason: string|null, attempt: object|null}}
 */
export function contactAttemptPreparation(plan) {
  /**
   * NO `kind`, ON PURPOSE. B3 classifies refusals as TIMING or PROHIBITION so a
   * caller can tell "not yet" from "no" — and preparation has already spent that
   * distinction: timing never refuses here, so every refusal below would carry
   * the same value. A field that is constant is a field that gets believed.
   */
  const refuse = (reason, attempt = null) => ({ allowed: false, reason, attempt });

  // ---- nobody to prepare for ----
  if (!plan.current) {
    return refuse(plan.reason === PURSUIT_REASON.NO_ELIGIBLE_COACHES
      ? PREPARATION_REFUSAL.NO_ELIGIBLE_COACH
      : PREPARATION_REFUSAL.NO_ACTION_TO_PREPARE);
  }

  /**
   * ---- nothing to prepare ----
   *
   * A reply is waiting for a person (AWAITING_OPERATOR), or the programme's cold
   * allowance is spent. Both name a coach and neither is a message.
   */
  if (plan.nextAction !== PURSUIT_ACTION.INITIAL_OUTREACH
    && plan.nextAction !== PURSUIT_ACTION.FOLLOW_UP) {
    return refuse(PREPARATION_REFUSAL.NO_ACTION_TO_PREPARE);
  }

  /**
   * ---- a person has to look first ----
   *
   * Checked BEFORE the prohibitions, matching the order the materialiser has
   * always used: the most actionable answer wins, and this is the only refusal
   * here an operator can resolve without changing a setting.
   */
  if (plan.firstTouchReview?.required) {
    return refuse(PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED);
  }

  // ---- B3, quoted, with the dates skipped ----
  if (!plan.prohibition?.allowed) {
    return refuse(plan.prohibition?.reason ?? 'CONTACT_CHECK_FAILED');
  }

  /**
   * ---- there is already one ----
   *
   * LAST, so a programme that has been prepared AND has since been stopped
   * reports the stop. It is not an error and the endpoint answers 200 with the
   * row; it refuses only the question this function asks, which is whether
   * something NEW can be prepared.
   */
  const existing = plan.current.attemptId
    ? plan.attempts.find((a) => a.id === plan.current.attemptId) ?? null
    : null;
  if (existing) return refuse(PREPARATION_REFUSAL.ALREADY_PREPARED, existing);

  return { allowed: true, reason: null, attempt: null };
}

/* -------------------------------------------------------------------------- */
/* Materialisation — the one thing here that writes                            */
/* -------------------------------------------------------------------------- */

/**
 * TURN THE PLAN'S CURRENT COACH INTO A B4 CONTACT ATTEMPT. Explicitly.
 *
 * Separate from `programmePursuitPlan` and separately tested, because B7's
 * dry-run reads a hundred programmes and must create nothing by reading them.
 * One call, one programme, at most one attempt.
 *
 * WHAT IT DOES NOT DO. It creates no outreach relationship and mints no
 * tracking token; it moves no programme state; it advances no step; it sends
 * nothing and consumes no budget. It records that this campaign intends to
 * pursue this person, which is exactly what a `planned` attempt means.
 *
 * Idempotent through B4: asking twice returns the existing attempt, and a
 * stopped one is never resurrected.
 *
 * A REFUSED PLAN MATERIALISES NOTHING — F6b. See the safety check below.
 *
 * @returns {{created: boolean, attempt: object|null, plan: object}}
 */
export function materialiseNextContactAttempt({ programmeCampaignId, at = utcNow() } = {}) {
  const plan = programmePursuitPlan({ programmeCampaignId });
  const preparation = contactAttemptPreparation(plan);

  /**
   * THE RULES ARE NO LONGER HERE — F9b-2. They are in
   * `contactAttemptPreparation`, which B7 reads as `preparableNow` and the
   * prepare endpoint translates into a status. This function's job is now the
   * WRITE and the envelope around it, so a screen and a write can no longer
   * disagree about whether preparing is possible.
   *
   * ALREADY_PREPARED IS THE ONE REFUSAL THIS CALLER DOES NOT HONOUR, and that
   * is the whole of idempotency: the decision says there is nothing NEW to
   * prepare, and the honest answer to "prepare this" is the row that already
   * exists — `created: false` with the attempt, never a failure.
   */
  if (!preparation.allowed && preparation.reason !== PREPARATION_REFUSAL.ALREADY_PREPARED) {
    /**
     * THE ENVELOPE IS UNCHANGED, and the two extra keys keep their meanings:
     * `review` on the operator hold, `prohibition` on a B3 refusal, neither
     * present otherwise. Callers written against F6b and F6d keep working, and
     * `preparation` is added beside them as the one answer all three paths now
     * share.
     */
    const envelope = { created: false, attempt: null, plan, preparation };
    if (preparation.reason === PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED) {
      return { ...envelope, review: plan.firstTouchReview };
    }
    if (preparation.reason === PREPARATION_REFUSAL.NO_ELIGIBLE_COACH
      || preparation.reason === PREPARATION_REFUSAL.NO_ACTION_TO_PREPARE) {
      return envelope;
    }
    return { ...envelope, prohibition: plan.prohibition };
  }

  const existing = preparation.attempt;

  /**
   * THE STORED STEP IS A REFLECTION OF THE DERIVED ONE, NOT A COUNTER — F9b-1.
   *
   * `plan.step` is what B6 derived from accepted campaign-local messages, and
   * it is the authority in both directions this touches:
   *
   *   CREATING    the attempt starts where the campaign actually is. Creating
   *               at 1 against a derived 2 raised CONTACT_ATTEMPT_STEP_DRIFT
   *               the instant an attempt was prepared for a follow-up, which is
   *               the defect F9a found.
   *
   *   EXISTING    a stored step left behind by a confirmed send is caught up.
   *               This is DEFENCE, not the mechanism: `transitionSend` advances
   *               it at the moment of acceptance, so by the time anybody presses
   *               Prepare again the two normally already agree. It exists for
   *               the rows that predate F9b-1 and for anything that reaches
   *               ACCEPTED by a path nobody has written yet.
   *
   * FORWARD ONLY, and B4 enforces that rather than a condition here. A stored
   * step AHEAD of the derived one is an attempt claiming a message that is not
   * on file; repairing it would erase the evidence, so it is left for B7's
   * drift blocker to keep reporting.
   */
  if (existing) reconcileContactAttemptStep(existing.id, plan.step, { at });

  const attempt = createContactAttempt({
    programmeCampaignId,
    coachId: plan.current.coachId,
    athleteId: plan.campaign.athleteId,
    step: plan.step,
    at,
  });
  return { created: !existing, attempt, plan, preparation };
}

/**
 * WHERE A POLICY VERSION SHOULD EVENTUALLY BE PINNED, and why not yet.
 *
 * Nothing stores PP1 today, deliberately. A stored version is only worth
 * having where something would later be reinterpreted by a newer policy, and
 * the honest place for that is the CAMPAIGN SNAPSHOT: a campaign is a finite
 * service whose Top 100, ranks and tiers were frozen when it was created, and
 * the pursuit depth those tiers imply belongs with them. A campaign planned
 * under PP1 should keep reading as a 3/2/1 campaign after PP2 lands.
 *
 * NOT the contact attempt, which would repeat the same value on up to three
 * hundred rows per campaign; and NOT the message payload, which already
 * carries OUTREACH_POLICY_VERSION for a different question — what the email
 * was allowed to SAY, rather than how deeply the programme was pursued.
 *
 * Adding a column now would be a migration in aid of a comparison nobody can
 * make: there is exactly one pursuit policy and no campaign has run under it.
 * The planner reports the version it used on every plan, which is what makes
 * the eventual pin a copy of a fact rather than a guess.
 */

/** Today, for a caller that wants B3 evaluated against a specific date. */
export { utcToday };
