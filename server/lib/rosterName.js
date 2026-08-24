/**
 * Decides whether a roster cell holds a player's name or something else.
 *
 * The 2024 scrape read the jersey column for four D1 women's programmes and
 * produced 120 players called "Jersey Number 9". They imported without
 * complaint, because the class-year guard only ever inspected the class
 * column — and then they wrecked the metric they fed: Akron's women showed 60
 * departures from a 25-player squad, since a placeholder can never match a
 * real name in the following season.
 *
 * Turnover is a difference between two seasons, so a junk name does not
 * merely add a bad row. It adds a bad row to 2024 AND a phantom departure to
 * the diff, and the result still looks like a number.
 */

/** Whole-cell placeholders: a bare number, a jersey number, a filler word. */
const PLACEHOLDER = /^(?:jersey\s*number|no\.?|#)?\s*\d+$|^(?:tba|tbd|n\/?a|unknown|player|total|roster|staff)$/i;

/**
 * True when the cell could plausibly be a person.
 *
 * The test is deliberately shallow — two letters somewhere and not a known
 * placeholder. It is here to catch a column read off by one, not to judge
 * whether "Kundalini Bien-Aimé Dominique" looks like a name; the roster is
 * full of names that would fail a stricter rule, in many alphabets.
 */
export function isPlausibleName(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return false;
  if (PLACEHOLDER.test(trimmed)) return false;
  if (/^jersey\s*number\b/i.test(trimmed)) return false;
  return /\p{L}{2,}/u.test(trimmed);
}
