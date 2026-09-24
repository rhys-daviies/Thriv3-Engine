/**
 * A7.9.3 — the family-contribution question, as a form answers it.
 *
 * Every rule the intake enforces lives in contributionIntake.js rather than
 * in the component, so it can be tested as behaviour instead of as markup.
 * The two source guards at the bottom cover the one thing that is genuinely
 * about the rendered form: that the retired band picker is gone.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTRIBUTION_STATE, DEFAULT_CHOICE, contributionFromPlayer, chooseContribution,
  setContributionAmount, contributionError, contributionValid, contributionPayload,
  contributionSummary, formatAmount, hasUnconfirmedLegacy,
} from './contributionIntake.js';
import { contributionPairError } from '../../shared/matching/v2/financialRules.js';

const { STATED, NOT_A_CONSTRAINT, NEEDS_CONFIRMATION } = CONTRIBUTION_STATE;
const form = (over = {}) => ({ choice: DEFAULT_CHOICE, amount: '', legacyBand: null, ...over });

describe('a new athlete defaults safely', () => {
  it('starts as needing confirmation, with no amount', () => {
    const f = contributionFromPlayer(null);
    expect(f.choice).toBe(NEEDS_CONFIRMATION);
    expect(f.amount).toBe('');
    expect(f.legacyBand).toBeNull();
  });

  it('is never $0 and never "not a constraint" by default', () => {
    expect(DEFAULT_CHOICE).not.toBe(STATED);
    expect(DEFAULT_CHOICE).not.toBe(NOT_A_CONSTRAINT);
  });

  it('is submittable immediately — an unanswered question does not block creation', () => {
    expect(contributionValid(contributionFromPlayer(null))).toBe(true);
    expect(contributionPayload(contributionFromPlayer(null)))
      .toEqual({ contribution_state: NEEDS_CONFIRMATION, max_annual_contribution_usd: null });
  });
});

describe('a stated maximum', () => {
  it('renders and submits as an integer', () => {
    const f = setContributionAmount(form({ choice: STATED }), '45,000');
    expect(f.amount).toBe('45000');
    expect(formatAmount(f.amount)).toBe('45,000');
    expect(contributionValid(f)).toBe(true);
    expect(contributionPayload(f)).toEqual({ contribution_state: STATED, max_annual_contribution_usd: 45000 });
  });

  it('accepts $0 as an explicit answer, not as an absence', () => {
    const f = setContributionAmount(form({ choice: STATED }), '0');
    expect(contributionError(f)).toBeNull();
    expect(contributionPayload(f)).toEqual({ contribution_state: STATED, max_annual_contribution_usd: 0 });
  });

  it('strips a typed dollar sign and spaces', () => {
    expect(setContributionAmount(form({ choice: STATED }), '$ 30,000').amount).toBe('30000');
  });

  it.each([
    ['nothing at all', '', /Enter the maximum/],
    ['a negative amount', '-5000', /zero or more/],
    ['cents', '20000.50', /whole dollar/],
    ['words', 'twenty thousand', /whole dollar/],
    ['shorthand', '20k', /whole dollar/],
    ['exponent notation', '2e5', /whole dollar/],
  ])('rejects %s', (_label, raw, message) => {
    const f = { ...form({ choice: STATED }), amount: raw };
    expect(contributionError(f)).toMatch(message);
    expect(contributionValid(f)).toBe(false);
  });

  it('says nothing about the model when it complains', () => {
    const f = { ...form({ choice: STATED }), amount: 'abc' };
    const msg = contributionError(f).toLowerCase();
    for (const word of ['viability', 'measured', 'partial', 'unscoreable', 'gap', 'contribution_state']) {
      expect(msg).not.toContain(word);
    }
  });
});

describe('the two states that carry no amount', () => {
  it('submits a null maximum for "cost is not a meaningful factor"', () => {
    expect(contributionPayload(form({ choice: NOT_A_CONSTRAINT })))
      .toEqual({ contribution_state: NOT_A_CONSTRAINT, max_annual_contribution_usd: null });
  });

  it('submits a null maximum for "needs confirmation", never a zero', () => {
    const p = contributionPayload(form({ choice: NEEDS_CONFIRMATION }));
    expect(p).toEqual({ contribution_state: NEEDS_CONFIRMATION, max_annual_contribution_usd: null });
    expect(p.max_annual_contribution_usd).not.toBe(0);
  });

  it.each([[NOT_A_CONSTRAINT], [NEEDS_CONFIRMATION]])('clears a typed amount when switching to %s', (choice) => {
    const typed = setContributionAmount(form({ choice: STATED }), '55000');
    const switched = chooseContribution(typed, choice);
    expect(switched.amount).toBe('');
    expect(contributionPayload(switched).max_annual_contribution_usd).toBeNull();
  });

  it('leaves nothing invalid hidden when switching back and forth', () => {
    let f = setContributionAmount(form({ choice: STATED }), 'nonsense');
    expect(contributionValid(f)).toBe(false);
    f = chooseContribution(f, NEEDS_CONFIRMATION);
    expect(contributionValid(f)).toBe(true);
    f = chooseContribution(f, STATED);
    // Back to stated means back to empty, not back to the junk.
    expect(f.amount).toBe('');
    expect(contributionValid(f)).toBe(false);
  });
});

describe('editing an athlete who predates the question', () => {
  it.each([
    ['a bounded band', '$30k-$35k/yr'],
    ['the open band', '$40k+/yr'],
    ['Undeclared', 'Undeclared'],
  ])('does not infer a maximum from %s', (_label, band) => {
    const f = contributionFromPlayer({ budget_range: band });
    expect(f.choice).toBe(NEEDS_CONFIRMATION);
    expect(f.amount).toBe('');
    expect(f.legacyBand).toBe(band);
    expect(hasUnconfirmedLegacy(f)).toBe(true);
    expect(contributionPayload(f).max_annual_contribution_usd).toBeNull();
  });

  it('specifically never turns $40k+ into $40,000', () => {
    const f = contributionFromPlayer({ budget_range: '$40k+/yr' });
    expect(f.amount).not.toBe('40000');
    expect(contributionPayload(f).max_annual_contribution_usd).not.toBe(40000);
    expect(contributionSummary({ budget_range: '$40k+/yr' }).value).toBe('Needs confirmation');
    expect(contributionSummary({ budget_range: '$40k+/yr' }).value).not.toMatch(/40,000/);
  });

  it('restores an answer the family has already given', () => {
    expect(contributionFromPlayer({ contribution_state: 'STATED', max_annual_contribution_usd: 45000 }))
      .toMatchObject({ choice: STATED, amount: '45000' });
    expect(contributionFromPlayer({ contribution_state: 'NOT_A_CONSTRAINT' }))
      .toMatchObject({ choice: NOT_A_CONSTRAINT, amount: '' });
  });

  it('restores a stated zero rather than reading it as unanswered', () => {
    expect(contributionFromPlayer({ contribution_state: 'STATED', max_annual_contribution_usd: 0 }))
      .toMatchObject({ choice: STATED, amount: '0' });
  });

  it('stops flagging the legacy band once the question is answered', () => {
    const f = contributionFromPlayer({ budget_range: '$30k-$35k/yr', contribution_state: 'NOT_A_CONSTRAINT' });
    expect(hasUnconfirmedLegacy(f)).toBe(false);
  });
});

describe('every payload the form can produce is one the server accepts', () => {
  const forms = [
    form({ choice: NEEDS_CONFIRMATION }),
    form({ choice: NOT_A_CONSTRAINT }),
    setContributionAmount(form({ choice: STATED }), '0'),
    setContributionAmount(form({ choice: STATED }), '45000'),
    setContributionAmount(form({ choice: STATED }), '120,000'),
  ];
  it.each(forms.map((f) => [f.choice + (f.amount ? ` $${f.amount}` : ''), f]))('%s', (_label, f) => {
    expect(contributionValid(f)).toBe(true);
    const p = contributionPayload(f);
    expect(contributionPairError({
      contributionState: p.contribution_state,
      maxAnnualContributionUsd: p.max_annual_contribution_usd,
    })).toBeNull();
  });
});

describe('what the operator sees', () => {
  it('shows a stated maximum as dollars per year', () => {
    expect(contributionSummary({ contribution_state: 'STATED', max_annual_contribution_usd: 40000 }))
      .toMatchObject({ label: 'Maximum family contribution', value: '$40,000 / year', needsAttention: false });
  });

  it('shows a stated zero rather than falling through to "needs confirmation"', () => {
    expect(contributionSummary({ contribution_state: 'STATED', max_annual_contribution_usd: 0 }).value)
      .toBe('$0 / year');
  });

  it('shows the not-a-constraint answer without implying wealth', () => {
    const v = contributionSummary({ contribution_state: 'NOT_A_CONSTRAINT' }).value.toLowerCase();
    expect(v).toBe('cost is not a meaningful constraint');
    for (const word of ['unlimited', 'wealth', 'rich', 'any budget']) expect(v).not.toContain(word);
  });

  it('flags an unanswered athlete and keeps the old band as context only', () => {
    const s = contributionSummary({ budget_range: '$30k-$35k/yr' });
    expect(s).toMatchObject({ value: 'Needs confirmation', needsAttention: true });
    expect(s.note).toBe('Previous budget range: $30k-$35k/yr');
    expect(s.label).not.toMatch(/Maximum/);
  });
});

/* ------------------------------------------------------------------ */
/* The rendered form: the band picker is gone                          */
/* ------------------------------------------------------------------ */

describe('the retired budget selector', () => {
  const HERE = path.dirname(new URL(import.meta.url).pathname);
  const formSource = fs.readFileSync(path.join(HERE, '../components/PlayerFormSteps.jsx'), 'utf8');

  /**
   * A source assertion, because the thing under test IS the absence of a
   * control and this repository has no DOM-rendering test stack. It is narrow
   * on purpose: it asserts the picker's data source is no longer imported,
   * which is the only way the old options could reach the screen.
   */
  it('no longer imports the band vocabulary into the intake form', () => {
    expect(formSource).not.toMatch(/BUDGET_BANDS/);
    expect(formSource).not.toMatch(/Budget Range/);
  });

  it('cannot offer $40k+/yr, because it offers no bands at all', () => {
    expect(formSource).not.toContain('$40k+');
  });

  it('renders the family-contribution question instead', () => {
    expect(formSource).toMatch(/<FamilyContributionField/);
    expect(formSource).toMatch(/contributionPayload/);
  });

  it('never writes budget_range from the form', () => {
    // Present in form state so the column survives a save, and passed to the
    // V1 coupling preview — but never bound to an input.
    expect(formSource).not.toMatch(/set\('budget_range'\)/);
  });
});
