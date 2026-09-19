import { describe, it, expect } from 'vitest';
import { positionalOpportunity } from './positionalOpportunity.js';
import { GRADE, REASON } from '../types.js';
import { typicalStarters, fillPropensity, typicalStartersEvidence } from '../recruitingRules.js';

const SPORT = 'mens-soccer';
const fill = (position, division = 'NCAA D1') => fillPropensity({ sport: SPORT, division, position, programme: 'Nowhere' });

const ev = (over = {}) => ({
  rosterOnFile: true, eligibilityRuled: true, positionRows: 10,
  vacatedStarters: 2, openings: 3, eligibleToRemain: 6, unreadable: 0,
  arrivals: 0, arrivalsApplicable: true, ...over,
});

const O = (over = {}, position = 'MIDFIELD') => positionalOpportunity({
  sport: SPORT, position, evidence: { ...ev(over), fill: over.fill ?? fill(position) },
});

describe('the measured normaliser, goalkeepers included', () => {
  it('uses one starting place at goalkeeper and more everywhere else', () => {
    expect(typicalStarters(SPORT, 'GOALKEEPER')).toBe(1);
    expect(typicalStarters(SPORT, 'DEFENSE')).toBe(4);
    expect(typicalStarters(SPORT, 'MIDFIELD')).toBe(5);
    expect(typicalStarters(SPORT, 'FORWARD')).toBe(3);
  });

  it('holds goalkeeper to the measurement, not the convention', () => {
    // It is the best-determined of the four: zero interquartile spread, and
    // the great majority of programme-seasons landing exactly on it.
    const gk = typicalStartersEvidence(SPORT, 'GOALKEEPER');
    expect(gk.p25).toBe(1);
    expect(gk.p75).toBe(1);
    expect(gk.shareAtMedian).toBeGreaterThan(0.8);
    expect(gk.programmeSeasons).toBeGreaterThan(2000);
    // Every other position lands on its own median less than half the time.
    for (const p of ['DEFENSE', 'MIDFIELD', 'FORWARD']) {
      expect(typicalStartersEvidence(SPORT, p).shareAtMedian).toBeLessThan(gk.shareAtMedian);
    }
  });

  it('divides exactly once, so one opening means more at goalkeeper', () => {
    const gk = O({ vacatedStarters: 1, fill: fill('GOALKEEPER') }, 'GOALKEEPER');
    const mid = O({ vacatedStarters: 1, fill: fill('MIDFIELD') }, 'MIDFIELD');
    expect(gk.value).toBeGreaterThan(mid.value);
    expect(gk.basis.typicalStarters).toBe(1);
    expect(mid.basis.typicalStarters).toBe(5);
  });

  it('refuses rather than dividing by a number nobody measured', () => {
    const r = positionalOpportunity({ sport: SPORT, position: 'SWEEPER', evidence: ev({ fill: fill('MIDFIELD') }) });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['typicalStarters']);
  });
});

describe('openings are eligibility, not seniority', () => {
  it('scores only vacated STARTING places', () => {
    const starters = O({ vacatedStarters: 3, openings: 3 });
    const squad = O({ vacatedStarters: 0, openings: 3 });
    expect(starters.value).toBeGreaterThan(0);
    expect(squad.value).toBe(0);
  });

  it('treats a measured zero as a finding, not as missing', () => {
    const r = O({ vacatedStarters: 0 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(0);
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('never assumes an eligible player returns, nor that they leave', () => {
    // Returning depth moves nothing: it is carried as context and scored by
    // nothing, because the fill rate already prices internal competition.
    const empty = O({ eligibleToRemain: 0 });
    const crowded = O({ eligibleToRemain: 20 });
    expect(empty.value).toBe(crowded.value);
    expect(crowded.basis.contextOnly.eligibleToRemain).toBe(20);
  });

  it('never lets position-group size move the score', () => {
    expect(O({ positionRows: 8 }).value).toBe(O({ positionRows: 30 }).value);
  });

  it('separates a confirmed opening from returning competition in the basis', () => {
    const r = O({ vacatedStarters: 2, eligibleToRemain: 7 });
    expect(r.basis.vacatedStarters).toBe(2);
    expect(r.basis.contextOnly.eligibleToRemain).toBe(7);
  });
});

describe('the fill rate', () => {
  it('prices a vacated goalkeeping place below a vacated midfield place', () => {
    expect(fill('GOALKEEPER').rate).toBeLessThan(0.6);
    expect(fill('MIDFIELD').rate).toBeGreaterThan(0.8);
  });

  it('carries its numerator, denominator and level', () => {
    const r = O({ vacatedStarters: 2 });
    expect(r.basis.fillTrials).toBeGreaterThan(30);
    expect(r.basis.fillHits).toBeGreaterThan(0);
    expect(r.basis.fillLevel).toBe('division');
    expect(r.basis.fillRate).toBeCloseTo(r.basis.fillHits / r.basis.fillTrials, 3);
  });

  it('never prefers a programme rate that the evidence cannot support', () => {
    // Three season transitions exist, so a programme-position has at most
    // three observations and no programme reaches the floor. Anything
    // claiming to be programme-level today would be reading noise.
    const r = fillPropensity({ sport: SPORT, division: 'NCAA D1', position: 'MIDFIELD', programme: 'Maryland' });
    expect(r.level).not.toBe('programme');
  });

  it('falls back from division to sport when the division is thin', () => {
    const thin = fillPropensity({ sport: SPORT, division: 'NJCAA', position: 'MIDFIELD', programme: 'X' });
    expect(thin.level).toBe('sport');
    expect(thin.trials).toBeGreaterThan(1000);
  });
});

describe('current arrivals', () => {
  it('reduce opportunity', () => {
    expect(O({ arrivals: 0 }).value).toBeGreaterThan(O({ arrivals: 2 }).value);
  });

  it('cannot drive it to zero however many there are', () => {
    const many = O({ vacatedStarters: 3, arrivals: 40 });
    expect(many.value).toBeGreaterThan(0);
    expect(many.basis.claimsCapped).toBe(true);
  });

  it('are NOT_APPLICABLE beyond the horizon, and that is not a downgrade', () => {
    // Nobody has recruited a class two years out, so there is nothing we
    // failed to observe.
    const beyond = O({ arrivals: 0, arrivalsApplicable: false, arrivalsHorizon: 2026 });
    expect(beyond.grade).toBe(GRADE.MEASURED);
    expect(beyond.basis.arrivalsApplicable).toBe(false);
  });

  it('are PARTIAL when they apply and we hold none for the programme', () => {
    expect(O({ arrivals: null, arrivalsApplicable: true }).grade).toBe(GRADE.PARTIAL);
  });
});

describe('what it refuses, and what it never returns instead', () => {
  it('no roster on file', () => {
    const r = O({ rosterOnFile: false });
    expect(r.reason).toBe(REASON.NO_ROSTER_ON_FILE);
    expect('value' in r).toBe(false);
  });

  it('no eligibility rule - the junior-college case', () => {
    const r = O({ eligibilityRuled: false });
    expect(r.reason).toBe(REASON.NO_ELIGIBILITY_RULE);
    expect(r.available).toEqual(['roster']);
  });

  it('a roster that holds nobody at the position', () => {
    expect(O({ positionRows: 0 }).reason).toBe(REASON.NO_CLASS_LABELS);
  });

  it('never a neutral 0.5 for any of them', () => {
    for (const over of [{ rosterOnFile: false }, { eligibilityRuled: false }, { positionRows: 0 }]) {
      expect(O(over).ok).toBe(false);
    }
  });
});

describe('monotonicity', () => {
  it('more vacated places never lowers opportunity', () => {
    let prev = -1;
    for (const vacatedStarters of [0, 1, 2, 3, 4, 5]) {
      const v = O({ vacatedStarters }).value;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('more arrivals never raises it', () => {
    let prev = Infinity;
    for (const arrivals of [0, 1, 2, 4, 8]) {
      const v = O({ vacatedStarters: 4, arrivals }).value;
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('stays within 0 and 1 under a full turnover', () => {
    const r = O({ vacatedStarters: 20, arrivals: 0 });
    expect(r.value).toBe(1);
  });
});
