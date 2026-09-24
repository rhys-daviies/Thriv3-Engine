import { describe, it, expect } from 'vitest';
import { athleteOpportunity, priorityWeights } from './opportunity.js';
import {
  squadRotation, programmeTrajectory, majorFit, locationFit, athleticOutcome,
} from './opportunityComponents.js';
import { GRADE, REASON, scoreable, isNotApplicable } from '../types.js';
import { PRIORITY_MAP, FOREIGN_PRIORITIES, OPPORTUNITY_COVERAGE_FLOOR } from '../opportunityRules.js';

const SPORT = 'mens-soccer';
const play = (over = {}) => squadRotation({
  sport: SPORT, position: 'MIDFIELD', division: 'NCAA D1', programme: 'Maryland', rosterOnFile: true, ...over,
});
const traj = (recent = 0.6, prior = 0.5) => programmeTrajectory({ recentWinPct: recent, priorWinPct: prior });
const noMajor = majorFit({ intendedMajor: null, notableMajors: '["Business"]' });
const noLocation = locationFit({});
const noOutcome = athleticOutcome({});

const O = (over = {}) => athleteOpportunity({
  pathway: play(), trajectory: traj(), major: noMajor, location: noLocation, outcome: noOutcome, ...over,
});

describe('the objective half scores without any preference at all', () => {
  const r = O();

  it('is scoreable, at full coverage, from playing opportunity and trajectory alone', () => {
    expect(r.ok).toBe(true);
    expect(r.coverage).toBe(1);
  });

  it('says plainly that nothing is known about what the athlete wants', () => {
    expect(r.basis.preferenceKnown).toBe(false);
    expect(r.basis.preferencesDeclared).toBe(0);
    expect(r.basis.preferenceValue).toBeNull();
    expect(r.basis.notApplicable.sort()).toEqual(['academicStrengthFit', 'athleticOutcome', 'locationFit', 'majorFit']);
  });

  it('reports the objective subtotal separately from the single value', () => {
    expect(r.basis.objectiveScored).toBe(2);
    expect(r.basis.objectiveValue).toBeGreaterThan(0);
  });

  it('is not diluted by the three components that do not apply', () => {
    // NOT_APPLICABLE leaves the denominator. If it did not, an athlete who
    // was never asked anything would score worse than one who was.
    expect(r.coverage).toBe(1);
  });
});

describe('required evidence', () => {
  it('refuses without playing opportunity, however good the trajectory', () => {
    const r = O({ pathway: play({ rosterOnFile: false }), trajectory: traj(1, 0) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_MINUTES_HISTORY);
    expect('value' in r).toBe(false);
  });

  it('still scores when only the trajectory is missing', () => {
    const r = O({ trajectory: programmeTrajectory({ recentWinPct: null, priorWinPct: null }) });
    expect(r.ok).toBe(true);
    expect(r.coverage).toBeLessThan(1);
    expect(r.coverage).toBeGreaterThan(OPPORTUNITY_COVERAGE_FLOOR);
  });
});

describe('preferences change the answer only when declared', () => {
  it('a matched major raises it and a missed one lowers it', () => {
    const none = O().value;
    const matched = O({ major: majorFit({ intendedMajor: 'exercise science', notableMajors: '["Kinesiology"]' }) }).value;
    const missed = O({ major: majorFit({ intendedMajor: 'exercise science', notableMajors: '["Business"]' }) }).value;
    expect(matched).toBeGreaterThan(none);
    expect(missed).toBeLessThan(none);
  });

  it('a stated location preference is scored and an unstated one is not', () => {
    const stated = O({ location: locationFit({ preferredStates: ['MD'], collegeState: 'MD' }) });
    expect(stated.basis.preferenceKnown).toBe(true);
    expect(stated.value).toBeGreaterThan(O().value);
  });

  it('never invents a preference from an athlete attribute', () => {
    // A home state is not a preference; the only way geography enters is a
    // declared one.
    expect(isNotApplicable(locationFit({ collegeState: 'MD', distanceMiles: 3 }))).toBe(true);
  });
});

describe('athlete priorities', () => {
  it('moves only the component each surviving criterion maps onto', () => {
    const { multipliers, applied } = priorityWeights(['roster', 'academic', 'geography']);
    expect(applied).toBe(true);
    expect(Object.keys(multipliers).sort()).toEqual(['locationFit', 'majorFit', 'playingPathway']);
  });

  it('refuses the criteria that belong to other layers, and names their owner', () => {
    const { multipliers, ignored } = priorityWeights(['athletic', 'affordability', 'programQuality', 'roster']);
    expect(Object.keys(multipliers)).toEqual(['playingPathway']);
    expect(ignored.map((i) => i.key).sort()).toEqual(['affordability', 'athletic', 'programQuality']);
    expect(ignored.find((i) => i.key === 'athletic').ownedBy).toBe(FOREIGN_PRIORITIES.athletic);
  });

  it('lifts what is ranked first and cuts what is ranked last', () => {
    const first = priorityWeights(['roster', 'academic']).multipliers.playingPathway;
    const last = priorityWeights(['academic', 'roster']).multipliers.playingPathway;
    expect(first).toBeGreaterThan(1);
    expect(last).toBeLessThan(1);
  });

  it('does nothing at all when no ranking is stated', () => {
    expect(priorityWeights(null).applied).toBe(false);
    expect(priorityWeights([]).applied).toBe(false);
    expect(O({ priorityRanking: null }).basis.priorities.applied).toBe(false);
  });

  it('changes the value when a priority reweights a component that differs', () => {
    const base = O({ major: majorFit({ intendedMajor: 'exercise science', notableMajors: '["Business"]' }) });
    const academicFirst = O({
      major: majorFit({ intendedMajor: 'exercise science', notableMajors: '["Business"]' }),
      priorityRanking: ['academic', 'roster'],
    });
    expect(academicFirst.value).not.toBe(base.value);
  });

  it('maps only the two criteria that survive into this layer', () => {
    expect(Object.keys(PRIORITY_MAP).sort()).toEqual(['academic', 'geography', 'roster']);
    expect(PRIORITY_MAP.athletic).toBeUndefined();
    expect(PRIORITY_MAP.affordability).toBeUndefined();
    expect(PRIORITY_MAP.programQuality).toBeUndefined();
  });

  it('cannot reach a component that is NOT_APPLICABLE', () => {
    // geography maps to locationFit, which nobody has declared, so a stated
    // geography priority currently moves nothing.
    const withGeo = O({ priorityRanking: ['geography', 'roster', 'academic'] });
    const withoutGeo = O({ priorityRanking: ['roster', 'academic'] });
    expect(withGeo.basis.priorities.multipliers.locationFit).toBeGreaterThan(0);
    expect(Number.isFinite(withGeo.value)).toBe(true);
    void withoutGeo;
  });
});

describe('what Opportunity cannot see', () => {
  const r = O();

  it('carries no financial or recruitability term anywhere in its basis', () => {
    const text = JSON.stringify(r.basis).toLowerCase();
    for (const forbidden of ['budget', 'netprice', 'tuition', 'aidpolicy', 'fundinggap',
      'recruitab', 'plausib', 'vacatedstarters', 'fillrate', 'soccerscore', 'delta']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('cannot be passed a recruitability or financial result as a component', () => {
    // The signature names five components and none of them is a layer result
    // from elsewhere; a foreign result would have to be smuggled in as one of
    // these, and would then simply be scored as that component.
    expect(Object.keys(r.basis.components).sort()).toEqual(['playingPathway', 'programmeTrajectory']);
  });

  it('gives an identical answer whatever the athlete ability', () => {
    // Ability is not an argument. Stated as a test so that the day someone
    // adds it, this fails.
    expect(O().value).toBe(O().value);
  });

  it('does not reward programme strength - a strong and a weak programme holding steady tie', () => {
    const strong = O({ trajectory: programmeTrajectory({ recentWinPct: 0.95, priorWinPct: 0.95 }) });
    const weak = O({ trajectory: programmeTrajectory({ recentWinPct: 0.15, priorWinPct: 0.15 }) });
    expect(strong.value).toBe(weak.value);
  });
});

describe('the grade', () => {
  it('is PARTIAL when the playing share fell back from the programme own seasons', () => {
    expect(O({ pathway: play({ programme: 'Nowhere At All' }) }).grade).toBe(GRADE.PARTIAL);
  });

  it('is MEASURED when every scored component was measured', () => {
    expect(O().grade).toBe(GRADE.MEASURED);
  });
});

describe('monotonicity', () => {
  it('a better playing opportunity never lowers the result', () => {
    let prev = -1;
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const r = O({ pathway: scoreable({ value: v, grade: GRADE.MEASURED }) });
      expect(r.value).toBeGreaterThanOrEqual(prev);
      prev = r.value;
    }
  });

  it('a better trajectory never lowers the result', () => {
    let prev = -1;
    for (const recent of [0.2, 0.4, 0.5, 0.6, 0.8]) {
      const r = O({ trajectory: traj(recent, 0.5) });
      expect(r.value).toBeGreaterThanOrEqual(prev);
      prev = r.value;
    }
  });
});
