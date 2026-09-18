/**
 * SERVER CODES, IN WORDS AN OPERATOR CAN ACT ON.
 *
 * PRESENTATION ONLY. Nothing here decides anything: the plan already says
 * whether a programme is executable, which coach is current, what step it is
 * on and what refused it. This turns those answers into sentences, and a
 * sentence that disagreed with the plan would be a second policy.
 *
 * ---------------------------------------------------------------------------
 * THE GROUPING IS NOT DONE HERE, AND THAT IS DELIBERATE.
 *
 * `category` below is a HINT for wording and tone. A programme's group comes
 * from the authoritative fields — `firstTouchReview.required`,
 * `executableNow`, `exhausted`, `safety.kind` — because a programme can carry
 * several blockers at once and the codes do not rank themselves. See
 * `groupFor` in CampaignTab.
 * ---------------------------------------------------------------------------
 *
 * WHAT NONE OF THIS COPY MAY SAY. Opened, read, clicked, delivered, bounced,
 * replied. This build has no pixel, no click tracking and no reply ingestion,
 * and the only reply fact it holds is one a person recorded by hand.
 */

import { CREATE_EMAIL_DRAFT } from '@/lib/outreachLabels';

/** Tone, not grouping. Which of these a card shows is decided by the plan. */
export const BLOCKER_CATEGORY = Object.freeze({
  /** A person must decide something, and can. */
  REVIEW: 'review',
  /** Nobody may write, and no button will change that. */
  PROHIBITION: 'prohibition',
  /** Not this campaign's to send. Correct, not broken. */
  WORKFLOW: 'workflow',
  /** A fact about the campaign's own lifecycle or dates. */
  LIFECYCLE: 'lifecycle',
  /** Waiting for a day to arrive. */
  TIMING: 'timing',
  /** Capacity or configuration, and true of the whole campaign rather than one school. */
  CAPACITY: 'capacity',
  /** Policy has nothing further to propose here. */
  POLICY: 'policy',
  /** Two records disagree. Nobody should guess which. */
  INTEGRITY: 'integrity',
});

/**
 * One entry per code the execution plan can carry.
 *
 * `label`       four words at most, for a badge or a line.
 * `description` one sentence saying what it means and, where there is one,
 *               what the operator's actual next move is.
 */
export const BLOCKER_COPY = Object.freeze({
  // ---- a person must look ------------------------------------------------
  PRIOR_CONFIRMED_CONTACT: {
    label: 'Already contacted — review before first outreach',
    /**
     * The same fact, badge-sized. A pill has room for a noun phrase and not for
     * a sentence, and the panel it sits in already says what needs doing — so
     * the long form belongs on the blocker line, where it is the only wording
     * on offer.
     */
    short: 'Already contacted',
    description: 'This athlete has already had confirmed outreach to this coach, so a campaign '
      + 'message would read as a first introduction to somebody who has heard from them before.',
    category: BLOCKER_CATEGORY.REVIEW,
  },

  // ---- nobody may write --------------------------------------------------
  RELATIONSHIP_DO_NOT_CONTACT: {
    label: 'Do not contact',
    description: 'This programme is set to do-not-contact for this athlete. No outreach goes to '
      + 'it by any route.',
    category: BLOCKER_CATEGORY.PROHIBITION,
  },
  SUPPRESSED: {
    label: 'Address opted out',
    description: 'This address has opted out of Thriv3, across every athlete and every campaign.',
    category: BLOCKER_CATEGORY.PROHIBITION,
  },
  OUTREACH_REVOKED: {
    label: 'Outreach revoked',
    description: 'This outreach record was revoked, so its tracking link no longer resolves. A '
      + 'further message would carry a dead link.',
    category: BLOCKER_CATEGORY.PROHIBITION,
  },

  // ---- correct, and not this campaign's work ------------------------------
  RELATIONSHIP_MANUAL_ONLY: {
    label: 'Manual outreach only',
    /*
      NAMED FROM THE CONSTANT, NOT SPELLED OUT — F8c. This sentence tells an
      operator which button to press, and it went on naming "Relationship
      Outreach" after F8b renamed that button to "Create email draft".
      Importing the label means the instruction cannot fall out of step with
      the control it points at a second time.
    */
    description: 'This programme is worked by hand for this athlete. A campaign does not write to '
      + `it; a person still can, using "${CREATE_EMAIL_DRAFT}".`,
    category: BLOCKER_CATEGORY.WORKFLOW,
  },

  // ---- the campaign's own state ------------------------------------------
  PROGRAMME_STOPPED: {
    label: 'Outreach stopped',
    description: 'Outreach to this programme was stopped for this campaign. A programme-level stop '
      + 'covers every coach there.',
    category: BLOCKER_CATEGORY.LIFECYCLE,
  },
  PROGRAMME_COMPLETED: {
    label: 'Outreach complete',
    description: 'This campaign has finished its outreach to this programme.',
    category: BLOCKER_CATEGORY.LIFECYCLE,
  },
  CAMPAIGN_NOT_ACTIVE: {
    label: 'Campaign not running',
    description: 'The campaign is not active, so nothing is sent from it.',
    category: BLOCKER_CATEGORY.LIFECYCLE,
  },
  CAMPAIGN_NOT_STARTED: {
    label: 'Campaign has not started',
    description: 'The campaign’s start date has not arrived yet.',
    category: BLOCKER_CATEGORY.LIFECYCLE,
  },
  CAMPAIGN_OUTREACH_WINDOW_CLOSED: {
    label: 'Outreach window closed',
    description: 'This campaign has stopped sending new outreach. It stays open for replies.',
    category: BLOCKER_CATEGORY.LIFECYCLE,
  },

  // ---- waiting for a day -------------------------------------------------
  FOLLOW_UP_NOT_YET_DUE: {
    label: 'Follow-up not due yet',
    description: 'The follow-up becomes due four days after the message it follows.',
    category: BLOCKER_CATEGORY.TIMING,
  },

  // ---- capacity and configuration, campaign-wide --------------------------
  MAILBOX_LIMIT_REQUIRED: {
    label: 'Sending not configured',
    description: 'A daily mailbox limit has not been set, so nothing can be sent from this '
      + 'campaign yet. It is a configuration setting, not a problem with these programmes.',
    category: BLOCKER_CATEGORY.CAPACITY,
  },
  SENDING_IDENTITY_REQUIRED: {
    label: 'Sending not configured',
    description: 'No sending mailbox is configured, so capacity cannot be worked out.',
    category: BLOCKER_CATEGORY.CAPACITY,
  },
  ATHLETE_DAILY_BUDGET_WOULD_BE_EXCEEDED: {
    label: 'Athlete’s daily limit reached',
    description: 'This athlete has used today’s outreach allowance. More becomes available '
      + 'tomorrow.',
    category: BLOCKER_CATEGORY.CAPACITY,
  },
  MAILBOX_DAILY_BUDGET_WOULD_BE_EXCEEDED: {
    label: 'Mailbox daily limit reached',
    description: 'The sending mailbox has used today’s allowance. More becomes available tomorrow.',
    category: BLOCKER_CATEGORY.CAPACITY,
  },

  // ---- policy has nothing further -----------------------------------------
  NO_ELIGIBLE_COACHES: {
    label: 'No reachable staff on file',
    description: 'Nobody at this programme can be approached: the staff on file have no usable '
      + 'address, hold roles a campaign does not write to, or have opted out.',
    category: BLOCKER_CATEGORY.POLICY,
  },
  ALL_COACHES_EXHAUSTED: {
    label: 'Every coach written to',
    description: 'This campaign has used its messages with everybody it may approach here.',
    category: BLOCKER_CATEGORY.POLICY,
  },
  TIER_DEPTH_REACHED: {
    label: 'Tier depth reached',
    description: 'This programme’s tier allows a limited number of people to be approached, and '
      + 'that number is used.',
    category: BLOCKER_CATEGORY.POLICY,
  },
  RESPONSE_OBSERVED: {
    label: 'Reply recorded',
    description: 'Somebody recorded a reply from this programme, so the campaign stops and a '
      + 'person takes it from here.',
    category: BLOCKER_CATEGORY.POLICY,
  },

  // ---- two records disagree ------------------------------------------------
  CONTACT_ATTEMPT_STEP_DRIFT: {
    label: 'Records disagree',
    description: 'The stored step and the messages on file do not match. Nobody should guess which '
      + 'is right.',
    category: BLOCKER_CATEGORY.INTEGRITY,
  },
  UNRESOLVED_FOLLOW_UP_TIMING: {
    label: 'Follow-up timing unknown',
    description: 'A message is recorded as sent with no send time, so when the follow-up becomes '
      + 'due cannot be worked out.',
    category: BLOCKER_CATEGORY.INTEGRITY,
  },
  PROGRAMME_CAMPAIGN_NOT_FOUND: {
    label: 'Records disagree',
    description: 'This programme’s campaign records could not be resolved.',
    category: BLOCKER_CATEGORY.INTEGRITY,
  },
  CAMPAIGN_ATHLETE_MISMATCH: {
    label: 'Records disagree',
    description: 'This programme is attributed to a different athlete’s campaign.',
    category: BLOCKER_CATEGORY.INTEGRITY,
  },
  CAMPAIGN_PROGRAMME_MISMATCH: {
    label: 'Records disagree',
    description: 'This coach is not on record at the programme this campaign names.',
    category: BLOCKER_CATEGORY.INTEGRITY,
  },
});

/**
 * A code nobody has written copy for yet.
 *
 * SAFE RATHER THAN INFORMATIVE. A future refusal — a provider block, a policy
 * this build has not met — must not reach an operator as
 * `SOME_NEW_UPPERCASE_CODE`, which reads as a crash and tells them nothing they
 * can act on. It is reported as blocked, without a claim about why, and the
 * exhaustiveness test is what keeps this rare.
 */
const UNKNOWN = Object.freeze({
  label: 'Not available for outreach',
  description: 'This programme cannot be contacted by the campaign right now. The reason is not '
    + 'one this screen has wording for yet.',
  category: BLOCKER_CATEGORY.POLICY,
});

/** Copy for one blocker code. Never null, and never the raw code. */
export function blockerCopy(code) {
  return BLOCKER_COPY[code] ?? UNKNOWN;
}

/** True where this code is a fact about the campaign rather than about a school. */
export function isCampaignWide(code) {
  return blockerCopy(code).category === BLOCKER_CATEGORY.CAPACITY;
}

/* -------------------------------------------------------------------------- */
/* The rest of the plan's vocabulary                                           */
/* -------------------------------------------------------------------------- */

/** What the campaign would do next. Campaign-local, never a lifetime sequence. */
export const ACTION_COPY = Object.freeze({
  INITIAL_OUTREACH: 'Initial outreach',
  FOLLOW_UP: 'Follow-up',
  AWAITING_OPERATOR: 'Waiting for a person',
  NO_FURTHER_COLD_OUTREACH: 'No further outreach',
});

/** Why that action, in the operator's terms. Secondary to the action itself. */
export const REASON_COPY = Object.freeze({
  FIRST_CONTACT: 'first approach to this programme',
  NO_RESPONSE_TO_INITIAL: 'no response to the first message',
  PREVIOUS_COACH_EXHAUSTED: 'the previous coach has been written to',
  RESPONSE_OBSERVED: 'a reply was recorded',
  TIER_DEPTH_REACHED: 'tier depth reached',
  NO_ELIGIBLE_COACHES: 'nobody reachable on file',
  ALL_COACHES_EXHAUSTED: 'every coach has been written to',
});

/** The contact ladder, as a person would say it. */
export const ROLE_COPY = Object.freeze({
  head: 'Head Coach',
  'associate-head': 'Associate Head Coach',
  assistant: 'Assistant Coach',
  goalkeeper: 'Goalkeeper Coach',
  'team-email': 'Team inbox',
});

/**
 * Where an address came from. `inferred` is named because 18.3% of addresses
 * were derived from a programme's pattern rather than read off a page, and an
 * operator reading a card should know which they are looking at.
 */
export const EMAIL_STATUS_COPY = Object.freeze({
  verified: null,           // the normal case says nothing
  inferred: 'Address inferred from the programme’s pattern',
  unknown: 'Address not verified',
});

/** Campaign lifecycle, for the header badge. */
export const CAMPAIGN_STATE_COPY = Object.freeze({
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
});

/**
 * WHY AN APPROVAL DID NOT RECORD, IN WORDS.
 *
 * Two of these are not really failures: the server has simply moved on since
 * the page was drawn — somebody sent a message, the plan advanced to another
 * coach — and the honest response is to read the plan again rather than argue
 * with it. `refresh` says which those are.
 *
 * The raw code is never the operator's text. It is a name for a rule, not a
 * sentence about what happened.
 */
export const APPROVAL_ERROR = Object.freeze({
  NO_REVIEW_REQUIRED: {
    message: 'There is no longer a first-touch review to approve here. Reloading the campaign.',
    refresh: true,
  },
  COACH_NOT_IN_PURSUIT: {
    message: 'This campaign is no longer approaching that coach. Reloading the campaign.',
    refresh: true,
  },
  CAMPAIGN_NOT_FOUND: {
    message: 'This campaign could not be found. Reloading.',
    refresh: true,
  },
  PROGRAMME_CAMPAIGN_NOT_FOUND: {
    message: 'This programme is no longer part of the campaign. Reloading.',
    refresh: true,
  },
});

const APPROVAL_FAILED = Object.freeze({
  message: 'Approval could not be recorded. Try again.',
  refresh: false,
});

/** What to tell the operator, and whether to go and look again. */
export function approvalError(err) {
  if (err?.status === 404) return APPROVAL_ERROR.CAMPAIGN_NOT_FOUND;
  return APPROVAL_ERROR[err?.code] ?? APPROVAL_FAILED;
}

/* -------------------------------------------------------------------------- */
/* Preparing a contact attempt — F9b-3                                         */
/* -------------------------------------------------------------------------- */

/**
 * WHAT A PREPARED ATTEMPT IS, IN THE ONLY WORDS THAT ARE TRUE OF IT.
 *
 * A prepared attempt is a record that this campaign INTENDS to write to the
 * coach the server named. No message exists, no mailbox was touched, no
 * capacity was reserved and no transport was called.
 *
 * SO THIS VOCABULARY IS DELIBERATELY FLAT. Not "ready to send", not "queued",
 * not "scheduled", not "drafted", not "email prepared" — every one of those
 * claims something the row does not say, and an operator who believed any of
 * them would think outreach had started. It reads as operational metadata
 * because that is what it is.
 */
export const PREPARE_COPY = Object.freeze({
  /** The control at rest. Says what it records, not what it achieves. */
  action: 'Prepare next attempt',
  confirm: 'Confirm preparation',
  cancel: 'Cancel',
  pending: 'Recording the intent…',
  /**
   * THE ONE SENTENCE THAT KEEPS THE BUTTON HONEST. Shown at the confirmation
   * step rather than on every card: an operator deciding needs it, and a
   * hundred cards each explaining themselves is not a screen.
   */
  explain: 'Records the campaign’s next contact intent. Nothing will be sent.',
  /** The prepared marker. `state` is not surfaced — see `preparedLabel`. */
  prepared: 'Attempt prepared',
  /**
   * F9 can only produce `planned`. Anything else would be a state this build
   * has no meaning for, so it gets a neutral marker rather than an invented one.
   */
  preparedUnknown: 'Attempt recorded',
});

/**
 * The prepared marker for an attempt, and the date if there is one.
 *
 * A MISSING `createdAt` IS NOT A MISSING MARKER. The attempt exists either way;
 * what is unknown is when. Printing a fabricated or empty date would be worse
 * than printing none, so the marker stands alone.
 */
export function preparedLabel(currentAttempt) {
  if (!currentAttempt?.id) return null;
  const label = currentAttempt.state === 'planned'
    ? PREPARE_COPY.prepared
    : PREPARE_COPY.preparedUnknown;
  return { label, on: shortDate(currentAttempt.createdAt) };
}

/**
 * WHY PREPARING DID NOT RECORD, IN WORDS — and whether to go and look again.
 *
 * MOST OF THESE ARE NOT FAILURES. The server has moved on since the page was
 * drawn — a message was confirmed, a stance changed, the campaign closed — and
 * the honest response is to read the plan again and let it decide what the card
 * should say. `refresh` marks those.
 *
 * What is NOT refreshed is a failure with no server opinion in it: a dropped
 * connection or a 500. The plan on screen is still the one the server sent and
 * is still true, so it stays and the error sits on the control that tried.
 * Retrying is safe because the endpoint is idempotent.
 */
export const PREPARATION_ERROR = Object.freeze({
  NO_ELIGIBLE_COACH: {
    message: 'There is nobody at this programme the campaign can approach. Reloading the campaign.',
    refresh: true,
  },
  NO_ACTION_TO_PREPARE: {
    message: 'This campaign has no next message to prepare here. Reloading the campaign.',
    refresh: true,
  },
  PROGRAMME_CAMPAIGN_NOT_FOUND: {
    message: 'This programme is no longer part of the campaign. Reloading.',
    refresh: true,
  },
  /**
   * THE ONE REFUSAL THE OPERATOR CAN RESOLVE ON THIS PAGE. It points at the
   * review rather than apologising, and the reload moves the card into "Needs
   * your review" if that is what the server now says.
   */
  CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED: {
    message: 'This athlete has already had confirmed outreach to this coach, so the first '
      + 'message needs reviewing before the campaign can pursue them. Reloading the campaign.',
    refresh: true,
  },
});

/**
 * Refusals that are a DECISION somebody already took, worded from the vocabulary
 * the cards already use.
 *
 * Reusing `BLOCKER_COPY` rather than writing a second set of sentences is the
 * point: an operator who has read "Manual outreach only" on a card should meet
 * the same words when a preparation is refused for it, and two copies of the
 * same explanation are two things that can drift apart.
 *
 * `CAMPAIGN_NOT_ACTIVE` is in here rather than given bespoke copy precisely
 * because it covers a draft AND a closed campaign. "Activate it first" would be
 * wrong advice for one of them; the shared line says only what is true of both.
 */
const PREPARATION_PROHIBITIONS = Object.freeze([
  'RELATIONSHIP_MANUAL_ONLY',
  'RELATIONSHIP_DO_NOT_CONTACT',
  'OUTREACH_REVOKED',
  'PROGRAMME_STOPPED',
  'PROGRAMME_COMPLETED',
  'CAMPAIGN_NOT_ACTIVE',
  'SUPPRESSED',
]);

const PREPARATION_FAILED = Object.freeze({
  message: 'The attempt could not be prepared. Try again.',
  refresh: false,
});

/** What to tell the operator, and whether to go and look again. */
export function preparationError(err) {
  if (err?.status === 404) return PREPARATION_ERROR.PROGRAMME_CAMPAIGN_NOT_FOUND;
  const code = err?.code;
  if (code && PREPARATION_ERROR[code]) return PREPARATION_ERROR[code];
  if (code && PREPARATION_PROHIBITIONS.includes(code)) {
    return { message: `${blockerCopy(code).description} Reloading the campaign.`, refresh: true };
  }
  return PREPARATION_FAILED;
}

/* -------------------------------------------------------------------------- */
/* Writing and reviewing the message — F10b-5                                  */
/* -------------------------------------------------------------------------- */

/**
 * WHAT A GENERATED MESSAGE IS, IN THE ONLY WORDS THAT ARE TRUE OF IT.
 *
 * ---------------------------------------------------------------------------
 * CONTENT, NOT DELIVERY.
 *
 * Generating writes a subject and a body into a row. It touches no mailbox,
 * reserves no capacity, queues nothing, schedules nothing and hands nothing to
 * a transport. `outreach_send` is still the only thing in this build that says
 * a message happened, and nothing on this screen writes to it.
 *
 * SO THE VOCABULARY IS FLAT, the same discipline `PREPARE_COPY` follows above.
 * Not "ready to send", not "queued", not "draft sent to your outbox", not
 * "approve" — every one of those claims something the row does not say.
 * ---------------------------------------------------------------------------
 */
export const MESSAGE_COPY = Object.freeze({
  generate: 'Generate message',
  generateConfirm: 'Generate message',
  cancel: 'Cancel',
  generatePending: 'Generating message…',
  /** The one sentence that keeps the button honest, shown at the confirmation. */
  generateExplain: 'Thriv3 will write this campaign’s personalised email using the current '
    + 'athlete and programme evidence. Nothing will be sent.',

  open: 'Review message',
  openReviewed: 'View message',
  back: 'Back to campaign',
  loading: 'Loading the message…',

  save: 'Save changes',
  savePending: 'Saving…',
  saved: 'Changes saved.',

  review: 'Review message',
  reviewConfirm: 'Mark as reviewed',
  reviewPending: 'Recording review…',
  /**
   * SAID ABOUT THIS MESSAGE AND THIS OPERATOR, never about the product.
   *
   * "An operator has to review every email before it goes" is a policy nobody
   * has decided, and copy that asserted it would make a future automated
   * campaign look like a violation of a promise this screen invented. What is
   * true today is that this transition is the one available here.
   */
  reviewExplain: 'This records that you have reviewed the exact subject and message shown here. '
    + 'It does not send, queue or schedule the email.',
  reviewDirty: 'Save your changes before reviewing this message.',

  discard: 'Discard unsaved changes?',
  discardConfirm: 'Discard changes',
  keepEditing: 'Keep editing',

  /**
   * THE ONE TOKEN THAT SURVIVES COMPOSITION, EXPLAINED.
   *
   * ---------------------------------------------------------------------------
   * FOUND BY LOOKING AT THE REAL SCREEN.
   *
   * `composeMessage` deliberately leaves `{{player_profile_url}}` unresolved:
   * the tracked link carries a per-coach token that only exists once an
   * outreach record is minted, so the composed body cannot contain it. This
   * repo already knows what that costs a reader — `emailTemplate.js` says in so
   * many words that a preview showing the raw token "looks like the link failed
   * to resolve rather than like it resolves later", which is why the composer
   * previews substitute a real URL.
   *
   * THIS SCREEN CANNOT SUBSTITUTE IT. The body is an EDITABLE field whose value
   * is saved verbatim, so quietly swapping the token for display would either
   * be lost on save or written into the stored message as a link belonging to
   * one coach. So the token stays exactly as stored and gets a sentence instead.
   * ---------------------------------------------------------------------------
   */
  profileToken: '{{player_profile_url}}',
  profileTokenNote: 'Thriv3 replaces {{player_profile_url}} with this athlete’s tracked '
    + 'profile link, one per coach. Leave it as it is — it is not part of the words you '
    + 'are reviewing.',

  evidenceHeading: 'Why this was written',
  /**
   * THE HONEST SENTENCE FOR A MESSAGE WITH NOTHING BEHIND IT. Some programmes
   * have no licensed evidence at all, and the composer falls back to the
   * generic template. Saying nothing would let the empty heading imply the
   * evidence was simply not shown.
   */
  evidenceNone: 'No specific evidence was used in this message. Thriv3 used the generic '
    + 'outreach template.',
  editedBeforeReview: 'Edited before review',
});

/**
 * THE MESSAGE'S CONTENT STATE, AND NOTHING ABOUT WHETHER IT MAY GO.
 *
 * `generated` and `reviewed` describe WORDS. They do not mean contactable,
 * sendable, due, within budget or that a mailbox exists — the card's own
 * blockers remain the only answer to that, which is why neither of these is
 * green and neither says "ready".
 */
export const MESSAGE_STATE_COPY = Object.freeze({
  generated: 'Generated',
  reviewed: 'Reviewed',
});

export function messageStateLabel(state) {
  return MESSAGE_STATE_COPY[state] ?? (state ? 'Written' : null);
}

/**
 * WHY A MESSAGE WAS NOT WRITTEN, IN WORDS — and whether to go and look again.
 *
 * The same shape and the same discipline as `preparationError`: most of these
 * are not failures at all. The server has moved on since the page was drawn —
 * the campaign advanced a step, a stance changed, somebody sent something — and
 * the honest response is to read the plan again and let it decide what the card
 * should say.
 *
 * What is NOT refreshed is a failure with no server opinion in it: a dropped
 * connection or a 500. The plan on screen is still the server's and is still
 * true, so it stays, and the error sits on the control that tried. Retrying is
 * safe because generation is idempotent — a second call returns the message the
 * first one wrote.
 */
export const GENERATION_ERROR = Object.freeze({
  /**
   * NOTHING HAS BEEN PREPARED. The commonest of these by far, and it is not an
   * error: the operator is looking at a card whose Prepare step has not
   * happened, or whose attempt was consumed by a send. The reload puts the
   * right control back on the card.
   */
  CONTACT_ATTEMPT_REQUIRED: {
    message: 'This campaign has not recorded an intent to contact this coach yet, so there is '
      + 'nothing to write. Reloading the campaign.',
    refresh: true,
  },
  CONTACT_ATTEMPT_NOT_PLANNED: {
    message: 'This contact attempt is no longer being pursued. Reloading the campaign.',
    refresh: true,
  },
  COACH_NO_LONGER_CURRENT: {
    message: 'This campaign has moved on to a different coach at this programme. Reloading the '
      + 'campaign.',
    refresh: true,
  },
  /**
   * TWO RECORDS DISAGREE, and nobody should guess which. The reload is what
   * surfaces the drift on the card, where the existing blocker copy explains it.
   */
  CONTACT_ATTEMPT_STEP_DRIFT: {
    message: 'The prepared attempt and the campaign disagree about which message this would be, '
      + 'so nothing was written. Reloading the campaign.',
    refresh: true,
  },
  NO_ACTION_TO_PREPARE: {
    message: 'This campaign has no next message to write here. Reloading the campaign.',
    refresh: true,
  },
  NO_ELIGIBLE_COACH: {
    message: 'There is nobody at this programme the campaign can approach. Reloading the campaign.',
    refresh: true,
  },
  CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED: {
    message: 'This athlete has already had confirmed outreach to this coach, so the first '
      + 'message needs reviewing before the campaign can pursue them. Reloading the campaign.',
    refresh: true,
  },
  PROGRAMME_CAMPAIGN_NOT_FOUND: {
    message: 'This programme is no longer part of the campaign. Reloading.',
    refresh: true,
  },
  COACH_NOT_FOUND: {
    message: 'This coach is no longer on file. Reloading the campaign.',
    refresh: true,
  },
});

const GENERATION_FAILED = Object.freeze({
  message: 'The message could not be written. Try again.',
  refresh: false,
});

/**
 * What to tell the operator, and whether to go and look again.
 *
 * The prohibitions reuse `BLOCKER_COPY` rather than getting a second set of
 * sentences — an operator who has read "Manual outreach only" on a card should
 * meet the same words when generation is refused for it, and two copies of one
 * explanation are two things that can drift apart.
 */
export function generationError(err) {
  if (err?.status === 404 && !err?.code) return GENERATION_ERROR.PROGRAMME_CAMPAIGN_NOT_FOUND;
  const code = err?.code;
  if (code && GENERATION_ERROR[code]) return GENERATION_ERROR[code];
  if (code && PREPARATION_PROHIBITIONS.includes(code)) {
    return { message: `${blockerCopy(code).description} Reloading the campaign.`, refresh: true };
  }
  return GENERATION_FAILED;
}

/**
 * WHY ONE MESSAGE COULD NOT BE READ, EDITED OR REVIEWED.
 *
 * ---------------------------------------------------------------------------
 * A REFUSAL HERE IS ABOUT THE MESSAGE, NOT ABOUT THE CAMPAIGN.
 *
 * Editing and reviewing are deliberately NOT gated on live campaign safety: a
 * message written before a coach was set to do-not-contact is still exactly
 * what was written, and a person may still read it and record that they have.
 * So there is no stance, suppression or lifecycle code in this table — the only
 * things that can refuse are the message being gone, and the message being
 * already reviewed.
 * ---------------------------------------------------------------------------
 *
 * `gone` rather than `refresh`: this error happens INSIDE the detail view, and
 * the answer is to leave it and reload the campaign rather than to redraw a
 * screen about a message that is not there.
 */
export const MESSAGE_ERROR = Object.freeze({
  PROGRAMME_MESSAGE_NOT_FOUND: {
    message: 'This message is no longer on file. Returning to the campaign.',
    gone: true,
  },
  /**
   * SOMEBODY ELSE REVIEWED IT WHILE THIS SCREEN WAS OPEN. The words are final
   * and the edit was not applied, so the honest move is to show what is
   * actually stored rather than to keep an unsaved draft on screen.
   */
  MESSAGE_NOT_EDITABLE: {
    message: 'This message has already been reviewed, so its words are final. '
      + 'Reloading the message.',
    reload: true,
  },
  ILLEGAL_MESSAGE_TRANSITION: {
    message: 'This message has already been reviewed. Reloading the message.',
    reload: true,
  },
  EMPTY_SUBJECT: { message: 'A subject is required.', field: 'subject' },
  EMPTY_BODY: { message: 'A message body is required.', field: 'body' },
});

const MESSAGE_FAILED = Object.freeze({
  message: 'The message could not be loaded. Try again.',
});

const SAVE_FAILED = Object.freeze({
  message: 'Your changes could not be saved. Try again.',
});

const REVIEW_FAILED = Object.freeze({
  message: 'The review could not be recorded. Try again.',
});

/** Reading one message. A 404 means it is gone, and the campaign is where to go. */
export function messageLoadError(err) {
  if (err?.status === 404) return MESSAGE_ERROR.PROGRAMME_MESSAGE_NOT_FOUND;
  return MESSAGE_ERROR[err?.code] ?? MESSAGE_FAILED;
}

export function messageEditError(err) {
  if (err?.status === 404) return MESSAGE_ERROR.PROGRAMME_MESSAGE_NOT_FOUND;
  return MESSAGE_ERROR[err?.code] ?? SAVE_FAILED;
}

export function messageReviewError(err) {
  if (err?.status === 404) return MESSAGE_ERROR.PROGRAMME_MESSAGE_NOT_FOUND;
  return MESSAGE_ERROR[err?.code] ?? REVIEW_FAILED;
}

/**
 * THE SENTENCES THE EMAIL ACTUALLY MADE, in the order it made them.
 *
 * ---------------------------------------------------------------------------
 * `rendered` IS THE ANSWER, AND `held` IS NOT.
 *
 * `held` is a list of evidence KINDS the body cap licensed and deliberately
 * withheld — claims this email does NOT make. It carries no sentences, only
 * kind names, and presenting it under "Why this was written" would offer an
 * operator a justification the coach will never read. It is kept for later
 * causal comparison and is not part of this screen.
 * ---------------------------------------------------------------------------
 */
export function evidenceSentences(evidence) {
  const rendered = Array.isArray(evidence?.rendered) ? evidence.rendered : [];
  return rendered
    .filter((r) => typeof r?.text === 'string' && r.text.trim().length > 0)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((r) => ({
      key: `${r.order}:${r.kind ?? ''}`,
      text: r.text,
      /** A quiet label, only where the role is one this build names. */
      role: EVIDENCE_ROLE_COPY[r.role] ?? null,
    }));
}

/**
 * WHAT A SENTENCE IS DOING IN THE EMAIL. Three roles, and they are the
 * composer's own — this names them, it does not decide them.
 */
export const EVIDENCE_ROLE_COPY = Object.freeze({
  HOOK: 'Opening',
  RELEVANCE: 'Why this programme',
  RECOGNITION: 'What they have done',
});

/** A date an operator reads, from the ISO dates and timestamps the plan carries. */
export function shortDate(value) {
  if (!value) return null;
  const at = new Date(String(value).length <= 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
