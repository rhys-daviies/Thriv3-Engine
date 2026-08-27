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
export function ladderByRank(seasons, { maxRank = 8, weights = null } = {}) {
  const out = [];
  for (let rank = 1; rank <= maxRank; rank += 1) {
    const atRank = seasons
      .map((s) => {
        const p = s.ladder.find((x) => x.rank === rank);
        return p ? { minutes: p.minutes, season: s.season } : null;
      })
      .filter(Boolean);
    if (!atRank.length) break;
    const minutes = atRank.map((p) => p.minutes);
    const w = weights
      ? atRank.map((p) => (weights[p.season] ?? weights[Number(p.season)] ?? 1))
      : null;
    out.push({
      rank,
      seasonsWithThisMany: atRank.length,
      median: w ? weightedMedian(minutes, w) : median(minutes),
      low: Math.min(...minutes),
      high: Math.max(...minutes),
      band: bandFor(w ? weightedMedian(minutes, w) : median(minutes)),
      // Stated rather than implied, so a caller can say which coach's
      // programme the number actually describes.
      weighted: Boolean(w),
    });
  }
  return out;
}

/**
 * A median that respects per-season weight.
 *
 * Weighting rather than filtering, because a programme whose coach changed
 * last year would otherwise be left with a single season and a confidence it
 * has not earned. The old seasons still count — they describe the institution
 * — they just count less than the ones the current coach actually ran.
 */
export function weightedMedian(values, weights) {
  const pairs = values
    .map((v, i) => ({ v, w: Number(weights[i]) || 0 }))
    .filter((p) => p.w > 0)
    .sort((a, b) => a.v - b.v);
  if (!pairs.length) return median(values);
  const total = pairs.reduce((sum, p) => sum + p.w, 0);
  let acc = 0;
  for (const p of pairs) {
    acc += p.w;
    if (acc >= total / 2) return p.v;
  }
  return pairs[pairs.length - 1].v;
}

/**
 * Thresholds, in percentage points of a squad's minutes going to freshmen.
 *
 * Both derived from the pool rather than picked: across the 1,369 programmes
 * with credible four-season data, a >=10-point gap between the first two
 * seasons and the last two separates 33% of them, and a season-to-season
 * standard deviation >=8 marks a further 17% as genuinely unsettled.
 */
export const STEP_POINTS = 10;
export const SPREAD_POINTS = 8;

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const stdev = (a) => (a.length < 2 ? 0 : Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2))));

/**
 * What kind of programme this is, once the coach is known.
 *
 * The minutes alone cannot tell these apart, and they mean opposite things to
 * a recruit. Bentley ran 4%, 2%, 26%, 32% under two coaches — a regime change,
 * and only the last three seasons describe what she would join. Hofstra ran
 * 2%, 0%, 8%, 18% under one coach for all four — that is not a change to
 * discount, it is a programme whose freshman policy is genuinely unsettled.
 *
 * The new coach's first season is excluded from their side of the comparison:
 * it is played with the squad the previous coach recruited, which is exactly
 * why Bentley's first Dacey season reads lower than Lukis's last.
 */
export function classifyProgramme(profile, tenure) {
  if (!profile || !profile.seasons?.length) return null;

  const shares = profile.seasons
    .map((s) => ({ season: Number(s.season), pct: (s.shareOfSquadMinutes ?? 0) * 100 }))
    .filter((s) => Number.isFinite(s.season))
    .sort((a, b) => a.season - b.season);
  if (shares.length < 2) {
    return { verdict: 'too-few-seasons', spread: 0, step: null, weightFrom: null,
      note: 'one season on file — not enough to describe a pattern' };
  }

  const spread = stdev(shares.map((s) => s.pct));
  const half = Math.floor(shares.length / 2);
  const early = shares.slice(0, half).map((s) => s.pct);
  const late = shares.slice(shares.length - half).map((s) => s.pct);
  const step = mean(late) - mean(early);
  const stepped = Math.abs(step) >= STEP_POINTS;

  const base = { spread, step, coach: tenure?.current?.coach ?? null };

  if (!tenure || !tenure.current) {
    return { ...base, verdict: 'coach-unknown', weightFrom: null,
      note: 'no coach on file, so these seasons cannot be attributed to anyone' };
  }

  const changed = tenure.changes.length > 0;
  const since = tenure.current.since;

  // A programme that had nobody in the job is not a programme with a
  // consistent philosophy. South Carolina State printed TBA as head coach for
  // 2022 and 2023 and its freshman share ran 69% and 41% — the highest in the
  // pool — before collapsing once a permanent coach arrived. Read as "one
  // coach throughout" that becomes a policy shift; read correctly it is a
  // programme that was being held together, which is the thing a recruit
  // actually needs to know.
  const vacantEarly = tenure.gaps.filter((g) => g < since);
  if (vacantEarly.length) {
    return { ...base, verdict: 'vacancy-in-window', since, weightFrom: since,
      vacantSeasons: vacantEarly,
      note: `no permanent head coach on file for ${vacantEarly.join(', ')} — only the seasons since ${since} describe the programme as it is now` };
  }

  if (changed) {
    const before = shares.filter((s) => s.season < since).map((s) => s.pct);
    // The new coach's first season is excluded from their side: it is played
    // with the squad the previous coach recruited, which is exactly why
    // Bentley's first Dacey season read lower than Lukis's last.
    const after = shares.filter((s) => s.season > since).map((s) => s.pct);
    if (!before.length || !after.length) {
      return { ...base, verdict: 'change-too-recent', since, weightFrom: since,
        note: 'the coach changed too recently to compare the two spells — the newest season is the only guide' };
    }
    const acrossChange = mean(after) - mean(before);
    return Math.abs(acrossChange) >= STEP_POINTS
      ? { ...base, verdict: 'regime-change', step: acrossChange, since, weightFrom: since,
          note: 'the coach changed and the pattern changed with them — the earlier seasons describe a different programme' }
      : { ...base, verdict: 'continuity-through-change', step: acrossChange, since, weightFrom: null,
          note: 'the coach changed but the pattern did not — this looks structural, so every season counts' };
  }

  // One coach throughout. A step here is not a hire, it is the same person
  // changing their mind — Hofstra ran 2%, 0%, 8%, 18% under Richard Nuttall
  // for all four years. Its spread of 7.0 sits under the volatility
  // threshold, so without checking the step it would have been filed as
  // steady, which is the opposite of what a recruit needs to hear.
  if (stepped) {
    return { ...base, verdict: 'policy-shift-same-coach',
      weightFrom: shares[shares.length - half].season,
      note: 'the same coach, but the recent seasons look different from the early ones — weight the recent ones' };
  }
  if (spread >= SPREAD_POINTS) {
    return { ...base, verdict: 'erratic-same-coach', weightFrom: null,
      note: 'one coach throughout, and the freshman policy swings season to season — treat any single year with caution' };
  }
  return { ...base, verdict: 'steady', weightFrom: null,
    note: 'one coach, a consistent pattern — every season counts and the projection is as firm as this gets' };
}

/**
 * Per-season weights implied by a classification.
 *
 * `weightFrom` unifies the two reasons a season may no longer describe the
 * programme a recruit would join — a new coach, or the same coach changing
 * approach. Everything from that season counts fully; everything before it
 * counts less, but still counts.
 */
export function weightsFromVerdict(verdict, seasons) {
  if (!verdict?.weightFrom) return null;
  const out = {};
  for (const s of seasons) {
    const season = Number(s.season ?? s);
    out[season] = season >= verdict.weightFrom ? 1 : 0.35;
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
