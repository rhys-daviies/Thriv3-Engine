import { describe, it, expect } from 'vitest';
import {
  returningCompetition, returningPressure, competitionFromPressure, squadRotation, playingPathway,
} from './opportunityComponents.js';
import { GRADE, REASON, scoreable, unscoreable } from '../types.js';
import {
  RETURNING_SQUAD_WEIGHT, RETURNING_UNKNOWN_WEIGHT, COMPETITION_HALF_PRESSURE, COMPETITION_SHARE,
} from '../opportunityRules.js';

const comp = (returning, over = {}) => returningCompetition({
  returning, position: 'MIDFIELD', places: 5, rosterOnFile: true, eligibilityRuled: true, ...over,
});
const R = (starters = 0, squad = 0, unknown = 0) => ({ starters, squad, unknown });

describe('more projected competition is never better', () => {
  it('falls as returners are added, whatever their role', () => {
    let prev = Infinity;
    for (const n of [0, 1, 2, 4, 6, 9, 14]) {
      const v = comp(R(0, n, 0)).value;
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('is strictly decreasing in pressure and never leaves (0,1]', () => {
    let prev = Infinity;
    for (let p = 0; p <= 12; p += 0.1) {
      const v = competitionFromPressure(p);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('never clamps, so two badly congested positions stay orderable', () => {
    // The reason a linear map was not chosen: it reaches zero and stops
    // telling a crowded programme from a hopeless one.
    expect(competitionFromPressure(4)).toBeGreaterThan(competitionFromPressure(6));
    expect(competitionFromPressure(6)).toBeGreaterThan(0);
  });
});

describe('role changes how much a returner presses', () => {
  it('a known starter presses harder than a known squad player', () => {
    expect(comp(R(1, 0, 0)).value).toBeLessThan(comp(R(0, 1, 0)).value);
  });

  it('an unknown-role returner still presses', () => {
    // The Louisville case: four returners, none placeable. That is not an
    // empty position group and must not score as one.
    expect(comp(R(0, 0, 4)).value).toBeLessThan(comp(R(0, 0, 0)).value);
    expect(comp(R(0, 0, 4)).value).toBeLessThan(1);
  });

  it('places an unknown-role returner between a squad player and a starter', () => {
    const starterPress = returningPressure(R(1, 0, 0), { places: 5 });
    const squadPress = returningPressure(R(0, 1, 0), { places: 5 });
    const unknownPress = returningPressure(R(0, 0, 1), { places: 5 });
    expect(unknownPress).toBeGreaterThan(squadPress);
    expect(unknownPress).toBeLessThan(starterPress);
  });

  it('uses the declared constants', () => {
    expect(returningPressure(R(0, 1, 0), { places: 1 })).toBeCloseTo(RETURNING_SQUAD_WEIGHT, 10);
    expect(returningPressure(R(0, 0, 1), { places: 1 })).toBeCloseTo(RETURNING_UNKNOWN_WEIGHT, 10);
    expect(competitionFromPressure(COMPETITION_HALF_PRESSURE)).toBeCloseTo(0.5, 10);
  });
});

describe('the position sets the scale', () => {
  it('reads three returning goalkeepers as far more crowded than three midfielders', () => {
    const gk = returningCompetition({ returning: R(0, 3, 0), position: 'GOALKEEPER', places: 1, rosterOnFile: true });
    const mid = returningCompetition({ returning: R(0, 3, 0), position: 'MIDFIELD', places: 5, rosterOnFile: true });
    expect(gk.value).toBeLessThan(mid.value);
  });

  it('gives the same pressure for the same returners-per-place at any position', () => {
    const gk = returningPressure(R(1, 0, 0), { places: 1 });
    const def = returningPressure(R(4, 0, 0), { places: 4 });
    const fwd = returningPressure(R(3, 0, 0), { places: 3 });
    expect(gk).toBeCloseTo(def, 10);
    expect(def).toBeCloseTo(fwd, 10);
  });
});

describe('a missing roster is not an empty one', () => {
  /**
   * The A7.7.2 failure, in a new place. "Nobody is coming back" and "we could
   * not read this roster" must never be the same number.
   */
  it('refuses when no roster is on file', () => {
    const r = returningCompetition({ returning: null, position: 'MIDFIELD', places: 5, rosterOnFile: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_ROSTER_ON_FILE);
    expect('value' in r).toBe(false);
  });

  it('refuses when no eligibility rule can place anyone', () => {
    const r = comp(R(0, 4, 0), { eligibilityRuled: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_CLASS_LABELS);
  });

  it('scores a readable roster with nobody returning as a measurement', () => {
    // The Clemson case: ten midfielders, none eligible beyond the entry year.
    const r = comp(R(0, 0, 0));
    expect(r.ok).toBe(true);
    expect(r.value).toBe(1);
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.coverage).toBe(1);
  });
});

describe('evidence confidence is about role, not about the count', () => {
  it('is MEASURED when every returner could be placed', () => {
    const r = comp(R(2, 3, 0));
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.coverage).toBe(1);
  });

  it('is PARTIAL when some could not, and says how many', () => {
    const r = comp(R(1, 4, 4));
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.coverage).toBeCloseTo(5 / 9, 10);
    expect(r.basis.returning).toBe(9);
    expect(r.basis.returningUnknownRole).toBe(4);
  });

  it('still scores when NO role is known, on the headcount alone', () => {
    const r = comp(R(0, 0, 4));
    expect(r.ok).toBe(true);
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.coverage).toBe(0);
    expect(r.basis.returning).toBe(4);
  });
});

describe('the two halves stay separate', () => {
  const S = (v, grade = GRADE.MEASURED) => scoreable({ value: v, grade, coverage: 1, basis: {} });

  it('weights projected competition above historical rotation', () => {
    const r = playingPathway({ competition: S(1), rotation: S(0) });
    expect(r.value).toBeCloseTo(COMPETITION_SHARE, 10);
    expect(COMPETITION_SHARE).toBeGreaterThan(0.5);
  });

  /**
   * A7.45B SUPERSEDED THE SYMMETRY. This read "uses whichever half it has when
   * the other refuses", and that was true of both halves until A7.45 measured
   * what the rotation-only case was actually worth: the coverage 0.4 it
   * reported never reached the Opportunity layer, so rotation entered at the
   * pathway's full 0.65 share with the authority of a complete answer.
   *
   * The halves are not interchangeable. Competition answers the pathway's
   * question - who will be here when the athlete arrives - and rotation
   * answers a different one, at r = +0.174 against it.
   */
  it('uses competition alone when rotation refuses, and refuses when competition does', () => {
    const noRoster = unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'], available: [] });
    const noMinutes = unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['minutesHistory'], available: [] });
    expect(playingPathway({ competition: S(0.3), rotation: noMinutes }).value).toBe(0.3);
    const rotationOnly = playingPathway({ competition: noRoster, rotation: S(0.7) });
    expect(rotationOnly.ok).toBe(false);
    // The rotation measurement is kept, it just does not carry a rank.
    expect(rotationOnly.detail.rotation.value).toBe(0.7);
  });

  it('refuses when both halves do, with rotation\'s reason', () => {
    const noRoster = unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'], available: [] });
    const noMinutes = unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['minutesHistory'], available: [] });
    const r = playingPathway({ competition: noRoster, rotation: noMinutes });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_MINUTES_HISTORY);
  });

  it('keeps rotation answering its own question', () => {
    // Rotation reads past seasons and knows nothing about the entry year;
    // competition reads the entry year and nothing about past seasons.
    const rot = squadRotation({
      sport: 'mens-soccer', position: 'MIDFIELD', division: 'NCAA D1',
      programme: 'nothing on file anywhere', rosterOnFile: true,
    });
    expect(rot.ok).toBe(true);
    expect(rot.basis).not.toHaveProperty('returning');
    expect(comp(R(2, 2, 0)).basis).not.toHaveProperty('playingShare');
  });
});
