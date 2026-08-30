/**
 * Track B — how a player's minutes move across the seasons on file.
 *
 * Every figure here carries its denominator, and the denominators SHRINK as
 * the horizon lengthens. A programme's year-three rate is computed from the
 * players who could have had a year three at all — those first seen early
 * enough for the data to contain one — and that cohort is a fraction of the
 * year-one cohort. Reporting the two side by side without their counts would
 * compare a rate over 300 players with a rate over 40.
 *
 * `null` minutes are never zero. A season with no published minutes is
 * excluded from every trajectory calculation and counted separately, because
 * a player who did not play and a player nobody measured produce the same
 * blank and mean opposite things.
 */
import { roleBand, ROLE_BANDS, STARTER_MINUTES } from './lifecycle.js';

/**
 * The minimum cohort a rate may be quoted over.
 *
 * Below this the trajectory is reported as counts. A share of four reads far
 * more confidently than it deserves to, which is the rule the rest of this
 * codebase already applies to freshman ladders and vacancy openings.
 */
export const MIN_COHORT = 8;

/**
 * One player's trajectory at one programme.
 *
 * `seasonIndex` counts observed seasons from their first appearance, so a
 * player missing an intermediate season still has an honest year number: the
 * gap is recorded rather than closed up.
 */
export function trajectoryOf(life) {
  const first = Number(life.firstSeason);
  const points = life.seasons.map((s) => ({
    season: s.season,
    yearsSinceFirst: Number(s.season) - first,
    seasonIndex: null,
    classLabel: s.classLabel,
    canonicalPosition: s.canonicalPosition,
    minutes: s.minutes,
    games: s.games,
    starts: s.starts,
    measured: s.measured,
    roleBand: s.roleBand,
  }));
  points.forEach((p, i) => { p.seasonIndex = i; });

  const measured = points.filter((p) => p.measured);
  const firstStarter = measured.find((p) => p.minutes >= STARTER_MINUTES) ?? null;

  // Year-over-year change, only between two ADJACENT seasons that are both
  // measured. A gap year or an unmeasured season breaks the chain rather than
  // being bridged.
  const changes = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a.measured || !b.measured) continue;
    if (Number(b.season) !== Number(a.season) + 1) continue;
    changes.push({
      from: a.season, to: b.season,
      fromMinutes: a.minutes, toMinutes: b.minutes,
      delta: b.minutes - a.minutes,
      fromBand: a.roleBand, toBand: b.roleBand,
    });
  }

  const last = points[points.length - 1];
  return {
    playerKey: life.playerKey,
    name: life.name,
    programme: life.programme,
    position: life.position,
    entryType: life.entryType,
    firstSeason: life.firstSeason,
    lastSeason: life.lastSeason,
    seasonsObserved: points.length,
    measuredSeasons: measured.length,
    gapSeasons: life.gapSeasons,
    points,
    changes,
    firstStarterSeason: firstStarter?.season ?? null,
    seasonsUntilStarter: firstStarter ? firstStarter.yearsSinceFirst : null,
    everStarter: Boolean(firstStarter),
    // "Final observed role" is exactly that: the last season on file. It is
    // not a career outcome — the data may simply stop.
    finalRoleBand: last.roleBand,
    finalSeasonMeasured: last.measured,
  };
}

/**
 * Programme-level development, with every denominator attached.
 *
 * `horizonCohorts` is the important part. A player first seen in 2025 cannot
 * have a year-two observation in a dataset that ends in 2026, so they are not
 * in the year-two denominator at all. Leaving them in would depress every
 * later-year rate by exactly the share of recent arrivals.
 */
export function developmentSummary(lifecycles, {
  lastSeason = '2026', lastMeasuredSeason = '2025', minCohort = MIN_COHORT,
} = {}) {
  const trajectories = lifecycles.map(trajectoryOf);
  const last = Number(lastSeason);
  const lastMeasured = Number(lastMeasuredSeason);

  /**
   * Two horizons, because the two questions end in different seasons.
   *
   * "Did they reach a starter's season by year n" can only be answered where a
   * season with MINUTES exists — the forward roster carries names and no
   * minutes at all, so a player first seen in 2025 has no answerable year two.
   * "Were they still here after n years" can be answered from the forward
   * roster, because being on it is the answer.
   *
   * Using one horizon for both silently pushes every recent arrival into the
   * starter-rate denominator as a miss.
   */
  const couldReachMeasured = (n) => trajectories.filter((t) => Number(t.firstSeason) + n <= lastMeasured);
  const couldReturn = (n) => trajectories.filter((t) => Number(t.firstSeason) + n <= last);

  const starterBy = (n) => {
    const cohort = couldReachMeasured(n);
    const hit = cohort.filter((t) => t.points.some((p) => p.measured
      && p.yearsSinceFirst <= n && p.minutes >= STARTER_MINUTES));
    return {
      year: n + 1,
      denominator: cohort.length,
      reached: hit.length,
      share: cohort.length >= minCohort ? hit.length / cohort.length : null,
      // Stated rather than implied: a null share means the cohort was too thin.
      suppressed: cohort.length < minCohort,
    };
  };

  const retention = (n) => {
    const cohort = couldReturn(n);
    const stayed = cohort.filter((t) => t.points.some((p) => p.yearsSinceFirst === n));
    return {
      afterYears: n,
      denominator: cohort.length,
      stillObserved: stayed.length,
      share: cohort.length >= minCohort ? stayed.length / cohort.length : null,
      suppressed: cohort.length < minCohort,
    };
  };

  // Time to a starter's season, over players who reached one at all.
  const times = trajectories.filter((t) => t.seasonsUntilStarter != null)
    .map((t) => t.seasonsUntilStarter).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : null;

  // Band-to-band movement across every adjacent measured pair.
  const transitions = new Map();
  for (const t of trajectories) {
    for (const c of t.changes) {
      const k = `${c.fromBand}→${c.toBand}`;
      transitions.set(k, (transitions.get(k) ?? 0) + 1);
    }
  }
  const fromBandTotals = new Map();
  for (const [k, n] of transitions) {
    const from = k.split('→')[0];
    fromBandTotals.set(from, (fromBandTotals.get(from) ?? 0) + n);
  }
  const bandProgression = ROLE_BANDS.map((from) => {
    const total = fromBandTotals.get(from) ?? 0;
    return {
      from,
      observations: total,
      to: ROLE_BANDS.map((to) => ({
        band: to,
        count: transitions.get(`${from}→${to}`) ?? 0,
        share: total >= minCohort ? (transitions.get(`${from}→${to}`) ?? 0) / total : null,
      })),
      suppressed: total < minCohort,
    };
  });

  const everStarter = trajectories.filter((t) => t.everStarter).length;
  const anyMeasured = trajectories.filter((t) => t.measuredSeasons > 0).length;

  return {
    players: trajectories.length,
    playersWithAnyMeasuredSeason: anyMeasured,
    playersWithNoMeasuredSeason: trajectories.length - anyMeasured,
    starterLevelByYear: [0, 1, 2, 3].map(starterBy),
    retentionByYear: [1, 2, 3].map(retention),
    medianSeasonsUntilStarter: median,
    seasonsUntilStarterSample: times.length,
    everReachedStarter: {
      reached: everStarter,
      denominator: anyMeasured,
      share: anyMeasured >= minCohort ? everStarter / anyMeasured : null,
      suppressed: anyMeasured < minCohort,
    },
    bandProgression,
    trajectories,
  };
}
