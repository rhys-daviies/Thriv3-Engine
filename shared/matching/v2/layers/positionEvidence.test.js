/**
 * =============================================================================
 * A7.44 - programme-level unreadable-position evidence.
 *
 * THE DEFECT. `buildPositionIndex` counted roster rows it could not place at
 * any position and then dropped them. Every position bucket at such a
 * programme was built from a roster with a hole in it, and no bucket was ever
 * told. Saint Joseph's-shaped cells scored a confident, wide-open position on
 * a group most of whose plausible members were unaccounted for.
 *
 * WHAT THIS FILE PINS. That the repair propagates doubt WITHOUT inventing
 * anybody's position, that it never moves a value it is not entitled to move,
 * and - the assertion the whole phase turns on - that a measured zero and an
 * unreadable one remain different statements.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { returningCompetition, ZERO_CLAIM_READABLE_SHARE, RETURNER_STATE } from './opportunityComponents.js';
import { positionalOpportunity } from './positionalOpportunity.js';
import { GRADE, REASON, scoreable, unscoreable } from '../types.js';
import { renderReason, refusalPhrase } from '../explain/render.js';
import { REASON_CODE, LAYER, POLARITY, BAND } from '../explain/vocabulary.js';
import { explainProgramme } from '../explain/explain.js';
import { RANKING_STATE } from '../types.js';
import { fillPropensity } from '../recruitingRules.js';
import {
  POSITION_READABLE_SHARE_FLOOR, POSITION_EVIDENCE, positionReadableShare, positionEvidenceState,
} from '../positionReadability.js';
import { buildPositionIndex, positionEvidence, readPositionState, POSITION_READABILITY } from '../../../../server/lib/v2/rosterEvidence.js';

const R = (starters = 0, squad = 0, unknown = 0) => ({ starters, squad, unknown });

/** A programme whose position group reads completely, unless told otherwise. */
const comp = (over = {}) => returningCompetition({
  returning: R(1, 2, 0),
  position: 'MIDFIELD',
  places: 5,
  rosterOnFile: true,
  programmeRosterOnFile: true,
  eligibilityRuled: true,
  positionRows: 8,
  unreadable: 0,
  positionUnreadable: 0,
  positionMissing: 0,
  programmeRows: 30,
  entryYear: 2027,
  rosterSeason: 2026,
  maxLastSeason: 2030,
  ...over,
});

const SPORT = 'mens-soccer';
const fill = (position = 'MIDFIELD') => fillPropensity({ sport: SPORT, division: 'NCAA D1', position, programme: 'Nowhere' });
const pos = (over = {}, position = 'MIDFIELD') => positionalOpportunity({
  sport: SPORT,
  position,
  evidence: {
    rosterOnFile: true,
    eligibilityRuled: true,
    positionRows: 10,
    vacatedStarters: 2,
    openings: 3,
    eligibleToRemain: 6,
    unreadable: 0,
    arrivals: 0,
    arrivalsApplicable: true,
    programmePositionUnreadable: 0,
    programmePositionMissing: 0,
    starterEvidence: { positionRows: 10, classified: 10, unknown: 0, departing: 3, departingUnknown: 0 },
    fill: over.fill ?? fill(position),
    ...over,
  },
});

/** A roster row, with only the columns the index reads. */
const row = (position, over = {}) => ({
  college_name: 'Somewhere', sport: SPORT, season: 2026, division: 'NCAA D1',
  position, class_year_label: 'Fr.',
  minutes_played: 0, games_started: 0, projected_minutes: null, projected_games_started: null,
  ...over,
});

/* ------------------------------------------------------------------ */
/* 0. the threshold is borrowed, not minted                            */
/* ------------------------------------------------------------------ */

describe('0. the readable-majority rule is one number, in one place', () => {
  /**
   * The mechanical half of a claim the comments make in prose. If somebody
   * retunes one axis and not the other, this fails rather than leaving two
   * thresholds quietly disagreeing about what a majority is.
   */
  it('is literally A7.37\'s threshold, so the two cannot drift apart', () => {
    expect(POSITION_READABLE_SHARE_FLOOR).toBe(ZERO_CLAIM_READABLE_SHARE);
    expect(POSITION_READABLE_SHARE_FLOOR).toBe(0.5);
  });

  it('counts unplaceable players against every position, because any could be there', () => {
    expect(positionReadableShare({ placed: 4, unplaceable: 4 })).toBe(0.5);
    expect(positionReadableShare({ placed: 4, unplaceable: 0 })).toBe(1);
    expect(positionReadableShare({ placed: 0, unplaceable: 0 })).toBe(1);
  });

  it('reads an untold caller as fully readable rather than refusing on its own silence', () => {
    expect(positionReadableShare({ placed: null, unplaceable: 99 })).toBe(1);
  });

  it('names three states and no fourth', () => {
    expect(positionEvidenceState(1)).toBe(POSITION_EVIDENCE.COMPLETE);
    expect(positionEvidenceState(0.6)).toBe(POSITION_EVIDENCE.PARTIAL);
    expect(positionEvidenceState(0.49)).toBe(POSITION_EVIDENCE.INSUFFICIENT);
  });
});

/* ------------------------------------------------------------------ */
/* 1-4. the four readability states of a roster                        */
/* ------------------------------------------------------------------ */

describe('1. a fully readable position roster is untouched', () => {
  it('scores, grades MEASURED and reports full coverage', () => {
    const r = comp();
    expect(r.ok).toBe(true);
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.coverage).toBe(1);
    expect(r.basis.positionEvidence).toBe(POSITION_EVIDENCE.COMPLETE);
  });

  it('is byte-for-byte what the pre-A7.44 caller got, value included', () => {
    /**
     * The regression that matters most for the 6,922 cells nothing was wrong
     * with: a caller that never passes the new evidence must be indistinguish-
     * able from one that passes zero.
     */
    const told = comp({ positionUnreadable: 0, positionMissing: 0 });
    const untold = returningCompetition({
      returning: R(1, 2, 0), position: 'MIDFIELD', places: 5, rosterOnFile: true,
      eligibilityRuled: true, positionRows: 8, unreadable: 0,
      entryYear: 2027, rosterSeason: 2026, maxLastSeason: 2030,
    });
    expect(untold.value).toBe(told.value);
    expect(untold.grade).toBe(told.grade);
    expect(untold.coverage).toBe(told.coverage);
  });
});

describe('2. some unreadable positions: the conclusion stands, the certainty does not', () => {
  const r = comp({ positionUnreadable: 4, programmeRows: 30 }); // 8 placed, 4 lost -> 0.667

  it('stays scoreable', () => {
    expect(r.ok).toBe(true);
  });

  it('drops to PARTIAL', () => {
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.basis.positionEvidence).toBe(POSITION_EVIDENCE.PARTIAL);
  });

  it('lowers coverage to the share it could actually place', () => {
    expect(r.coverage).toBeCloseTo(8 / 12, 10);
    expect(r.basis.positionReadableShare).toBeCloseTo(8 / 12, 10);
  });

  it('KEEPS THE NUMBER. Falling confidence is not evidence of a worse opportunity', () => {
    expect(r.value).toBe(comp().value);
  });
});

describe('3. mostly unreadable positions: no defensible estimate', () => {
  const r = comp({ positionRows: 3, positionUnreadable: 9, programmeRows: 30 }); // 0.25

  it('refuses rather than scoring a minority of the group', () => {
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_READABLE_POSITIONS);
  });

  it('carries no value, as an unscoreable result never may', () => {
    expect(r.value).toBeUndefined();
  });

  it('says which players it could not place, and how many the programme lists', () => {
    expect(r.detail.positionUnreadable).toBe(9);
    expect(r.detail.programmeRows).toBe(30);
    expect(r.detail.positionReadableShare).toBeCloseTo(0.25, 10);
  });
});

describe('4. a missing raw position stays separately attributable', () => {
  /**
   * Zero rows today. Counted anyway: an acquisition that stops emitting the
   * column and a vocabulary that stops recognising its values are different
   * failures with different repairs, and the moment they share a counter the
   * first one to appear is explained as the other.
   */
  it('reads three states at the source, not two', () => {
    expect(readPositionState('M').state).toBe(POSITION_READABILITY.READABLE);
    expect(readPositionState('UNKNOWN').state).toBe(POSITION_READABILITY.UNREADABLE);
    expect(readPositionState('').state).toBe(POSITION_READABILITY.MISSING);
    expect(readPositionState('   ').state).toBe(POSITION_READABILITY.MISSING);
    expect(readPositionState(null).state).toBe(POSITION_READABILITY.MISSING);
  });

  it('counts the two apart at the programme, and their union separately again', () => {
    const entry = buildPositionIndex([
      row('M'), row('UNKNOWN'), row(null), row('   '), row('M', { class_year_label: 'garbled' }),
    ]).get('Somewhere');
    expect(entry.positionUnreadable).toBe(1);
    expect(entry.positionMissing).toBe(2);
    expect(entry.classUnreadable).toBe(1);
    // The union the diagnostics have always read - NOT a third fact, and never
    // an addend of the two above.
    expect(entry.unreadable).toBe(4);
  });

  it('refuses on missing positions exactly as it does on unreadable ones', () => {
    const missing = comp({ positionRows: 3, positionMissing: 9 });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe(REASON.NO_READABLE_POSITIONS);
    expect(missing.detail.positionMissing).toBe(9);
    expect(missing.detail.positionUnreadable).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 5. THE LOAD-BEARING ONE                                             */
/* ------------------------------------------------------------------ */

describe('5. a measured zero is not an unknown, and the two must never converge', () => {
  /**
   * The founding rule of the model, asked on the positional axis. Both cells
   * below hold nobody at the position. One programme's roster reads
   * completely; the other lists twelve players it cannot place anywhere.
   *
   * They are not the same statement and A7.44's job is that they no longer
   * read as one. What A7.44 deliberately does NOT do is start scoring the
   * genuine zero - that is a separate question, it would move rankings, and
   * this phase is not entitled to it. The repair here is that the two are
   * TELLABLE APART, which they were not.
   */
  const readableZero = comp({ rosterOnFile: false, returning: null, positionRows: 0, programmeRosterOnFile: true });
  const unknownZero = comp({ rosterOnFile: false, returning: null, positionRows: 0, programmeRosterOnFile: true, positionUnreadable: 12 });

  it('gives them different reasons', () => {
    /**
     * A7.48 D2 sharpened the first of these. A7.44 separated the two states
     * and left the readable zero reporting NO_ROSTER_ON_FILE, which said
     * Thriv3 holds no roster for a programme whose roster it had just read
     * completely. It now says what it actually found.
     */
    expect(readableZero.reason).toBe(REASON.NO_PLAYERS_AT_POSITION);
    expect(unknownZero.reason).toBe(REASON.NO_READABLE_POSITIONS);
    expect(readableZero.reason).not.toBe(unknownZero.reason);
  });

  it('never tells an athlete the position is open because nobody could be read', () => {
    expect(unknownZero.ok).toBe(false);
    expect(unknownZero.value).toBeUndefined();
  });

  it('stops claiming Thriv3 holds no roster for a programme whose roster it read', () => {
    expect(unknownZero.detail.positionUnreadable).toBe(12);
    expect(unknownZero.missing).toContain('readablePositions');
    expect(unknownZero.missing).not.toContain('roster');
  });

  it('still says NO_ROSTER_ON_FILE when there genuinely is no roster', () => {
    const none = comp({ rosterOnFile: false, returning: null, programmeRosterOnFile: false, positionUnreadable: 0 });
    expect(none.reason).toBe(REASON.NO_ROSTER_ON_FILE);
  });

  it('A7.48: three empty-at-this-position states, three different reasons', () => {
    /**
     * The whole point of the split, in one assertion. All three hold nobody at
     * the position; they differ in WHY, and a reader needs a different thing
     * from each - acquire a roster, fix the position labels, or nothing at all
     * because the answer is simply that this programme has no one here.
     */
    const noRoster = comp({ rosterOnFile: false, returning: null, programmeRosterOnFile: false });
    const unreadable = comp({ rosterOnFile: false, returning: null, programmeRosterOnFile: true, positionUnreadable: 12 });
    const genuinelyEmpty = comp({ rosterOnFile: false, returning: null, programmeRosterOnFile: true, positionUnreadable: 0 });
    expect(noRoster.reason).toBe(REASON.NO_ROSTER_ON_FILE);
    expect(unreadable.reason).toBe(REASON.NO_READABLE_POSITIONS);
    expect(genuinelyEmpty.reason).toBe(REASON.NO_PLAYERS_AT_POSITION);
    expect(new Set([noRoster.reason, unreadable.reason, genuinelyEmpty.reason]).size).toBe(3);
    // and none of them carries a value: unknown never becomes a number
    for (const r of [noRoster, unreadable, genuinelyEmpty]) expect(r.value).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 6-9. shapes of roster the repair must not mis-read                  */
/* ------------------------------------------------------------------ */

describe('6. a multi-position player is placed once, at their first listed position', () => {
  /**
   * The parser reads the leading token of 'M/F'. That is a pre-existing rule
   * and A7.44 neither changes it nor treats such a row as doubt: it IS placed,
   * so it is not an unplaceable row.
   */
  it('does not count a readable compound label as unplaceable', () => {
    const entry = buildPositionIndex([row('M/F'), row('D,M')]).get('Somewhere');
    expect(entry.positionUnreadable).toBe(0);
    expect(entry.positions.get('MIDFIELD').rows).toBe(1);
    expect(entry.positions.get('DEFENSE').rows).toBe(1);
  });
});

describe('7. goalkeeper, where one unplaceable player is a larger share of the group', () => {
  /**
   * The normaliser is not what changes here - `typicalStarters` still divides
   * once. What changes is that a goalkeeper group is SMALL, so the same three
   * unplaceable players that leave a midfield group defensible do not leave a
   * goalkeeper group defensible. That is the intended behaviour and not a
   * goalkeeper special case: it falls out of the share arithmetic.
   */
  it('refuses the small group and keeps the large one, from identical doubt', () => {
    const gk = comp({ position: 'GOALKEEPER', places: 1, positionRows: 2, positionUnreadable: 3 });
    const mid = comp({ position: 'MIDFIELD', places: 5, positionRows: 12, positionUnreadable: 3 });
    expect(gk.ok).toBe(false);
    expect(gk.reason).toBe(REASON.NO_READABLE_POSITIONS);
    expect(mid.ok).toBe(true);
    expect(mid.grade).toBe(GRADE.PARTIAL);
  });
});

describe('8. a thin roster is thin, not unreadable', () => {
  it('keeps scoring a small group that reads completely', () => {
    const r = comp({ positionRows: 2, returning: R(0, 1, 0), programmeRows: 9 });
    expect(r.ok).toBe(true);
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.coverage).toBe(1);
  });
});

describe('9. an incomplete roster admits both doubts at once', () => {
  /**
   * `unreadable` (class) and `positionUnreadable` (position) are about
   * different populations, so they MULTIPLY into coverage and neither is
   * allowed to stand in for the other.
   */
  const r = comp({ positionRows: 8, unreadable: 2, positionUnreadable: 4, returning: R(1, 1, 0) });

  it('multiplies the two shares rather than adding the two counts', () => {
    expect(r.ok).toBe(true);
    expect(r.basis.readableShare).toBeCloseTo(6 / 8, 10);
    expect(r.basis.positionReadableShare).toBeCloseTo(8 / 12, 10);
    expect(r.coverage).toBeCloseTo((6 / 8) * (8 / 12), 10);
  });

  it('keeps the two counters legible and distinct in the evidence', () => {
    expect(r.basis.unreadableHorizon).toBe(2);
    expect(r.basis.positionUnreadable).toBe(4);
    expect(r.basis.states[RETURNER_STATE.UNKNOWN_HORIZON]).toBe(2);
    expect(r.basis.states[RETURNER_STATE.UNPLACEABLE_POSITION]).toBe(4);
  });
});

/* ------------------------------------------------------------------ */
/* 10-12. contamination, clean buckets, simultaneous doubt              */
/* ------------------------------------------------------------------ */

describe('10. a programme cleaned up since A7.42 scores as though it never was', () => {
  it('carries no residue once the unreadable rows are gone', () => {
    const before = comp({ positionUnreadable: 5 });
    const after = comp({ positionUnreadable: 0 });
    expect(before.grade).toBe(GRADE.PARTIAL);
    expect(after.grade).toBe(GRADE.MEASURED);
    expect(after.coverage).toBe(1);
    expect(after.value).toBe(before.value);
    expect(after.basis.positionUnreadable).toBe(0);
  });

  it('A7.42 contamination does not return: an unreadable row is never given a position', () => {
    const entry = buildPositionIndex([
      row('M'), row('UNKNOWN'), row('DIS'), row('Throws'),
    ]).get('Somewhere');
    expect([...entry.positions.keys()]).toEqual(['MIDFIELD']);
    expect(entry.positions.has('UNKNOWN')).toBe(false);
    expect(entry.positionUnreadable).toBe(3);
    // Every bucket total plus the unplaceable rows is the whole roster: nobody
    // was invented and nobody was lost.
    const placed = [...entry.positions.values()].reduce((s, b) => s + b.rows, 0);
    expect(placed + entry.positionUnreadable + entry.positionMissing).toBe(entry.rows);
  });
});

describe('11. programme doubt reaches a complete position bucket', () => {
  /**
   * The case the old model could not express at all. This position group is
   * internally perfect - every row placed, every year readable - and the
   * programme still lists players who belong to some position and we do not
   * know which. The bucket must not report certainty it does not have.
   */
  const r = comp({ positionRows: 6, unreadable: 0, returning: R(2, 2, 0), positionUnreadable: 3 });

  it('is PARTIAL despite a flawless bucket', () => {
    expect(r.ok).toBe(true);
    expect(r.basis.readableShare).toBe(1);
    expect(r.grade).toBe(GRADE.PARTIAL);
  });

  it('holds its value, because the players it counted are really there', () => {
    expect(r.value).toBe(comp({ positionRows: 6, unreadable: 0, returning: R(2, 2, 0) }).value);
  });
});

describe('12. class-unreadable and position-unreadable, simultaneously', () => {
  it('never lets one refusal wear the other\'s reason', () => {
    /**
     * A cell that already refuses for a class-year reason keeps it. A7.44 is
     * not entitled to relabel a refusal it did not cause - the existing reason
     * names the data somebody would actually go and fix.
     */
    const classGone = comp({ positionRows: 6, unreadable: 6, positionUnreadable: 1 });
    expect(classGone.ok).toBe(false);
    expect(classGone.reason).toBe(REASON.NO_CLASS_LABELS);

    const positionGone = comp({ positionRows: 2, unreadable: 0, positionUnreadable: 9 });
    expect(positionGone.ok).toBe(false);
    expect(positionGone.reason).toBe(REASON.NO_READABLE_POSITIONS);
  });

  it('propagates both from the index through to the evidence in one pass', () => {
    const index = buildPositionIndex([
      row('M'), row('M'), row('M', { class_year_label: 'garbled' }), row('UNKNOWN'), row('UNKNOWN'),
    ]);
    const e = positionEvidence({
      programme: 'Somewhere', position: 'MIDFIELD', sport: SPORT, division: 'NCAA D1',
      entryYear: 2027, rosterIndex: index, arrivalIndex: new Map(), arrivalsHorizon: 2026,
    });
    expect(e.positionRows).toBe(3);
    expect(e.unreadable).toBe(1);              // class doubt, inside the bucket
    expect(e.programmePositionUnreadable).toBe(2); // position doubt, at the programme
    expect(e.programmeRows).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* 13. the recruitability side of the same index                       */
/* ------------------------------------------------------------------ */

describe('13. positionalOpportunity reads the same doubt from the departing side', () => {
  it('was blind to it and is not any more', () => {
    const clean = pos();
    const doubted = pos({ programmePositionUnreadable: 5 }); // 10 placed, 5 lost -> 0.667
    expect(clean.grade).toBe(GRADE.MEASURED);
    expect(clean.coverage).toBe(1);
    expect(doubted.grade).toBe(GRADE.PARTIAL);
    expect(doubted.coverage).toBeCloseTo(10 / 15, 10);
  });

  it('holds the value: a vacated place is still vacated', () => {
    expect(pos({ programmePositionUnreadable: 5 }).value).toBe(pos().value);
  });

  it('refuses when the placed players are a minority of the group', () => {
    const r = pos({ positionRows: 3, programmePositionUnreadable: 9 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(REASON.NO_READABLE_POSITIONS);
  });

  it('stops blaming class labels for an empty group at a programme it could not read', () => {
    const unreadable = pos({ positionRows: 0, programmePositionUnreadable: 7 });
    const genuine = pos({ positionRows: 0, programmePositionUnreadable: 0 });
    expect(unreadable.reason).toBe(REASON.NO_READABLE_POSITIONS);
    expect(genuine.reason).toBe(REASON.NO_CLASS_LABELS);
  });
});

/* ------------------------------------------------------------------ */
/* 14. what a person actually reads                                    */
/* ------------------------------------------------------------------ */

describe('14. the explanation says which of the three states it is', () => {
  const say = (code, evidence) => renderReason({
    code, layer: LAYER.OPPORTUNITY, polarity: POLARITY.UNKNOWN, band: BAND.SECONDARY_EVIDENCE, evidence,
  });

  it('renders both new states in recruitment language, with no counter names', () => {
    const partial = say(REASON_CODE.POSITION_EVIDENCE_PARTIAL,
      { position: 'DEFENSE', unplaceable: 5, placed: 11, rosterRows: 29 });
    const none = say(REASON_CODE.POSITION_EVIDENCE_INSUFFICIENT,
      { position: 'GOALKEEPER', unplaceable: 5, placed: 2, rosterRows: 29 });
    for (const text of [partial, none]) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/positionUnreadable|positionMissing|readableShare|UNSCOREABLE|PARTIAL/);
    }
    expect(none).toMatch(/not evidence that the position is open/);
  });

  it('leads with the position group, because the roster share understates a small one', () => {
    /**
     * Five unplaceable players out of twenty-nine sounds negligible. At
     * goalkeeper, where two were placed, they are most of the group that
     * matters - so the sentence must say 2 of 7, not 5 of 29 alone.
     */
    const none = say(REASON_CODE.POSITION_EVIDENCE_INSUFFICIENT,
      { position: 'GOALKEEPER', unplaceable: 5, placed: 2, rosterRows: 29 });
    expect(none).toMatch(/Only 2 of the 7/);
  });

  it('never renders a refusal as "Thriv3 holds no roster" once the roster is read', () => {
    expect(refusalPhrase(REASON.NO_READABLE_POSITIONS)).toBeTruthy();
    expect(refusalPhrase(REASON.NO_READABLE_POSITIONS)).not.toMatch(/holds no current roster/);
  });

  it('dispatches A7.44 BEFORE the horizon branch, which its detail would otherwise match', () => {
    /**
     * LOAD-BEARING ORDER. The positional refusal detail also carries
     * `positionRows`, so falling through would render the class-year sentence
     * and blame the years of a roster whose years may be perfect - the same
     * species of false statement this phase exists to remove.
     */
    const refusal = comp({ positionRows: 2, unreadable: 0, positionUnreadable: 9, programmeRows: 30 });
    expect(refusal.ok).toBe(false);
    const stub = unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'], available: [] });
    const e = explainProgramme({
      id: 1, name: 'Somewhere', division: 'NCAA D1', state: 'CA',
      // LIMITED_DATA, so the explanation is built without a pipeline standing:
      // this test is about which SENTENCE the pathway emits, not about ranking.
      rankingState: RANKING_STATE.LIMITED_DATA,
      missingLayers: ['recruitability', 'financial'],
      recruitability: stub,
      financial: stub,
      opportunity: scoreable({
        value: 0.4, grade: GRADE.PARTIAL, coverage: 0.4,
        basis: {
          pathway: {
            rotationOnly: true, usedBoth: false, competition: null,
            rotation: { playingShare: 0.6, scaleMedian: 0.55, level: 'programme', seasons: 3 },
            competitionRefusedBecause: refusal.reason,
            competitionRefusalDetail: refusal.detail,
          },
          notApplicable: [],
        },
      }),
    });
    const codes = e.reasons.map((r) => r.code);
    expect(codes).toContain(REASON_CODE.POSITION_EVIDENCE_INSUFFICIENT);
    expect(codes).not.toContain(REASON_CODE.RETURNING_HORIZON_UNREADABLE);
  });
});
