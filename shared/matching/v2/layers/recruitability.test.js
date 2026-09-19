import { describe, it, expect } from 'vitest';
import { coachRecruitability } from './recruitability.js';
import { athleticPlausibility } from './athleticPlausibility.js';
import { positionalOpportunity } from './positionalOpportunity.js';
import { internationalPropensity } from './recruitingBehaviour.js';
import { GRADE, REASON, scoreable, unscoreable, notApplicable } from '../types.js';
import { fillPropensity, CORE_FLOOR } from '../recruitingRules.js';

const SPORT = 'mens-soccer';
const A = (rating, soccerScore) => athleticPlausibility({ rating, soccerScore, sport: SPORT });
const O = (over = {}) => positionalOpportunity({
  sport: SPORT, position: 'MIDFIELD',
  evidence: {
    rosterOnFile: true, eligibilityRuled: true, positionRows: 10,
    vacatedStarters: 2, openings: 3, eligibleToRemain: 6, unreadable: 0,
    arrivals: 0, arrivalsApplicable: false,
    fill: fillPropensity({ sport: SPORT, division: 'NCAA D1', position: 'MIDFIELD', programme: 'X' }),
    ...over,
  },
});
const DOMESTIC = internationalPropensity({ isInternational: false });
const R = (athletic, positional = O(), international = DOMESTIC) =>
  coachRecruitability({ athletic, positional, international });

describe('the pathological scenarios', () => {
  const huge = O({ vacatedStarters: 5, arrivals: 0 });

  it('A. a severe reach with a huge opening cannot become recruitable', () => {
    const r = R(A(3, 95), huge);
    expect(r.value).toBeLessThan(0.05);
  });

  it('B. a moderate reach with a huge opening is plausible but not strong', () => {
    const r = R(A(7, 73.4), huge);
    expect(r.value).toBeGreaterThan(0.1);
    expect(r.value).toBeLessThan(0.5);
  });

  it('C. an at-level athlete with no opening keeps the floor and no more', () => {
    const r = R(A(8, 73.38), O({ vacatedStarters: 0 }));
    expect(r.value).toBeCloseTo(A(8, 73.38).value * CORE_FLOOR, 6);
  });

  it('D. a strong athlete at a crowded programme is demoted, not deleted', () => {
    const crowded = R(A(9, 73.4), O({ vacatedStarters: 1, arrivals: 4, arrivalsApplicable: true }));
    const open = R(A(9, 73.4), huge);
    expect(crowded.value).toBeGreaterThan(0);
    expect(crowded.value).toBeLessThan(open.value);
  });

  it('E. a very strong athlete at a weaker programme is the most recruitable case', () => {
    expect(R(A(9, 40), huge).value).toBeGreaterThan(R(A(9, 73.4), huge).value);
  });

  it('F. no roster evidence is UNSCOREABLE however plausible the athlete', () => {
    const r = R(A(9, 73.4), O({ rosterOnFile: false }));
    expect(r.ok).toBe(false);
    expect('value' in r).toBe(false);
    expect(r.detail.athleticPlausibility).toBeGreaterThan(0.5);
    expect(r.detail.note).toMatch(/alone cannot answer/);
  });
});

describe('athletic plausibility is a ceiling, not a term', () => {
  it('a perfect core returns exactly the plausibility', () => {
    const perfect = scoreable({ value: 1, grade: GRADE.MEASURED });
    const r = coachRecruitability({ athletic: A(8, 73.38), positional: perfect, international: DOMESTIC });
    expect(r.value).toBeCloseTo(A(8, 73.38).value, 12);
  });

  it('no core can exceed it', () => {
    for (const core of [0, 0.25, 0.5, 0.75, 1]) {
      const r = coachRecruitability({
        athletic: A(6, 73.4), positional: scoreable({ value: core, grade: GRADE.MEASURED }), international: DOMESTIC,
      });
      expect(r.value).toBeLessThanOrEqual(A(6, 73.4).value + 1e-12);
    }
  });

  it('a near-zero plausibility cannot be rescued by anything', () => {
    const r = coachRecruitability({
      athletic: A(1, 99), positional: scoreable({ value: 1, grade: GRADE.MEASURED }), international: DOMESTIC,
    });
    expect(r.value).toBeLessThan(0.01);
  });

  it('is monotone in both arguments', () => {
    let prev = -1;
    for (const core of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const v = coachRecruitability({
        athletic: A(7, 60), positional: scoreable({ value: core, grade: GRADE.MEASURED }), international: DOMESTIC,
      }).value;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    prev = -1;
    for (const rating of [3, 5, 7, 9]) {
      const v = R(A(rating, 60)).value;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('appears exactly once - the core cannot see the athlete level', () => {
    const r = R(A(8, 73.38));
    expect(r.basis.coreBasis.components.positionalOpportunity).toBeDefined();
    expect(JSON.stringify(r.basis.coreBasis)).not.toContain('delta');
  });
});

describe('required evidence', () => {
  it('refuses without an athlete level', () => {
    const r = R(athleticPlausibility({ rating: null, soccerScore: 70, sport: SPORT }));
    expect(r.reason).toBe(REASON.NO_ATHLETE_LEVEL);
  });

  it('refuses without a programme level', () => {
    const r = R(A(8, null));
    expect(r.reason).toBe(REASON.NO_PROGRAMME_LEVEL);
  });

  it('refuses a junior college with no eligibility rule, despite a fine athlete', () => {
    const r = R(A(5, 40), O({ eligibilityRuled: false }));
    expect(r.ok).toBe(false);
    expect(r.available).toContain('athleticPlausibility');
  });
});

describe('coverage', () => {
  it('lets positional opportunity carry the whole core for a domestic athlete', () => {
    const r = R(A(8, 73.38));
    expect(r.coverage).toBe(1);
    expect(r.basis.internationalApplicable).toBe(false);
  });

  it('reaches full coverage for an international athlete with both signals', () => {
    const intl = internationalPropensity({
      isInternational: true, programmeArrivals: { total: 20, international: 6 }, divisionArrivals: null,
    });
    expect(R(A(8, 73.38), O(), intl).coverage).toBe(1);
  });

  it('refuses an international athlete who has only the international signal', () => {
    // "They sign overseas players" is not an answer to "would they want this
    // one". This is where the 0.60 floor actually binds.
    const intl = internationalPropensity({
      isInternational: true, programmeArrivals: { total: 20, international: 6 }, divisionArrivals: null,
    });
    const r = R(A(8, 73.38), O({ rosterOnFile: false }), intl);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.BELOW_COVERAGE_FLOOR);
    expect(r.coverage).toBeCloseTo(0.3, 10);
  });

  it('downgrades the grade when any part of the evidence is a proxy', () => {
    const partial = scoreable({ value: 0.4, grade: GRADE.PARTIAL });
    expect(coachRecruitability({ athletic: A(8, 73.38), positional: partial, international: DOMESTIC }).grade)
      .toBe(GRADE.PARTIAL);
  });
});

describe('what recruitability cannot see', () => {
  it('takes no athlete budget, academics, geography or major', () => {
    // Stated structurally: the only inputs are three layer results, and none
    // of them carries a financial, academic or geographic field.
    const r = R(A(8, 73.38));
    const text = JSON.stringify(r.basis);
    for (const forbidden of ['budget', 'netPrice', 'gpa', 'sat', 'distance', 'major', 'tuition', 'affordab']) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('gives an identical answer whatever else is true of the athlete', () => {
    const a = R(A(8, 73.38));
    const b = R(A(8, 73.38));
    expect(a.value).toBe(b.value);
  });

  it('carries no programme-quality term beyond the level inside plausibility', () => {
    expect(JSON.stringify(R(A(8, 73.38)).basis)).not.toContain('qualityPercentile');
  });
});

describe('phi', () => {
  it('sets the share of plausibility that survives an empty core', () => {
    const none = unscoreable({ reason: REASON.NO_ROSTER_ON_FILE });
    void none;
    const empty = scoreable({ value: 0, grade: GRADE.MEASURED });
    const r = coachRecruitability({ athletic: A(8, 73.38), positional: empty, international: DOMESTIC, phi: 0.2 });
    expect(r.value).toBeCloseTo(A(8, 73.38).value * 0.2, 12);
  });

  it('is recorded so a report can say what it was', () => {
    expect(R(A(8, 73.38)).basis.phi).toBe(CORE_FLOOR);
  });
});

describe('a NOT_APPLICABLE component costs no coverage', () => {
  it('scores a domestic athlete identically to one where the signal does not exist', () => {
    const withNa = R(A(8, 73.38), O(), notApplicable({ why: 'domestic' }));
    const domestic = R(A(8, 73.38), O(), DOMESTIC);
    expect(withNa.value).toBe(domestic.value);
    expect(withNa.coverage).toBe(1);
  });
});
