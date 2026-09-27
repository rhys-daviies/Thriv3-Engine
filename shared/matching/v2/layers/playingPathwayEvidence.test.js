/**
 * =============================================================================
 * PLAYING PATHWAY EVIDENCE — the A7.36 defects, now asserted as repaired.
 *
 * This file began at A7.36 as `playingPathwayConfound.test.js`, where every
 * test RECORDED a defect and the header said a repair should break it. A7.37
 * repaired them, so each block below now states the invariant in place of the
 * defect, and KEEPS THE MEASUREMENT THAT MOTIVATED IT. The numbers are not
 * decoration: they are why the threshold is where it is, and a future reader
 * changing one needs to know what it was chosen against.
 *
 * WHAT A7.37 DID NOT DO, asserted in the last block so a later phase cannot
 * drift into it: no value moved. There is no shrinkage, no uncertainty
 * multiplier and no year penalty anywhere. `coverage.js` rule 1 - value and
 * coverage are never combined - holds throughout, so every repair below is a
 * REFUSAL or a GRADE, never a smaller number.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import {
  returningCompetition, squadRotation, playingPathway,
  RETURNER_STATE, ZERO_CLAIM_READABLE_SHARE, MEASURED_HORIZON_DEPTH,
} from './opportunityComponents.js';
import { positionalOpportunity } from './positionalOpportunity.js';
import { GRADE, scoreable, unscoreable, REASON, isScoreable } from '../types.js';
import { COMPETITION_SHARE } from '../opportunityRules.js';
import { maxAttainableLastSeason } from '../../../eligibility.js';

/** A caller that knows everything A7.37 added, at a one-year horizon. */
const comp = (returning, over = {}) => returningCompetition({
  returning,
  position: 'MIDFIELD',
  places: 5,
  rosterOnFile: true,
  eligibilityRuled: true,
  positionRows: 8,
  unreadable: 0,
  entryYear: 2027,
  rosterSeason: 2026,
  maxLastSeason: 2030,
  ...over,
});
const R = (starters = 0, squad = 0, unknown = 0) => ({ starters, squad, unknown });
const S = (v, grade = GRADE.MEASURED) => scoreable({ value: v, grade, coverage: 1, basis: {} });
const REFUSED = unscoreable({ reason: REASON.NO_CLASS_LABELS, missing: ['classYears'], available: [] });

describe('1. an empty count is only a measurement when something was read', () => {
  /**
   * WAS: any zero scored 1.000 and was graded MEASURED with coverage 1,
   * whatever emptied it. A7.36 found 64 men's and 74 women's cells scoring a
   * perfect competition value with nobody counted returning AND nobody counted
   * departing - only possible when no row in the group produced a ceiling.
   * Saint Joseph's (ME) at forward carried ten observed players, ten of them
   * unreadable, and scored 1.000 MEASURED.
   */
  it('refuses when the position group has rows and none of them are readable', () => {
    const r = comp(R(0, 0, 0), { positionRows: 10, unreadable: 10 });
    expect(isScoreable(r)).toBe(false);
    expect(r.reason).toBe(REASON.NO_CLASS_LABELS);
    expect(r.coverage).toBe(0);
    expect(r.detail.note).toMatch(/not the same as knowing that nobody does/);
  });

  it('refuses a zero that rests on a readable minority', () => {
    // Six of ten unreadable: the four we read could be outvoted by the six we
    // did not, so the claim about the group is not ours to make.
    const r = comp(R(0, 0, 0), { positionRows: 10, unreadable: 6 });
    expect(isScoreable(r)).toBe(false);
    expect(r.coverage).toBeCloseTo(0.4, 9);
  });

  it('accepts a zero that rests on a readable majority, and marks the doubt', () => {
    const r = comp(R(0, 0, 0), { positionRows: 10, unreadable: 4 });
    expect(isScoreable(r)).toBe(true);
    expect(r.value).toBe(1);
    // Scoreable, and NOT certain: partial readability is doubt, not a verdict.
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.coverage).toBeCloseTo(0.6, 9);
  });

  it('the threshold governs the ZERO claim only - a real count still scores', () => {
    /**
     * The asymmetry, asserted because it is the part most likely to be
     * "simplified" later. Rows we could not read could only ever have made a
     * non-zero count LARGER, so refusing it would discard a real observation
     * for being incomplete in the athlete's favour.
     */
    const r = comp(R(2, 1, 0), { positionRows: 10, unreadable: 9 });
    expect(isScoreable(r)).toBe(true);
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(ZERO_CLAIM_READABLE_SHARE).toBe(0.5);
  });

  it('now carries the evidence behind the count, which it could not before', () => {
    const r = comp(R(1, 0, 0), { positionRows: 8, unreadable: 3 });
    expect(r.basis.positionRows).toBe(8);
    expect(r.basis.unreadableHorizon).toBe(3);
    expect(r.basis.readableShare).toBeCloseTo(0.625, 9);
    expect(r.basis.states[RETURNER_STATE.UNKNOWN_HORIZON]).toBe(3);
  });

  it('keeps the two doubts separate, and multiplies them', () => {
    // Role doubt and readability doubt are different questions. Conflating
    // them is how an unreadable group became a measured empty one.
    const r = comp(R(2, 0, 2), { positionRows: 8, unreadable: 4 });
    expect(r.basis.roleCoverage).toBeCloseTo(0.5, 9);
    expect(r.basis.readableShare).toBeCloseTo(0.5, 9);
    expect(r.coverage).toBeCloseTo(0.25, 9);
  });
});

describe('2. the two sides of the roster index now apply the same principle', () => {
  /**
   * WAS: `positionalOpportunity` carried the A7.7.2 guard "a zero must rest on
   * something" on the DEPARTING side, and `returningCompetition` read the
   * RETURNING side of the same index with no equivalent. A7.36 named that
   * asymmetry as the root cause. Northwestern at defense - 13 rows, all
   * unreadable - was the clean case: Recruitability said NONE_DETECTED and
   * Opportunity said 0.753 from identical evidence.
   */
  const evidence = {
    rosterOnFile: true, eligibilityRuled: true, positionRows: 8,
    vacatedStarters: 0, openings: 0, eligibleToRemain: 0, unreadable: 8, arrivals: 0,
    fill: { rate: 0.5, hits: 10, trials: 20, level: 'division' },
    starterEvidence: { departing: 8, departingUnknown: 8 },
  };

  it('Recruitability still refuses an unplaceable departing cohort', () => {
    const r = positionalOpportunity({ sport: 'mens-soccer', position: 'MIDFIELD', evidence });
    expect(isScoreable(r)).toBe(false);
  });

  it('and Opportunity now refuses the equivalent returning-side silence', () => {
    const r = comp(R(0, 0, 0), { positionRows: 8, unreadable: 8 });
    expect(isScoreable(r)).toBe(false);
  });
});

describe('3. the horizon is visible, and the rule is derived rather than chosen', () => {
  /**
   * WAS: the count decayed to a constant as the entry year moved out and
   * nothing said so. A7.36 measured, on 3,468 scoreable men's cells, the share
   * at competition 1.000: 2.6% at a 2027 entry, 10.9% at 2028, 60.8% at 2029
   * and 100.0% at 2030 - every one of them graded MEASURED.
   */
  it('the ceiling comes from the eligibility rule itself, not from a constant', () => {
    // Five-season divisions reach a year further than four-season ones, which
    // is the whole of the rule. Nothing here is written down as a number.
    expect(maxAttainableLastSeason({ season: 2026, division: 'NCAA D1' })).toBe(2030);
    expect(maxAttainableLastSeason({ season: 2026, division: 'NCAA D3' })).toBe(2029);
    expect(maxAttainableLastSeason({ season: 2026, division: 'NAIA' })).toBe(2029);
  });

  it('refuses once the entry year reaches what the roster can possibly reach', () => {
    const r = comp(R(0, 0, 0), { entryYear: 2030, maxLastSeason: 2030 });
    expect(isScoreable(r)).toBe(false);
    expect(r.detail.note).toMatch(/forced by the eligibility window/);
  });

  it('does NOT refuse while a returner remains possible', () => {
    const r = comp(R(0, 0, 0), { entryYear: 2029, maxLastSeason: 2030 });
    expect(isScoreable(r)).toBe(true);
  });

  it('a four-season division runs out a year before a five-season one', () => {
    // Same entry year, different divisions, different answers - and that is a
    // fact about eligibility rather than about the programmes.
    expect(isScoreable(comp(R(0, 0, 0), { entryYear: 2029, maxLastSeason: 2029 }))).toBe(false);
    expect(isScoreable(comp(R(0, 0, 0), { entryYear: 2029, maxLastSeason: 2030 }))).toBe(true);
  });

  it('depth degrades the grade and NEVER the value', () => {
    const near = comp(R(2, 0, 0), { entryYear: 2027, rosterSeason: 2026 });
    const far = comp(R(2, 0, 0), { entryYear: 2029, rosterSeason: 2026 });
    expect(near.grade).toBe(GRADE.MEASURED);
    expect(far.grade).toBe(GRADE.PARTIAL);
    // THE POINT: a further entry year is not evidence of a worse opportunity.
    expect(far.value).toBe(near.value);
    expect(MEASURED_HORIZON_DEPTH).toBe(1);
  });

  it('reports the horizon it used, so the decay is inspectable', () => {
    const r = comp(R(1, 0, 0), { entryYear: 2029, rosterSeason: 2026 });
    expect(r.basis.horizonDepth).toBe(3);
    expect(r.basis.withinMeasuredHorizon).toBe(false);
  });

  it('a caller that has not been told the horizon keeps the old behaviour', () => {
    /**
     * `Number(null)` is 0 and 0 is finite, so a bare finiteness guard here read
     * an absent entry year as "year 0" - past every horizon - and refused the
     * entire universe. The file header records the same trap biting twice
     * before; this test exists so it cannot bite a fourth time.
     */
    const r = returningCompetition({
      returning: R(0, 0, 0), position: 'MIDFIELD', places: 5, rosterOnFile: true, eligibilityRuled: true,
    });
    expect(isScoreable(r)).toBe(true);
    expect(r.value).toBe(1);
  });
});

describe('4. a single-half pathway reports the weight it actually has', () => {
  /**
   * WAS: `coverage = competitionShare` for BOTH single-half cases - the weight
   * of the MISSING half. A7.36 found 52 men's and 72 women's cells in that
   * state, every one rotation-only, so the error only ever overstated.
   */
  it('rotation-only reports 0.4, the weight of the half it holds', () => {
    const r = playingPathway({ competition: REFUSED, rotation: S(0.7) });
    expect(r.value).toBe(0.7);
    expect(r.coverage).toBeCloseTo(1 - COMPETITION_SHARE, 9);
  });

  it('competition-only still reports 0.6', () => {
    const r = playingPathway({
      competition: S(0.3),
      rotation: unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['minutesHistory'], available: [] }),
    });
    expect(r.coverage).toBeCloseTo(COMPETITION_SHARE, 9);
  });

  it('is never MEASURED on one half, however certain that half is', () => {
    // A programme's rotation habit is a true thing to know and is not an
    // answer to how crowded the position will be. It may carry the value; it
    // must not carry the certainty.
    const r = playingPathway({ competition: REFUSED, rotation: S(0.7, GRADE.MEASURED) });
    expect(r.grade).toBe(GRADE.PARTIAL);
  });

  it('says it is rotation-only, and why the other half refused', () => {
    const r = playingPathway({ competition: REFUSED, rotation: S(0.7) });
    expect(r.basis.rotationOnly).toBe(true);
    expect(r.basis.competitionRefusedBecause).toBe(REASON.NO_CLASS_LABELS);
  });

  it('both halves present is unchanged: 0.6 / 0.4 and full coverage', () => {
    const r = playingPathway({ competition: S(1), rotation: S(0) });
    expect(r.value).toBeCloseTo(COMPETITION_SHARE, 9);
    expect(r.coverage).toBe(1);
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.basis.rotationOnly).toBe(false);
  });

  it('pathway survives every competition refusal, so no programme leaves the ranking', () => {
    /**
     * THE BLAST-RADIUS INVARIANT. `playingPathway` is a REQUIRED component of
     * Opportunity, so a refusal that reached the pathway itself would drop the
     * programme into LIMITED_DATA. Rotation depends on neither the entry year
     * nor class readability, so it survives every refusal A7.37 introduced.
     */
    for (const entryYear of [2027, 2028, 2029, 2030]) {
      const c = comp(R(0, 0, 0), { entryYear, maxLastSeason: 2029, positionRows: 9, unreadable: 9 });
      expect(isScoreable(playingPathway({ competition: c, rotation: S(0.5) })), String(entryYear)).toBe(true);
    }
  });
});

describe('5. what A7.37 deliberately did NOT change', () => {
  it('more projected competition is still worse, monotonically', () => {
    let prev = Infinity;
    for (const n of [0, 1, 3, 6, 10]) {
      const v = comp(R(n, 0, 0)).value;
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('an unknown-ROLE returner still counts against the athlete, never for them', () => {
    expect(comp(R(0, 0, 3)).value).toBeLessThan(comp(R(0, 0, 0)).value);
    expect(comp(R(0, 0, 3)).grade).toBe(GRADE.PARTIAL);
  });

  it('a genuinely thin group, fully read, is still a REAL opportunity', () => {
    /**
     * The overcorrection this whole phase had to avoid. "Stop rewarding thin
     * rosters" would break recruiting theory: a group we have READ COMPLETELY
     * and found to carry one returner genuinely is a better opportunity than
     * one carrying eight.
     */
    const thin = comp(R(1, 0, 0), { positionRows: 6, unreadable: 0 });
    const crowded = comp(R(5, 3, 0), { positionRows: 12, unreadable: 0 });
    expect(thin.value).toBeGreaterThan(crowded.value);
    expect(thin.grade).toBe(GRADE.MEASURED);
  });

  it('a fully-read empty group still scores the maximum, and is still MEASURED', () => {
    // No inverse bias. Reading a group and finding nobody returning is a
    // finding, and A7.37 must not have turned it into a doubt.
    const r = comp(R(0, 0, 0), { positionRows: 6, unreadable: 0 });
    expect(r.value).toBe(1);
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.coverage).toBe(1);
  });

  it('no value is shrunk by its own coverage anywhere', () => {
    // coverage.js rule 1, asserted at the component. Two cells with the same
    // count and different readability must carry the SAME value.
    const clean = comp(R(2, 0, 0), { positionRows: 8, unreadable: 0 });
    const doubtful = comp(R(2, 0, 0), { positionRows: 8, unreadable: 3 });
    expect(doubtful.value).toBe(clean.value);
    expect(doubtful.coverage).toBeLessThan(clean.coverage);
  });

  it('no programme is excluded for its roster evidence', () => {
    for (const returning of [R(0, 0, 0), R(20, 0, 0), R(0, 0, 20)]) {
      expect(isScoreable(comp(returning))).toBe(true);
      expect(comp(returning).value).toBeGreaterThan(0);
    }
  });

  it('positional need is still outside Playing Pathway, and turnover is still absent', () => {
    const r = comp(R(1, 0, 0));
    const keys = Object.keys(r.basis).join(' ');
    for (const forbidden of ['vacated', 'opening', 'turnover', 'departure', 'arrivals', 'fill']) {
      expect(keys.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it('the 0.6 / 0.4 split and the pressure constants are untouched', () => {
    expect(COMPETITION_SHARE).toBe(0.6);
    // The shape of the map is the A7.8.2 one, unchanged.
    expect(comp(R(0, 0, 0)).value).toBe(1);
    expect(comp(R(3, 0, 0), { places: 4 }).basis.pressure).toBeCloseTo(0.75, 9);
  });

  it('squadRotation was not touched at all', () => {
    const r = squadRotation({
      sport: 'mens-soccer', position: 'MIDFIELD', division: 'NCAA D1', programme: 'nowhere', rosterOnFile: false,
    });
    expect(isScoreable(r)).toBe(false);
    expect(r.reason).toBe(REASON.NO_MINUTES_HISTORY);
  });
});
