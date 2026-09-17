import {
  campaignContactDecision, refusalKindOf, REFUSAL_KIND,
} from './campaignAttribution.js';
import {
  programmePursuitPlan, PURSUIT_ACTION, PURSUIT_REASON, FIRST_TOUCH_REVIEW_REQUIRED,
} from './pursuitPolicy.js';
import { assertFirstTouchReviewed } from './campaignFirstTouchGate.js';
import { followUpTiming } from './campaignExecution.js';
import { programmeMessageWithContext, MESSAGE_STATE } from './programmeMessages.js';
import {
  usableMailboxesForAthlete, mailboxesAttachedToAthlete, MAILBOX_PROVIDER,
} from './connectedMailboxes.js';
import { outboundBudgetDecisionForAthlete } from './outboundBudget.js';
import { getCoach } from './coaches.js';
import { outreachBetween } from './outreach.js';
import { utcToday, utcDayWindow } from './time.js';

/**
 * MAY THIS REVIEWED MESSAGE BE TRANSMITTED NOW? — F11b.
 *
 * ===========================================================================
 * THE QUESTION F10 DELIBERATELY DID NOT ANSWER.
 *
 * `reviewed` means one thing and has always meant one thing: a named operator
 * read those exact words. It is not permission. Between the moment somebody
 * read a message and the moment a transport might carry it, a stance can
 * change, a coach can leave, a campaign can close, an address can move, a
 * mailbox can be revoked and a day's capacity can be spent — and every one of
 * those is a live fact that the stored message cannot know.
 *
 * So this module exists to ask all of them, in one place, immediately before
 * anything irreversible could happen.
 * ===========================================================================
 *
 * IT DECIDES NOTHING ITSELF, AND THAT IS THE DESIGN.
 *
 * Every rule below belongs to somebody else and is CALLED rather than copied:
 *
 *   campaignContactDecision   stance, suppression, revocation, programme and
 *                             campaign lifecycle — and the TIMING/PROHIBITION
 *                             distinction, which only it can make
 *   programmePursuitPlan      who the campaign is pursuing, at which step,
 *                             with which attempt, and whether a reply has
 *                             changed the answer
 *   assertFirstTouchReviewed  whether a person still has to look first
 *   followUpTiming            when four policy days have passed
 *   outboundBudget            whether capacity exists today
 *   connectedMailboxes        whether the athlete has a mailbox to send from
 *
 * A second implementation of any of them would be a second policy that could
 * disagree, and the one place a disagreement must never appear is the last
 * check before an email leaves.
 *
 * ---------------------------------------------------------------------------
 * IT WRITES NOTHING, CONSUMES NOTHING, AND READS NO SECRET.
 *
 * No row, no ledger entry, no state, no token. Asking whether a message could
 * be sent must be free, repeatable and invisible — an operator opening a
 * screen must be able to ask it a hundred times without the campaign becoming
 * different for having been asked, and a later scheduler must be able to poll
 * it without consuming the budget it is asking about.
 *
 * It never touches a credential. Whether a mailbox HAS one is a readiness
 * fact; the token itself is transport's business, and a decision about
 * readiness is not permission to retrieve a secret.
 * ---------------------------------------------------------------------------
 */

/**
 * WHAT KIND OF ANSWER THIS IS. Four refusals and one success, kept apart
 * because they need four different things from whoever is told.
 *
 *   HARD_PROHIBITION         somebody decided, or the law of the relationship
 *                            says no. Waiting changes nothing; a person must
 *                            change something.
 *   STALE_DATA               the message is no longer the message. The campaign
 *                            has moved and this content describes a past state
 *                            of it. Readable forever, executable never.
 *   TIMING_BUDGET            correct, permitted, and not yet. Comes back on
 *                            its own when a date arrives or a day turns over.
 *   EXECUTION_CONFIGURATION  nothing is wrong with the campaign; something has
 *                            not been set up. A person configures it once.
 *
 * Collapsing these is how a screen becomes a hundred identical warnings — F8
 * learned it on the campaign tab, and the lesson is worth more here, where the
 * next step is irreversible.
 */
export const EXECUTION_CLASS = Object.freeze({
  EXECUTABLE: 'EXECUTABLE',
  HARD_PROHIBITION: 'HARD_PROHIBITION',
  STALE_DATA: 'STALE_DATA',
  TIMING_BUDGET: 'TIMING_BUDGET',
  EXECUTION_CONFIGURATION: 'EXECUTION_CONFIGURATION',
});

/**
 * THE REFUSALS THIS MODULE RAISES ITSELF.
 *
 * Deliberately short. Everything about stance, suppression, revocation and
 * lifecycle is QUOTED from `CONTACT_REFUSAL`, everything about capacity from
 * `BUDGET_REFUSAL`, and the first-touch hold keeps the code F6d already gave
 * it — because an operator who has read a sentence on the campaign tab should
 * meet the same code here, and two codes for one fact are two things that can
 * drift apart.
 *
 * What is new is only what genuinely did not exist: a message that is not the
 * current one, an address that has moved, and a mailbox that cannot send.
 */
export const EXECUTION_REFUSAL = Object.freeze({
  /* ---- the message is not a thing we can execute ---- */
  PROGRAMME_MESSAGE_NOT_FOUND: 'PROGRAMME_MESSAGE_NOT_FOUND',
  MESSAGE_NOT_REVIEWED: 'MESSAGE_NOT_REVIEWED',

  /* ---- the campaign has moved past it ---- */
  ATTEMPT_NO_LONGER_CURRENT: 'ATTEMPT_NO_LONGER_CURRENT',
  COACH_NO_LONGER_CURRENT: 'COACH_NO_LONGER_CURRENT',
  STEP_DRIFT: 'STEP_DRIFT',
  NO_ACTION_TO_EXECUTE: 'NO_ACTION_TO_EXECUTE',

  /* ---- the recipient ---- */
  RECIPIENT_MISSING: 'RECIPIENT_MISSING',
  RECIPIENT_CHANGED: 'RECIPIENT_CHANGED',

  /* ---- a person answered ---- */
  RESPONSE_OBSERVED: 'RESPONSE_OBSERVED',

  /* ---- timing this module owns (the campaign's own dates are B3's) ---- */
  FOLLOW_UP_NOT_YET_DUE: 'FOLLOW_UP_NOT_YET_DUE',
  UNRESOLVED_FOLLOW_UP_TIMING: 'UNRESOLVED_FOLLOW_UP_TIMING',

  /* ---- the mailbox ---- */
  MAILBOX_REQUIRED: 'MAILBOX_REQUIRED',
  MAILBOX_RECONSENT_REQUIRED: 'MAILBOX_RECONSENT_REQUIRED',
  MAILBOX_UNSUPPORTED: 'MAILBOX_UNSUPPORTED',
  MAILBOX_AMBIGUOUS: 'MAILBOX_AMBIGUOUS',
});

/**
 * WHICH PROVIDERS THIS BUILD CAN ACTUALLY TRANSMIT THROUGH.
 *
 * GOOGLE alone, and it is listed here rather than inferred from the mailbox
 * table's CHECK constraint because those two things mean different things. The
 * constraint says which providers may be STORED — Microsoft is a value the
 * schema accepts — and this says which may be SENT THROUGH, which today is a
 * statement about code that exists. A mailbox connected to a provider nothing
 * can drive is not a usable mailbox, and calling it one would produce an
 * EXECUTABLE decision that transport could not honour.
 */
export const EXECUTABLE_PROVIDERS = Object.freeze([MAILBOX_PROVIDER.GOOGLE]);

const lower = (value) => String(value ?? '').trim().toLowerCase();

/* -------------------------------------------------------------------------- */

/**
 * THE ORDER, AND WHY IT IS THIS ORDER.
 *
 * ---------------------------------------------------------------------------
 * FAIL CLOSED, AND SAY THE MOST IMPORTANT TRUE THING.
 *
 * Several of these can be true at once. A campaign set to do-not-contact whose
 * coach has also changed and whose mailbox is also missing has three problems,
 * and the answer must always be the same one — a decision that reported
 * whichever check happened to run first would tell two operators two different
 * stories about the same message.
 *
 * So the order is by CONSEQUENCE OF BEING WRONG:
 *
 *   1  identity        cannot reason about a message that is not there
 *   2  reviewed        nobody has approved these words; nothing else matters
 *   3  prohibition     somebody said no. Outranks everything below, because
 *                      being wrong here means writing to a person who asked us
 *                      not to — the only failure with a victim outside Thriv3
 *   4  currency        the campaign has moved on. Outranks timing, mailbox and
 *                      budget because those describe a send that should not
 *                      happen at all, not one that should happen later
 *   5  first touch     a person must look. Below prohibition, above timing
 *   6  recipient       the address must still be the coach's
 *   7  timing          right message, wrong day
 *   8  mailbox         nothing is wrong; something is unconfigured
 *   9  budget          last, because it is the only one that changes by itself
 *                      overnight and the least informative to report early
 *
 * THE CAMPAIGN'S OWN DATES ARE THE EXCEPTION, and they are B3's rather than
 * this module's: `campaignContactDecision` answers stance and lifecycle in one
 * call and marks its own refusals TIMING or PROHIBITION. A draft campaign
 * therefore surfaces at step 3 as a TIMING_BUDGET answer rather than a
 * prohibition, which is correct — it is a fact about when, and B3 is the only
 * thing that can tell the two apart.
 * ---------------------------------------------------------------------------
 *
 * @param {string} args.programmeMessageId
 * @param {string} [args.at]  the date the decision is made against
 * @returns {object} see `decisionShape` below — never throws for a state,
 *   only for a caller bug (a missing id).
 */
export function executionDecision({ programmeMessageId, at = utcToday() } = {}) {
  if (!programmeMessageId) {
    const err = new Error('An execution decision needs the message it is about.');
    err.code = 'PROGRAMME_MESSAGE_REQUIRED';
    throw err;
  }
  const onDate = String(at).slice(0, 10);

  /* ---- 1. identity, and the chain that owns it -------------------------- */
  const found = programmeMessageWithContext(programmeMessageId);
  if (!found) {
    return refusal({
      classification: EXECUTION_CLASS.STALE_DATA,
      reason: EXECUTION_REFUSAL.PROGRAMME_MESSAGE_NOT_FOUND,
      programmeMessageId,
    });
  }
  const { message, context } = found;
  const base = {
    programmeMessageId,
    programmeCampaignId: context.programmeCampaignId,
    campaignId: context.campaignId,
    athleteId: context.athleteId,
    coachId: message.coach_id,
    messageStep: message.step,
    messageState: message.state,
  };

  /* ---- 2. somebody has read these exact words --------------------------- */
  if (message.state !== MESSAGE_STATE.REVIEWED) {
    return refusal({
      ...base,
      classification: EXECUTION_CLASS.STALE_DATA,
      reason: EXECUTION_REFUSAL.MESSAGE_NOT_REVIEWED,
    });
  }

  /**
   * ---- 3. may this campaign contact this coach at all, today? -----------
   *
   * ASKED ABOUT THE MESSAGE'S OWN COACH, not the campaign's current one. The
   * question at this point is whether the person these words are addressed to
   * may be written to — a stance or a suppression on them is a refusal even if
   * the campaign has since moved to somebody else, and reporting "the coach
   * changed" for a do-not-contact would describe the wrong problem.
   *
   * `resolveProgrammeCampaignFor` throws on a chain that does not hold
   * together. That is a caller bug for every other caller; here it is a state
   * an operator can reach by deleting things, so it is caught and reported.
   */
  /**
   * THE RELATIONSHIP IS LOOKED UP AND HANDED OVER, and that is not decoration.
   * B3 can only refuse a REVOKED relationship when it is given the id —
   * revocation is a fact about a row it does not go and find. Omitting it here
   * would leave a revoked outreach looking perfectly contactable at the last
   * gate before transport, which is the worst place in the system for that
   * particular silence. B6 passes it for the same reason.
   */
  const relationship = outreachBetween(context.athleteId, message.coach_id);
  let contact;
  try {
    contact = campaignContactDecision({
      programmeCampaignId: context.programmeCampaignId,
      athleteId: context.athleteId,
      coachId: message.coach_id,
      outreachId: relationship?.id ?? null,
      onDate,
    });
  } catch (err) {
    return refusal({
      ...base,
      classification: EXECUTION_CLASS.STALE_DATA,
      reason: err.code ?? EXECUTION_REFUSAL.PROGRAMME_MESSAGE_NOT_FOUND,
    });
  }
  if (!contact.allowed) {
    /**
     * THE KIND IS THE DECISION'S, NOT THE CODE'S. `CAMPAIGN_NOT_ACTIVE` covers
     * a campaign that has not started and one that has closed — opposite facts
     * under one name — and only the decision that read the campaign's state
     * can say which. `refusalKindOf` is the fallback for a code that arrives
     * without one.
     */
    const kind = contact.kind ?? refusalKindOf(contact.reason);
    return refusal({
      ...base,
      classification: kind === REFUSAL_KIND.TIMING
        ? EXECUTION_CLASS.TIMING_BUDGET
        : EXECUTION_CLASS.HARD_PROHIBITION,
      reason: contact.reason,
    });
  }

  /* ---- 4. is this still the message the campaign would send? ------------ */
  const plan = programmePursuitPlan({ programmeCampaignId: context.programmeCampaignId, onDate });

  /**
   * A REPLY IS NOT A PROHIBITION AND IT IS NOT NOTHING.
   *
   * B6 answers `AWAITING_OPERATOR` when this campaign has had a reply from the
   * coach, and this module quotes that answer rather than inventing a rule
   * about what a reply means. It does NOT mean "never write to them again" —
   * it means the campaign has stopped proposing cold outreach and a person now
   * decides. For an automatic transport that is a refusal, and it is a hard
   * one, because the alternative is a templated follow-up landing on top of a
   * human conversation.
   */
  if (plan.nextAction === PURSUIT_ACTION.AWAITING_OPERATOR) {
    return refusal({
      ...base,
      classification: EXECUTION_CLASS.HARD_PROHIBITION,
      reason: EXECUTION_REFUSAL.RESPONSE_OBSERVED,
      currentStep: plan.step,
      currentCoachId: plan.current?.coachId ?? null,
    });
  }
  if (plan.nextAction !== PURSUIT_ACTION.INITIAL_OUTREACH
    && plan.nextAction !== PURSUIT_ACTION.FOLLOW_UP) {
    /**
     * NOBODY REACHABLE IS A PROHIBITION; EVERYTHING ELSE HERE IS STALENESS.
     * "There is no one at this programme we may approach" is a fact about the
     * people, and waiting will not change it. "This campaign has written to
     * everyone it is allowed to" is a fact about a campaign that has moved
     * past the message in hand.
     */
    return refusal({
      ...base,
      classification: plan.reason === PURSUIT_REASON.NO_ELIGIBLE_COACHES
        ? EXECUTION_CLASS.HARD_PROHIBITION
        : EXECUTION_CLASS.STALE_DATA,
      reason: plan.reason ?? EXECUTION_REFUSAL.NO_ACTION_TO_EXECUTE,
      currentStep: plan.step,
      currentCoachId: plan.current?.coachId ?? null,
    });
  }

  const currentCoachId = plan.current?.coachId ?? null;
  const currency = { ...base, currentStep: plan.step, currentCoachId };

  if (currentCoachId !== message.coach_id) {
    return refusal({
      ...currency,
      classification: EXECUTION_CLASS.STALE_DATA,
      reason: EXECUTION_REFUSAL.COACH_NO_LONGER_CURRENT,
    });
  }
  /**
   * THE ATTEMPT IS THE CAMPAIGN'S INTENT AND THE MESSAGE HANGS OFF IT. A
   * message written for an attempt that no longer exists — or for a different
   * one — is content for a pursuit this campaign is not conducting.
   */
  if (!plan.current?.attemptId || plan.current.attemptId !== message.programme_contact_attempt_id) {
    return refusal({
      ...currency,
      classification: EXECUTION_CLASS.STALE_DATA,
      reason: EXECUTION_REFUSAL.ATTEMPT_NO_LONGER_CURRENT,
    });
  }
  /**
   * AND THE STEP, WHICH IS THE ONE THAT CATCHES THE DANGEROUS CASE. A reviewed
   * step-1 message after an accepted send is readable history; transmitting it
   * would send the opening email twice.
   */
  if (plan.step !== message.step) {
    return refusal({
      ...currency,
      classification: EXECUTION_CLASS.STALE_DATA,
      reason: EXECUTION_REFUSAL.STEP_DRIFT,
    });
  }

  /* ---- 5. does a person still have to look first? ----------------------- */
  /**
   * F6d'S GATE, CALLED RATHER THAN RE-DERIVED — and called rather than read off
   * `plan.firstTouchReview.required`, because the gate narrows the question in
   * two ways the flag does not: it applies only to the coach the campaign is
   * actually approaching and only to an INITIAL_OUTREACH. Reading the flag
   * would quietly widen a rule F6d wrote carefully.
   *
   * REVIEWING THE MESSAGE DOES NOT SATISFY IT. They are different reviews of
   * different things — one is "these words are right", the other is "this
   * athlete has written to this person before and somebody has seen that" —
   * and collapsing them would let a message review silently discharge a hold
   * about contact history.
   */
  try {
    assertFirstTouchReviewed({
      programmeCampaignId: context.programmeCampaignId, coachId: message.coach_id,
    });
  } catch (err) {
    if (err.code !== FIRST_TOUCH_REVIEW_REQUIRED) throw err;
    return refusal({
      ...currency,
      classification: EXECUTION_CLASS.HARD_PROHIBITION,
      reason: FIRST_TOUCH_REVIEW_REQUIRED,
    });
  }

  /* ---- 6. is the frozen recipient still the coach's address? ------------ */
  /**
   * COMPARED, NEVER CORRECTED.
   *
   * F10 froze `recipient_email` as provenance: it is who these words were
   * written to, and it stays that whatever happens next. Execution needs a
   * different thing — an address that is still right — and the only safe
   * relationship between the two is equality.
   *
   * Sending to the frozen address when it has moved emails somebody who left.
   * Sending to the new address transmits words reviewed for a different
   * recipient. Rewriting the message destroys the record. So a mismatch is a
   * refusal and stays a refusal, and what an operator does about it is a
   * design nobody has made.
   */
  const frozen = lower(message.recipient_email);
  const current = lower(getCoach(message.coach_id)?.email);
  const recipient = { frozen: message.recipient_email ?? null, current: current || null, matches: false };

  if (!frozen || !current) {
    return refusal({
      ...currency,
      recipient,
      classification: EXECUTION_CLASS.STALE_DATA,
      reason: EXECUTION_REFUSAL.RECIPIENT_MISSING,
    });
  }
  if (frozen !== current) {
    return refusal({
      ...currency,
      recipient,
      classification: EXECUTION_CLASS.STALE_DATA,
      reason: EXECUTION_REFUSAL.RECIPIENT_CHANGED,
    });
  }
  recipient.matches = true;

  /* ---- 7. right message, right day? ------------------------------------- */
  if (plan.nextAction === PURSUIT_ACTION.FOLLOW_UP) {
    const timing = followUpTiming(plan.current, onDate);
    if (timing.unresolved) {
      return refusal({
        ...currency,
        recipient,
        classification: EXECUTION_CLASS.STALE_DATA,
        reason: EXECUTION_REFUSAL.UNRESOLVED_FOLLOW_UP_TIMING,
      });
    }
    if (!timing.due) {
      return refusal({
        ...currency,
        recipient,
        classification: EXECUTION_CLASS.TIMING_BUDGET,
        reason: EXECUTION_REFUSAL.FOLLOW_UP_NOT_YET_DUE,
        policyEligibleOn: timing.policyEligibleOn,
      });
    }
  }

  /* ---- 8. is there exactly one mailbox this could be sent from? --------- */
  const mailboxAnswer = resolveMailbox(context.athleteId);
  if (!mailboxAnswer.mailbox) {
    return refusal({
      ...currency,
      recipient,
      classification: EXECUTION_CLASS.EXECUTION_CONFIGURATION,
      reason: mailboxAnswer.reason,
      mailboxCandidates: mailboxAnswer.candidates,
    });
  }
  const mailbox = mailboxAnswer.mailbox;

  /* ---- 9. is there capacity today? -------------------------------------- */
  /**
   * BUDGETED AGAINST THE MAILBOX THAT WOULD ACTUALLY SEND, which is why this is
   * below mailbox resolution rather than beside it. `sending_identity` is the
   * ledger's key and the address is what it holds today; asking for capacity
   * before knowing which mailbox pays would be asking about nothing.
   *
   * READ, NEVER CONSUMED. `recordOutboundAttempt` is the only thing that spends
   * capacity and it belongs to the slice that actually transmits.
   */
  const budget = outboundBudgetDecisionForAthlete({
    athleteId: context.athleteId,
    sendingIdentity: mailbox.address,
    /**
     * THE SAME DAY THE REST OF THE DECISION IS ABOUT. Without this the timing
     * checks answer for `at` and the capacity check answers for the wall
     * clock, so one decision would describe two different days — invisible in
     * production, where they are the same, and wrong everywhere else.
     */
    window: utcDayWindow(onDate),
  });
  if (!budget.allowed) {
    return refusal({
      ...currency,
      recipient,
      mailbox,
      classification: budget.reason === 'MAILBOX_LIMIT_REQUIRED'
        /* A ceiling nobody has chosen is a setting, not a spent allowance. */
        ? EXECUTION_CLASS.EXECUTION_CONFIGURATION
        : EXECUTION_CLASS.TIMING_BUDGET,
      reason: budget.reason,
    });
  }

  /* ---- executable ------------------------------------------------------- */
  return {
    ...currency,
    executableNow: true,
    classification: EXECUTION_CLASS.EXECUTABLE,
    reason: null,
    recipient,
    mailbox,
    onDate,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * WHICH MAILBOX WOULD SEND THIS, AND WHY THERE ISN'T ONE.
 *
 * ---------------------------------------------------------------------------
 * ONE, OR NONE. NEVER A CHOICE MADE HERE.
 *
 * Two connected mailboxes is not a tie to break — it is a question nobody has
 * answered, and answering it silently means an athlete's outreach leaves from
 * whichever account happened to sort first. `is_primary` is a two-line
 * migration whenever somebody decides the rule; sending as the wrong person is
 * not recoverable, and no coach ever un-reads an email.
 * ---------------------------------------------------------------------------
 *
 * THE REFUSALS ARE SEPARATED BECAUSE THEY SEND AN OPERATOR TO DIFFERENT PLACES.
 * "Reconnect the mailbox you have" and "connect a mailbox" are different
 * instructions, and an operator given the wrong one looks for the wrong screen.
 */
function resolveMailbox(athleteId) {
  const usable = usableMailboxesForAthlete(athleteId)
    .filter((m) => EXECUTABLE_PROVIDERS.includes(m.provider));

  if (usable.length === 1) {
    const m = usable[0];
    /**
     * ONLY THREE FIELDS LEAVE. Enough to name the sender on a screen and to key
     * the budget, and nothing that is not needed to decide — no scopes, no
     * account id, no timestamps, and under no circumstances a credential.
     */
    return { mailbox: { id: m.id, provider: m.provider, address: m.email_address }, candidates: usable.length };
  }
  if (usable.length > 1) {
    return { mailbox: null, reason: EXECUTION_REFUSAL.MAILBOX_AMBIGUOUS, candidates: usable.length };
  }

  /* Nothing usable. Say which of the three reasons it is. */
  const attached = mailboxesAttachedToAthlete(athleteId);
  const supported = attached.filter((m) => EXECUTABLE_PROVIDERS.includes(m.provider));

  if (attached.length > 0 && supported.length === 0) {
    return { mailbox: null, reason: EXECUTION_REFUSAL.MAILBOX_UNSUPPORTED, candidates: 0 };
  }
  /**
   * A MAILBOX THAT EXISTS AND CANNOT SEND IS A RECONNECTION, not a missing
   * one — including a CONNECTED row whose credential has gone, which is the
   * same instruction to the operator and the same screen.
   */
  if (supported.length > 0) {
    return { mailbox: null, reason: EXECUTION_REFUSAL.MAILBOX_RECONSENT_REQUIRED, candidates: 0 };
  }
  return { mailbox: null, reason: EXECUTION_REFUSAL.MAILBOX_REQUIRED, candidates: 0 };
}

/**
 * Every refusal has the same shape as every success, so a caller never has to
 * know which it got before reading it. Absent facts are null rather than
 * missing — a decision that stopped at step 3 genuinely does not know which
 * mailbox would have sent it, and saying null is more honest than omitting the
 * key and letting a reader infer.
 */
function refusal(fields) {
  return {
    executableNow: false,
    classification: null,
    reason: null,
    programmeMessageId: null,
    programmeCampaignId: null,
    campaignId: null,
    athleteId: null,
    coachId: null,
    messageStep: null,
    messageState: null,
    currentStep: null,
    currentCoachId: null,
    recipient: { frozen: null, current: null, matches: false },
    mailbox: null,
    ...fields,
  };
}
