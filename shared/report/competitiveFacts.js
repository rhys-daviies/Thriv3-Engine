/**
 * Sentences a competitive record can support, and nothing beyond them.
 *
 * Every string this module returns is a restatement of a number already in the
 * model. It contains no verb of direction, no forecast and no judgement, and a
 * test asserts that over every sentence it can emit for every shape of input.
 *
 * THE LINE THIS DRAWS. "Win total went from 8 in 2022 to 14 in 2025" is a
 * comparison of two measurements a reader can check. "The programme is
 * improving" is a claim about a trend, which needs more than four points, and a
 * claim about the future, which needs something this data cannot give. The
 * first is allowed and the second is banned by `FORBIDDEN` below.
 *
 * WHY THERE IS NO "MOST NOTABLE FACT" PICKER HERE THAT COUNTS WINS. A season
 * with ten wins and eight losses and one with ten wins and two losses are not
 * the same season, and a narrative that ranks seasons by win total says they
 * are. Everything here that orders seasons orders them by the canonical rate,
 * which reads all three of the counts.
 */
import { WINDOW, recordString } from '../competitiveHistory.js';

/**
 * Words a competitive fact may never contain.
 *
 * Kept as a checkable list rather than as a rule in a comment, because the
 * pressure to write one of them arrives every time somebody looks at four
 * seasons that happen to point the same way.
 */
export const FORBIDDEN = /\b(improv|declin|rising|falling|trend|momentum|upward|downward|better|worse|best season|worst season|strong|weak|elite|poor|good|bad|surge|slump|turnaround|regress)/i;

const pct = (v) => (v == null ? null : v.toFixed(3).replace(/^0/, ''));
const s = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The facts, in the order a reader would want them, each independently true.
 *
 * A caller renders as many as it has room for and drops the rest; nothing here
 * depends on anything else here being shown.
 */
export function competitiveFacts(history) {
  if (!history || history.window === WINDOW.UNAVAILABLE) return [];
  const { seasons, summary, readableSeasons, expectedSeasons } = history;
  const out = [];

  // 1. The denominator, first and always, wherever it is not the whole window.
  if (readableSeasons < expectedSeasons) {
    out.push({ id: 'denominator',
      text: `${s(readableSeasons, 'season', 'seasons')} of the ${expectedSeasons} in this window `
        + `${readableSeasons === 1 ? 'carries' : 'carry'} a record on file.` });
  }

  // 2. The sequence itself. This is the product; everything below is a reading.
  out.push({ id: 'sequence',
    text: seasons.map((x) => `${x.season} ${x.record}`).join(' · ') });

  if (readableSeasons === 1) {
    const only = seasons[0];
    out.push({ id: 'single-season',
      text: `The only season on file is ${only.season}, when the programme recorded ${only.record} `
        + `across ${s(only.matchesPlayed, 'match', 'matches')}. One season does not support a comparison.` });
    return out;
  }

  // 3. First against last. A comparison of two measurements, not a direction.
  const first = seasons[0];
  const last = seasons[seasons.length - 1];
  if (first.wins !== last.wins) {
    out.push({ id: 'wins-endpoints',
      text: `Win total went from ${first.wins} in ${first.season} to ${last.wins} in ${last.season}.` });
  }

  // 4. Where the extremes sit. "Highest observed", never "best" — the record
  //    says nothing about who was played.
  const hi = summary.highestObservedSeason;
  const lo = summary.lowestObservedSeason;
  if (hi && lo && hi.season !== lo.season) {
    out.push({ id: 'range',
      text: `Season results rate ranged from ${pct(lo.winPercentage)} in ${lo.season} `
        + `to ${pct(hi.winPercentage)} in ${hi.season}.` });
    out.push({ id: 'highest',
      text: `The highest rate observed in this window was ${pct(hi.winPercentage)}, in ${hi.season} (${hi.record}).` });
  }

  // 5. A count over the seasons, which needs no ordering at all.
  const tenPlus = seasons.filter((x) => x.wins >= 10).length;
  if (tenPlus) {
    out.push({ id: 'ten-win-seasons',
      text: `${tenPlus} of the ${readableSeasons} measured ${readableSeasons === 1 ? 'season' : 'seasons'} `
        + `produced at least 10 wins.` });
  }

  // 6. The aggregate, carrying its own denominator so it cannot be read as four.
  out.push({ id: 'aggregate',
    text: `Across the ${s(readableSeasons, 'season', 'seasons')} on file the programme recorded `
      + `${summary.aggregateRecord} in ${s(summary.totalMatches, 'match', 'matches')}.` });

  return out;
}

/**
 * The benchmark sentence, phrased about the RATE and never about the programme.
 *
 * "The programme was in the upper quarter" is a claim about a programme's
 * standing among its peers. "The 2025 rate was in the upper quarter" is a claim
 * about where one number fell in a list of numbers. Only the second is
 * supportable, because a season's rate is partly a property of who was
 * scheduled and this database holds no fixture to separate the two.
 */
export function benchmarkFact(season) {
  const b = season?.benchmark;
  if (!b?.available) return null;
  const q = b.percentile >= 0.75 ? 'the upper quarter'
    : b.percentile <= 0.25 ? 'the lower quarter'
      : 'the middle half';
  return { id: 'benchmark',
    text: `The ${season.season} results rate of ${pct(season.winPercentage)} sat in ${q} of the `
      + `${b.n} ${b.scope ?? ''} programmes measured that season `
      + `(middle half ${pct(b.middleHalf.low)}–${pct(b.middleHalf.high)}).`.replace(/\s+/g, ' ') };
}

/**
 * How much of the record the coach on file was there for.
 *
 * Sequence, never cause. "Across those seasons the programme recorded X" is a
 * statement about seasons; "the coach took the programme from X to Y" is a
 * statement about a person, and the difference is the whole of Phase 11's work.
 */
export function coachFact(history) {
  const c = history?.coach;
  if (!c || !c.currentCoach || !c.competitiveSeasonCount) return null;
  const { currentCoachCompetitiveSeasonCount: n, competitiveSeasonCount: total } = c;
  if (n === total) {
    return { id: 'coach', text: `All ${s(total, 'measured competitive season', 'measured competitive seasons')} `
      + `in this report were under ${c.currentCoach}.` };
  }
  if (n === 0) {
    return { id: 'coach', text: `None of the ${s(total, 'measured competitive season', 'measured competitive seasons')} `
      + `in this report were under ${c.currentCoach}.` };
  }
  const r = c.currentCoachRecord;
  const seasonWord = n === 1 ? 'season was' : 'seasons were';
  return { id: 'coach',
    text: `${n} of the ${total} measured competitive ${seasonWord} under ${c.currentCoach}`
      + (r ? `; across ${n === 1 ? 'that season' : 'those seasons'} the programme recorded `
        + `${recordString(r.wins, r.losses, r.draws)}.` : '.') };
}
