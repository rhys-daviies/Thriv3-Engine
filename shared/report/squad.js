/**
 * Minute concentration and years of study, read for one programme and one
 * report.
 *
 * Pure derivation over `programmeUtilisation` and `programmeExperience` and
 * the pool spreads beside them. Nothing here touches a database and nothing
 * renders. Same contract as `buildReportSummary`, `buildLifecycleSummary` and
 * `buildPressureSummary`.
 *
 * THE TWO ARE ONE MODULE because they answer one question in two halves —
 * how widely the minutes were spread, and who was far enough through college
 * to take them — and because a report that showed either alone would invite
 * the wrong reading. A narrow distribution carried by fourth years and a
 * narrow distribution carried by second years are different programmes.
 *
 * NO BAND, and for a sharper reason than Phase 7's. There the quartiles
 * collapsed onto each other. Here they separate cleanly — no degenerate cell,
 * 0.5% of programmes tied on a boundary — and the concentration figure is
 * robust to individual players: moving one player by 100 minutes changes a
 * quartile band for only 2–6% of programmes. What breaks it is the SEASON.
 * The pool's middle half is 5.5 percentage points wide in the men's game,
 * while a single programme's own season-to-season range has a median of 8.8
 * points and a 90th percentile of 15. A programme varies more between its own
 * seasons than the entire middle half of the pool is wide, so dropping one
 * readable season moves 41% of programmes across a quartile boundary — and
 * using the mean instead makes it worse, at 49%. A label resolving a 5.5-point
 * distinction with an estimator carrying 8.8 points of its own noise is a
 * label about which seasons happened to be scraped.
 *
 * So the seasons, the programme's median, and the pool's median and middle
 * half are exposed, and a sentence built from those is checkable.
 *
 * NEITHER HALF INFERS ANYTHING. Not coaching, not squad quality, not why
 * anyone played, not whether a broad or a narrow distribution is better, and
 * not what an athlete will get.
 */
import { programmeUtilisation, MIN_SEASONS_TO_QUOTE } from '../lifecycle/utilisation.js';
import { programmeExperience, EXPERIENCE_GROUPS } from '../lifecycle/experience.js';

/** A division needs this many programmes before it is its own pool. */
export const MIN_POOL_PROGRAMMES = 20;

export const BANDING_REFUSED = Object.freeze({
  available: false,
  reason: 'a programme varies more between its own seasons (median range 8.8 points) '
    + 'than the pool’s middle half is wide (5.5 points), so a category would describe '
    + 'which seasons were scraped rather than how the programme distributes minutes',
});

const spreadOf = (s) => (s ? {
  programmes: s.n,
  p10: s.p10, p25: s.p25, median: s.median, p75: s.p75, p90: s.p90,
  middleHalf: { low: s.p25, high: s.p75 },
} : null);

/** A division's cell, falling back to every division in the sport. */
function cellFor(table, division) {
  if (!table) return { cell: null, scope: null };
  const own = table[division] ?? null;
  if (own && own.programmes >= MIN_POOL_PROGRAMMES) return { cell: own, scope: division };
  const all = table.ALL ?? null;
  return all ? { cell: all, scope: 'all divisions in this sport' } : { cell: null, scope: null };
}

/**
 * One programme's minute concentration, season by season, against the pool.
 */
export function utilisationFor(rows, { pool = null, division = null } = {}) {
  const u = programmeUtilisation(rows);
  const { cell, scope } = cellFor(pool?.utilisation, division);
  return {
    available: !u.suppressed,
    reason: u.suppressedReason,
    seasons: u.seasons.map((s) => ({
      season: s.season,
      readable: s.readable,
      reason: s.reason,
      rosterPlayers: s.rosterPlayers,
      measuredPlayers: s.measuredPlayers,
      playersWithAnyMinutes: s.playersWithAnyMinutes,
      playersWith200PlusMinutes: s.playersWith200PlusMinutes,
      playersWith600PlusMinutes: s.playersWith600PlusMinutes,
      totalMeasuredTeamMinutes: s.totalMeasuredTeamMinutes,
      top1MinuteShare: s.top1MinuteShare,
      top5MinuteShare: s.top5MinuteShare,
      top11MinuteShare: s.top11MinuteShare,
      top14MinuteShare: s.top14MinuteShare,
      top18MinuteShare: s.top18MinuteShare,
      teamMinuteRatio: s.teamMinuteRatio,
      teamMinutesPlausible: s.teamMinutesPlausible,
    })),
    seasonsObserved: u.seasonsObserved,
    readableSeasons: u.readableSeasons,
    unreadableSeasons: u.unreadableSeasons,
    medianTop11Share: u.medianTop11Share,
    medianTop14Share: u.medianTop14Share,
    medianTop18Share: u.medianTop18Share,
    rangeTop11Share: u.rangeTop11Share,
    rangeTop14Share: u.rangeTop14Share,
    rangeTop18Share: u.rangeTop18Share,
    medianPlayersWith200Plus: u.medianPlayersWith200Plus,
    medianPlayersWith600Plus: u.medianPlayersWith600Plus,
    medianRosterPlayers: u.medianRosterPlayers,
    singleSeasonObservation: u.singleSeasonObservation,
    implausibleSeasons: u.implausibleSeasons,
    pool: cell ? {
      top11MinuteShare: spreadOf(cell.top11MinuteShare),
      top14MinuteShare: spreadOf(cell.top14MinuteShare),
      top18MinuteShare: spreadOf(cell.top18MinuteShare),
      playersWith200Plus: spreadOf(cell.playersWith200Plus),
      playersWith600Plus: spreadOf(cell.playersWith600Plus),
    } : null,
    poolScope: cell ? scope : null,
    banding: BANDING_REFUSED,
    /**
     * The single figure a page should never print without the roster beside
     * it. Lake Erie names 62 players and 28 have minutes; "45% of the roster
     * appeared" is a fact about a page. It is here so the model can be asked
     * for it and so nothing has to recompute it, marked for what it is.
     */
    rosterAppearanceShare: {
      unreliable: true,
      reason: 'the denominator is the roster page, which some programmes use to name '
        + 'players who were never in the matchday squad',
      seasons: u.seasons.filter((s) => s.readable && s.rosterPlayers).map((s) => ({
        season: s.season,
        share: s.playersWithAnyMinutes / s.rosterPlayers,
      })),
    },
  };
}

/**
 * One programme's years of study, with the roster half and the minutes half
 * gated separately.
 */
export function experienceFor(rows, { pool = null, division = null } = {}) {
  const e = programmeExperience(rows);
  const { cell, scope } = cellFor(pool?.experience, division);
  return {
    compositionAvailable: e.compositionAvailable,
    loadAvailable: e.loadAvailable,
    compositionReason: e.compositionReason,
    loadReason: e.loadReason,
    compositionSeasons: e.compositionSeasons,
    loadSeasons: e.loadSeasons,
    rosterSeasons: e.rosterSeasons,
    measuredMinutes: e.measuredMinutes,
    seasons: e.seasons.map((s) => ({
      season: s.season,
      rosterPlayers: s.rosterPlayers,
      compositionReadable: s.compositionReadable,
      loadReadable: s.loadReadable,
      reason: s.reason,
      classShare: s.classShare,
      groups: s.groups,
    })),
    groups: e.groups.map((g) => ({
      ...g,
      poolRosterShare: spreadOf(cell?.groups?.[g.group]?.rosterShare),
      poolMinuteShare: spreadOf(cell?.groups?.[g.group]?.minuteShare),
    })),
    yearFourPlus: e.yearFourPlus,
    singleSeasonObservation: e.singleSeasonObservation,
    poolScope: cell ? scope : null,
    banding: BANDING_REFUSED,
    groupOrder: EXPERIENCE_GROUPS,
  };
}

/**
 * Both halves, plus the one relationship a report needs stated rather than
 * inferred: roster share and minute share are different quantities, and the
 * gap between them is the finding.
 */
export function buildSquadSummary({ rows, pool = null, division = null } = {}) {
  const utilisation = utilisationFor(rows ?? [], { pool, division });
  const experience = experienceFor(rows ?? [], { pool, division });
  return {
    utilisation,
    experience,
    /**
     * Where a year of study holds more or less of the minutes than of the
     * roster. Not a rate and not a verdict — the two shares are printed
     * already, and this names the arithmetic so two pages cannot disagree
     * about it.
     */
    loadVersusRoster: experience.loadAvailable
      ? experience.groups
        .filter((g) => g.group !== 'UNKNOWN' && g.rosterShare != null && g.minuteShare != null)
        .map((g) => ({
          group: g.group,
          label: g.label,
          rosterShare: g.rosterShare,
          minuteShare: g.minuteShare,
          difference: g.minuteShare - g.rosterShare,
        }))
      : null,
    minSeasonsToQuote: MIN_SEASONS_TO_QUOTE,
    banding: BANDING_REFUSED,
  };
}
