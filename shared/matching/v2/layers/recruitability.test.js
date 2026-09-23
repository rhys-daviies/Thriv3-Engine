import { describe, it, expect } from 'vitest';
import { coachRecruitability } from './recruitability.js';
import { athleticPlausibility } from './athleticPlausibility.js';
import { positionalOpportunity } from './positionalOpportunity.js';
import { recruitingMarket } from './recruitingMarket.js';
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
/**
 * A domestic athlete near a programme that recruits locally: a plain, scored
 * market arm, so these scenarios exercise R-C with both signals present.
 */
const MARKET = recruitingMarket({
  isInternational: false, distanceKm: 100,
  programme: { arrivals: 40, international: 4, domesticWithGeo: 30, near: 24 },
  division: { arrivals: 400, international: 80, domesticWithGeo: 300, near: 180 },
});
const R = (athletic, positional = O(), market = MARKET) =>
  coachRecruitability({ athletic, positional, market });

/** No usable home for the athlete, so the market arm has no question to answer. */
const NO_MARKET = recruitingMarket({ isInternational: false, distanceKm: null, programme: { arrivals: 40 } });
/** A perfect market arm, for the ceiling proofs. */
const FULL_MARKET = recruitingMarket({
  isInternational: true,
  programme: { arrivals: 40, international: 40, domesticWithGeo: 0, near: 0 },
  division: { arrivals: 400, international: 40, domesticWithGeo: 0, near: 0 },
});

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

  it('C. an at-level athlete with no opening and no market evidence keeps the floor and no more', () => {
    // Both behavioural slices empty, so only phi survives - which is what
    // phi means. With a market arm present it would be higher, correctly.
    const r = R(A(8, 73.38), O({ vacatedStarters: 0 }), NO_MARKET);
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

  it('F. no behavioural evidence at all is UNSCOREABLE however plausible the athlete', () => {
    // A7.7.4: the refusal is now about the EVIDENCE FLOOR, not about the
    // roster alone. Market match can carry a programme whose roster we
    // cannot read - but when neither signal is known, plausibility on its
    // own still answers nothing.
    const r = R(A(9, 73.4), O({ rosterOnFile: false }), NO_MARKET);
    expect(r.ok).toBe(false);
    expect('value' in r).toBe(false);
    expect(r.detail.athleticPlausibility).toBeGreaterThan(0.5);
    expect(r.detail.note).toMatch(/alone cannot answer/);
  });
});

describe('athletic plausibility is a ceiling, not a term', () => {
  it('a perfect core returns exactly the plausibility', () => {
    // Both slices full. The weights sum to 1, so the maximum is exactly A.
    const perfect = scoreable({ value: 1, grade: GRADE.MEASURED });
    const r = coachRecruitability({ athletic: A(8, 73.38), positional: perfect, market: FULL_MARKET });
    expect(r.value).toBeCloseTo(A(8, 73.38).value, 12);
  });

  it('no core can exceed it', () => {
    for (const core of [0, 0.25, 0.5, 0.75, 1]) {
      const r = coachRecruitability({
        athletic: A(6, 73.4), positional: scoreable({ value: core, grade: GRADE.MEASURED }), market: MARKET,
      });
      expect(r.value).toBeLessThanOrEqual(A(6, 73.4).value + 1e-12);
    }
  });

  it('a near-zero plausibility cannot be rescued by anything', () => {
    const r = coachRecruitability({
      athletic: A(1, 99), positional: scoreable({ value: 1, grade: GRADE.MEASURED }), market: MARKET,
    });
    expect(r.value).toBeLessThan(0.01);
  });

  it('is monotone in both arguments', () => {
    let prev = -1;
    for (const core of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const v = coachRecruitability({
        athletic: A(7, 60), positional: scoreable({ value: core, grade: GRADE.MEASURED }), market: MARKET,
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

  it('appears exactly once - no behavioural signal can see the athlete level', () => {
    const r = R(A(8, 73.38));
    expect(r.basis.signals.map((x) => x.key)).toEqual(['positionalOpportunity', 'recruitingMarket']);
    expect(JSON.stringify(r.basis.positional)).not.toContain('delta');
    expect(JSON.stringify(r.basis.market)).not.toContain('delta');
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
    // Still refused when nothing behavioural is known. Junior colleges DO
    // carry arrivals, so in the live pool market match can now score some of
    // them - which is the approved Tier 3 behaviour and does not invent a
    // positional opening.
    const r = R(A(5, 40), O({ eligibilityRuled: false }), NO_MARKET);
    expect(r.ok).toBe(false);
    expect(r.available).toContain('athleticPlausibility');
  });
});

describe('coverage', () => {
  it('lets positional opportunity carry the whole core for a domestic athlete', () => {
    const r = R(A(8, 73.38));
    expect(r.coverage).toBe(1);
    expect(r.basis.marketState).not.toBe('NOT_APPLICABLE');
  });

  it('reaches full coverage for an international athlete with both signals', () => {
    const intl = recruitingMarket({
      isInternational: true,
      programme: { arrivals: 20, international: 6, domesticWithGeo: 0, near: 0 },
      division: { arrivals: 200, international: 40, domesticWithGeo: 0, near: 0 },
    });
    expect(R(A(8, 73.38), O(), intl).coverage).toBe(1);
  });

  it('scores an international athlete on market evidence alone, at reduced coverage', () => {
    // CHANGED AT A7.7.4, deliberately. "They sign overseas players" is not an
    // answer to "is a place opening", and it is no longer asked to be: the
    // market slice fills, the positional slice stays empty, and coverage says
    // so. What it must never do is make positional demand appear known.
    const intl = recruitingMarket({
      isInternational: true,
      programme: { arrivals: 20, international: 6, domesticWithGeo: 0, near: 0 },
      division: { arrivals: 200, international: 40, domesticWithGeo: 0, near: 0 },
    });
    const r = R(A(8, 73.38), O({ rosterOnFile: false }), intl);
    expect(r.ok).toBe(true);
    expect(r.coverage).toBeCloseTo(0.25, 10);
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.basis.positionalState).toBe(REASON.NO_ROSTER_ON_FILE);
    expect(r.basis.positional).toBeNull();
  });

  it('downgrades the grade when any part of the evidence is a proxy', () => {
    const partial = scoreable({ value: 0.4, grade: GRADE.PARTIAL });
    expect(coachRecruitability({ athletic: A(8, 73.38), positional: partial, market: MARKET }).grade)
      .toBe(GRADE.PARTIAL);
  });
});

describe('what recruitability cannot see', () => {
  it('takes no athlete budget, academics, geography or major', () => {
    // Stated structurally: the only inputs are three layer results, and none
    // of them carries a financial, academic or geographic field.
    const r = R(A(8, 73.38));
    const text = JSON.stringify(r.basis);
    // `distance` is no longer on this list: A7.7.4 put the programme's own
    // recruiting footprint inside Coach Recruitability, and the athlete's
    // distance is one side of that comparison. Where the athlete WANTS to be
    // remains Opportunity/Fit's locationFit and is not read here.
    for (const forbidden of ['budget', 'netPrice', 'gpa', 'sat', 'major', 'tuition', 'affordab']) {
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
    const r = coachRecruitability({ athletic: A(8, 73.38), positional: empty, market: NO_MARKET, phi: 0.2 });
    expect(r.value).toBeCloseTo(A(8, 73.38).value * 0.2, 12);
  });

  it('is recorded so a report can say what it was', () => {
    expect(R(A(8, 73.38)).basis.phi).toBe(CORE_FLOOR);
  });
});

describe('coverage reports what was measured, not what applied', () => {
  it('a NOT_APPLICABLE market arm costs its slice, and says so', () => {
    // CHANGED AT A7.7.4. Under the old renormalised core a NOT_APPLICABLE
    // component cost nothing, because the remaining component absorbed its
    // weight - which is exactly the property that let missing evidence be
    // rewarded. Now the slice stays empty and coverage reports 0.75.
    const withNa = R(A(8, 73.38), O(), notApplicable({ why: 'domestic' }));
    expect(withNa.coverage).toBeCloseTo(0.75, 10);
    expect(withNa.basis.marketState).toBe('NOT_APPLICABLE');
  });

  it('and an unknown market arm costs exactly the same, because both are unmeasured', () => {
    const withNa = R(A(8, 73.38), O(), notApplicable({ why: 'domestic' }));
    const unknown = R(A(8, 73.38), O(), NO_MARKET);
    expect(unknown.value).toBeCloseTo(withNa.value, 12);
  });

  it('MISSING DATA IS NOT REWARDED', () => {
    // The hard invariant. Measured-low positional evidence must not lose to
    // the same programme with that evidence simply absent.
    const low = scoreable({ value: 0.05, grade: GRADE.MEASURED });
    const measured = coachRecruitability({ athletic: A(9, 40), positional: low, market: FULL_MARKET });
    const missing = coachRecruitability({
      athletic: A(9, 40), positional: unscoreable({ reason: REASON.NO_MINUTES_HISTORY }), market: FULL_MARKET,
    });
    expect(missing.value).toBeLessThan(measured.value);
  });
});
