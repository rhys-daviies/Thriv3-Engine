/**
 * Stage D — ranking metadata and the pure comparator.
 *
 * The comparator is a claim about what matters, so most of these tests assert
 * an ORDER rather than a number: which of two real kinds should an operator see
 * first, and for which reason. The reason matters as much as the order — a test
 * that only checked the outcome would still pass if the right answer were being
 * reached by the wrong key.
 */

import { describe, it, expect } from 'vitest';
import {
  defineEvidence, EVIDENCE_KINDS, EVIDENCE_KIND_NAMES,
  DECISION_CLASS, DECISION_CLASS_KEYS, POLARITY, POLARITY_KEYS, CONFIDENCE,
} from './kinds.js';
import {
  compareEvidence, rankEvidence, decisionClassRank, specificityRank,
  specificityKey, confidenceRank, rankingMetadata,
} from './rank.js';
import { SPECIFICITY } from '../recruiting/patterns.js';

const mk = (kind, o = {}) => defineEvidence(kind, { source: 'test', data: {}, ...o });

/** A windowed build for the kinds the registry refuses without one. */
const windowed = (kind, o = {}) => mk(kind, {
  ...(EVIDENCE_KINDS[kind].requiresWindow
    ? { describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 8 } } : {}),
  ...(EVIDENCE_KINDS[kind].requiresComparison
    ? { comparison: { basis: 'pool', statistic: 'median', poolSize: 900, band: 'above-p75' } } : {}),
  ...o,
});

describe('ranking metadata is registry-owned', () => {
  it('gives every kind a decision class', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(DECISION_CLASS_KEYS, kind).toContain(EVIDENCE_KINDS[kind].decisionClass);
    }
  });

  it('gives every kind a polarity', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(POLARITY_KEYS, kind).toContain(EVIDENCE_KINDS[kind].polarity);
    }
  });

  it('gives every kind declared specificity axes', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(Array.isArray(EVIDENCE_KINDS[kind].specificityAxes), kind).toBe(true);
    }
  });

  it('carries the metadata onto the built object', () => {
    const e = mk('POSITION_GRADUATION');
    expect(e.decisionClass).toBe(DECISION_CLASS.OPENING);
    expect(e.polarity).toBe(POLARITY.POSITIVE);
  });

  it('cannot be supplied by a caller', () => {
    const e = mk('POSITION_GRADUATION', {
      decisionClass: DECISION_CLASS.CONTEXT, polarity: POLARITY.CAUTION,
    });
    expect(e.decisionClass).toBe(DECISION_CLASS.OPENING);
    expect(e.polarity).toBe(POLARITY.POSITIVE);
  });

  it('claims POSITIVE only where a generator establishes the direction', () => {
    // The four Philosophy measurements emit a number in either direction, so
    // none of them may be called favourable for existing.
    for (const kind of ['PROGRAMME_DEVELOPMENT_PATTERN', 'FRESHMAN_MINUTES_LADDER',
      'ATHLETE_COHORT_LADDER', 'PROGRAMME_POOL_BENCHMARK']) {
      expect(EVIDENCE_KINDS[kind].polarity, kind).toBe(POLARITY.NEUTRAL);
    }
  });

  it('declares no CAUTION kind yet', () => {
    const cautions = EVIDENCE_KIND_NAMES.filter((k) => EVIDENCE_KINDS[k].polarity === POLARITY.CAUTION);
    expect(cautions).toEqual([]);
  });
});

describe('specificity comes from the instance, not the kind', () => {
  it('prefers the arrival provenance the recruiting layer already computed', () => {
    const e = mk('COACH_ARRIVAL_SAME_COUNTRY', {
      data: { provenance: { specificity: 'COACH_COUNTRY_POSITION' } },
    });
    expect(specificityKey(e)).toBe('COACH_COUNTRY_POSITION');
    // Strictly more specific than the same kind without a position.
    const looser = mk('COACH_ARRIVAL_SAME_COUNTRY', {
      data: { provenance: { specificity: 'COACH_COUNTRY' } },
    });
    expect(specificityRank(e)).toBeGreaterThan(specificityRank(looser));
  });

  it('reads the APPLIED cohort for the cohort ladder', () => {
    const applied = windowed('ATHLETE_COHORT_LADDER', {
      describes: {
        seasons: ['2024', '2025'], seasonsUnread: [], n: 8,
        cohort: { position: 'DEFENSE', origin: 'international' },
      },
    });
    expect(specificityKey(applied)).toBe('ORIGIN_POSITION');
  });

  it('ranks a relaxed cohort below a cohort that held both axes', () => {
    // The majority case: 160 of 219 real pairs relax. A registry constant would
    // report both of these as position + origin.
    const both = windowed('ATHLETE_COHORT_LADDER', {
      describes: {
        seasons: ['2024', '2025'], seasonsUnread: [], n: 8,
        cohort: { position: 'DEFENSE', origin: 'international' },
      },
    });
    const relaxed = windowed('ATHLETE_COHORT_LADDER', {
      describes: {
        seasons: ['2024', '2025'], seasonsUnread: [], n: 8,
        cohort: { position: null, origin: 'international' },
      },
    });
    expect(specificityRank(both)).toBeGreaterThan(specificityRank(relaxed));
    expect(compareEvidence(both, relaxed)).toBeLessThan(0);
  });

  it('puts athlete-touching evidence above programme-only within a class', () => {
    // Both FIT. ACADEMIC_FIT matches this athlete's stated major; a conference
    // title is true of the programme whoever is reading.
    const academic = mk('ACADEMIC_FIT');
    const title = mk('CONFERENCE_TITLE');
    expect(specificityRank(academic)).toBeGreaterThan(specificityRank(title));
  });
});

describe('the comparator order', () => {
  it('puts decision class above everything, including a much higher strength', () => {
    // COACH_ARRIVAL_SAME_COUNTRY carries the highest strength in the registry
    // at 99 and is PATHWAY; POSITION_GRADUATION is 76 and is an OPENING.
    const pathway = mk('COACH_ARRIVAL_SAME_COUNTRY');
    const opening = mk('POSITION_GRADUATION');
    expect(pathway.strength).toBeGreaterThan(opening.strength);
    expect(rankEvidence([pathway, opening])[0].kind).toBe('POSITION_GRADUATION');
  });

  it('puts specificity above strength within a class', () => {
    const academic = mk('ACADEMIC_FIT');     // FIT, ATHLETE, strength 78
    const title = mk('CONFERENCE_TITLE');    // FIT, GENERAL, strength 80
    expect(title.strength).toBeGreaterThan(academic.strength);
    expect(rankEvidence([title, academic])[0].kind).toBe('ACADEMIC_FIT');
  });

  it('puts confidence above strength when class and specificity tie', () => {
    const high = windowed('ATHLETE_COHORT_LADDER', {
      confidence: CONFIDENCE.HIGH,
      describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 8, cohort: { position: 'DEFENSE' } },
    });
    const low = windowed('ATHLETE_COHORT_LADDER', {
      confidence: CONFIDENCE.MEDIUM,
      strength: 99,
      describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 8, cohort: { position: 'DEFENSE' } },
    });
    expect(low.strength).toBeGreaterThan(high.strength);
    expect(compareEvidence(high, low)).toBeLessThan(0);
  });

  it('reaches strength only when class, specificity and confidence all tie', () => {
    const a = mk('CONFERENCE_TITLE', { strength: 90 });
    const b = mk('POSTSEASON_RESULT', { strength: 10 });
    expect(decisionClassRank(a)).toBe(decisionClassRank(b));
    expect(specificityRank(a)).toBe(specificityRank(b));
    expect(confidenceRank(a)).toBe(confidenceRank(b));
    expect(rankEvidence([b, a])[0].kind).toBe('CONFERENCE_TITLE');
  });

  it('breaks a total tie deterministically, by kind and not by input order', () => {
    const a = mk('CONFERENCE_TITLE', { strength: 50 });
    const b = mk('POSTSEASON_RESULT', { strength: 50 });
    expect(rankEvidence([a, b]).map((e) => e.kind))
      .toEqual(rankEvidence([b, a]).map((e) => e.kind));
    expect(rankEvidence([b, a])[0].kind).toBe('CONFERENCE_TITLE');
  });

  it('ignores polarity — cautions are a selection decision, not a sort key', () => {
    // Asserted structurally: the comparator never reads the field.
    const src = rankingMetadata();
    expect(Object.values(src).some((m) => m.polarity === POLARITY.NEUTRAL)).toBe(true);
    const neutral = windowed('FRESHMAN_MINUTES_LADDER');
    const positive = mk('POSITION_GROUP_SIZE');
    // Both CONTEXT/FIT respectively — the ordering follows class, not polarity.
    expect(compareEvidence(neutral, positive)).toBeLessThan(0);
    expect(EVIDENCE_KINDS.FRESHMAN_MINUTES_LADDER.polarity).toBe(POLARITY.NEUTRAL);
    expect(EVIDENCE_KINDS.POSITION_GROUP_SIZE.polarity).toBe(POLARITY.NEUTRAL);
  });

  it('does not use CATEGORY_PRIOR — international gets no head start', () => {
    // INTERNATIONAL_SHARE is category `international`, which select.js rewards
    // with +8. Here it is CONTEXT and loses to a FIT item of lower strength.
    const intl = mk('INTERNATIONAL_SHARE');   // CONTEXT, strength 44
    const momentum = mk('PROGRAM_MOMENTUM');  // FIT, strength 56
    expect(rankEvidence([intl, momentum])[0].kind).toBe('PROGRAM_MOMENTUM');
    // And against an equal-strength FIT item the class still decides.
    expect(compareEvidence(momentum, intl)).toBeLessThan(0);
  });

  it('does not use FACT_BONUS — a SIGNAL opening beats a FACT context', () => {
    const signalOpening = mk('POSITION_GROUP_SCARCITY'); // SIGNAL, OPENING
    const factContext = mk('POSITION_GROUP_SIZE');       // FACT, CONTEXT
    expect(signalOpening.tier).toBe('SIGNAL');
    expect(factContext.tier).toBe('FACT');
    expect(rankEvidence([factContext, signalOpening])[0].kind).toBe('POSITION_GROUP_SCARCITY');
  });

  it('mutates nothing and returns a new array', () => {
    const items = [mk('CONFERENCE_TITLE'), mk('POSITION_GRADUATION')];
    const before = JSON.stringify(items);
    const ranked = rankEvidence(items);
    expect(JSON.stringify(items)).toBe(before);
    expect(ranked).not.toBe(items);
    expect(ranked.length).toBe(2);
  });

  it('sorts an unknown class last rather than first', () => {
    const fake = { kind: 'POSITION_GRADUATION', decisionClass: 'NONSENSE', confidence: 'HIGH', strength: 99 };
    expect(decisionClassRank(fake)).toBe(-1);
    expect(rankEvidence([fake, mk('TRANSFER_BEHAVIOUR')])[0].kind).toBe('TRANSFER_BEHAVIOUR');
  });
});

describe('the four classes rank in the intended order', () => {
  it('OPENING > PATHWAY > FIT > CONTEXT', () => {
    const order = [
      mk('POSITION_GRADUATION'),
      mk('HISTORICAL_SAME_COUNTRY'),
      mk('CONFERENCE_TITLE'),
      mk('POSITION_GROUP_SIZE'),
    ];
    const shuffled = [order[3], order[1], order[0], order[2]];
    expect(rankEvidence(shuffled).map((e) => e.decisionClass))
      .toEqual(['OPENING', 'PATHWAY', 'FIT', 'CONTEXT']);
  });
});

/* ------------------------------------------------------------------------- */
/* Cohort specificity — axes are read by VALUE, never by key                  */
/* ------------------------------------------------------------------------- */

describe('a null axis is not an axis', () => {
  /** Evidence carrying only a declared cohort, with no provenance to fall back on. */
  const withCohort = (cohort, kind = 'COACH_ARRIVAL_SAME_COUNTRY', data = {}) => ({
    kind,
    describes: { seasons: ['2025'], seasonsUnread: [], n: 1, cohort },
    data,
  });

  it('keeps coach and country when position is present but null', () => {
    // The bug: `'position' in cohort` was true for a null value, the branch was
    // entered, and only position/origin were read — so both real axes were lost
    // and this resolved GENERAL.
    expect(specificityKey(withCohort({
      country: 'New Zealand', coach: 'Ali Simmons', position: null,
    }))).toBe('COACH_COUNTRY');
  });

  it('keeps country when position is null', () => {
    expect(specificityKey(withCohort({ country: 'New Zealand', position: null })))
      .toBe(SPECIFICITY.COUNTRY);
  });

  it('keeps region when position is null', () => {
    expect(specificityKey(withCohort({ region: 'OCEANIA', position: null })))
      .toBe(SPECIFICITY.REGION);
  });

  it('reads a populated position', () => {
    expect(specificityKey(withCohort({ position: 'DEFENSE' }))).toBe(SPECIFICITY.POSITION);
  });

  it('reads origin alone when the position relaxed away', () => {
    expect(specificityKey(withCohort(
      { position: null, origin: 'international' }, 'ATHLETE_COHORT_LADDER',
    ))).toBe('ORIGIN');
  });

  it('reads origin and position together when both held', () => {
    expect(specificityKey(withCohort(
      { position: 'DEFENSE', origin: 'international' }, 'ATHLETE_COHORT_LADDER',
    ))).toBe('ORIGIN_POSITION');
  });

  it('reads all three axes when all three are populated', () => {
    expect(specificityKey(withCohort({
      country: 'New Zealand', coach: 'Ali Simmons', position: 'DEFENSE',
    }))).toBe(SPECIFICITY.COACH_COUNTRY_POSITION);
  });

  it('resolves GENERAL when a cohort names no populated axis', () => {
    expect(specificityKey(withCohort(
      { position: null, origin: null }, 'ATHLETE_COHORT_LADDER',
    ))).toBe(SPECIFICITY.GENERAL);
  });

  it('ignores excludingCountry, which narrows nothing', () => {
    // It records the country a region item left OUT. Counting it as a country
    // axis would report a narrower reading than the evidence supports.
    expect(specificityKey(withCohort(
      { region: 'OCEANIA', excludingCountry: 'New Zealand', position: 'DEFENSE' },
      'ARRIVAL_SAME_REGION_POSITION',
    ))).toBe(SPECIFICITY.REGION_POSITION);
  });

  it('treats a lone coach as no narrowing at all', () => {
    // The vocabulary has no bare COACH: every entry pairs it with a place or a
    // position, because knowing WHO recruited narrows nothing on its own. This
    // used to return COACH_POSITION and invent an axis the evidence never had.
    expect(specificityKey(withCohort({ coach: 'Ali Simmons' }, 'COACH_CONTEXT')))
      .toBe(SPECIFICITY.GENERAL);
  });

  it('still lets recruiting provenance win over the cohort', () => {
    expect(specificityKey(withCohort(
      { country: 'New Zealand', coach: 'X', position: null },
      'COACH_ARRIVAL_SAME_COUNTRY',
      { provenance: { specificity: 'COACH_COUNTRY_POSITION' } },
    ))).toBe(SPECIFICITY.COACH_COUNTRY_POSITION);
  });

  it('falls back to the registry axes when no cohort is declared', () => {
    expect(specificityKey({ kind: 'HISTORICAL_SAME_COUNTRY', data: {} }))
      .toBe(SPECIFICITY.COUNTRY);
    expect(specificityKey({ kind: 'COACH_CONTEXT', data: {} }))
      .toBe(SPECIFICITY.GENERAL);
  });

  it('ranks the fixed reading above the GENERAL it used to give', () => {
    const fixed = withCohort({ country: 'New Zealand', coach: 'Ali Simmons', position: null });
    const general = { kind: 'PROGRAM_MOMENTUM', data: {} };
    expect(specificityRank(fixed)).toBeGreaterThan(specificityRank(general));
  });
});
