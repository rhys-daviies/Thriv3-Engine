/**
 * Athletes that exist ONLY to be reviewed by a human.
 *
 * NOT REGRESSION FIXTURES. Nothing here is pinned in a baseline, nothing here
 * may be added to one, and the eight frozen fixtures in v2Fixtures.js are not
 * touched by this file. They describe the same eight people the V1 baseline
 * describes, and that is the only reason they are trustworthy.
 *
 * -- WHY THESE TWO --------------------------------------------------------
 *
 * The frozen eight cover most of the archetypes A7.7 asks for. Two are absent
 * and both matter:
 *
 *   V-ELITE   the frozen set tops out at rating 9, which calibrates to the
 *             83.6th percentile of men's programmes. A 10 sits at 98.8 and is
 *             the only athlete for whom the athletic ceiling is not a
 *             constraint anywhere. If Coach Recruitability behaves sensibly it
 *             must behave differently for this athlete than for a 9.
 *
 *   V-WMID    the women's game has its own calibration, its own aid constants
 *             and no NJCAA. Fixture H covers a strong women's athlete; nothing
 *             covers the middle of that distribution, which is where most of
 *             the programmes are.
 *
 * Every other archetype in the A7.7 list is covered by a frozen fixture or by
 * an ambition profile applied to one - see ARCHETYPE_COVERAGE below.
 */
export const VALIDATION_FIXTURES = [
  {
    id: 'V-ELITE-mens',
    validationOnly: true,
    why: 'The only athlete in the set for whom the athletic ceiling binds nowhere. Reviews whether the top of the list is differentiated by something other than reach.',
    recruitType: 'HIGH_SCHOOL',
    player: {
      sport: 'mens-soccer', football_ability: 10, position: 'Forward',
      recruiting_class_year: 2028, gpa: 3.6, sat_score: 1320, act_score: null,
      budget_range: '$25k-$30k/yr', state: 'NJ', city: 'Newark', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'V-WMID-womens',
    validationOnly: true,
    why: 'The middle of the women\'s distribution, where most women\'s programmes are and where no frozen fixture sits.',
    recruitType: 'HIGH_SCHOOL',
    player: {
      sport: 'womens-soccer', football_ability: 5, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.5, sat_score: 1140, act_score: null,
      budget_range: '$15k-$20k/yr', state: 'IL', city: 'Chicago', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
];

/**
 * The A7.7 archetype list, and what covers each one.
 *
 * Written down so that "we covered the archetypes" is a checkable claim rather
 * than an assertion, and so the next person can see which ones are covered by
 * a PROFILE applied to an existing athlete rather than by a separate athlete -
 * which is the right way to cover a preference, because a preference is not a
 * different person.
 */
export const ARCHETYPE_COVERAGE = Object.freeze([
  { archetype: 'elite / high-level men\'s athlete', covered: 'V-ELITE (rating 10); A and B sit at 9', source: 'validation fixture' },
  { archetype: 'strong men\'s athlete', covered: 'A, B (rating 9)', source: 'frozen' },
  { archetype: 'mid-level men\'s athlete', covered: 'E (rating 6), F (rating 7)', source: 'frozen' },
  { archetype: 'developmental men\'s athlete', covered: 'C, D (rating 3)', source: 'frozen' },
  { archetype: 'low-budget strong athlete', covered: 'B ($5k-$10k/yr at rating 9)', source: 'frozen' },
  { archetype: 'goalkeeper', covered: 'G', source: 'frozen' },
  { archetype: 'international athlete', covered: 'F (England, no home state)', source: 'frozen' },
  { archetype: 'domestic same-state athlete', covered: 'E (Texas, public programmes in every division)', source: 'frozen' },
  { archetype: 'high-level women\'s athlete', covered: 'H (rating 8)', source: 'frozen' },
  { archetype: 'mid-level women\'s athlete', covered: 'V-WMID (rating 5)', source: 'validation fixture' },
  { archetype: 'prioritising highest competitive level', covered: 'profile LEVEL_FIRST (5 / 1) on any athlete', source: 'profile' },
  { archetype: 'prioritising immediate playing time', covered: 'profile PLAYING_FIRST (1 / 5)', source: 'profile' },
  { archetype: 'both priorities high', covered: 'profile BOTH_HIGH (5 / 5)', source: 'profile' },
  { archetype: 'neither preference declared', covered: 'profile UNDECLARED (null / null) - the default every frozen fixture runs under', source: 'profile' },
]);

/** Re-exported so a script has one import. Defined beside the input contract. */
export { PROFILES } from '../../shared/matching/v2/index.js';

/**
 * The first review pack set.
 *
 * Six packs, chosen so that every mandatory section of A7.7 has a document
 * behind it and so that one person can finish the set. Fixture A appears twice
 * because the two profiles are the comparison; so does H, because the
 * instruction is explicitly not to validate only men's soccer.
 */
export const FIRST_PACK_SET = Object.freeze([
  { fixture: 'C', profile: 'UNDECLARED', why: 'A7.7 §15 - the V1 pathology fixture. Reviewed first: it is the one that decides whether the layered model bought anything.' },
  { fixture: 'A', profile: 'LEVEL_FIRST', why: 'A7.7 §16 - the programme-strength tilt, from the ambitious side.' },
  { fixture: 'A', profile: 'PLAYING_FIRST', why: 'A7.7 §16 - the same athlete, opposite goal. The pair is the review, not either pack alone.' },
  { fixture: 'G', profile: 'UNDECLARED', why: 'A7.7 §17 - goalkeeper. The unresolved A7.5.2 question about gate dominance.' },
  { fixture: 'H', profile: 'LEVEL_FIRST', why: 'A7.7 §18 - women\'s soccer, level-first.' },
  { fixture: 'H', profile: 'PLAYING_FIRST', why: 'A7.7 §18 - women\'s soccer, playing-first.' },
]);
