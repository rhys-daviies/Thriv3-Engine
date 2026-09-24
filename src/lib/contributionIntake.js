/**
 * What the family can pay, as a form answers it.
 *
 * ALL OF THE RULES, NONE OF THE MARKUP. The component below this is a
 * renderer: every transition, every validation and the exact payload shape
 * live here, where they can be tested without a DOM and cannot drift apart
 * from each other across three event handlers.
 *
 * The one thing this module must never do is INFER. A family who picked a
 * budget band years ago has not stated a maximum, and turning "$30k-$35k"
 * into $35,000 would manufacture the number that A7.9.1 spent a whole phase
 * proving we did not have. Legacy values are shown as context and the
 * question is asked again.
 */
import { CONTRIBUTION_STATE } from '@shared/matching/v2/financialRules.js';

export { CONTRIBUTION_STATE };

/**
 * The safest default for a brand-new athlete.
 *
 * Not $0, which is the full-scholarship request and a real answer. Not
 * "cost is not a constraint", which is also a real answer. Nobody has been
 * asked yet, and the evidence architecture has a word for that.
 */
export const DEFAULT_CHOICE = CONTRIBUTION_STATE.NEEDS_CONFIRMATION;

/** Digits only, once the display commas and any typed $ are removed. */
const INTEGER_DOLLARS = /^\d+$/;

/** Strip what a person types around a number: "$45,000" -> "45000". */
export const stripCurrency = (raw) => String(raw ?? '').replace(/[$,\s]/g, '');

/** Group for display while typing: "45000" -> "45,000". Non-numeric passes through. */
export function formatAmount(raw) {
  const bare = stripCurrency(raw);
  if (bare === '' || !INTEGER_DOLLARS.test(bare)) return String(raw ?? '');
  return Number(bare).toLocaleString('en-US');
}

/**
 * The form's starting state for an athlete, or for nobody.
 *
 * `legacyBand` is carried separately from `amount` ON PURPOSE. It is context
 * for the operator - "here is what this athlete said before" - and it must
 * never arrive in the field that means "the maximum this family stated".
 */
export function contributionFromPlayer(player = null) {
  const state = player?.contribution_state ?? null;
  const max = player?.max_annual_contribution_usd;
  const legacyBand = player?.budget_range || null;

  if (state === CONTRIBUTION_STATE.STATED && max !== null && max !== undefined) {
    return { choice: state, amount: String(max), legacyBand };
  }
  if (state === CONTRIBUTION_STATE.NOT_A_CONSTRAINT || state === CONTRIBUTION_STATE.NEEDS_CONFIRMATION) {
    return { choice: state, amount: '', legacyBand };
  }
  /**
   * No answer on file, whether or not a band is. A bounded band, `Undeclared`,
   * a blank and the open `$40k+` band all land here identically: the question
   * has not been answered in the terms Financial needs, so it gets asked.
   */
  return { choice: DEFAULT_CHOICE, amount: '', legacyBand };
}

/** True when this athlete has a band on file but no answer to the new question. */
export const hasUnconfirmedLegacy = (form) => Boolean(form.legacyBand) && form.choice !== CONTRIBUTION_STATE.STATED
  && form.choice !== CONTRIBUTION_STATE.NOT_A_CONSTRAINT;

/**
 * Change the answer.
 *
 * Moving off a stated maximum CLEARS it rather than hiding it. A hidden stale
 * value is how a family who changed their mind ends up submitting a number
 * they no longer stand behind - and the server would refuse the write anyway,
 * which the person would see as an unexplained failure.
 */
export function chooseContribution(form, choice) {
  if (choice === CONTRIBUTION_STATE.STATED) return { ...form, choice };
  return { ...form, choice, amount: '' };
}

/** Accept only what a dollar amount can be made of, so the field cannot hold junk. */
export function setContributionAmount(form, raw) {
  return { ...form, amount: stripCurrency(raw) };
}

/**
 * What is wrong with this answer, in words a parent can act on, or null.
 *
 * Deliberately says nothing about viability, gaps, grades or any other model
 * concept: this is a form telling someone their number is not a number.
 */
export function contributionError(form) {
  if (form.choice !== CONTRIBUTION_STATE.STATED) return null;
  const bare = stripCurrency(form.amount);
  if (bare === '') return 'Enter the maximum your family could pay per year.';
  if (String(form.amount).trim().startsWith('-') || String(form.amount).includes('-')) {
    return 'Enter an amount of zero or more.';
  }
  if (!INTEGER_DOLLARS.test(bare)) return 'Enter a whole dollar amount, with no cents.';
  return null;
}

export const contributionValid = (form) => contributionError(form) === null;

/**
 * The fields a create or update request carries.
 *
 * Always BOTH keys, and `max_annual_contribution_usd` is an explicit null on
 * the two states that forbid it. Omitting it would be read as "leave this
 * alone", which on an edit is how a stale maximum survives a change of
 * answer - the server checks the row the patch would PRODUCE and would
 * rightly refuse it.
 */
export function contributionPayload(form) {
  if (form.choice === CONTRIBUTION_STATE.STATED) {
    return {
      contribution_state: CONTRIBUTION_STATE.STATED,
      max_annual_contribution_usd: Number(stripCurrency(form.amount)),
    };
  }
  return { contribution_state: form.choice, max_annual_contribution_usd: null };
}

/**
 * What the operator should see on a profile. Plain sentences, no model words.
 *
 * `$40k+/yr` renders as the band it is and never as "Maximum contribution:
 * $40,000" - the whole point of A7.9.1 was that those are not the same claim.
 */
export function contributionSummary(player = null) {
  const state = player?.contribution_state ?? null;
  const max = player?.max_annual_contribution_usd;
  const band = player?.budget_range || null;

  if (state === CONTRIBUTION_STATE.STATED && max !== null && max !== undefined) {
    return {
      label: 'Maximum family contribution',
      value: `$${Number(max).toLocaleString('en-US')} / year`,
      needsAttention: false,
    };
  }
  if (state === CONTRIBUTION_STATE.NOT_A_CONSTRAINT) {
    return { label: 'Family contribution', value: 'Cost is not a meaningful constraint', needsAttention: false };
  }
  return {
    label: 'Family contribution',
    value: 'Needs confirmation',
    needsAttention: true,
    note: band ? `Previous budget range: ${band}` : null,
  };
}
