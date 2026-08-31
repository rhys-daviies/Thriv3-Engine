/**
 * Which stages of college experience have carried a programme's minutes.
 *
 * TWO QUESTIONS, and keeping them apart is the point of the module. Who is ON
 * the roster by year of study needs only a class label, so it can be answered
 * at a programme whose stats page was never read. Who took the MINUTES needs
 * the minutes. Albertus Magnus can answer the first and not the second, and a
 * model that fused them would lose a readable answer to a different question.
 * `composition` and `load` are therefore separate, separately gated, and
 * separately labelled.
 *
 * WHAT IT IS NOT. It does not measure coaching, does not say whether a young
 * or an old squad is better, and cannot say why anyone played. A senior-heavy
 * minute share can be a settled side or a thin recruiting class, and roster
 * data does not separate them.
 *
 * NO REDSHIRT DIMENSION. `classRank` ranks a player by the class their label
 * NAMES, so a redshirt sophomore is a second year here exactly as the roster
 * page says. Whether they redshirted is a different question and is
 * deliberately not asked: it would double the groups, halve every denominator,
 * and answer nothing a family asked.
 *
 * ONE CLASS READER. `classRank` has delegated to `readClassYear` since Phase
 * 6A, so `Fy.`, `1st`, `Second Year` and `Rf.` all read here. Before that, 161
 * programmes had first-years this layer could not see, and an experience
 * profile built on the old reader would have shown Harvard with no first years
 * at all.
 */
import { classRank } from './lifecycle.js';
import { minutesCoverage } from './readable.js';
import { STARTER_MINUTES } from './lifecycle.js';
import { ROTATION_MINUTES, MEASURED_SEASONS, MIN_SEASONS_TO_QUOTE } from './utilisation.js';

/**
 * The groups, in order of study, plus the two the data forces.
 *
 * GRADUATE is held out of YEAR_4 rather than folded into it because the
 * roster distinguishes them and because they are only 4.7% of men's and 3.7%
 * of women's roster-seasons — folded in, they would be invisible; left out,
 * the four-year ladder would not add up. `yearFourPlus` is the coarse view for
 * a caller that wants one.
 *
 * UNKNOWN is a group, not a rounding error. 1.6% of men's and 2.1% of women's
 * rows carry no readable class, and assigning them would put a number on a
 * page that the roster does not support.
 */
export const EXPERIENCE_GROUPS = Object.freeze(['YEAR_1', 'YEAR_2', 'YEAR_3', 'YEAR_4', 'GRADUATE', 'UNKNOWN']);

/** The four-plus view: a final-year player and a graduate student together. */
export const YEAR_FOUR_PLUS = Object.freeze(['YEAR_4', 'GRADUATE']);

export const GROUP_LABEL = Object.freeze({
  YEAR_1: 'first year',
  YEAR_2: 'second year',
  YEAR_3: 'third year',
  YEAR_4: 'fourth year',
  GRADUATE: 'graduate or fifth year',
  UNKNOWN: 'class not readable',
});

const RANK_TO_GROUP = Object.freeze({ 1: 'YEAR_1', 2: 'YEAR_2', 3: 'YEAR_3', 4: 'YEAR_4', 5: 'GRADUATE' });

/** The experience group a roster row belongs to, or UNKNOWN. */
export const experienceGroup = (row) => RANK_TO_GROUP[classRank(row?.class_year_label)] ?? 'UNKNOWN';

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const emptyGroup = (group) => ({
  group,
  label: GROUP_LABEL[group],
  rosterPlayers: 0,
  rosterShare: null,
  measuredPlayers: 0,
  totalMinutes: null,
  minuteShare: null,
  playersWith200Plus: null,
  playersWith600Plus: null,
});

/**
 * One programme-season split by year of study, with the two halves gated
 * separately.
 *
 * `compositionReadable` asks only whether there is a roster and whether its
 * class labels can mostly be read. `loadReadable` additionally asks whether
 * the minutes can be. A season can be the first and not the second, and that
 * is the common case at Division III.
 */
export function seasonExperience(rows, { season, minSquad = 10, minClassShare = 0.5 } = {}) {
  const roster = rows.filter((r) => String(r.season) === String(season));
  const coverage = minutesCoverage(roster);
  const withClass = roster.filter((r) => experienceGroup(r) !== 'UNKNOWN').length;
  const classShare = roster.length ? withClass / roster.length : null;

  const compositionReadable = roster.length >= minSquad && classShare >= minClassShare;
  const measured = roster.filter((r) => r.minutes_played != null);
  const total = measured.reduce((sum, r) => sum + Number(r.minutes_played), 0);
  const loadReadable = compositionReadable && coverage.readable && total > 0;

  const groups = EXPERIENCE_GROUPS.map((group) => {
    const mine = roster.filter((r) => experienceGroup(r) === group);
    const mineMeasured = mine.filter((r) => r.minutes_played != null);
    const minutes = mineMeasured.reduce((sum, r) => sum + Number(r.minutes_played), 0);
    if (!mine.length && !compositionReadable) return emptyGroup(group);
    return {
      group,
      label: GROUP_LABEL[group],
      rosterPlayers: mine.length,
      rosterShare: compositionReadable && roster.length ? mine.length / roster.length : null,
      measuredPlayers: mineMeasured.length,
      totalMinutes: loadReadable ? minutes : null,
      minuteShare: loadReadable ? minutes / total : null,
      playersWith200Plus: loadReadable
        ? mineMeasured.filter((r) => Number(r.minutes_played) >= ROTATION_MINUTES).length : null,
      playersWith600Plus: loadReadable
        ? mineMeasured.filter((r) => Number(r.minutes_played) >= STARTER_MINUTES).length : null,
    };
  });

  return {
    season: String(season),
    rosterPlayers: roster.length,
    measuredPlayers: measured.length,
    minutesCoverage: coverage,
    classShare,
    /** Who was here, by year of study. Needs a roster and its class labels. */
    compositionReadable,
    /** Who took the minutes. Needs those as well as a readable minutes column. */
    loadReadable,
    reason: compositionReadable ? (loadReadable ? null
      : 'the roster can be read by year of study, but too few of its minutes were published to say who played them')
      : (roster.length < minSquad ? 'no roster of readable size on file for this season'
        : 'too few of this roster’s class labels could be read'),
    totalMeasuredMinutes: loadReadable ? total : null,
    groups,
  };
}

/**
 * One programme's experience profile across every measured season.
 *
 * Season values are kept. The aggregate pools PLAYER-SEASONS rather than
 * averaging season shares, because a season with 38 players and a season with
 * 22 are not two equal observations of the same squad — and the median of the
 * season shares is exposed beside it for a caller that wants the typical
 * season instead of the pooled history.
 */
export function programmeExperience(rows, {
  seasons = MEASURED_SEASONS, minSeasonsToQuote = MIN_SEASONS_TO_QUOTE, ...options
} = {}) {
  const bySeason = seasons.map((season) => seasonExperience(rows, { season, ...options }));
  const composition = bySeason.filter((s) => s.compositionReadable);
  const load = bySeason.filter((s) => s.loadReadable);
  const enoughComposition = composition.length >= minSeasonsToQuote;
  const enoughLoad = load.length >= minSeasonsToQuote;

  const rosterSeasons = composition.reduce((sum, s) => sum + s.rosterPlayers, 0);
  const measuredMinutes = load.reduce((sum, s) => sum + s.totalMeasuredMinutes, 0);

  const groups = EXPERIENCE_GROUPS.map((group) => {
    const cSeasons = composition.map((s) => s.groups.find((g) => g.group === group));
    const lSeasons = load.map((s) => s.groups.find((g) => g.group === group));
    const rosterCount = cSeasons.reduce((sum, g) => sum + g.rosterPlayers, 0);
    const minutes = lSeasons.reduce((sum, g) => sum + (g.totalMinutes ?? 0), 0);
    return {
      group,
      label: GROUP_LABEL[group],
      rosterSeasons: rosterCount,
      rosterShare: enoughComposition && rosterSeasons ? rosterCount / rosterSeasons : null,
      medianSeasonRosterShare: enoughComposition
        ? median(cSeasons.map((g) => g.rosterShare).filter((v) => v != null)) : null,
      measuredPlayerSeasons: lSeasons.reduce((sum, g) => sum + g.measuredPlayers, 0),
      totalMinutes: enoughLoad ? minutes : null,
      minuteShare: enoughLoad && measuredMinutes ? minutes / measuredMinutes : null,
      medianSeasonMinuteShare: enoughLoad
        ? median(lSeasons.map((g) => g.minuteShare).filter((v) => v != null)) : null,
      playersWith200Plus: enoughLoad
        ? lSeasons.reduce((sum, g) => sum + (g.playersWith200Plus ?? 0), 0) : null,
      playersWith600Plus: enoughLoad
        ? lSeasons.reduce((sum, g) => sum + (g.playersWith600Plus ?? 0), 0) : null,
    };
  });

  const combine = (keys, field) => {
    const parts = groups.filter((g) => keys.includes(g.group)).map((g) => g[field]);
    return parts.some((v) => v == null) ? null : parts.reduce((sum, v) => sum + v, 0);
  };

  return {
    programme: rows[0]?.college_name ?? null,
    sport: rows[0]?.sport ?? null,
    seasons: bySeason,
    compositionSeasons: composition.map((s) => s.season),
    loadSeasons: load.map((s) => s.season),
    rosterSeasons,
    measuredMinutes: enoughLoad ? measuredMinutes : null,
    groups,
    /** The coarse four-plus view, for a caller that does not want five rows. */
    yearFourPlus: {
      group: 'YEAR_4_PLUS',
      label: 'fourth year or beyond',
      rosterShare: combine(YEAR_FOUR_PLUS, 'rosterShare'),
      minuteShare: combine(YEAR_FOUR_PLUS, 'minuteShare'),
      playersWith600Plus: combine(YEAR_FOUR_PLUS, 'playersWith600Plus'),
    },
    compositionAvailable: enoughComposition,
    loadAvailable: enoughLoad,
    /**
     * One readable season, for the same reason utilisation carries one: 183
     * men's and 193 women's NAIA programmes have a roster whose classes can be
     * read for exactly one season. It is an observation, said so, and
     * `compositionAvailable` stays false so nothing calls it a history.
     */
    singleSeasonObservation: (composition.length === 1 || load.length === 1) ? {
      compositionSeason: composition.length === 1 ? composition[0].season : null,
      loadSeason: load.length === 1 ? load[0].season : null,
      basis: 'one readable season, not a programme history',
      groups: (load.length === 1 ? load[0] : composition[0]).groups,
    } : null,
    // Two refusals, never merged: "we cannot see who was here" and "we can see
    // who was here but not who played" are different findings.
    compositionReason: enoughComposition ? null
      : `only ${composition.length} of ${seasons.length} seasons carry a roster whose class labels can be read`,
    loadReason: enoughLoad ? null
      : `only ${load.length} of ${seasons.length} seasons carry enough published minutes to say who played them`,
  };
}

export { median as experienceMedian };
