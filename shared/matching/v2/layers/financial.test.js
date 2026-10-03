import { describe, it, expect } from 'vitest';
import {
  financialViability, applicableCost, fundingGap, viabilityFromRelativeGap,
  athleticAidRule, COST_BASIS,
} from './financial.js';
import { GRADE, REASON } from '../types.js';
import { AID_POLICY_STATUS, assertMayClaimNoAthleticAid } from '../aidPolicy.js';
import { CONTRIBUTION_ANCHOR, HALF_VIABILITY_RELATIVE_GAP } from '../financialRules.js';

const SPORT = 'mens-soccer';

/** A private D1 in Ohio at the pool's median-ish net price. */
const college = (over = {}) => ({
  net_price: 25000, control: 2,
  tuition_in_state: 12000, tuition_out_state: 28000,
  state: 'OH', division: 'NCAA D1', conference: 'ACC', ...over,
});

const athlete = (over = {}) => ({ budgetRange: '$20k-$25k/yr', state: 'OH', origin: 'USA', ...over });

const score = (a, c) => financialViability({ athlete: athlete(a), college: college(c), sport: SPORT });

describe('the scenarios the layer has to answer', () => {
  it('A. cost fully inside the family contribution scores 1 with a measured zero gap', () => {
    const r = score({ budgetRange: '$30k-$35k/yr' }, { net_price: 20000 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(1);
    expect(r.basis.fundingGapRange).toEqual([0, 0]);
    /**
     * PARTIAL since A7.9.2, and the value is unchanged. A band is an interval
     * the family picked off a list; Financial needs the single number at its
     * top and was never told it. Only an exact stated maximum - or a stated
     * absence of constraint - is MEASURED evidence about the family.
     */
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.basis.contributionSource).toBe('LEGACY_BAND');

    const exact = score({ contributionState: 'STATED', maxAnnualContributionUsd: 35000 }, { net_price: 20000 });
    expect(exact.value).toBe(1);
    expect(exact.grade).toBe(GRADE.MEASURED);
  });

  it('B. a small gap stays high', () => {
    const r = score({ budgetRange: '$20k-$25k/yr' }, { net_price: 27000 });
    expect(r.value).toBeGreaterThan(0.7);
    expect(r.basis.fundingGapRange).toEqual([2000, 7000]);
  });

  it('C. a moderate gap sits near the middle', () => {
    const r = score({ budgetRange: '$20k-$25k/yr' }, { net_price: 32500 });
    expect(r.value).toBeGreaterThan(0.4);
    expect(r.value).toBeLessThan(0.7);
  });

  it('D. a very large gap is heavily demoted and never deleted', () => {
    const r = score({ budgetRange: '$0-$5k/yr' }, { net_price: 50000 });
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThan(0.2);
  });

  it('E. an undeclared budget is UNSCOREABLE, not a neutral score', () => {
    const r = score({ budgetRange: 'Undeclared' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_FAMILY_CONTRIBUTION);
    expect('value' in r).toBe(false);
    expect(r.coverage).toBe(0.5);
  });

  it('E2. a blank budget is the same refusal', () => {
    expect(score({ budgetRange: null }).reason).toBe(REASON.NO_FAMILY_CONTRIBUTION);
    expect(score({ budgetRange: '' }).reason).toBe(REASON.NO_FAMILY_CONTRIBUTION);
  });

  it('F. no net price is UNSCOREABLE, and is not a cheap school', () => {
    const r = score({}, { net_price: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_COST_BASIS);
    expect(r.coverage).toBe(0.5);
  });

  it('F2. neither input present reports both as missing', () => {
    const r = score({ budgetRange: 'Undeclared' }, { net_price: null });
    expect(r.missing).toEqual(['costBasis', 'familyContribution']);
    expect(r.coverage).toBe(0);
  });

  it('G. a D3 known zero athletic aid is scoreable and states the rule', () => {
    const r = score({}, { division: 'NCAA D3', conference: 'NESCAC' });
    expect(r.ok).toBe(true);
    expect(r.basis.aidPolicy).toBe(AID_POLICY_STATUS.DIVISION_RULE);
    expect(r.basis.aidPolicyKnown).toBe(true);
    expect(r.basis.mayClaimNoAthleticAid).toBe(true);
    expect(r.basis.aidHeadroomFraction).toBe(0);
  });

  it('H. D1 permits aid but no amount is estimated', () => {
    const r = score({}, { division: 'NCAA D1' });
    expect(r.basis.aidPolicy).toBe(AID_POLICY_STATUS.EQUIVALENCY);
    expect(r.basis.aidHeadroomFraction).toBe(0.75);
    expect(r.basis.athleticAwardAssumed).toBe(0);
    expect(r.basis.mayClaimNoAthleticAid).toBe(false);
  });

  it('I. an UNKNOWN aid policy stays unknown everywhere it is recorded', () => {
    const r = score({}, { division: 'USCAA', conference: null });
    expect(r.ok).toBe(true);
    expect(r.basis.aidPolicy).toBe(AID_POLICY_STATUS.UNKNOWN);
    expect(r.basis.aidPolicyKnown).toBe(false);
    expect(r.basis.mayClaimNoAthleticAid).toBe(false);
    expect(r.basis.aidHeadroomFraction).toBeNull();
    expect(r.basis.aidRule).toBeNull();
  });

  it('J. an international athlete is a non-resident at a public, by rule', () => {
    const r = score({ origin: 'International', state: null, budgetRange: '$20k-$25k/yr' }, { control: 1 });
    expect(r.basis.costBasis).toBe(COST_BASIS.NET_PRICE_PUBLIC_OUT_OF_STATE);
    expect(r.basis.applicableCostRange).toEqual([41000, 41000]);
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.basis.internationalCostCaveat).toMatch(/understates the cost/);
  });

  it('J2. an international athlete never gets in-state treatment by a state coincidence', () => {
    const r = score({ origin: 'International', state: 'OH' }, { control: 1, state: 'OH' });
    expect(r.basis.costBasis).toBe(COST_BASIS.NET_PRICE_PUBLIC_OUT_OF_STATE);
    expect(r.basis.applicableCostRange[0]).toBe(41000);
  });

  it('K. a same-state public gets the residency discount', () => {
    const away = score({ state: 'CA' }, { control: 1 });
    const home = score({ state: 'OH' }, { control: 1 });
    expect(home.basis.applicableCostRange).toEqual([25000, 25000]);
    expect(away.basis.applicableCostRange).toEqual([41000, 41000]);
    expect(home.value).toBeGreaterThan(away.value);
  });

  it('L. a same-state private gets no residency discount whatsoever', () => {
    const away = score({ state: 'CA' }, { control: 2 });
    const home = score({ state: 'OH' }, { control: 2 });
    expect(home.basis.applicableCostRange).toEqual(away.basis.applicableCostRange);
    expect(home.value).toBe(away.value);
    expect(home.basis.costBasis).toBe(COST_BASIS.NET_PRICE_PRIVATE);
  });
});

describe('the monotonicity the function must satisfy', () => {
  it('a cheaper school is never less viable, all else equal', () => {
    let prev = -1;
    for (const net_price of [50000, 40000, 30000, 20000, 10000, 0]) {
      const v = score({}, { net_price }).value;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('a higher family contribution is never less viable, all else equal', () => {
    const bands = ['Need Full Scholarship', '$0-$5k/yr', '$5k-$10k/yr', '$10k-$15k/yr',
      '$15k-$20k/yr', '$20k-$25k/yr', '$25k-$30k/yr', '$30k-$35k/yr', '$35k-$40k/yr', '$40k+/yr'];
    let prev = -1;
    for (const budgetRange of bands) {
      const v = score({ budgetRange }, { net_price: 45000 }).value;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('a larger funding gap never raises viability', () => {
    let prev = Infinity;
    for (let gap = 0; gap <= 60000; gap += 2500) {
      const v = viabilityFromRelativeGap(gap / 20000);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('never leaves 0 to 1, and never reaches 0', () => {
    expect(viabilityFromRelativeGap(0)).toBe(1);
    expect(viabilityFromRelativeGap(1e9)).toBeGreaterThan(0);
    expect(viabilityFromRelativeGap(1e9)).toBeLessThan(1e-6);
  });

  it('puts one half exactly where the parameter says it is', () => {
    expect(viabilityFromRelativeGap(HALF_VIABILITY_RELATIVE_GAP)).toBeCloseTo(0.5, 12);
    // Said $20k, school costs $30k: they must find half again.
    const r = score({ budgetRange: '$20k-$25k/yr' }, { net_price: 30000 });
    expect(r.basis.viabilityRange[0]).toBeCloseTo(0.5, 12);
  });
});

describe('what must NOT move the financial score', () => {
  const base = score({});

  it('strong academics alone do not', () => {
    const strong = financialViability({
      athlete: { ...athlete(), gpa: 4.0, sat: 1600, academicImportance: 10 },
      college: { ...college(), academic_rating: 10, sat_avg: 1500, admit_rate: 0.04 },
      sport: SPORT,
    });
    expect(strong.value).toBe(base.value);
    expect(strong.basis.meritAidAssumed).toBe(0);
  });

  it('athletic ability alone does not', () => {
    const elite = financialViability({
      athlete: { ...athlete(), level: 99, football_ability: 10 },
      college: { ...college(), soccer_score: 30 },
      sport: SPORT,
    });
    expect(elite.value).toBe(base.value);
  });

  it('the aid policy does not - all three states give the same number', () => {
    const d3 = score({}, { division: 'NCAA D3', conference: 'NESCAC' });
    const uscaa = score({}, { division: 'USCAA', conference: null });
    const ivy = score({}, { conference: 'Ivy League' });
    const d1 = score({}, { division: 'NCAA D1' });
    expect(new Set([d3.value, uscaa.value, ivy.value, d1.value]).size).toBe(1);
    // ...and they are four different objects, which is the whole point.
    expect(new Set([d3.basis.aidPolicy, uscaa.basis.aidPolicy, ivy.basis.aidPolicy, d1.basis.aidPolicy]).size).toBe(4);
  });

  it('income-bracketed net price does not enter, because income is not collected', () => {
    expect(base.basis.incomeBracketedNetPriceUsed).toBe(false);
  });
});

describe('no aid is ever subtracted twice', () => {
  it('the cost basis is net price after grant aid and nothing further is deducted', () => {
    const r = score({}, { net_price: 25000, control: 2 });
    expect(r.basis.applicableCostRange).toEqual([25000, 25000]);
    expect(r.basis.netPrice).toBe(25000);
    expect(r.basis.meritAidAssumed).toBe(0);
    expect(r.basis.athleticAwardAssumed).toBe(0);
  });

  it('the gap is exactly cost minus contribution, with no hidden term', () => {
    const r = score({ budgetRange: '$15k-$20k/yr' }, { net_price: 30000, control: 2 });
    expect(r.basis.fundingGapRange).toEqual([30000 - 20000, 30000 - 15000]);
  });
});

describe('the interval, kept rather than collapsed', () => {
  it('a banded budget produces a banded gap', () => {
    const r = score({ budgetRange: '$15k-$30k/yr' }, { net_price: 35000, control: 2 });
    expect(r.basis.familyContributionRange).toEqual([15000, 30000]); // legacy band
    expect(r.basis.fundingGapRange).toEqual([5000, 20000]);
  });

  it('marks a legacy band PARTIAL, because it was a coarser question', () => {
    expect(score({ budgetRange: '$15k-$30k/yr' }).grade).toBe(GRADE.PARTIAL);
    expect(score({ budgetRange: '$15k-$30k/yr' }).basis.budgetIsLegacyBand).toBe(true);
    expect(score({ budgetRange: '$20k-$25k/yr' }).basis.budgetIsLegacyBand).toBe(false);
  });

  it('refuses a band from neither vocabulary rather than guessing at it', () => {
    // '$20k-$30k/yr' looks like a band and is not one: the current vocabulary
    // steps in $5k and the legacy one in $15k. Reading it as either would
    // invent a number the family never chose.
    const r = score({ budgetRange: '$20k-$30k/yr' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_FAMILY_CONTRIBUTION);
  });

  it('the brief worked example survives: cost 35k, budget 20-30k, gap 5k-15k', () => {
    const r = score({ budgetRange: '$25k-$30k/yr' }, { net_price: 35000, control: 2 });
    expect(r.basis.familyContributionRange).toEqual([25000, 30000]);
    expect(r.basis.fundingGapRange).toEqual([5000, 10000]);
  });

  it('unknown residency at a public produces a cost interval, not a guess', () => {
    const r = score({ state: null }, { control: 1 });
    expect(r.basis.applicableCostRange).toEqual([25000, 41000]);
    expect(r.basis.costBasis).toBe(COST_BASIS.NET_PRICE_PUBLIC_RESIDENCY_UNKNOWN);
    expect(r.grade).toBe(GRADE.PARTIAL);
  });

  it('carries both ends of the viability interval, not only the midpoint', () => {
    const r = score({ budgetRange: '$20k-$25k/yr' }, { net_price: 32000 });
    const [lo, hi] = r.basis.viabilityRange;
    expect(lo).toBeLessThan(hi);
    expect(r.value).toBeCloseTo((lo + hi) / 2, 12);
  });

  it('a band whose interval collapses gives a collapsed gap', () => {
    const r = score({ budgetRange: 'Need Full Scholarship' }, { net_price: 20000 });
    expect(r.basis.familyContributionRange).toEqual([0, 0]);
    expect(r.basis.fundingGapRange).toEqual([20000, 20000]);
  });

  it('an open-ended top band uses its stated floor and is bounded by the worst case', () => {
    const r = score({ budgetRange: '$40k+/yr' }, { net_price: 50000 });
    expect(r.basis.familyContributionRange[1]).toBe(Infinity);
    expect(r.basis.fundingGapRange).toEqual([0, 10000]);
    expect(Number.isFinite(r.value)).toBe(true);
  });

  it('scores an open-ended band on its worst case, not on a vacuous best case', () => {
    const r = score({ budgetRange: '$40k+/yr' }, { net_price: 59274 });
    expect(r.basis.budgetCeilingUnstated).toBe(true);
    // The best case of an unstated ceiling is always a zero gap, which says
    // nothing about the family. Averaging it in is what saturated V1.
    expect(r.basis.viabilityRange[1]).toBe(1);
    expect(r.value).toBe(r.basis.viabilityRange[0]);
    expect(r.value).toBeLessThan(0.6);
  });

  it('still averages a band that states both ends', () => {
    const r = score({ budgetRange: '$35k-$40k/yr' }, { net_price: 59274 });
    expect(r.basis.budgetCeilingUnstated).toBe(false);
    expect(r.value).toBeCloseTo((r.basis.viabilityRange[0] + r.basis.viabilityRange[1]) / 2, 12);
  });

  it('keeps the open band above the band below it at every cost', () => {
    for (const net_price of [20000, 35000, 40000, 45000, 50000, 59274]) {
      const below = score({ budgetRange: '$35k-$40k/yr' }, { net_price }).value;
      const open = score({ budgetRange: '$40k+/yr' }, { net_price }).value;
      expect(open, `at net price ${net_price}`).toBeGreaterThanOrEqual(below);
    }
  });
});

describe('the contribution anchor', () => {
  it('keeps a zero-contribution family orderable by cost instead of collapsing to zero', () => {
    const cheap = score({ budgetRange: 'Need Full Scholarship' }, { net_price: 8000 });
    const dear = score({ budgetRange: 'Need Full Scholarship' }, { net_price: 45000 });
    expect(cheap.value).toBeGreaterThan(dear.value);
    expect(dear.value).toBeGreaterThan(0);
    expect(cheap.basis.contributionAnchor).toBe(CONTRIBUTION_ANCHOR);
    expect(cheap.basis.anchorIsFloor).toBe(true);
  });

  it('steps aside once the family states more than it', () => {
    const r = score({ budgetRange: '$30k-$35k/yr' }, { net_price: 45000 });
    expect(r.basis.contributionAnchor).toBe(30000);
    expect(r.basis.anchorIsFloor).toBe(false);
  });
});

describe('the cost basis on its own', () => {
  it('floors a negative net price at zero and records that it did', () => {
    const c = applicableCost({ netPrice: -982, control: 1, tuitionIn: 4000, tuitionOut: 9000, athleteState: 'KS', schoolState: 'KS' });
    expect(c.lo).toBe(0);
    expect(c.detail.costFloored).toBe(true);
    expect(c.detail.netPrice).toBe(-982);
  });

  it('adds nothing at a public whose premium is not positive', () => {
    const c = applicableCost({ netPrice: 12000, control: 1, tuitionIn: 9000, tuitionOut: 9000, athleteState: 'CA', schoolState: 'OH' });
    expect(c.basis).toBe(COST_BASIS.NET_PRICE_PUBLIC_NO_PREMIUM);
    expect(c.hi).toBe(12000);
    expect(c.grade).toBe(GRADE.MEASURED);
  });

  it('treats a for-profit private as a private', () => {
    const c = applicableCost({ netPrice: 23000, control: 3, tuitionIn: 10000, tuitionOut: 25000, athleteState: 'CA', schoolState: 'OH' });
    expect(c.basis).toBe(COST_BASIS.NET_PRICE_PRIVATE);
  });

  it('treats an unknown control as a private rather than inventing a discount', () => {
    const c = applicableCost({ netPrice: 23000, control: null, tuitionIn: 10000, tuitionOut: 25000, athleteState: 'OH', schoolState: 'OH' });
    expect(c.basis).toBe(COST_BASIS.NET_PRICE_PRIVATE);
    expect(c.lo).toBe(23000);
  });

  it('refuses without a net price', () => {
    expect(applicableCost({ netPrice: null, control: 1 }).ok).toBe(false);
    expect(applicableCost({ netPrice: 'n/a', control: 1 }).reason).toBe(REASON.NO_COST_BASIS);
  });

  it('matches states case-insensitively', () => {
    const c = applicableCost({ netPrice: 20000, control: 1, tuitionIn: 8000, tuitionOut: 20000, athleteState: 'oh', schoolState: 'OH' });
    expect(c.basis).toBe(COST_BASIS.NET_PRICE_PUBLIC_IN_STATE);
  });
});

describe('the gap arithmetic on its own', () => {
  it('subtracts intervals end to end', () => {
    expect(fundingGap({ cost: { lo: 35000, hi: 35000 }, budget: [20000, 30000] })).toEqual({ lo: 5000, hi: 15000 });
  });

  it('clamps at zero rather than rewarding cheapness without limit', () => {
    expect(fundingGap({ cost: { lo: 5000, hi: 5000 }, budget: [20000, 25000] })).toEqual({ lo: 0, hi: 0 });
  });

  it('composes a cost interval with a budget interval', () => {
    expect(fundingGap({ cost: { lo: 25000, hi: 41000 }, budget: [20000, 25000] })).toEqual({ lo: 0, hi: 21000 });
  });
});

describe('the aid rule resolution', () => {
  it('tests the conference before the division, or the Ivy League reads as equivalency', () => {
    const r = athleticAidRule({ division: 'NCAA D1', sport: SPORT, conference: 'Ivy League' });
    expect(r.status).toBe(AID_POLICY_STATUS.CONFERENCE_RULE);
    expect(assertMayClaimNoAthleticAid(r)).toBe('Ivy League');
  });

  it('refuses to let an unknown policy claim there is no aid', () => {
    const r = athleticAidRule({ division: 'USCAA', sport: SPORT, conference: null });
    expect(() => assertMayClaimNoAthleticAid(r)).toThrow(/Refusing to state/);
  });

  it('records no expected award even where an equivalency exists', () => {
    expect(athleticAidRule({ division: 'NCAA D1', sport: SPORT }).assumedFraction).toBe(0);
    expect(athleticAidRule({ division: 'NJCAA', sport: SPORT }).status).toBe(AID_POLICY_STATUS.EQUIVALENCY);
  });

  it('differs by sport where the published rules differ', () => {
    const m = financialViability({ athlete: athlete(), college: college(), sport: 'mens-soccer' });
    const w = financialViability({ athlete: athlete(), college: college(), sport: 'womens-soccer' });
    expect(m.basis.aidHeadroomFraction).toBe(0.75);
    expect(w.basis.aidHeadroomFraction).toBe(0.9);
    expect(m.value).toBe(w.value);
  });
});

describe('comparability across the categories that must compare', () => {
  it('scores public and private, every division, on the same axis', () => {
    const seen = [];
    for (const division of ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA', 'USCAA']) {
      for (const control of [1, 2]) {
        const r = score({}, { division, control, conference: null });
        expect(r.ok).toBe(true);
        seen.push(r.value);
      }
    }
    // Same inputs, same cost, so the same answer: division and control change
    // the aid CONTEXT and not the arithmetic.
    expect(new Set(seen).size).toBe(1);
  });

  it('scores a domestic and an international athlete on the same axis', () => {
    const stated = { contributionState: 'STATED', maxAnnualContributionUsd: 25000 };
    const dom = score({ ...stated, state: 'CA' }, { control: 1 });
    const intl = score({ ...stated, state: null, origin: 'International' }, { control: 1 });
    expect(dom.value).toBe(intl.value);
    expect(dom.grade).toBe(GRADE.MEASURED);
    // An exact contribution says nothing about the cost side, which is what
    // the international caveat is about. A7.9.2 §17.
    expect(intl.grade).toBe(GRADE.PARTIAL);
    expect(intl.basis.internationalCostCaveat).toBeTruthy();
  });
});
