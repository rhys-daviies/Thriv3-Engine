/**
 * =============================================================================
 * A7.45B — rotation alone does not carry a Playing Pathway.
 *
 * WHAT A7.45 MEASURED, AND WHY THIS FILE EXISTS. When competition refused, the
 * pathway used to continue from rotation alone at coverage 0.4. That coverage
 * never reached the Opportunity layer - `coverage.combine` derives a layer's
 * coverage from component WEIGHTS - so a rotation-only pathway entered at its
 * full 0.65 share with the authority of a fully evidenced one, and the
 * restraint was entirely cosmetic.
 *
 * THIS IS NOT A JUDGEMENT ON ROTATION. It is a real, split-half-stable
 * measurement of a real programme trait, it is still computed, and it is
 * carried ON the refusal so an explanation can say what is known. It answers
 * "how widely has this programme shared minutes?" and not "how realistic is
 * this athlete's route to minutes when they arrive?", and only the second
 * question may carry a rank.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { playingPathway, squadRotation, returningCompetition } from './opportunityComponents.js';
import { athleteOpportunity } from './opportunity.js';
import { pursuitPriority } from './pursuit.js';
import { GRADE, REASON, scoreable, unscoreable, notApplicable, isScoreable } from '../types.js';
import { COMPETITION_SHARE, VALUE_WEIGHTS } from '../opportunityRules.js';
import { renderReason } from '../explain/render.js';
import { REASON_CODE, LAYER, POLARITY, BAND } from '../explain/vocabulary.js';

const S = (v, grade = GRADE.MEASURED, basis = {}) => scoreable({ value: v, grade, coverage: 1, basis });
const NA = () => notApplicable({ why: 'the athlete has stated nothing' });
const refused = (reason = REASON.NO_READABLE_POSITIONS) =>
  unscoreable({ reason, missing: ['readablePositions'], available: ['roster'], coverage: 0, detail: { position: 'MIDFIELD' } });
/** Rotation as `squadRotation` really returns it, at a given evidence level. */
const rot = (value, level = 'programme') => S(
  value,
  level === 'programme' ? GRADE.MEASURED : GRADE.PARTIAL,
  { level, seasons: 4, playingShare: 0.55, scaleMedian: 0.56 },
);

/* ------------------------------------------------------------------ */
/* 1-4. the four input states                                          */
/* ------------------------------------------------------------------ */

describe('1. competition + rotation: the blend is untouched', () => {
  it('still weights 0.60 / 0.40 and still grades MEASURED', () => {
    const r = playingPathway({ competition: S(0.5), rotation: rot(1) });
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo((COMPETITION_SHARE * 0.5) + ((1 - COMPETITION_SHARE) * 1), 10);
    expect(r.coverage).toBe(1);
    expect(r.grade).toBe(GRADE.MEASURED);
  });

  it('reads the weights from the rules module rather than from a literal', () => {
    expect(COMPETITION_SHARE).toBe(0.6);
    expect(VALUE_WEIGHTS.playingPathway).toBe(0.65);
  });
});

describe('2. competition unavailable, rotation available: THE CHANGE', () => {
  const r = playingPathway({ competition: refused(), rotation: rot(0.8) });

  it('refuses rather than letting rotation stand for the pathway', () => {
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
  });

  it('inherits competition\'s reason, so the refusal names the data to go and fix', () => {
    expect(r.reason).toBe(REASON.NO_READABLE_POSITIONS);
    expect(r.missing).toContain('positionalCompetition');
  });

  it('KEEPS the rotation evidence instead of throwing it away', () => {
    /**
     * A refusal that discarded it would turn "we cannot rank on this" into
     * "we know nothing about this programme", which is false.
     */
    expect(r.available).toContain('squadRotation');
    expect(r.detail.rotation.value).toBe(0.8);
    expect(r.detail.rotation.level).toBe('programme');
    expect(r.detail.rotation.grade).toBe(GRADE.MEASURED);
  });
});

describe('3. competition available, rotation unavailable: DELIBERATELY UNCHANGED', () => {
  /**
   * The asymmetry is the whole point and is recorded here on purpose rather
   * than left to be discovered. Competition answers the pathway's actual
   * question, so losing rotation costs context; losing competition costs the
   * subject. Competition-only therefore remains scoreable, at the weight of
   * the half that survived.
   */
  const r = playingPathway({ competition: S(0.7), rotation: unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['minutesHistory'], available: [] }) });

  it('stays scoreable on competition alone', () => {
    expect(r.ok).toBe(true);
    expect(r.value).toBe(0.7);
  });

  it('reports the weight of the half it actually has, and never MEASURED', () => {
    expect(r.coverage).toBe(COMPETITION_SHARE);
    expect(r.grade).toBe(GRADE.PARTIAL);
  });
});

describe('4. neither available: the A7.37 reason is preserved, not relabelled', () => {
  it('still leads with rotation\'s reason when both halves are gone', () => {
    /**
     * A7.37 chose this deliberately: a caller that never supplied a roster
     * index has told us nothing about the roster, so reporting a roster-shaped
     * reason would be a claim we cannot make. A7.45B is placed AFTER that
     * branch so it cannot overwrite the decision.
     */
    const r = playingPathway({
      competition: refused(),
      rotation: unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['minutesHistory'], available: [] }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_MINUTES_HISTORY);
  });
});

/* ------------------------------------------------------------------ */
/* 5-7. the three evidence levels rotation can be measured at          */
/* ------------------------------------------------------------------ */

describe('5-7. the refusal does not depend on how good the rotation evidence is', () => {
  /**
   * 42% of the affected cells rest on a division or sport average rather than
   * on the programme's own seasons. None of the three levels makes rotation an
   * answer to the competition question, so all three refuse alike - and each
   * keeps its own level on the refusal so a reader can tell them apart.
   */
  it.each([
    ['programme', GRADE.MEASURED],
    ['division', GRADE.PARTIAL],
    ['sport', GRADE.PARTIAL],
  ])('refuses with rotation measured at %s level, and records that level', (level, grade) => {
    const r = playingPathway({ competition: refused(), rotation: rot(0.9, level) });
    expect(r.ok).toBe(false);
    expect(r.detail.rotation.level).toBe(level);
    expect(r.detail.rotation.grade).toBe(grade);
  });

  it('refuses even on the strongest possible rotation evidence', () => {
    const r = playingPathway({ competition: refused(), rotation: rot(1, 'programme') });
    expect(r.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 8-10. the refusals that reach it, from real components              */
/* ------------------------------------------------------------------ */

const competitionFor = (over = {}) => returningCompetition({
  returning: { starters: 1, squad: 2, unknown: 0, total: 3, roleKnown: 3 },
  position: 'MIDFIELD', places: 5, rosterOnFile: true, programmeRosterOnFile: true,
  eligibilityRuled: true, positionRows: 8, unreadable: 0,
  positionUnreadable: 0, positionMissing: 0, programmeRows: 30,
  entryYear: 2027, rosterSeason: 2026, maxLastSeason: 2030, ...over,
});

describe('8. an A7.44 unreadable-position refusal ends the pathway', () => {
  it('propagates NO_READABLE_POSITIONS all the way through', () => {
    const c = competitionFor({ positionRows: 2, positionUnreadable: 9 });
    expect(c.reason).toBe(REASON.NO_READABLE_POSITIONS);
    const r = playingPathway({ competition: c, rotation: rot(0.9) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_READABLE_POSITIONS);
  });
});

describe('9. an A7.37 unreadable-horizon refusal ends the pathway', () => {
  it('propagates NO_CLASS_LABELS, which A7.44 did not cause', () => {
    const c = competitionFor({ positionRows: 6, unreadable: 6 });
    expect(c.ok).toBe(false);
    expect(c.reason).toBe(REASON.NO_CLASS_LABELS);
    const r = playingPathway({ competition: c, rotation: rot(0.9) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_CLASS_LABELS);
  });
});

describe('10. a genuine measured competition zero still scores', () => {
  it('is not swept up by the refusal: nothing was unreadable', () => {
    /**
     * The load-bearing separation. A programme whose position group reads
     * completely and holds no returners is a MEASUREMENT, and it must keep its
     * score - A7.45B refuses silence, never evidence.
     */
    const c = competitionFor({ returning: { starters: 0, squad: 0, unknown: 0, total: 0, roleKnown: 0 } });
    expect(c.ok).toBe(true);
    const r = playingPathway({ competition: c, rotation: rot(0.5) });
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo((COMPETITION_SHARE * c.value) + ((1 - COMPETITION_SHARE) * 0.5), 10);
  });
});

describe('11. goalkeeper, where the fallback was most common', () => {
  it('refuses on the same rule, with no goalkeeper special case', () => {
    const c = returningCompetition({
      returning: null, position: 'GOALKEEPER', places: 1,
      rosterOnFile: false, programmeRosterOnFile: true, eligibilityRuled: true,
      positionUnreadable: 5, positionMissing: 0, programmeRows: 29,
      entryYear: 2027, rosterSeason: 2026, maxLastSeason: 2030,
    });
    expect(c.reason).toBe(REASON.NO_READABLE_POSITIONS);
    const gkRotation = squadRotation({
      sport: 'mens-soccer', position: 'GOALKEEPER', division: 'NCAA D1',
      programme: 'Nowhere', rosterOnFile: true,
    });
    const r = playingPathway({ competition: c, rotation: gkRotation });
    expect(r.ok).toBe(false);
    expect(r.detail.rotation.value).toBe(gkRotation.value);
  });
});

/* ------------------------------------------------------------------ */
/* 12. downstream: what the refusal does, and does NOT do              */
/* ------------------------------------------------------------------ */

describe('12. downstream — no missing evidence becomes a number anywhere', () => {
  const pw = playingPathway({ competition: refused(), rotation: rot(0.8) });
  const opp = (extra = {}) => athleteOpportunity({
    pathway: pw, trajectory: S(0.5), major: NA(), location: NA(), outcome: NA(), academic: NA(), ...extra,
  });

  it('Opportunity REFUSES rather than renormalising over what is left', () => {
    const o = opp();
    expect(o.ok).toBe(false);
    expect(o.detail.requiredMissing).toBe('playingPathway');
    expect(o.reason).toBe(REASON.NO_READABLE_POSITIONS);
  });

  it('does not let another component inherit the pathway\'s authority', () => {
    /**
     * The defect this phase must not create one layer higher. With a strong
     * majorFit present the layer STILL refuses, so majorFit cannot grow into
     * the 0.65 share the pathway vacated.
     */
    const withMajor = opp({ major: S(1) });
    expect(withMajor.ok).toBe(false);
    expect(withMajor.basis).toBeUndefined();
  });

  it('never turns the missing pathway into a zero', () => {
    const o = opp();
    expect(o.value).toBeUndefined();
    expect(o.available).toEqual(['programmeTrajectory']);
  });

  it('reports coverage as what WAS scored, and does not score with it', () => {
    expect(opp().coverage).toBeCloseTo(0.35, 10);
  });

  it('Pursuit refuses too, so recruitability and financial gain nothing', () => {
    const p = pursuitPriority({ recruitability: S(0.9), financial: S(0.9), opportunity: opp() });
    expect(p.ok).toBe(false);
    expect(p.missing).toEqual(['opportunity']);
    expect(p.value).toBeUndefined();
  });

  it('a surviving pathway is completely unaffected by any of this', () => {
    const fine = athleteOpportunity({
      pathway: playingPathway({ competition: S(0.5), rotation: rot(1) }),
      trajectory: S(0.5), major: NA(), location: NA(), outcome: NA(), academic: NA(),
    });
    expect(fine.ok).toBe(true);
    expect(fine.basis.components.playingPathway.share).toBeCloseTo(0.65, 10);
  });
});

describe('12b. the explanation keeps the rotation evidence and blames nobody', () => {
  it('says it is an evidence limit, not a verdict on the programme', () => {
    const text = renderReason({
      code: REASON_CODE.PATHWAY_NOT_RANKED, layer: LAYER.OPPORTUNITY,
      polarity: POLARITY.UNKNOWN, band: BAND.SECONDARY_EVIDENCE, evidence: {},
    });
    expect(text).toBeTruthy();
    expect(text).toMatch(/limits of what Thriv3 can see/);
    expect(text).toMatch(/rather than anything it has found/);
    // Must not read as negative evidence about the athlete's chances.
    expect(text).not.toMatch(/unlikely|poor|closed|will not play|no chance/i);
    // Must not leak internal counter names.
    expect(text).not.toMatch(/positionUnreadable|readableShare|UNSCOREABLE|playingPathway/);
  });

  it('still holds the rotation measurement for a surface to report', () => {
    const pw = playingPathway({ competition: refused(), rotation: rot(0.8) });
    expect(pw.detail.rotation.playingShare).toBe(0.55);
    expect(pw.detail.rotation.seasons).toBe(4);
  });
});
