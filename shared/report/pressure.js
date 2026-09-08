/**
 * Position intake, read for one programme and one report.
 *
 * Pure derivation over `positionPressure` and the pool's `positionIntake`
 * spreads. Nothing here touches a database and nothing renders: it produces
 * the structured facts a page would need, so the thinking can be asserted
 * without producing a PDF. Same contract as `buildReportSummary` and
 * `buildLifecycleSummary`.
 *
 * WHAT THIS MAY NOT SAY, and the model refuses rather than leaving it to the
 * renderer's discretion:
 *
 * There is no BAND. Every other pool comparison in this layer carries one —
 * above-benchmark, typical, below-benchmark — and this one does not, because
 * the distribution will not support it. Intake per cycle is a small integer
 * over three cycles, so the quartiles collapse: in 42% of men's division-
 * position cells the pool's p25 equals its median or its median equals its
 * p75, a third of programmes sit EXACTLY on p25, and 54% of them would change
 * band if a single cycle's count were off by one player. Banding the
 * experienced-arrival share is worse — 62% change band if one arrival is
 * classified the other way, and 1.7% of arrivals genuinely cannot be
 * classified at all. `banding.available` is false and says so; the programme's
 * own cycles, its median, and the pool's median and middle half are exposed
 * instead, and a sentence built from those is checkable in a way a label is
 * not.
 *
 * There is no forecast and no risk. This is a record of who arrived. It cannot
 * say who will arrive, cannot say whether arriving players are good for an
 * athlete, and cannot say why anybody was recruited — a programme replacing
 * four graduating defenders and a programme replacing four who left early
 * produce the same four arrivals.
 *
 * 2026 is never inside a historical figure. It is a roster published before
 * the season is played, so it is reported as what is known so far and nothing
 * is averaged with it.
 */
import { positionPressure, MIN_CYCLES_TO_QUOTE, MIN_INCOMING_FOR_MIX } from '../lifecycle/pressure.js';
import { canonicalPosition, POSITIONS, positionNoun, positionPlural } from '../positions.js';

/** A division needs this many programmes at a position to be its own pool. */
export const MIN_POOL_PROGRAMMES = 20;

/**
 * Why no categorical label is offered, carried in the model itself.
 *
 * Recorded here rather than in a design note so that anything reading the
 * model can see the refusal, and so a future phase that widens the window has
 * to delete this line deliberately.
 */
export const BANDING_REFUSED = Object.freeze({
  available: false,
  reason: 'intake per cycle is a small integer over three cycles: pool quartiles '
    + 'collapse onto each other and half of all programmes would change band on a '
    + 'difference of one player',
});

const spreadOf = (s) => (s ? {
  programmes: s.n,
  p10: s.p10,
  p25: s.p25,
  median: s.median,
  p75: s.p75,
  p90: s.p90,
  middleHalf: { low: s.p25, high: s.p75 },
} : null);

/**
 * The pool cell for a programme's division, falling back to every division in
 * the sport when its own is too thin to compare against.
 */
function poolCellFor(positionIntake, division, position) {
  if (!positionIntake) return { cell: null, scope: null };
  const own = positionIntake[division]?.[position] ?? null;
  if (own && own.programmes >= MIN_POOL_PROGRAMMES) return { cell: own, scope: division };
  const all = positionIntake.ALL?.[position] ?? null;
  return all ? { cell: all, scope: 'all divisions in this sport' } : { cell: null, scope: null };
}

/**
 * One position, with its cycles, its history, 2026 apart, and the pool beside
 * it — and no claim about what any of it means.
 */
export function positionIntakeFor(pressure, { positionIntake = null, division = null, position }) {
  const key = canonicalPosition(position);
  const found = pressure.positions.find((p) => p.position === key);
  if (!found) return null;
  const { cell, scope } = poolCellFor(positionIntake, division, key);
  const h = found.historical;

  return {
    position: key,
    noun: positionNoun(key),
    plural: positionPlural(key),
    // The raw record, never replaced by its own summary.
    cycles: found.cycles.map((c) => ({
      season: c.season,
      current: c.current,
      readable: c.readable,
      reason: c.reason,
      firstYears: c.firstYears,
      experiencedArrivals: c.experiencedArrivals,
      unclassified: c.unclassified,
      totalIncoming: c.totalIncoming,
      // The roster's own size either side of the cycle, so a reader can see
      // when a large intake is a larger squad rather than more recruiting.
      rosterPlayers: c.rosterPlayers,
      priorRosterPlayers: c.priorRosterPlayers,
      rosterGrowth: c.rosterGrowth,
      rosterJumped: c.rosterJumped,
      names: c.names,
    })),
    historical: {
      ...h,
      pool: spreadOf(cell?.totalIncoming),
      poolScope: cell ? scope : null,
      mix: {
        ...h.mix,
        pool: spreadOf(cell?.experiencedShare),
        poolProgrammes: cell?.experiencedShareProgrammes ?? null,
      },
    },
    current: found.current,
    banding: BANDING_REFUSED,
  };
}

/**
 * Every position for the programme report, and the athlete's own if there is
 * one.
 *
 * `available` is false only when no cycle can be read at all — which is a
 * statement about the rosters on file, not about the programme, and is
 * reported with the reason each cycle failed.
 */
export function buildPressureSummary({
  rows, pool = null, division = null, athlete = null,
} = {}) {
  const pressure = positionPressure(rows ?? []);
  const positionIntake = pool?.positionIntake ?? null;
  const readable = pressure.cycles.filter((c) => c.readable && !c.current);
  const positions = POSITIONS.map((position) => positionIntakeFor(pressure, {
    positionIntake, division, position,
  }));

  return {
    available: readable.length >= MIN_CYCLES_TO_QUOTE,
    reason: readable.length >= MIN_CYCLES_TO_QUOTE ? null
      : `only ${readable.length} of ${pressure.historicalCycles.length} recruiting cycles have a `
        + 'roster on file for both seasons',
    programme: pressure.programme,
    /**
     * Whether these rosters say what position anybody plays. False at sixteen
     * programmes, six of which name no position at all, and the per-position
     * figures are refused there rather than reported as zero.
     */
    positionData: pressure.positionData,
    historicalCycles: pressure.historicalCycles,
    currentCycle: pressure.currentCycle,
    // Every cycle and why it could or could not be read, once, for all four
    // positions — a report saying "we could not read 2024" should say it once.
    cycles: pressure.cycles,
    positions,
    athletePosition: athlete ? positionIntakeFor(pressure, {
      positionIntake, division, position: athlete.position,
    }) : null,
    unknownPosition: pressure.unknownPosition,
    poolScope: positions.find((p) => p.historical.poolScope)?.historical.poolScope ?? null,
    banding: BANDING_REFUSED,
    minCyclesToQuote: MIN_CYCLES_TO_QUOTE,
    minIncomingForMix: MIN_INCOMING_FOR_MIX,
  };
}
