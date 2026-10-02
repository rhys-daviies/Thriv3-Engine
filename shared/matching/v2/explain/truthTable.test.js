/**
 * =============================================================================
 * A7.48 — the explanation truth table.
 *
 * Every state Playing Pathway can be in, asserted on three things at once: the
 * MACHINE REASON, the EVIDENCE STATE behind it, and the USER-FACING MEANING.
 * A7.47 found all three agreeing on the numbers and disagreeing on the words -
 * a programme with no roster told that nobody leaving the position could be
 * placed as a starter, a programme with fourteen listed players told Thriv3
 * holds no roster for it, and a refusal promising rotation evidence that had
 * itself refused.
 *
 * THE RULE THESE TESTS ENCODE. A sentence may say what is known and what is
 * not known. It may not describe evidence that does not exist, and it may not
 * convert an absence of evidence into a finding about the programme.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import {
  returningCompetition, squadRotation, playingPathway, programmeTrajectory, ROTATION_OWN_REFUSALS,
} from '../layers/opportunityComponents.js';
import { athleteOpportunity } from '../layers/opportunity.js';
import { GRADE, REASON, scoreable, unscoreable, notApplicable, RANKING_STATE } from '../types.js';
import { explainProgramme } from './explain.js';
import { renderReason, refusalPhrase } from './render.js';
import { REASON_CODE } from './vocabulary.js';

const S = (v, g = GRADE.MEASURED, b = {}) => scoreable({ value: v, grade: g, coverage: 1, basis: b });
const NA = () => notApplicable({ why: 'not stated' });
const ROT = (level) => S(0.6, level === 'programme' ? GRADE.MEASURED : GRADE.PARTIAL, { level, seasons: 4, playingShare: 0.55, scaleMedian: 0.56 });
const NO_ROTATION = () => squadRotation({ sport: 'mens-soccer', position: 'MIDFIELD', division: 'NCAA D1', programme: 'nowhere', rosterOnFile: false });

const comp = (over = {}) => returningCompetition({
  returning: { starters: 1, squad: 1, unknown: 0, total: 2, roleKnown: 2 },
  position: 'MIDFIELD', places: 5, rosterOnFile: true, programmeRosterOnFile: true,
  eligibilityRuled: true, positionRows: 8, unreadable: 0, positionUnreadable: 0,
  positionMissing: 0, programmeRows: 30, entryYear: 2027, rosterSeason: 2026, maxLastSeason: 2030, ...over,
});

/** The sentences a person actually reads for this programme. */
function saidAbout(pathway) {
  const opportunity = athleteOpportunity({
    pathway, trajectory: programmeTrajectory({ recentWinPct: 0.5, priorWinPct: 0.5 }),
    major: NA(), location: NA(), outcome: NA(), academic: NA(),
  });
  const ex = explainProgramme({
    id: 1, name: 'Somewhere', division: 'NCAA D1', state: 'CA',
    rankingState: RANKING_STATE.LIMITED_DATA, missingLayers: ['recruitability', 'financial'],
    recruitability: unscoreable({ reason: REASON.NO_ATHLETE_LEVEL, missing: ['rating'], available: [] }),
    financial: unscoreable({ reason: REASON.NO_ATHLETE_LEVEL, missing: ['rating'], available: [] }),
    opportunity,
  });
  return {
    opportunity,
    codes: ex.layerReasons.opportunity.map((r) => r.code),
    text: ex.layerReasons.opportunity.map(renderReason).filter(Boolean).join(' '),
  };
}

/* ------------------------------------------------------------------ */
/* the twelve states                                                   */
/* ------------------------------------------------------------------ */

const CASES = [
  {
    n: 1,
    name: 'no roster or minutes history at all',
    build: () => playingPathway({ competition: comp({ rosterOnFile: false, programmeRosterOnFile: false, returning: null }), rotation: NO_ROTATION() }),
    reason: REASON.NO_ROSTER_ON_FILE,
    rotationKnown: false,
    mustSay: [/no playing-time record for this programme/, /nothing on file to read either way/],
    mustNotSay: [/nobody leaving this position/, /is kept and reported/],
  },
  {
    n: 2,
    name: 'roster exists, no readable position',
    build: () => playingPathway({ competition: comp({ positionRows: 2, positionUnreadable: 9 }), rotation: ROT('programme') }),
    reason: REASON.NO_READABLE_POSITIONS,
    rotationKnown: true,
    mustSay: [/does not say clearly enough who plays where/, /is kept and reported/],
    mustNotSay: [/holds no current roster/, /nobody leaving this position/],
  },
  {
    n: 3,
    name: 'roster exists, no readable class labels',
    build: () => playingPathway({ competition: comp({ positionRows: 6, unreadable: 6 }), rotation: ROT('programme') }),
    reason: REASON.NO_CLASS_LABELS,
    rotationKnown: true,
    mustSay: [/no readable class years/],
    mustNotSay: [/holds no current roster/, /nobody leaving this position/],
  },
  {
    n: 4,
    name: 'competition refuses, programme-specific rotation survives',
    build: () => playingPathway({ competition: comp({ positionRows: 2, positionUnreadable: 9 }), rotation: ROT('programme') }),
    reason: REASON.NO_READABLE_POSITIONS,
    rotationKnown: true,
    mustSay: [/is kept and reported/],
    mustNotSay: [/nothing on file to read either way/],
  },
  {
    n: 5,
    name: 'competition refuses, division rotation survives',
    build: () => playingPathway({ competition: comp({ positionRows: 2, positionUnreadable: 9 }), rotation: ROT('division') }),
    reason: REASON.NO_READABLE_POSITIONS,
    rotationKnown: true,
    mustSay: [/is kept and reported/],
    mustNotSay: [/nothing on file to read either way/],
  },
  {
    n: 6,
    name: 'competition refuses, sport rotation survives',
    build: () => playingPathway({ competition: comp({ positionRows: 2, positionUnreadable: 9 }), rotation: ROT('sport') }),
    reason: REASON.NO_READABLE_POSITIONS,
    rotationKnown: true,
    mustSay: [/is kept and reported/],
    mustNotSay: [/nothing on file to read either way/],
  },
  {
    n: 7,
    name: 'competition and rotation both refuse',
    build: () => playingPathway({ competition: comp({ rosterOnFile: false, programmeRosterOnFile: false, returning: null }), rotation: NO_ROTATION() }),
    reason: REASON.NO_ROSTER_ON_FILE,
    rotationKnown: false,
    mustSay: [/nothing on file to read either way/],
    mustNotSay: [/is kept and reported/],
  },
  {
    n: 8,
    name: 'genuine measured zero at the position',
    build: () => playingPathway({ competition: comp({ rosterOnFile: false, returning: null, programmeRosterOnFile: true, positionUnreadable: 0 }), rotation: ROT('programme') }),
    reason: REASON.NO_PLAYERS_AT_POSITION,
    rotationKnown: true,
    mustSay: [/records nobody at this position/],
    mustNotSay: [/holds no current roster/, /nobody leaving this position/, /does not say clearly enough/],
  },
  {
    n: 9,
    name: 'competition only (rotation unavailable)',
    build: () => playingPathway({ competition: comp(), rotation: NO_ROTATION() }),
    scoreable: true,
  },
  {
    n: 10,
    name: 'normal competition + rotation',
    build: () => playingPathway({ competition: comp(), rotation: ROT('programme') }),
    scoreable: true,
  },
  {
    n: 11,
    name: 'A7.44 unreadable-position refusal',
    build: () => playingPathway({ competition: comp({ positionRows: 2, positionUnreadable: 9 }), rotation: ROT('programme') }),
    reason: REASON.NO_READABLE_POSITIONS,
    rotationKnown: true,
    mustSay: [/does not say clearly enough who plays where/],
    mustNotSay: [/holds no current roster/],
  },
  {
    n: 12,
    name: 'A7.45 Policy-B refusal (rotation alone does not rank)',
    build: () => playingPathway({ competition: comp({ positionRows: 2, positionUnreadable: 9 }), rotation: ROT('programme') }),
    reason: REASON.NO_READABLE_POSITIONS,
    rotationKnown: true,
    mustSay: [/does not use playing pathway to rank/],
    mustNotSay: [/nothing on file to read either way/],
  },
];

describe('the explanation truth table', () => {
  it.each(CASES.map((c) => [c.n, c.name, c]))('%d. %s', (_n, _name, c) => {
    const pathway = c.build();
    if (c.scoreable) {
      expect(pathway.ok, 'should be scoreable').toBe(true);
      const said = saidAbout(pathway);
      expect(said.opportunity.ok).toBe(true);
      // a scoreable pathway never emits a "not ranked" sentence
      expect(said.codes).not.toContain(REASON_CODE.PATHWAY_NOT_RANKED_ROTATION_KNOWN);
      expect(said.codes).not.toContain(REASON_CODE.PATHWAY_NOT_RANKED_NOTHING_KNOWN);
      return;
    }
    // MACHINE REASON
    expect(pathway.ok, 'should refuse').toBe(false);
    expect(pathway.reason, 'machine reason').toBe(c.reason);
    // EVIDENCE STATE
    expect(ROTATION_OWN_REFUSALS.includes(pathway.reason), 'rotation-state discriminator')
      .toBe(!c.rotationKnown);
    // USER-FACING MEANING
    const said = saidAbout(pathway);
    expect(said.codes).toContain(c.rotationKnown
      ? REASON_CODE.PATHWAY_NOT_RANKED_ROTATION_KNOWN
      : REASON_CODE.PATHWAY_NOT_RANKED_NOTHING_KNOWN);
    for (const re of c.mustSay ?? []) expect(said.text, `must say ${re}`).toMatch(re);
    for (const re of c.mustNotSay ?? []) expect(said.text, `must NOT say ${re}`).not.toMatch(re);
  });
});

describe('the rules every refusal sentence obeys', () => {
  const refusing = CASES.filter((c) => !c.scoreable);

  it.each(refusing.map((c) => [c.n, c.name, c]))('%d. %s says nothing negative and leaks nothing internal', (_n, _name, c) => {
    const said = saidAbout(c.build());
    // never a judgement about the athlete's chances
    expect(said.text).not.toMatch(/unlikely|poor|closed|will not play|no chance|weak/i);
    // never an internal identifier
    expect(said.text).not.toMatch(/positionUnreadable|readableShare|rosterIndex|UNSCOREABLE|playingPathway|NO_[A-Z_]+/);
  });

  it('every reason the pathway can carry has a phrase, and no phrase contradicts another', () => {
    for (const r of [REASON.NO_ROSTER_ON_FILE, REASON.NO_READABLE_POSITIONS, REASON.NO_CLASS_LABELS,
      REASON.NO_PLAYERS_AT_POSITION, REASON.NO_MINUTES_HISTORY]) {
      expect(refusalPhrase(r), `${r} needs a phrase`).toBeTruthy();
    }
    // the three roster-shaped reasons must not all claim the same thing
    expect(refusalPhrase(REASON.NO_ROSTER_ON_FILE)).toMatch(/holds no current roster/);
    expect(refusalPhrase(REASON.NO_PLAYERS_AT_POSITION)).toMatch(/is on file/);
    expect(refusalPhrase(REASON.NO_READABLE_POSITIONS)).toMatch(/is on file/);
  });

  it('the discriminator is exact in both directions', () => {
    /**
     * The property `explain.js` relies on: a pathway refusal carrying one of
     * ROTATION_OWN_REFUSALS has no rotation behind it, and any other refusal
     * does. Asserted here rather than trusted.
     */
    for (const c of refusing) {
      const pw = c.build();
      const hasRotationEvidence = Boolean(pw.detail?.rotation);
      expect(hasRotationEvidence, `${c.name}`).toBe(!ROTATION_OWN_REFUSALS.includes(pw.reason));
    }
  });
});
