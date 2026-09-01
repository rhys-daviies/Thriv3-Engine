/**
 * What a programme actually recorded, season by season.
 *
 * WHAT IT ANSWERS: what the win/draw/loss record was in each season we can
 * read, how those seasons compare with each other, and how one season's rate
 * sat against programmes in the same sport, division and year.
 *
 * WHAT IT DOES NOT ANSWER, and cannot. Whether the programme is good. Whether
 * results will continue. Who they played — no fixture, opponent or goal exists
 * anywhere in this database, so schedule strength and results-by-opponent-level
 * are not merely unbuilt, they are unbuildable from what we hold. Phase 12A
 * measured the boundary; `docs/competitive-history.md` states it.
 *
 * THE SEQUENCE IS THE PRODUCT. Four seasons are four facts, and this module
 * never replaces them with their average. A programme that went 8-7-3 then
 * 14-3-2 and one that went 11-5-2 twice have nearly the same four-year rate and
 * are telling a recruit different things.
 *
 * IT NEVER INTERPOLATES AND NEVER ZEROES. A season that is not on file is
 * absent from `seasons` and counted in `expectedSeasons - readableSeasons`. A
 * season whose record is contradicted by the programme's own roster is refused
 * the same way, with the reason carried. Reading either as 0-0-0 would put a
 * winless season into a median.
 *
 * A PURE FUNCTION OF ROWS HANDED IN. It does not read the database, and it
 * takes the benchmark pool as an argument rather than building one, so the
 * denominator and the comparison set are both the caller's to state.
 */

/** The window. 2026 is the season being recruited into and has not been played. */
export const SEASONS = Object.freeze([2022, 2023, 2024, 2025]);

/** Why a season on file is not readable. Absent seasons carry no reason. */
export const UNREADABLE = Object.freeze({
  ROSTER_CONTRADICTED: 'a player on that roster logged more appearances than the record says the team played',
});

/**
 * How much of the window a programme's history covers.
 *
 * Named for the denominator rather than for a quality: `PARTIAL` is not a worse
 * programme, it is a shorter measurement, and the difference is the whole
 * reason this enum exists instead of a boolean.
 */
export const WINDOW = Object.freeze({
  COMPLETE: 'COMPLETE',       // every season in the window is readable
  PARTIAL: 'PARTIAL',         // 2 or 3 readable — comparisons hold, stated on their own denominator
  SINGLE_SEASON: 'SINGLE_SEASON', // 1 readable — a fact, and nothing to compare it with
  UNAVAILABLE: 'UNAVAILABLE', // 0 readable
});

/**
 * The rate this product quotes, and it is the one the schools quote themselves.
 *
 * NCAA winning percentage counts a draw as half a win: (W + D/2) / matches.
 * Phase 12A pulled the official figure off three schools' own schedule exports
 * and it reproduces exactly — Mercyhurst 19-1-1 = .929, Grand Valley State
 * 16-2-5 = .804, Williams 11-5-3 = .658. A family checking our number against
 * the programme's own website finds the same number, which no other candidate
 * can offer.
 *
 * The two rejected candidates and why. Simple win percentage treats a draw as a
 * loss, and draws are 17.9% of every match in this dataset: it scores 10-2-8
 * and 10-8-2 identically at .500 when the first programme lost twice and the
 * second lost eight times. League points per game — (3W + D) / 3M, what
 * `soccer_score` uses internally — weights a draw at a third of a win, which is
 * the right weight for a league table awarding three points and is not what
 * anyone publishes about a college soccer season.
 *
 * `pointsRate` is kept alongside because the existing rating is built on it and
 * an analyst comparing the two should not have to re-derive it.
 */
export const winPercentage = (w, d, m) => (m > 0 ? (w + d / 2) / m : null);
export const pointsRate = (w, d, m) => (m > 0 ? (3 * w + d) / (3 * m) : null);

/**
 * WINS-LOSSES-DRAWS, and it lives here so it is written once.
 *
 * That is what every source publishes. Phase 12A pulled three schools' own
 * headers — Mercyhurst 19-1-1 on 19W/1D/1L, Messiah 20-0-2 on 20W/2D/0L, Grand
 * Valley State 16-2-5 on 16W/5D/2L — and all three are W-L-D. A family checking
 * our string against their own programme's website has to find the same string,
 * and 20-2-0 against their 20-0-2 reads as a different season. It was written
 * in two places for about an hour and the second one was wrong.
 */
export const recordString = (wins, losses, draws) => `${wins}-${losses}-${draws}`;

/** A pool this small cannot support a quartile, let alone a percentile. */
export const MIN_POOL = 30;

const round3 = (v) => (v == null ? null : Number(v.toFixed(3)));
const quantile = (sorted, q) => (sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);

/**
 * One season's rates and the counts behind them.
 *
 * Counts first and rates second, deliberately: 14-3-2 is what a reader
 * understands and .750 is what a comparison needs.
 */
export function seasonRow(row) {
  const wins = Number(row.wins);
  const draws = Number(row.draws);
  const losses = Number(row.losses);
  const matches = Number(row.matchesPlayed ?? row.matches_played ?? wins + draws + losses);
  return {
    season: Number(row.season),
    wins, draws, losses, matchesPlayed: matches,
    record: recordString(wins, losses, draws),
    winPercentage: round3(winPercentage(wins, draws, matches)),
    pointsRate: round3(pointsRate(wins, draws, matches)),
  };
}

/**
 * The spread of a programme's own seasons.
 *
 * Range, median and the two ends — and deliberately no standard deviation. At
 * four observations a standard deviation is a number with two significant
 * figures of noise, and its only real use downstream would be to threshold it
 * into "consistent" and "volatile", which is the classification this phase
 * exists to avoid. The four rates and the distance between the outer two say
 * everything a reader can act on.
 */
function ownSpread(seasons) {
  const rates = seasons.map((s) => s.winPercentage).filter((v) => v != null).sort((a, b) => a - b);
  // A range needs two observations. At one, `lowest` and `highest` are the same
  // number and "ranged from .167 to .167" is a sentence about nothing.
  if (rates.length < 2) return rates.length ? { n: 1, median: rates[0], range: null, single: rates[0] } : null;
  const median = rates.length % 2
    ? rates[(rates.length - 1) / 2]
    : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;
  return {
    n: rates.length,
    lowest: rates[0],
    highest: rates[rates.length - 1],
    median: round3(median),
    // The distance between the outer two. Not a variance, and not a label.
    range: round3(rates[rates.length - 1] - rates[0]),
  };
}

/**
 * The season with the highest rate on file — NOT the programme's best season.
 *
 * The wording is the point and it is load-bearing. This record says nothing
 * about who was played: a .750 season against a soft schedule and a .750 season
 * in the strongest conference in the division are the same number here, and
 * nothing in this database can separate them, because no fixture or opponent
 * exists in it. "Highest observed" is a claim about our measurement. "Best" is a
 * claim about the sport, and we cannot make it.
 */
function extremeSeasons(seasons) {
  const rated = seasons.filter((s) => s.winPercentage != null);
  if (!rated.length) return { highestObservedSeason: null, lowestObservedSeason: null };
  // Ties broken by the later season, so a repeated high reads as the current one.
  const by = (cmp) => rated.reduce((a, b) => (cmp(b.winPercentage, a.winPercentage)
    || (b.winPercentage === a.winPercentage && b.season > a.season) ? b : a));
  return {
    highestObservedSeason: by((x, y) => x > y),
    lowestObservedSeason: by((x, y) => x < y),
  };
}

/**
 * Where a season's rate sat among programmes measured the same year, in the
 * same sport and the same division.
 *
 * SEASON-SPECIFIC AND DIVISION-SPECIFIC, both of which are refusals rather than
 * conveniences. Comparing a 2022 rate with a 2025 pool would rank a programme
 * against a year it did not play; comparing across divisions is the thing the
 * existing `soccer_score` band does editorially and this module will not do at
 * all.
 *
 * The caution that has to travel with the number: this pool is close to
 * self-referential — every match inside a division has a winner and a loser, so
 * the median rate is .500 almost by construction — and a programme's rate is
 * partly a property of who it scheduled. That is why the phrasing this supports
 * is "the 2025 rate sat in the upper quarter", about a number, and never "the
 * programme was in the upper quarter", about a programme.
 */
export function seasonBenchmark(rate, pool) {
  if (rate == null || !pool?.rates?.length) return null;
  const rates = [...pool.rates].sort((a, b) => a - b);
  if (rates.length < MIN_POOL) {
    return { available: false, reason: `only ${rates.length} programmes measured in this division and season`, n: rates.length };
  }
  const below = rates.filter((v) => v < rate).length;
  const equal = rates.filter((v) => v === rate).length;
  return {
    available: true,
    n: rates.length,
    // Midpoint of the tied band, so a programme sitting exactly on a common
    // value is not credited with beating everyone who matched it.
    percentile: round3((below + equal / 2) / rates.length),
    median: round3(quantile(rates, 0.5)),
    middleHalf: { low: round3(quantile(rates, 0.25)), high: round3(quantile(rates, 0.75)) },
    scope: pool.scope ?? null,
  };
}

/**
 * The competitive history of one programme.
 *
 * @param rows - that programme's `programme_seasons` rows, any order, already
 *   filtered to readable seasons by the caller OR carrying `confidence`.
 * @param pools - `{ [season]: { rates: number[], scope } }` for this
 *   programme's sport and division. Optional; without it no benchmark is
 *   computed and nothing else changes.
 * @param coachAttribution - the existing model's output, unmodified. Optional.
 */
export function competitiveHistory({ rows = [], pools = null, coachAttribution = null } = {}) {
  const unreadable = [];
  const usable = [];
  for (const r of rows) {
    const season = Number(r.season);
    if (!SEASONS.includes(season)) continue;
    if (r.confidence === 'ROSTER_CONTRADICTED') {
      unreadable.push({ season, reason: UNREADABLE.ROSTER_CONTRADICTED });
      continue;
    }
    usable.push(seasonRow(r));
  }
  usable.sort((a, b) => a.season - b.season);
  unreadable.sort((a, b) => a.season - b.season);

  const readableSeasons = usable.length;
  const window = readableSeasons === SEASONS.length ? WINDOW.COMPLETE
    : readableSeasons >= 2 ? WINDOW.PARTIAL
      : readableSeasons === 1 ? WINDOW.SINGLE_SEASON : WINDOW.UNAVAILABLE;

  const seasons = usable.map((s) => ({
    ...s,
    benchmark: pools ? seasonBenchmark(s.winPercentage, pools[s.season] ?? null) : null,
  }));

  const totals = usable.reduce((a, s) => ({
    wins: a.wins + s.wins, draws: a.draws + s.draws,
    losses: a.losses + s.losses, matches: a.matches + s.matchesPlayed,
  }), { wins: 0, draws: 0, losses: 0, matches: 0 });

  const spread = ownSpread(usable);
  const { highestObservedSeason, lowestObservedSeason } = extremeSeasons(usable);

  return {
    seasons,
    // Every denominator this model has, stated rather than inferred.
    describes: usable.map((s) => s.season),
    readableSeasons,
    expectedSeasons: SEASONS.length,
    unreadableSeasons: unreadable,
    missingSeasons: SEASONS.filter((y) => !usable.some((s) => s.season === y)
      && !unreadable.some((u) => u.season === y)),
    window,
    completeWindow: window === WINDOW.COMPLETE,
    /**
     * Aggregates, and they are aggregates of the seasons READ — never of the
     * window. A three-season total is a three-season total, and `describes`
     * beside it is what stops it being read as four.
     */
    summary: readableSeasons ? {
      totalWins: totals.wins,
      totalDraws: totals.draws,
      totalLosses: totals.losses,
      totalMatches: totals.matches,
      aggregateRecord: recordString(totals.wins, totals.losses, totals.draws),
      // Across the seasons read, weighted by matches — not the mean of the
      // per-season rates, which would let a 5-match season count as much as a 22.
      aggregateWinPercentage: round3(winPercentage(totals.wins, totals.draws, totals.matches)),
      medianWinPercentage: spread?.median ?? null,
      // Null at a single season, for the same reason `competitiveFacts` refuses
      // a comparison there: there is nothing to range between.
      winPercentageRange: spread && spread.range != null
        ? { lowest: spread.lowest, highest: spread.highest, spread: spread.range } : null,
      highestObservedSeason,
      lowestObservedSeason,
    } : null,
    coach: coachContext(usable, coachAttribution),
  };
}

/**
 * How much of the competitive history the coach on file for 2026 was there for.
 *
 * CONTEXT, NEVER A FILTER. The history above is the programme's whole readable
 * record and stays that way: a family reading four seasons is entitled to all
 * four, and knowing that three of them were somebody else's is what makes the
 * fourth legible. Nothing here is a coach rating, and nothing here says the
 * coach caused any of it — the attribution model is consumed exactly as it is
 * and this function adds no interpretation to it.
 *
 * The coach may be unknown, and at 402 programmes — every NAIA and USCAA one —
 * there is no coach record at all. That is reported as `null`, not as zero
 * seasons attributed.
 */
function coachContext(usable, attribution) {
  if (!attribution) return null;
  const measured = new Map((attribution.measuredSeasons ?? []).map((s) => [Number(s.season), s]));
  const attributed = usable.filter((s) => measured.get(s.season)?.attribution === 'CURRENT_COACH');
  return {
    currentCoach: attribution.currentCoach?.name ?? null,
    currentCoachReason: attribution.currentCoachReason ?? null,
    competitiveSeasonCount: usable.length,
    currentCoachCompetitiveSeasonCount: attributed.length,
    currentCoachCompetitiveSeasons: attributed.map((s) => s.season),
    // The record across those seasons, which is a summary of seasons, not of a
    // coach. It carries its own denominator for exactly that reason.
    currentCoachRecord: attributed.length ? {
      seasons: attributed.map((s) => s.season),
      wins: attributed.reduce((a, s) => a + s.wins, 0),
      draws: attributed.reduce((a, s) => a + s.draws, 0),
      losses: attributed.reduce((a, s) => a + s.losses, 0),
    } : null,
    // Seasons the attribution could not place. Never filled in.
    unattributedSeasons: usable.filter((s) => {
      const m = measured.get(s.season);
      return !m || m.attribution === 'UNRESOLVED';
    }).map((s) => s.season),
  };
}
