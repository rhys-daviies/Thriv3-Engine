/**
 * The operator Top Reasons policy.
 *
 * Most of these assert an ABSENCE, because that is where the policy earns its
 * keep: a neutral measurement that does not become a reason, a FIT item that
 * does not get a slot it was never owed, an opening slot that stays empty
 * rather than being filled by something else wearing its name.
 */

import { describe, it, expect } from 'vitest';
import { defineEvidence, CONFIDENCE, EVIDENCE_KINDS } from './kinds.js';
import { topReasons, MAX_REASONS, MAX_PER_CATEGORY, OPERATOR_DISPOSITION } from './topReasons.js';

const mk = (kind, o = {}) => defineEvidence(kind, {
  source: 'test',
  data: {},
  confidence: CONFIDENCE.HIGH,
  ...(EVIDENCE_KINDS[kind].requiresWindow
    ? { describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 8 } } : {}),
  ...(EVIDENCE_KINDS[kind].requiresComparison
    ? { comparison: { basis: 'pool', statistic: 'median', poolSize: 900, band: 'above-p75' } } : {}),
  ...o,
});

const kindsOf = (r) => r.reasons.map((x) => x.primary.kind);
const dispOf = (r, kind) => r.dispositions.find((d) => d.kind === kind)?.disposition;

describe('eligibility', () => {
  it('admits only POSITIVE evidence', () => {
    const r = topReasons([mk('POSITION_GRADUATION'), mk('FRESHMAN_MINUTES_LADDER')]);
    expect(kindsOf(r)).toEqual(['POSITION_GRADUATION']);
    expect(dispOf(r, 'FRESHMAN_MINUTES_LADDER')).toBe(OPERATOR_DISPOSITION.NEUTRAL_ONLY);
  });

  it('keeps every NEUTRAL kind out, including the athlete-specific one', () => {
    // ATHLETE_COHORT_LADDER is PATHWAY and the most frequent pathway item in the
    // unfiltered ranking. It is still a measurement, so it is still not a reason.
    const r = topReasons([mk('ATHLETE_COHORT_LADDER'), mk('PROGRAMME_DEVELOPMENT_PATTERN')]);
    expect(r.reasons).toEqual([]);
    expect(dispOf(r, 'ATHLETE_COHORT_LADDER')).toBe(OPERATOR_DISPOSITION.NEUTRAL_ONLY);
  });

  it('keeps CONTEXT out even when it is POSITIVE', () => {
    const r = topReasons([mk('SQUAD_GRADUATION'), mk('INTERNATIONAL_ROSTER')]);
    expect(r.reasons).toEqual([]);
    expect(dispOf(r, 'SQUAD_GRADUATION')).toBe(OPERATOR_DISPOSITION.CONTEXT_ONLY);
    expect(dispOf(r, 'INTERNATIONAL_ROSTER')).toBe(OPERATOR_DISPOSITION.CONTEXT_ONLY);
  });

  it('keeps out evidence the operator surface is denied', () => {
    const denied = mk('POSITION_GRADUATION', {
      permissions: { OPERATOR_EVIDENCE: 'DENIED' },
    });
    const r = topReasons([denied]);
    expect(r.reasons).toEqual([]);
    expect(dispOf(r, 'POSITION_GRADUATION')).toBe(OPERATOR_DISPOSITION.NOT_OPERATOR_LICENSED);
  });

  it('keeps out evidence below its own confidence floor', () => {
    // ACADEMIC_FIT declares HIGH; MEDIUM is not enough for it and is for others.
    const r = topReasons([mk('ACADEMIC_FIT', { confidence: CONFIDENCE.MEDIUM })]);
    expect(r.reasons).toEqual([]);
    expect(dispOf(r, 'ACADEMIC_FIT')).toBe(OPERATOR_DISPOSITION.BELOW_CONFIDENCE);
  });

  it('enforces the required qualification through the Stage C guard', () => {
    // A required-window kind whose window was stripped after construction.
    const stripped = { ...mk('POSITION_INTAKE_HISTORY'), describes: null };
    const r = topReasons([stripped]);
    expect(r.reasons).toEqual([]);
  });
});

describe('the opening slot', () => {
  it('takes the best OPENING first and says so', () => {
    const r = topReasons([mk('ACADEMIC_FIT'), mk('HISTORICAL_SAME_COUNTRY'), mk('POSITION_GRADUATION')]);
    expect(r.openingIdentified).toBe(true);
    expect(kindsOf(r)[0]).toBe('POSITION_GRADUATION');
  });

  it('records that none was identified rather than filling the slot', () => {
    const r = topReasons([mk('HISTORICAL_SAME_COUNTRY'), mk('ACADEMIC_FIT')]);
    expect(r.openingIdentified).toBe(false);
    // The other classes still become reasons — they are simply not an opening.
    expect(kindsOf(r)).toEqual(['HISTORICAL_SAME_COUNTRY', 'ACADEMIC_FIT']);
  });

  it('is false when the only OPENING is ineligible', () => {
    const r = topReasons([
      mk('POSITION_GRADUATION', { permissions: { OPERATOR_EVIDENCE: 'DENIED' } }),
      mk('ACADEMIC_FIT'),
    ]);
    expect(r.openingIdentified).toBe(false);
  });
});

describe('selection shape', () => {
  it('takes a PATHWAY when one is available', () => {
    const r = topReasons([mk('POSITION_GRADUATION'), mk('ACADEMIC_FIT'), mk('HISTORICAL_SAME_COUNTRY')]);
    expect(kindsOf(r).slice(0, 2)).toEqual(['POSITION_GRADUATION', 'HISTORICAL_SAME_COUNTRY']);
  });

  it('does not guarantee FIT a slot — a second OPENING can take it', () => {
    // Four reasons available; the roster cap allows two openings, so the second
    // opening displaces one of the two FIT groups.
    const r = topReasons([
      mk('POSITION_GRADUATION'), mk('POSITION_GROUP_SCARCITY'),
      mk('HISTORICAL_SAME_COUNTRY'), mk('ACADEMIC_FIT'), mk('CONFERENCE_TITLE'),
    ]);
    expect(kindsOf(r)).toContain('POSITION_GROUP_SCARCITY');
    expect(kindsOf(r)).not.toContain('CONFERENCE_TITLE');
    expect(dispOf(r, 'CONFERENCE_TITLE')).toBe(OPERATOR_DISPOSITION.MAX_REASONS);
  });

  it('caps primary reasons at four', () => {
    const r = topReasons([
      mk('POSITION_GRADUATION'), mk('POSITION_GROUP_SCARCITY'),
      mk('HISTORICAL_SAME_COUNTRY'), mk('ACADEMIC_FIT'), mk('CONFERENCE_TITLE'),
    ]);
    expect(r.reasons.length).toBe(MAX_REASONS);
  });

  it('returns fewer than four without padding', () => {
    const r = topReasons([mk('POSITION_GRADUATION')]);
    expect(r.reasons.length).toBe(1);
  });

  it('returns zero reasons rather than reaching into CONTEXT', () => {
    const r = topReasons([
      mk('POSITION_GROUP_SIZE'), mk('COACH_CONTEXT'), mk('TRANSFER_BEHAVIOUR'),
      mk('POSITION_INTAKE_HISTORY'), mk('SQUAD_GRADUATION'),
    ]);
    expect(r.reasons).toEqual([]);
    expect(r.openingIdentified).toBe(false);
    expect(r.dispositions.length).toBe(5);
  });

  it('caps one category at two primary reasons', () => {
    // Three roster groups would be available if the cap did not exist; only
    // position-opportunity and position-depth can both be roster primaries.
    const r = topReasons([
      mk('POSITION_GRADUATION'), mk('POSITION_GROUP_SCARCITY'), mk('ACADEMIC_FIT'),
    ]);
    const roster = r.reasons.filter((x) => x.category === 'roster');
    expect(roster.length).toBeLessThanOrEqual(MAX_PER_CATEGORY);
  });
});

describe('grouping preserves the story instead of discarding half of it', () => {
  it('attaches the starters detail beneath the graduation reason', () => {
    const r = topReasons([mk('POSITION_GRADUATION'), mk('POSITION_GRADUATION_STARTERS')]);
    expect(r.reasons.length).toBe(1);
    expect(r.reasons[0].primary.kind).toBe('POSITION_GRADUATION');
    expect(r.reasons[0].supporting.map((s) => s.kind)).toEqual(['POSITION_GRADUATION_STARTERS']);
  });

  it('does not let one story consume two primary slots', () => {
    const r = topReasons([
      mk('POSITION_GRADUATION'), mk('POSITION_GRADUATION_STARTERS'), mk('ELIGIBILITY_CLIFF'),
    ]);
    expect(r.reasons.length).toBe(1);
    expect(r.reasons[0].supporting.length).toBe(2);
  });

  it('records supporting items as kept, not as dropped', () => {
    const r = topReasons([mk('POSITION_GRADUATION'), mk('POSITION_GRADUATION_STARTERS')]);
    expect(dispOf(r, 'POSITION_GRADUATION_STARTERS'))
      .toBe(OPERATOR_DISPOSITION.GROUPED_SUPPORTING);
    expect(r.dispositions.find((d) => d.kind === 'POSITION_GRADUATION_STARTERS').under)
      .toBe('POSITION_GRADUATION');
  });

  it('collapses the eight international kinds to one reason', () => {
    const r = topReasons([
      mk('HISTORICAL_SAME_COUNTRY'), mk('HISTORICAL_SAME_REGION'),
      mk('COACH_ARRIVAL_SAME_COUNTRY'), mk('ARRIVAL_SAME_REGION_POSITION'),
    ]);
    expect(r.reasons.length).toBe(1);
    expect(r.reasons[0].primary.kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    expect(r.reasons[0].supporting.length).toBe(3);
  });
});

describe('determinism and purity', () => {
  it('gives the same answer whatever order the evidence arrives in', () => {
    const set = [
      mk('ACADEMIC_FIT'), mk('POSITION_GRADUATION'), mk('CONFERENCE_TITLE'),
      mk('HISTORICAL_SAME_COUNTRY'), mk('POSITION_GRADUATION_STARTERS'),
    ];
    const forward = kindsOf(topReasons(set));
    const reversed = kindsOf(topReasons([...set].reverse()));
    const rotated = kindsOf(topReasons([set[2], set[4], set[0], set[3], set[1]]));
    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
  });

  it('mutates nothing it is given', () => {
    const set = [mk('POSITION_GRADUATION'), mk('POSITION_GRADUATION_STARTERS')];
    const before = JSON.stringify(set);
    topReasons(set);
    expect(JSON.stringify(set)).toBe(before);
  });

  it('gives every input item exactly one disposition', () => {
    const set = [
      mk('POSITION_GRADUATION'), mk('POSITION_GRADUATION_STARTERS'), mk('ACADEMIC_FIT'),
      mk('FRESHMAN_MINUTES_LADDER'), mk('SQUAD_GRADUATION'), mk('COACH_CONTEXT'),
    ];
    const r = topReasons(set);
    expect(r.dispositions.length).toBe(set.length);
    expect(new Set(r.dispositions.map((d) => d.kind)).size).toBe(set.length);
    for (const d of r.dispositions) {
      expect(Object.values(OPERATOR_DISPOSITION), d.kind).toContain(d.disposition);
    }
  });

  it('handles an empty set without inventing a state', () => {
    const r = topReasons([]);
    expect(r.reasons).toEqual([]);
    expect(r.openingIdentified).toBe(false);
    expect(r.dispositions).toEqual([]);
  });
});
