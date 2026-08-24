/**
 * Fixed reference data for the matching model.
 *
 * Everything here is a real-world constant (NCAA scholarship limits, squad
 * shapes, budget bands) rather than a tuning knob. Tuning knobs live in
 * weights.js, where the backtest harness can move them without touching
 * anything that claims to describe the sport.
 */

/** Roster position vocabulary, as stored in roster_players.position. */
export const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];

/**
 * How many players a program typically needs to replace at each position in a
 * single recruiting class. A ~28-player squad carries roughly 3 GK / 9 D /
 * 10 MF / 6 F on a four-year cycle, so annual replacement is that divided by
 * four, rounded to something a coach would recognise.
 *
 * This is the denominator that turns "5 midfielders are graduating" into an
 * opportunity *rate*. Without it the old model just added 5x2 points and let
 * a big graduating class outrank every other consideration.
 */
export const EXPECTED_ANNUAL_NEED = {
  GOALKEEPER: 1,
  DEFENSE: 2.5,
  MIDFIELD: 2.5,
  FORWARD: 1.75,
};

/** Fallback when a recruit's position is missing or unrecognised. */
export const DEFAULT_ANNUAL_NEED = 2;

/**
 * A graduating starter is a real opening. A graduating squad player is a
 * weaker signal — the spot exists, but it was not being played.
 */
export const STARTER_DEPARTURE_WEIGHT = 1;
export const SQUAD_DEPARTURE_WEIGHT = 0.4;

/**
 * Mean athletic aid actually available per rostered player, as a fraction of
 * cost of attendance.
 *
 * Soccer is an NCAA *equivalency* sport: the limit is a pool of money split
 * across the squad, not a count of full rides. D1 men get 9.9 equivalencies
 * across a ~30-player roster; D1 women get 14. Divided across the squad that
 * is the fraction below. It is a mean, and coaches concentrate it on the
 * players they want most, so treat it as the expectation for a mid-value
 * recruit rather than a promise.
 *
 * D3 is 0 by NCAA rule and Ivy League D1 is 0 by conference rule — both meet
 * need through institutional aid instead, which is already reflected in the
 * net price we score against.
 */
export const ATHLETIC_AID_FRACTION = {
  'NCAA D1': { 'mens-soccer': 0.33, 'womens-soccer': 0.5 },
  'NCAA D2': { 'mens-soccer': 0.3, 'womens-soccer': 0.33 },
  'NCAA D3': { 'mens-soccer': 0, 'womens-soccer': 0 },
  NAIA: { 'mens-soccer': 0.3, 'womens-soccer': 0.3 },
  NJCAA: { 'mens-soccer': 0.4, 'womens-soccer': 0.4 },
};

/**
 * What a *priority signing* can command, as a fraction of cost of attendance.
 *
 * The mean above is the wrong number for this product. An equivalency pool is
 * split by hand, so a coach can concentrate it: the recruit they most want is
 * not offered the squad average, they are offered whatever it takes. The whole
 * purpose here is to find athletes awards well above average, so affordability
 * scores between the mean and this ceiling, scaled by how far above a
 * programme's level the athlete sits — a standout at a weaker programme is
 * exactly the recruit who commands the top of this range.
 *
 * Assumed, not measured. No per-player award data exists anywhere in this
 * database, and none of the governing bodies publish it. These are plausible
 * upper bounds from the equivalency limits, not observations.
 *
 * Zero at D3 and in the Ivy League stays zero — that is a rule, not a mean.
 */
export const MAX_ATHLETIC_AID_FRACTION = {
  'NCAA D1': { 'mens-soccer': 0.75, 'womens-soccer': 0.9 },
  'NCAA D2': { 'mens-soccer': 0.7, 'womens-soccer': 0.75 },
  'NCAA D3': { 'mens-soccer': 0, 'womens-soccer': 0 },
  NAIA: { 'mens-soccer': 0.8, 'womens-soccer': 0.8 },
  NJCAA: { 'mens-soccer': 0.95, 'womens-soccer': 0.95 },
};

/**
 * How far above a programme's level an athlete must sit to be treated as a
 * priority signing commanding the top of the award range, in soccer_score
 * points. Below this it scales linearly from the squad mean.
 */
export const STANDOUT_DELTA = 25;

/**
 * Floor on the affordability sub-score.
 *
 * Budget is a guideline, never a gate. A school priced beyond what a family
 * said they can pay is precisely the school a scholarship exists to make
 * reachable, so cost tilts the ranking and never removes anything. The old
 * curve reached zero at twice the stated budget, which is a constraint
 * wearing a score's clothing.
 */
export const AFFORDABILITY_FLOOR = 0.2;

/** Conferences that forbid athletic aid regardless of division. */
export const NO_ATHLETIC_AID_CONFERENCES = new Set(['Ivy League', 'Ivy']);

/**
 * Budget bands from the intake form, as an annual ceiling the family will pay
 * after all aid. `Need Full Scholarship` is a ceiling of zero and is handled
 * separately, because in an equivalency sport it is close to unachievable and
 * the model should say so rather than silently rank D3 schools against it.
 */
export const BUDGET_CEILINGS = {
  'Under $15k/yr': 15000,
  '$15k-$30k/yr': 30000,
  '$30k-$50k/yr': 50000,
  '$50k+/yr': Infinity,
  'Need Full Scholarship': 0,
};

/**
 * Where the international-community curve saturates.
 *
 * A programme's international share, at which an overseas recruit is plainly
 * routine there rather than an exception. Men's college soccer averages 30%
 * international and women's 9.6%, but the spread across programmes is what
 * matters: 105 men's programmes carry none at all, 116 carry over 60%. A coach
 * who has never signed an international is a materially harder sell — the visa
 * paperwork, the eligibility clearinghouse and the recruiting network are all
 * things a programme either does or does not already do.
 */
export const INTERNATIONAL_SHARE_SCALE = 0.2;

/**
 * How many compatriots make a contingent rather than a coincidence.
 *
 * Country clusters in this data are real and large — Union Commonwealth
 * carries 23 UK players, LSU Alexandria 18 — and they are the clearest
 * evidence a programme recruits a particular pipeline.
 */
export const SAME_COUNTRY_FULL = 3;

/** Split between "internationals are normal here" and "your countrymen are here". */
export const INTERNATIONAL_COMMUNITY_WEIGHT = 0.65;
export const SAME_COUNTRY_WEIGHT = 0.35;

/**
 * Floor for an international athlete's location score.
 *
 * A programme with no overseas players is a longer shot, not an impossibility,
 * and some coach signs a first international every year.
 */
export const INTERNATIONAL_FLOOR = 0.15;

/** Neutral prior used wherever an input is missing, never zero. */
export const NEUTRAL_PRIOR = 0.5;
