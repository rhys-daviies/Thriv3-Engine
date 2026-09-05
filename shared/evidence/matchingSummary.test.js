import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  matchingSummaryFor, LICENSED_KINDS, MAX_FACTS,
} from './matchingSummary.js';
import {
  EVIDENCE_KINDS, PERMISSION, permissionsFor, kindSpec, defineEvidence, CONFIDENCE,
} from './kinds.js';

/**
 * The recruiting-signal read model.
 *
 * Two properties carry this suite. The first is that a DENIED kind cannot
 * reach the payload by any route — not by permission, not by a caller's
 * narrowing, not through a fact projection. The second is that a QUALIFIED
 * kind whose qualification cannot be stated is DROPPED rather than shown
 * plainly: silent degradation to ALLOWED is the failure mode that would be
 * invisible in production, because what reaches the card looks correct and is
 * simply missing its caveat.
 *
 * The third, quieter one: nothing here can see a match score. That is asserted
 * against the function's interface rather than its behaviour, because a
 * parameter that does not exist cannot be passed by accident later.
 */

/** The grades F1 approved, all 26 stated rather than derived. */
const APPROVED = Object.freeze({
  COACH_ARRIVAL_SAME_COUNTRY: 'ALLOWED',
  ARRIVAL_SAME_COUNTRY_POSITION: 'ALLOWED',

  POSITION_GROUP_SCARCITY: 'QUALIFIED',
  ARRIVAL_SAME_REGION_POSITION: 'QUALIFIED',
  HISTORICAL_SAME_COUNTRY: 'QUALIFIED',

  /**
   * DENIED, and it was QUALIFIED until the final Stage F audit.
   *
   * It counts the athlete's compatriots on the current squad; `internationalFit`
   * — which the geography criterion delegates to for every international
   * athlete — counts the same country over the same 2026 rows. Measurement
   * identity, not adjacency: of 8 real programmes where this kind fired, 8
   * also carried the score's own "a compatriot here" label. The other licensed
   * kinds range 0-60% and vary, which is what a different measurement looks
   * like.
   */
  CURRENT_SAME_COUNTRY: 'DENIED',

  HISTORICAL_SAME_REGION: 'DENIED',
  INTERNATIONAL_ROSTER: 'DENIED',
  INTERNATIONAL_SHARE: 'DENIED',
  POSITION_GRADUATION: 'DENIED',
  POSITION_GRADUATION_STARTERS: 'DENIED',
  SQUAD_GRADUATION: 'DENIED',
  POSITION_GROUP_SIZE: 'DENIED',
  RETURNING_POSITION_DEPTH: 'DENIED',
  ELIGIBILITY_CLIFF: 'DENIED',
  CONFERENCE_TITLE: 'DENIED',
  POSTSEASON_RESULT: 'DENIED',
  PROGRAM_MOMENTUM: 'DENIED',
  COACH_CONTEXT: 'DENIED',
  ACADEMIC_FIT: 'DENIED',
  POSITION_INTAKE_HISTORY: 'DENIED',
  TRANSFER_BEHAVIOUR: 'DENIED',
  PROGRAMME_DEVELOPMENT_PATTERN: 'DENIED',
  FRESHMAN_MINUTES_LADDER: 'DENIED',
  ATHLETE_COHORT_LADDER: 'DENIED',
  PROGRAMME_POOL_BENCHMARK: 'DENIED',
});

/** A result in the shape `evidenceFor` returns. */
const resultOf = (all, programmeResolved = true) => ({ all, programmeResolved });

/** Real fact shapes, taken from the payloads captured during Stage E. */
const coachArrival = (over = {}) => defineEvidence('COACH_ARRIVAL_SAME_COUNTRY', {
  confidence: CONFIDENCE.HIGH,
  season: '2024-2026',
  source: 'recruiting_arrivals',
  describes: { seasons: ['2024', '2025', '2026'], seasonsUnread: [], n: 1, cohort: { country: 'New Zealand', coach: 'Ali Simmons', position: null } },
  data: {
    country: 'New Zealand', coach: 'Ali Simmons', position: null, count: 1,
    seasons: ['2025'], name: 'Hayden Aish', nameSeason: '2025',
    attributableTransitions: 3, transitionsWithArrival: 1, arrivals: [],
    ...over,
  },
});

const regionArrival = (over = {}) => defineEvidence('ARRIVAL_SAME_REGION_POSITION', {
  confidence: CONFIDENCE.HIGH,
  season: '2023-2026',
  source: 'recruiting_arrivals',
  describes: { seasons: ['2023', '2024', '2025', '2026'], seasonsUnread: [], n: 1, cohort: { region: 'OCEANIA', position: 'DEFENSE' } },
  data: {
    region: 'OCEANIA', countries: ['Australia'], position: 'DEFENSE', count: 1,
    seasons: ['2026'], name: 'Liam Buckley', nameSeason: '2026',
    observedTransitions: 4, arrivals: [],
    ...over,
  },
});

const historicalCountry = (over = {}) => defineEvidence('HISTORICAL_SAME_COUNTRY', {
  confidence: CONFIDENCE.HIGH,
  season: '2022-2026',
  source: 'roster_players',
  describes: { seasons: ['2022', '2023'], seasonsUnread: [], n: 1, cohort: { country: 'New Zealand' } },
  data: { country: 'New Zealand', count: 1, names: ['Luke Johnson'], seasons: ['2022'], ...over },
});

const currentCountry = (over = {}) => defineEvidence('CURRENT_SAME_COUNTRY', {
  confidence: CONFIDENCE.HIGH,
  season: '2026',
  source: 'roster_players',
  data: { country: 'New Zealand', count: 1, names: ['Joby Reid'], ...over },
});

const scarcity = (over = {}) => defineEvidence('POSITION_GROUP_SCARCITY', {
  confidence: CONFIDENCE.MEDIUM,
  season: '2026',
  source: 'roster_players',
  data: { position: 'DEFENSE', count: 3, classifiedSquad: 28, share: 0.11, ...over },
});

const graduation = () => defineEvidence('POSITION_GRADUATION', {
  confidence: CONFIDENCE.HIGH,
  season: '2026',
  source: 'roster_players',
  data: { position: 'DEFENSE', count: 3, names: ['A', 'B', 'C'], classYear: 2027 },
});

describe('the registry says exactly what F1 approved', () => {
  it('states a grade for all 26 kinds', () => {
    expect(Object.keys(APPROVED).sort()).toEqual(Object.keys(EVIDENCE_KINDS).sort());
  });

  it('grants exactly the approved grade to every kind', () => {
    for (const [kind, grade] of Object.entries(APPROVED)) {
      expect(permissionsFor(kind).MATCHING_SUMMARY, kind).toBe(PERMISSION[grade]);
    }
  });

  it('licenses two, qualifies three and denies twenty-one', () => {
    const by = { ALLOWED: 0, QUALIFIED: 0, DENIED: 0 };
    for (const kind of Object.keys(EVIDENCE_KINDS)) by[permissionsFor(kind).MATCHING_SUMMARY] += 1;
    expect(by).toEqual({ ALLOWED: 2, QUALIFIED: 3, DENIED: 21 });
  });

  it('leaves OPERATOR and OUTREACH exactly as they were', () => {
    // Granting a third surface must change nothing about the other two.
    const OPERATOR_QUALIFIED = ['PROGRAMME_DEVELOPMENT_PATTERN', 'FRESHMAN_MINUTES_LADDER',
      'ATHLETE_COHORT_LADDER', 'PROGRAMME_POOL_BENCHMARK'];
    const OUTREACH_DENIED = ['POSITION_GROUP_SIZE', 'POSITION_INTAKE_HISTORY', 'TRANSFER_BEHAVIOUR',
      ...OPERATOR_QUALIFIED];
    for (const kind of Object.keys(EVIDENCE_KINDS)) {
      const p = permissionsFor(kind);
      expect(p.OPERATOR_EVIDENCE, kind)
        .toBe(OPERATOR_QUALIFIED.includes(kind) ? PERMISSION.QUALIFIED : PERMISSION.ALLOWED);
      expect(p.OUTREACH, kind)
        .toBe(OUTREACH_DENIED.includes(kind) ? PERMISSION.DENIED : PERMISSION.ALLOWED);
    }
  });

  it('derives its licensed set from the registry rather than a list', () => {
    expect([...LICENSED_KINDS].sort()).toEqual(
      Object.entries(APPROVED).filter(([, g]) => g !== 'DENIED').map(([k]) => k).sort(),
    );
  });

  it('denies a kind that says nothing, so a new one cannot arrive licensed', () => {
    // The default is DENIED and no kind inherits a grant from emailEligible.
    const unspecified = Object.keys(EVIDENCE_KINDS)
      .filter((k) => !EVIDENCE_KINDS[k].permissions?.MATCHING_SUMMARY);
    for (const kind of unspecified) {
      expect(permissionsFor(kind).MATCHING_SUMMARY, kind).toBe(PERMISSION.DENIED);
    }
    expect(unspecified).toHaveLength(20);
  });
});

describe('a denied kind cannot reach the payload', () => {
  it('drops one that is simply present', () => {
    const m = matchingSummaryFor(resultOf([graduation(), coachArrival()]));
    expect(m.facts.map((f) => f.kind)).toEqual(['COACH_ARRIVAL_SAME_COUNTRY']);
  });

  it('drops every denied kind, one at a time', () => {
    for (const [kind, grade] of Object.entries(APPROVED)) {
      if (grade !== 'DENIED') continue;
      // A bare object standing in for the kind: it never gets far enough for
      // its facts to matter, which is the point.
      const fake = { kind, confidence: CONFIDENCE.HIGH, permissions: permissionsFor(kind), data: {} };
      const m = matchingSummaryFor(resultOf([fake]));
      expect(m.facts, kind).toEqual([]);
    }
  });

  it('cannot be argued up by a caller narrowing permissions', () => {
    // `narrowPermissions` keeps the stricter of the two, so a generator asking
    // for ALLOWED on a denied kind still gets DENIED.
    const ev = defineEvidence('POSITION_GRADUATION', {
      confidence: CONFIDENCE.HIGH,
      season: '2026',
      source: 'roster_players',
      permissions: { MATCHING_SUMMARY: PERMISSION.ALLOWED },
      data: { position: 'DEFENSE', count: 3, names: ['A'], classYear: 2027 },
    });
    expect(ev.permissions.MATCHING_SUMMARY).toBe(PERMISSION.DENIED);
    expect(matchingSummaryFor(resultOf([ev])).facts).toEqual([]);
  });
});

/**
 * The fact the match score already counts.
 *
 * CURRENT_SAME_COUNTRY is not a kind that merely sounds like a criterion. It
 * counts the athlete's compatriots on the current squad, and `internationalFit`
 * — which `geography` delegates to for every international athlete — reads
 * `sameCountryRows`: the same country, the same 2026 roster rows, the same
 * number. The card would have shown one fact twice, once as `Location · a
 * compatriot here · +4.7` and once as a signal, with a line underneath saying
 * the signal was not an input to the score.
 *
 * Its own suite because it is the one kind whose licence was granted and then
 * withdrawn, and a future editor restoring it should have to delete tests that
 * say why.
 */
describe('CURRENT_SAME_COUNTRY is denied this surface', () => {
  it('is DENIED in the registry, not merely absent from a rule table', () => {
    expect(permissionsFor('CURRENT_SAME_COUNTRY').MATCHING_SUMMARY).toBe(PERMISSION.DENIED);
  });

  it('is not in the licensed set', () => {
    expect(LICENSED_KINDS).not.toContain('CURRENT_SAME_COUNTRY');
    expect(LICENSED_KINDS).toHaveLength(5);
  });

  it('drops a perfectly valid one', () => {
    // Not malformed, not stale, not below its floor. Denied on the merits.
    const ev = currentCountry();
    expect(ev.kind).toBe('CURRENT_SAME_COUNTRY');
    expect(ev.confidence).toBe(CONFIDENCE.HIGH);
    expect(matchingSummaryFor(resultOf([ev])).facts).toEqual([]);
  });

  it('drops it even when it is the only evidence there is', () => {
    // The card must go silent rather than reach for the next thing.
    const m = matchingSummaryFor(resultOf([currentCountry()]));
    expect(m.facts).toEqual([]);
    expect(m.hasEvidence).toBe(false);
    expect(m.programme.resolved).toBe(true);
  });

  it('leaks no trace of it into the payload', () => {
    const json = JSON.stringify(matchingSummaryFor(resultOf([currentCountry(), scarcity()])));
    expect(json).not.toContain('CURRENT_SAME_COUNTRY');
    expect(json).not.toContain('Joby Reid');
    expect(json).not.toContain('New Zealand');
  });

  it('is not promoted by being email-eligible', () => {
    expect(kindSpec('CURRENT_SAME_COUNTRY').emailEligible).toBe(true);
    expect(permissionsFor('CURRENT_SAME_COUNTRY').OUTREACH).toBe(PERMISSION.ALLOWED);
    expect(permissionsFor('CURRENT_SAME_COUNTRY').MATCHING_SUMMARY).toBe(PERMISSION.DENIED);
  });

  it('is not promoted by being visible to the operator', () => {
    expect(permissionsFor('CURRENT_SAME_COUNTRY').OPERATOR_EVIDENCE).toBe(PERMISSION.ALLOWED);
    expect(permissionsFor('CURRENT_SAME_COUNTRY').MATCHING_SUMMARY).toBe(PERMISSION.DENIED);
  });

  it('cannot be argued up by a generator asking for it', () => {
    const ev = defineEvidence('CURRENT_SAME_COUNTRY', {
      confidence: CONFIDENCE.HIGH,
      season: '2026',
      source: 'roster_players',
      permissions: { MATCHING_SUMMARY: PERMISSION.ALLOWED },
      data: { country: 'New Zealand', count: 2, names: ['A', 'B'] },
    });
    expect(ev.permissions.MATCHING_SUMMARY).toBe(PERMISSION.DENIED);
    expect(matchingSummaryFor(resultOf([ev])).facts).toEqual([]);
  });

  it('has no rule and no projection left behind', () => {
    // Dead qualification machinery for a denied kind is how a licence gets
    // restored by accident: the load-time guard would stay quiet, because it
    // only checks that every LICENSED kind has a rule.
    const src = readFileSync(new URL('./matchingSummary.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    expect(code).not.toContain('CURRENT_SAME_COUNTRY');
  });

  it('still belongs to the operator and the composer', () => {
    // The kind is unchanged everywhere else. Denying it here must not have
    // quietly deleted a true thing from the surfaces that may say it.
    expect(EVIDENCE_KINDS.CURRENT_SAME_COUNTRY).toBeTruthy();
    expect(kindSpec('CURRENT_SAME_COUNTRY').temporality).toBe('CURRENT');
    expect(kindSpec('CURRENT_SAME_COUNTRY').dedupeGroup).toBe('international-connection');
  });
});

describe('a QUALIFIED kind fails closed', () => {
  it('keeps a region arrival that names a position and countries', () => {
    const m = matchingSummaryFor(resultOf([regionArrival()]));
    expect(m.facts.map((f) => f.kind)).toEqual(['ARRIVAL_SAME_REGION_POSITION']);
  });

  it('drops a region arrival with no position', () => {
    // Q-AXIS. Without the position the claim is a bare regional count, which
    // is not what this kind licenses.
    expect(matchingSummaryFor(resultOf([regionArrival({ position: null })])).facts).toEqual([]);
  });

  it('drops a region arrival with no named countries', () => {
    // And never reconstructs them from the region key.
    expect(matchingSummaryFor(resultOf([regionArrival({ countries: [] })])).facts).toEqual([]);
  });

  it('never carries the region key even when it survives', () => {
    const [fact] = matchingSummaryFor(resultOf([regionArrival()])).facts;
    expect(JSON.stringify(fact)).not.toContain('OCEANIA');
    expect(fact.facts).not.toHaveProperty('region');
    expect(fact.facts.countries).toEqual(['Australia']);
  });

  it('keeps a historical country claim that is historical', () => {
    const [fact] = matchingSummaryFor(resultOf([historicalCountry()])).facts;
    expect(fact.qualification.temporality).toBe('HISTORICAL');
  });

  it('drops a historical country claim whose tense says otherwise', () => {
    // Q-TENSE, mutated on the serialized object only.
    //
    // This test carried more weight once CURRENT_SAME_COUNTRY was denied the
    // surface: it is now the ONLY thing standing between a current-roster
    // compatriot headcount and a match card, and that headcount is the figure
    // the geography criterion already scores.
    const wrong = { ...historicalCountry() };
    Object.defineProperty(wrong, 'temporality', { value: 'CURRENT', enumerable: true });
    expect(matchingSummaryFor(resultOf([wrong])).facts).toEqual([]);
  });

  it('drops anything below its own confidence floor', () => {
    const weak = defineEvidence('COACH_ARRIVAL_SAME_COUNTRY', {
      confidence: CONFIDENCE.LOW,
      season: '2026',
      source: 'recruiting_arrivals',
      describes: { seasons: ['2026'], seasonsUnread: [], n: 1, cohort: { country: 'New Zealand', coach: 'X' } },
      data: { country: 'New Zealand', coach: 'X', position: null, count: 1, seasons: ['2026'], arrivals: [] },
    });
    // Enforced as a floor. It is never used to rank what survives it.
    expect(matchingSummaryFor(resultOf([weak])).facts).toEqual([]);
  });
});

describe('support-only never leads', () => {
  it('puts a lead above a support item', () => {
    const m = matchingSummaryFor(resultOf([scarcity(), coachArrival()]));
    expect(m.facts.map((f) => f.kind))
      .toEqual(['COACH_ARRIVAL_SAME_COUNTRY', 'POSITION_GROUP_SCARCITY']);
  });

  it('still renders a support item when no lead survives', () => {
    // F1's decision: support-only evidence is better than an empty panel.
    const m = matchingSummaryFor(resultOf([scarcity()]));
    expect(m.facts.map((f) => f.kind)).toEqual(['POSITION_GROUP_SCARCITY']);
  });

  it('does not promote it by putting it first in the input', () => {
    const forward = matchingSummaryFor(resultOf([scarcity(), coachArrival()]));
    const reversed = matchingSummaryFor(resultOf([coachArrival(), scarcity()]));
    expect(forward.facts.map((f) => f.kind)).toEqual(reversed.facts.map((f) => f.kind));
  });

  it('exposes no lead flag, because order already says it', () => {
    const [fact] = matchingSummaryFor(resultOf([scarcity()])).facts;
    expect(Object.keys(fact).sort()).toEqual(['category', 'facts', 'kind', 'qualification']);
  });
});

describe('one connection is one fact', () => {
  it('collapses the same-group kinds to one', () => {
    // A coach arrival from New Zealand, a New Zealander on an earlier roster
    // and an arrival from the wider region are three statements about ONE
    // connection. Three rows beside a score would read as three independent
    // signals.
    //
    // `currentCountry` is in the input and is dropped a step earlier, by
    // licence rather than by dedupe — two separate mechanisms, and this test
    // is about the second.
    const m = matchingSummaryFor(resultOf([
      historicalCountry(), currentCountry(), coachArrival(), regionArrival(),
    ]));
    expect(m.facts).toHaveLength(1);
    expect(m.facts[0].kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
  });

  it('keeps a different group beside it', () => {
    const m = matchingSummaryFor(resultOf([historicalCountry(), coachArrival(), scarcity()]));
    expect(m.facts.map((f) => f.kind))
      .toEqual(['COACH_ARRIVAL_SAME_COUNTRY', 'POSITION_GROUP_SCARCITY']);
  });

  it('merges no counts and synthesises no claim while deduping', () => {
    const m = matchingSummaryFor(resultOf([historicalCountry(), currentCountry(), coachArrival()]));
    // The survivor is unchanged — one evidence object in, one out.
    expect(m.facts[0].facts.count).toBe(1);
    expect(m.facts[0].facts).not.toHaveProperty('names');
  });

  it('can never exceed two facts with the kinds licensed today', () => {
    // Only two dedupe groups are represented among the five licensed kinds, so
    // the cap of four is not reachable. Stated so the day a third group is
    // licensed, this test says what changed.
    const m = matchingSummaryFor(resultOf([
      historicalCountry(), currentCountry(), coachArrival(), regionArrival(), scarcity(),
    ]));
    expect(m.facts.length).toBeLessThanOrEqual(2);
    expect(MAX_FACTS).toBe(4);
  });
});

describe('order is deterministic and score-free', () => {
  it('does not change with input order', () => {
    const items = [scarcity(), regionArrival(), coachArrival()];
    const forward = matchingSummaryFor(resultOf(items)).facts.map((f) => f.kind);
    const reversed = matchingSummaryFor(resultOf([...items].reverse())).facts.map((f) => f.kind);
    expect(forward).toEqual(reversed);
  });

  it('takes no score, weight, contribution or criterion', () => {
    // Asserted on the interface: a parameter that does not exist cannot be
    // passed by a future caller in a hurry.
    expect(matchingSummaryFor).toHaveLength(1);
  });

  it('ignores anything score-shaped attached to the result', () => {
    const base = resultOf([coachArrival(), scarcity()]);
    const withScore = {
      ...base, match_score: 99, breakdown: [{ key: 'roster', contribution: 40 }], weights: { roster: 1 },
    };
    expect(matchingSummaryFor(withScore)).toEqual(matchingSummaryFor(base));
  });
});

describe('the payload carries what a card needs and nothing else', () => {
  const m = matchingSummaryFor(resultOf([coachArrival(), scarcity()]));

  it('has three top-level keys', () => {
    expect(Object.keys(m).sort()).toEqual(['facts', 'hasEvidence', 'programme']);
  });

  it('exposes no ranking or registry metadata', () => {
    const json = JSON.stringify(m);
    for (const leak of ['decisionClass', 'polarity', 'dedupeGroup', 'strength', 'specificity',
      'rank', 'diagnostics', 'generatedCount', 'minConfidence', 'confidence', 'tier',
      'requiresWindow', 'permissions', 'data', 'text', '_lead', '_order', '_group']) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it('carries no per-arrival array, which would reach the region another way', () => {
    expect(m.facts[0].facts).not.toHaveProperty('arrivals');
  });

  it('names no position on a coach claim, even when one is recorded', () => {
    const withPosition = matchingSummaryFor(resultOf([coachArrival({ position: 'DEFENSE' })]));
    expect(withPosition.facts[0].facts).not.toHaveProperty('position');
  });

  it('drops the contested squad size from scarcity', () => {
    const [fact] = matchingSummaryFor(resultOf([scarcity()])).facts;
    // The share expresses the denominator; the raw figure is the one that
    // disagrees with POSITION_GROUP_SIZE at 47 of 228 programmes.
    expect(fact.facts).not.toHaveProperty('squadSize');
    expect(fact.facts.share).toBe(0.11);
  });
});

describe('programme resolution is read, never inferred', () => {
  it('reports an unresolved name as unresolved with no facts', () => {
    const m = matchingSummaryFor(resultOf([], false));
    expect(m).toEqual({ programme: { resolved: false }, facts: [], hasEvidence: false });
  });

  it('separates a resolved programme with no signals from an unknown one', () => {
    const empty = matchingSummaryFor(resultOf([]));
    const unknown = matchingSummaryFor(resultOf([], false));
    expect(empty.facts).toEqual(unknown.facts);
    expect(empty.programme.resolved).toBe(true);
    expect(unknown.programme.resolved).toBe(false);
  });

  it('refuses a result that cannot say whether the name resolved', () => {
    expect(() => matchingSummaryFor({ all: [] })).toThrow(/programmeResolved/);
  });

  it('refuses a bare array', () => {
    expect(() => matchingSummaryFor([coachArrival()])).toThrow(/full `all` collection/);
  });

  it('reports hasEvidence for this panel only', () => {
    // False here does NOT mean "we hold nothing" — a programme with four
    // development measurements and no licensed pathway signal reports false,
    // which is right for a card and wrong for the Decision Evidence page.
    expect(matchingSummaryFor(resultOf([graduation()])).hasEvidence).toBe(false);
    expect(matchingSummaryFor(resultOf([coachArrival()])).hasEvidence).toBe(true);
  });
});
