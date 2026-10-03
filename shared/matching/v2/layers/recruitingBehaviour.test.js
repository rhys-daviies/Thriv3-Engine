import { describe, it, expect } from 'vitest';
import { internationalPropensity, INTERNATIONAL_SATURATION, MIN_ARRIVALS_FOR_PROGRAMME_RATE } from './recruitingBehaviour.js';
import { GRADE, REASON, isNotApplicable } from '../types.js';

const P = (over = {}) => internationalPropensity({
  isInternational: true,
  programmeArrivals: { total: 20, international: 6 },
  divisionArrivals: { total: 4000, international: 1000 },
  ...over,
});

describe('a domestic athlete', () => {
  const r = internationalPropensity({ isInternational: false, programmeArrivals: { total: 20, international: 6 } });

  it('is NOT_APPLICABLE, never zero', () => {
    expect(isNotApplicable(r)).toBe(true);
    expect('value' in r).toBe(false);
  });

  it('is therefore not penalised for not being foreign', () => {
    expect(r.reason).toBe(REASON.NOT_APPLICABLE);
  });
});

describe('an international athlete', () => {
  it('scores the programme share of overseas arrivals, saturating', () => {
    const r = P({ programmeArrivals: { total: 20, international: 6 } });
    expect(r.value).toBeCloseTo(0.3 / INTERNATIONAL_SATURATION, 10);
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('saturates rather than rewarding an ever-higher share', () => {
    expect(P({ programmeArrivals: { total: 20, international: 12 } }).value).toBe(1);
    expect(P({ programmeArrivals: { total: 20, international: 20 } }).value).toBe(1);
  });

  it('scores a programme that has signed nobody from abroad at zero, measured', () => {
    const r = P({ programmeArrivals: { total: 20, international: 0 } });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(0);
  });

  it('is monotone in the share', () => {
    let prev = -1;
    for (const international of [0, 1, 2, 3, 4, 5, 6]) {
      const v = P({ programmeArrivals: { total: 20, international } }).value;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('the hierarchy', () => {
  it('prefers the programme own history once there is enough of it', () => {
    const r = P({ programmeArrivals: { total: MIN_ARRIVALS_FOR_PROGRAMME_RATE, international: 4 } });
    expect(r.basis.level).toBe('programme');
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('falls back to the division below the floor, and grades it a proxy', () => {
    const r = P({ programmeArrivals: { total: MIN_ARRIVALS_FOR_PROGRAMME_RATE - 1, international: 4 } });
    expect(r.basis.level).toBe('division');
    expect(r.grade).toBe(GRADE.PARTIAL);
  });

  it('refuses when neither level has anything', () => {
    const r = P({ programmeArrivals: null, divisionArrivals: null });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['internationalArrivalHistory']);
  });
});

describe('the correlated signals that are deliberately not scored', () => {
  it('does not add international roster share, which correlates at 0.941', () => {
    const withShare = P({ internationalRosterShare: 0.9 });
    const without = P({ internationalRosterShare: null });
    expect(withShare.value).toBe(without.value);
    expect(withShare.basis.contextOnly.internationalRosterShare).toBe(0.9);
  });

  it('does not add same-country history either', () => {
    const withCountry = P({ sameCountryPlayers: 5 });
    expect(withCountry.value).toBe(P({ sameCountryPlayers: 0 }).value);
    expect(withCountry.basis.contextOnly.sameCountryPlayers).toBe(5);
  });
});
