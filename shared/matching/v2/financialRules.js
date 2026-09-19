/**
 * The financial rules, as data with provenance.
 *
 * WHY THESE ARE RESTATED RATHER THAN IMPORTED. V1's `constants.js` holds the
 * same tables, and V2 may not import it - not because the numbers are wrong,
 * but because V1 is frozen and these must be able to move without moving it.
 * `shared/eligibility.js` was separated from `classYear.js` for the same
 * reason. A test in server/lib/v2 reads both and fails if the BAND VOCABULARY
 * drifts apart, because the intake form feeds one of them and a band the form
 * offers but V2 cannot read would silently stop being scoreable.
 *
 * The aid tables are deliberately NOT cross-checked against V1's, because V2
 * uses them for a different purpose - see athleticAidRule below.
 */

/**
 * Budget bands, as the INTERVAL each one states.
 *
 * V1 reads only the ceiling of each band. That throws away the half of the
 * answer that says what the family has already committed to, and it is the
 * half that decides how big a shortfall is relative to their means. A family
 * saying "$20k-$25k" has told us two things and we should keep both.
 *
 * `Need Full Scholarship` is [0, 0]: a stated intention to pay nothing, which
 * is a measurement, not an absence.
 * `$40k+/yr` is [40000, Infinity): the floor is stated and the ceiling is not.
 *
 * Source: the picker in src/components/PlayerFormSteps.jsx, via V1's
 * BUDGET_CEILINGS. Verified 2026-09-20.
 */
export const BUDGET_INTERVALS = Object.freeze({
  'Need Full Scholarship': [0, 0],
  '$0-$5k/yr': [0, 5000],
  '$5k-$10k/yr': [5000, 10000],
  '$10k-$15k/yr': [10000, 15000],
  '$15k-$20k/yr': [15000, 20000],
  '$20k-$25k/yr': [20000, 25000],
  '$25k-$30k/yr': [25000, 30000],
  '$30k-$35k/yr': [30000, 35000],
  '$35k-$40k/yr': [35000, 40000],
  '$40k+/yr': [40000, Infinity],
});

/**
 * Bands used before 2026-08-25. Readable, but coarser than the question we ask
 * now, so anything scored from one is PARTIAL.
 */
export const LEGACY_BUDGET_INTERVALS = Object.freeze({
  'Under $15k/yr': [0, 15000],
  '$15k-$30k/yr': [15000, 30000],
  '$30k-$50k/yr': [30000, 50000],
  '$50k+/yr': [50000, Infinity],
});

/** The deliberate "I would rather not say". Not a band, and not a zero. */
export const UNDECLARED_BUDGET = 'Undeclared';

/**
 * Read a band as an interval.
 *
 * Returns null for Undeclared, for a blank field and for anything unrecognised.
 * Callers must never treat null as zero: zero is the full-scholarship request
 * and means the opposite of "we do not know".
 */
export function budgetInterval(band) {
  if (band === null || band === undefined || band === '') return null;
  if (band === UNDECLARED_BUDGET) return null;
  if (band in BUDGET_INTERVALS) return { interval: BUDGET_INTERVALS[band], legacy: false };
  if (band in LEGACY_BUDGET_INTERVALS) return { interval: LEGACY_BUDGET_INTERVALS[band], legacy: true };
  return null;
}

/** IPEDS `control`: 1 public, 2 private non-profit, 3 private for-profit. */
export const CONTROL = Object.freeze({ PUBLIC: 1, PRIVATE_NONPROFIT: 2, PRIVATE_FOR_PROFIT: 3 });

/**
 * Athletic-aid rules, per association and sport.
 *
 * `maxFraction` is the equivalency LIMIT as published - the share of a full
 * cost of attendance one athlete may receive. It is recorded here as a RULE
 * FACT and is never converted into dollars by this layer; see the header of
 * layers/financial.js for why.
 *
 * A division absent from this table has NO RULE ON FILE and must resolve to
 * UNKNOWN, never to zero. Verified 2026-09-20 against the same published
 * sources as V1's tables.
 */
export const ATHLETIC_AID_RULES = Object.freeze({
  'NCAA D1': { 'mens-soccer': { maxFraction: 0.75 }, 'womens-soccer': { maxFraction: 0.9 } },
  'NCAA D2': { 'mens-soccer': { maxFraction: 0.7 }, 'womens-soccer': { maxFraction: 0.75 } },
  'NCAA D3': { 'mens-soccer': { maxFraction: 0 }, 'womens-soccer': { maxFraction: 0 } },
  NAIA: { 'mens-soccer': { maxFraction: 0.8 }, 'womens-soccer': { maxFraction: 0.8 } },
  NJCAA: { 'mens-soccer': { maxFraction: 0.95 }, 'womens-soccer': { maxFraction: 0.95 } },
});

/** Divisions we hold no athletic-aid rule for. Named, so the gap is visible. */
export const UNRULED_AID_DIVISIONS = Object.freeze(['USCAA']);

/** Conferences forbidding athletic aid within an association that permits it. */
export const NO_ATHLETIC_AID_CONFERENCES = Object.freeze(['Ivy League', 'Ivy']);

/**
 * Where the family contribution is so small that dividing by it stops meaning
 * anything - most obviously `Need Full Scholarship`, which states zero.
 *
 * HEURISTIC. Set to the median net price across our own active programmes
 * ($19,454 men's, 2026-09-20) so that a family stating no contribution is
 * measured against what a typical programme actually costs. Without it, a
 * zero contribution makes every relative gap infinite and the layer collapses
 * into "every school is impossible", which is true only of a model that
 * cannot see scholarships - which is precisely what this one cannot see.
 */
export const CONTRIBUTION_ANCHOR = 19454;

/**
 * The relative funding gap at which viability is one half.
 *
 * HEURISTIC, but an interpretable one: at 0.5 a family must find, on top of
 * everything they said they could pay, a further half of that amount again.
 * Said $20k, school costs $30k. That is the point this layer calls evenly
 * balanced, and it is the single number to argue about first.
 */
export const HALF_VIABILITY_RELATIVE_GAP = 0.5;
