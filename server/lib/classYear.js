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

/**
 * Years from the season to the graduation year we store.
 *
 * The column is a MATCH KEY, not a biography. `players.recruiting_class_year`
 * is "the year this recruit would join a roster as a freshman", and pool.js
 * matches it against this on exact equality — so what this has to name is the
 * year the incumbent's spot OPENS, i.e. the year after their last season.
 * A junior in 2026 plays 2026, 2027, 2028 under five-year eligibility, so their
 * spot opens for the 2029 intake.
 *
 * These offsets ran one lower until 2026-08-27, on a four-season assumption.
 * The evidence for that is real and worth keeping, because it is what any
 * historical check will keep reproducing:
 *
 *   - Following the 2022 classes through five seasons, the four-season model
 *     predicted the year a spot actually opened for 55-79% of sophomores,
 *     juniors and seniors; the five-season model for 4-20%.
 *   - Only 7.9% of 2025 seniors appeared on a 2026 roster.
 *   - The 316 rows where a roster prints a graduation year outright span
 *     season+1 to season+4, never season+5.
 *
 * All of it describes a regime in which a senior was NOT PERMITTED to return —
 * only a redshirt senior was. So the 7.9% is a supply constraint, not a
 * preference, and none of it predicts behaviour now that the fifth year is
 * generally available. That is the deliberate call recorded here: the offsets
 * model the eligibility rule as it now stands rather than the behaviour of
 * players who never had the choice. Expect historical backtests to prefer the
 * old offsets, for exactly that reason.
 *
 * SENIOR is 2 and GRADUATE is 1 because a graduate student, a fifth year and a
 * redshirt senior are already IN their final season, while a senior still has
 * one to come.
 */
const YEARS_TO_GRADUATE = {
  FRESHMAN: 5,
  SOPHOMORE: 4,
  JUNIOR: 3,
  SENIOR: 2,
  GRADUATE: 1,
};

/**
 * The LAST SEASON this player can play — the other half of the same fact.
 *
 * Held separately because it is the quantity a human states ("a current junior
 * is eligible to 2028") while the stored graduation year is the one the matcher
 * needs ("so their spot opens for 2029"). It is always one less, and keeping
 * both means a reader never has to work out which end of the range a column
 * means.
 *
 * It is NOT redundant for every row: a roster that prints an explicit
 * graduation year tells us when a player finishes without saying which class
 * they are in, so the graduation year is known and the last season is not.
 */
const YEARS_TO_ELIGIBILITY_END = {
  FRESHMAN: 4,
  SOPHOMORE: 3,
  JUNIOR: 2,
  SENIOR: 1,
  GRADUATE: 0,
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
  // A fifth year or beyond is someone on the way out, not a super-senior
  // class. The upper end is not hypothetical — a 2024 roster listed an "8th".
  [/^([5-9](th)?|fifth|sixth|seventh|eighth|ninth)(?![a-z])/, 'GRADUATE'],
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
 * Returns { klass, graduationYear, eligibilityEndYear, redshirt, recognised }.
 * The two years differ deliberately: graduationYear is the academic year the
 * roster page implies, eligibilityEndYear is when eligibility runs out. `recognised` is
 * false for anything that is not a class year at all — a club name, a squad
 * number, a hometown — which is the signal the importer acts on. An empty
 * label is simply absent, not suspicious, so it reads as recognised with
 * nothing in it.
 */
export function readClassYear(rawLabel, { season } = {}) {
  const raw = (rawLabel ?? '').toString().trim();
  const absent = { klass: null, graduationYear: null, eligibilityEndYear: null, redshirt: false, recognised: true };
  if (!raw) return absent;

  let text = raw.toLowerCase().replace(FIELD_LABEL, '').trim();

  // Before punctuation goes — an explicit year is written "2027" or "'27".
  const year = explicitYear(text);
  // An explicit printed year is the academic year. Eligibility cannot be
  // derived from it -- the label says nothing about which class the athlete is
  // in -- so it stays null rather than being guessed at year+1.
  if (year) return { klass: null, graduationYear: year, eligibilityEndYear: null, redshirt: false, recognised: true };

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
      // A redshirt senior has already used the fifth year, so they are in their
      // final season and leave with the graduates. This must drive BOTH years:
      // while SENIOR and GRADUATE shared an offset it made no difference, but
      // now that a senior has a season still to come, reading one year from
      // SENIOR and the other from GRADUATE put R-Sr. at "last season 2026,
      // graduating 2028" — a two-year gap that cannot be right.
      const effective = redshirt && klass === 'SENIOR' ? 'GRADUATE' : klass;
      return {
        klass,
        graduationYear: Number.isFinite(seasonYear) ? seasonYear + YEARS_TO_GRADUATE[effective] : null,
        eligibilityEndYear: Number.isFinite(seasonYear)
          ? seasonYear + YEARS_TO_ELIGIBILITY_END[effective] : null,
        redshirt,
        recognised: true,
      };
    }
  }

  // A bare redshirt marker ("Rs.", "RS", "Medical Redshirt") is a real label
  // that happens to carry no class. Absent, not wrong.
  if (redshirt && !text) return { klass: null, graduationYear: null, eligibilityEndYear: null, redshirt: true, recognised: true };

  return { klass: null, graduationYear: null, eligibilityEndYear: null, redshirt, recognised: false };
}

/** Convenience predicate for callers that only care whether to trust the cell. */
export function isClassYearLabel(rawLabel) {
  return readClassYear(rawLabel).recognised;
}
