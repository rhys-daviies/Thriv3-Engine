import { describe, it, expect } from 'vitest';
import {
  recruitingMarket, shrinkToBaseline, internationalUtilisationCaveat, UTILISATION_CAVEAT,
} from './recruitingMarket.js';
import { isScoreable, isNotApplicable, REASON, GRADE } from '../types.js';
import { MARKET_MIN_ARRIVALS, NEAR_BAND_KM } from '../recruitingRules.js';

const DIV = { arrivals: 1000, international: 200, domesticWithGeo: 700, near: 420 };
const market = (over = {}) => recruitingMarket({
  isInternational: false, distanceKm: 100,
  programme: { arrivals: 40, international: 8, domesticWithGeo: 30, near: 24 },
  division: DIV, ...over,
});

describe('the international arm', () => {
  const intl = (international, arrivals = 40) => recruitingMarket({
    isInternational: true,
    programme: { arrivals, international, domesticWithGeo: 0, near: 0 },
    division: DIV,
  });

  it('scores a sustained international recruiter highly', () => {
    const r = intl(20);
    expect(isScoreable(r)).toBe(true);
    expect(r.value).toBeGreaterThan(0.9);
    expect(r.basis.arm).toBe('INTERNATIONAL');
  });

  it('scores a programme that rarely recruits abroad low', () => {
    expect(intl(0).value).toBeLessThan(intl(20).value);
  });

  it('refuses a programme with too little history rather than guessing', () => {
    const r = intl(4, MARKET_MIN_ARRIVALS - 1);
    expect(isScoreable(r)).toBe(false);
    expect('value' in r).toBe(false);
    expect(r.detail.minArrivals).toBe(MARKET_MIN_ARRIVALS);
  });

  it('refuses when there is no division baseline to shrink toward', () => {
    const r = recruitingMarket({
      isInternational: true,
      programme: { arrivals: 40, international: 8 }, division: null,
    });
    expect(isScoreable(r)).toBe(false);
  });

  it('keeps the raw share beside the shrunk one, so a reader can see both', () => {
    const r = intl(20);
    expect(r.basis.rawShare).toBeCloseTo(0.5, 10);
    expect(r.basis.internationalArrivalShare).toBeLessThan(r.basis.rawShare);
  });
});

describe('the domestic arm', () => {
  const LOCAL = { arrivals: 40, international: 2, domesticWithGeo: 30, near: 27 };
  const NATIONAL = { arrivals: 40, international: 2, domesticWithGeo: 30, near: 3 };

  it('reads a local footprint as evidence FOR a nearby athlete', () => {
    const r = recruitingMarket({ isInternational: false, distanceKm: 100, programme: LOCAL, division: DIV });
    expect(r.value).toBeGreaterThan(0.6);
    expect(r.basis.footprint).toBe('LOCAL');
  });

  it('and as evidence AGAINST a distant one', () => {
    const near = recruitingMarket({ isInternational: false, distanceKm: 100, programme: LOCAL, division: DIV });
    const far = recruitingMarket({ isInternational: false, distanceKm: 1500, programme: LOCAL, division: DIV });
    expect(far.value).toBeLessThan(near.value);
    expect(far.value).toBeCloseTo(1 - near.value, 10);
  });

  it('does not penalise a distant athlete at a programme that recruits nationally', () => {
    // The case section 8 names: far + national must not look like far + local.
    const farLocal = recruitingMarket({ isInternational: false, distanceKm: 1500, programme: LOCAL, division: DIV });
    const farNational = recruitingMarket({ isInternational: false, distanceKm: 1500, programme: NATIONAL, division: DIV });
    expect(farNational.value).toBeGreaterThan(farLocal.value);
    expect(farNational.value).toBeGreaterThan(0.6);
    expect(farNational.basis.footprint).toBe('NATIONAL');
  });

  it('gives a near athlete at a national programme no strong evidence either way', () => {
    const r = recruitingMarket({ isInternational: false, distanceKm: 100, programme: NATIONAL, division: DIV });
    expect(r.value).toBeLessThan(0.4);
  });

  it('is NOT_APPLICABLE when the athlete has no usable home', () => {
    // The programme's footprint is known; it is the athlete's side that is
    // missing, so there is no question rather than an unanswered one.
    const r = market({ distanceKm: null });
    expect(isNotApplicable(r)).toBe(true);
  });

  it('refuses when the programme has no placeable recruit origins', () => {
    const r = market({ programme: { arrivals: 40, international: 8, domesticWithGeo: 0, near: 0 } });
    expect(isScoreable(r)).toBe(false);
    expect(r.reason).toBe(REASON.NO_LOCATION);
  });

  it('uses the configured band', () => {
    expect(market({ distanceKm: NEAR_BAND_KM - 1 }).basis.athleteIsNear).toBe(true);
    expect(market({ distanceKm: NEAR_BAND_KM + 1 }).basis.athleteIsNear).toBe(false);
    expect(market({ distanceKm: 400, nearBandKm: 500 }).basis.athleteIsNear).toBe(true);
  });
});

describe('shrinkage', () => {
  it('pulls a three-observation rate most of the way back to the division', () => {
    expect(shrinkToBaseline(3, 3, 0.2, 10)).toBeLessThan(0.5);
    expect(shrinkToBaseline(3, 3, 0.2, 10)).toBeGreaterThan(0.2);
  });

  it('lets a programme with a long history dominate its division', () => {
    expect(shrinkToBaseline(40, 40, 0.2, 10)).toBeGreaterThan(0.75);
  });

  it('returns the baseline when nothing is observed', () => {
    expect(shrinkToBaseline(0, 0, 0.2, 10)).toBeCloseTo(0.2, 12);
  });

  it('is monotone in the pseudo-count', () => {
    const a = shrinkToBaseline(10, 10, 0.2, 5);
    const b = shrinkToBaseline(10, 10, 0.2, 20);
    expect(b).toBeLessThan(a);
  });
});

describe('the international utilisation caveat', () => {
  const base = { rosterRows: 30, internationalRows: 9, totalMinutes: 20000, internationalMinutes: 2000 };

  it('fires only on the pattern it describes', () => {
    const c = internationalUtilisationCaveat(base);
    expect(c).not.toBeNull();
    expect(c.rosterShare).toBeCloseTo(0.3, 10);
    expect(c.minutesShare).toBeCloseTo(0.1, 10);
  });

  it('is silent when internationals get a fair share of the minutes', () => {
    expect(internationalUtilisationCaveat({ ...base, internationalMinutes: 6000 })).toBeNull();
  });

  it('is silent when the international presence is small', () => {
    expect(internationalUtilisationCaveat({ ...base, internationalRows: 2 })).toBeNull();
  });

  it('is silent on a squad too small to say anything about', () => {
    expect(internationalUtilisationCaveat({ ...base, rosterRows: UTILISATION_CAVEAT.minRosterRows - 1 })).toBeNull();
  });

  it('is silent when there are no minutes to compare', () => {
    expect(internationalUtilisationCaveat({ ...base, totalMinutes: 0 })).toBeNull();
  });

  it('returns a description and never a score', () => {
    const c = internationalUtilisationCaveat(base);
    expect('value' in c).toBe(false);
    expect('penalty' in c).toBe(false);
  });
});

describe('the market arm never claims positional demand', () => {
  it('carries no opening, vacancy or position field of any kind', () => {
    const text = JSON.stringify(market().basis).toLowerCase();
    for (const forbidden of ['vacated', 'opening', 'starter', 'position', 'typicalstarters']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('is graded MEASURED only from the programme\'s own history', () => {
    expect(market().grade).toBe(GRADE.MEASURED);
  });
});
