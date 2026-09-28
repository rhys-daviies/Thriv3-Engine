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
import {
  POSITION_READABLE_SHARE_FLOOR, positionReadableShare, positionEvidenceState,
} from '../positionReadability.js';

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
 * @param {number}  p.evidence.programmePositionUnreadable  rows AT THE PROGRAMME placed at no position
 * @param {number}  p.evidence.programmePositionMissing     rows AT THE PROGRAMME carrying no position at all
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
  /**
   * A7.44. The programme-level positional doubt that this layer has been
   * blind to since it was written. It reads the SAME index `returningCompetition`
   * reads, from the departing side, and had the same hole: rows that reached
   * no bucket were counted at the programme and told to nobody.
   *
   * NOT ADDABLE TO `evidence.unreadable`. That counts players placed at this
   * position whose class could not be read; these are players placed nowhere.
   */
  const unplaceableUnreadable = Math.max(0, Number(evidence.programmePositionUnreadable) || 0);
  const unplaceableMissing = Math.max(0, Number(evidence.programmePositionMissing) || 0);
  const unplaceable = unplaceableUnreadable + unplaceableMissing;

  if (!evidence.positionRows) {
    /**
     * A7.44. An empty group at a programme carrying unplaceable players is
     * what we could not read, not what the programme does not have - and
     * blaming the class labels of a roster whose class labels may be perfect
     * sends a reader to the wrong column.
     */
    if (unplaceable > 0) {
      return unscoreable({
        reason: REASON.NO_READABLE_POSITIONS,
        missing: ['readablePositions'],
        available: ['roster'],
        coverage: 0,
        detail: {
          position,
          positionUnreadable: unplaceableUnreadable,
          positionMissing: unplaceableMissing,
          note: 'nobody at this programme could be placed at this position, and it carries players whose '
            + 'position could not be read at all, so the empty group is a gap in what we read',
        },
      });
    }
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

  /**
   * A7.44. A ZERO MUST REST ON SOMETHING - ON THE POSITIONAL AXIS TOO.
   *
   * The guard above this one asks whether the DEPARTING cohort could be
   * placed as starter or squad. This asks the prior question: whether the
   * group we are reading is most of the group at all. `vacatedStarters = 0`
   * taken from four readable players at a programme carrying twenty-three
   * unplaceable ones is not a measurement that no starting place opens.
   *
   * It runs after the A7.7.2 guard so a cell already refusing for a starter-
   * evidence reason keeps that reason, which is the one naming the data to fix.
   */
  const positionShare = positionReadableShare({ placed: evidence.positionRows, unplaceable });
  if (positionShare < POSITION_READABLE_SHARE_FLOOR) {
    return unscoreable({
      reason: REASON.NO_READABLE_POSITIONS,
      missing: ['readablePositions'],
      available: ['roster', 'classYears', 'eligibilityRule'],
      coverage: positionShare,
      detail: {
        position,
        positionRows: evidence.positionRows,
        positionUnreadable: unplaceableUnreadable,
        positionMissing: unplaceableMissing,
        positionReadableShare: positionShare,
        note: 'the players we could place at this position are a minority of those who could belong to '
          + 'it, so a count of the places opening here could be overturned by the players we could not read',
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
      /** A7.44. A group we could only partly assemble is an estimate, not a measurement. */
      || unplaceable > 0
      || (evidence.arrivalsApplicable !== false && (evidence.arrivals === null || evidence.arrivals === undefined)))
      ? GRADE.PARTIAL : GRADE.MEASURED,
    /**
     * A7.44. Was a hard-coded 1, which asserted that this layer always sees
     * the whole position. It does not when the programme carries players it
     * could not place. Coverage moves; the value above does not, because
     * `coverage.js` rule 1 forbids combining them - and because `combine`
     * derives a LAYER's coverage from component weights rather than from this
     * number, so lowering it reports the doubt without silently refusing
     * Coach Recruitability through a floor it never crossed.
     */
    coverage: positionShare,
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
        /** A7.44. Programme-level, and deliberately NOT summed with the line above. */
        programmePositionUnreadable: unplaceableUnreadable,
        programmePositionMissing: unplaceableMissing,
        positionReadableShare: positionShare,
        positionEvidence: positionEvidenceState(positionShare),
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
