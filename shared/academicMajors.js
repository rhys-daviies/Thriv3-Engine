/**
 * Maps a recruit's free-text `intended_major` to a notable-major label a
 * school's own colleges.notable_majors list can be checked against.
 *
 * CIP_FAMILIES is also the source of truth for which College Scorecard
 * PCIP-code family each label corresponds to -- see
 * server/scripts/importNotableMajors.js, which is the only other consumer.
 * One mapping, so the labels used to build notable_majors and the labels
 * used to match player.intended_major can never drift apart.
 */
export const CIP_FAMILIES = {
  Business: ['52'],
  Engineering: ['14', '15'],
  'Computer Science': ['11'],
  Biology: ['26'],
  Psychology: ['42'],
  Kinesiology: ['31'],
  Communications: ['09'],
  // CIP 51 is "Health Professions and Related Programs" broadly -- nursing,
  // physical therapy, pharmacy, medical technology, etc. -- not nursing
  // specifically, so the label stays honest about what the data can actually
  // support rather than naming one program within it that may not be the
  // school's real strength.
  'Health Professions': ['51'],
  Education: ['13'],
  'Political Science': ['45'],
  'Criminal Justice': ['43'],
  'Art & Design': ['50'],
  English: ['23'],
  Mathematics: ['27'],
};

/**
 * Free-text phrases a recruit might type for `intended_major`, mapped to the
 * CIP_FAMILIES label they mean. Longest phrase wins so "computer science"
 * does not fall through to a shorter, less specific match first.
 */
const SYNONYMS = [
  ['business administration', 'Business'], ['business', 'Business'], ['marketing', 'Business'],
  ['finance', 'Business'], ['accounting', 'Business'], ['entrepreneurship', 'Business'],
  ['mechanical engineering', 'Engineering'], ['civil engineering', 'Engineering'],
  ['electrical engineering', 'Engineering'], ['engineering', 'Engineering'],
  ['computer science', 'Computer Science'], ['comp sci', 'Computer Science'],
  // CIP 11 is Computer and Information Sciences; data science is 11.0802.
  // "cs" is safe only because matching is now token-bounded — as a substring
  // it fired inside physics, economics, classics, statistics and mathematics.
  ['data science', 'Computer Science'], ['cs', 'Computer Science'],
  ['software engineering', 'Computer Science'], ['information technology', 'Computer Science'],
  ['information systems', 'Computer Science'],
  ['biological sciences', 'Biology'], ['biology', 'Biology'], ['pre-med', 'Biology'], ['premed', 'Biology'],
  ['psychology', 'Psychology'], ['psych', 'Psychology'],
  ['kinesiology', 'Kinesiology'], ['exercise science', 'Kinesiology'], ['sports management', 'Kinesiology'],
  ['athletic training', 'Kinesiology'], ['sport management', 'Kinesiology'],
  // CIP 31 is Parks, Recreation, Leisure, Fitness AND Kinesiology, which is
  // where sport science and sports medicine sit as undergraduate majors —
  // beside athletic training, which was already mapped here.
  ['sport science', 'Kinesiology'], ['sports science', 'Kinesiology'],
  ['sports medicine', 'Kinesiology'],
  ['communications', 'Communications'], ['communication', 'Communications'], ['journalism', 'Communications'],
  ['public relations', 'Communications'], ['media studies', 'Communications'],
  ['nursing', 'Health Professions'], ['pre-nursing', 'Health Professions'],
  ['physical therapy', 'Health Professions'], ['pharmacy', 'Health Professions'],
  ['education', 'Education'], ['teaching', 'Education'],
  ['political science', 'Political Science'], ['poli sci', 'Political Science'],
  ['international relations', 'Political Science'], ['government', 'Political Science'],
  ['criminal justice', 'Criminal Justice'], ['criminology', 'Criminal Justice'],
  // "arts" is deliberately NOT an alias. As a bare token it would take back
  // martial arts, liberal arts and culinary arts, which is the defect this
  // list was fixed for. The art phrases that ARE this family are named.
  ['graphic design', 'Art & Design'], ['art history', 'Art & Design'],
  ['fine arts', 'Art & Design'], ['fine art', 'Art & Design'],
  ['visual arts', 'Art & Design'], ['studio art', 'Art & Design'],
  ['art', 'Art & Design'], ['design', 'Art & Design'],
  ['english', 'English'],
  ['mathematics', 'Mathematics'], ['math', 'Mathematics'], ['statistics', 'Mathematics'],
].sort((a, b) => b[0].length - a[0].length);

/**
 * One free-text value as a space-delimited token string, padded at both ends.
 *
 * Padding is what makes a plain `includes` a WORD match: " art " cannot be
 * found inside " martial arts ", but " fine arts " can be found inside
 * " fine arts ". Punctuation becomes a separator, so "C.S." and "comp-sci"
 * normalise the same as their spaced forms.
 */
const tokens = (value) => ` ${String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * The CIP_FAMILIES label a free-text intended_major most likely means, or null.
 *
 * MATCHING IS TOKEN-BOUNDED, and that is the whole of the L3 fix. It used to be
 * `text.includes(phrase)` against raw substrings, which is unbounded: "art"
 * fired inside "martial arts", "liberal arts", "Earth Science" and
 * "Cartography", and "cs" would have fired inside physics, economics, classics
 * and statistics. L2 found two of those by reading emails; the rest appeared as
 * soon as the defect was probed as a class rather than as a phrase. Fixing the
 * two named cases would have left the other four.
 *
 * Longest phrase first is unchanged, so "computer science" still beats a
 * shorter, vaguer entry that also matches.
 *
 * Not fuzzy, not scored, no external service: a padded token string and an
 * ordered list, which is the same shape the caller could verify by hand.
 */
export function majorLabelFor(intendedMajor) {
  const text = tokens(intendedMajor);
  if (text.trim() === '') return null;
  for (const [phrase, label] of SYNONYMS) {
    if (text.includes(tokens(phrase))) return label;
  }
  return null;
}

/**
 * The four states an athlete's academic intent can be in.
 *
 * The matcher answers one question — which family, or none — and null covers
 * three different situations that mean different things to an operator: nobody
 * asked, the athlete genuinely has not decided, and the athlete answered with
 * something this taxonomy cannot place. All three correctly produce no
 * ACADEMIC_FIT, so this changes NO Evidence semantics; it exists so a notice
 * can say which of the three happened rather than "not set".
 */
export const ACADEMIC_INTENT = Object.freeze({
  MISSING: 'MISSING',
  UNDECIDED: 'UNDECIDED',
  UNSUPPORTED: 'UNSUPPORTED',
  VALID: 'VALID',
});

/**
 * Answers an athlete gives that ARE answers, and mean "not yet".
 *
 * Matched with the same token rule as the synonyms, so "still undecided" and
 * "Undeclared." land here rather than in UNSUPPORTED. Not a claim of
 * completeness — an unrecognised non-answer simply reads as UNSUPPORTED, which
 * is the safe direction: it tells the operator to look rather than implying
 * the athlete was asked and declined.
 */
const UNDECIDED_PHRASES = ['undecided', 'undeclared', 'general studies', 'not sure', 'unsure',
  'open', 'tbd', 'n a', 'none', 'unknown', 'exploring', 'no preference'];

/** Which of the four states this stored value is in. Never throws. */
export function academicIntentState(intendedMajor) {
  const text = tokens(intendedMajor);
  if (text.trim() === '') return ACADEMIC_INTENT.MISSING;
  if (majorLabelFor(intendedMajor)) return ACADEMIC_INTENT.VALID;
  for (const phrase of UNDECIDED_PHRASES) {
    if (text.includes(tokens(phrase))) return ACADEMIC_INTENT.UNDECIDED;
  }
  return ACADEMIC_INTENT.UNSUPPORTED;
}
