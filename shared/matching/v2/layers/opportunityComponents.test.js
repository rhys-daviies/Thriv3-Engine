import { describe, it, expect } from 'vitest';
import {
  playingOpportunity, programmeTrajectory, majorFit, locationFit, athleticOutcome,
} from './opportunityComponents.js';
import { GRADE, REASON, isNotApplicable } from '../types.js';
import { playingScale, TRAJECTORY_SATURATION } from '../opportunityRules.js';

const SPORT = 'mens-soccer';
const P = (over = {}) => playingOpportunity({
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
    expect(r.reason).toBe(REASON.NO_MINUTES_HISTORY);
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

  it('scores a measured zero where the programme does not teach it', () => {
    const r = majorFit({ intendedMajor: 'exercise science', notableMajors: '["Business"]' });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(0);
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
    expect(r.reason).toBe(REASON.NO_STATED_PREFERENCE);
    expect(r.available).toEqual(['intendedMajor']);
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
  it('is NOT_APPLICABLE, because ability is not a statement of ambition', () => {
    const r = athleticOutcome({});
    expect(isNotApplicable(r)).toBe(true);
    expect(r.detail.why).toMatch(/not a preference about ambition/);
  });

  it('refuses rather than inventing a shape if a preference ever appears', () => {
    const r = athleticOutcome({ levelPreference: 'highest possible' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_STATED_PREFERENCE);
    expect(r.detail.note).toMatch(/refusing rather than inventing a shape/);
  });
});
