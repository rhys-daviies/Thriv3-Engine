/**
 * What a first year at a programme actually looks like.
 *
 * The question a recruit is really asking is "will I play?", and the average
 * freshman's minutes is the one number that cannot answer it. Freshman
 * playing time is bimodal almost everywhere: at Bentley in 2025 three
 * freshmen played over a thousand minutes, five played none, and the mean of
 * 340 describes nobody on the roster.
 *
 * So nothing here reports a mean. The unit is the *ladder* — freshmen ranked
 * by minutes — because a recruit can place themselves on it ("am I their best
 * incoming forward, or their fourth?") in a way they cannot place themselves
 * against an average.
 */

import { readClassYear } from './classYear.js';

/**
 * Bands, not a continuum, because the difference between 850 and 950 minutes
 * is nothing and the difference between 40 and 400 is a season.
 *
 * `impact` sits at the same 600 the rest of the product calls a starter, so a
 * freshman who clears it is a freshman who took a place in the XI.
 */
export const MINUTE_BANDS = [
  { key: 'impact', label: 'Played like a starter', min: 600 },
  { key: 'rotation', label: 'In the rotation', min: 200 },
  { key: 'fringe', label: 'Fringe minutes', min: 1 },
  { key: 'none', label: 'Did not play', min: 0 },
];

export function bandFor(minutes) {
  const m = Number(minutes) || 0;
  return MINUTE_BANDS.find((b) => m >= b.min && (m > 0 || b.key === 'none')).key;
}

/** A true freshman: first year on campus, not a redshirt in their second. */
export function isTrueFreshman(row) {
  const read = readClassYear(row?.class_year_label, { season: row?.season });
  return read.klass === 'FRESHMAN' && !read.redshirt;
}

/** A redshirt freshman — on campus a year already, and that is its own answer. */
export function isRedshirtFreshman(row) {
  const read = readClassYear(row?.class_year_label, { season: row?.season });
  return read.klass === 'FRESHMAN' && read.redshirt;
}

const minutesOf = (row) => Number(row?.minutes_played) || 0;

/**
 * A row whose minutes were never recorded, as opposed to a player who did not
 * appear. `minutes_played` cannot tell them apart — the importer coerces a
 * blank to 0 — but `games_played` is stored with no such fallback, so a row
 * claiming zero minutes across games it played is a gap, not a benching.
 */
export function minutesAreMissing(row) {
  if (minutesOf(row) > 0) return false;
  const games = row?.games_played;
  return games === null || games === undefined || Number(games) > 0;
}

/**
 * One programme's freshman intake for one season, ranked.
 *
 * Rows with no minutes on record are counted and reported separately rather
 * than dropped or read as zeros: a programme whose stats page carries no
 * minutes column would otherwise look like one that plays no freshmen.
 */
export function freshmanSeason(rows, { season, position = null } = {}) {
  const cohort = rows
    .filter((r) => r.season === season && isTrueFreshman(r))
    .filter((r) => !position || String(r.position || '').toUpperCase() === String(position).toUpperCase());

  const measured = cohort.filter((r) => !minutesAreMissing(r));
  const unknown = cohort.length - measured.length;

  const ladder = measured
    .map((r) => ({
      name: r.player_name,
      position: r.position,
      minutes: minutesOf(r),
      gamesPlayed: Number(r.games_played) || 0,
      gamesStarted: Number(r.games_started) || 0,
      band: bandFor(minutesOf(r)),
    }))
    .sort((a, b) => b.minutes - a.minutes || (a.name || '').localeCompare(b.name || ''))
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const bands = Object.fromEntries(MINUTE_BANDS.map((b) => [b.key, 0]));
  for (const p of ladder) bands[p.band] += 1;

  const redshirted = rows.filter((r) => r.season === season && isRedshirtFreshman(r)).length;

  return {
    season,
    intake: cohort.length,
    measured: measured.length,
    unknown,
    ladder,
    bands,
    played: ladder.filter((p) => p.minutes > 0).length,
    totalMinutes: ladder.reduce((sum, p) => sum + p.minutes, 0),
    redshirted,
  };
}

/** The share of a squad's whole season that went to its freshmen. */
export function freshmanShare(rows, { season }) {
  const inSeason = rows.filter((r) => r.season === season && !minutesAreMissing(r));
  const total = inSeason.reduce((sum, r) => sum + minutesOf(r), 0);
  if (!total) return null;
  const fresh = inSeason.filter(isTrueFreshman).reduce((sum, r) => sum + minutesOf(r), 0);
  return fresh / total;
}

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * What the Nth-best freshman gets here, across every season on file.
 *
 * The one projection a recruit can actually act on. An average says what
 * happened to a group they will not be a member of; this says what happened
 * to the position they might occupy. A player told they are a programme's top
 * incoming defender can read rank 1; one who suspects they are third can read
 * rank 3, and decide accordingly.
 */
export function ladderByRank(seasons, { maxRank = 8 } = {}) {
  const out = [];
  for (let rank = 1; rank <= maxRank; rank += 1) {
    const atRank = seasons
      .map((s) => s.ladder.find((p) => p.rank === rank))
      .filter(Boolean);
    if (!atRank.length) break;
    const minutes = atRank.map((p) => p.minutes);
    out.push({
      rank,
      seasonsWithThisMany: atRank.length,
      median: median(minutes),
      low: Math.min(...minutes),
      high: Math.max(...minutes),
      band: bandFor(median(minutes)),
    });
  }
  return out;
}

/**
 * Every season, plus what they say together.
 *
 * Consistency is the point of using four years rather than one. A programme
 * that started two freshmen every season is telling a recruit something a
 * programme that did it once, in a season with an injury crisis, is not.
 */
export function freshmanProfile(rows, { seasons, position = null, maxRank = 8 } = {}) {
  const perSeason = seasons
    .map((season) => ({
      ...freshmanSeason(rows, { season, position }),
      shareOfSquadMinutes: position ? null : freshmanShare(rows, { season }),
    }))
    .filter((s) => s.intake > 0);

  if (!perSeason.length) return null;

  const impactCounts = perSeason.map((s) => s.bands.impact);
  return {
    seasons: perSeason,
    position,
    seasonsObserved: perSeason.length,
    // How reliably this programme gives a freshman a starter's season.
    seasonsWithAnImpactFreshman: impactCounts.filter((n) => n > 0).length,
    medianImpactPerSeason: median(impactCounts),
    medianIntake: median(perSeason.map((s) => s.intake)),
    medianPlayed: median(perSeason.map((s) => s.played)),
    byRank: ladderByRank(perSeason, { maxRank }),
    unknownRows: perSeason.reduce((sum, s) => sum + s.unknown, 0),
  };
}
