/**
 * One definition of a readable minute, shared by the pool and by the report.
 *
 * The lifecycle primitives call a season measured when `minutes_played` is not
 * null, which is the right rule for MATCHING: a stored zero is still a row
 * that identifies a person, and treating it as absent would lose real
 * evidence.
 *
 * It is the wrong rule for REPORTING, and the difference is not academic. Two
 * Division III programmes publish appearances with a zero in the minutes
 * column for every player, and read through the matching rule they produced
 * "0% of first-years here reach a starter's season" — a confident zero drawn
 * from rows where nobody's minutes had ever been published.
 *
 * `minutesAreMissing` is the rule the freshman pages have used since the
 * beginning: a zero is only a zero when the same row says zero games. This
 * module applies it at the boundary between the two layers, so the matching
 * keeps its validated behaviour and every published figure means what the same
 * figure means on the pages beside it.
 */
import { minutesAreMissing, MIN_MEASURED_SHARE } from '../freshmanMinutes.js';
import { withReadablePerformance } from '../performanceSource.js';

/**
 * The same rows, with an unpublished zero restored to the null it is.
 *
 * TWO RULES, applied in this order, because the second needs the first to have
 * run. `minutesAreMissing` works a row at a time and asks whether THIS zero
 * can be believed. `withReadablePerformance` works a programme-season at a
 * time and asks whether the SOURCE was read at all — a question no single row
 * can answer, and the one the fabricated 2025 seasons fail. A season that
 * survives the row rule with nothing above zero left in it did not have its
 * stats page read, and the row rule cannot see that because a fabricated row
 * claims zero games as confidently as zero minutes.
 *
 * Callers must hand in a COMPLETE set of rows for the programme-seasons they
 * care about — every caller does, since each reads a whole programme or a
 * whole sport — because a season judged on half its roster is a season judged
 * on the wrong denominator.
 */
export function readableRows(rows) {
  return withReadablePerformance(
    rows.map((r) => (minutesAreMissing(r) ? { ...r, minutes_played: null } : r)),
  );
}

/**
 * What share of a set of player-seasons carries a minute that can be read.
 *
 * Below `MIN_MEASURED_SHARE` no rate is quoted at all — the counts stay, and
 * "we could read 3 of 61 seasons" becomes the finding.
 */
export function minutesCoverage(rows) {
  const measured = rows.filter((r) => r.minutes_played != null).length;
  return {
    playerSeasons: rows.length,
    measured,
    share: rows.length ? measured / rows.length : null,
    readable: rows.length > 0 && measured / rows.length >= MIN_MEASURED_SHARE,
  };
}

export { MIN_MEASURED_SHARE };
export {
  performanceUnreadableSeasons, blankUnreadableSeasons, withReadablePerformance,
  programmeSeasonKey, MIN_SOURCE_ROSTER,
} from '../performanceSource.js';
