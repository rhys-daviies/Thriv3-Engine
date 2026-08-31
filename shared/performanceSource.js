/**
 * Whether a programme-season's performance column was READ, as opposed to
 * assumed.
 *
 * The 2025 acquisition run carried a rule, and it wrote the rule into the row:
 *
 *   "Assumed 0 minutes/games played -- player appears on roster but is not
 *    listed on the team's stats page (redshirt, injury, or did not see game
 *    action)"
 *
 * 5,563 rows say that. The rule is RIGHT wherever the stats page was actually
 * read — 1,397 programme-seasons have real minutes beside those zeros, so a
 * player missing from the page genuinely did not appear — and it FABRICATES
 * wherever the page was not read, because then every player is "not listed"
 * and the whole roster is assigned nothing.
 *
 * `minutesAreMissing` cannot tell them apart. It restores a zero to null only
 * where the same row claims games played, and a fabricated row claims zero
 * games too. So the fabricated seasons arrive downstream as fully MEASURED
 * zeros, and both gates that guard the report ask how much was measured. A
 * fabricated season answers "all of it".
 *
 * The unit of the decision is therefore the SOURCE, not the value. It is not
 * "this zero looks wrong" — individually these zeros may even be true. It is
 * that they are a NON-RANDOM SAMPLE: where a stats page went unread, the only
 * players who can be measured are the ones who did not appear, so any rate
 * over them is guaranteed to read as zero opportunity. That is a statement
 * about the roster data and it belongs beside the other one.
 *
 * NOTHING HERE WRITES TO THE DATABASE. The stored rows keep their zeros; this
 * is an analytical readability decision taken at read time, exactly as
 * `readableRows` already takes one.
 */

/**
 * Below this a roster is too small for "nobody played" to be surprising.
 *
 * Ten is where the audit drew it and it is the same floor `MIN_SQUAD` uses
 * for a squad share. Three programme-seasons in the whole dataset are smaller
 * than this AND carry no minute above zero, so the threshold is doing very
 * little work — it is here so a five-player fragment of a roster cannot
 * condemn a season on its own.
 */
export const MIN_SOURCE_ROSTER = 10;

/** Minutes on the pitch in one match: eleven players for ninety minutes. */
export const MINUTES_PER_MATCH = 990;

/**
 * How far a season's total minutes may sit from the pitch time available
 * before the column stops describing the season it claims to.
 *
 * Measured across every programme-season that passes the coverage gate: the
 * median ratio is 1.00 and 97% fall inside this band, in every division and
 * both sports. It is a DIAGNOSTIC, not a gate — see `teamMinuteRatio`.
 */
export const PLAUSIBLE_TEAM_MINUTES = Object.freeze({ low: 0.85, high: 1.15 });

/** The key a readability decision is taken at: one programme, one season. */
export const programmeSeasonKey = (row) => `${row.sport ?? ''}|${row.college_name}|${row.season}`;

/**
 * Every programme-season whose performance column cannot be read.
 *
 * Two conditions, and the second is what keeps 2026 out of it. A season must
 * CLAIM to have measured something — at least one row with a minutes figure
 * on it — and everything it claims must be zero. The forward roster carries
 * no minutes at all, so it claims nothing and is never named here; it is
 * unmeasured by design rather than unreadable, and those are different facts.
 */
export function performanceUnreadableSeasons(rows, { minRoster = MIN_SOURCE_ROSTER } = {}) {
  const agg = new Map();
  for (const row of rows) {
    const key = programmeSeasonKey(row);
    if (!agg.has(key)) agg.set(key, { players: 0, stored: 0, best: 0 });
    const a = agg.get(key);
    a.players += 1;
    if (row.minutes_played != null) {
      a.stored += 1;
      a.best = Math.max(a.best, Number(row.minutes_played) || 0);
    }
  }
  const out = new Set();
  for (const [key, a] of agg) {
    if (a.players >= minRoster && a.stored > 0 && a.best === 0) out.add(key);
  }
  return out;
}

/**
 * The same rows with an unread season's performance restored to unknown.
 *
 * Minutes, games and starts together, because the import assumed all three in
 * the same breath and because `minutesAreMissing` reads the games column to
 * decide whether a zero is real — leaving a fabricated `games_played: 0` in
 * place would keep the row looking measured after its minutes had gone.
 */
export function blankUnreadableSeasons(rows, keys) {
  if (!keys?.size) return rows;
  return rows.map((row) => (keys.has(programmeSeasonKey(row))
    ? { ...row, minutes_played: null, games_played: null, games_started: null }
    : row));
}

/** Both halves at once, for the callers that only want the result. */
export function withReadablePerformance(rows, options) {
  return blankUnreadableSeasons(rows, performanceUnreadableSeasons(rows, options));
}

/**
 * A season's minutes against the pitch time its matches contained.
 *
 * `null` where the question cannot be asked: no measured rows, or no player
 * observed to have played enough matches to say how long the season was. The
 * denominator uses the highest games figure on the roster, which is a lower
 * bound on the matches played, so the ratio errs high rather than low.
 *
 * This is a DIAGNOSTIC and a regression invariant. It is deliberately not a
 * production gate: it agrees with `performanceUnreadableSeasons` on the
 * fabricated seasons and adds only eight more across both sports, which is
 * not enough evidence to start refusing a programme's season on an arithmetic
 * tolerance.
 */
export function teamMinuteRatio(rows) {
  const measured = rows.filter((r) => r.minutes_played != null);
  if (!measured.length) return null;
  const matches = Math.max(0, ...rows.map((r) => Number(r.games_played) || 0));
  if (!matches) return null;
  const minutes = measured.reduce((sum, r) => sum + (Number(r.minutes_played) || 0), 0);
  return minutes / (matches * MINUTES_PER_MATCH);
}

/** Whether that ratio describes a season somebody actually played. */
export function teamMinutesArePlausible(ratio) {
  if (ratio == null) return null;
  return ratio >= PLAUSIBLE_TEAM_MINUTES.low && ratio <= PLAUSIBLE_TEAM_MINUTES.high;
}
