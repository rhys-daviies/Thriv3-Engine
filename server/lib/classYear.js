/**
 * Reads a roster's class-year label, and — just as importantly — refuses to
 * read one that isn't there.
 *
 * Athletics sites render this column a hundred different ways ("Jr.", "Cl.: Jr",
 * "Yr.: Jr", "RS-Jr.", "Class: Junior", "Jr.-2L", "3rd year"), and the 2025
 * scrape handled nearly all of them. What it did not do is notice when it had
 * read the wrong column: Texas Tech's roster has a Club column where the class
 * ought to be, so fifteen players arrived with a class year of "FC Dallas" or
 * "Real Colorado", and one of them — "Solar" — was confidently assigned a
 * graduation year of 2029.
 *
 * That is the failure worth engineering against. A missing class year is
 * visible and gets fixed; a plausible-looking wrong one propagates into
 * recruiting-class matching and nobody ever asks.
 */

/** Years from the season to graduation, matching the 2025 convention. */
const YEARS_TO_GRADUATE = {
  FRESHMAN: 5,
  SOPHOMORE: 4,
  JUNIOR: 3,
  SENIOR: 2,
  GRADUATE: 1,
};

// Longest first, because these are tested in order: "first-year" must be
// tried before "first", "sophomore" before "so", "graduate" before "gr".
const CLASS_PATTERNS = [
  [/^(fy|first[-\s]?year|freshman|fresh|fr|f)(?![a-z])/, 'FRESHMAN'],
  [/^(sophomore|sophmore|soph|second[-\s]?year|so)(?![a-z])/, 'SOPHOMORE'],
  [/^(junior|third[-\s]?year|jr)(?![a-z])/, 'JUNIOR'],
  [/^(senior|fourth[-\s]?year|sr)(?![a-z])/, 'SENIOR'],
  [/^(graduate\s?student|graduate|grad|gs|grd|grt|gr|masters?|phd)(?![a-z])/, 'GRADUATE'],
  // Ordinals are a year of study, not a class name.
  [/^1(st)?(?![a-z])/, 'FRESHMAN'],
  [/^2(nd)?(?![a-z])/, 'SOPHOMORE'],
  [/^3(rd)?(?![a-z])/, 'JUNIOR'],
  [/^4(th)?(?![a-z])/, 'SENIOR'],
  // A fifth or sixth year is someone on the way out, not a super-senior class.
  [/^([56](th)?|fifth|sixth)(?![a-z])/, 'GRADUATE'],
];

/**
 * Prefixes carrying no class information of their own.
 *
 * Ordered longest-first and anchored to a following separator or class token.
 * Left as a plain alternation a bare "r" wins against "rs" and "redshirt" —
 * JavaScript alternation is leftmost-first, not longest-match — and "RS-Fr."
 * decomposes into the nonsense "s-fr".
 */
const REDSHIRT = /^(medical\s+redshirt|redshirt|red|rs|r)(?=[-\s]|fr|so|jr|sr|f(?![a-z])|$)[-\s]*/;

/** Leading noise: "Cl.: Jr", "Yr.: Sr", "Class: Junior", "Year: So". */
const FIELD_LABEL = /^(cl|yr|class|year)\s*[.:]+\s*/;

/**
 * Explicit graduation years appear directly in the column on some sites,
 * either as "2027" or as "'27".
 */
function explicitYear(text) {
  const full = text.match(/^'?(\d{4})\b/);
  if (full) {
    const year = Number(full[1]);
    return year >= 2000 && year <= 2100 ? year : null;
  }
  const short = text.match(/^'(\d{2})\b/);
  return short ? 2000 + Number(short[1]) : null;
}

/**
 * Classifies a raw label.
 *
 * Returns { klass, graduationYear, redshirt, recognised }. `recognised` is
 * false for anything that is not a class year at all — a club name, a squad
 * number, a hometown — which is the signal the importer acts on. An empty
 * label is simply absent, not suspicious, so it reads as recognised with
 * nothing in it.
 */
export function readClassYear(rawLabel, { season } = {}) {
  const raw = (rawLabel ?? '').toString().trim();
  const absent = { klass: null, graduationYear: null, redshirt: false, recognised: true };
  if (!raw) return absent;

  let text = raw.toLowerCase().replace(FIELD_LABEL, '').trim();

  // Before punctuation goes — an explicit year is written "2027" or "'27".
  const year = explicitYear(text);
  if (year) return { klass: null, graduationYear: year, redshirt: false, recognised: true };

  // Periods are decoration everywhere else: "F.Y." is "fy", "RS-Fr." is "rs-fr".
  text = text.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();

  const redshirt = REDSHIRT.test(text);
  if (redshirt) text = text.replace(REDSHIRT, '').trim();

  // Dual labels ("Jr./Jr.", "So./Fr.", "Sr.-TR", "Jr.-2L") — the left side is
  // the class, exactly as normalizePosition treats "M/F".
  text = text.split(/[/,]/)[0].trim();

  for (const [pattern, klass] of CLASS_PATTERNS) {
    if (pattern.test(text)) {
      const seasonYear = Number(season);
      return {
        klass,
        graduationYear: Number.isFinite(seasonYear) ? seasonYear + YEARS_TO_GRADUATE[klass] : null,
        redshirt,
        recognised: true,
      };
    }
  }

  // A bare redshirt marker ("Rs.", "RS", "Medical Redshirt") is a real label
  // that happens to carry no class. Absent, not wrong.
  if (redshirt && !text) return { klass: null, graduationYear: null, redshirt: true, recognised: true };

  return { klass: null, graduationYear: null, redshirt, recognised: false };
}

/** Convenience predicate for callers that only care whether to trust the cell. */
export function isClassYearLabel(rawLabel) {
  return readClassYear(rawLabel).recognised;
}
