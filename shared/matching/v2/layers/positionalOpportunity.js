/**
 * Is there a place at this position for one more recruit?
 *
 * -- WHAT IS SCORED, AND WHAT IS DELIBERATELY NOT ---------------------------
 *
 * The measured confounds rule most of the obvious signals out. Position-group
 * size correlates with openings at 0.489, with returning depth at 0.629 and
 * with arrivals at 0.730; scoring any two of them independently counts the
 * same fact twice and calls it corroboration.
 *
 *   openings           SCORED, and only as VACATED STARTING PLACES. A squad
 *                      player leaving does not open a place anyone held.
 *   vacated quality    SCORED - it is the same term. Restricting openings to
 *                      starters IS the quality weighting, so there is no
 *                      second term to add.
 *   fill propensity    SCORED, as the rate at which such a place becomes a
 *                      newcomer's. Measured per division and position.
 *   current arrivals   SCORED, as a bounded claim on those places.
 *   returning depth    NOT SCORED. Context only, and this was measured rather
 *                      than assumed. The first version of this layer scored
 *                      returners beyond the starting places still held - a
 *                      "bench" term that looked scale-free and is not: across
 *                      3,472 real position groups it correlates with group
 *                      size at r = 0.945, WORSE than the raw returning count
 *                      at 0.928, and it is non-zero for 96% of them. It was
 *                      position-group size wearing a disguise.
 *
 *                      Internal competition is not dropped, it is measured
 *                      better elsewhere: `fillPropensity` IS the rate at which
 *                      a vacated place goes to a newcomer rather than to
 *                      someone already there. That is what 0.51 at goalkeeper
 *                      against 0.85 at midfield means - at goalkeeper the
 *                      bench wins half the time. Adding a returning term
 *                      counts that twice, using a contaminated proxy for the
 *                      thing already counted cleanly.
 *   group size         NOT SCORED AT ALL. It is the thing every other signal
 *                      is contaminated by, and it is carried as context.
 *   programme quality  EXCLUDED. It is not evidence about a position.
 *
 * -- NORMALISATION ----------------------------------------------------------
 *
 * `typicalStarters` divides exactly once, at the end. It is what makes two
 * openings at goalkeeper - where one place exists - a different fact from two
 * at midfield, where five do.
 *
 * -- ELIGIBLE TO REMAIN IS NOT EXPECTED TO RETURN ---------------------------
 *
 * Openings are counted from eligibility expiry, not from class label, so a
 * Division I senior in 2026 with a year of the five-year window left is NOT an
 * opening for 2027 and a Division III senior is. Nobody's retention is
 * predicted: a player eligible to remain appears only as competition, never as
 * a confirmed return and never as a confirmed departure.
 */
import { GRADE, REASON, scoreable, unscoreable } from '../types.js';
import { typicalStarters, ARRIVAL_CLAIM_WEIGHT, MAX_CLAIM_SHARE } from '../recruitingRules.js';

/**
 * @param {object} p
 * @param {string} p.sport
 * @param {string} p.position
 * @param {object} p.evidence
 * @param {boolean} p.evidence.rosterOnFile      do we hold a roster for this programme at all
 * @param {boolean} p.evidence.eligibilityRuled  does the association have a rule on file
 * @param {number}  p.evidence.positionRows      players at the position. CONTEXT ONLY
 * @param {number}  p.evidence.vacatedStarters   starting places eligibility vacates at the entry year
 * @param {number}  p.evidence.openings          all places eligibility vacates. CONTEXT ONLY
 * @param {number}  p.evidence.eligibleToRemain  players the rules permit to stay
 * @param {number}  p.evidence.unreadable        rows with no readable class
 * @param {number|null} p.evidence.arrivals      newcomers already recruited into the entry class
 * @param {object|null} p.evidence.fill          { rate, hits, trials, level }
 */
export function positionalOpportunity({ sport, position, evidence, weights = {} }) {
  const {
    arrivalClaim = ARRIVAL_CLAIM_WEIGHT,
    maxClaimShare = MAX_CLAIM_SHARE,
  } = weights;

  const places = typicalStarters(sport, position);
  if (places === null) {
    // No measured normaliser for this sport and position. Refusing beats
    // dividing by a number nobody measured - which is the whole reason the
    // goalkeeper question had to be answered before this layer was written.
    return unscoreable({ reason: REASON.NO_PROGRAMME_LEVEL, missing: ['typicalStarters'], available: [] });
  }
  if (!evidence?.rosterOnFile) {
    return unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'], available: [] });
  }
  if (!evidence.eligibilityRuled) {
    // NJCAA and USCAA. We can see the roster and cannot say whose place opens,
    // which is not the same as saying nobody's does.
    return unscoreable({ reason: REASON.NO_ELIGIBILITY_RULE, missing: ['eligibilityRule'], available: ['roster'] });
  }
  if (!evidence.positionRows) {
    return unscoreable({ reason: REASON.NO_CLASS_LABELS, missing: ['positionRows'], available: ['roster'] });
  }
  if (!evidence.fill) {
    return unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['fillPropensity'], available: ['roster'] });
  }

  /**
   * A ZERO MUST REST ON SOMETHING.
   *
   * `vacatedStarters` counts players whose eligibility ends before the entry
   * year AND who were holding a starting place. If nobody in that departing
   * cohort could be placed as starter or squad at all, a count of zero is not
   * a measurement of no opening - it is silence about whoever is leaving. The
   * two were indistinguishable until A7.7.2 measured them: 307 men's and 341
   * women's programme-position cells scored a confident MEASURED zero on a
   * departing cohort nobody could classify.
   *
   * THE DEPARTING COHORT IS THE RIGHT DENOMINATOR, not the whole position. A
   * freshman cannot have prior minutes and never vacates a place, so including
   * newcomers would refuse cells whose actual evidence is complete - across
   * both sports, structurally-unavailable newcomers are 85% of every
   * unclassifiable row.
   *
   * Selected from the data as rule R-b of five tested: MEASURED only when the
   * whole departing cohort is placed, PARTIAL when part of it is, UNSCOREABLE
   * when none of it is. It carries zero false-zero risk, as do the looser
   * candidates; it is chosen over those because it is the one that also tells
   * a partly-evidenced cell apart from a fully-evidenced one.
   */
  const starter = evidence.starterEvidence ?? null;
  const departing = starter?.departing ?? 0;
  const departingUnknown = starter?.departingUnknown ?? 0;
  const departingKnown = departing - departingUnknown;
  if (departing > 0 && departingKnown === 0) {
    return unscoreable({
      reason: REASON.NO_MINUTES_HISTORY,
      missing: ['starterEvidence'],
      available: ['roster', 'classYears', 'eligibilityRule'],
      coverage: 0,
      detail: {
        position,
        departing,
        departingUnknown,
        note: 'nobody in the departing cohort could be placed as starter or squad, so a count of zero vacated starters would be silence rather than a measurement',
      },
    });
  }

  const vacated = Math.max(0, Number(evidence.vacatedStarters) || 0);
  const remain = Math.max(0, Number(evidence.eligibleToRemain) || 0);
  const arrivals = evidence.arrivals === null || evidence.arrivals === undefined
    ? 0 : Math.max(0, Number(evidence.arrivals) || 0);

  // Places likely to become a newcomer's, rather than places that merely
  // emptied. The fill rate is where internal competition is represented.
  const expected = vacated * evidence.fill.rate;

  const rawClaims = arrivalClaim * arrivals;
  // Bounded on purpose. A squad that recruited four midfielders may still take
  // a fifth, and zeroing the opening would assert knowledge of a coach's list
  // that we do not have.
  const claims = Math.min(expected * maxClaimShare, rawClaims);

  const value = Math.min(1, Math.max(0, (expected - claims) / places));

  return scoreable({
    value,
    /**
     * PARTIAL when part of the roster could not be read, or when arrivals
     * APPLY to this entry year and we hold none for the programme - then we
     * are scoring as though nobody has been recruited and cannot know it.
     *
     * An entry year beyond the arrivals horizon is NOT a gap: nobody has
     * recruited that class yet, so there is nothing we failed to observe.
     */
    grade: (evidence.unreadable > 0
      || departingUnknown > 0
      || (evidence.arrivalsApplicable !== false && (evidence.arrivals === null || evidence.arrivals === undefined)))
      ? GRADE.PARTIAL : GRADE.MEASURED,
    coverage: 1,
    basis: {
      position,
      typicalStarters: places,
      vacatedStarters: vacated,
      expectedNewcomerPlaces: expected,
      arrivals: evidence.arrivals ?? null,
      arrivalsKnown: evidence.arrivals !== null && evidence.arrivals !== undefined,
      arrivalsApplicable: evidence.arrivalsApplicable !== false,
      arrivalsHorizon: evidence.arrivalsHorizon ?? null,
      claims,
      claimsCapped: rawClaims > expected * maxClaimShare,
      fillRate: evidence.fill.rate,
      fillLevel: evidence.fill.level,
      fillHits: evidence.fill.hits,
      fillTrials: evidence.fill.trials,
      // Carried so a reader can see them, scored by nothing. Each is
      // contaminated by position-group size, which is why.
      contextOnly: {
        positionRows: evidence.positionRows,
        allOpenings: evidence.openings ?? null,
        // Eligible to remain, NOT expected to return. Carried so a reader can
        // see the depth; scored by nothing, because it is group size at
        // r = 0.928 and the fill rate already prices internal competition.
        eligibleToRemain: remain,
        unreadableRows: evidence.unreadable ?? 0,
      },
      /**
       * Carried so an explanation can say which of the three states this is,
       * and so a reader can see how much of the departing cohort was placed.
       */
      starterEvidence: starter
        ? { departing, departingUnknown, departingKnown, positionClassified: starter.classified, positionRows: starter.positionRows }
        : null,
      weights: { arrivalClaim, maxClaimShare },
    },
  });
}
