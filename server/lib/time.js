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
