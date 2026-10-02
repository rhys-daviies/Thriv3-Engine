/**
 * Build a structured explanation of one programme's standing.
 *
 * READS ONLY. It recomputes nothing: every number comes out of a basis object
 * a scorer already produced, and a test proves running this changes no score,
 * no rank and no ranking state.
 *
 * -- WHY STANDING COMES FIRST ---------------------------------------------
 *
 * The hardest case in this system is not a wrong explanation, it is a true one
 * that misleads. A developmental athlete's eighteenth-ranked programme and a
 * strong athlete's eighteenth-ranked programme carry the same rank and
 * nothing else in common: for the first, two thirds of the pool sits below
 * 0.05 and eighteenth means "one of the least unreachable". So `standing`
 * reports rank, raw priority, pool percentile AND an absolute-strength flag,
 * and rank is never allowed to stand for quality on its own.
 */
import { isScoreable, isNotApplicable, GRADE } from '../types.js';
import { RANKING_STATE } from '../types.js';
import { AID_POLICY_STATUS } from '../aidPolicy.js';
import { ROTATION_OWN_REFUSALS } from '../layers/opportunityComponents.js';
import {
  LAYER, POLARITY, BAND, REASON_CODE, EVIDENCE,
  sampleStrength, bandFor, ABSOLUTE,
} from './vocabulary.js';

const money = (n) => (n === null || n === undefined ? null : Math.round(n));
const r3 = (n) => (Number.isFinite(n) ? Number(n.toFixed(3)) : null);

/**
 * `listLevel` marks a reason that is about the whole shortlist rather than
 * this programme. Repeating "most of this pool is out of reach" on all
 * hundred rows is true and unreadable; a surface should hoist it once.
 */
function reason(code, layer, polarity, band, evidence = {}, { listLevel = false, sub = 0 } = {}) {
  return { code, layer, polarity, band, sub, evidence, listLevel };
}

/* ------------------------------------------------------------------ */
/* Coach Recruitability                                                */
/* ------------------------------------------------------------------ */

function recruitabilityReasons(result) {
  if (!isScoreable(result)) {
    return [reason(REASON_CODE.LAYER_UNSCOREABLE, LAYER.RECRUITABILITY, POLARITY.UNKNOWN,
      BAND.UNKNOWN, { layer: LAYER.RECRUITABILITY, missing: [...result.missing], reason: result.reason, coverage: result.coverage })];
  }
  const b = result.basis;
  const out = [];

  /**
   * Athletic plausibility, described as a RELATIONSHIP and never as a
   * percentage of good-enough. The delta is percentile points of the
   * programme-strength distribution, and it is reported as the band it falls
   * in rather than to three decimals, because three decimals would be false
   * precision on an operator's 1-10 judgement.
   */
  const delta = b.athleticDelta;
  const athleticCode = delta >= 0 ? REASON_CODE.ATHLETIC_AT_OR_ABOVE_LEVEL
    : delta >= -0.10 ? REASON_CODE.ATHLETIC_MODEST_REACH
      : delta >= -0.25 ? REASON_CODE.ATHLETIC_SUBSTANTIAL_REACH
        : REASON_CODE.ATHLETIC_BEYOND_RANGE;
  out.push(reason(athleticCode, LAYER.RECRUITABILITY,
    delta >= 0 ? POLARITY.STRENGTH : POLARITY.CONCERN,
    delta >= -0.10 ? BAND.STRONGEST_POSITIVE : BAND.MAJOR_CONSTRAINT,
    {
      athletePercentile: r3(b.athleticBasis.athletePercentile),
      programmePercentile: r3(b.athleticBasis.programmePercentile),
      levelGap: r3(Math.abs(delta)),
      plausibility: r3(b.athleticPlausibility),
      rating: b.athleticBasis.rating,
    }));

  const p = b.positional;
  /**
   * A7.18. Three positional states, three different things to say. The
   * scorer distinguishes them and so must this: a detected absence is not a
   * certainty, and an unreadable roster is not an absence.
   */
  if (!p && b.positionalEvidence === 'UNKNOWN') {
    out.push(reason(REASON_CODE.POSITION_EVIDENCE_UNAVAILABLE, LAYER.RECRUITABILITY, POLARITY.CONTEXT,
      BAND.SECONDARY_EVIDENCE, {
        position: b.positionalUnreadable?.position ?? null,
        departing: b.positionalUnreadable?.departing ?? null,
        reason: b.signals?.find((x) => x.key === 'positionalOpportunity')?.reason ?? null,
      }));
  }
  if (p) {
    if (p.vacatedStarters > 0) {
      out.push(reason(REASON_CODE.POSITION_OPENING_MEASURED, LAYER.RECRUITABILITY, POLARITY.STRENGTH,
        BAND.STRONGEST_POSITIVE, {
          position: p.position,
          vacatedStarters: p.vacatedStarters,
          typicalStarters: p.typicalStarters,
          eligibleToRemain: p.contextOnly?.eligibleToRemain ?? null,
        }));
      out.push(reason(REASON_CODE.POSITION_FILL_HISTORY, LAYER.RECRUITABILITY, POLARITY.CONTEXT,
        BAND.SECONDARY_EVIDENCE, {
          // The denominator travels with the rate. 1-from-1 must never read
          // like 413-from-815.
          rate: p.fillRate, hits: p.fillHits, trials: p.fillTrials,
          level: p.fillLevel, strength: sampleStrength(p.fillTrials),
        }));
    } else {
      out.push(reason(REASON_CODE.POSITION_NO_OPENING_MEASURED, LAYER.RECRUITABILITY, POLARITY.CONCERN,
        BAND.MAJOR_CONSTRAINT, {
          position: p.position,
          typicalStarters: p.typicalStarters,
          eligibleToRemain: p.contextOnly?.eligibleToRemain ?? null,
          positionRows: p.contextOnly?.positionRows ?? null,
        }));
    }
    /**
     * Emitted whenever the departing cohort is only partly placed, on an
     * opening and on a non-opening alike: the caveat belongs to the coverage,
     * not to the direction of the answer.
     */
    const se = p.starterEvidence;
    if (se && se.departingUnknown > 0) {
      out.push(reason(REASON_CODE.POSITION_EVIDENCE_PARTIAL, LAYER.RECRUITABILITY, POLARITY.UNKNOWN,
        BAND.UNKNOWN, { departing: se.departing, departingUnknown: se.departingUnknown, position: p.position }));
    }
    if (p.arrivalsApplicable === false) {
      out.push(reason(REASON_CODE.POSITION_ARRIVALS_NOT_YET_KNOWN, LAYER.RECRUITABILITY, POLARITY.UNKNOWN,
        BAND.UNKNOWN, { horizon: p.arrivalsHorizon }));
    } else if (p.arrivals > 0) {
      out.push(reason(REASON_CODE.POSITION_ARRIVALS_COMMITTED, LAYER.RECRUITABILITY, POLARITY.CONCERN,
        BAND.SECONDARY_EVIDENCE, { arrivals: p.arrivals, position: p.position, capped: p.claimsCapped }));
    }
  }

  /**
   * Market match. One component, two arms, and the sentence names which -
   * because "recruits locally" and "recruits internationally" are different
   * facts and an operator must not have to guess which one was measured.
   */
  const mk = b.market;
  if (mk && mk.arm === 'INTERNATIONAL') {
    const strong = mk.internationalArrivalShare >= 0.15;
    out.push(reason(strong ? REASON_CODE.MARKET_INTERNATIONAL_HISTORY : REASON_CODE.MARKET_INTERNATIONAL_LITTLE,
      LAYER.RECRUITABILITY, strong ? POLARITY.STRENGTH : POLARITY.CONCERN, BAND.SECONDARY_EVIDENCE, {
        share: r3(mk.rawShare), count: mk.internationalArrivals, total: mk.totalArrivals,
        strength: sampleStrength(mk.totalArrivals),
      }));
  } else if (mk && mk.arm === 'DOMESTIC') {
    const local = mk.footprint === 'LOCAL';
    const code = local
      ? (mk.athleteIsNear ? REASON_CODE.MARKET_FOOTPRINT_LOCAL_NEAR : REASON_CODE.MARKET_FOOTPRINT_LOCAL_FAR)
      : (mk.athleteIsNear ? REASON_CODE.MARKET_FOOTPRINT_BROAD_NEAR : REASON_CODE.MARKET_FOOTPRINT_BROAD_FAR);
    const positive = (local && mk.athleteIsNear) || (!local && !mk.athleteIsNear);
    out.push(reason(code, LAYER.RECRUITABILITY,
      positive ? POLARITY.STRENGTH : (local ? POLARITY.CONCERN : POLARITY.CONTEXT),
      BAND.SECONDARY_EVIDENCE, {
        nearShare: r3(mk.rawNearShare), placed: mk.domesticArrivalsPlaced,
        band: mk.nearBandKm, distance: mk.athleteDistanceKm, footprint: mk.footprint,
      }));
  } else if (b.marketState && b.marketState !== 'NOT_APPLICABLE' && !mk) {
    out.push(reason(REASON_CODE.MARKET_UNKNOWN, LAYER.RECRUITABILITY, POLARITY.UNKNOWN, BAND.UNKNOWN,
      { arrivals: null, minArrivals: null }));
  }

  if (b.international) {
    const i = b.international;
    out.push(reason(i.internationalArrivalShare > 0 ? REASON_CODE.INTERNATIONAL_HISTORY : REASON_CODE.INTERNATIONAL_NO_HISTORY,
      LAYER.RECRUITABILITY, i.internationalArrivalShare > 0 ? POLARITY.STRENGTH : POLARITY.CONCERN,
      BAND.SECONDARY_EVIDENCE, {
        share: r3(i.internationalArrivalShare), count: i.internationalArrivals,
        total: i.totalArrivals, level: i.level, strength: sampleStrength(i.totalArrivals),
      }));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Financial Viability                                                 */
/* ------------------------------------------------------------------ */

function financialReasons(result) {
  if (!isScoreable(result)) {
    return [reason(REASON_CODE.LAYER_UNSCOREABLE, LAYER.FINANCIAL, POLARITY.UNKNOWN,
      BAND.UNKNOWN, { layer: LAYER.FINANCIAL, missing: [...result.missing], reason: result.reason, coverage: result.coverage })];
  }
  const b = result.basis;
  const out = [];
  const [gapLo, gapHi] = b.fundingGapRange;
  /**
   * An exact stated maximum is ONE number, so it is said as one. A band is
   * still a range and is still said as a range - reporting "$20,000 to
   * $25,000" as a single figure would invent the precision the band withheld.
   */
  const stated = Number.isFinite(b.statedMaximumUsd) ? money(b.statedMaximumUsd) : null;
  const budget = b.familyContributionRange ? b.familyContributionRange.map(money) : null;

  if (b.costNotAConstraint) {
    /**
     * The cost still travels. "Not a constraint" is a fact about the family,
     * and saying it must never read as a claim that the programme is cheap.
     */
    out.push(reason(REASON_CODE.COST_NOT_A_CONSTRAINT, LAYER.FINANCIAL, POLARITY.STRENGTH, BAND.STRONGEST_POSITIVE, {
      cost: b.applicableCostRange.map(money), costBasis: b.costBasis,
    }));
  } else if (gapHi <= 0) {
    out.push(reason(REASON_CODE.COST_WITHIN_BUDGET, LAYER.FINANCIAL, POLARITY.STRENGTH, BAND.STRONGEST_POSITIVE, {
      cost: b.applicableCostRange.map(money), budget, stated, costBasis: b.costBasis,
    }));
  } else {
    out.push(reason(REASON_CODE.FUNDING_GAP, LAYER.FINANCIAL, POLARITY.CONCERN, BAND.MAJOR_CONSTRAINT, {
      // A RANGE, because the family stated a band and residency may be
      // unknown. Collapsing it to a point would invent precision.
      gap: [money(gapLo), money(gapHi)],
      cost: b.applicableCostRange.map(money),
      budget,
      stated,
      costBasis: b.costBasis,
      budgetCeilingUnstated: b.budgetCeilingUnstated,
    }));
  }

  /**
   * Said out loud, because a band is weaker evidence than the question we now
   * ask and the reader is entitled to know which one produced the number.
   */
  if (b.budgetRange && b.contributionSource === 'LEGACY_BAND') {
    out.push(reason(REASON_CODE.CONTRIBUTION_FROM_LEGACY_BAND, LAYER.FINANCIAL, POLARITY.UNKNOWN, BAND.UNKNOWN,
      // The open band states no ceiling, so it is scored at the floor the
      // family DID state. Saying so is the difference between a conservative
      // number and a number that looks like a confirmed maximum.
      { band: b.budgetRange, unbounded: b.budgetCeilingUnstated }));
  }

  if (b.costBasis === 'NET_PRICE_PUBLIC_IN_STATE') {
    out.push(reason(REASON_CODE.RESIDENCY_IN_STATE, LAYER.FINANCIAL, POLARITY.STRENGTH, BAND.SECONDARY_EVIDENCE, {}));
  } else if (b.costBasis === 'NET_PRICE_PUBLIC_OUT_OF_STATE') {
    out.push(reason(REASON_CODE.RESIDENCY_OUT_OF_STATE, LAYER.FINANCIAL, POLARITY.CONCERN, BAND.SECONDARY_EVIDENCE,
      { premium: money(b.outOfStatePremium), international: b.isInternational }));
  } else if (b.costBasis === 'NET_PRICE_PUBLIC_RESIDENCY_UNKNOWN') {
    out.push(reason(REASON_CODE.RESIDENCY_UNKNOWN, LAYER.FINANCIAL, POLARITY.UNKNOWN, BAND.UNKNOWN,
      { cost: b.applicableCostRange.map(money) }));
  }

  /**
   * THE THREE AID STATES, which must never collapse into each other. All three
   * subtract the same nothing and only one may be said out loud.
   */
  if (b.mayClaimNoAthleticAid) {
    out.push(reason(REASON_CODE.AID_KNOWN_NONE, LAYER.FINANCIAL, POLARITY.CONTEXT, BAND.SECONDARY_EVIDENCE,
      { rule: b.aidRule }));
  } else if (b.aidPolicy === AID_POLICY_STATUS.UNKNOWN) {
    out.push(reason(REASON_CODE.AID_POLICY_UNKNOWN, LAYER.FINANCIAL, POLARITY.UNKNOWN, BAND.UNKNOWN, {}));
  } else {
    out.push(reason(REASON_CODE.AID_PERMITTED_AMOUNT_UNKNOWN, LAYER.FINANCIAL, POLARITY.UNKNOWN, BAND.UNKNOWN,
      { rule: b.aidRule, headroomFraction: b.aidHeadroomFraction }));
  }

  if (b.internationalCostCaveat) {
    out.push(reason(REASON_CODE.INTERNATIONAL_COST_UNDERSTATED, LAYER.FINANCIAL, POLARITY.UNKNOWN, BAND.UNKNOWN, {}));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Athlete Opportunity / Fit                                           */
/* ------------------------------------------------------------------ */

function opportunityReasons(result) {
  if (!isScoreable(result)) {
    const out = [reason(REASON_CODE.LAYER_UNSCOREABLE, LAYER.OPPORTUNITY, POLARITY.UNKNOWN,
      BAND.UNKNOWN, { layer: LAYER.OPPORTUNITY, missing: [...result.missing], reason: result.reason, coverage: result.coverage })];
    /**
     * A7.45B. The generic layer sentence names the missing component and the
     * reason, which for this state reads as a data gap somebody should go and
     * fill. True, and not the thing an athlete needs to be told: that Thriv3
     * is DECLINING to rank on evidence it holds, rather than scoring the
     * programme down. Said as its own sentence.
     */
    if (result.detail?.requiredMissing === 'playingPathway') {
      /**
       * A7.48 D3. WHICH sentence depends on whether rotation survived, and the
       * layer refusal is the only thing available to decide it - `combine`
       * carries the required component's reason but not its detail.
       *
       * The reason is a sufficient discriminator, and that is a property
       * rather than a guess: `playingPathway` refuses by two routes, one
       * inheriting rotation's reason and one - which fires only when rotation
       * IS scoreable - inheriting competition's, and the two reason sets are
       * disjoint. See `ROTATION_OWN_REFUSALS`, where the argument is written
       * out, and `pathwayRefusal.test.js`, which pins both directions.
       */
      const nothingKnown = ROTATION_OWN_REFUSALS.includes(result.reason);
      out.push(reason(
        nothingKnown ? REASON_CODE.PATHWAY_NOT_RANKED_NOTHING_KNOWN : REASON_CODE.PATHWAY_NOT_RANKED_ROTATION_KNOWN,
        LAYER.OPPORTUNITY, POLARITY.UNKNOWN, BAND.SECONDARY_EVIDENCE, { reason: result.reason },
      ));
    }
    return out;
  }
  const b = result.basis;
  const out = [];

  /**
   * PLAYING PATHWAY, described as its two halves rather than as one number.
   * Projected competition is a fact about the entry year; rotation is a fact
   * about past seasons. An athlete reading this should be able to check both.
   */
  const comp = b.pathway?.competition ?? null;
  if (comp) {
    const roleKnown = comp.returning - comp.returningUnknownRole;
    const code = comp.returning === 0 ? REASON_CODE.RETURNING_NONE_PROJECTED
      : comp.returningUnknownRole > 0 ? REASON_CODE.RETURNING_COMPETITION_PARTIAL
        : REASON_CODE.RETURNING_COMPETITION_MEASURED;
    out.push(reason(code, LAYER.OPPORTUNITY,
      comp.pressure >= 1 ? POLARITY.CONCERN : POLARITY.STRENGTH, BAND.SECONDARY_EVIDENCE, {
        position: comp.position, returning: comp.returning,
        returningStarters: comp.returningStarters, roleKnown,
        typicalStarters: comp.typicalStarters,
        /** A7.37. So a zero can say how much of the group it actually rests on. */
        positionRows: comp.positionRows ?? null,
        unreadable: comp.unreadableHorizon ?? 0,
      }));
    /**
     * A7.44. The count above still stands - it is a real observation of real
     * players - and it may be an undercount, because this programme lists
     * people it does not place anywhere. Said as its own sentence rather than
     * folded into the one above, so the FACT and the DOUBT stay separable.
     */
    const unplaceable = (comp.positionUnreadable ?? 0) + (comp.positionMissing ?? 0);
    if (unplaceable > 0) {
      out.push(reason(REASON_CODE.POSITION_EVIDENCE_PARTIAL, LAYER.OPPORTUNITY,
        POLARITY.UNKNOWN, BAND.SECONDARY_EVIDENCE, {
          position: comp.position,
          unplaceable,
          placed: comp.positionRows ?? null,
          rosterRows: comp.programmeRows ?? null,
          positionReadableShare: comp.positionReadableShare ?? null,
        }));
    }
  } else if (b.pathway?.rotationOnly) {
    /**
     * A7.37. THE SILENCE THAT USED TO BE HERE WAS THE PROBLEM. When the
     * entry-year half refused, nothing was emitted and the rotation sentence
     * below stood alone, reading like a complete answer. Now the refusal says
     * which thing is unknown, and the pathway says it is resting on one half.
     */
    const d = b.pathway.competitionRefusalDetail ?? {};
    /**
     * A7.44 LEADS THE DISPATCH, and that ordering is load-bearing. The
     * positional refusal detail also carries `positionRows`, so leaving it to
     * fall through would render RETURNING_HORIZON_UNREADABLE - blaming the
     * class years of a roster whose class years may be perfect, which is the
     * same species of false sentence this phase exists to remove.
     */
    if (d.positionUnreadable !== undefined || d.positionMissing !== undefined) {
      out.push(reason(REASON_CODE.POSITION_EVIDENCE_INSUFFICIENT, LAYER.OPPORTUNITY,
        POLARITY.UNKNOWN, BAND.SECONDARY_EVIDENCE, {
          position: d.position,
          unplaceable: (d.positionUnreadable ?? 0) + (d.positionMissing ?? 0),
          placed: d.positionRows ?? 0,
          rosterRows: d.programmeRows ?? null,
          positionReadableShare: d.positionReadableShare ?? null,
        }));
    } else if (d.maxLastSeason !== undefined && d.maxLastSeason !== null) {
      out.push(reason(REASON_CODE.RETURNING_BEYOND_ROSTER_REACH, LAYER.OPPORTUNITY,
        POLARITY.UNKNOWN, BAND.SECONDARY_EVIDENCE,
        { position: d.position, entryYear: d.entryYear, maxLastSeason: d.maxLastSeason }));
    } else if (d.positionRows) {
      out.push(reason(REASON_CODE.RETURNING_HORIZON_UNREADABLE, LAYER.OPPORTUNITY,
        POLARITY.UNKNOWN, BAND.SECONDARY_EVIDENCE,
        { position: d.position, positionRows: d.positionRows, unreadable: d.unreadable ?? 0 }));
    }
    out.push(reason(REASON_CODE.PATHWAY_ROTATION_ONLY, LAYER.OPPORTUNITY,
      POLARITY.CONTEXT, BAND.SECONDARY_EVIDENCE, {}));
  }
  const rot = b.pathway?.rotation ?? null;
  if (rot) {
    const wide = rot.playingShare >= rot.scaleMedian;
    out.push(reason(wide ? REASON_CODE.PLAYING_SHARE_WIDE : REASON_CODE.PLAYING_SHARE_NARROW,
      LAYER.OPPORTUNITY, wide ? POLARITY.STRENGTH : POLARITY.CONCERN, BAND.SECONDARY_EVIDENCE, {
        share: rot.playingShare, median: rot.scaleMedian,
        level: rot.level, seasons: rot.seasons,
        strength: sampleStrength(rot.seasons),
      }));
  }
  if (b.trajectory && b.trajectory.direction !== 'steady') {
    const up = b.trajectory.direction === 'improving';
    out.push(reason(up ? REASON_CODE.TRAJECTORY_IMPROVING : REASON_CODE.TRAJECTORY_DECLINING,
      LAYER.OPPORTUNITY, up ? POLARITY.STRENGTH : POLARITY.CONCERN, BAND.SECONDARY_EVIDENCE,
      { change: r3(b.trajectory.change), recent: r3(b.trajectory.recentWinPct), prior: r3(b.trajectory.priorWinPct) }));
  }
  if (b.major) {
    out.push(reason(b.major.matched ? REASON_CODE.MAJOR_OFFERED : REASON_CODE.MAJOR_NOT_OFFERED,
      LAYER.OPPORTUNITY, b.major.matched ? POLARITY.STRENGTH : POLARITY.CONCERN, BAND.PREFERENCE_EFFECT,
      { intendedMajor: b.major.intendedMajor, family: b.major.majorFamily }));
  }

  /**
   * PREFERENCES ARE ONLY MENTIONED WHEN DECLARED.
   *
   * An athlete nobody asked gets no sentence about ambition at all, and one
   * who said level is NOT important is never described as preferring weaker
   * programmes - they said it does not matter, which is a different statement
   * and produces a flat component that reorders nothing.
   */
  const amb = b.ambition ?? {};
  if (amb.competitiveLevelPriority !== null && amb.competitiveLevelPriority !== undefined && b.outcome) {
    if (amb.competitiveLevelPriority >= 3) {
      const met = b.outcome.atOrAboveOwnLevel;
      out.push(reason(met ? REASON_CODE.LEVEL_PREFERENCE_MET : REASON_CODE.LEVEL_PREFERENCE_BELOW,
        LAYER.OPPORTUNITY, met ? POLARITY.STRENGTH : POLARITY.CONCERN, BAND.PREFERENCE_EFFECT, {
          priority: amb.competitiveLevelPriority,
          levelGapBelow: r3(b.outcome.levelGapBelow),
          programmePercentile: r3(b.outcome.programmePercentile),
          athletePercentile: r3(b.outcome.athletePercentile),
        }));
    }
    // priority 1 or 2 produces NO level sentence: the component is flat and
    // saying anything would describe a preference they did not express.
  }
  if (amb.playingOpportunityPriority !== null && amb.playingOpportunityPriority !== undefined
      && amb.playingOpportunityPriority >= 4 && b.pathway) {
    out.push(reason(REASON_CODE.PLAYING_PREFERENCE_WEIGHTED, LAYER.OPPORTUNITY, POLARITY.CONTEXT,
      BAND.PREFERENCE_EFFECT, { priority: amb.playingOpportunityPriority, share: b.pathway.rotation?.playingShare ?? null }));
  }
  /**
   * ACADEMIC STRENGTH IS ONLY EVER MENTIONED WHEN DECLARED. An athlete nobody
   * asked gets no sentence, and their grades are never read as an answer.
   */
  const ac = b.academic;
  if (amb.academicStrengthPriority !== null && amb.academicStrengthPriority !== undefined) {
    if (ac) {
      if (amb.academicStrengthPriority >= 4) {
        const high = ac.academicPercentile >= 0.6;
        out.push(reason(high ? REASON_CODE.ACADEMIC_PREFERENCE_STRONG : REASON_CODE.ACADEMIC_PREFERENCE_WEAK_MATCH,
          LAYER.OPPORTUNITY, high ? POLARITY.STRENGTH : POLARITY.CONCERN, BAND.PREFERENCE_EFFECT,
          { percentile: r3(ac.academicPercentile), priority: amb.academicStrengthPriority }));
      } else {
        out.push(reason(REASON_CODE.ACADEMIC_PREFERENCE_MINOR, LAYER.OPPORTUNITY, POLARITY.CONTEXT,
          BAND.PREFERENCE_EFFECT, { priority: amb.academicStrengthPriority }));
      }
    } else if ((b.missing ?? []).includes('academicStrengthFit')) {
      out.push(reason(REASON_CODE.ACADEMIC_STRENGTH_UNKNOWN, LAYER.OPPORTUNITY, POLARITY.UNKNOWN, BAND.UNKNOWN, {}));
    }
  }

  if ((b.notApplicable ?? []).includes('locationFit')) {
    out.push(reason(REASON_CODE.LOCATION_NOT_COLLECTED, LAYER.OPPORTUNITY, POLARITY.UNKNOWN, BAND.UNKNOWN, {}));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

/**
 * A gate DEMOTES. It never excludes, and the wording must never suggest it
 * does - a gated programme is still RANKED and still on the list.
 *
 * Both the exact loss and a qualitative severity are exposed, and the caller
 * decides which to show. The recommendation is severity in the sentence and
 * the exact figure on demand: "materially lowers" is what an operator acts on,
 * and 0.1437 is what they check.
 */
function gateEffects(pursuit) {
  if (!isScoreable(pursuit)) return [];
  const b = pursuit.basis;
  const out = [];
  const severity = (loss, base) => {
    const share = base > 0 ? loss / base : 0;
    return share >= 0.5 ? 'SEVERE' : share >= 0.2 ? 'MATERIAL' : share > 0 ? 'SLIGHT' : 'NONE';
  };
  if (b.recruitabilityGateFired) {
    out.push({
      code: REASON_CODE.GATE_RECRUITABILITY, layer: LAYER.RECRUITABILITY,
      base: r3(b.base), multiplier: r3(b.recruitabilityGate), loss: r3(b.recruitabilityGateLoss),
      lossShare: r3(b.recruitabilityGateLoss / b.base), severity: severity(b.recruitabilityGateLoss, b.base),
      excluded: false,
    });
  }
  if (b.financialGateFired) {
    const preFinancial = b.base * b.recruitabilityGate;
    out.push({
      code: REASON_CODE.GATE_FINANCIAL, layer: LAYER.FINANCIAL,
      base: r3(preFinancial), multiplier: r3(b.financialGate), loss: r3(b.financialGateLoss),
      lossShare: r3(preFinancial > 0 ? b.financialGateLoss / preFinancial : 0),
      severity: severity(b.financialGateLoss, preFinancial),
      excluded: false,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Next checks                                                         */
/* ------------------------------------------------------------------ */

/** Only where a real evidence gap exists. Never generic advice. */
function nextChecks(entry, reasons) {
  const codes = new Set(reasons.map((r) => r.code));
  const out = [];
  const add = (code, layer, detail = {}) => out.push({ code, layer, ...detail });

  if (codes.has(REASON_CODE.AID_POLICY_UNKNOWN)) add('VERIFY_AID_POLICY', LAYER.FINANCIAL);
  if (codes.has(REASON_CODE.AID_PERMITTED_AMOUNT_UNKNOWN)) add('ASK_COACH_AID_AVAILABILITY', LAYER.FINANCIAL);
  if (codes.has(REASON_CODE.RESIDENCY_UNKNOWN)) add('CONFIRM_ATHLETE_HOME_STATE', LAYER.FINANCIAL);
  if (codes.has(REASON_CODE.INTERNATIONAL_COST_UNDERSTATED)) add('CONFIRM_INTERNATIONAL_COST', LAYER.FINANCIAL);
  if (codes.has(REASON_CODE.POSITION_ARRIVALS_NOT_YET_KNOWN)) add('CHECK_COMMITTED_RECRUITS', LAYER.RECRUITABILITY);
  if (codes.has(REASON_CODE.POSITION_OPENING_MEASURED)) add('VERIFY_DEPARTURES_AT_POSITION', LAYER.RECRUITABILITY);
  if (codes.has(REASON_CODE.LOCATION_NOT_COLLECTED)) add('COLLECT_LOCATION_PREFERENCE', LAYER.OPPORTUNITY);

  const r = entry.recruitability;
  if (isScoreable(r) && r.grade === GRADE.PARTIAL) add('VERIFY_ROSTER_CLASS_YEARS', LAYER.RECRUITABILITY);
  if (entry.rankingState === RANKING_STATE.LIMITED_DATA) {
    for (const layer of entry.missingLayers ?? []) {
      if (layer === 'recruitability') add('OBTAIN_ROSTER_AND_ELIGIBILITY', LAYER.RECRUITABILITY);
      if (layer === 'opportunity') add('OBTAIN_MINUTES_HISTORY', LAYER.OPPORTUNITY);
      if (layer === 'financial') add('OBTAIN_COST_DATA', LAYER.FINANCIAL);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {object} entry  a pipeline entry (ranked, limited, ineligible or suppressed)
 * @param {object} context { rank, outOf, poolMedianPriority, poolSize }
 */
export function explainProgramme(entry, context = {}) {
  const base = {
    subject: {
      id: entry.id, name: entry.name, division: entry.division,
      rankingState: entry.rankingState,
    },
  };

  if (entry.rankingState === RANKING_STATE.SUPPRESSED) {
    return {
      ...base,
      standing: null,
      reasons: [reason(REASON_CODE.SUPPRESSED_BY_OPERATOR, LAYER.PIPELINE, POLARITY.CONTEXT, BAND.ABSOLUTE_CONTEXT, {})],
      layerReasons: { recruitability: [], financial: [], opportunity: [] },
      gateEffects: [], evidenceQuality: [], nextChecks: [],
    };
  }
  if (entry.rankingState === RANKING_STATE.INELIGIBLE) {
    return {
      ...base,
      standing: null,
      reasons: [reason(REASON_CODE.INELIGIBLE_RULE, LAYER.PIPELINE, POLARITY.CONTEXT, BAND.ABSOLUTE_CONTEXT,
        { rule: entry.ineligibleReason ?? null })],
      layerReasons: { recruitability: [], financial: [], opportunity: [] },
      gateEffects: [], evidenceQuality: [], nextChecks: [],
    };
  }

  const layerReasons = {
    recruitability: recruitabilityReasons(entry.recruitability),
    financial: financialReasons(entry.financial),
    opportunity: opportunityReasons(entry.opportunity),
  };
  const all = [...layerReasons.recruitability, ...layerReasons.financial, ...layerReasons.opportunity];

  if (entry.rankingState === RANKING_STATE.LIMITED_DATA) {
    const available = ['recruitability', 'financial', 'opportunity']
      .filter((k) => isScoreable(entry[k]));
    all.unshift(reason(REASON_CODE.LIMITED_DATA_MISSING_LAYERS, LAYER.PIPELINE, POLARITY.UNKNOWN,
      BAND.ABSOLUTE_CONTEXT, {
        missing: [...(entry.missingLayers ?? [])],
        layerReasons: entry.layerReasons ?? null,
        available,
        layersKnown: entry.order?.layersKnown ?? null,
      }));
    return {
      ...base,
      // NEVER a standing. A limited-data programme has no priority and no
      // rank, and giving it either would place it beside the ranked list.
      standing: null,
      reasons: sortReasons(all),
      layerReasons,
      gateEffects: [],
      evidenceQuality: evidenceQuality(entry),
      nextChecks: nextChecks(entry, all),
    };
  }

  // RANKED
  const priority = entry.pursuitPriority.value;
  const { rank = null, outOf = null, poolMedianPriority = null, poolSize = null } = context;
  const standing = {
    rank, outOf, poolSize,
    priority: r3(priority),
    priorityOutOf100: Math.round(priority * 100),
    poolMedianPriority: r3(poolMedianPriority),
    /**
     * The fixture-C guard. A rank is a position among this athlete's own
     * options and says nothing about whether any of them are worth having.
     */
    absoluteStrength: priority < ABSOLUTE.LOW ? 'LOW' : priority < ABSOLUTE.MODEST ? 'MODEST' : 'ADEQUATE',
    poolMostlyOutOfReach: Number.isFinite(poolMedianPriority) && poolMedianPriority < ABSOLUTE.POOL_LOW_MEDIAN,
    rankAloneIsMisleading: priority < ABSOLUTE.MODEST,
  };

  if (standing.poolMostlyOutOfReach) {
    all.unshift(reason(REASON_CODE.POOL_MOSTLY_OUT_OF_REACH, LAYER.PURSUIT, POLARITY.CONTEXT,
      BAND.ABSOLUTE_CONTEXT, { poolMedianPriority: r3(poolMedianPriority), poolSize },
      // Leads its band: what is true of the whole shortlist frames what is
      // true of one row, and alphabetical order would have buried it.
      { listLevel: true, sub: -1 }));
  }
  if (standing.absoluteStrength !== 'ADEQUATE') {
    all.unshift(reason(
      standing.absoluteStrength === 'LOW' ? REASON_CODE.ABSOLUTE_PRIORITY_LOW : REASON_CODE.ABSOLUTE_PRIORITY_MODEST,
      LAYER.PURSUIT, POLARITY.CONTEXT, BAND.ABSOLUTE_CONTEXT, { priority: r3(priority), rank }));
  }

  const b = entry.pursuitPriority.basis;

  /**
   * A7.18. The level anchor, stated whenever it moved anything. `alignment`
   * is 1 at the athlete's own estimated level and falls away either side, so
   * the three cases below are ALIGNED, BELOW and REACH - and the athlete's
   * own stated importance is carried with them, because a programme far from
   * the athlete's level costs very little at priority 1 and a great deal at
   * priority 5.
   */
  const la = b.levelAnchor;
  /**
   * A7.20 E1. The guard is on the DISPLAYED number, not the raw one. Rendering
   * rounds the factor to three places, so a programme 0.4 percentile points
   * from the athlete was being told its priority was "reduced by a factor of
   * 1" - true to fifteen decimals and nonsense on the page. 19 programmes
   * inside a top hundred read that way before this.
   */
  const anchorShown = la?.applied ? r3(la.factor) : null;
  if (anchorShown !== null && anchorShown < 1) {
    /**
     * A7.20 E2. The anchor no longer leads. It carried ABSOLUTE_CONTEXT,
     * which sorts above everything, so a consultant reading Cal State LA at
     * rank 24 for an $8,000 family met a level penalty before the $3,967 net
     * price that actually put it there.
     *
     * PREFERENCE_EFFECT is what it is. The anchor is the athlete's own stated
     * importance applied to a gap - the same kind of statement as
     * LEVEL_PREFERENCE_BELOW, which already sits in that band - and it is a
     * MULTIPLIER on a priority the layers earned, so it can never be the
     * reason a programme ranks where it does. It can only be the reason it
     * does not rank higher, and that is a second sentence rather than a first.
     *
     * A conditional band was tried first, promoting the anchor to
     * MAJOR_CONSTRAINT once it cost a fifth of the gated priority. It is not
     * kept: Cal State LA costs 0.217 and would still have led, and the
     * arithmetic ceiling on the loss is tau, so any threshold high enough to
     * be meaningful is one the anchor can never reach. Nothing about the
     * score changes here - only where the sentence sits.
     */
    all.push(reason(REASON_CODE.LEVEL_ANCHOR_APPLIED, LAYER.PURSUIT, POLARITY.CONCERN,
      BAND.PREFERENCE_EFFECT, {
        alignment: r3(la.alignment),
        factor: anchorShown,
        loss: r3(b.levelAnchorLoss),
        lossShare: r3(b.gatedValue > 0 ? b.levelAnchorLoss / b.gatedValue : 0),
        // NEGATIVE delta means the programme is ABOVE the athlete: a reach.
        direction: la.athleticDelta < 0 ? 'REACH' : 'BELOW',
        levelGap: r3(Math.abs(la.athleticDelta)),
        competitiveLevelPriority: la.competitiveLevelPriority,
        priorityDefaulted: la.priorityDefaulted,
      }));
  }

  const layers = [
    ['recruitability', b.recruitability], ['financial', b.financial], ['opportunity', b.opportunity],
  ].map(([k, v]) => ({ layer: k, value: r3(v), band: bandFor(k, v) }));
  const sorted = [...layers].sort((x, y) => y.value - x.value);

  return {
    ...base,
    standing,
    layerSummary: {
      layers,
      strongest: sorted[0].layer,
      weakest: sorted[sorted.length - 1].layer,
      weights: { ...b.weights },
    },
    reasons: sortReasons(all),
    layerReasons,
    gateEffects: gateEffects(entry.pursuitPriority),
    evidenceQuality: evidenceQuality(entry),
    nextChecks: nextChecks(entry, all),
  };
}

function evidenceQuality(entry) {
  return ['recruitability', 'financial', 'opportunity'].map((layer) => {
    const r = entry[layer];
    if (!isScoreable(r)) return { layer, quality: EVIDENCE.UNSCOREABLE, coverage: r.coverage, reason: r.reason };
    return { layer, quality: r.grade === GRADE.MEASURED ? EVIDENCE.MEASURED : EVIDENCE.PARTIAL, coverage: r.coverage };
  });
}

/**
 * Deterministic ordering.
 *
 * Band, then an explicit sub-rank within the band, then polarity, then code.
 * NEVER by score, so a one-point move cannot reshuffle the sentences an
 * operator reads - which is the whole reason the sort keys are all discrete.
 */
const POLARITY_ORDER = { [POLARITY.CONTEXT]: 0, [POLARITY.CONCERN]: 1, [POLARITY.STRENGTH]: 2, [POLARITY.UNKNOWN]: 3 };
function sortReasons(reasons) {
  return [...reasons].sort((a, b) =>
    a.band - b.band
    || (a.sub ?? 0) - (b.sub ?? 0)
    || POLARITY_ORDER[a.polarity] - POLARITY_ORDER[b.polarity]
    || String(a.code).localeCompare(String(b.code))
    || String(a.layer).localeCompare(String(b.layer)));
}

export const strengths = (e) => e.reasons.filter((r) => r.polarity === POLARITY.STRENGTH);
export const concerns = (e) => e.reasons.filter((r) => r.polarity === POLARITY.CONCERN);
export const unknowns = (e) => e.reasons.filter((r) => r.polarity === POLARITY.UNKNOWN);
