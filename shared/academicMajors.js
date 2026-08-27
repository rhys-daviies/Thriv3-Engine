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
  ['software engineering', 'Computer Science'], ['information technology', 'Computer Science'],
  ['information systems', 'Computer Science'],
  ['biological sciences', 'Biology'], ['biology', 'Biology'], ['pre-med', 'Biology'], ['premed', 'Biology'],
  ['psychology', 'Psychology'], ['psych', 'Psychology'],
  ['kinesiology', 'Kinesiology'], ['exercise science', 'Kinesiology'], ['sports management', 'Kinesiology'],
  ['athletic training', 'Kinesiology'], ['sport management', 'Kinesiology'],
  ['communications', 'Communications'], ['communication', 'Communications'], ['journalism', 'Communications'],
  ['public relations', 'Communications'], ['media studies', 'Communications'],
  ['nursing', 'Health Professions'], ['pre-nursing', 'Health Professions'],
  ['physical therapy', 'Health Professions'], ['pharmacy', 'Health Professions'],
  ['education', 'Education'], ['teaching', 'Education'],
  ['political science', 'Political Science'], ['poli sci', 'Political Science'],
  ['international relations', 'Political Science'], ['government', 'Political Science'],
  ['criminal justice', 'Criminal Justice'], ['criminology', 'Criminal Justice'],
  ['graphic design', 'Art & Design'], ['fine arts', 'Art & Design'], ['art', 'Art & Design'], ['design', 'Art & Design'],
  ['english', 'English'],
  ['mathematics', 'Mathematics'], ['math', 'Mathematics'], ['statistics', 'Mathematics'],
].sort((a, b) => b[0].length - a[0].length);

/** The CIP_FAMILIES label a free-text intended_major most likely means, or null. */
export function majorLabelFor(intendedMajor) {
  const text = String(intendedMajor || '').trim().toLowerCase();
  if (!text) return null;
  for (const [phrase, label] of SYNONYMS) {
    if (text.includes(phrase)) return label;
  }
  return null;
}
