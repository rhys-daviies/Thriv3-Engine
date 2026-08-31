/**
 * The lifecycle layer, read for one programme and one report.
 *
 * Pure derivation. Nothing here touches a database and nothing here renders:
 * it turns the Track A–G primitives into the exact answers three pages ask,
 * so those pages become a drawing job, and so the thinking can be asserted
 * without producing a PDF. Same contract as `buildReportSummary`.
 *
 * THREE RULES, inherited from the layer underneath and enforced again here.
 *
 * Every share carries its denominator and the horizon that denominator was
 * drawn over. "Reached a starter's season by year three" is computed only over
 * players who have HAD a year three in seasons that carry minutes; leaving the
 * rest in would count every recent arrival as a miss.
 *
 * A destination is only ever an OBSERVED destination. Ambiguous candidates are
 * counted and never named as destinations, unresolved departures are the
 * largest group and are reported first, and the word transfer does not appear
 * in anything this module produces.
 *
 * Nothing is combined. Football rating, academic rating and division move
 * independently; a player can go to a lower-rated programme in a stronger
 * academic one in the same division, and that is reported as three facts.
 */
import { buildLifecycles, firstYearCohort, STARTER_MINUTES, roleBand, ROLE_BANDS } from '../lifecycle/lifecycle.js';
import { continuityObservations, continuitySummary, EXIT_KIND } from '../lifecycle/continuity.js';
import { developmentSummary, trajectoryOf, MIN_COHORT } from '../lifecycle/development.js';
import { MATCH_STATUS, isObserved } from '../lifecycle/movement.js';
import { LAST_SEASON, LAST_MEASURED_SEASON, MIN_RETURNABLE } from '../lifecycle/pool.js';
import { canonicalPosition } from '../positions.js';
import { readableRows, minutesCoverage } from '../lifecycle/readable.js';

/**
 * Divisions whose destination movement is never rendered, whatever a single
 * programme's own sample looks like.
 *
 * Two separate reasons, kept separate. NCAA D3 is a standing product decision:
 * roughly one departure in thirty resolves to a destination there, so any
 * sample a D3 programme happens to have is a sample of the visible tail rather
 * than of its movement. USCAA and NJCAA are too small to be read at all — a
 * two-programme division has no pool to compare against.
 *
 * The measured floor below would exclude all three on today's data. Both gates
 * exist because they answer different questions: the floor asks whether the
 * data supports the page, the list asks whether we have decided to publish it.
 */
export const DESTINATION_SUPPRESSED_DIVISIONS = Object.freeze(['NCAA D3', 'USCAA', 'NJCAA']);

/** A division's pool-wide destination coverage must clear this to render at all. */
export const DIVISION_COVERAGE_FLOOR = 0.05;
/** …and the programme itself needs this many observed destinations. */
export const MIN_OBSERVED_DESTINATIONS = 8;
/**
 * Named movement rows on an ATHLETE module.
 *
 * The programme's own list is not capped: it lives in the supporting record,
 * where a table is allowed to run onto a second page, and truncating the one
 * place the names are printed would make the analysis uncheckable.
 */
export const MAX_DESTINATION_ROWS = 12;
/**
 * Individual trajectories drawn; beyond this the chart stops being readable.
 *
 * Eight lines crossing one axis is a texture rather than a chart — the reader
 * cannot follow any single player through it, and the page's own headline gets
 * less space than the eight lines under it. Six is followable. The selection
 * rule is unchanged and still stated on the page, and the count not drawn is
 * printed beside it.
 */
export const MAX_TRAJECTORIES = 6;
/** A player needs this many measured seasons before their line means anything. */
export const MIN_TRAJECTORY_SEASONS = 3;
/** A position needs this many observed destinations before it is shown alone. */
export const MIN_POSITION_DESTINATIONS = 5;

const share = (n, d) => (d ? n / d : null);

/**
 * Where a programme's figure sits against the pool's quartiles.
 *
 * Split on p25 and p75, so 'typical' names the middle half of the pool — the
 * same three bands, computed the same way, as the classifications on the
 * glance pages. 'unclear' and 'unavailable' stay apart: one says we looked and
 * could not tell, the other says there was nothing to look at.
 */
export function bandAgainst(value, spread) {
  if (value == null || !spread) return 'unavailable';
  if (spread.p25 == null || spread.p75 == null) return 'unclear';
  if (value > spread.p75) return 'above-benchmark';
  if (value < spread.p25) return 'below-benchmark';
  return 'typical';
}

// ---------------------------------------------------------------------------
// Development — how players' minutes move after they arrive
// ---------------------------------------------------------------------------

/**
 * Time to a starter's season, over a cohort that could have had one.
 *
 * The denominator is first-years whose first three seasons are all inside the
 * measured window. Anyone who arrived too recently is not counted as anything
 * — not a miss, not a success — which is the whole point: a 2025 arrival has
 * had one season and calling them "has not reached 600" is a statement about
 * the calendar rather than about them.
 */
export function timeToStarter(trajectories, { lastMeasuredSeason = LAST_MEASURED_SEASON,
  minCohort = MIN_COHORT } = {}) {
  const horizon = Number(lastMeasuredSeason) - 2;
  const cohort = trajectories.filter((t) => Number(t.firstSeason) <= horizon);
  const at = (n) => cohort.filter((t) => t.seasonsUntilStarter === n).length;
  const within = cohort.filter((t) => t.seasonsUntilStarter != null && t.seasonsUntilStarter <= 2).length;
  return {
    denominator: cohort.length,
    // Stated so a reader knows which players are in it and which are simply
    // too recent to be asked the question.
    entrySeasonsUpTo: String(horizon),
    year1: at(0),
    year2: at(1),
    year3: at(2),
    notWithinThree: cohort.length - within,
    suppressed: cohort.length < minCohort,
  };
}

/**
 * The individual lines worth drawing, and how many were left out.
 *
 * Chosen by a stated rule rather than by eye: the longest observable histories
 * first, because a line over four measured seasons carries information a line
 * over two cannot, and ties broken by name so the same programme always
 * produces the same picture. Nothing is selected for how it looks.
 */
export function representativeTrajectories(trajectories, {
  max = MAX_TRAJECTORIES, minSeasons = MIN_TRAJECTORY_SEASONS,
} = {}) {
  const eligible = trajectories.filter((t) => t.measuredSeasons >= minSeasons);
  const ranked = [...eligible].sort((a, b) => b.measuredSeasons - a.measuredSeasons
    || String(a.name).localeCompare(String(b.name)));
  return {
    rule: `first-years with ${minSeasons} or more seasons of published minutes here, longest history first`,
    shown: ranked.slice(0, max).map((t) => ({
      name: t.name,
      position: t.position,
      firstSeason: t.firstSeason,
      points: t.points.filter((p) => p.measured)
        .map((p) => ({ season: p.season, year: p.yearsSinceFirst + 1, minutes: p.minutes })),
      everStarter: t.everStarter,
    })),
    eligible: eligible.length,
    omitted: Math.max(0, eligible.length - max),
  };
}

export function programmeDevelopment(rawRows, pool, { lastSeason = LAST_SEASON,
  lastMeasuredSeason = LAST_MEASURED_SEASON } = {}) {
  // Applied here rather than trusted from the caller. It is idempotent, and a
  // rule that only holds when somebody remembers to apply it upstream is the
  // rule that produced "0% of first-years here reach a starter's season".
  const rows = readableRows(rawRows);
  const cohort = firstYearCohort(buildLifecycles(rows));
  const dev = developmentSummary(cohort, { lastSeason, lastMeasuredSeason });
  // Measured over the cohort's own seasons in the window that HAS minutes. The
  // forward roster carries none by construction and counting it would put
  // every programme under the floor.
  const coverage = minutesCoverage(
    cohort.flatMap((l) => l.seasons.filter((x) => Number(x.season) <= Number(lastMeasuredSeason)))
      .map((x) => ({ minutes_played: x.minutes })),
  );
  // A share nobody should read is not printed as a share. The counts stay —
  // "we could read 3 of 61 seasons" is the finding.
  const gated = (v) => (coverage.readable ? v : null);
  const bench = pool?.benchmarks ?? null;
  const poolFor = (key, i) => (bench ? (bench.byDivision[pool.division]?.[key]?.[i]
    ?? bench.overall[key]?.[i] ?? null) : null);

  return {
    cohort: 'first-year',
    players: dev.players,
    playersWithAnyMeasuredSeason: dev.playersWithAnyMeasuredSeason,
    playersWithNoMeasuredSeason: dev.playersWithNoMeasuredSeason,
    // Years one to four. Each carries the cohort that COULD have reached it.
    minutesCoverage: coverage,
    byYear: dev.starterLevelByYear.map((y, i) => ({
      ...y,
      share: gated(y.share),
      suppressed: y.suppressed || !coverage.readable,
      pool: poolFor('starterByYear', i),
      band: coverage.readable ? bandAgainst(y.share, poolFor('starterByYear', i)) : 'unavailable',
    })),
    stillHereByYear: dev.retentionByYear.map((y, i) => ({
      ...y,
      pool: poolFor('retentionAfter', i),
    })),
    everStarter: {
      ...dev.everReachedStarter,
      share: gated(dev.everReachedStarter.share),
      suppressed: dev.everReachedStarter.suppressed || !coverage.readable,
      pool: bench ? (bench.byDivision[pool.division]?.everStarter ?? bench.overall.everStarter) : null,
      band: coverage.readable
        ? bandAgainst(dev.everReachedStarter.share,
          bench ? (bench.byDivision[pool.division]?.everStarter ?? bench.overall.everStarter) : null)
        : 'unavailable',
    },
    timeToStarter: (() => {
      const t = timeToStarter(dev.trajectories, { lastMeasuredSeason });
      return { ...t, suppressed: t.suppressed || !coverage.readable };
    })(),
    medianSeasonsUntilStarter: dev.medianSeasonsUntilStarter,
    trajectories: representativeTrajectories(dev.trajectories),
    bandProgression: dev.bandProgression,
  };
}

// ---------------------------------------------------------------------------
// Continuity and departure composition
// ---------------------------------------------------------------------------

export function programmeContinuity(rawRows, pool) {
  const rows = readableRows(rawRows);
  const obs = continuityObservations(rows);
  const c = continuitySummary(obs);
  const bench = pool?.benchmarks ?? null;
  const forDiv = (key) => (bench
    ? (bench.byDivision[pool.division]?.[key] ?? bench.overall[key]) : null);

  const roleSlice = c.slices.find((s) => s.by === 'roleBand');
  const byRole = ROLE_BANDS.map((b) => roleSlice.groups.find((g) => g.key === b)
    ?? { key: b, observations: 0, returnable: 0, returned: 0, notObserved: 0, unreadable: 0, retention: null, suppressed: true });

  return {
    observations: c.observations,
    returnable: c.returnable,
    returned: c.returned,
    notObserved: c.notObserved,
    unreadable: c.unreadable,
    retention: c.returnable >= MIN_RETURNABLE ? c.retention : null,
    // Kept apart from `retention`: the figure exists, it is just too thin to
    // be read against a pool of programmes with forty or more.
    retentionSuppressed: c.returnable < MIN_RETURNABLE,
    pool: forDiv('retention'),
    band: c.returnable >= MIN_RETURNABLE
      ? bandAgainst(c.retention, forDiv('retention')) : 'unclear',
    starterRetention: {
      ...c.starterRetention,
      pool: forDiv('starterRetention'),
      band: c.starterRetention.suppressed ? 'unclear'
        : bandAgainst(c.starterRetention.retention, forDiv('starterRetention')),
    },
    byRole,
    exits: c.exits,
    byTransition: c.slices.find((s) => s.by === 'transition')?.groups ?? [],
  };
}

// ---------------------------------------------------------------------------
// Departure composition and observed destinations
// ---------------------------------------------------------------------------

const DIMENSION_KEYS = Object.freeze({
  football: ['STRONGER_FOOTBALL_RATING', 'SIMILAR_FOOTBALL_RATING', 'LOWER_FOOTBALL_RATING'],
  academic: ['HIGHER_ACADEMIC_RATING', 'SIMILAR_ACADEMIC_RATING', 'LOWER_ACADEMIC_RATING'],
  division: ['DIVISION_UP', 'DIVISION_SAME', 'DIVISION_DOWN'],
});

function tallyDimension(records, get, keys) {
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  let notComparable = 0;
  for (const r of records) {
    const v = get(r);
    if (v == null) { notComparable += 1; continue; }
    counts[v] += 1;
  }
  return { ...counts, notComparable, n: records.length };
}

/**
 * Whether this programme's destination movement may be rendered.
 *
 * Three independent gates, each reported by name so a reader of the model —
 * and a test — can see which one closed the page. A thin sample is not made
 * publishable by the fact that some rows exist.
 */
export function destinationGate(movements, pool, division) {
  const observed = movements.filter(isObserved);
  if (DESTINATION_SUPPRESSED_DIVISIONS.includes(division)) {
    return {
      allowed: false, reason: 'division-suppressed',
      note: `destinations are not reported for ${division}: too few departures can be traced there `
        + 'for a sample to describe anything',
    };
  }
  const divCoverage = pool?.destinationCoverage?.[division]?.coverage ?? null;
  if (divCoverage == null || divCoverage < DIVISION_COVERAGE_FLOOR) {
    return {
      allowed: false, reason: 'division-coverage-below-floor',
      note: divCoverage == null
        ? 'there is no pool of comparable programmes to read this division against'
        : `only ${(100 * divCoverage).toFixed(1)}% of departures in this division can be traced to `
          + 'another roster, which is too few to describe where players go',
    };
  }
  if (observed.length < MIN_OBSERVED_DESTINATIONS) {
    return {
      allowed: false, reason: 'too-few-observed',
      note: `${observed.length} of this programme's ${movements.length} departures can be traced to `
        + `another roster — fewer than the ${MIN_OBSERVED_DESTINATIONS} needed to describe a pattern`,
    };
  }
  return { allowed: true, reason: null, note: null };
}

export function programmeDepartures(movements, continuity, pool, division) {
  const observed = movements.filter(isObserved);
  const ambiguous = movements.filter((m) => m.status === MATCH_STATUS.AMBIGUOUS);
  const unresolved = movements.filter((m) => m.status === MATCH_STATUS.UNRESOLVED);
  const gate = destinationGate(movements, pool, division);

  // The same three counts, restricted to players whose class label said they
  // had seasons left. An expected exit that turns up elsewhere is a real
  // observation, but it is not what "where do players go when they leave
  // early" is asking, and the two must not be added together.
  const early = movements.filter((m) => m.exitKind === EXIT_KIND.EARLY_EXIT);
  const earlyTracing = {
    departures: early.length,
    observed: early.filter(isObserved).length,
    ambiguous: early.filter((m) => m.status === MATCH_STATUS.AMBIGUOUS).length,
    unresolved: early.filter((m) => m.status === MATCH_STATUS.UNRESOLVED).length,
  };

  const named = [...observed]
    .sort((a, b) => (b.priorRole.minutes ?? -1) - (a.priorRole.minutes ?? -1)
      || String(a.name).localeCompare(String(b.name)));

  return {
    // Composition first. Observed destinations are a subset of departures and
    // the model says so by shape, not only by wording.
    departures: {
      total: movements.length,
      expectedExits: continuity.exits.expected,
      earlyDepartures: continuity.exits.early,
      unknownClass: continuity.exits.unknownClass,
    },
    tracing: {
      observed: observed.length,
      matchedA: movements.filter((m) => m.status === MATCH_STATUS.MATCH_A).length,
      matchedB: movements.filter((m) => m.status === MATCH_STATUS.MATCH_B).length,
      ambiguous: ambiguous.length,
      unresolved: unresolved.length,
      coverage: share(observed.length, movements.length),
      divisionCoverage: pool?.destinationCoverage?.[division]?.coverage ?? null,
    },
    earlyTracing,
    gate,
    dimensions: {
      football: tallyDimension(observed, (r) => r.comparison?.soccerScore?.band ?? null,
        DIMENSION_KEYS.football),
      academic: tallyDimension(observed, (r) => r.comparison?.academicRating?.band ?? null,
        DIMENSION_KEYS.academic),
      division: tallyDimension(observed, (r) => r.comparison?.division?.movement ?? null,
        DIMENSION_KEYS.division),
    },
    byPriorRole: ROLE_BANDS.map((band) => {
      const all = movements.filter((m) => m.priorRole.roleBand === band);
      const seen = all.filter(isObserved);
      return {
        band,
        departures: all.length,
        observed: seen.length,
        coverage: share(seen.length, all.length),
        football: tallyDimension(seen, (r) => r.comparison?.soccerScore?.band ?? null,
          DIMENSION_KEYS.football),
        suppressed: seen.length < MIN_COHORT,
      };
    }),
    named,
    // Post-move minutes only exist where the destination season was played.
    outcomeMeasurable: observed.filter((m) => m.outcome?.measured).length,
  };
}

/**
 * The same observed movement, narrowed to one position — or explicitly not.
 *
 * Never silently broadened. Where the athlete's position has too few traced
 * departures, this returns the programme-wide group with `group: 'programme'`
 * set, and the page is required to say which one it is showing.
 */
export function positionMovement(movements, position, { minPosition = MIN_POSITION_DESTINATIONS } = {}) {
  const pos = canonicalPosition(position);
  const observed = movements.filter(isObserved);
  const atPosition = observed.filter((m) => m.canonicalPosition === pos);
  const usePosition = pos !== 'UNKNOWN' && atPosition.length >= minPosition;
  const records = usePosition ? atPosition : observed;
  const byMinutes = (a, b) => (b.priorRole.minutes ?? -1) - (a.priorRole.minutes ?? -1)
    || String(a.name).localeCompare(String(b.name));

  return {
    group: usePosition ? 'position' : 'programme',
    position: pos,
    atPositionObserved: atPosition.length,
    atPositionDepartures: movements.filter((m) => m.canonicalPosition === pos).length,
    programmeObserved: observed.length,
    // The position's own traced moves, however few, kept separate from `rows`.
    // Where the position is too thin to describe on its own, the page shows
    // THESE rather than the programme's — which are already listed in full in
    // the supporting record, and printing them twice is not context.
    positionRows: [...atPosition].sort(byMinutes),
    // The sentence the page must print. Written here so the model, not the
    // renderer, owns the claim about which group is on the page.
    // The sentence the page must print, written here so the model owns the
    // claim about which group is on the page. It said "so this is every traced
    // departure from the programme" while the page beneath it showed one
    // forward; the page changed and this had to change with it.
    groupNote: usePosition
      ? `Players recorded at ${pos.toLowerCase()} who left and could be traced.`
      : `Too few ${pos === 'UNKNOWN' ? 'position-matched' : pos.toLowerCase()} departures can be `
        + 'traced to describe this position on its own. What follows is every one of them, which '
        + 'is too small a group to read a pattern into; the programme-wide record is at the back '
        + 'of this report.',
    rows: [...records].sort(byMinutes).slice(0, MAX_DESTINATION_ROWS),
    omitted: Math.max(0, records.length - MAX_DESTINATION_ROWS),
    dimensions: {
      football: tallyDimension(records, (r) => r.comparison?.soccerScore?.band ?? null,
        DIMENSION_KEYS.football),
      academic: tallyDimension(records, (r) => r.comparison?.academicRating?.band ?? null,
        DIMENSION_KEYS.academic),
      division: tallyDimension(records, (r) => r.comparison?.division?.movement ?? null,
        DIMENSION_KEYS.division),
    },
  };
}

// ---------------------------------------------------------------------------
// The whole lifecycle model for one report
// ---------------------------------------------------------------------------

/**
 * Whether the athlete's own position carries a sample worth leading with.
 *
 * One predicate, used in three places that must agree: the page decides how
 * loudly to set itself, the registry decides which act to file it under, and
 * the running order decides where to draw it. When those three disagreed the
 * contents filed a page under a heading the page itself disowned.
 */
export function athletePositionIsStrong(model) {
  const p = model?.lifecycle?.athletePosition;
  return Boolean(p) && p.group === 'position'
    && (p.positionRows?.length ?? 0) >= MIN_POSITION_DESTINATIONS;
}

export function buildLifecycleSummary({ rows, pool, division, athlete = null, programme }) {
  if (!rows?.length) {
    return { available: false, reason: 'no roster seasons on file for this programme' };
  }
  const scoped = { ...pool, division };
  const movements = pool?.movementByProgramme?.get(programme) ?? [];
  const continuity = programmeContinuity(rows, scoped);
  const development = programmeDevelopment(rows, scoped);
  const departures = programmeDepartures(movements, continuity, pool, division);

  return {
    available: true,
    reason: null,
    seasons: pool?.seasons ?? null,
    lastSeason: pool?.lastSeason ?? LAST_SEASON,
    lastMeasuredSeason: pool?.lastMeasuredSeason ?? LAST_MEASURED_SEASON,
    division,
    poolProgrammes: pool?.benchmarks?.byDivision?.[division]?.programmes
      ?? pool?.benchmarks?.overall?.programmes ?? null,
    poolScope: pool?.benchmarks?.byDivision?.[division] ? division : 'all divisions in this sport',
    development,
    continuity,
    departures,
    athletePosition: athlete && departures.gate.allowed
      ? positionMovement(movements, athlete.position) : null,
  };
}

export { STARTER_MINUTES, ROLE_BANDS, EXIT_KIND, MATCH_STATUS, roleBand, trajectoryOf, readableRows, minutesCoverage };
