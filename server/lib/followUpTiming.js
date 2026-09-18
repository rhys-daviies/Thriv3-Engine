import { FOLLOW_UP_DELAY_DAYS } from './pursuitPolicy.js';

/**
 * WHEN A FOLLOW-UP BECOMES ELIGIBLE — D4.8, and its own module on purpose.
 *
 * ===========================================================================
 * ONE RULE, ONE IMPLEMENTATION, AND NEITHER OF ITS TWO CALLERS OWNS IT.
 *
 * It lived inside `campaignExecution` while the only thing that asked was a
 * read-only dry run. D4.8 makes the execution CLAIM refuse an early follow-up,
 * so there are two callers — and the wrong answer is a second copy.
 *
 * It is not in `pursuitPolicy` either, which owns FOLLOW_UP_DELAY_DAYS and
 * would have been the obvious home. That module holds a standing invariant,
 * asserted by test, that it contains no date arithmetic at all: a policy states
 * a number of DAYS and never resolves one into an instant, because resolving
 * needs a timezone nothing in this build has. Putting the arithmetic there
 * would have broken a rule worth more than the convenience.
 *
 * And it is not in `campaignExecution`, because `executionClaim` importing that
 * would drag a hundred-programme orchestrator onto the send path.
 *
 * So: the number lives with the policy, the arithmetic lives here, and both
 * callers import this.
 * ===========================================================================
 *
 * THE SEMANTICS ARE CALENDAR DAYS, NOT HOURS, and are carried over unchanged.
 * The anchor is truncated to a date, four days are added as four 86,400-second
 * steps from midnight UTC, and eligibility is `onDate >= eligibleOn` —
 * INCLUSIVE, so the fourth day IS the day it becomes eligible rather than the
 * day before. Nothing was reinterpreted into 96 hours; an off-by-one in either
 * direction is a follow-up that reaches a coach too soon.
 */

/** A date, from a date or an instant. No timezone, because there is none to use. */
const day = (value) => (value ? String(value).slice(0, 10) : null);

/** A date-only shift, in calendar days. No calendar, no timezone, no clock. */
function addDays(isoDate, days) {
  const t = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * @param {object} coach  a plan coach record — only `lastAcceptedAt` is read.
 * @param {string} onDate the date being asked about, ISO yyyy-mm-dd.
 *
 * THE ANCHOR IS THE LAST ACCEPTED SEND, and it is the only trustworthy
 * execution timestamp in the build: `outreach_send.sent_at`, stamped when a
 * message becomes ACCEPTED. FAILED and UNKNOWN_PROVIDER_RESULT never carry one,
 * so neither can start this clock — which is the property that stops a refused
 * send from making a follow-up look due.
 *
 * A MISSING TIMESTAMP IS NOT "DUE NOW". An accepted message with no `sent_at`
 * cannot be produced by `acceptSend`, but if one is ever met the honest answer
 * is that nobody knows when the clock started, so `unresolved` is returned and
 * it becomes a person's problem rather than a message.
 */
export function followUpTiming(coach, onDate) {
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
    due: Boolean(eligibleOn) && onDate >= eligibleOn,
    unresolved: false,
  };
}
