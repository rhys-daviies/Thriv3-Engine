/**
 * How broadly a programme has spread the minutes at ONE position.
 *
 * The whole-squad figure in `utilisation.js` answers a different question and
 * Phase 8B measured how different: how many players reach a starter's season at
 * a position correlates with the squad's top-eleven share at r = -0.17 for
 * defenders, -0.11 for midfielders and -0.05 for forwards. Akron is the case
 * that makes it concrete — its squad concentrates minutes above the Division I
 * median while its midfield spreads them wider than almost anyone, and no
 * whole-squad number can say both.
 *
 * WHAT IT IS NOT. Observed history and nothing else. It does not describe
 * future playing time, does not measure competition, does not say why minutes
 * went where they went, and cannot say whether a broad or a narrow
 * distribution is better — a settled side of eleven and a rotating squad of
 * twenty produce different numbers and neither is a virtue.
 *
 * TWO MEASURES, and only two, chosen by measurement rather than taste. Phase
 * 8B evaluated nine candidates and found seven of them to be one factor —
 * every pair among `playersFor90`, `effectivePlayers`, `playersWith200Plus`
 * and the top-N shares runs |r| 0.80 to 0.98. Of the survivors:
 *
 *   `playersWith600Plus` is the least distorted by how many players a position
 *   carries (r = 0.46 against position size, where the others run 0.60-0.83),
 *   is unmoved by dropping the lowest-minute player at the position, and is
 *   the one measure independent of the whole-squad figure.
 *
 *   `playersFor75` is the most stable number tested: dropping a readable
 *   season moves it by a median of ZERO players.
 *
 * `top3MinuteShare` is carried for QA and is not a reader-facing measure; it is
 * redundant with `playersFor75` at |r| ~0.92. Nothing else from the audit is
 * exposed.
 *
 * NO GOALKEEPERS. Not a coverage threshold — a structural fact. The median
 * programme uses two goalkeepers and one of them reaches 600 minutes, so there
 * is no distribution to describe, and zero of 920 men's programme cells are
 * quotable. Asking for one returns POSITION_NOT_SUPPORTED, which is a
 * methodological exclusion and must never read as missing data.
 */
import { minutesCoverage } from './readable.js';
import { canonicalPosition } from '../positions.js';
import { STARTER_MINUTES } from './lifecycle.js';
import { MEASURED_SEASONS, MIN_SQUAD_FOR_SHARE, MIN_SEASONS_TO_QUOTE } from './utilisation.js';

/** The positions a minute distribution can be read at. */
export const SUPPORTED_POSITIONS = Object.freeze(['DEFENSE', 'MIDFIELD', 'FORWARD']);

/** The share of the position's minutes `playersFor75` must reach. */
export const CUMULATIVE_TARGET = 0.75;

/**
 * How much of a squad's minutes may sit at an unreadable position before the
 * split by position stops describing the squad.
 *
 * Measured rather than assumed: the median programme-season has 0.0% of its
 * minutes at an UNKNOWN position and the 90th percentile has 0.7%, so this cap
 * costs almost nothing — 2.5% of men's and 2.1% of women's readable seasons
 * exceed it. What it buys is that those seasons say so instead of dividing by a
 * denominator missing half its minutes.
 */
export const MAX_UNKNOWN_MINUTE_SHARE = 0.10;

/** A position-season needs this many players who actually played. */
export const MIN_PLAYERS_USED = 5;

export const POSITION_SEASON_UNREADABLE = Object.freeze({
  NO_ROSTER: 'no roster on file for this season',
  ROSTER_TOO_SMALL: 'this season carries too few players to be a roster',
  MINUTES_UNREADABLE: 'too few of this squad’s minutes were published to read a distribution',
  NO_MINUTES_PLAYED: 'the published minutes for this season total zero',
  POSITION_DENOMINATOR_INCOMPLETE: 'too much of this squad’s playing time is recorded '
    + 'against no position for the minutes to be split by position',
  TOO_FEW_PLAYERS_USED_AT_POSITION: 'too few players were used at this position for a '
    + 'distribution of its minutes to exist',
});

export const POSITION_NOT_SUPPORTED = 'position utilisation is not reported for goalkeepers: '
  + 'the median programme uses two and one of them reaches a starter’s season, so there is no '
  + 'distribution of minutes to describe';

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const range = (values) => (values.length
  ? { low: Math.min(...values), high: Math.max(...values) } : null);

/**
 * The fewest players whose minutes reach `target` of the position's total.
 *
 * Cumulative from the most-used player down. The comparison is `>=`, so a
 * position where four players hold exactly three-quarters of the minutes
 * answers four rather than five.
 */
function playersForShare(sortedDescending, total, target = CUMULATIVE_TARGET) {
  if (!total) return null;
  let acc = 0;
  for (let i = 0; i < sortedDescending.length; i += 1) {
    acc += sortedDescending[i];
    if (acc / total >= target) return i + 1;
  }
  return sortedDescending.length;
}

/**
 * One position in one season.
 *
 * Position is the one the roster gave the player IN THIS SEASON. A player
 * listed in defence in 2023 and midfield in 2024 contributes to defence in
 * 2023 and midfield in 2024, and to exactly one position in each — there is no
 * arrival position and no career position here, because the question is who
 * was used where.
 */
export function positionSeasonUtilisation(rows, { season, position, minPlayersUsed = MIN_PLAYERS_USED } = {}) {
  const key = canonicalPosition(position);
  const roster = rows.filter((r) => String(r.season) === String(season));
  const out = {
    season: String(season), position: key, readable: false, reason: null,
    rosterPlayers: roster.length, playersAtPosition: 0, measuredAtPosition: 0,
    playersWithMinutes: null, playersWith600Plus: null, playersFor75: null,
    top3MinuteShare: null, totalPositionMinutes: null, unknownPositionMinuteShare: null,
  };
  if (!roster.length) return { ...out, reason: POSITION_SEASON_UNREADABLE.NO_ROSTER };
  if (roster.length < MIN_SQUAD_FOR_SHARE) return { ...out, reason: POSITION_SEASON_UNREADABLE.ROSTER_TOO_SMALL };
  if (!minutesCoverage(roster).readable) return { ...out, reason: POSITION_SEASON_UNREADABLE.MINUTES_UNREADABLE };

  const measured = roster.filter((r) => r.minutes_played != null);
  const squadMinutes = measured.reduce((sum, r) => sum + Number(r.minutes_played), 0);
  if (!squadMinutes) return { ...out, reason: POSITION_SEASON_UNREADABLE.NO_MINUTES_PLAYED };

  const unknownShare = measured
    .filter((r) => canonicalPosition(r.position) === 'UNKNOWN')
    .reduce((sum, r) => sum + Number(r.minutes_played), 0) / squadMinutes;
  out.unknownPositionMinuteShare = unknownShare;
  if (unknownShare > MAX_UNKNOWN_MINUTE_SHARE) {
    return { ...out, reason: POSITION_SEASON_UNREADABLE.POSITION_DENOMINATOR_INCOMPLETE };
  }

  const at = roster.filter((r) => canonicalPosition(r.position) === key);
  const atMeasured = at.filter((r) => r.minutes_played != null);
  const minutes = atMeasured.map((r) => Number(r.minutes_played)).sort((a, b) => b - a);
  const played = minutes.filter((m) => m > 0);
  out.playersAtPosition = at.length;
  out.measuredAtPosition = atMeasured.length;
  out.playersWithMinutes = played.length;
  if (played.length < minPlayersUsed) {
    return { ...out, reason: POSITION_SEASON_UNREADABLE.TOO_FEW_PLAYERS_USED_AT_POSITION };
  }

  const total = minutes.reduce((sum, m) => sum + m, 0);
  return {
    ...out,
    readable: true,
    reason: null,
    // The two production measures.
    playersWith600Plus: minutes.filter((m) => m >= STARTER_MINUTES).length,
    playersFor75: playersForShare(minutes, total),
    // Supporting only, for QA: redundant with playersFor75 at |r| ~0.92.
    top3MinuteShare: minutes.slice(0, 3).reduce((sum, m) => sum + m, 0) / total,
    totalPositionMinutes: total,
  };
}

/**
 * One programme, one position, across the seasons that carry minutes.
 *
 * Raw season values are never replaced by their own summary: a median of five
 * drawn from 5, 5, 5 is a different object from one drawn from 2, 5, 8, and
 * only the seasons show which. 2026 is excluded by season rather than by
 * coverage — it carries no minutes at all and is unmeasured by design.
 */
export function programmePositionUtilisation(rows, {
  position, seasons = MEASURED_SEASONS, minSeasonsToQuote = MIN_SEASONS_TO_QUOTE, ...options
} = {}) {
  const key = canonicalPosition(position);
  const empty = {
    position: key, supported: false, available: false,
    reason: POSITION_NOT_SUPPORTED, seasons: [], readableSeasons: 0,
    readableSeasonList: [], refusedSeasons: [],
    medianPlayersWith600Plus: null, rangePlayersWith600Plus: null,
    medianPlayersFor75: null, rangePlayersFor75: null,
    medianPlayersWithMinutes: null, medianTop3MinuteShare: null,
    singleSeasonObservation: null,
  };
  if (!SUPPORTED_POSITIONS.includes(key)) return empty;

  const bySeason = seasons.map((season) => positionSeasonUtilisation(rows, { season, position: key, ...options }));
  const readable = bySeason.filter((s) => s.readable);
  const enough = readable.length >= minSeasonsToQuote;
  const values = (k) => readable.map((s) => s[k]);

  return {
    position: key,
    supported: true,
    available: enough,
    reason: enough ? null
      : `only ${readable.length} of ${seasons.length} seasons carry a readable distribution of `
        + 'minutes at this position',
    seasons: bySeason,
    readableSeasons: readable.length,
    readableSeasonList: readable.map((s) => s.season),
    // Every refusal, with the reason, so a page can say what it could not read.
    refusedSeasons: bySeason.filter((s) => !s.readable && s.rosterPlayers > 0)
      .map((s) => ({ season: s.season, reason: s.reason, playersWithMinutes: s.playersWithMinutes })),
    medianPlayersWith600Plus: enough ? median(values('playersWith600Plus')) : null,
    rangePlayersWith600Plus: enough ? range(values('playersWith600Plus')) : null,
    medianPlayersFor75: enough ? median(values('playersFor75')) : null,
    rangePlayersFor75: enough ? range(values('playersFor75')) : null,
    // Context, not a headline: four of eight is not four of five.
    medianPlayersWithMinutes: enough ? median(values('playersWithMinutes')) : null,
    medianTop3MinuteShare: enough ? median(values('top3MinuteShare')) : null,
    /**
     * One readable season, held apart from history exactly as Phase 8 holds
     * it. NAIA is the reason — the acquisition reaches only 2025 there — and a
     * median of one season is not a median.
     */
    singleSeasonObservation: readable.length === 1 ? {
      season: readable[0].season,
      basis: 'one readable season, not a programme history',
      playersWithMinutes: readable[0].playersWithMinutes,
      playersWith600Plus: readable[0].playersWith600Plus,
      playersFor75: readable[0].playersFor75,
    } : null,
    thresholds: {
      starterMinutes: STARTER_MINUTES,
      cumulativeTarget: CUMULATIVE_TARGET,
      minPlayersUsed: options.minPlayersUsed ?? MIN_PLAYERS_USED,
      minRosterPlayers: MIN_SQUAD_FOR_SHARE,
      maxUnknownMinuteShare: MAX_UNKNOWN_MINUTE_SHARE,
      minSeasonsToQuote,
    },
  };
}

/** All three supported positions, for a programme-level lookup. */
export function allPositionUtilisation(rows, options = {}) {
  return SUPPORTED_POSITIONS.map((position) => programmePositionUtilisation(rows, { ...options, position }));
}

export { median as positionUtilisationMedian, playersForShare };
