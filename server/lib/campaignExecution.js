import { getCampaign, listProgrammeCampaigns } from './campaigns.js';
import {
  programmePursuitPlan, PURSUIT_ACTION, PURSUIT_REASON, FOLLOW_UP_DELAY_DAYS,
} from './pursuitPolicy.js';
import { utcToday } from './time.js';
import { OUTLOOK_FROM_ADDRESS } from './config.js';

/**
 * WHAT THIS CAMPAIGN WOULD DO NEXT, ACROSS ALL HUNDRED PROGRAMMES.
 *
 * B6 answers for one programme. This answers for a campaign, and adds the two
 * things that only exist once you look at a hundred at a time: WHAT ORDER the
 * actions should be considered in, and WHICH OF THEM FIT inside today's
 * remaining budget.
 *
 * ---------------------------------------------------------------------------
 * IT ORCHESTRATES. IT IS NOT A FOURTH AUTHORITY.
 *
 * Policy is B6's, permission is B3's, capacity is B5's, and this module
 * re-derives none of them — it calls them, keeps their answers separable, and
 * adds ordering and simulation on top. A test asserts it reads no table
 * directly and contains no copy of their rules.
 * ---------------------------------------------------------------------------
 *
 * AND IT WRITES NOTHING. Not a row, not a token, not a contact attempt, not a
 * ledger entry. An operator opening a campaign to see what it would do must be
 * able to do that a hundred times without the campaign becoming different for
 * having been looked at. There is no execution endpoint above this and no
 * bulk materialisation inside it.
 */

/**
 * WHERE A BLOCKER CAME FROM. Six sources, deliberately few.
 *
 * They exist so a screen can say "waiting for the campaign to start" and
 * "somebody needs to look at this" differently, and so a caller never has to
 * read a sentence to find out which it is.
 *
 *   POLICY          the pursuit policy has nothing further to propose
 *   SAFETY          B3 refuses this contact
 *   BUDGET          B5 has no capacity, actual or simulated
 *   TIMING          the action is real but not due yet
 *   DATA_INTEGRITY  two records disagree and nobody should guess which is right
 *   OPERATOR        a person has to decide something
 */
export const BLOCKER_SOURCE = Object.freeze({
  POLICY: 'POLICY',
  SAFETY: 'SAFETY',
  BUDGET: 'BUDGET',
  TIMING: 'TIMING',
  DATA_INTEGRITY: 'DATA_INTEGRITY',
  OPERATOR: 'OPERATOR',
});

/** Codes this module raises itself. Everything else is quoted from B3 or B5. */
export const BLOCKER_CODE = Object.freeze({
  FOLLOW_UP_NOT_YET_DUE: 'FOLLOW_UP_NOT_YET_DUE',
  UNRESOLVED_FOLLOW_UP_TIMING: 'UNRESOLVED_FOLLOW_UP_TIMING',
  CONTACT_ATTEMPT_STEP_DRIFT: 'CONTACT_ATTEMPT_STEP_DRIFT',
  ATHLETE_DAILY_BUDGET_WOULD_BE_EXCEEDED: 'ATHLETE_DAILY_BUDGET_WOULD_BE_EXCEEDED',
  MAILBOX_DAILY_BUDGET_WOULD_BE_EXCEEDED: 'MAILBOX_DAILY_BUDGET_WOULD_BE_EXCEEDED',
  RESPONSE_OBSERVED: 'RESPONSE_OBSERVED',
  /**
   * The campaign's first approach to somebody the ATHLETE has already written
   * to — quoted from B6's own derivation rather than decided here. Not a
   * refusal: a person looks, and very often sends it anyway.
   */
  PRIOR_CONFIRMED_CONTACT: 'PRIOR_CONFIRMED_CONTACT',
  NO_ELIGIBLE_COACHES: 'NO_ELIGIBLE_COACHES',
  ALL_COACHES_EXHAUSTED: 'ALL_COACHES_EXHAUSTED',
  TIER_DEPTH_REACHED: 'TIER_DEPTH_REACHED',
});

/**
 * BLOCKED IS NOT THE SAME AS ACTION REQUIRED, and conflating them is how a
 * review screen becomes a list of a hundred things nobody needs to do.
 *
 * These safety refusals need a PERSON. A revoked relationship will stay
 * revoked and a wholly-suppressed staff will stay suppressed until somebody
 * decides something; waiting will not fix either.
 *
 * Everything else B3 can say — the campaign has not started, the outreach
 * window has closed, the programme was stopped or completed, the campaign is
 * still a draft — is a fact about time or about a decision already taken. Those
 * are blocked, and they are meant to be.
 */
const SAFETY_NEEDS_A_PERSON = Object.freeze(new Set([
  'OUTREACH_REVOKED',
  'SUPPRESSED',
  'PROGRAMME_CAMPAIGN_NOT_FOUND',
  'CAMPAIGN_ATHLETE_MISMATCH',
  'CAMPAIGN_PROGRAMME_MISMATCH',
]));

/**
 * A budget that is UNCONFIGURED needs a person; a budget that is SPENT needs
 * tomorrow. B5 keeps those apart and this keeps them apart.
 */
const BUDGET_NEEDS_A_PERSON = Object.freeze(new Set([
  'MAILBOX_LIMIT_REQUIRED',
  'SENDING_IDENTITY_REQUIRED',
]));

/**
 * WHAT CLASS OF ACTION THIS IS, which is the primary sort key across the
 * campaign and the single most consequential decision in this module.
 *
 * Lower is considered first.
 *
 *   0  FIRST_CONTACT   this programme has never been written to this campaign
 *   1  FOLLOW_UP       the one permitted second message to a coach already written to
 *   2  NEXT_COACH      a further person at a programme already written to
 *
 * See the note on breadth below for why this order and not rank order.
 */
export const ACTION_CLASS = Object.freeze({
  FIRST_CONTACT: 'FIRST_CONTACT',
  FOLLOW_UP: 'FOLLOW_UP',
  NEXT_COACH: 'NEXT_COACH',
});

const CLASS_ORDER = Object.freeze({ FIRST_CONTACT: 0, FOLLOW_UP: 1, NEXT_COACH: 2 });
const TIER_ORDER = Object.freeze({ A: 0, B: 1, C: 2 });

const day = (value) => (value ? String(value).slice(0, 10) : null);

/** A date-only shift, in calendar days. No calendar, no timezone, no clock. */
function addDays(isoDate, days) {
  const t = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* One programme                                                               */
/* -------------------------------------------------------------------------- */

/**
 * WHEN A FOLLOW-UP BECOMES ELIGIBLE, as a DATE and never as an instant.
 *
 * The only trustworthy execution timestamp in the build is `outreach_send.sent_at`
 * on the accepted message, which B6 reports as `lastAcceptedAt`. Four policy
 * days after the date of that message, the follow-up may be considered. That is
 * a date because everything it is compared against — `onDate`, the campaign's
 * own boundaries — is a date; resolving it to an instant would need a timezone
 * that nothing in this build has.
 *
 * A MISSING TIMESTAMP IS NOT "DUE NOW". An accepted message with no `sent_at`
 * cannot be produced by `acceptSend`, but if one is ever met the honest answer
 * is that we do not know when the clock started — so it becomes a person's
 * problem rather than a message.
 */
function followUpTiming(coach, onDate) {
  const sentOn = day(coach?.lastAcceptedAt);
  if (!sentOn) {
    return {
      policyEligibleOn: null,
      due: false,
      unresolved: true,
    };
  }
  const eligibleOn = addDays(sentOn, FOLLOW_UP_DELAY_DAYS);
  return {
    policyEligibleOn: eligibleOn,
    // Inclusive: the fourth day IS the day it becomes eligible, not the day
    // before it does. Stated because an off-by-one here is a follow-up that
    // goes out three days after the first message.
    due: Boolean(eligibleOn) && onDate >= eligibleOn,
    unresolved: false,
  };
}

/**
 * THE TWO STEP TRUTHS, COMPARED RATHER THAN CHOSEN BETWEEN.
 *
 * B6 derives the step from accepted campaign-local messages, which cannot be
 * wrong because it counts things that exist. B4 stores a `step` on the attempt,
 * which something has to advance. They can disagree, and when they do, the
 * dry-run's job is to SAY SO — not to pick a winner, and certainly not to
 * quietly correct one, because a read that repairs what it reads is a write
 * wearing a report's clothes.
 *
 * Vacuously consistent where there is no attempt: nothing has claimed a step,
 * so nothing disagrees.
 */
function stepReconciliation(coach, derivedStep) {
  const storedStep = coach?.attemptStep ?? null;
  if (storedStep === null || derivedStep === null) {
    return { storedStep, derivedStep, stepConsistent: true };
  }
  return { storedStep, derivedStep, stepConsistent: storedStep === derivedStep };
}

/**
 * One programme's entry: policy, permission, capacity and timing, kept apart.
 *
 * `plan` is B6's, unedited. This adds the campaign-level facts B6 has no way to
 * know — whether a follow-up is due yet, whether two step records agree, and
 * which of the refusals need a person rather than a day.
 */
function programmeEntry(plan, { onDate }) {
  const coach = plan.current;
  const blockers = [];
  let operatorReviewRequired = false;

  const timing = plan.nextAction === PURSUIT_ACTION.FOLLOW_UP
    ? followUpTiming(coach, onDate)
    : { policyEligibleOn: null, due: true, unresolved: false };

  const steps = stepReconciliation(coach, plan.step);

  // ---- policy has nothing to propose ----
  if (plan.nextAction === PURSUIT_ACTION.NO_FURTHER_COLD_OUTREACH) {
    blockers.push({ source: BLOCKER_SOURCE.POLICY, code: plan.reason });
    if (plan.reason === PURSUIT_REASON.NO_ELIGIBLE_COACHES) operatorReviewRequired = true;
  }

  /**
   * ---- THIS ATHLETE HAS WRITTEN TO THIS PERSON BEFORE ----
   *
   * OPERATOR, not SAFETY: nothing forbids the message. The campaign-local
   * sequence is untouched and still says step 1, because for this campaign it
   * IS the first message — what has changed is that sending it silently would
   * introduce an athlete the coach has already met.
   *
   * `operatorReviewRequired` then removes it from `priorityActions` through the
   * filter that already exists, so this needs no second review mechanism and no
   * new place for a screen to look.
   */
  if (plan.firstTouchReview?.required) {
    blockers.push({ source: BLOCKER_SOURCE.OPERATOR, code: plan.firstTouchReview.reason });
    operatorReviewRequired = true;
  }

  // ---- a person answered ----
  if (plan.nextAction === PURSUIT_ACTION.AWAITING_OPERATOR) {
    blockers.push({ source: BLOCKER_SOURCE.OPERATOR, code: BLOCKER_CODE.RESPONSE_OBSERVED });
    operatorReviewRequired = true;
  }

  // ---- B3, quoted ----
  if (plan.safety.evaluated && !plan.safety.allowed && plan.safety.reason) {
    blockers.push({ source: BLOCKER_SOURCE.SAFETY, code: plan.safety.reason });
    if (SAFETY_NEEDS_A_PERSON.has(plan.safety.reason)) operatorReviewRequired = true;
  }

  // ---- B5, quoted ----
  if (plan.budget.evaluated && plan.budget.allowed === false && plan.budget.reason) {
    blockers.push({ source: BLOCKER_SOURCE.BUDGET, code: plan.budget.reason });
    if (BUDGET_NEEDS_A_PERSON.has(plan.budget.reason)) operatorReviewRequired = true;
  }
  if (plan.budget.evaluated === false && plan.budget.reason === 'NO_SENDING_IDENTITY_SUPPLIED') {
    blockers.push({ source: BLOCKER_SOURCE.BUDGET, code: 'SENDING_IDENTITY_REQUIRED' });
    operatorReviewRequired = true;
  }

  // ---- timing ----
  if (timing.unresolved) {
    blockers.push({ source: BLOCKER_SOURCE.TIMING, code: BLOCKER_CODE.UNRESOLVED_FOLLOW_UP_TIMING });
    operatorReviewRequired = true;
  } else if (!timing.due) {
    blockers.push({ source: BLOCKER_SOURCE.TIMING, code: BLOCKER_CODE.FOLLOW_UP_NOT_YET_DUE });
  }

  // ---- two records disagreeing ----
  if (!steps.stepConsistent) {
    blockers.push({
      source: BLOCKER_SOURCE.DATA_INTEGRITY, code: BLOCKER_CODE.CONTACT_ATTEMPT_STEP_DRIFT,
    });
    operatorReviewRequired = true;
  }

  const isColdAction = plan.nextAction === PURSUIT_ACTION.INITIAL_OUTREACH
    || plan.nextAction === PURSUIT_ACTION.FOLLOW_UP;

  return {
    programmeCampaignId: plan.programmeCampaign.id,
    collegeName: plan.programmeCampaign.collegeName,
    sport: plan.programmeCampaign.sport,
    rank: plan.programmeCampaign.rank,
    tier: plan.programmeCampaign.tier,
    tierSource: plan.programmeCampaign.tierSource,
    programmeState: plan.programmeCampaign.state,

    policyVersion: plan.policyVersion,
    coachDepth: plan.coachDepth,

    currentCoach: coach ? {
      id: coach.coachId,
      name: coach.name,
      role: coach.role,
      email: coach.email,
      emailStatus: coach.emailStatus,
      order: coach.order,
      /**
       * WHAT THE ATHLETE HAS ALREADY SENT THIS PERSON, so an operator asked to
       * review a first touch can see WHY without opening anything else: whether
       * a confirmed send exists, when the first and last were, how they were
       * sent, and how many messages are on file.
       *
       * CONFIRMED SENDS ONLY. Nothing here says a message was delivered,
       * opened, read or replied to — this build knows none of those, and the
       * count is of records rather than of messages, which is why
       * `hasConfirmedSend` is the field that answers the question.
       */
      priorContact: coach.priorContact,
    } : null,
    currentAttempt: coach && coach.attemptId ? {
      id: coach.attemptId, state: coach.attemptState, storedStep: coach.attemptStep,
    } : { id: null, state: null, storedStep: null },

    derivedStep: plan.step,
    stepConsistent: steps.stepConsistent,

    nextAction: plan.nextAction,
    actionClass: actionClassOf(plan),
    policyReason: plan.reason,
    exhausted: plan.exhausted,

    safety: plan.safety,
    budget: plan.budget,

    /** B6's derivation, quoted so a caller need not infer it from the blockers. */
    firstTouchReview: plan.firstTouchReview ?? { required: false, reason: null },

    /**
     * `plan.executableNow` is B6's composition of permission and capacity.
     * This adds the campaign-level facts it could not know: whether the
     * follow-up is due, whether anything is claiming a step it should not, and
     * whether a person still has to look at a first approach to somebody the
     * athlete has already written to.
     */
    executableNow: Boolean(isColdAction && plan.executableNow && timing.due
      && steps.stepConsistent && !plan.firstTouchReview?.required),
    operatorReviewRequired,
    blockers,

    /**
     * Never fabricated. `next_action_at` stays unwritten and this is a DATE
     * derived from an accepted message, present only for a follow-up whose
     * clock has genuinely started.
     */
    policyEligibleOn: timing.policyEligibleOn,
    nextActionAt: null,

    /** Compact, for review. Never the whole staff list. */
    candidates: {
      eligible: plan.coaches.length,
      beyondDepth: plan.beyondDepth.length,
      ineligible: plan.ineligible.length,
    },
  };
}

/**
 * Which class of action a programme's next move is.
 *
 * FIRST_CONTACT is the one that matters: it means this campaign has never
 * written to this programme at all — the first coach, on their first message.
 */
function actionClassOf(plan) {
  if (plan.nextAction === PURSUIT_ACTION.INITIAL_OUTREACH) {
    return plan.current?.order === 1 ? ACTION_CLASS.FIRST_CONTACT : ACTION_CLASS.NEXT_COACH;
  }
  if (plan.nextAction === PURSUIT_ACTION.FOLLOW_UP) return ACTION_CLASS.FOLLOW_UP;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * THE ORDER ACTIONS SHOULD BE CONSIDERED IN, ACROSS THE WHOLE CAMPAIGN.
 *
 * BREADTH BEFORE DEPTH, and rank does NOT come first. That is the reason this
 * layer exists above B6 at all.
 *
 * Working strictly down the ranked list would let the top few programmes
 * consume everything: a Tier A programme is allowed three coaches and two
 * messages each, so six actions — and an athlete's whole day is ten. Rank 1
 * through Rank 2 would be most of a day, and Rank 60 would never be written to
 * at all. The service the athlete bought is exposure across a hundred
 * programmes, not a very thorough conversation with two.
 *
 * So the primary key is what KIND of action it is:
 *
 *   0  FIRST_CONTACT   a programme nobody has written to yet. Every one of
 *                      these is a new programme that learns the athlete
 *                      exists, which is the single most valuable thing a
 *                      campaign day can buy.
 *   1  FOLLOW_UP       a conversation already opened, and the cheapest
 *                      persistence there is. Ahead of a second coach because
 *                      a follow-up that arrives six weeks late is not a
 *                      follow-up; behind first contact because starting a new
 *                      programme beats finishing an old approach.
 *   2  NEXT_COACH      a further person somewhere already approached. Deepest,
 *                      last, and sub-ordered by which coach so that every
 *                      programme gets its second contact before any gets a
 *                      third.
 *
 * Rank still matters, and it matters SECOND. Within a class, the better fit
 * goes first: tier, then rank, then the programme id so that two programmes
 * that tie on everything still order the same way every time.
 *
 * The concrete consequence, stated because it is the point: a Rank 21 first
 * approach is considered BEFORE Rank 1's third coach. Rank is a statement about
 * fit, not about urgency, and a campaign that treated it as urgency would
 * mistake thoroughness for reach.
 *
 * ONE PROGRAMME CANNOT MONOPOLISE THE FRONT, and that is structural rather than
 * a quota: B6 returns exactly ONE next action per programme, so a programme
 * appears in this list at most once. A Tier A programme's six permitted actions
 * are therefore six separate plans on six separate occasions, never six
 * consecutive entries in one.
 */
function priorityOrder(a, b) {
  return CLASS_ORDER[a.actionClass] - CLASS_ORDER[b.actionClass]
    || (a.currentCoach?.order ?? 0) - (b.currentCoach?.order ?? 0)
    || TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
    || a.rank - b.rank
    || a.programmeCampaignId.localeCompare(b.programmeCampaignId);
}

/* -------------------------------------------------------------------------- */
/* Budget simulation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * IF TODAY'S PLAN WERE EXECUTED IN THIS ORDER, HOW FAR DOWN IT WOULD WE GET?
 *
 * A SIMULATION, and the distinction from B5 is absolute: B5 answers "is there
 * capacity for ONE more action right now" against the ledger, and consumes when
 * asked to. This walks a list and counts down a local copy of the remaining
 * capacity. It writes nothing, it reserves nothing, and two people running it
 * at once both get the same answer — which is correct, because neither of them
 * has spent anything.
 *
 * Both ceilings bind, and the lower one is the effective one. An athlete with
 * seven left on a mailbox with twenty gets seven; the same athlete on a mailbox
 * with two gets two, and the eighth and third actions respectively are marked
 * with the ceiling that stopped them rather than a single blurred "rate limit".
 *
 * An unconfigured mailbox ceiling stops the simulation at zero rather than
 * running unbounded — unset means undecided, and a dry run that promised
 * eighteen sends against a ceiling nobody had chosen would be the most
 * expensive kind of wrong.
 */
function simulateBudget(actions, budget) {
  const athleteRemaining = budget?.athleteRemaining ?? null;
  const mailboxRemaining = budget?.mailboxRemaining ?? null;
  let athleteLeft = athleteRemaining;
  let mailboxLeft = mailboxRemaining;

  for (const action of actions) {
    if (!action.executableNow) {
      action.withinBudgetToday = false;
      action.budgetSimulationReason = 'NOT_EXECUTABLE';
      continue;
    }
    if (athleteLeft === null || mailboxLeft === null) {
      action.withinBudgetToday = false;
      action.budgetSimulationReason = 'BUDGET_NOT_EVALUATED';
      continue;
    }
    if (athleteLeft <= 0) {
      action.withinBudgetToday = false;
      action.budgetSimulationReason = BLOCKER_CODE.ATHLETE_DAILY_BUDGET_WOULD_BE_EXCEEDED;
      action.blockers = [...action.blockers, {
        source: BLOCKER_SOURCE.BUDGET, code: BLOCKER_CODE.ATHLETE_DAILY_BUDGET_WOULD_BE_EXCEEDED,
      }];
      continue;
    }
    if (mailboxLeft <= 0) {
      action.withinBudgetToday = false;
      action.budgetSimulationReason = BLOCKER_CODE.MAILBOX_DAILY_BUDGET_WOULD_BE_EXCEEDED;
      action.blockers = [...action.blockers, {
        source: BLOCKER_SOURCE.BUDGET, code: BLOCKER_CODE.MAILBOX_DAILY_BUDGET_WOULD_BE_EXCEEDED,
      }];
      continue;
    }
    action.withinBudgetToday = true;
    action.budgetSimulationReason = null;
    athleteLeft -= 1;
    mailboxLeft -= 1;
  }

  return {
    athleteRemainingAtStart: athleteRemaining,
    mailboxRemainingAtStart: mailboxRemaining,
    athleteRemainingAfterPlan: athleteLeft,
    mailboxRemainingAfterPlan: mailboxLeft,
  };
}

/* -------------------------------------------------------------------------- */
/* The campaign plan                                                           */
/* -------------------------------------------------------------------------- */

/**
 * THE WHOLE CAMPAIGN'S DRY RUN.
 *
 * @param {string} campaignId
 * @param {string} [options.onDate]           the date B3 and follow-up timing are read against
 * @param {string} [options.sendingIdentity]  defaults to the configured mailbox
 * @param {object} [options.window]           the budget window, B5's shape
 * @returns {{campaign, summary, programmes, priorityActions}}
 */
export function campaignExecutionPlan(campaignId, {
  onDate = utcToday(), sendingIdentity = OUTLOOK_FROM_ADDRESS, window = undefined,
} = {}) {
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    const err = new Error(`No campaign ${campaignId}`);
    err.code = 'CAMPAIGN_NOT_FOUND';
    throw err;
  }

  // Snapshot rank order, always — the order the campaign was frozen in, and
  // the order an operator reading the campaign already knows.
  const programmes = listProgrammeCampaigns(campaignId).map((pc) => programmeEntry(
    programmePursuitPlan({
      programmeCampaignId: pc.id, onDate, sendingIdentity, window,
    }),
    { onDate },
  ));

  /**
   * The athlete's remaining capacity, taken from whichever programme B5 was
   * able to answer for. It is the same athlete and the same day for all of
   * them, so one answer is the answer — and reading it off the plan rather
   * than asking again keeps B5 the only thing that computes it.
   */
  const evaluated = programmes.find((p) => p.budget?.evaluated);
  const budget = evaluated ? {
    sendingIdentity,
    athleteUsed: evaluated.budget.athleteUsed,
    athleteLimit: evaluated.budget.athleteLimit,
    athleteRemaining: remaining(evaluated.budget.athleteUsed, evaluated.budget.athleteLimit),
    mailboxUsed: evaluated.budget.mailboxUsed,
    mailboxLimit: evaluated.budget.mailboxLimit,
    mailboxRemaining: remaining(evaluated.budget.mailboxUsed, evaluated.budget.mailboxLimit),
  } : {
    sendingIdentity,
    athleteUsed: null, athleteLimit: null, athleteRemaining: null,
    mailboxUsed: null, mailboxLimit: null, mailboxRemaining: null,
  };

  /**
   * The ordered preview. NOT A QUEUE — nothing here is reserved, claimed or
   * durable, and running this twice produces two identical lists rather than
   * one list and one empty one. It is what the campaign would do if it acted
   * now, recomputed from scratch every time it is asked.
   */
  const priorityActions = programmes
    .filter((p) => p.actionClass !== null && !p.operatorReviewRequired)
    .sort(priorityOrder)
    .map((p, i) => ({
      priority: i + 1,
      programmeCampaignId: p.programmeCampaignId,
      collegeName: p.collegeName,
      rank: p.rank,
      tier: p.tier,
      coach: p.currentCoach,
      action: p.nextAction,
      actionClass: p.actionClass,
      step: p.derivedStep,
      executableNow: p.executableNow,
      withinBudgetToday: false,
      budgetSimulationReason: null,
      policyEligibleOn: p.policyEligibleOn,
      blockers: p.blockers,
    }));

  const simulation = simulateBudget(priorityActions, budget);

  return {
    campaign: {
      id: campaign.id,
      athleteId: campaign.athlete_id,
      sport: campaign.sport,
      state: campaign.state,
      startsOn: campaign.starts_on,
      outreachEndsOn: campaign.outreach_ends_on,
      endsOn: campaign.ends_on,
      onDate,
    },
    summary: summarise(programmes, priorityActions, { budget, simulation }),
    programmes,
    priorityActions,
  };
}

const remaining = (used, limit) => (
  typeof used === 'number' && typeof limit === 'number' ? Math.max(0, limit - used) : null
);

/**
 * COUNTS DERIVED FROM THIS PLAN, computed on the way past and stored nowhere.
 *
 * Named so a screen cannot confuse the two things that both look like "not
 * happening": `blockedCount` is prevented from acting, `exhaustedCount` has
 * nothing left to do and is finished. One is a problem and the other is
 * success.
 */
function summarise(programmes, priorityActions, { budget, simulation }) {
  const count = (fn) => programmes.filter(fn).length;
  return {
    programmeCount: programmes.length,
    executableNowCount: count((p) => p.executableNow),
    withinBudgetTodayCount: priorityActions.filter((a) => a.withinBudgetToday).length,
    blockedBySafetyCount: count((p) => p.blockers.some((b) => b.source === BLOCKER_SOURCE.SAFETY)),
    blockedByBudgetCount: count((p) => p.blockers.some((b) => b.source === BLOCKER_SOURCE.BUDGET)),
    blockedByTimingCount: count((p) => p.blockers.some((b) => b.source === BLOCKER_SOURCE.TIMING)),
    awaitingOperatorCount: count((p) => p.nextAction === PURSUIT_ACTION.AWAITING_OPERATOR),
    operatorReviewRequiredCount: count((p) => p.operatorReviewRequired),
    exhaustedByPolicyCount: count((p) => p.exhausted),
    noEligibleCoachCount: count((p) => p.policyReason === PURSUIT_REASON.NO_ELIGIBLE_COACHES),
    initialOutreachCount: count((p) => p.nextAction === PURSUIT_ACTION.INITIAL_OUTREACH),
    followUpCount: count((p) => p.nextAction === PURSUIT_ACTION.FOLLOW_UP),
    stepDriftCount: count((p) => !p.stepConsistent),
    budget,
    simulation,
  };
}
