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
 * Years from the season to graduation.
 *
 * A season is the calendar year the campaign kicks off in, so a senior on the
 * fall 2025 roster finishes in spring 2026 — one year, not two.
 *
 * These were each one too high until 2026-08-25, which put every athlete in
 * the wrong recruiting cohort and made the Pillar 4 opportunity signal read a
 * class that had not left yet. Two independent checks caught it and both are
 * now tests: 91.4% of players labelled "Sr." on a 2024 roster are absent from
 * the 2025 roster, and rosters that print an explicit graduation year instead
 * of a class label spanned 2026-2029 for the fall 2025 season while the
 * derived values spanned 2027-2030. The explicit years are literal, so they
 * are the arbiter — see the concordance test in classYear.test.js.
 *
 * SENIOR and GRADUATE are both 1 on purpose: whatever they are called, both
 * leave after this season.
 */
const YEARS_TO_GRADUATE = {
  FRESHMAN: 4,
  SOPHOMORE: 3,
  JUNIOR: 2,
  SENIOR: 1,
  GRADUATE: 1,
};

/**
 * Years from the season until eligibility is exhausted — a different fact from
 * the one above, and both are needed.
 *
 * `YEARS_TO_GRADUATE` is the ACADEMIC year, and it is not a convention: rosters
 * that print a graduation year outright spread cleanly across season+1 to
 * season+4 (316 such rows on the 2025 sheets, 72/77/77/90 across the four
 * offsets, none at +5), and 92% of players labelled "Sr." are gone the next
 * season. That is what a coach's own roster page says.
 *
 * Under five-year eligibility an athlete may still have a year in hand after
 * that, so eligibility runs one further for every class that is not already in
 * its last year. A GRADUATE — and a redshirt senior, which decomposes to one —
 * is leaving regardless, so the two coincide there.
 *
 * They answer different questions. Academic year matches what the roster page
 * shows and what an athlete calls their class. Eligibility year is when the
 * spot actually frees up, which is the Pillar 1 opening signal.
 */
const YEARS_TO_ELIGIBILITY_END = {
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
      // A redshirt senior is in a final year whatever the label says, so it
      // does not get the extra eligibility year that "Sr." would.
      const eligKlass = redshirt && klass === 'SENIOR' ? 'GRADUATE' : klass;
      return {
        klass,
        graduationYear: Number.isFinite(seasonYear) ? seasonYear + YEARS_TO_GRADUATE[klass] : null,
        eligibilityEndYear: Number.isFinite(seasonYear)
          ? seasonYear + YEARS_TO_ELIGIBILITY_END[eligKlass] : null,
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
