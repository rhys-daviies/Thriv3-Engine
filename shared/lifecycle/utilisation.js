/**
 * How broadly a programme's playing time has been spread, season by season.
 *
 * The measure is MINUTE CONCENTRATION and the reason is a lesson from Phase 6.
 * The obvious figure — what share of the roster appeared — has a denominator
 * that can be inflated by the page rather than the squad: Lake Erie men's
 * names 62 players and 28 of them have minutes, so "45% of the roster
 * appeared" describes a roster page, not a rotation. The minutes themselves
 * have a fixed size — eleven players for ninety minutes per match — so what
 * share of them the top eleven, fourteen and eighteen players took is a
 * question about distribution that a long roster cannot distort.
 *
 * WHAT IT IS NOT. It is a record of observed usage. It does not say why anyone
 * played, does not describe coaching, does not measure squad quality, and
 * cannot say whether a broad or a narrow distribution is better — a programme
 * with an injury-free season of eleven and a programme rotating twenty-two
 * produce different numbers and neither is a virtue. Nothing here is a rate
 * that could be read as intent.
 *
 * ONE READABILITY DEFINITION, and it is the existing one. A season is usable
 * when `minutesCoverage` calls it readable after `readableRows` has applied
 * both Phase 6A rules — the row rule that restores an unpublished zero to
 * null, and the source rule that blanks a programme-season whose stats page
 * was never read. There is no third definition here. 2026 carries no minutes
 * at all and is excluded by season rather than by coverage, because it is
 * unmeasured by design rather than unreadable.
 */
import { minutesCoverage } from './readable.js';
import { teamMinuteRatio, teamMinutesArePlausible } from '../performanceSource.js';
import { STARTER_MINUTES } from './lifecycle.js';

/** Seasons that carry minutes. 2026 is a named roster and nothing more. */
export const MEASURED_SEASONS = Object.freeze(['2022', '2023', '2024', '2025']);

/** The squad sizes a concentration share is taken over. */
export const TOP_N = Object.freeze([1, 5, 11, 14, 18]);

/** Minutes that put a player in the rotation, as opposed to an appearance. */
export const ROTATION_MINUTES = 200;

/**
 * A season needs this many players before a top-eleven share means anything.
 *
 * The same `MIN_SQUAD` the freshman layer applies one level up: a top-eleven
 * share over a squad of nine is 100% by arithmetic rather than by usage.
 */
export const MIN_SQUAD_FOR_SHARE = 12;

/** A programme needs this many readable seasons before a median is quoted. */
export const MIN_SEASONS_TO_QUOTE = 2;
/** …and this many before the pool carries it as a benchmark observation. */
export const MIN_SEASONS_FOR_POOL = 3;

export const SEASON_UNREADABLE = Object.freeze({
  NO_ROSTER: 'no roster on file for this season',
  TOO_FEW_PLAYERS: 'too few players on the roster for a share of its minutes to mean anything',
  MINUTES_UNREADABLE: 'too few of this squad’s minutes were published to read a distribution',
  NO_MINUTES_PLAYED: 'the published minutes for this season total zero',
});

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * One programme-season's participation and concentration.
 *
 * `rows` is that season's roster AFTER `readableRows`. Every share divides by
 * the season's own published minutes, so a programme that played more matches
 * is not compared against one that played fewer.
 */
export function seasonUtilisation(rows, { season, minSquad = MIN_SQUAD_FOR_SHARE } = {}) {
  const roster = rows.filter((r) => String(r.season) === String(season));
  const coverage = minutesCoverage(roster);
  const measured = roster.filter((r) => r.minutes_played != null);
  const minutes = measured.map((r) => Number(r.minutes_played)).sort((a, b) => b - a);
  const total = minutes.reduce((sum, m) => sum + m, 0);

  const reason = !roster.length ? SEASON_UNREADABLE.NO_ROSTER
    : roster.length < minSquad ? SEASON_UNREADABLE.TOO_FEW_PLAYERS
      : !coverage.readable ? SEASON_UNREADABLE.MINUTES_UNREADABLE
        : total === 0 ? SEASON_UNREADABLE.NO_MINUTES_PLAYED
          : null;

  /**
   * The share the highest-paid n minutes took.
   *
   * Ties need no special case and must not get one: the shares are taken over
   * a SORTED list of minutes, so two players on 900 contribute 900 each
   * wherever they fall in the order, and which of them is "eleventh" changes
   * nothing. `n` beyond the measured squad returns 1 rather than null — every
   * minute went to at most that many players, which is true and is the answer.
   */
  const topShare = (n) => (reason ? null
    : minutes.slice(0, n).reduce((sum, m) => sum + m, 0) / total);

  const atLeast = (m) => (reason ? null : measured.filter((r) => Number(r.minutes_played) >= m).length);

  return {
    season: String(season),
    readable: reason == null,
    reason,
    rosterPlayers: roster.length,
    measuredPlayers: measured.length,
    minutesCoverage: coverage,
    // Counts survive a refusal wherever they are facts about the roster
    // rather than about the minutes.
    playersWithAnyMinutes: atLeast(1),
    playersWith200PlusMinutes: atLeast(ROTATION_MINUTES),
    playersWith600PlusMinutes: atLeast(STARTER_MINUTES),
    totalMeasuredTeamMinutes: reason ? null : total,
    top1MinuteShare: topShare(1),
    top5MinuteShare: topShare(5),
    top11MinuteShare: topShare(11),
    top14MinuteShare: topShare(14),
    top18MinuteShare: topShare(18),
    /**
     * Provenance, not a gate. Eleven players for ninety minutes is what a
     * match contains, so a season's published minutes have a size derived
     * from nothing this codebase computes — 97% of readable seasons land
     * inside 0.85–1.15 with a median of exactly 1.00. An outlier is reported
     * rather than suppressed, because the evidence for a second gate is eight
     * programme-seasons across both sports and that is not enough.
     */
    teamMinuteRatio: teamMinuteRatio(roster),
    teamMinutesPlausible: teamMinutesArePlausible(teamMinuteRatio(roster)),
  };
}

/**
 * One programme's utilisation, every readable season kept.
 *
 * Raw season values are never replaced by their own summary: a median top-11
 * share of 0.73 drawn from 0.72, 0.73, 0.74 is a different object from one
 * drawn from 0.62, 0.73, 0.84, and only the seasons show which.
 */
export function programmeUtilisation(rows, {
  seasons = MEASURED_SEASONS, minSeasonsToQuote = MIN_SEASONS_TO_QUOTE, ...options
} = {}) {
  const bySeason = seasons.map((season) => seasonUtilisation(rows, { season, ...options }));
  const readable = bySeason.filter((s) => s.readable);
  const enough = readable.length >= minSeasonsToQuote;
  const values = (key) => readable.map((s) => s[key]);
  const range = (key) => (readable.length
    ? { low: Math.min(...values(key)), high: Math.max(...values(key)) } : null);

  return {
    programme: rows[0]?.college_name ?? null,
    sport: rows[0]?.sport ?? null,
    seasons: bySeason,
    seasonsObserved: readable.length,
    seasonsOnFile: bySeason.filter((s) => s.rosterPlayers > 0).length,
    readableSeasons: readable.map((s) => s.season),
    unreadableSeasons: bySeason.filter((s) => s.rosterPlayers > 0 && !s.readable)
      .map((s) => ({ season: s.season, reason: s.reason })),
    medianTop11Share: enough ? median(values('top11MinuteShare')) : null,
    medianTop14Share: enough ? median(values('top14MinuteShare')) : null,
    medianTop18Share: enough ? median(values('top18MinuteShare')) : null,
    rangeTop11Share: range('top11MinuteShare'),
    rangeTop14Share: range('top14MinuteShare'),
    rangeTop18Share: range('top18MinuteShare'),
    medianPlayersWith200Plus: enough ? median(values('playersWith200PlusMinutes')) : null,
    medianPlayersWith600Plus: enough ? median(values('playersWith600PlusMinutes')) : null,
    medianRosterPlayers: enough ? median(readable.map((s) => s.rosterPlayers)) : null,
    /**
     * Seasons whose minutes do not add up to the matches they claim. Named so
     * a reader can discount them, never removed.
     */
    implausibleSeasons: readable.filter((s) => s.teamMinutesPlausible === false)
      .map((s) => ({ season: s.season, ratio: s.teamMinuteRatio })),
    /**
     * One readable season, held apart from history rather than averaged into
     * one.
     *
     * NAIA is the reason. 111 men's and 120 women's NAIA programmes have
     * exactly one season carrying minutes — the acquisition only reaches 2025
     * there — and a median of one season is not a median. Calling it a
     * programme history would be false; refusing it entirely throws away the
     * only measured season 231 programmes have. So it is exposed as what it
     * is, and `suppressed` stays true so nothing treats it as a history.
     */
    singleSeasonObservation: readable.length === 1 ? {
      season: readable[0].season,
      basis: 'one readable season, not a programme history',
      top11MinuteShare: readable[0].top11MinuteShare,
      top14MinuteShare: readable[0].top14MinuteShare,
      top18MinuteShare: readable[0].top18MinuteShare,
      playersWith200PlusMinutes: readable[0].playersWith200PlusMinutes,
      playersWith600PlusMinutes: readable[0].playersWith600PlusMinutes,
      rosterPlayers: readable[0].rosterPlayers,
    } : null,
    suppressed: !enough,
    suppressedReason: enough ? null
      : `only ${readable.length} of ${bySeason.filter((s) => s.rosterPlayers > 0).length || seasons.length} seasons on file carry enough published minutes to read a distribution`,
  };
}

export { median as utilisationMedian };
