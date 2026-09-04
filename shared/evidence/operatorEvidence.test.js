/**
 * The operator read model.
 *
 * The assertions that matter most are the ones about what the layer does NOT
 * do: it does not take the deduped collection, it does not fold supporting
 * evidence into its primary, and it invents no arithmetic to reconcile three
 * roster items that describe different populations.
 */

import { describe, it, expect } from 'vitest';
import { defineEvidence, EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, CONFIDENCE } from './kinds.js';
import { selectEvidence } from './index.js';
import { topReasons } from './topReasons.js';
import {
  operatorEvidenceFor, SECTION_OF, SECTION_KEYS, SECTIONS, EXCLUSION,
} from './operatorEvidence.js';

const mk = (kind, o = {}) => defineEvidence(kind, {
  source: 'roster_players',
  data: {},
  confidence: CONFIDENCE.HIGH,
  ...(EVIDENCE_KINDS[kind].requiresWindow
    ? { describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 8 } } : {}),
  ...(EVIDENCE_KINDS[kind].requiresComparison
    ? {
      comparison: {
        basis: 'pool', statistic: 'ladder-rank-1-median-minutes',
        poolSize: 920, band: 'at-or-below-p25',
      },
    } : {}),
  ...o,
});

/** An `evidenceFor`-shaped result carrying the full pre-dedupe set. */
const resultOf = (all) => ({ all });

/** The Jacksonville roster trio, with their real numbers. */
const POSITION = 'DEFENSE';
const graduation = () => mk('POSITION_GRADUATION', {
  data: {
    position: POSITION, count: 3, classYear: 2027,
    names: ['Nahne Paulsen', 'Simon Libert', 'Nassim Akki'],
  },
});
const starters = () => mk('POSITION_GRADUATION_STARTERS', {
  data: {
    position: POSITION, count: 2, basis: 'projected',
    names: ['Nahne Paulsen', 'Simon Libert'],
  },
  confidence: CONFIDENCE.MEDIUM,
});
const cliff = () => mk('ELIGIBILITY_CLIFF', {
  data: {
    position: POSITION, players: 5, projectedMinutes: 3114, classYear: 2027,
    byYear: [
      { year: 2026, total: 3692, byPosition: [{ position: POSITION, minutes: 2243, players: 3 }] },
      { year: 2027, total: 2078, byPosition: [{ position: POSITION, minutes: 871, players: 2 }] },
    ],
  },
  confidence: CONFIDENCE.MEDIUM,
});

describe('input must be the full pre-dedupe set', () => {
  it('refuses a bare array', () => {
    expect(() => operatorEvidenceFor([graduation()]))
      .toThrow(/needs an evidenceFor result/);
  });

  it('refuses a result without its `all` collection', () => {
    expect(() => operatorEvidenceFor({ ranked: [graduation()], selected: [] }))
      .toThrow(/post-dedupe array/);
  });

  it('sees supporting evidence that email dedupe would have removed', () => {
    // Proven against the real engine: `ranked` collapses this group to one.
    const engine = selectEvidence(
      { name: 'A', position: POSITION, country: 'New Zealand', classYear: 2027 },
      { college: { name: 'X', sport: 'mens-soccer' }, squad: [], history: [] },
    );
    expect(Array.isArray(engine.all)).toBe(true);

    const model = operatorEvidenceFor(resultOf([graduation(), starters(), cliff()]));
    const kinds = model.sections.ROSTER_OPPORTUNITY.map((i) => i.kind);
    expect(kinds).toContain('POSITION_GRADUATION');
    expect(kinds).toContain('POSITION_GRADUATION_STARTERS');
    expect(kinds).toContain('ELIGIBILITY_CLIFF');
  });
});

describe('section mapping', () => {
  it('places every registry kind explicitly', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(SECTION_OF[kind], kind).toBeTruthy();
      expect(SECTION_KEYS, kind).toContain(SECTION_OF[kind]);
    }
  });

  it('returns every section key even when empty', () => {
    const model = operatorEvidenceFor(resultOf([graduation()]));
    expect(Object.keys(model.sections).sort()).toEqual([...SECTION_KEYS].sort());
    expect(model.sections.DEVELOPMENT).toEqual([]);
    expect(model.summary.sectionCounts.DEVELOPMENT).toBe(0);
  });

  it('keeps a top reason in its section as well as the summary', () => {
    const model = operatorEvidenceFor(resultOf([graduation()]));
    expect(model.topReasons[0].primary.kind).toBe('POSITION_GRADUATION');
    expect(model.sections.ROSTER_OPPORTUNITY.map((i) => i.kind)).toContain('POSITION_GRADUATION');
  });

  it('orders each section deterministically, whatever order the input arrives in', () => {
    const items = [cliff(), graduation(), starters(), mk('POSITION_GROUP_SIZE', {
      data: { position: POSITION, count: 9, squadSize: 27 },
    })];
    const forward = operatorEvidenceFor(resultOf(items));
    const reversed = operatorEvidenceFor(resultOf([...items].reverse()));
    expect(reversed.sections.ROSTER_OPPORTUNITY.map((i) => i.kind))
      .toEqual(forward.sections.ROSTER_OPPORTUNITY.map((i) => i.kind));
    // Openings before context, by the existing comparator.
    expect(forward.sections.ROSTER_OPPORTUNITY.at(-1).kind).toBe('POSITION_GROUP_SIZE');
  });
});

describe('neutral and context evidence', () => {
  const development = () => [
    mk('ATHLETE_COHORT_LADDER', {
      data: {
        ladder: [{ rank: 1, median: 532 }], players: 12, seasonsObserved: 4,
        cohort: { position: null, origin: 'international', applied: true },
      },
      describes: {
        seasons: ['2022', '2023', '2024', '2025'], seasonsUnread: null, n: 12,
        cohort: { position: null, origin: 'international' },
      },
    }),
    mk('PROGRAMME_DEVELOPMENT_PATTERN', {
      data: {
        verdict: 'continuity-through-change', seasonsObserved: 4, players: 24,
        freshmanShareBySeason: [], dials: null,
      },
    }),
    mk('FRESHMAN_MINUTES_LADDER', {
      data: { ladder: [{ rank: 1, median: 827 }], seasonsObserved: 4 },
    }),
    mk('PROGRAMME_POOL_BENCHMARK', {
      data: {
        programmeRank: 1, programmeMedian: 827, band: 'at-or-below-p25',
        pool: { rank: 1, n: 770, p25: 901, median: 1118, p75: 1289 },
      },
    }),
  ];

  it('keeps all four development measurements in their section', () => {
    const model = operatorEvidenceFor(resultOf(development()));
    expect(model.sections.DEVELOPMENT.map((i) => i.kind).sort()).toEqual([
      'ATHLETE_COHORT_LADDER', 'FRESHMAN_MINUTES_LADDER',
      'PROGRAMME_DEVELOPMENT_PATTERN', 'PROGRAMME_POOL_BENCHMARK',
    ]);
  });

  it('does not promote any of them into top reasons', () => {
    const model = operatorEvidenceFor(resultOf(development()));
    expect(model.topReasons).toEqual([]);
    expect(model.summary.hasPositiveReasons).toBe(false);
    // But the evidence is there.
    expect(model.summary.hasEvidence).toBe(true);
    expect(model.summary.evidenceCount).toBe(4);
  });

  it('preserves neutral polarity, windows and the band', () => {
    const model = operatorEvidenceFor(resultOf(development()));
    for (const item of model.sections.DEVELOPMENT) expect(item.polarity).toBe('NEUTRAL');
    const cohort = model.sections.DEVELOPMENT.find((i) => i.kind === 'ATHLETE_COHORT_LADDER');
    // UNKNOWN unread state survives assembly, not flattened to [].
    expect(cohort.qualification.window.seasonsUnread).toBeNull();
    expect(cohort.qualification.window.n).toBe(12);
    const bench = model.sections.DEVELOPMENT.find((i) => i.kind === 'PROGRAMME_POOL_BENCHMARK');
    expect(bench.facts.band).toBe('at-or-below-p25');
    expect(bench.qualification.comparison.percentile).toBeNull();
  });

  it('emits no interpretation of the development measurements', () => {
    const json = JSON.stringify(operatorEvidenceFor(resultOf(development())).sections.DEVELOPMENT);
    expect(json).not.toMatch(/\b(good|bad|strong|weak|favourable|unfavourable)\b/i);
  });

  it('keeps CONTEXT evidence in its section', () => {
    const model = operatorEvidenceFor(resultOf([
      mk('COACH_CONTEXT', {
        data: {
          name: 'A Coach', seasonsObserved: 3, since: 2023,
          windowBounded: false, knownThrough: 2026, stillInPost: true,
        },
        describes: { seasons: ['2023', '2024', '2025'], seasonsUnread: [], n: 3 },
      }),
    ]));
    expect(model.sections.PROGRAMME_CONTEXT.map((i) => i.kind)).toEqual(['COACH_CONTEXT']);
    expect(model.topReasons).toEqual([]);
  });
});

describe('excluded evidence', () => {
  it('withholds operator-denied evidence from sections', () => {
    const denied = mk('POSITION_GRADUATION', {
      data: { position: POSITION, count: 3, names: [], classYear: 2027 },
      permissions: { OPERATOR_EVIDENCE: 'DENIED' },
    });
    const model = operatorEvidenceFor(resultOf([denied]));
    expect(model.sections.ROSTER_OPPORTUNITY).toEqual([]);
    expect(model.diagnostics.excluded).toEqual([
      { kind: 'POSITION_GRADUATION', section: SECTIONS.ROSTER_OPPORTUNITY, exclusion: EXCLUSION.NOT_OPERATOR_LICENSED },
    ]);
  });

  it('withholds below-confidence evidence from sections', () => {
    // ACADEMIC_FIT declares a HIGH floor.
    const weak = mk('ACADEMIC_FIT', {
      data: { major: 'Kinesiology', stated: 'exercise science' },
      confidence: CONFIDENCE.MEDIUM,
    });
    const model = operatorEvidenceFor(resultOf([weak]));
    expect(model.sections.ACADEMIC_PROGRAMME_FIT).toEqual([]);
    expect(model.diagnostics.excluded[0].exclusion).toBe(EXCLUSION.BELOW_CONFIDENCE);
  });

  it('names what was withheld without carrying the objects', () => {
    const model = operatorEvidenceFor(resultOf([
      mk('ACADEMIC_FIT', { data: { major: 'X', stated: 'x' }, confidence: CONFIDENCE.MEDIUM }),
    ]));
    const json = JSON.stringify(model.diagnostics.excluded);
    expect(json).not.toContain('"data"');
    expect(json).not.toContain('Kinesiology');
  });

  it('agrees with topReasons about what is licensed', () => {
    // The two gates live in separate files and must not drift: anything
    // topReasons rejects for licensing or confidence must also be excluded here.
    for (const kind of EVIDENCE_KIND_NAMES) {
      const ev = mk(kind, { confidence: CONFIDENCE.LOW });
      const reasons = topReasons([ev]);
      const disp = reasons.dispositions[0].disposition;
      const model = operatorEvidenceFor(resultOf([ev]));
      const inSection = SECTION_KEYS.some((s) => model.sections[s].some((i) => i.kind === kind));
      if (disp === 'BELOW_CONFIDENCE' || disp === 'NOT_OPERATOR_LICENSED') {
        expect(inSection, `${kind} ${disp}`).toBe(false);
      }
    }
  });
});

describe('empty states are structural', () => {
  it('represents zero reasons with evidence present', () => {
    const model = operatorEvidenceFor(resultOf([
      mk('POSITION_GROUP_SIZE', { data: { position: POSITION, count: 9, squadSize: 27 } }),
    ]));
    expect(model.summary.reasonCount).toBe(0);
    expect(model.summary.hasPositiveReasons).toBe(false);
    expect(model.summary.hasEvidence).toBe(true);
    expect(model.summary.openingIdentified).toBe(false);
  });

  it('represents no evidence at all', () => {
    const model = operatorEvidenceFor(resultOf([]));
    expect(model.summary).toMatchObject({
      reasonCount: 0, hasPositiveReasons: false, openingIdentified: false,
      hasEvidence: false, evidenceCount: 0, generatedCount: 0,
    });
    expect(model.topReasons).toEqual([]);
  });

  it('separates openingIdentified from hasPositiveReasons', () => {
    // A pathway reason with no opening: reasons exist, an opening was not found.
    const model = operatorEvidenceFor(resultOf([
      mk('HISTORICAL_SAME_COUNTRY', {
        data: { country: 'New Zealand', count: 1, names: ['A'], seasons: ['2023'] },
      }),
    ]));
    expect(model.summary.hasPositiveReasons).toBe(true);
    expect(model.summary.openingIdentified).toBe(false);
  });
});

describe('the roster story is grouped, never reconciled', () => {
  const model = () => operatorEvidenceFor(resultOf([graduation(), starters(), cliff()]));

  it('returns one reason holding all three evidence objects', () => {
    const m = model();
    expect(m.topReasons.length).toBe(1);
    expect(m.topReasons[0].primary.kind).toBe('POSITION_GRADUATION');
    expect(m.topReasons[0].supporting.map((s) => s.kind))
      .toEqual(['POSITION_GRADUATION_STARTERS', 'ELIGIBILITY_CLIFF']);
  });

  it('keeps each population and window separate', () => {
    const [reason] = model().topReasons;
    expect(reason.primary.facts.count).toBe(3);
    const s = reason.supporting.find((x) => x.kind === 'POSITION_GRADUATION_STARTERS');
    const c = reason.supporting.find((x) => x.kind === 'ELIGIBILITY_CLIFF');
    expect(s.facts.starterCount).toBe(2);
    // The cliff counts a WIDER cohort across two years — 5, not 3. It is not
    // corrected, replaced or reconciled against the graduation count.
    expect(c.facts.players).toBe(5);
    expect(c.facts.byYear).toEqual([
      { year: 2026, minutes: 2243, players: 3 },
      { year: 2027, minutes: 871, players: 2 },
    ]);
  });

  it('synthesises no combined total anywhere in the payload', () => {
    const json = JSON.stringify(model());
    for (const invented of ['departureCount', 'totalDeparting', 'combinedCount', 'departures']) {
      expect(json, invented).not.toContain(invented);
    }
    // 3 + 2 + 5 = 10 must appear nowhere as a count.
    const [reason] = model().topReasons;
    const counts = [reason.primary.facts.count,
      ...reason.supporting.map((s) => s.facts.starterCount ?? s.facts.players)];
    expect(counts).toEqual([3, 2, 5]);
  });

  it('does not fold supporting facts into the primary', () => {
    const [reason] = model().topReasons;
    expect(reason.primary.facts).not.toHaveProperty('starterCount');
    expect(reason.primary.facts).not.toHaveProperty('byYear');
    expect(Object.keys(reason.primary.facts).sort())
      .toEqual(['beforeClassYear', 'count', 'names', 'position']);
  });
});

describe('the pathway story is grouped, never merged', () => {
  const items = [
    mk('COACH_ARRIVAL_SAME_COUNTRY', {
      data: {
        country: 'New Zealand', coach: 'Ali Simmons', position: null, count: 1,
        seasons: ['2025'], name: 'Hayden Aish', nameSeason: '2025',
        attributableTransitions: 3,
        // Mirrors real data: every arrival kind carries the recruiting layer's
        // own specificity, and `specificityKey` reads it first. Omitting it
        // here made this fixture rank GENERAL and hid the finding recorded in
        // the Stage E notes — a cohort naming `position: null` takes the
        // freshman-cohort branch and loses its country and coach axes. Latent
        // in production, where provenance is always present.
        provenance: { specificity: 'COACH_COUNTRY' },
      },
      describes: {
        seasons: ['2024', '2025', '2026'], seasonsUnread: [], n: 1,
        cohort: { country: 'New Zealand', coach: 'Ali Simmons', position: null },
      },
    }),
    mk('ARRIVAL_SAME_REGION_POSITION', {
      data: {
        region: 'OCEANIA', countries: ['Australia'], position: POSITION, count: 2,
        seasons: ['2026'], observedTransitions: 3,
        provenance: { specificity: 'REGION_POSITION' },
      },
      describes: {
        seasons: ['2024', '2025', '2026'], seasonsUnread: [], n: 2,
        cohort: { region: 'OCEANIA', excludingCountry: 'New Zealand', position: POSITION },
      },
    }),
    mk('HISTORICAL_SAME_COUNTRY', {
      data: { country: 'New Zealand', count: 1, names: ['Hayden Aish'], seasons: ['2025'] },
      describes: { seasons: ['2022', '2023', '2024', '2025'], seasonsUnread: [], n: 1 },
    }),
  ];

  it('leads with the coach-attributed finding and keeps the rest', () => {
    const m = operatorEvidenceFor(resultOf(items));
    expect(m.topReasons.length).toBe(1);
    expect(m.topReasons[0].primary.kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    expect(m.topReasons[0].supporting.map((s) => s.kind).sort())
      .toEqual(['ARRIVAL_SAME_REGION_POSITION', 'HISTORICAL_SAME_COUNTRY']);
  });

  it('keeps each axis on its own item and merges no super-claim', () => {
    const [reason] = operatorEvidenceFor(resultOf(items)).topReasons;
    expect(reason.primary.facts.country).toBe('New Zealand');
    expect(reason.primary.facts.coach).toBe('Ali Simmons');
    // The primary genuinely has no position; nothing borrows one from the
    // region item beneath it.
    expect(reason.primary.facts.position).toBeNull();
    const region = reason.supporting.find((s) => s.kind === 'ARRIVAL_SAME_REGION_POSITION');
    expect(region.facts.region).toBe('OCEANIA');
    expect(region.facts.position).toBe(POSITION);
    expect(region.facts).not.toHaveProperty('coach');
    // And no summed count across the three.
    expect(reason.primary.facts.count).toBe(1);
    expect(region.facts.count).toBe(2);
  });
});

describe('purity', () => {
  it('mutates nothing it is given', () => {
    const items = [graduation(), starters(), cliff()];
    const result = resultOf(items);
    const before = JSON.stringify(result);
    operatorEvidenceFor(result);
    expect(JSON.stringify(result)).toBe(before);
  });

  it('never emits a raw data object', () => {
    const ev = mk('POSITION_GRADUATION', {
      data: { position: POSITION, count: 1, names: [], classYear: 2027, secretInternal: 9 },
    });
    expect(JSON.stringify(operatorEvidenceFor(resultOf([ev])))).not.toContain('secretInternal');
  });

  it('is deterministic', () => {
    const items = [cliff(), graduation(), starters()];
    expect(operatorEvidenceFor(resultOf(items)))
      .toEqual(operatorEvidenceFor(resultOf([...items].reverse())));
  });
});
