/**
 * The components of Athlete Opportunity / Fit, in two families.
 *
 * -- THE SPLIT THAT MAKES THE GENERIC-ATHLETE TRAP IMPOSSIBLE ---------------
 *
 * OBJECTIVE VALUE is what is true about the opportunity whether or not the
 * athlete has told us anything: how widely this programme shares the minutes
 * at their position, and which way the programme is going.
 *
 * PREFERENCE FIT is scored only where the athlete has DECLARED something.
 * Where they have not, the component is NOT_APPLICABLE - it leaves the
 * coverage denominator and nothing is assumed. The system never decides on an
 * athlete's behalf that close to home is good, that prestige is good, or that
 * a particular division is better.
 *
 * Playing opportunity sits on the objective side, and that is a judgement
 * worth stating: an athlete recruiting for a place to play is, by the act of
 * recruiting, seeking somewhere to play. What we do NOT know is how much they
 * would trade playing time for a stronger programme - and that is exactly the
 * preference `athleticOutcome` would need and does not have.
 */
import { GRADE, REASON, scoreable, unscoreable, notApplicable, isScoreable } from '../types.js';
import {
  playingShareFor, playingScale, TRAJECTORY_SATURATION, COMPETITIVE_LEVEL_SPAN,
  RETURNING_SQUAD_WEIGHT, RETURNING_UNKNOWN_WEIGHT, COMPETITION_HALF_PRESSURE, COMPETITION_SHARE,
} from '../opportunityRules.js';
import { priorityStrength } from '../athletePreferences.js';
import { majorLabelFor, academicIntentState, ACADEMIC_INTENT } from '../../../academicMajors.js';

/**
 * Was this number actually given to us?
 *
 * `Number(null)` is 0 and `Number('')` is 0, and 0 is finite - so a bare
 * Number.isFinite test reads an ABSENT figure as a stated zero. It bit twice
 * in this file within an hour: a missing maximum distance became "will travel
 * at most zero miles" and scored every programme a perfect 1, and a missing
 * prior win rate became a prior of zero, turning any record at all into a
 * spectacular improvement. Every optional number here is read through this.
 */
const stated = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/**
 * SQUAD ROTATION: how widely this programme has historically shared the
 * minutes at this position.
 *
 * The programme's measured share, placed on the p10-to-p90 range of programmes
 * at the same position in the same sport. A programme at the tenth percentile
 * of sharing scores 0, one at the ninetieth scores 1.
 *
 * A PROGRAMME TRAIT, AND ONLY THAT. It is computed from seasons that ended
 * before this athlete was recruited, it is identical for every athlete, and it
 * knows nothing about who will be on the roster when they arrive. That is why
 * it is half of Playing Pathway and not the whole of it: A7.8 found Saint
 * Mary's, with nine midfielders projected to remain and one leaving, scoring
 * ABOVE a programme with seven, because it had rotated widely three years
 * earlier. `returningCompetition` answers the other half.
 *
 * GOALKEEPERS NEED NO SPECIAL CASE, and that was measured rather than assumed.
 * The distinctive goalkeeping structure - one player taking 86% of the minutes
 * - is already IN the measure: the median goalkeeping share is 0.40 against
 * 0.56-0.65 outfield, so goalkeepers come out lower on the same scale without
 * a rule being written for them. The candidate that WOULD have needed a
 * goalkeeper rule, newcomer minutes share, was rejected for being unstable
 * (split-half r = 0.002 at goalkeeper).
 */
export function squadRotation({ sport, position, division, programme, rosterOnFile }) {
  if (!rosterOnFile) {
    return unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['minutesHistory'], available: [] });
  }
  const norm = playingShareFor({ sport, division, position, programme });
  const scale = playingScale(sport, position);
  if (!norm || !scale) {
    return unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['playingShare'], available: [] });
  }
  const span = scale.p90 - scale.p10;
  const value = span <= 0 ? 0.5 : Math.min(1, Math.max(0, (norm.share - scale.p10) / span));
  return scoreable({
    value,
    // A programme's own seasons are a measurement of how it uses a squad. A
    // division or sport rate standing in for it is a proxy.
    grade: norm.level === 'programme' ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage: 1,
    basis: {
      playingShare: norm.share,
      seasons: norm.seasons,
      level: norm.level,
      scaleP10: scale.p10,
      scaleMedian: scale.median,
      scaleP90: scale.p90,
      measure: 'effective players sharing the minutes, as a share of the position group',
    },
  });
}

/**
 * How much weighted competition one position is projected to carry, in
 * STARTING UNITS. Separated from the component so the shape and its constants
 * can be tested apart.
 */
export function returningPressure({ starters = 0, squad = 0, unknown = 0 }, {
  places,
  squadWeight = RETURNING_SQUAD_WEIGHT,
  unknownWeight = RETURNING_UNKNOWN_WEIGHT,
} = {}) {
  const weighted = starters + (squadWeight * squad) + (unknownWeight * unknown);
  return weighted / Math.max(1, Number(places) || 1);
}

/** Pressure to a bounded value. Strictly decreasing, never reaching either end. */
export const competitionFromPressure = (pressure, { halfAt = COMPETITION_HALF_PRESSURE } = {}) =>
  1 / (1 + (Math.max(0, pressure) / halfAt));

/**
 * RETURNING COMPETITION: how crowded this position is projected to be when the
 * athlete arrives.
 *
 * NOT A PROBABILITY, and not an estimate of minutes. It counts the players
 * whose eligibility runs past the entry year, weights them by the role we can
 * place them in, and normalises by the starting places the position normally
 * holds - so three returning goalkeepers and three returning midfielders do
 * not read alike.
 *
 * -- WHY HEADCOUNT CARRIES THE VALUE AND ROLE CARRIES THE CONFIDENCE --------
 *
 * A7.8.1 stood at four past seasons and asked what a class list predicts.
 * Raw returning headcount predicts the players who actually came back at
 * r 0.76-0.81 and next season's position group at r 0.73-0.75. Role adds
 * separately: within position it lifts the prediction of next season's
 * STARTERS from rho 0.06-0.31 to 0.23-0.58.
 *
 * But role coverage collapses with distance. For an entry two years out the
 * median share of returners we can place is ZERO, because the players still
 * eligible then are current freshmen who have not played. That is a timing
 * limit, not a scraping gap - those minutes do not exist yet.
 *
 * So the value is built from every returner and the GRADE carries the doubt.
 * Refusing to score the strongest signal in the inventory because an optional
 * refinement is missing would have left this component silent for most of the
 * pool at the horizons Thriv3 actually recruits for.
 */
export function returningCompetition({
  returning = null, position = null, places = null,
  rosterOnFile = false, eligibilityRuled = true,
  squadWeight, unknownWeight, halfAt,
}) {
  if (!rosterOnFile) {
    return unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'], available: [] });
  }
  /**
   * Without an eligibility rule nobody can be placed as returning or
   * departing, so a count of zero would be silence rather than a measurement.
   */
  if (!eligibilityRuled) {
    return unscoreable({ reason: REASON.NO_CLASS_LABELS, missing: ['eligibilityRule'], available: ['roster'] });
  }
  if (!returning || !Number.isFinite(Number(places))) {
    return unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['returningDepth'], available: ['roster'] });
  }

  const starters = Math.max(0, Number(returning.starters) || 0);
  const squad = Math.max(0, Number(returning.squad) || 0);
  const unknown = Math.max(0, Number(returning.unknown) || 0);
  const total = starters + squad + unknown;
  const pressure = returningPressure({ starters, squad, unknown }, { places, squadWeight, unknownWeight });
  const value = competitionFromPressure(pressure, { halfAt });

  /**
   * COVERAGE IS ABOUT ROLE, NOT ABOUT THE COUNT. The headcount is known
   * whenever the roster is readable; what varies is how many of those players
   * we can place. A readable roster with no returners is a MEASUREMENT of an
   * empty position group, and must never be confused with a roster we could
   * not read - which refuses above.
   */
  const coverage = total === 0 ? 1 : (total - unknown) / total;
  return scoreable({
    value,
    grade: (total === 0 || unknown === 0) ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage,
    basis: {
      position,
      returning: total,
      returningStarters: starters,
      returningSquad: squad,
      returningUnknownRole: unknown,
      typicalStarters: places,
      pressure,
      roleCoverage: coverage,
      squadWeight: squadWeight ?? RETURNING_SQUAD_WEIGHT,
      unknownWeight: unknownWeight ?? RETURNING_UNKNOWN_WEIGHT,
      halfAt: halfAt ?? COMPETITION_HALF_PRESSURE,
      measure: 'weighted returners against the starting places this position normally holds',
    },
  });
}

/**
 * PLAYING PATHWAY: projected competition, read alongside how this programme
 * has historically used players at this position.
 *
 * Competition leads because it is specific to this athlete's entry year;
 * rotation is context. Either alone is scoreable - a programme we hold no
 * minutes history for can still have a readable roster, and vice versa - and
 * the grade is the weaker of whatever was used.
 */
export function playingPathway({ competition, rotation, competitionShare = COMPETITION_SHARE }) {
  const hasC = isScoreable(competition);
  const hasR = isScoreable(rotation);
  if (!hasC && !hasR) {
    /**
     * ROTATION'S REASON LEADS when both halves refuse. A caller that never
     * supplied a roster index has told us nothing about the programme's
     * roster, so reporting NO_ROSTER_ON_FILE would be a claim we cannot make;
     * the minutes history is the older and broader contract, and its absence
     * is true in every case where both fail.
     */
    return unscoreable({
      reason: rotation?.reason ?? competition?.reason ?? REASON.NO_MINUTES_HISTORY,
      missing: [...new Set([...(rotation?.missing ?? []), ...(competition?.missing ?? [])])],
      available: [],
    });
  }
  const value = (hasC && hasR)
    ? (competitionShare * competition.value) + ((1 - competitionShare) * rotation.value)
    : (hasC ? competition.value : rotation.value);
  const grades = [hasC ? competition.grade : null, hasR ? rotation.grade : null].filter(Boolean);
  return scoreable({
    value,
    grade: grades.every((g) => g === GRADE.MEASURED) && hasC && hasR ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage: hasC && hasR ? 1 : competitionShare,
    basis: {
      competitionShare,
      competition: hasC ? { value: competition.value, grade: competition.grade, ...competition.basis } : null,
      rotation: hasR ? { value: rotation.value, grade: rotation.grade, ...rotation.basis } : null,
      /** Named so an explanation can say which half it is reading. */
      usedBoth: hasC && hasR,
    },
  });
}

/**
 * Which way the programme is going.
 *
 * The CHANGE in win rate between the two most recent seasons, not its level.
 * That distinction is the whole point: recent win rate correlates with
 * `soccer_score` at 0.35-0.47 and would be programme strength restated, while
 * the change correlates at 0.023 / 0.087 and is genuinely new information.
 *
 * A programme holding steady scores 0.5. That is a MEASURED midpoint of a
 * measured quantity, not a prior standing in for an absent one - a programme
 * we have no win rates for is unscoreable below.
 */
export function programmeTrajectory({ recentWinPct, priorWinPct, saturation = TRAJECTORY_SATURATION }) {
  if (!stated(recentWinPct) || !stated(priorWinPct)) {
    return unscoreable({
      reason: REASON.NO_WIN_RATES,
      missing: [...(stated(recentWinPct) ? [] : ['recentWinPct']), ...(stated(priorWinPct) ? [] : ['priorWinPct'])],
      available: [...(stated(recentWinPct) ? ['recentWinPct'] : []), ...(stated(priorWinPct) ? ['priorWinPct'] : [])],
    });
  }
  const recent = Number(recentWinPct);
  const prior = Number(priorWinPct);
  const change = recent - prior;
  const value = Math.min(1, Math.max(0, 0.5 + (change / (2 * saturation))));
  return scoreable({
    value,
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: { recentWinPct: recent, priorWinPct: prior, change, saturation, direction: change > 0 ? 'improving' : (change < 0 ? 'declining' : 'steady') },
  });
}

/**
 * Does this institution teach what the athlete said they want to study?
 *
 * The ONLY athlete preference Thriv3 currently collects that belongs in this
 * layer. Set membership against the programme's notable majors, using the same
 * matcher the email composer uses, so an athlete is never told one thing and
 * scored another.
 *
 * STRONG ACADEMICS ARE NOT A FIT. A high GPA does not make a selective
 * institution a better opportunity for someone who never said they wanted one;
 * that is V1's academicFit and it is not reproduced here. The academic
 * MINIMUM an athlete sets is a filter and belongs to eligibility.
 */
export function majorFit({ intendedMajor, notableMajors }) {
  const state = academicIntentState(intendedMajor);
  if (state !== ACADEMIC_INTENT.VALID) {
    // Nobody asked, they have not decided, or the answer is not placeable.
    // None of the three is a fit of zero.
    return notApplicable({ intendedMajor: intendedMajor ?? null, academicIntent: state });
  }
  const wanted = majorLabelFor(intendedMajor);
  let offered = notableMajors;
  if (typeof offered === 'string') {
    try { offered = JSON.parse(offered); } catch { offered = null; }
  }
  if (!Array.isArray(offered) || offered.length === 0) {
    return unscoreable({ reason: REASON.NO_STATED_PREFERENCE, missing: ['notableMajors'], available: ['intendedMajor'] });
  }
  const matched = offered.includes(wanted);
  return scoreable({
    value: matched ? 1 : 0,
    // A named list of families against a matched family. Nothing is inferred.
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: { intendedMajor, majorFamily: wanted, matched, notableMajors: offered },
  });
}

/**
 * Where the athlete wants to be.
 *
 * ALWAYS NOT_APPLICABLE TODAY, and this is the sharpest departure from V1.
 * Thriv3 collects the athlete's home city, state or country; it collects no
 * preference about WHERE THEY WANT TO GO - no preferred states, no regions, no
 * maximum distance, no campus setting. V1 scores distance from home and treats
 * closer as better, which is a preference nobody was asked for.
 *
 * Residency pricing is Financial Viability's and international recruiting
 * history is Coach Recruitability's. Neither is a location preference and
 * neither is read here.
 *
 * The signature takes the preference so that the day it is collected, this
 * becomes a scorer and nothing else moves.
 */
export function locationFit({ preferredStates = null, preferredRegions = null, maxDistanceMiles = null, collegeState = null, distanceMiles = null }) {
  const declared = (Array.isArray(preferredStates) && preferredStates.length > 0)
    || (Array.isArray(preferredRegions) && preferredRegions.length > 0)
    || stated(maxDistanceMiles);
  if (!declared) {
    return notApplicable({ why: 'the athlete has stated no location preference, and a home address is not one' });
  }
  if (Array.isArray(preferredStates) && preferredStates.length > 0) {
    if (!collegeState) return unscoreable({ reason: REASON.NO_LOCATION, missing: ['collegeState'], available: ['preferredStates'] });
    const matched = preferredStates.map((s) => String(s).toUpperCase()).includes(String(collegeState).toUpperCase());
    return scoreable({ value: matched ? 1 : 0, grade: GRADE.MEASURED, coverage: 1, basis: { preferredStates, collegeState, matched } });
  }
  if (stated(maxDistanceMiles)) {
    if (!stated(distanceMiles)) return unscoreable({ reason: REASON.NO_LOCATION, missing: ['distanceMiles'], available: ['maxDistanceMiles'] });
    const within = Number(distanceMiles) <= Number(maxDistanceMiles);
    return scoreable({ value: within ? 1 : 0, grade: GRADE.MEASURED, coverage: 1, basis: { maxDistanceMiles, distanceMiles, within } });
  }
  return unscoreable({ reason: REASON.NO_STATED_PREFERENCE, missing: ['preferredRegions'], available: [] });
}

/**
 * How well this programme's competitive level matches what the athlete SAID
 * they want.
 *
 * -- WHAT CHANGED SINCE A7.4 ----------------------------------------------
 *
 * A7.4 held this NOT_APPLICABLE because the preference did not exist. It now
 * does, as an explicit 1-5 answer, and the component is conditional on it: an
 * athlete nobody asked still gets NOT_APPLICABLE, unchanged.
 *
 * -- WHY THIS IS NOT THE V1 GAUSSIAN --------------------------------------
 *
 * The gap is ONE-SIDED. A programme at or above the athlete's own calibrated
 * level scores 1, and a stronger one never scores less than a weaker one. The
 * Gaussian's defect was that passing a programme's level made you a worse fit;
 * here, an athlete who wants the strongest level they can reach is not
 * penalised for a programme being stronger still. Whether they could get in is
 * Coach Recruitability's ceiling, and it is not duplicated here - this layer is
 * allowed to say "they would love this level" while recruitability says "this
 * is an extreme reach", and Pursuit Priority reconciles the two.
 *
 * -- HOW THE PREFERENCE SHAPES IT -----------------------------------------
 *
 *   gap    = athletePercentile - programmePercentile, floored at 0
 *   value  = 1 - strength(priority) x min(1, gap / span)
 *
 * At priority 5 the value falls from 1 to 0 across a third of the pool below
 * the athlete's level. At priority 1 it is 1 everywhere - which is exactly
 * what "level is not important to me" means, and which reorders nothing.
 *
 * DIVISION IS NEVER READ. A strong Division II programme sits above a weak
 * Division I one on the percentile axis, and that is the axis used.
 */
export function athleticOutcome({
  competitiveLevelPriority = null, athletePercentile = null, programmePercentile = null,
  span = COMPETITIVE_LEVEL_SPAN,
}) {
  const strength = priorityStrength(competitiveLevelPriority);
  if (strength === null) {
    return notApplicable({
      why: 'the athlete has stated no competitive-level priority, and their ability is not a statement of ambition',
    });
  }
  if (!stated(athletePercentile) || !stated(programmePercentile)) {
    return unscoreable({
      reason: REASON.NO_PROGRAMME_LEVEL,
      missing: [...(stated(athletePercentile) ? [] : ['athletePercentile']),
        ...(stated(programmePercentile) ? [] : ['programmePercentile'])],
      available: ['competitiveLevelPriority'],
    });
  }
  // Only BELOW counts. Above the athlete's level is still the level they asked
  // for, and any peak here would be the Gaussian returning.
  const gap = Math.max(0, Number(athletePercentile) - Number(programmePercentile));
  const value = 1 - (strength * Math.min(1, gap / span));
  return scoreable({
    value,
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: {
      competitiveLevelPriority: Number(competitiveLevelPriority),
      priorityStrength: strength,
      athletePercentile: Number(athletePercentile),
      programmePercentile: Number(programmePercentile),
      levelGapBelow: gap,
      span,
      atOrAboveOwnLevel: gap === 0,
    },
  });
}

/**
 * How much this athlete values the academic strength of the institution.
 *
 * -- WHY IT IS A PREFERENCE AND NOT A QUALITY TERM -------------------------
 *
 * A stronger institution is not universally better here. It becomes more
 * attractive because THIS athlete said academic strength matters, and for an
 * athlete who said it does not, it changes nothing. Multiplying a programme
 * percentile by a stated priority is the whole design; scoring academic
 * strength on its own would be the ProgramQuality criterion returning under a
 * new name, which A5.1 deleted for good reason.
 *
 * -- WHY PERCENTILE AND NOT rating / 10 ------------------------------------
 *
 * `academic_rating` is skewed: the men's pool runs p10 1.8, median 4.2, p90
 * 8.1 on a nominal 0-10 scale, so raw/10 would compress four fifths of the
 * pool into the bottom half and make the preference nearly inert where most
 * programmes are. A percentile within the athlete's own sport pool spends the
 * whole range on the programmes that actually exist, and is the same
 * treatment `abilityScale` already gives programme strength.
 *
 * -- WHAT IT CANNOT DO -----------------------------------------------------
 *
 * It lives inside Athlete Opportunity/Fit, which is one of three layers
 * combined AFTER Coach Recruitability has had its say and AFTER the
 * recruitability gate. It reorders realistic options; it cannot make an
 * unrealistic one realistic, and there is no academic override of the gate.
 *
 * It reads ONE input. Not GPA, not SAT, not ACT, not admit rate, not net
 * price, not the intended major - each of those belongs to a different
 * question, and three of them are not modelled at all yet.
 */
export function academicStrengthFit({
  academicStrengthPriority = null, academicPercentile = null,
}) {
  const strength = priorityStrength(academicStrengthPriority);
  if (strength === null) {
    return notApplicable({
      why: 'the athlete has stated no academic-strength priority, and their grades are not a statement of what they want',
    });
  }
  if (!stated(academicPercentile)) {
    /**
     * UNKNOWN, never average. 27 programmes carry a placeholder rating and 4
     * carry their division's modal value; both are inferences rather than
     * measurements, and the caller is expected to pass null for them.
     */
    return unscoreable({
      reason: REASON.NO_ACADEMIC_PROFILE,
      missing: ['academicPercentile'],
      available: ['academicStrengthPriority'],
    });
  }
  const percentile = Number(academicPercentile);
  /**
   * A flat 1.0 at priority 1, tilting toward the percentile as the priority
   * rises. At priority 5 the component IS the percentile, so the strongest
   * institution in the pool is worth a full point more than the weakest -
   * inside this component's own weight, which is what bounds the effect.
   */
  const value = (1 - strength) + (strength * percentile);
  return scoreable({
    value,
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: {
      academicStrengthPriority: Number(academicStrengthPriority),
      priorityStrength: strength,
      academicPercentile: percentile,
      // Flat at priority 1: the component exists and reorders nothing, which
      // is a different statement from not being asked.
      inert: strength === 0,
    },
  });
}
