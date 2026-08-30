/**
 * The lifecycle model, asserted without producing a PDF.
 *
 * The things worth testing here are the refusals, not the arithmetic. Every
 * figure this layer publishes has a way of being wrong that looks exactly like
 * being right — a rate over a cohort that could not yet have reached the
 * threshold, a zero drawn from unpublished minutes, an ambiguous candidate
 * promoted to a destination, a position sample silently widened to the
 * programme — and each of those is a test below.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLifecycleSummary, programmeDevelopment, programmeContinuity, programmeDepartures,
  destinationGate, positionMovement, timeToStarter, representativeTrajectories, bandAgainst,
  DESTINATION_SUPPRESSED_DIVISIONS, DIVISION_COVERAGE_FLOOR, MIN_OBSERVED_DESTINATIONS,
  MIN_POSITION_DESTINATIONS,
} from './lifecycleSummary.js';
import { buildLifecycles, firstYearCohort } from '../lifecycle/lifecycle.js';
import { developmentSummary } from '../lifecycle/development.js';
import { MATCH_STATUS } from '../lifecycle/movement.js';
import { EXIT_KIND } from '../lifecycle/continuity.js';

/** Distinct names. `nameKey` strips digits, so "Player 1" and "Player 2" are one person. */
const tag = (i) => 'abcdefghijklmnopqrstuvwxyz'[i % 26].repeat(1 + Math.floor(i / 26))
  .replace(/^./, (c) => c.toUpperCase());

let id = 0;
/** One roster row. Every field a caller does not state is stated here. */
const row = (o = {}) => ({
  id: `r${(id += 1)}`,
  college_name: o.college ?? 'Home',
  sport: 'mens-soccer',
  division: o.division ?? 'NCAA D1',
  season: String(o.season ?? '2022'),
  player_name: o.name ?? `Player ${id}`,
  class_year_label: 'class' in o ? o.class : 'Fr.',
  position: o.position ?? 'MIDFIELD',
  minutes_played: 'minutes' in o ? o.minutes : 900,
  games_played: 'games' in o ? o.games : 18,
  games_started: o.starts ?? 15,
  estimated_graduation_year: o.grad ?? null,
  nationality: o.nationality ?? 'USA',
  hometown: o.hometown ?? null,
  country: null,
  eligibility_end_year: o.eligibility ?? null,
  prior_programme: o.prior ?? null,
});

/** A career: one row per season, minutes given per season. */
const career = (name, minutesBySeason, o = {}) => Object.entries(minutesBySeason)
  .map(([season, minutes], i) => row({
    ...o, name, season, minutes, class: ['Fr.', 'So.', 'Jr.', 'Sr.'][i] ?? 'Sr.',
  }));

const POOL = {
  seasons: ['2022', '2023', '2024', '2025', '2026'],
  lastSeason: '2026',
  lastMeasuredSeason: '2025',
  movementByProgramme: new Map(),
  destinationCoverage: { 'NCAA D1': { coverage: 0.2 }, 'NCAA D2': { coverage: 0.09 }, 'NCAA D3': { coverage: 0.03 } },
  benchmarks: {
    overall: {
      programmes: 100,
      retention: { n: 100, p10: 0.42, p25: 0.5, median: 0.57, p75: 0.62, p90: 0.68 },
      starterRetention: { n: 90, p25: 0.5, median: 0.57, p75: 0.64 },
      everStarter: { n: 90, p25: 0.29, median: 0.38, p75: 0.45 },
      starterByYear: [{ p25: 0.17, median: 0.24, p75: 0.31 }, { p25: 0.27, median: 0.36, p75: 0.44 },
        { p25: 0.31, median: 0.4, p75: 0.5 }],
      retentionAfter: [{ p25: 0.55, median: 0.67, p75: 0.78 }, { p25: 0.33, median: 0.47, p75: 0.61 },
        { p25: 0.22, median: 0.36, p75: 0.5 }],
    },
    byDivision: {},
  },
};

// ---------------------------------------------------------------------------

describe('the observation horizon', () => {
  /** Twelve first-years who arrived in 2025 and have played one season. */
  const recent = () => Array.from({ length: 12 }, (_, i) => row({
    name: `Recent ${tag(i)}`, season: '2025', minutes: 100,
  }));

  it('does not count a recent arrival as having failed to reach a later year', () => {
    const d = programmeDevelopment(recent(), { ...POOL, division: 'NCAA D1' });
    expect(d.byYear[0].denominator).toBe(12);      // year one is answerable
    expect(d.byYear[1].denominator).toBe(0);       // year two is not
    expect(d.byYear[2].denominator).toBe(0);
    expect(d.byYear[1].share).toBeNull();
    expect(d.byYear[1].suppressed).toBe(true);
  });

  it('keeps two horizons apart: minutes end in 2025, the roster runs to 2026', () => {
    // A 2024 arrival can be asked "still here after two years" — the 2026
    // roster answers it — but not "reached 600 by year three", which needs a
    // season with minutes.
    const rows = Array.from({ length: 10 }, (_, i) => [
      row({ name: `A${tag(i)} Player`, season: '2024', minutes: 100 }),
      row({ name: `A${tag(i)} Player`, season: '2025', minutes: 200, class: 'So.' }),
      row({ name: `A${tag(i)} Player`, season: '2026', minutes: null, games: null, class: 'Jr.' }),
    ]).flat();
    const d = programmeDevelopment(rows, { ...POOL, division: 'NCAA D1' });
    expect(d.byYear[2].denominator).toBe(0);           // no third measured season
    expect(d.stillHereByYear[1].denominator).toBe(10); // but the roster shows them
    expect(d.stillHereByYear[1].stillObserved).toBe(10);
  });

  it('gives time-to-600 a denominator of players who could have had three seasons', () => {
    const trajectories = developmentSummary(firstYearCohort(buildLifecycles([
      ...career('Early', { 2022: 100, 2023: 700 }),
      ...career('Also Early', { 2023: 50, 2024: 80, 2025: 90 }),
      ...career('Too Recent', { 2025: 1200 }),
    ]))).trajectories;
    const t = timeToStarter(trajectories, { lastMeasuredSeason: '2025' });
    expect(t.entrySeasonsUpTo).toBe('2023');
    expect(t.denominator).toBe(2);                 // the 2025 arrival is in neither column
    expect(t.year2).toBe(1);                       // Early reached it in season two
    expect(t.notWithinThree).toBe(1);              // Also Early did not, in three seasons
  });
});

describe('unpublished minutes are never a zero', () => {
  /** A roster that prints appearances and leaves the minutes column empty. */
  const noMinutes = () => Array.from({ length: 20 }, (_, i) => [
    row({ name: `P${tag(i)} Player`, season: '2022', minutes: 0, games: 14 }),
    row({ name: `P${tag(i)} Player`, season: '2023', minutes: 0, games: 16, class: 'So.' }),
  ]).flat();

  it('refuses every share rather than reporting 0% reaching a starter season', () => {
    const d = programmeDevelopment(noMinutes(), { ...POOL, division: 'NCAA D1' });
    expect(d.minutesCoverage.readable).toBe(false);
    expect(d.minutesCoverage.measured).toBe(0);
    for (const y of d.byYear) expect(y.share).toBeNull();
    expect(d.everStarter.share).toBeNull();
    expect(d.everStarter.band).toBe('unavailable');
    // The counts survive. "We followed 20 and could read none of them" is the
    // finding; a 0% would have been a claim about the programme.
    expect(d.byYear[0].denominator).toBe(20);
  });

  it('keeps a real zero, where the same row says zero games', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({
      name: `P${tag(i)} Player`, season: '2022', minutes: i < 4 ? 0 : 800, games: i < 4 ? 0 : 18,
    }));
    const d = programmeDevelopment(rows, { ...POOL, division: 'NCAA D1' });
    expect(d.minutesCoverage.readable).toBe(true);
    expect(d.byYear[0].reached).toBe(16);
    expect(d.byYear[0].denominator).toBe(20);
  });
});

describe('roster continuity', () => {
  /** Twelve players in 2022, eight of whom return in 2023. */
  const rows = () => [
    ...Array.from({ length: 12 }, (_, i) => row({ name: `P${tag(i)} Player`, season: '2022', class: 'So.' })),
    ...Array.from({ length: 8 }, (_, i) => row({ name: `P${tag(i)} Player`, season: '2023', class: 'Jr.' })),
    ...Array.from({ length: 8 }, (_, i) => row({ name: `Q${tag(i)} Player`, season: '2023', class: 'So.' })),
  ];

  it('divides returns by the players who could return, not by the roster', () => {
    const c = programmeContinuity(rows(), { ...POOL, division: 'NCAA D1' });
    // Only the 2022→2023 transition is readable: no 2024 roster exists, so the
    // sixteen 2023 player-seasons prove nothing either way.
    expect(c.returnable).toBe(12);
    expect(c.returned).toBe(8);
    expect(c.unreadable).toBe(16);
  });

  it('does not read absence as departure where the next roster is missing', () => {
    // Only 2022 exists, so nothing about 2023 can be read at all.
    const only2022 = Array.from({ length: 12 }, (_, i) => row({ name: `P${tag(i)} Player`, season: '2022' }));
    const c = programmeContinuity(only2022, { ...POOL, division: 'NCAA D1' });
    expect(c.returnable).toBe(0);
    expect(c.unreadable).toBe(12);
    expect(c.retention).toBeNull();
  });

  it('separates an expected exit from an early one on the class label alone', () => {
    const rows2 = [
      ...Array.from({ length: 6 }, (_, i) => row({ name: `Sr${tag(i)} Player`, season: '2022', class: 'Sr.' })),
      ...Array.from({ length: 6 }, (_, i) => row({ name: `So${tag(i)} Player`, season: '2022', class: 'So.' })),
      row({ name: 'Stayer', season: '2022', class: 'Fr.' }),
      row({ name: 'Stayer', season: '2023', class: 'So.' }),
    ];
    const c = programmeContinuity(rows2, { ...POOL, division: 'NCAA D1' });
    expect(c.exits.expected).toBe(6);
    expect(c.exits.early).toBe(6);
    expect(c.exits.unknownClass).toBe(0);
  });

  it('ignores eligibility_end_year entirely, even when it contradicts the label', () => {
    // A senior with a year of eligibility recorded is still an expected exit:
    // the column is a fixed step from the class label, not evidence.
    const rows3 = [
      row({ name: 'Senior', season: '2022', class: 'Sr.', eligibility: 2024 }),
      row({ name: 'Stayer', season: '2022', class: 'Fr.' }),
      row({ name: 'Stayer', season: '2023', class: 'So.' }),
    ];
    const c = programmeContinuity(rows3, { ...POOL, division: 'NCAA D1' });
    expect(c.exits.expected).toBe(1);
    expect(c.exits.early).toBe(0);
  });

  it('suppresses the rate, not the counts, on a thin sample', () => {
    const thin = [
      row({ name: 'A', season: '2022' }), row({ name: 'A', season: '2023' }),
      row({ name: 'B', season: '2022' }), row({ name: 'B', season: '2023' }),
    ];
    const c = programmeContinuity(thin, { ...POOL, division: 'NCAA D1' });
    expect(c.returnable).toBe(2);
    expect(c.retention).toBeNull();
    expect(c.retentionSuppressed).toBe(true);
    expect(c.returned).toBe(2);
  });
});

// ---------------------------------------------------------------------------

const movement = (o = {}) => ({
  name: o.name ?? 'Mover',
  playerKey: o.name ?? 'mover',
  sourceProgramme: 'Home',
  sourceSeason: o.season ?? '2024',
  sourceDivision: 'NCAA D1',
  canonicalPosition: o.position ?? 'MIDFIELD',
  classLabel: o.class ?? 'So.',
  exitKind: o.exitKind ?? EXIT_KIND.EARLY_EXIT,
  priorRole: {
    season: o.season ?? '2024',
    minutes: 'minutes' in o ? o.minutes : 800,
    roleBand: o.band ?? '600+',
    measured: !('minutes' in o) || o.minutes != null,
  },
  status: o.status ?? MATCH_STATUS.MATCH_A,
  signals: { hometown: true, position: true, classProgression: true, graduationYear: false, priorProgramme: false },
  signalCount: 3,
  commonName: false,
  candidates: o.candidates ?? ['Away'],
  destinationProgramme: o.destination === null ? null : o.destination ?? 'Away',
  destinationSeason: '2025',
  destinationDivision: o.destinationDivision ?? 'NCAA D1',
  comparison: o.comparison === null ? null : {
    division: { movement: 'divisionMove' in o ? o.divisionMove : 'DIVISION_SAME' },
    soccerScore: { band: 'football' in o ? o.football : 'LOWER_FOOTBALL_RATING', delta: -20 },
    academicRating: { band: 'academic' in o ? o.academic : 'HIGHER_ACADEMIC_RATING', delta: 4 },
    nationalRanking: { band: 'SIMILAR_NATIONAL_RANKING', delta: 3 },
  },
  outcome: o.outcome === null ? null : { minutes: 400, measured: true, roleBand: '200-599', change: 'PLAYED_LESS' },
});

const ambiguous = (o = {}) => movement({
  ...o, status: MATCH_STATUS.AMBIGUOUS, destination: null, comparison: null, outcome: null,
  candidates: ['One', 'Two'],
});
const unresolved = (o = {}) => movement({
  ...o, status: MATCH_STATUS.UNRESOLVED, destination: null, comparison: null, outcome: null,
  candidates: [],
});

const continuityStub = (o = {}) => ({ exits: { expected: o.expected ?? 4, early: o.early ?? 10, unknownClass: 0 } });

describe('the destination gate', () => {
  const many = () => Array.from({ length: 12 }, (_, i) => movement({ name: `M ${i}` }));

  it('never renders destinations for a suppressed division, however large the sample', () => {
    for (const division of DESTINATION_SUPPRESSED_DIVISIONS) {
      const g = destinationGate(many(), POOL, division);
      expect(g.allowed).toBe(false);
      expect(g.reason).toBe('division-suppressed');
      expect(g.note).toContain(division);
    }
  });

  it('refuses a division whose pool coverage is under the floor', () => {
    const pool = { ...POOL, destinationCoverage: { Thin: { coverage: DIVISION_COVERAGE_FLOOR - 0.001 } } };
    const g = destinationGate(many(), pool, 'Thin');
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('division-coverage-below-floor');
  });

  it('refuses a division the pool has never seen', () => {
    expect(destinationGate(many(), POOL, 'Nowhere').reason).toBe('division-coverage-below-floor');
  });

  it('refuses a programme with too few traced moves', () => {
    const few = Array.from({ length: MIN_OBSERVED_DESTINATIONS - 1 }, (_, i) => movement({ name: `M ${i}` }));
    const g = destinationGate(few, POOL, 'NCAA D1');
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('too-few-observed');
  });

  it('allows a division above the floor with a sufficient sample', () => {
    expect(destinationGate(many(), POOL, 'NCAA D1').allowed).toBe(true);
    expect(destinationGate(many(), POOL, 'NCAA D2').allowed).toBe(true);
  });
});

describe('departure composition', () => {
  const movements = () => [
    ...Array.from({ length: 9 }, (_, i) => movement({ name: `Traced ${i}` })),
    ...Array.from({ length: 4 }, (_, i) => ambiguous({ name: `Maybe ${i}` })),
    ...Array.from({ length: 20 }, (_, i) => unresolved({ name: `Gone ${i}` })),
  ];

  it('keeps observed destinations a strict subset of departures', () => {
    const d = programmeDepartures(movements(), continuityStub(), POOL, 'NCAA D1');
    expect(d.departures.total).toBe(33);
    expect(d.tracing.observed).toBe(9);
    expect(d.tracing.observed).toBeLessThan(d.departures.total);
    expect(d.tracing.observed + d.tracing.ambiguous + d.tracing.unresolved).toBe(d.departures.total);
  });

  it('never promotes an ambiguous candidate to a destination', () => {
    const d = programmeDepartures(movements(), continuityStub(), POOL, 'NCAA D1');
    expect(d.tracing.ambiguous).toBe(4);
    for (const m of d.named) expect(m.destinationProgramme).toBeTruthy();
    expect(d.named.some((m) => m.status === MATCH_STATUS.AMBIGUOUS)).toBe(false);
    expect(d.named).toHaveLength(9);
  });

  it('reports unresolved departures as the largest group', () => {
    const d = programmeDepartures(movements(), continuityStub(), POOL, 'NCAA D1');
    expect(d.tracing.unresolved).toBe(20);
    expect(d.tracing.unresolved).toBeGreaterThan(d.tracing.observed);
  });

  it('publishes coverage and no rate that could be read as behaviour', () => {
    const d = programmeDepartures(movements(), continuityStub(), POOL, 'NCAA D1');
    expect(d.tracing.coverage).toBeCloseTo(9 / 33, 6);
    expect(JSON.stringify(d)).not.toMatch(/transferRate|transfer_rate/i);
  });

  it('splits the early departures separately from every departure', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => movement({ name: `Early ${i}`, exitKind: EXIT_KIND.EARLY_EXIT })),
      ...Array.from({ length: 4 }, (_, i) => movement({ name: `Senior ${i}`, exitKind: EXIT_KIND.EXPECTED_EXIT })),
      ...Array.from({ length: 3 }, (_, i) => unresolved({ name: `Gone ${i}`, exitKind: EXIT_KIND.EARLY_EXIT })),
    ];
    const d = programmeDepartures(rows, continuityStub(), POOL, 'NCAA D1');
    expect(d.tracing.observed).toBe(9);         // includes the four expected exits
    expect(d.earlyTracing.departures).toBe(8);
    expect(d.earlyTracing.observed).toBe(5);    // and these do not
    expect(d.earlyTracing.unresolved).toBe(3);
  });

  it('reports football, academic and division as three independent tallies', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => movement({
        name: `A ${i}`, football: 'LOWER_FOOTBALL_RATING',
        academic: 'HIGHER_ACADEMIC_RATING', divisionMove: 'DIVISION_SAME',
      })),
      ...Array.from({ length: 4 }, (_, i) => movement({
        name: `B ${i}`, football: 'STRONGER_FOOTBALL_RATING',
        academic: 'LOWER_ACADEMIC_RATING', divisionMove: 'DIVISION_UP',
      })),
    ];
    const d = programmeDepartures(rows, continuityStub(), POOL, 'NCAA D1');
    // The same nine moves, counted three ways, and never summed into one.
    expect(d.dimensions.football.LOWER_FOOTBALL_RATING).toBe(5);
    expect(d.dimensions.football.STRONGER_FOOTBALL_RATING).toBe(4);
    expect(d.dimensions.academic.HIGHER_ACADEMIC_RATING).toBe(5);
    expect(d.dimensions.division.DIVISION_UP).toBe(4);
    expect(d.dimensions.division.DIVISION_SAME).toBe(5);
    for (const dim of ['football', 'academic', 'division']) expect(d.dimensions[dim].n).toBe(9);
    expect(Object.keys(d.dimensions)).toEqual(['football', 'academic', 'division']);
  });

  it('counts a dimension the ratings cannot answer as not comparable, not as similar', () => {
    const rows = Array.from({ length: 9 }, (_, i) => movement({
      name: `A ${i}`, football: null, academic: null, divisionMove: null,
    }));
    const d = programmeDepartures(rows, continuityStub(), POOL, 'NCAA D1');
    expect(d.dimensions.football.notComparable).toBe(9);
    expect(d.dimensions.football.SIMILAR_FOOTBALL_RATING).toBe(0);
  });
});

describe('position-specific movement', () => {
  const atPosition = (n, position) => Array.from({ length: n }, (_, i) => movement({
    name: `${position} ${i}`, position,
  }));

  it('shows the position alone where it carries enough traced moves', () => {
    const p = positionMovement([...atPosition(MIN_POSITION_DESTINATIONS, 'FORWARD'),
      ...atPosition(6, 'DEFENSE')], 'Forward');
    expect(p.group).toBe('position');
    expect(p.rows).toHaveLength(MIN_POSITION_DESTINATIONS);
    expect(p.rows.every((r) => r.canonicalPosition === 'FORWARD')).toBe(true);
  });

  it('never silently broadens: a thin position says which group is shown', () => {
    const p = positionMovement([...atPosition(MIN_POSITION_DESTINATIONS - 1, 'FORWARD'),
      ...atPosition(9, 'DEFENSE')], 'Forward');
    expect(p.group).toBe('programme');
    expect(p.programmeObserved).toBe(13);
    expect(p.rows.length).toBe(12);          // the athlete module caps its list
    expect(p.omitted).toBe(1);
    expect(p.groupNote).toMatch(/every traced departure from the programme/i);
    expect(p.atPositionObserved).toBe(MIN_POSITION_DESTINATIONS - 1);
  });

  it('does not treat an unreadable position as a position', () => {
    const p = positionMovement(atPosition(9, 'UNKNOWN'), 'Something Unreadable');
    expect(p.group).toBe('programme');
  });
});

describe('banding against the pool', () => {
  const spread = { p25: 0.5, median: 0.57, p75: 0.62 };
  it('splits on the quartiles, so typical is the middle half', () => {
    expect(bandAgainst(0.7, spread)).toBe('above-benchmark');
    expect(bandAgainst(0.55, spread)).toBe('typical');
    expect(bandAgainst(0.4, spread)).toBe('below-benchmark');
  });
  it('keeps unavailable and unclear apart', () => {
    expect(bandAgainst(null, spread)).toBe('unavailable');
    expect(bandAgainst(0.5, null)).toBe('unavailable');
    expect(bandAgainst(0.5, { p25: null, p75: null })).toBe('unclear');
  });
});

describe('representative trajectories', () => {
  it('picks the longest histories by a stated rule and says what it omitted', () => {
    const lives = firstYearCohort(buildLifecycles([
      ...career('Four Seasons', { 2022: 100, 2023: 400, 2024: 900, 2025: 1400 }),
      ...career('Three Seasons', { 2022: 50, 2023: 200, 2024: 700 }),
      ...career('Two Seasons', { 2023: 300, 2024: 500 }),
    ]));
    const t = representativeTrajectories(developmentSummary(lives).trajectories, { max: 1 });
    expect(t.eligible).toBe(2);              // the two-season career is not drawable
    expect(t.shown).toHaveLength(1);
    expect(t.shown[0].name).toBe('Four Seasons');
    expect(t.omitted).toBe(1);
    expect(t.rule).toMatch(/longest history first/);
  });

  it('leaves a gap for an unmeasured season rather than a point at zero', () => {
    const lives = firstYearCohort(buildLifecycles([
      ...career('Gappy', { 2022: 100, 2023: null, 2024: 900, 2025: 1400 }),
    ]));
    const t = representativeTrajectories(developmentSummary(lives).trajectories);
    expect(t.shown[0].points.map((p) => p.year)).toEqual([1, 3, 4]);
  });
});

describe('the whole summary', () => {
  const rows = () => [
    ...career('Grower', { 2022: 100, 2023: 700, 2024: 1200, 2025: 1400 }),
    ...career('Steady', { 2022: 400, 2023: 450, 2024: 500 }),
    ...Array.from({ length: 20 }, (_, i) => row({ name: `Squad${tag(i)} Player`, season: '2022', class: 'So.' })),
    ...Array.from({ length: 14 }, (_, i) => row({ name: `Squad${tag(i)} Player`, season: '2023', class: 'Jr.' })),
  ];

  it('refuses everything, by name, where a programme has no rows', () => {
    const s = buildLifecycleSummary({ rows: [], pool: POOL, division: 'NCAA D1', programme: 'Home' });
    expect(s.available).toBe(false);
    expect(s.reason).toMatch(/no roster seasons/);
  });

  it('attaches no athlete module where the destination gate is closed', () => {
    const s = buildLifecycleSummary({
      rows: rows(), pool: POOL, division: 'NCAA D3', programme: 'Home',
      athlete: { position: 'Midfielder' },
    });
    expect(s.departures.gate.allowed).toBe(false);
    expect(s.athletePosition).toBeNull();
  });

  it('carries the seasons, the division and the pool it was read against', () => {
    const s = buildLifecycleSummary({ rows: rows(), pool: POOL, division: 'NCAA D1', programme: 'Home' });
    expect(s.available).toBe(true);
    expect(s.division).toBe('NCAA D1');
    expect(s.lastMeasuredSeason).toBe('2025');
    expect(s.poolProgrammes).toBe(100);
  });
});
