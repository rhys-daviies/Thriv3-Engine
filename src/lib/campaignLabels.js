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
    description: 'This programme is worked by hand for this athlete. A campaign does not write to '
      + 'it; a person still can, from Relationship Outreach.',
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

/** A date an operator reads, from the ISO dates and timestamps the plan carries. */
export function shortDate(value) {
  if (!value) return null;
  const at = new Date(String(value).length <= 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
