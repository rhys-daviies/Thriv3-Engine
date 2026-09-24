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

/**
 * The bands a NEW athlete may be offered.
 *
 * `$40k+/yr` is deliberately absent. A7.9.1 proved it carries no information:
 * because its ceiling is unstated, Financial scores it at the only end the
 * family actually stated, so replaying Fixture A with a maximum of exactly
 * $40,000 reproduced production at Kendall tau 1.000 with zero rank changes.
 * Asking an open-ended band whose upper bound the arithmetic requires is
 * asking a question whose answer is thrown away.
 *
 * `budgetInterval` still parses it, because old records hold it and reading
 * them is not the same as offering them.
 */
export const INTAKE_BUDGET_BANDS = Object.freeze(
  Object.keys(BUDGET_INTERVALS).filter((b) => Number.isFinite(BUDGET_INTERVALS[b][1])),
);

/**
 * What the family has told us about the one quantity Financial needs.
 *
 * Financial reads exactly one number from the athlete: the most they can pay
 * in a year. Everything else about them is a fact about them, not about a
 * programme. These three states are the only honest answers to that question,
 * and they must never collapse into each other.
 */
export const CONTRIBUTION_STATE = Object.freeze({
  /** A number was stated. `maxAnnualContributionUsd` is required and >= 0. */
  STATED: 'STATED',
  /**
   * The family has recorded that college cost is not a meaningful constraint
   * on which programmes they would consider.
   *
   * It is a MEASUREMENT, in exactly the sense `Need Full Scholarship` is one:
   * a stated position, at the opposite end. It does NOT mean infinite wealth,
   * it does NOT mean any award is expected or certain, and it says nothing
   * about what a programme costs - the cost still travels in the basis.
   */
  NOT_A_CONSTRAINT: 'NOT_A_CONSTRAINT',
  /**
   * Nobody has answered yet. Financial must REFUSE, through the same
   * NO_FAMILY_CONTRIBUTION path an absent band takes.
   *
   * Never zero. Zero is the full-scholarship request and means the opposite.
   */
  NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
});

/** Where a resolved contribution interval came from. Recorded on every result. */
export const CONTRIBUTION_SOURCE = Object.freeze({
  /** The new field: a stated maximum, read as the exact interval [max, max]. */
  EXACT_STATED_MAXIMUM: 'EXACT_STATED_MAXIMUM',
  /** The new field: cost stated not to constrain. */
  NOT_A_CONSTRAINT: 'NOT_A_CONSTRAINT',
  /** No new field; scored from the older `budget_range` band. */
  LEGACY_BAND: 'LEGACY_BAND',
  /** Nothing usable. Financial refuses. */
  NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
});

const CONTRIBUTION_STATES = new Set(Object.values(CONTRIBUTION_STATE));

/**
 * Validate a contribution pair, WITHOUT coercing it.
 *
 * Returns null when the pair is a legal combination, or a string naming what
 * is wrong. An illegal pair is never silently repaired: a numeric maximum
 * sitting beside NOT_A_CONSTRAINT is two different answers to one question,
 * and guessing which one the family meant is how a model invents a budget.
 *
 * A wholly absent pair (both null/undefined) is legal - it is a record from
 * before the field existed, and the legacy band decides.
 */
export function contributionPairError({ contributionState = null, maxAnnualContributionUsd = null } = {}) {
  const state = contributionState ?? null;
  const max = maxAnnualContributionUsd ?? null;
  if (state === null) {
    return max === null ? null : 'max_annual_contribution_usd requires a contribution_state';
  }
  if (!CONTRIBUTION_STATES.has(state)) {
    return `unknown contribution_state ${JSON.stringify(state)}`;
  }
  if (state === CONTRIBUTION_STATE.STATED) {
    if (max === null) return 'contribution_state STATED requires max_annual_contribution_usd';
    if (typeof max !== 'number' || !Number.isFinite(max)) return 'max_annual_contribution_usd must be a finite number';
    if (max < 0) return 'max_annual_contribution_usd must be zero or greater';
    return null;
  }
  return max === null ? null : `contribution_state ${state} requires max_annual_contribution_usd to be null`;
}

/**
 * Resolve what the family can pay, as an interval, from whichever answer we
 * hold.
 *
 * PRECEDENCE: the new fields first, then the legacy band, then refusal. The
 * new fields win outright because they answer the question Financial actually
 * asks; a record carrying both has been updated and the band is history.
 *
 * -- WHY THE NEW FIELD EXISTS --------------------------------------------
 *
 * `$40k+/yr` encodes [40000, Infinity). Financial cannot average in an
 * unstated ceiling without crediting a capacity nobody claimed, so it scores
 * the end the family did state - which makes the band arithmetically
 * identical to a maximum of exactly $40,000. A7.9.1 measured that directly:
 * Fixture A replayed at an exact $40,000 reproduced production at Kendall tau
 * 1.000 with not one programme moving a single place. The "+" was never read.
 *
 * Every one of the five programmes that band demoted - Michigan, Penn State,
 * Pittsburgh, Vermont, Rutgers - is a public priced out-of-state, where the
 * non-resident premium carries the cost past $40,000. Michigan's premium
 * alone is $43,210 on a net price of $13,138.
 *
 * NOTHING HERE INFERS AID. The new field is athlete-side only: it improves
 * what the family told us, and changes no programme-side cost, no aid rule
 * and no assumption about any award.
 *
 * @returns {null|{interval:[number,number], legacy:boolean, source:string,
 *                 state:string|null, statedMaximum:number|null, unbounded:boolean}}
 *          null means REFUSE - never treat it as zero.
 */
export function familyContribution({
  contributionState = null, maxAnnualContributionUsd = null, budgetRange = null,
} = {}) {
  const err = contributionPairError({ contributionState, maxAnnualContributionUsd });
  if (err) throw new Error(`familyContribution: ${err}`);

  if (contributionState === CONTRIBUTION_STATE.STATED) {
    const max = maxAnnualContributionUsd;
    return {
      interval: [max, max],
      legacy: false,
      source: CONTRIBUTION_SOURCE.EXACT_STATED_MAXIMUM,
      state: contributionState,
      statedMaximum: max,
      unbounded: false,
    };
  }

  if (contributionState === CONTRIBUTION_STATE.NOT_A_CONSTRAINT) {
    /**
     * No interval, because there is no number. The caller builds a gap of zero
     * by construction rather than by arithmetic on a made-up ceiling - see
     * layers/financial.js. `interval` is null so nothing can subtract from it
     * by accident.
     */
    return {
      interval: null,
      legacy: false,
      source: CONTRIBUTION_SOURCE.NOT_A_CONSTRAINT,
      state: contributionState,
      statedMaximum: null,
      unbounded: true,
    };
  }

  if (contributionState === CONTRIBUTION_STATE.NEEDS_CONFIRMATION) return null;

  /**
   * THE OPEN LEGACY BAND STILL SCORES, and that was a decision rather than an
   * oversight.
   *
   * A7.9.2 considered refusing `$40k+/yr` outright, on the grounds that it
   * confirms no maximum. Measured, that would have taken Fixtures A and C from
   * 858 ranked programmes to none at all - Pursuit requires all three layers -
   * which would end the fixture that every diagnostic since A7.7 has been run
   * on, for no gain on any live record: zero athletes on file carry the band.
   *
   * So it keeps scoring exactly as it always has, at the floor the family did
   * state, and the explanation says out loud that the ceiling is unconfirmed.
   * What does NOT happen is the other half: migration never writes 40000 into
   * `max_annual_contribution_usd`, because that would turn a conservative
   * reading into a claim the family never made.
   */
  const band = budgetInterval(budgetRange);
  if (!band) return null;
  return {
    interval: band.interval,
    legacy: band.legacy,
    source: CONTRIBUTION_SOURCE.LEGACY_BAND,
    state: null,
    statedMaximum: null,
    unbounded: !Number.isFinite(band.interval[1]),
  };
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
