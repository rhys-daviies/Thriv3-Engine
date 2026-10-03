/**
 * A7.9.2. What the family told us, and what Financial is allowed to do with it.
 *
 * The monotonicity block is promoted from the A7.9.1 diagnostic
 * (server/scripts/v2GateAndFinancial.js --fin-mono), which ran it over the
 * real pool. Here it runs over the shapes that matter, permanently.
 */
import { describe, it, expect } from 'vitest';
import { financialViability } from './financial.js';
import { GRADE, REASON } from '../types.js';
import {
  familyContribution, contributionPairError, budgetInterval,
  CONTRIBUTION_STATE, CONTRIBUTION_SOURCE, CONTRIBUTION_ANCHOR,
  BUDGET_INTERVALS,
} from '../financialRules.js';

const SPORT = 'mens-soccer';
const priv = (net) => ({
  net_price: net, control: 2, tuition_in_state: null, tuition_out_state: null,
  state: 'OH', division: 'NCAA D1', conference: 'ACC',
});
/** A public the athlete is not resident in: net price plus the premium. */
const pub = (net, premium) => ({
  net_price: net, control: 1, tuition_in_state: 10000, tuition_out_state: 10000 + premium,
  state: 'MI', division: 'NCAA D1', conference: 'Big Ten Conference',
});
const F = (athlete, college) => financialViability({
  athlete: { state: 'OH', origin: 'USA', ...athlete }, college, sport: SPORT,
});
const stated = (max) => ({ contributionState: CONTRIBUTION_STATE.STATED, maxAnnualContributionUsd: max });

describe('the contribution pair is validated, never repaired', () => {
  it('accepts a wholly absent pair: a record from before the field existed', () => {
    expect(contributionPairError({})).toBeNull();
    expect(contributionPairError({ contributionState: null, maxAnnualContributionUsd: null })).toBeNull();
  });

  it.each([
    ['STATED with no maximum', { contributionState: 'STATED', maxAnnualContributionUsd: null }],
    ['STATED with a negative maximum', { contributionState: 'STATED', maxAnnualContributionUsd: -1 }],
    ['STATED with a non-finite maximum', { contributionState: 'STATED', maxAnnualContributionUsd: Number.NaN }],
    ['NOT_A_CONSTRAINT with a maximum', { contributionState: 'NOT_A_CONSTRAINT', maxAnnualContributionUsd: 50000 }],
    ['NEEDS_CONFIRMATION with a maximum', { contributionState: 'NEEDS_CONFIRMATION', maxAnnualContributionUsd: 50000 }],
    ['an unknown state', { contributionState: 'RICH', maxAnnualContributionUsd: null }],
    ['a maximum with no state at all', { contributionState: null, maxAnnualContributionUsd: 50000 }],
  ])('refuses %s', (_label, pair) => {
    expect(contributionPairError(pair)).toBeTruthy();
    expect(() => familyContribution(pair)).toThrow();
  });

  it('accepts a stated maximum of zero, which is a measurement and not an absence', () => {
    expect(contributionPairError(stated(0))).toBeNull();
    expect(familyContribution(stated(0)).interval).toEqual([0, 0]);
  });
});

describe('the four sources never collapse into each other', () => {
  it('reads an exact stated maximum as a point interval', () => {
    const r = familyContribution(stated(45000));
    expect(r.source).toBe(CONTRIBUTION_SOURCE.EXACT_STATED_MAXIMUM);
    expect(r.interval).toEqual([45000, 45000]);
    expect(r.unbounded).toBe(false);
  });

  it('reads NOT_A_CONSTRAINT as no interval at all, so nothing can subtract from it', () => {
    const r = familyContribution({ contributionState: CONTRIBUTION_STATE.NOT_A_CONSTRAINT });
    expect(r.source).toBe(CONTRIBUTION_SOURCE.NOT_A_CONSTRAINT);
    expect(r.interval).toBeNull();
  });

  it('refuses on NEEDS_CONFIRMATION even when a legacy band is present', () => {
    expect(familyContribution({
      contributionState: CONTRIBUTION_STATE.NEEDS_CONFIRMATION, budgetRange: '$20k-$25k/yr',
    })).toBeNull();
  });

  it('falls back to the legacy band only when no state is recorded', () => {
    const r = familyContribution({ budgetRange: '$20k-$25k/yr' });
    expect(r.source).toBe(CONTRIBUTION_SOURCE.LEGACY_BAND);
    expect(r.interval).toEqual([20000, 25000]);
  });

  it('prefers the new field over a band that is still on the record', () => {
    const r = familyContribution({ ...stated(70000), budgetRange: '$5k-$10k/yr' });
    expect(r.source).toBe(CONTRIBUTION_SOURCE.EXACT_STATED_MAXIMUM);
    expect(r.interval).toEqual([70000, 70000]);
  });

  it('refuses when nothing at all is on file', () => {
    expect(familyContribution({})).toBeNull();
    expect(familyContribution({ budgetRange: 'Undeclared' })).toBeNull();
  });
});

describe('evidence state', () => {
  it('grades an exact stated maximum against a measured cost as MEASURED', () => {
    expect(F(stated(50000), priv(30000)).grade).toBe(GRADE.MEASURED);
  });

  it('grades NOT_A_CONSTRAINT as MEASURED', () => {
    const r = F({ contributionState: CONTRIBUTION_STATE.NOT_A_CONSTRAINT }, priv(60000));
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('grades every band-sourced result PARTIAL, current vocabulary included', () => {
    for (const band of Object.keys(BUDGET_INTERVALS)) {
      const r = F({ budgetRange: band }, priv(30000));
      expect(r.ok, band).toBe(true);
      expect(r.grade, band).toBe(GRADE.PARTIAL);
      expect(r.basis.contributionSource, band).toBe(CONTRIBUTION_SOURCE.LEGACY_BAND);
    }
  });

  it('refuses NEEDS_CONFIRMATION through the existing path, and never as a zero', () => {
    const r = F({ contributionState: CONTRIBUTION_STATE.NEEDS_CONFIRMATION }, priv(30000));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_FAMILY_CONTRIBUTION);
    expect(r.coverage).toBe(0.5);
    expect(r.detail.contributionSource).toBe(CONTRIBUTION_SOURCE.NEEDS_CONFIRMATION);
    // The opposite answer, for contrast: a stated zero SCORES.
    expect(F(stated(0), priv(30000)).ok).toBe(true);
  });
});

describe('NOT_A_CONSTRAINT is a statement about the family, not about the programme', () => {
  it('scores 1.0 with a gap of zero by construction, however expensive the programme', () => {
    for (const cost of [0, 25000, 62688, 200000]) {
      const r = F({ contributionState: CONTRIBUTION_STATE.NOT_A_CONSTRAINT }, priv(cost));
      expect(r.value, `cost ${cost}`).toBe(1);
      expect(r.basis.fundingGapRange).toEqual([0, 0]);
    }
  });

  it('keeps the real cost in the basis, so it can never read as "this school is cheap"', () => {
    const r = F({ contributionState: CONTRIBUTION_STATE.NOT_A_CONSTRAINT }, priv(62688));
    expect(r.basis.applicableCostRange).toEqual([62688, 62688]);
    expect(r.basis.costNotAConstraint).toBe(true);
    expect(r.basis.familyContributionRange).toBeNull();
    expect(r.basis.statedMaximumUsd).toBeNull();
  });

  it('assumes no award of any kind', () => {
    const r = F({ contributionState: CONTRIBUTION_STATE.NOT_A_CONSTRAINT }, priv(62688));
    expect(r.basis.athleticAwardAssumed).toBe(0);
    expect(r.basis.meritAidAssumed).toBe(0);
  });
});

describe('monotonicity — promoted from the A7.9.1 diagnostic', () => {
  /** Spans the anchor ($19,454) deliberately: the low end is where it floors. */
  const LADDER = [0, 1000, 5000, 8000, 10000, 15000, 19453, 19454, 19455, 20000,
    25000, 30000, 35000, 40000, 50000, 60000, 80000, 120000];
  const COLLEGES = [
    ['private, cheap', priv(6128)],
    ['private, mid', priv(30308)],
    ['private, dear', priv(62688)],
    ['public non-resident, small premium', pub(30434, 19504)],
    ['public non-resident, large premium', pub(13138, 43210)],
  ];

  it.each(COLLEGES)('a rising maximum never lowers Financial: %s', (_label, college) => {
    let prev = -Infinity;
    for (const max of LADDER) {
      const v = F(stated(max), college).value;
      expect(v, `at ${max}`).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it.each(COLLEGES)('NOT_A_CONSTRAINT is never below a finite maximum: %s', (_label, college) => {
    const open = F({ contributionState: CONTRIBUTION_STATE.NOT_A_CONSTRAINT }, college).value;
    for (const max of LADDER) {
      expect(open + 1e-12, `at ${max}`).toBeGreaterThanOrEqual(F(stated(max), college).value);
    }
  });

  it('is continuous across CONTRIBUTION_ANCHOR, which only floors the denominator', () => {
    const college = priv(62688);
    const at = (m) => F(stated(m), college).value;
    const below = at(CONTRIBUTION_ANCHOR - 1);
    const on = at(CONTRIBUTION_ANCHOR);
    const above = at(CONTRIBUTION_ANCHOR + 1);
    expect(on).toBeGreaterThanOrEqual(below);
    expect(above).toBeGreaterThanOrEqual(on);
    // No step: the two formulae agree AT the anchor, so the seam is invisible.
    expect(Math.abs(above - below)).toBeLessThan(1e-3);
  });

  it('floors the denominator below the anchor and tracks the family above it', () => {
    const college = priv(62688);
    expect(F(stated(5000), college).basis.contributionAnchor).toBe(CONTRIBUTION_ANCHOR);
    expect(F(stated(5000), college).basis.anchorIsFloor).toBe(true);
    expect(F(stated(50000), college).basis.contributionAnchor).toBe(50000);
    expect(F(stated(50000), college).basis.anchorIsFloor).toBe(false);
  });

  it('gives a stated maximum of zero a gap of the whole cost, not a refusal', () => {
    const r = F(stated(0), priv(30000));
    expect(r.ok).toBe(true);
    expect(r.basis.fundingGapRange).toEqual([30000, 30000]);
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThan(0.5);
  });

  it('gives a maximum exactly equal to the cost a gap of zero', () => {
    const r = F(stated(30308), priv(30308));
    expect(r.basis.fundingGapRange).toEqual([0, 0]);
    expect(r.value).toBe(1);
  });

  it('gives an exact maximum one value, not a range', () => {
    const r = F(stated(45000), pub(30434, 19504));
    expect(r.basis.viabilityRange[0]).toBe(r.basis.viabilityRange[1]);
    expect(r.value).toBe(r.basis.viabilityRange[0]);
  });
});

describe('the intake vocabulary', () => {
  /**
   * A7.9.3 retired the picker entirely, so there is no "offered bands" list to
   * assert against any more - only the read path, which must keep working.
   */
  it('offers no bands at all: the vocabulary is read-only', async () => {
    const rules = await import('../financialRules.js');
    expect(rules.INTAKE_BUDGET_BANDS).toBeUndefined();
  });

  it('still PARSES the open band, because old records hold it', () => {
    expect(budgetInterval('$40k+/yr').interval).toEqual([40000, Infinity]);
  });

  it('records why the field exists: the open band scored as exactly its floor', () => {
    /**
     * The A7.9.1 finding, pinned. `$40k+` credited the family with $40,000 and
     * nothing more, so it was arithmetically a stated maximum of $40,000 -
     * which is what made the "+" worthless and this field necessary.
     */
    const college = pub(32875, 21146);
    expect(F({ budgetRange: '$40k+/yr' }, college).value).toBeCloseTo(F(stated(40000), college).value, 12);
  });
});
