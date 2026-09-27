/**
 * =============================================================================
 * A7.36 — THE PLAYING PATHWAY CONFOUND, PINNED.
 *
 * EVERY TEST IN THIS FILE RECORDS A DEFECT. None of them says the current
 * behaviour is right, and a future phase that repairs Playing Pathway SHOULD
 * break this file - that is what it is for. Each test names what it expects a
 * repair to change, so the next reader is not left guessing whether a red test
 * is a regression or a success.
 *
 * The measurements behind them are in docs/validation/A7.36-report.md and were
 * taken on the full universe of both sports before any of this was written.
 *
 * WHAT IS NOT WRONG, ASSERTED ALONGSIDE so a repair does not overcorrect:
 * playing opportunity matters, a genuinely thin position group IS a real
 * opportunity, and a weak programme is not a bad recommendation. The defect is
 * that the component cannot tell those from an absence of evidence.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { returningCompetition, squadRotation, playingPathway } from './opportunityComponents.js';
import { positionalOpportunity } from './positionalOpportunity.js';
import { GRADE, scoreable, unscoreable, REASON, isScoreable } from '../types.js';
import { COMPETITION_SHARE } from '../opportunityRules.js';

const comp = (returning, over = {}) => returningCompetition({
  returning, position: 'MIDFIELD', places: 5, rosterOnFile: true, eligibilityRuled: true, ...over,
});
const R = (starters = 0, squad = 0, unknown = 0) => ({ starters, squad, unknown });
const S = (v, grade = GRADE.MEASURED) => scoreable({ value: v, grade, coverage: 1, basis: {} });

describe('DEFECT 1 — an empty count is graded as a measurement, whatever emptied it', () => {
  /**
   * A position group where NO player's eligibility ceiling could be read
   * produces the same `returning` object as one we read completely and found
   * empty: zeros. `returningCompetition` then scores the maximum, grades it
   * MEASURED and reports coverage 1.
   *
   * Measured on the universe: 64 men's and 74 women's programme-position cells
   * score a perfect competition value with NOBODY counted as returning AND
   * nobody counted as departing - which is only possible if no row in the
   * group yielded a ceiling at all. Saint Joseph's (ME) FORWARD carries ten
   * observed players, ten of them unreadable, and scores 1.000.
   *
   * A REPAIR SHOULD make this case refuse, or grade it as doubt. It must NOT
   * simply penalise it - an unreadable roster is not evidence of crowding
   * either.
   */
  it('scores the maximum on an empty count', () => {
    const r = comp(R(0, 0, 0));
    expect(r.value).toBe(1);
  });

  it('and calls that maximum MEASURED with full coverage', () => {
    const r = comp(R(0, 0, 0));
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.coverage).toBe(1);
  });

  it('cannot distinguish "we read the group and it is empty" from "we read nobody"', () => {
    // Identical inputs are all `returningCompetition` ever sees. The caller
    // knows the difference - `bucket.unreadable` - and does not pass it.
    const readAndEmpty = comp(R(0, 0, 0));
    const readNobody = comp(R(0, 0, 0));
    expect(readAndEmpty.value).toBe(readNobody.value);
    expect(readAndEmpty.grade).toBe(readNobody.grade);
  });

  it('the signature has no way to say how much of the group was unreadable', () => {
    /**
     * The proof that this is a DESIGN gap and not a wiring slip: there is no
     * parameter for it. `coverage` here is about ROLE among counted returners,
     * which is a different doubt entirely.
     */
    const r = comp(R(0, 0, 4));
    expect(r.basis.roleCoverage).toBe(0);
    expect(Object.keys(r.basis)).not.toContain('unreadable');
    expect(Object.keys(r.basis)).not.toContain('positionRows');
  });
});

describe('DEFECT 2 — the same lesson was learned once and applied to only one side', () => {
  /**
   * `positionalOpportunity` carries an explicit guard, added at A7.7.2 after
   * it measured 307 men's and 341 women's cells scoring a confident zero on a
   * departing cohort nobody could classify:
   *
   *   "A ZERO MUST REST ON SOMETHING."
   *
   * It applies to the DEPARTING side. `returningCompetition` reads the
   * RETURNING side of the very same index and has no equivalent. This test
   * exists so the asymmetry is visible in the suite rather than only in a
   * report.
   */
  const evidence = {
    rosterOnFile: true, eligibilityRuled: true, positionRows: 8,
    vacatedStarters: 0, openings: 0, eligibleToRemain: 0, unreadable: 8, arrivals: 0,
    fill: { rate: 0.5, hits: 10, trials: 20, level: 'division' },
    starterEvidence: { departing: 8, departingUnknown: 8 },
  };

  it('Recruitability REFUSES when the departing cohort is entirely unplaceable', () => {
    const r = positionalOpportunity({ sport: 'mens-soccer', position: 'MIDFIELD', evidence });
    expect(isScoreable(r)).toBe(false);
    expect(r.reason).toBe(REASON.NO_MINUTES_HISTORY);
  });

  it('Opportunity SCORES THE MAXIMUM on the equivalent returning-side silence', () => {
    // Same programme, same unreadable group, opposite conclusion.
    expect(comp(R(0, 0, 0)).value).toBe(1);
    expect(comp(R(0, 0, 0)).grade).toBe(GRADE.MEASURED);
  });
});

describe('DEFECT 3 — the count decays to a constant as the entry year moves out', () => {
  /**
   * `returningDepthFor` counts only players whose last eligible season is
   * STRICTLY AFTER the entry year. Against a 2026 roster that leaves, for a
   * 2028 entry, essentially the current first years - and for a 2030 entry,
   * nobody at all.
   *
   * MEASURED ON THE FULL MEN'S UNIVERSE, 3,468 scoreable cells:
   *
   *   entry 2027   2.6% of cells at competition 1.000
   *   entry 2028  10.9%
   *   entry 2029  60.8%
   *   entry 2030 100.0%   - every cell, all graded MEASURED
   *
   * At a four-year horizon the term is a CONSTANT across the whole universe.
   * It cannot order anything, it still takes 0.6 of Playing Pathway, and it
   * reports itself as a measurement while doing so. This is latent today
   * because the athletes on file are 2027 entrants; it is not latent for a
   * Year 10 athlete.
   *
   * A REPAIR SHOULD make the horizon visible in the grade or the coverage.
   */
  it('a position group with nobody left eligible scores the same as a genuinely empty one', () => {
    const farHorizon = comp(R(0, 0, 0));
    const genuinelyEmpty = comp(R(0, 0, 0));
    expect(farHorizon.value).toBe(genuinelyEmpty.value);
  });

  it('nothing in the component knows what the entry year was', () => {
    // The horizon is applied by the CALLER, before the component sees it, so
    // the component cannot grade its own decay. That is where a repair lands.
    const r = comp(R(1, 2, 0));
    expect(Object.keys(r.basis)).not.toContain('entryYear');
    expect(Object.keys(r.basis)).not.toContain('horizon');
  });
});

describe('DEFECT 4 — a rotation-only pathway overstates its own coverage', () => {
  /**
   * When competition refuses, `playingPathway` reports `coverage =
   * competitionShare` (0.6). But the term it actually holds is ROTATION,
   * which is worth 1 - 0.6 = 0.4. The number is the weight of the MISSING
   * half, not of the present one.
   *
   * 52 men's and 72 women's cells are in this state today, and every one of
   * them is a rotation-only cell reporting 0.6. There is no competition-only
   * cell in either universe, so the error is not symmetric in practice: it
   * always overstates.
   */
  it('reports 0.6 when it is holding the 0.4 half', () => {
    const r = playingPathway({
      competition: unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'], available: [] }),
      rotation: S(0.7),
    });
    expect(r.value).toBe(0.7);
    expect(r.coverage).toBe(COMPETITION_SHARE);
    expect(r.coverage).toBeGreaterThan(1 - COMPETITION_SHARE);
  });

  it('is correct for the competition-only case, which is why it went unnoticed', () => {
    const r = playingPathway({
      competition: S(0.3),
      rotation: unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['minutesHistory'], available: [] }),
    });
    expect(r.coverage).toBe(COMPETITION_SHARE);
  });
});

describe('WHAT IS NOT BROKEN, so a repair does not overcorrect', () => {
  it('more projected competition is still worse, monotonically', () => {
    let prev = Infinity;
    for (const n of [0, 1, 3, 6, 10]) {
      const v = comp(R(n, 0, 0)).value;
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('an unknown-ROLE returner still counts against the athlete, never for them', () => {
    // The one doubt the component DOES model, and it models it in the safe
    // direction. A repair must keep this.
    expect(comp(R(0, 0, 3)).value).toBeLessThan(comp(R(0, 0, 0)).value);
    expect(comp(R(0, 0, 3)).grade).toBe(GRADE.PARTIAL);
  });

  it('a genuinely thin group at a weak programme is a REAL opportunity, not an artefact', () => {
    /**
     * Stated as a test because the repair most likely to be reached for -
     * "stop rewarding thin rosters" - would break recruiting theory. A
     * programme we have read completely and found to carry one returner
     * SHOULD score above one carrying eight. The defect is the cases where we
     * have not read it, not this one.
     */
    const thinAndRead = comp(R(1, 0, 0));
    const crowdedAndRead = comp(R(5, 3, 0));
    expect(thinAndRead.value).toBeGreaterThan(crowdedAndRead.value);
    expect(thinAndRead.grade).toBe(GRADE.MEASURED);
  });

  it('an unreadable roster still refuses outright, rather than scoring a guess', () => {
    const r = returningCompetition({ returning: null, position: 'MIDFIELD', places: 5, rosterOnFile: false });
    expect(isScoreable(r)).toBe(false);
    expect(r.reason).toBe(REASON.NO_ROSTER_ON_FILE);
  });

  it('and no programme is ever excluded for its roster evidence', () => {
    // No hard exclusion, per the recruiting principles A7.36 must protect.
    for (const returning of [R(0, 0, 0), R(20, 0, 0), R(0, 0, 20)]) {
      expect(isScoreable(comp(returning))).toBe(true);
      expect(comp(returning).value).toBeGreaterThan(0);
    }
  });
});
