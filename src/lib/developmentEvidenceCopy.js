import { positionNoun } from '@shared/positions.js';

/**
 * Operator-facing presentation for the Philosophy development measurements.
 *
 * ALL FOUR KINDS ARE NEUTRAL, and that is the constraint this whole module is
 * built around. None of them is a top reason, none carries a polarity, and
 * none may be given one here. "Strong freshman development", "a real pathway",
 * "limited opportunity" are all sentences this screen could write fluently
 * from these numbers and none of them is licensed. The measurements say what
 * happened to earlier first-years; whether that is good news about this
 * athlete is the operator's call, not the interface's.
 *
 * THE CLASSIFIER IS NOT TRANSLATED. `PROGRAMME_DEVELOPMENT_PATTERN` carries a
 * `verdictKey` — eleven of them exist, `steady`, `regime-change`,
 * `erratic-same-coach` and so on — and the fact extractor's own note says the
 * key is not a sentence and must not be printed as one. It also carries
 * `verdictNote`, which IS a sentence, written by the analysis that made the
 * call. The note is rendered verbatim and the key never reaches the screen, so
 * nothing here has to decide what "policy-shift-same-coach" means.
 *
 * NOT RENDERED, deliberately: `spread` and `step`. They are the standard
 * deviation and swing the classifier compared against its own thresholds — the
 * inputs to the verdict, meaningless without the constants beside them, and
 * already summarised by the note.
 *
 * Each entry returns { headline, detail, ladder, seasons, cohort, band, scope }.
 */

const n = (v) => (Number.isFinite(v) ? String(v) : null);
const num = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-GB') : null);

/** A share the server computed, as a percentage. Never derived here. */
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : null);

/** A percentage the server already expressed as one (13.7 means 13.7%). */
const already = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : null);

/**
 * The measured window, stated honestly about gaps.
 *
 * A run of seasons is written as a span; a set with a hole in it is listed,
 * because 302 real windows are non-contiguous and "2022–2025" would claim a
 * season that was never read. The unread seasons are named separately —
 * `seasonsUnread` is the field that says which, and it has three meanings that
 * must not collapse into each other:
 *
 *   []    the window was checked and nothing in it was unread
 *   [..]  these specific seasons were not readable
 *   null  we cannot state readability for this cohort at all, which is what a
 *         relaxed cohort produces — it is UNKNOWN, never zero
 */
export function windowCopy(window) {
  if (!window) return null;
  const seasons = (window.seasons ?? []).map(String);
  if (!seasons.length) return null;

  const years = seasons.map(Number);
  const contiguous = years.length > 1
    && years[years.length - 1] - years[0] + 1 === years.length;
  const measured = seasons.length === 1
    ? seasons[0]
    : (contiguous ? `${seasons[0]}–${seasons[seasons.length - 1]}` : seasons.join(', '));

  const unread = window.seasonsUnread;
  let coverage = null;
  if (unread === null || unread === undefined) {
    coverage = 'Season coverage for this cohort is unknown.';
  } else if (unread.length === 1) {
    coverage = `${unread[0]} was not readable.`;
  } else if (unread.length > 1) {
    coverage = `${unread.slice(0, -1).join(', ')} and ${unread[unread.length - 1]} were not readable.`;
  }

  return {
    measured: seasons.length === 1 ? `Measured in ${measured}` : `Measured across ${measured}`,
    coverage,
    /**
     * Carried, but NOT rendered as a bare "n=".
     *
     * `window.n` counts a different thing per kind: players for the cohort
     * ladder, SEASONS for the programme pattern, and the freshman total for
     * the whole-intake ladder and the benchmark. One label over three meanings
     * would put "n=4" beside "32 first-year players" and invite the reader to
     * pick. Each kind states its own sample in words from its own facts
     * instead; this stays for tests and for whatever labels it properly later.
     */
    sample: n(window.n),
  };
}

/**
 * The applied cohort, described from the window and nothing else.
 *
 * `qualification.window.cohort` is the population the ladder was ACTUALLY read
 * over. The facts also carry `asked` — the narrower cut that was requested —
 * and that is deliberately not used to describe the population, because a
 * cohort that names a position it never applied would misdescribe every one of
 * the 1,539 relaxed measurements. A null axis produces no words about that
 * axis rather than a guess.
 */
export function cohortCopy(cohort) {
  if (!cohort) return null;
  const parts = [];
  if (cohort.position) parts.push(`${positionNoun(cohort.position)}s`);
  if (cohort.origin) parts.push(cohort.origin === 'international' ? 'international' : String(cohort.origin));
  if (!parts.length) return 'All first-year players';
  // "First-year international" is not a noun phrase; the position supplies one
  // when it is present and "players" has to when it is not.
  if (!cohort.position) return `First-year ${parts.join(' · ')} players`;
  return `First-year ${parts.join(' · ')}`;
}

/**
 * How a pool comparison band reads in words.
 *
 * The band is the server's own; there is no percentile to show, and there will
 * not be one until the payload carries it — `percentile` is null on all 1,878
 * real benchmark items, and estimating one from the band would be inventing a
 * figure. Worded as position within the pool, with no suggestion that higher
 * is better: a programme that gives its top first-year more minutes than most
 * is doing something measurable, not something good.
 */
const BAND = Object.freeze({
  'at-or-below-p25': 'At or below the pool’s 25th percentile',
  'p25-to-median': 'Between the pool’s 25th percentile and its median',
  'median-to-p75': 'Between the pool’s median and its 75th percentile',
  'above-p75': 'Above the pool’s 75th percentile',
});

/** The ladder rows, as the payload holds them. */
function ladderRows(ladder = []) {
  if (!Array.isArray(ladder) || !ladder.length) return null;
  return ladder.map((row) => ({
    rank: row.rank,
    // Median minutes with the observed range beside it — all three given.
    value: num(row.median),
    range: num(row.low) && num(row.high) ? `${num(row.low)}–${num(row.high)}` : null,
    // The measurement's own labels, carried rather than reinterpreted.
    band: row.band ?? null,
    agreement: row.agreement ?? null,
    seasons: n(row.seasonsWithThisMany),
  }));
}

const DEV_COPY = Object.freeze({
  ATHLETE_COHORT_LADDER: (f, q) => {
    const rows = ladderRows(f.ladder);
    if (!rows) return null;
    const cohort = cohortCopy(q?.window?.cohort);
    return {
      headline: cohort ? `${cohort}` : 'Comparable first-year players',
      detail: [
        n(f.players) ? `Based on ${f.players} first-year ${f.players === 1 ? 'player' : 'players'}.` : null,
        // The backend's own sentence about what it could not read separately.
        // Rendered rather than paraphrased: it is the only thing that stops a
        // relaxed cohort reading as the one that was asked for.
        f.refused ? `Narrower cut not used — ${f.refused}.` : null,
      ].filter(Boolean).join(' ') || null,
      ladder: rows,
      scope: 'athlete',
    };
  },

  PROGRAMME_DEVELOPMENT_PATTERN: (f) => {
    if (!f.verdictNote) return null;
    return {
      // The analysis's own words. `verdictKey` never reaches the screen.
      headline: f.verdictNote,
      detail: [
        n(f.seasonsObserved) && n(f.players)
          ? `Read over ${f.seasonsObserved} seasons and ${f.players} first-year players.`
          : null,
        f.coach && f.coachStillInPost === true ? `${f.coach} is still in post.` : null,
        f.coach && f.coachStillInPost === false ? `${f.coach} is no longer in post.` : null,
      ].filter(Boolean).join(' ') || null,
      // The three mean shares the pattern was read off, as the server computed
      // them. Not a ladder, so they get their own rows.
      shares: f.minuteShares ? [
        ['First-years', already(f.minuteShares.freshman)],
        ['Other newcomers', already(f.minuteShares.newcomer)],
        ['Returning players', already(f.minuteShares.returning)],
      ].filter(([, v]) => v) : null,
      seasons: (f.shareBySeason ?? []).map((s) => ({
        label: s.season,
        value: [pct(s.shareOfSquadMinutes) ? `${pct(s.shareOfSquadMinutes)} of squad minutes` : null,
          n(s.intake) ? `${s.intake} in the intake` : null].filter(Boolean).join(' · '),
      })),
      scope: 'programme',
    };
  },

  FRESHMAN_MINUTES_LADDER: (f) => {
    const rows = ladderRows(f.ladder);
    if (!rows) return null;
    return {
      headline: 'Every first-year, ranked by minutes',
      detail: [
        n(f.seasonsObserved) ? `Across ${f.seasonsObserved} measured seasons.` : null,
        n(f.medianIntake) && n(f.medianPlayed)
          ? `A median intake of ${f.medianIntake}, of whom ${f.medianPlayed} played.`
          : null,
        // Stated as a count of seasons, not as a rate or a likelihood.
        n(f.seasonsWithAnImpactFreshman)
          ? `${f.seasonsWithAnImpactFreshman} of those seasons had a first-year in the impact band.`
          : null,
      ].filter(Boolean).join(' ') || null,
      ladder: rows,
      scope: 'programme',
    };
  },

  PROGRAMME_POOL_BENCHMARK: (f, q) => {
    if (!BAND[f.band] || !n(f.programmeMedian)) return null;
    const c = q?.comparison ?? {};
    return {
      headline: BAND[f.band],
      detail: [
        `The most-used first-year here has a median of ${num(f.programmeMedian)} minutes.`,
        f.pool && n(f.pool.median)
          ? `The pool\u2019s quartiles are ${num(f.pool.p25)}, ${num(f.pool.median)} and ${num(f.pool.p75)}.`
          : null,
        c.basis ? `Compared against ${c.basis}.` : null,
        n(c.poolSize) ? `${c.poolSize} programmes in the pool.` : null,
      ].filter(Boolean).join(' '),
      // Carried so the surface can show WHICH band without colouring it.
      band: f.band,
      scope: 'programme',
    };
  },
});

/** Every development kind this module can present. Used by its tests. */
export const DEV_COPY_KINDS = Object.freeze(Object.keys(DEV_COPY));

/** The four bands in pool order, for a neutral position indicator. */
export const BAND_ORDER = Object.freeze([
  'at-or-below-p25', 'p25-to-median', 'median-to-p75', 'above-p75',
]);

/** Presentation content for one development item, or null. */
export function developmentCopyFor(item) {
  const build = DEV_COPY[item?.kind];
  if (!build) return null;
  const content = build(item.facts ?? {}, item.qualification ?? {});
  if (!content?.headline) return null;
  return {
    detail: null, ladder: null, shares: null, seasons: null, band: null, ...content,
  };
}

/** The compact window line beneath a measurement, or null. */
export function developmentWindow(item) {
  return windowCopy(item?.qualification?.window);
}
