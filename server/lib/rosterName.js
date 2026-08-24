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
const SUFFIX_AFTER_COMMA = /^(jr|sr|ii|iii|iv|v)$/i;

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

/**
 * Removes the decorations a roster page puts on a name.
 *
 * Both of these were found by measuring turnover rather than by reading data:
 * they inflate it from both ends, since a decorated 2024 name fails to match
 * its clean 2025 twin and each counts once as a departure and once as an
 * arrival.
 *
 *   captain marker   118 schools prefix their captains with a bare "C" —
 *                    "C Nathan Lagoa" — and 67 of those have an exact 2025
 *                    twin without it.
 *   doubled name     101 rows at three programmes repeat the whole name,
 *                    "Trevor Rau Trevor Rau", from a cell read twice.
 *
 * A genuine leading initial is spelled with a period ("C. Vicente Benitez
 * Delgado") and is left alone, as is anything whose second word is itself a
 * single letter, so "C J Smith" never loses its first name.
 */
export function cleanRosterName(value) {
  let name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return name;

  const words = name.split(' ');
  if (words[0] === 'C' && words.length >= 3 && words[1].replace(/\W/g, '').length >= 2) {
    name = words.slice(1).join(' ');
  }

  name = name.replace(/\s*\((?:C|c)\)\s*$/, '').trim();

  // "Sidney Karjian 2" — six programmes append the jersey number to the name.
  // Roman numerals are how a real suffix is written, so digits are always the
  // page's decoration rather than part of anybody's name.
  name = name.replace(/\s+\d{1,2}$/, '').trim();

  // "Rodgers, Sara" — 22 programmes invert the name in 2025 while 2024 spells
  // it the usual way round, which breaks the season-to-season join entirely
  // and reads as a programme that retained nobody. A comma before a suffix
  // ("Gabriel Martinez, Jr.") is punctuation, not an inversion.
  const comma = name.indexOf(',');
  if (comma > 0) {
    const before = name.slice(0, comma).trim();
    const after = name.slice(comma + 1).trim();
    const isSuffix = SUFFIX_AFTER_COMMA.test(after.replace(/\./g, ''));
    if (after && !isSuffix) name = `${after} ${before}`;
    else if (after) name = `${before} ${after}`;
  }

  // "Trevor Rau Trevor Rau" — two identical halves, so keep one.
  const parts = name.split(' ');
  if (parts.length >= 4 && parts.length % 2 === 0) {
    const half = parts.length / 2;
    if (parts.slice(0, half).join(' ') === parts.slice(half).join(' ')) {
      name = parts.slice(0, half).join(' ');
    }
  }

  return name;
}
