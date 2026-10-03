import { describe, it, expect } from 'vitest';
import {
  squadRotation, programmeTrajectory, majorFit, locationFit, athleticOutcome,
} from './opportunityComponents.js';
import { GRADE, REASON, isNotApplicable } from '../types.js';
import { playingScale, TRAJECTORY_SATURATION, COMPETITIVE_LEVEL_SPAN } from '../opportunityRules.js';

const SPORT = 'mens-soccer';
const P = (over = {}) => squadRotation({
  sport: SPORT, position: 'MIDFIELD', division: 'NCAA D1', programme: 'Maryland', rosterOnFile: true, ...over,
});

describe('playing opportunity', () => {
  it('places a programme on the range of programmes at the same position', () => {
    const r = P();
    expect(r.ok).toBe(true);
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.value).toBeLessThanOrEqual(1);
    expect(r.basis.scaleP10).toBe(playingScale(SPORT, 'MIDFIELD').p10);
  });

  it('needs a roster, and never returns a neutral score without one', () => {
    const r = P({ rosterOnFile: false });
    expect(r.ok).toBe(false);
    // A7.48 D1: no roster is NO_ROSTER_ON_FILE. NO_MINUTES_HISTORY belongs to
    // positionalOpportunity's departing-cohort refusal, whose sentence it is.
    expect(r.reason).toBe(REASON.NO_ROSTER_ON_FILE);
    expect('value' in r).toBe(false);
  });

  it('prefers a programme own seasons and grades a fallback as a proxy', () => {
    expect(P({ programme: 'Maryland' }).grade).toBe(GRADE.MEASURED);
    const fallback = P({ programme: 'Nowhere At All' });
    expect(fallback.basis.level).not.toBe('programme');
    expect(fallback.grade).toBe(GRADE.PARTIAL);
  });

  it('treats goalkeepers on the same scale, because the measurement already separates them', () => {
    // No goalkeeper rule is written anywhere. The distinctive structure is in
    // the measure: the median goalkeeping share is far below outfield.
    for (const sport of ['mens-soccer', 'womens-soccer']) {
      const gk = playingScale(sport, 'GOALKEEPER');
      for (const p of ['DEFENSE', 'MIDFIELD', 'FORWARD']) {
        expect(gk.median, `${sport} ${p}`).toBeLessThan(playingScale(sport, p).median);
      }
    }
  });

  it('refuses a position it never measured rather than guessing a scale', () => {
    expect(P({ position: 'SWEEPER' }).ok).toBe(false);
  });

  it('is monotone in the underlying share', () => {
    const scale = playingScale(SPORT, 'MIDFIELD');
    expect(scale.p10).toBeLessThan(scale.median);
    expect(scale.median).toBeLessThan(scale.p90);
  });
});

describe('programme trajectory', () => {
  it('scores the CHANGE, not the level', () => {
    // A strong programme standing still and a weak one standing still get the
    // same answer. Scoring the level would be programme strength again.
    expect(programmeTrajectory({ recentWinPct: 0.9, priorWinPct: 0.9 }).value)
      .toBe(programmeTrajectory({ recentWinPct: 0.2, priorWinPct: 0.2 }).value);
  });

  it('puts a steady programme at one half, as a measured midpoint', () => {
    const r = programmeTrajectory({ recentWinPct: 0.5, priorWinPct: 0.5 });
    expect(r.value).toBe(0.5);
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.basis.direction).toBe('steady');
  });

  it('is monotone in the change and saturates at the declared bound', () => {
    let prev = -1;
    for (const change of [-0.5, -0.3, -0.15, 0, 0.15, 0.3, 0.5]) {
      const v = programmeTrajectory({ recentWinPct: 0.5 + change, priorWinPct: 0.5 }).value;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(programmeTrajectory({ recentWinPct: 1, priorWinPct: 1 - TRAJECTORY_SATURATION }).value).toBe(1);
    expect(programmeTrajectory({ recentWinPct: 0, priorWinPct: TRAJECTORY_SATURATION }).value).toBe(0);
  });

  it('refuses without both win rates, rather than assuming steady', () => {
    expect(programmeTrajectory({ recentWinPct: 0.5, priorWinPct: null }).reason).toBe(REASON.NO_WIN_RATES);
    expect(programmeTrajectory({ recentWinPct: null, priorWinPct: null }).ok).toBe(false);
  });
});

describe('major fit', () => {
  it('matches a stated major against the programme own list', () => {
    const r = majorFit({ intendedMajor: 'exercise science', notableMajors: '["Kinesiology","Business"]' });
    expect(r.value).toBe(1);
    expect(r.basis.majorFamily).toBe('Kinesiology');
  });

  /**
   * A8.2. This was "scores a measured zero where the programme does not teach
   * it" - and the title was the defect. `notable_majors` is built from College
   * Scorecard completion shares and names an institution's largest fields of
   * study, so it never established that a programme does not teach something.
   */
  it('refuses where the list exists but does not settle the question', () => {
    const r = majorFit({ intendedMajor: 'exercise science', notableMajors: '["Business"]' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.MAJOR_NOT_IN_PARTIAL_EVIDENCE);
    expect(r.value ?? null).toBe(null);
  });

  it('is NOT_APPLICABLE when nobody asked, when undecided, and when unplaceable', () => {
    for (const intendedMajor of [null, '', 'undecided', 'zzz not a subject zzz']) {
      expect(isNotApplicable(majorFit({ intendedMajor, notableMajors: '["Business"]' })), String(intendedMajor)).toBe(true);
    }
  });

  it('records WHICH of those it was', () => {
    expect(majorFit({ intendedMajor: null, notableMajors: '[]' }).detail.academicIntent).toBe('MISSING');
    expect(majorFit({ intendedMajor: 'undecided', notableMajors: '[]' }).detail.academicIntent).toBe('UNDECIDED');
  });

  it('refuses when the athlete stated one and the programme has no list', () => {
    const r = majorFit({ intendedMajor: 'exercise science', notableMajors: null });
    expect(r.ok).toBe(false);
    /**
     * A7.12.1. Names the PROGRAMME's gap, not the athlete's. The old
     * NO_STATED_PREFERENCE sent whoever read it to ask the athlete for a
     * major they had already given.
     */
    expect(r.reason).toBe(REASON.NO_PROGRAMME_MAJOR_EVIDENCE);
    expect(r.reason).not.toBe(REASON.NO_STATED_PREFERENCE);
    expect(r.available).toEqual(['intendedMajor']);
    expect(r.missing).toEqual(['notableMajors']);
    // Same refusal as before in every other respect - no score, no grade and
    // no coverage moved with the rename.
    expect(r.coverage).toBe(0);
  });

  it('still names the ATHLETE when it is the athlete who said nothing', () => {
    // NOT_APPLICABLE, not a refusal: nobody asked is not a missing input.
    const r = majorFit({ intendedMajor: null, notableMajors: '["Kinesiology"]' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NOT_APPLICABLE);
  });

  it('accepts an array as readily as the stored JSON string', () => {
    expect(majorFit({ intendedMajor: 'exercise science', notableMajors: ['Kinesiology'] }).value).toBe(1);
  });
});

describe('location fit - the departure from V1', () => {
  it('is NOT_APPLICABLE when the athlete stated no location preference', () => {
    expect(isNotApplicable(locationFit({}))).toBe(true);
  });

  it('is NOT_APPLICABLE even though a home address exists, because that is not a preference', () => {
    const r = locationFit({ collegeState: 'OH', distanceMiles: 12 });
    expect(isNotApplicable(r)).toBe(true);
    expect(r.detail.why).toMatch(/home address is not one/);
  });

  it('does not read a missing maximum distance as a maximum of zero', () => {
    // Number(null) is 0 and 0 is finite, which scored every programme a
    // perfect 1 for being within zero miles of nowhere.
    const r = locationFit({ maxDistanceMiles: null, distanceMiles: 5000 });
    expect(isNotApplicable(r)).toBe(true);
  });

  it('scores stated states when they are stated', () => {
    expect(locationFit({ preferredStates: ['OH', 'PA'], collegeState: 'OH' }).value).toBe(1);
    expect(locationFit({ preferredStates: ['OH', 'PA'], collegeState: 'CA' }).value).toBe(0);
  });

  it('scores a stated maximum distance when one is stated', () => {
    expect(locationFit({ maxDistanceMiles: 300, distanceMiles: 100 }).value).toBe(1);
    expect(locationFit({ maxDistanceMiles: 300, distanceMiles: 900 }).value).toBe(0);
  });

  it('refuses when the athlete stated a preference we cannot evaluate', () => {
    expect(locationFit({ preferredStates: ['OH'], collegeState: null }).reason).toBe(REASON.NO_LOCATION);
    expect(locationFit({ maxDistanceMiles: 300, distanceMiles: null }).reason).toBe(REASON.NO_LOCATION);
  });
});

describe('athletic outcome', () => {
  const AO = (priority, programmePercentile, athletePercentile = 0.96) =>
    athleticOutcome({ competitiveLevelPriority: priority, athletePercentile, programmePercentile });

  it('is NOT_APPLICABLE when nobody asked, because ability is not ambition', () => {
    for (const priority of [null, undefined, '', 0, 6, 'a lot']) {
      const r = AO(priority, 0.5);
      expect(isNotApplicable(r), String(priority)).toBe(true);
    }
    expect(AO(null, 0.5).detail.why).toMatch(/not a statement of ambition/);
  });

  it('scores 1 at or above the athlete own level, whatever the priority', () => {
    for (const priority of [1, 3, 5]) {
      expect(AO(priority, 0.96).value, `at level, priority ${priority}`).toBe(1);
      expect(AO(priority, 0.99).value, `above level, priority ${priority}`).toBe(1);
    }
  });

  it('is one-sided - a stronger programme is NEVER worse, which the Gaussian was', () => {
    let prev = -1;
    for (const p of [0.2, 0.4, 0.6, 0.8, 0.96, 0.99, 1.0]) {
      const v = AO(5, p).value;
      expect(v, `at programme percentile ${p}`).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('falls away below the athlete level in proportion to how much they care', () => {
    expect(AO(5, 0.70).value).toBeLessThan(AO(3, 0.70).value);
    expect(AO(3, 0.70).value).toBeLessThan(AO(1, 0.70).value);
  });

  it('is flat at priority 1, because "level is not important" reorders nothing', () => {
    const values = [0.1, 0.3, 0.5, 0.7, 0.9, 0.96].map((p) => AO(1, p).value);
    expect(new Set(values).size).toBe(1);
    expect(values[0]).toBe(1);
  });

  it('saturates a span below the athlete level rather than running negative', () => {
    expect(AO(5, 0.96 - COMPETITIVE_LEVEL_SPAN).value).toBeCloseTo(0, 10);
    expect(AO(5, 0.05).value).toBe(0);
  });

  it('reads the percentile axis and never a division label', () => {
    const b = AO(4, 0.62).basis;
    expect(b).toHaveProperty('programmePercentile');
    expect(b).toHaveProperty('athletePercentile');
    expect(JSON.stringify(b)).not.toMatch(/D1|D2|D3|NAIA|NJCAA/);
  });

  it('refuses when a preference exists but a level does not', () => {
    expect(athleticOutcome({ competitiveLevelPriority: 5, athletePercentile: null, programmePercentile: 0.5 }).reason)
      .toBe(REASON.NO_PROGRAMME_LEVEL);
    expect(athleticOutcome({ competitiveLevelPriority: 5, athletePercentile: 0.9, programmePercentile: null }).ok)
      .toBe(false);
  });

  it('treats a developmental athlete own level as the target, not the top of the pool', () => {
    // A rating-3 athlete sits near the 18th percentile. A D3 programme at their
    // own level fully satisfies maximum ambition; ambition does not reach up.
    expect(athleticOutcome({ competitiveLevelPriority: 5, athletePercentile: 0.18, programmePercentile: 0.18 }).value).toBe(1);
    expect(athleticOutcome({ competitiveLevelPriority: 5, athletePercentile: 0.18, programmePercentile: 0.99 }).value).toBe(1);
  });
});
