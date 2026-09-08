/**
 * The operator fact-extract contract.
 *
 * Two properties matter more than the field-by-field checks: that the extractor
 * TRANSLATES rather than derives — every value traceable to the evidence object
 * it came from — and that it FAILS CLOSED, so a kind nobody has decided the
 * meaning of cannot reach a surface by falling back to raw internals.
 */

import { describe, it, expect } from 'vitest';
import { defineEvidence, EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, CONFIDENCE } from './kinds.js';
import { operatorFactsFor, operatorFactsForAll, qualificationFor, EXPOSURE } from './operatorFacts.js';

const mk = (kind, o = {}) => defineEvidence(kind, {
  source: 'roster_players',
  data: {},
  confidence: CONFIDENCE.HIGH,
  ...(EVIDENCE_KINDS[kind].requiresWindow
    ? { describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 8 } } : {}),
  ...(EVIDENCE_KINDS[kind].requiresComparison
    ? {
      comparison: {
        basis: 'mens-soccer pool', statistic: 'ladder-rank-1-median-minutes',
        poolSize: 920, band: 'at-or-below-p25',
      },
    } : {}),
  ...o,
});

describe('completeness and fail-closed', () => {
  it('records an explicit decision for every registry kind', () => {
    expect(Object.keys(EXPOSURE).sort()).toEqual([...EVIDENCE_KIND_NAMES].sort());
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(EXPOSURE[kind], kind).toBe('EXPOSED');
    }
  });

  it('extracts every registry kind without throwing', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      const out = operatorFactsFor(mk(kind));
      expect(out.kind, kind).toBe(kind);
      expect(out.facts, kind).toBeTypeOf('object');
    }
  });

  it('refuses an unknown kind rather than falling back to raw data', () => {
    const rogue = {
      kind: 'SOMETHING_NEW', decisionClass: 'FIT', polarity: 'POSITIVE',
      category: 'roster', tier: 'FACT', confidence: 'HIGH',
      data: { secret: 'internals' },
    };
    expect(() => operatorFactsFor(rogue)).toThrow(/No operator fact extractor/);
  });

  it('refuses a non-evidence argument', () => {
    expect(() => operatorFactsFor(null)).toThrow(/needs an evidence object/);
    expect(() => operatorFactsFor({})).toThrow(/needs an evidence object/);
  });
});

describe('translation, not derivation', () => {
  it('does not mutate the evidence it is given', () => {
    const ev = mk('POSITION_GRADUATION', {
      data: { position: 'DEFENSE', count: 3, names: ['A', 'B', 'C'], classYear: 2027 },
    });
    const before = JSON.stringify(ev);
    operatorFactsFor(ev);
    expect(JSON.stringify(ev)).toBe(before);
  });

  it('is pure — the same input gives an identical result', () => {
    const ev = mk('HISTORICAL_SAME_COUNTRY', {
      data: { country: 'New Zealand', count: 2, names: ['A', 'B'], seasons: ['2023'] },
    });
    expect(operatorFactsFor(ev)).toEqual(operatorFactsFor(ev));
  });

  it('copies arrays rather than sharing them with the evidence', () => {
    const ev = mk('POSITION_INTAKE_HISTORY', {
      data: { position: 'DEFENSE', count: 4, seasons: ['2024', '2025'] },
    });
    const out = operatorFactsFor(ev);
    expect(out.qualification.window.seasons).toEqual(['2024', '2025']);
    expect(out.qualification.window.seasons).not.toBe(ev.describes.seasons);
  });

  it('preserves the registry-owned semantics unchanged', () => {
    const out = operatorFactsFor(mk('POSITION_GRADUATION'));
    expect(out.decisionClass).toBe('OPENING');
    expect(out.polarity).toBe('POSITIVE');
    expect(out.category).toBe('roster');
    expect(out.qualification.tier).toBe('FACT');
    expect(out.qualification.temporality).toBe('CURRENT');
  });
});

describe('internals do not cross the boundary', () => {
  it('never emits the raw data object', () => {
    const ev = mk('POSITION_GRADUATION', {
      data: { position: 'DEFENSE', count: 1, names: [], classYear: 2027, secretInternal: 42 },
    });
    const json = JSON.stringify(operatorFactsFor(ev));
    expect(json).not.toContain('secretInternal');
    expect(operatorFactsFor(ev).facts).not.toHaveProperty('secretInternal');
  });

  it('drops recruiting coverage gates and identity machinery', () => {
    const ev = mk('COACH_ARRIVAL_SAME_COUNTRY', {
      data: {
        country: 'New Zealand', coach: 'Ali Simmons', count: 1, seasons: ['2025'],
        provenance: {
          coverageStatus: 'SUFFICIENT', coverageScope: 'COACH', fieldCoverage: 0.9,
          sportDataStatus: 'VALIDATED', specificity: 'COACH_COUNTRY', scope: 'COACH',
          possibleTransitions: 4, transitions: ['2024->2025'],
          supporting: [{
            playerName: 'Hayden Aish', season: '2025', country: 'New Zealand',
            position: 'MIDFIELD', coach: 'Ali Simmons', coachAttribution: 'ATTRIBUTED',
            identityMethod: 'EXACT', reconciledFrom: [], priorConfidence: 'NONE',
            entryType: 'EXPERIENCED', transition: '2024->2025',
          }],
        },
      },
    });
    const json = JSON.stringify(operatorFactsFor(ev));
    for (const internal of ['coverageStatus', 'fieldCoverage', 'sportDataStatus',
      'specificity', 'possibleTransitions', 'identityMethod', 'reconciledFrom',
      'priorConfidence', 'entryType']) {
      expect(json, internal).not.toContain(internal);
    }
    // The person and when they arrived DO survive — that is the timeline.
    expect(operatorFactsFor(ev).facts.arrivals[0].player).toBe('Hayden Aish');
    expect(operatorFactsFor(ev).facts.arrivals[0].season).toBe('2025');
  });

  it('drops ladder calculation flags but keeps the measurement', () => {
    const ev = mk('FRESHMAN_MINUTES_LADDER', {
      data: {
        seasonsObserved: 4,
        ladder: [{
          rank: 1, median: 827, low: 0, high: 1200, band: 'impact',
          agreement: 'tight', seasonsWithThisMany: 4, weighted: false, comparable: true,
        }],
      },
    });
    const out = operatorFactsFor(ev);
    expect(out.facts.ladder[0]).toEqual({
      rank: 1, median: 827, low: 0, high: 1200, band: 'impact',
      agreement: 'tight', seasonsWithThisMany: 4,
    });
    expect(JSON.stringify(out)).not.toContain('weighted');
    expect(JSON.stringify(out)).not.toContain('comparable');
  });

  it('drops ranking-policy metadata from the cohort ladder', () => {
    const ev = mk('ATHLETE_COHORT_LADDER', {
      data: {
        ladder: [], players: 12, seasonsObserved: 4,
        cohort: { position: null, origin: 'international', applied: true },
        claimFloor: 6, meetsClaimFloor: true, unreadSeasonsKnown: false,
        wholeIntakeLadder: [{ rank: 1, median: 827 }],
        positionHistory: { position: 'DEFENSE', openings: 3 },
      },
    });
    const json = JSON.stringify(operatorFactsFor(ev));
    // Selection-policy fields and a duplicate of another kind's ladder.
    for (const f of ['claimFloor', 'meetsClaimFloor', 'unreadSeasonsKnown',
      'wholeIntakeLadder', 'positionHistory']) {
      expect(json, f).not.toContain(f);
    }
  });
});

describe('qualification', () => {
  it('preserves a known-empty unread list', () => {
    const q = qualificationFor(mk('POSITION_INTAKE_HISTORY', {
      describes: { seasons: ['2024'], seasonsUnread: [], n: 3 },
    }));
    expect(q.window.seasonsUnread).toEqual([]);
  });

  it('preserves a populated unread list', () => {
    const q = qualificationFor(mk('COACH_CONTEXT', {
      describes: { seasons: ['2024', '2025'], seasonsUnread: ['2022', '2023'], n: 2 },
    }));
    expect(q.window.seasonsUnread).toEqual(['2022', '2023']);
  });

  it('preserves an UNKNOWN unread state as null, never as empty', () => {
    // The distinction the whole Stage C contract exists for.
    const q = qualificationFor(mk('ATHLETE_COHORT_LADDER', {
      describes: { seasons: ['2024'], seasonsUnread: null, n: 7 },
    }));
    expect(q.window.seasonsUnread).toBeNull();
    expect(q.window.seasonsUnread).not.toEqual([]);
  });

  it('preserves the sample and the applied cohort', () => {
    const q = qualificationFor(mk('ATHLETE_COHORT_LADDER', {
      describes: {
        seasons: ['2024', '2025'], seasonsUnread: null, n: 12,
        cohort: { position: 'DEFENSE', origin: 'international' },
      },
    }));
    expect(q.window.n).toBe(12);
    expect(q.window.cohort).toEqual({ position: 'DEFENSE', origin: 'international' });
  });

  it('preserves the comparison, and leaves percentile null', () => {
    const q = qualificationFor(mk('PROGRAMME_POOL_BENCHMARK'));
    expect(q.comparison.basis).toBe('mens-soccer pool');
    expect(q.comparison.statistic).toBe('ladder-rank-1-median-minutes');
    expect(q.comparison.poolSize).toBe(920);
    expect(q.comparison.band).toBe('at-or-below-p25');
    expect(q.comparison.percentile).toBeNull();
  });

  it('reports a freshness downgrade only when one happened', () => {
    const clean = qualificationFor(mk('POSITION_GRADUATION'));
    expect(clean.confidenceBeforeFreshness).toBeNull();
    const stale = qualificationFor(mk('POSITION_GRADUATION', {
      confidence: CONFIDENCE.HIGH,
      freshness: { state: 'ACCEPTABLE', ageDays: 90, reason: 'last read 90 days ago' },
    }));
    expect(stale.confidence).toBe('MEDIUM');
    expect(stale.confidenceBeforeFreshness).toBe('HIGH');
    expect(stale.freshness.reason).toContain('90 days');
  });

  it('carries a null sourceUrl rather than omitting the field', () => {
    // Null everywhere today. A surface must be able to tell "no link" from
    // "field absent" so it does not render a dead affordance.
    expect(qualificationFor(mk('POSITION_GRADUATION'))).toHaveProperty('sourceUrl', null);
  });
});

describe('roster facts support one grouped story', () => {
  const position = 'DEFENSE';
  const grad = mk('POSITION_GRADUATION', {
    data: { position, count: 3, names: ['A', 'B', 'C'], classYear: 2027 },
  });
  const starters = mk('POSITION_GRADUATION_STARTERS', {
    data: { position, count: 2, names: ['A', 'B'], basis: 'projected' },
  });
  const cliff = mk('ELIGIBILITY_CLIFF', {
    data: {
      position, players: 3, projectedMinutes: 2243, classYear: 2027,
      byYear: [{ year: 2026, total: 3692, byPosition: [{ position, minutes: 2243, players: 3 }] }],
    },
  });

  it('structures each of the three', () => {
    expect(operatorFactsFor(grad).facts).toEqual({
      position, count: 3, names: ['A', 'B', 'C'], beforeClassYear: 2027,
    });
    expect(operatorFactsFor(starters).facts).toEqual({
      position, starterCount: 2, names: ['A', 'B'], basis: 'projected',
    });
    expect(operatorFactsFor(cliff).facts.byYear[0]).toEqual({
      year: 2026, minutes: 2243, players: 3,
    });
  });

  it('gives a client enough to verify the three describe the same group', () => {
    const [g, s, c] = [grad, starters, cliff].map(operatorFactsFor);
    // Same position and the same arrival window, checkable without trusting
    // the grouping — which is what lets a client render one coherent reason.
    expect(new Set([g.facts.position, s.facts.position, c.facts.position]).size).toBe(1);
    expect(g.facts.beforeClassYear).toBe(c.facts.beforeClassYear);
    // And the starter count is a subset claim of the departure count.
    expect(s.facts.starterCount).toBeLessThanOrEqual(g.facts.count);
  });

  it('keeps the projected basis visible on the starter claim', () => {
    expect(operatorFactsFor(starters).facts.basis).toBe('projected');
    expect(operatorFactsFor(starters).qualification.temporality).toBe('PROJECTED');
  });

  it('structures the remaining roster kinds', () => {
    expect(operatorFactsFor(mk('POSITION_GROUP_SCARCITY', {
      data: { position, count: 3, classifiedSquad: 24, share: 0.125 },
    // H9: `classifiedSquad`, under its own name. It crossed as `squadSize`,
    // and the card said "in a squad of 24" about programmes carrying more.
    })).facts).toEqual({ position, count: 3, classifiedSquad: 24, share: 0.125 });

    expect(operatorFactsFor(mk('RETURNING_POSITION_DEPTH', {
      data: { position, returning: 2, groupSize: 9, classYear: 2027, unknownEligibility: 1 },
    })).facts).toEqual({
      position, returning: 2, groupSize: 9, beforeClassYear: 2027, unknownEligibility: 1,
    });
  });
});

describe('pathway facts keep the axes they were cut on', () => {
  it('keeps coach attribution and the country', () => {
    const f = operatorFactsFor(mk('COACH_ARRIVAL_SAME_COUNTRY', {
      data: {
        country: 'New Zealand', coach: 'Ali Simmons', position: null, count: 1,
        seasons: ['2025'], name: 'Hayden Aish', nameSeason: '2025',
        attributableTransitions: 3, transitionsWithArrival: 1,
      },
    })).facts;
    expect(f.country).toBe('New Zealand');
    expect(f.coach).toBe('Ali Simmons');
    expect(f.attributableIntakes).toBe(3);
    expect(f.namedArrival).toBe('Hayden Aish');
  });

  it('does not invent a position the evidence left null', () => {
    const f = operatorFactsFor(mk('COACH_ARRIVAL_SAME_COUNTRY', {
      data: { country: 'New Zealand', coach: 'X', position: null, count: 1 },
    })).facts;
    expect(f.position).toBeNull();
  });

  it('keeps country and position together where both were used', () => {
    const f = operatorFactsFor(mk('ARRIVAL_SAME_COUNTRY_POSITION', {
      data: {
        country: 'New Zealand', position: 'DEFENSE', count: 2,
        seasons: ['2024', '2025'], observedTransitions: 3,
      },
    })).facts;
    expect(f.country).toBe('New Zealand');
    expect(f.position).toBe('DEFENSE');
    expect(f.observedIntakes).toBe(3);
  });

  it('keeps the country a region item deliberately excluded', () => {
    const f = operatorFactsFor(mk('HISTORICAL_SAME_REGION', {
      data: {
        region: 'OCEANIA', countries: ['Australia'], athleteCountry: 'New Zealand',
        count: 1, names: ['A Peer'],
      },
    })).facts;
    expect(f.region).toBe('OCEANIA');
    expect(f.excludingCountry).toBe('New Zealand');
  });

  it('keeps the current/historical distinction on the two same-country kinds', () => {
    const current = operatorFactsFor(mk('CURRENT_SAME_COUNTRY', {
      data: { country: 'New Zealand', count: 1, names: ['A'] },
    }));
    const historical = operatorFactsFor(mk('HISTORICAL_SAME_COUNTRY', {
      data: { country: 'New Zealand', count: 1, names: ['A'], seasons: ['2023'] },
    }));
    expect(current.qualification.temporality).toBe('CURRENT');
    expect(historical.qualification.temporality).toBe('HISTORICAL');
    expect(historical.facts.seasonsPresent).toEqual(['2023']);
    expect(current.facts).not.toHaveProperty('seasonsPresent');
  });
});

describe('development facts carry no reading', () => {
  it('extracts the pattern as a measurement, keeping the key out of prose reach', () => {
    const f = operatorFactsFor(mk('PROGRAMME_DEVELOPMENT_PATTERN', {
      data: {
        verdict: 'continuity-through-change', verdictNote: null, seasonsObserved: 4,
        players: 24, dials: { n: 8, freshman: 10.8, newcomer: 47.5, returning: 41.7 },
        freshmanShareBySeason: [{
          season: '2022', shareOfSquadMinutes: 0.1738, intake: 8, measured: 8,
        }],
        spread: 20, step: null, coach: 'X', coachStillInPost: true,
      },
    })).facts;
    expect(f.verdictKey).toBe('continuity-through-change');
    expect(f.shareBySeason[0].shareOfSquadMinutes).toBeCloseTo(0.1738);
    expect(f.minuteShares.freshman).toBe(10.8);
  });

  it('emits no evaluative vocabulary for any development kind', () => {
    const evaluative = /\b(good|bad|strong|weak|favourable|unfavourable|poor|excellent)\b/i;
    for (const kind of ['PROGRAMME_DEVELOPMENT_PATTERN', 'FRESHMAN_MINUTES_LADDER',
      'ATHLETE_COHORT_LADDER', 'PROGRAMME_POOL_BENCHMARK']) {
      const json = JSON.stringify(operatorFactsFor(mk(kind)));
      expect(json, kind).not.toMatch(evaluative);
    }
  });

  it('keeps the applied cohort and the refusal that produced it', () => {
    const f = operatorFactsFor(mk('ATHLETE_COHORT_LADDER', {
      data: {
        ladder: [], players: 12, seasonsObserved: 4,
        cohort: { position: null, origin: 'international', applied: true },
        asked: { position: 'DEFENSE', origin: 'international' },
        refused: 'DEFENSE / international: only 1 in 1 season — too few to read separately',
        relaxed: 'international',
      },
    })).facts;
    expect(f.cohort).toEqual({ position: null, origin: 'international', applied: true });
    expect(f.asked).toEqual({ position: 'DEFENSE', origin: 'international' });
    expect(f.refused).toContain('too few to read separately');
    expect(f.players).toBe(12);
  });

  it('extracts the benchmark without approximating a percentile', () => {
    const out = operatorFactsFor(mk('PROGRAMME_POOL_BENCHMARK', {
      data: {
        programmeRank: 1, programmeMedian: 827,
        programmeBand: { low: 0, high: 1289, agreement: 'tight' },
        pool: { rank: 1, n: 770, p25: 901, median: 1118, p75: 1289 },
        band: 'at-or-below-p25', poolDials: { freshman: { p25: 0.3 } }, poolProgrammes: 920,
      },
    }));
    expect(out.facts.programmeMedian).toBe(827);
    expect(out.facts.pool).toEqual({ n: 770, p25: 901, median: 1118, p75: 1289 });
    expect(out.facts.band).toBe('at-or-below-p25');
    expect(out.qualification.comparison.percentile).toBeNull();
    // Pool-level dials are context for a different question.
    expect(JSON.stringify(out)).not.toContain('poolDials');
  });
});

describe('list extraction', () => {
  it('preserves order and extracts each item', () => {
    const items = [mk('POSITION_GRADUATION'), mk('ACADEMIC_FIT'), mk('CONFERENCE_TITLE')];
    const out = operatorFactsForAll(items);
    expect(out.map((o) => o.kind)).toEqual(['POSITION_GRADUATION', 'ACADEMIC_FIT', 'CONFERENCE_TITLE']);
  });

  it('handles an empty list', () => {
    expect(operatorFactsForAll([])).toEqual([]);
  });
});
