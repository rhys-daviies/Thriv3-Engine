/**
 * A7.9.3 — what a form submission becomes on the wire.
 *
 * Two things are load-bearing here and neither is obvious from reading
 * `sanitizePlayerData`: the contribution pair must survive a pass whose whole
 * job is deleting empty values, and `budget_range` must never be INVENTED for
 * an athlete created under the new question.
 */
import { describe, it, expect } from 'vitest';
import { sanitizePlayerData } from './playerPayload.js';
import { contributionPayload, contributionFromPlayer, chooseContribution, setContributionAmount, CONTRIBUTION_STATE } from './contributionIntake.js';
import { contributionPairError } from '../../shared/matching/v2/financialRules.js';

const { STATED, NOT_A_CONSTRAINT, NEEDS_CONFIRMATION } = CONTRIBUTION_STATE;

/** What PlayerFormSteps hands its onSubmit for a brand-new athlete. */
const submission = (contribution, over = {}) => ({
  full_name: 'Test Athlete', position: 'Midfielder', recruiting_class_year: 2028,
  preferred_divisions: ['NCAA D1'], budget_range: '', gpa: '', sat_score: '',
  ...contributionPayload(contribution),
  ...over,
});

describe('the contribution pair survives the empty-value pass', () => {
  it('keeps an explicit null maximum for NOT_A_CONSTRAINT', () => {
    const out = sanitizePlayerData(submission({ choice: NOT_A_CONSTRAINT, amount: '' }));
    expect(out.contribution_state).toBe(NOT_A_CONSTRAINT);
    expect(out).toHaveProperty('max_annual_contribution_usd', null);
  });

  it('keeps an explicit null maximum for NEEDS_CONFIRMATION', () => {
    const out = sanitizePlayerData(submission({ choice: NEEDS_CONFIRMATION, amount: '' }));
    expect(out.contribution_state).toBe(NEEDS_CONFIRMATION);
    expect(out).toHaveProperty('max_annual_contribution_usd', null);
  });

  it('sends a stated maximum as a number, not the form string', () => {
    const out = sanitizePlayerData(submission({ choice: STATED, amount: '45000' }));
    expect(out.max_annual_contribution_usd).toBe(45000);
    expect(typeof out.max_annual_contribution_usd).toBe('number');
  });

  it('keeps a stated maximum of zero, which the empty-value pass would delete', () => {
    const out = sanitizePlayerData(submission({ choice: STATED, amount: '0' }));
    expect(out.contribution_state).toBe(STATED);
    expect(out.max_annual_contribution_usd).toBe(0);
  });

  it('produces a pair the server accepts, for every state the form can reach', () => {
    for (const form of [
      { choice: NEEDS_CONFIRMATION, amount: '' },
      { choice: NOT_A_CONSTRAINT, amount: '' },
      { choice: STATED, amount: '0' },
      { choice: STATED, amount: '60000' },
    ]) {
      const out = sanitizePlayerData(submission(form));
      expect(contributionPairError({
        contributionState: out.contribution_state,
        maxAnnualContributionUsd: out.max_annual_contribution_usd,
      }), JSON.stringify(form)).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ */
/* THE TRANSITION GUARD                                                */
/* ------------------------------------------------------------------ */

/**
 * A KNOWN, TRACKED GAP — not a passing detail.
 *
 * V1 is still the engine behind live recommendations (src/lib/playerAnalysis.js)
 * and it reads affordability from `budget_range` and nothing else. An athlete
 * created under the new question carries no band, so V1 scores their
 * affordability as unscoreable until V2 Financial is wired into the live path.
 *
 * Measured on Fixture B, a tight-budget athlete: 33 of the top 100 survive,
 * so 67 programmes move. A high-budget athlete barely notices (98/100).
 *
 * The temptation, when that is discovered later, is to quietly derive a band
 * from the stated maximum and make the symptom disappear. That would put a
 * number in the record the family never stated — the exact failure A7.9.1 and
 * A7.9.2 exist to prevent — and it would hide the gap instead of closing it.
 *
 * So this test asserts the fallback DOES NOT EXIST. If someone adds one, this
 * fails, and the right fix is to finish the V2 integration rather than to
 * change this expectation.
 */
describe('new-format athletes never fall back to an invented budget_range', () => {
  it.each([
    ['a stated maximum', { choice: STATED, amount: '45000' }],
    ['a stated maximum of zero', { choice: STATED, amount: '0' }],
    ['cost is not a constraint', { choice: NOT_A_CONSTRAINT, amount: '' }],
    ['needs confirmation', { choice: NEEDS_CONFIRMATION, amount: '' }],
  ])('writes no band for %s', (_label, form) => {
    const out = sanitizePlayerData(submission(form));
    expect(out.budget_range).toBeUndefined();
  });

  it('does not derive a band from the stated maximum, however tempting', () => {
    const out = sanitizePlayerData(submission({ choice: STATED, amount: '37500' }));
    expect(out).not.toHaveProperty('budget_range');
    // Nothing anywhere in the payload spells a band.
    expect(JSON.stringify(out)).not.toMatch(/\$\d+k/);
  });

  it('still PRESERVES a legacy band that is already on the athlete', () => {
    // Editing an old record must not destroy its history — only new intake
    // stops writing one.
    const out = sanitizePlayerData(submission(
      { choice: NEEDS_CONFIRMATION, amount: '' },
      { budget_range: '$30k-$35k/yr' },
    ));
    expect(out.budget_range).toBe('$30k-$35k/yr');
    expect(out.max_annual_contribution_usd).toBeNull();
  });

  it('round-trips a legacy athlete through the form without inventing a maximum', () => {
    const stored = { budget_range: '$40k+/yr' };
    const form = contributionFromPlayer(stored);
    const out = sanitizePlayerData(submission(form, { budget_range: stored.budget_range }));
    expect(out.budget_range).toBe('$40k+/yr');
    expect(out.contribution_state).toBe(NEEDS_CONFIRMATION);
    expect(out.max_annual_contribution_usd).toBeNull();
  });
});

describe('switching answers does not strand a stale maximum on the wire', () => {
  it('sends null after a typed amount is abandoned', () => {
    const typed = setContributionAmount({ choice: STATED, amount: '', legacyBand: null }, '55000');
    const out = sanitizePlayerData(submission(chooseContribution(typed, NOT_A_CONSTRAINT)));
    expect(out.max_annual_contribution_usd).toBeNull();
    expect(out.contribution_state).toBe(NOT_A_CONSTRAINT);
  });
});
