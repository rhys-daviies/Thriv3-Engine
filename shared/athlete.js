/**
 * Derivations that every part of the app has to agree on.
 */

/**
 * The year this athlete would join a college roster.
 *
 * One fact that used to live in two columns gating different things:
 * `graduation_year` was required to publish a profile and `recruiting_class_year`
 * was required by the intake form and by matching, so an athlete could pass
 * the form, be matched, have their emails drafted, and only fail at publish
 * time on a field nothing had asked for. One of the two athletes in the
 * database was in exactly that state, and the other disagreed with itself —
 * a profile reading "Class of 2026" while matching targeted the 2027 cohort.
 *
 * `recruiting_class_year` wins because it is the one the product turns on:
 * matching joins it against `roster_players.estimated_graduation_year` to find
 * who leaves the year this athlete arrives. It is also what a coach reads
 * "Class of 2027" to mean — the year the player turns up, not the year they
 * left school. `graduation_year` survives as a fallback so records created
 * before the field existed keep working, and is no longer asked for.
 */
export function classYearOf(athlete) {
  if (!athlete) return null;
  const primary = athlete.recruiting_class_year;
  if (primary !== null && primary !== undefined && primary !== '') return primary;
  const fallback = athlete.graduation_year;
  return fallback === null || fallback === undefined || fallback === '' ? null : fallback;
}
