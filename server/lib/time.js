/** Every timestamp this subsystem writes is ISO-8601 UTC with an explicit Z. */
export function utcNow() {
  return new Date().toISOString();
}

export function daysAgoIso(days, from = Date.now()) {
  return new Date(from - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Today, as a YYYY-MM-DD date in UTC.
 *
 * THE DEPENDENCY IS DELIBERATE AND TEMPORARY. Campaign boundaries are stored
 * as timezone-free dates because they are service boundaries an operator set,
 * not instants — and comparing one against "now" requires choosing a timezone
 * that nothing has chosen yet. Until a scheduler resolves the athlete's or the
 * recipient's own date, this is the fallback: one place, named, so the
 * assumption is visible rather than spread through comparisons.
 *
 * Every caller takes an explicit date, so nothing is forced to use it.
 */
export function utcToday(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * The UTC day containing `date`, as a half-open instant range.
 *
 * `[windowStart, windowEnd)` — the start is included, the end is not, so a
 * timestamp of exactly midnight belongs to the day it opens and to no other.
 * Every usage query in server/lib/outboundBudget.js keys on this shape, and an
 * inclusive end would let one instant be counted against two days.
 *
 * THE UTC PART IS THE TEMPORARY PART, exactly as in `utcToday` above. A daily
 * sending budget is really a question about the sender's day, and nothing here
 * knows the sender's timezone yet. So the window is an ARGUMENT everywhere it
 * is used, this is only the default, and the assumption lives in one named
 * place rather than inside a comparison.
 */
export function utcDayWindow(date = utcToday()) {
  const day = typeof date === 'string' ? date.slice(0, 10) : utcToday(date);
  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Not a date this can build a window from: ${date}`);
  }
  return {
    windowStart: start.toISOString(),
    windowEnd: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}
