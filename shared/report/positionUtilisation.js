/**
 * Minute distribution within one position, read for one programme and one
 * report.
 *
 * Pure derivation over `programmePositionUtilisation` and the pool spread
 * beside it. Nothing here touches a database and nothing renders. Same
 * contract as `buildReportSummary`, `buildLifecycleSummary`,
 * `buildPressureSummary` and `buildSquadSummary`.
 *
 * NO BAND, for the third phase running and for a third measured reason. Phase
 * 7 refused because the pool quartiles collapsed onto each other. Phase 8
 * refused because a programme varies more between its own seasons than the
 * pool's middle half is wide. Here neither is true — the NUMBERS are the most
 * stable in the product, with `playersFor75` moving by a median of zero
 * players when a readable season is dropped — and the bands still fail,
 * because the quartiles of a count distribution sit one and a half players
 * apart and a band that fine cannot survive integer arithmetic: 32–48% of
 * programmes cross a quartile boundary on a leave-one-season-out. So the
 * numbers are published and the label is not.
 *
 * NOTHING IS COMBINED WITH PHASE 7. Position intake and position utilisation
 * correlate at r = 0.05 to 0.13, which is the argument for showing both and
 * against multiplying them into anything. There is no position opportunity
 * score in this file and there must not be one.
 */
import {
  programmePositionUtilisation, allPositionUtilisation, SUPPORTED_POSITIONS,
  POSITION_NOT_SUPPORTED, CUMULATIVE_TARGET,
} from '../lifecycle/positionUtilisation.js';
import { canonicalPosition, positionNoun, positionPlural } from '../positions.js';
import { MIN_POOL_PROGRAMMES } from './squad.js';

export const BANDING_REFUSED = Object.freeze({
  available: false,
  reason: 'the quartiles of a count distribution sit about one and a half players apart, '
    + 'so a category would change for a third to a half of all programmes on the removal of '
    + 'a single season — while the counts themselves barely move',
});

const spreadOf = (s) => (s ? {
  programmes: s.n,
  p10: s.p10, p25: s.p25, median: s.median, p75: s.p75, p90: s.p90,
  middleHalf: { low: s.p25, high: s.p75 },
} : null);

/**
 * The pool cell for a programme's division and position, falling back to every
 * division in the sport.
 *
 * The position half never falls back. Phase 8B measured a defender median of
 * 4.5 players over 600 against a forward median of 3 on an interquartile width
 * of 1.5, so borrowing one position's pool for another would be a two-player
 * error on a one-and-a-half-player scale.
 */
function poolCellFor(table, division, position) {
  if (!table) return { cell: null, scope: null };
  const own = table[division]?.[position] ?? null;
  if (own && own.programmes >= MIN_POOL_PROGRAMMES) return { cell: own, scope: division };
  const all = table.ALL?.[position] ?? null;
  return all ? { cell: all, scope: 'all divisions in this sport' } : { cell: null, scope: null };
}

/** One position, with its seasons, its medians, the pool, and no verdict. */
export function positionUtilisationFor(rows, {
  position, pool = null, division = null,
} = {}) {
  const key = canonicalPosition(position);
  const p = programmePositionUtilisation(rows ?? [], { position: key });
  const { cell, scope } = poolCellFor(pool?.positionUtilisation, division, key);

  return {
    position: key,
    noun: positionNoun(key),
    plural: positionPlural(key),
    /**
     * False for a goalkeeper, and the reason says why. A methodological
     * exclusion, never a missing-data refusal: `available` is false with
     * `supported` false, and a page must say the analysis is not reported at
     * this position rather than that the evidence was thin.
     */
    supported: p.supported,
    available: p.available,
    reason: p.reason,
    seasons: p.seasons.map((s) => ({
      season: s.season,
      readable: s.readable,
      reason: s.reason,
      rosterPlayers: s.rosterPlayers,
      playersAtPosition: s.playersAtPosition,
      // Context, not a headline: four of eight is not four of five.
      playersWithMinutes: s.playersWithMinutes,
      playersWith600Plus: s.playersWith600Plus,
      playersFor75: s.playersFor75,
      totalPositionMinutes: s.totalPositionMinutes,
      unknownPositionMinuteShare: s.unknownPositionMinuteShare,
      // Supporting only. Redundant with playersFor75; never a headline and
      // never classified.
      top3MinuteShare: s.top3MinuteShare,
    })),
    readableSeasons: p.readableSeasons,
    readableSeasonList: p.readableSeasonList,
    refusedSeasons: p.refusedSeasons,
    medianPlayersWith600Plus: p.medianPlayersWith600Plus,
    rangePlayersWith600Plus: p.rangePlayersWith600Plus,
    medianPlayersFor75: p.medianPlayersFor75,
    rangePlayersFor75: p.rangePlayersFor75,
    medianPlayersWithMinutes: p.medianPlayersWithMinutes,
    medianTop3MinuteShare: p.medianTop3MinuteShare,
    singleSeasonObservation: p.singleSeasonObservation,
    pool: cell ? {
      playersWith600Plus: spreadOf(cell.playersWith600Plus),
      playersFor75: spreadOf(cell.playersFor75),
    } : null,
    poolScope: cell ? scope : null,
    thresholds: p.thresholds,
    banding: BANDING_REFUSED,
  };
}

/**
 * The athlete's own position, and all three supported positions beside it.
 *
 * Both, because the two reports want different things and neither should have
 * a position chosen for it here: an athlete report reads `athletePosition`, and
 * a programme report is handed the lookup and decides for itself. A goalkeeper
 * gets an `athletePosition` that says the analysis is not reported for them —
 * which is a statement, not an absence.
 */
export function buildPositionUtilisationSummary({
  rows, pool = null, division = null, athlete = null,
} = {}) {
  const byPosition = allPositionUtilisation(rows ?? []).map((p) => positionUtilisationFor(rows, {
    position: p.position, pool, division,
  }));
  const athletePosition = athlete
    ? positionUtilisationFor(rows, { position: athlete.position, pool, division })
    : null;
  return {
    athletePosition,
    byPosition,
    supportedPositions: SUPPORTED_POSITIONS,
    positionNotSupportedReason: POSITION_NOT_SUPPORTED,
    cumulativeTarget: CUMULATIVE_TARGET,
    poolScope: byPosition.find((p) => p.poolScope)?.poolScope ?? null,
    banding: BANDING_REFUSED,
  };
}
