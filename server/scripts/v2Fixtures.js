/**
 * The eight athletes the V1 matching baseline is pinned on.
 *
 * COPIED VERBATIM from server/scripts/snapshotMatchingBaseline.js, which
 * cannot be imported: it runs at module scope and calls process.exit. The copy
 * is held honest by v2Fixtures.test.js, which parses both files and fails on
 * any difference.
 *
 * Every V2 diagnostic uses these, so that a V2 report and the frozen baseline
 * describe the same people. That is not decoration. A7.1 shipped a
 * paraphrased set whose budget bands ("$20k-$30k/yr") exist in neither the
 * current nor the legacy vocabulary; V1 vs V1 was zero either way, so nothing
 * caught it, and the first layer that reads a budget found two of eight
 * athletes unscoreable against the entire pool.
 *
 * Data only. Nothing here runs.
 */
export const FIXTURES = [
  {
    id: 'A-strong-high-budget-strong-academics',
    why: 'The case where affordability saturates: every ceiling is cleared, so the list is decided by ability, level and location alone.',
    player: {
      sport: 'mens-soccer', football_ability: 9, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.9, sat_score: 1450, act_score: null,
      budget_range: '$40k+/yr', state: 'CA', city: 'Los Angeles', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'B-strong-low-budget',
    why: 'Three couplings fire together — location up, affordability up, athletic peak pushed above the programme level — so this is the fixture that pins the coupling layer end to end.',
    player: {
      sport: 'mens-soccer', football_ability: 9, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.2, sat_score: null, act_score: null,
      budget_range: '$5k-$10k/yr', state: 'CA', city: 'Los Angeles', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'C-developmental-high-budget-strong-academics',
    why: 'THE PATHOLOGY FIXTURE. An athlete who cannot play at an elite programme, carrying the two things that are supposed not to buy their way in. What rank an elite programme reaches here is the number the V2 recruitability ceiling exists to move.',
    player: {
      sport: 'mens-soccer', football_ability: 3, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 4.0, sat_score: 1550, act_score: null,
      budget_range: '$40k+/yr', state: 'MA', city: 'Boston', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'D-developmental-low-budget',
    why: 'The opposite corner of C, and the fixture that pins division composition at the bottom of the ability range.',
    player: {
      sport: 'mens-soccer', football_ability: 3, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 2.8, sat_score: null, act_score: null,
      budget_range: '$5k-$10k/yr', state: 'TX', city: 'Dallas', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'E-domestic-in-state-public',
    why: 'Texas carries public programmes across every division, so this fixture is where the residency lever and the in-state geography lift are both live and separable.',
    player: {
      sport: 'mens-soccer', football_ability: 6, position: 'Defender',
      recruiting_class_year: 2028, gpa: 3.4, sat_score: 1150, act_score: null,
      budget_range: '$10k-$15k/yr', state: 'TX', city: 'Austin', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'F-international',
    why: 'Location stops being distance and becomes internationalFit, which is the one criterion an international athlete is ranked on differently. England is chosen because the compatriot clusters are large enough for the same-country half to be live rather than uniformly zero.',
    player: {
      sport: 'mens-soccer', football_ability: 7, position: 'Forward',
      recruiting_class_year: 2028, gpa: 3.3, sat_score: null, act_score: null,
      budget_range: '$15k-$20k/yr', state: null, city: null, nationality: 'England',
      origin: 'International', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'G-goalkeeper-starter-evidence',
    why: 'THE STARTER-SPLIT FIXTURE. EXPECTED_ANNUAL_NEED is 1 for a goalkeeper, so one departing STARTER saturates roster opportunity at 1.0 where the same player read as squad scores 0.4. If projected_minutes is ever dropped again, this fixture moves and the probes below say by how much.',
    player: {
      sport: 'mens-soccer', football_ability: 6, position: 'Goalkeeper',
      recruiting_class_year: 2028, gpa: 3.5, sat_score: 1200, act_score: null,
      budget_range: '$20k-$25k/yr', state: 'OH', city: 'Columbus', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'H-womens-strong-mid-budget',
    why: 'The women\'s game has its own pool, its own aid constants (0.5/0.9 at D1 against 0.33/0.75) and no NJCAA at all, so a men\'s-only baseline would pin none of it.',
    player: {
      sport: 'womens-soccer', football_ability: 8, position: 'Defender',
      recruiting_class_year: 2028, gpa: 3.7, sat_score: 1300, act_score: null,
      budget_range: '$20k-$25k/yr', state: 'NC', city: 'Charlotte', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
];

/** The columns `normaliseAthlete` reads that every fixture already states. */
export const BASE_PLAYER = {};
