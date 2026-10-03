import { describe, it, expect } from 'vitest';
import { positionalOpportunity } from './positionalOpportunity.js';
import { isScoreable, GRADE, REASON } from '../types.js';

/**
 * A7.7.2. The invariant this file exists to hold:
 *
 *   a count of zero vacated starters may only be SCORED when the players who
 *   are actually leaving could be placed as starters or squad.
 *
 * Before this, 307 men's and 341 women's programme-position cells returned
 * value 0 with grade MEASURED on a departing cohort nobody could classify -
 * an absence presented as a measurement, which is the one thing the V2
 * contract forbids.
 */
const base = {
  rosterOnFile: true, eligibilityRuled: true, positionRows: 10, unreadable: 0,
  openings: 3, eligibleToRemain: 4, vacatedStarters: 0,
  arrivals: 0, arrivalsApplicable: false, arrivalsHorizon: 2026,
  fill: { rate: 0.8, hits: 400, trials: 500, level: 'division' },
  starterEvidence: { positionRows: 10, classified: 10, unknown: 0, departing: 3, departingUnknown: 0 },
};
const run = (over = {}) => positionalOpportunity({
  sport: 'mens-soccer', position: 'MIDFIELD',
  evidence: { ...base, ...over, starterEvidence: { ...base.starterEvidence, ...(over.starterEvidence ?? {}) } },
});

describe('a zero must rest on something', () => {
  it('scores a measured zero when the whole departing cohort is placed', () => {
    const r = run();
    expect(isScoreable(r)).toBe(true);
    expect(r.value).toBe(0);
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('refuses when nobody in the departing cohort could be placed', () => {
    const r = run({ starterEvidence: { departing: 3, departingUnknown: 3 } });
    expect(isScoreable(r)).toBe(false);
    expect(r.reason).toBe(REASON.NO_MINUTES_HISTORY);
    expect(r.missing).toContain('starterEvidence');
    // It must not carry a value of any kind.
    expect(r.value).toBeUndefined();
  });

  it('scores but downgrades to PARTIAL when the cohort is only partly placed', () => {
    const r = run({ starterEvidence: { departing: 4, departingUnknown: 2 } });
    expect(isScoreable(r)).toBe(true);
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.basis.starterEvidence).toMatchObject({ departing: 4, departingUnknown: 2, departingKnown: 2 });
  });

  it('keeps a true zero when nobody is leaving at all', () => {
    // Nothing to classify is not the same as nothing classified.
    const r = run({ openings: 0, starterEvidence: { departing: 0, departingUnknown: 0 } });
    expect(isScoreable(r)).toBe(true);
    expect(r.value).toBe(0);
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('scores an opening normally when a departing starter is identified', () => {
    const r = run({ vacatedStarters: 2 });
    expect(isScoreable(r)).toBe(true);
    expect(r.value).toBeGreaterThan(0);
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('still refuses before this rule for the older, blunter absences', () => {
    expect(run({ rosterOnFile: false }).reason).toBe(REASON.NO_ROSTER_ON_FILE);
    expect(run({ eligibilityRuled: false }).reason).toBe(REASON.NO_ELIGIBILITY_RULE);
    expect(run({ positionRows: 0 }).reason).toBe(REASON.NO_CLASS_LABELS);
  });

  it('is unaffected by unknowns among players who are NOT leaving', () => {
    // A freshman cannot have prior minutes and never vacates a place. Counting
    // them would refuse cells whose actual evidence is complete.
    const r = run({ starterEvidence: { positionRows: 20, classified: 10, unknown: 10, departing: 3, departingUnknown: 0 } });
    expect(isScoreable(r)).toBe(true);
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe('missing data is not rewarded', () => {
  const measuredLow = run();
  const measuredHigh = run({ vacatedStarters: 3 });
  const unknown = run({ starterEvidence: { departing: 3, departingUnknown: 3 } });

  it('measured low demand still scores, and scores low', () => {
    expect(measuredLow.value).toBe(0);
    expect(measuredHigh.value).toBeGreaterThan(measuredLow.value);
  });

  it('unknown carries no value at all, so it cannot outrank anything', () => {
    // The only defensible relationship: an unknown is not a number, so it is
    // not compared. It leaves the ranked list rather than being placed above
    // or below a measured zero.
    expect(isScoreable(unknown)).toBe(false);
    expect('value' in unknown).toBe(false);
  });

  it('and a measured zero does not outrank an unknown either — they are not on one scale', () => {
    expect(isScoreable(measuredLow)).toBe(true);
    expect(isScoreable(unknown)).toBe(false);
  });
});

describe('a goalkeeper, where one place exists and evidence is thinnest', () => {
  const gk = (over = {}) => positionalOpportunity({
    sport: 'mens-soccer', position: 'GOALKEEPER',
    evidence: {
      ...base, positionRows: 3, openings: 1, eligibleToRemain: 2,
      fill: { rate: 0.46, hits: 139, trials: 303, level: 'division' },
      ...over,
      starterEvidence: { positionRows: 3, classified: 3, unknown: 0, departing: 1, departingUnknown: 0, ...(over.starterEvidence ?? {}) },
    },
  });

  it('refuses rather than scoring zero when the one departing keeper is unplaceable', () => {
    const r = gk({ starterEvidence: { departing: 1, departingUnknown: 1 } });
    expect(isScoreable(r)).toBe(false);
    expect(r.reason).toBe(REASON.NO_MINUTES_HISTORY);
  });

  it('saturates on a single departing starter, because one place is all there is', () => {
    const r = gk({ vacatedStarters: 1 });
    expect(isScoreable(r)).toBe(true);
    expect(r.value).toBeCloseTo(0.46, 2);
  });
});
