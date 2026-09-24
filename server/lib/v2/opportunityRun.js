/**
 * Evaluate Athlete Opportunity / Fit across a pool.
 *
 * NOT A RANKER, for the same reason the other two are not. A higher
 * Opportunity score is not a better match: it says an opportunity is worth
 * having, not that the athlete can reach it or pay for it.
 */
import {
  squadRotation, returningCompetition, playingPathway, programmeTrajectory, majorFit, locationFit, athleticOutcome,
  academicStrengthFit,
  athleteOpportunity, isScoreable, isNotApplicable, GRADE,
  abilityToPercentile, percentileOf, readPriority, typicalStarters,
} from '../../../shared/matching/v2/index.js';
import { returningDepthFor } from './rosterEvidence.js';
import { eligibilityRuleFor, ELIGIBILITY_MODEL } from '../../../shared/eligibility.js';

function summarise(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  return {
    n: s.length,
    min: Number(s[0].toFixed(4)), p25: Number(at(25).toFixed(4)),
    median: Number(at(50).toFixed(4)), p75: Number(at(75).toFixed(4)),
    max: Number(s[s.length - 1].toFixed(4)),
    mean: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(4)),
  };
}

/**
 * @param {object} p
 * @param {object} p.athlete  { sport, position, intendedMajor, priorityRanking,
 *                              preferredStates, preferredRegions, maxDistanceMiles, levelPreference }
 * @param {Array}  p.colleges
 * @param {Set}    p.rosterProgrammes  names we hold a current roster for
 */
/**
 * Academic strength as a percentile of the athlete's own sport pool.
 *
 * A NOMINAL 0-10 RATING IS NOT A PERCENTILE. The men's pool runs p10 1.8,
 * median 4.2, p90 8.1, so raw/10 would put four fifths of it in the bottom
 * half and make a stated preference nearly inert where most programmes are.
 *
 * INFERRED RATINGS ARE EXCLUDED. 27 programmes carry `placeholder` and 4
 * carry `division-modal`; neither is a measurement of that institution, and
 * inferring academic strength from division is exactly what A7.7.5 forbids.
 * They return null, so the component refuses rather than scoring a guess.
 */
export function academicPercentileScale(colleges) {
  const measured = colleges
    .filter((c) => c.academic_rating !== null && c.academic_rating !== undefined
      && c.academic_rating_source !== 'placeholder' && c.academic_rating_source !== 'division-modal')
    .map((c) => Number(c.academic_rating))
    .sort((a, b) => a - b);
  return (rating, source) => {
    if (rating === null || rating === undefined) return null;
    if (source === 'placeholder' || source === 'division-modal') return null;
    if (!measured.length) return null;
    let lo = 0; let hi = measured.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (measured[m] < rating) lo = m + 1; else hi = m; }
    let up = lo;
    while (up < measured.length && measured[up] === rating) up += 1;
    return ((lo + up) / 2) / measured.length;
  };
}

export function evaluateOpportunity({
  athlete, colleges, rosterProgrammes, rosterIndex = null, entryYear = null, overrides = {},
}) {
  const { sport, position } = athlete;

  /**
   * The athlete's own place on the calibrated programme-strength axis.
   *
   * The SAME axis Coach Recruitability compares against, and used here for a
   * different question: recruitability asks whether the programme would have
   * them, this asks whether the level is what they said they wanted. Computed
   * once. Null when no rating is on file, which makes athleticOutcome
   * unscoreable rather than silently absent.
   */
  const athletePercentile = (() => {
    const rating = Number(athlete.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 10) return null;
    try { return abilityToPercentile(rating, sport); } catch { return null; }
  })();

  /**
   * Academic strength as a percentile of the athlete's own sport pool, built
   * once.
   *
   * A NOMINAL 0-10 RATING IS NOT A PERCENTILE. The men's pool runs p10 1.8,
   * median 4.2, p90 8.1, so raw/10 would put four fifths of it in the bottom
   * half and make a stated preference nearly inert where most programmes are.
   *
   * INFERRED RATINGS ARE EXCLUDED. 27 programmes carry `placeholder` and 4
   * carry `division-modal`; neither is a measurement of that institution, and
   * A7.7.5 forbids inferring academic strength from division. They are passed
   * as null, so the component refuses rather than scoring a guess.
   */
  const academicScale = academicPercentileScale(colleges);

  const results = colleges.map((college) => {
    /**
     * PLAYING PATHWAY, from two facts kept apart until the last step.
     *
     * Rotation is a programme trait read from past seasons; competition is
     * specific to this athlete's entry year. A programme can have one without
     * the other - a readable roster with no minutes history, or minutes
     * history for a programme whose current roster we could not parse - so
     * each refuses on its own terms and the pathway uses whichever it has.
     */
    const rosterOnFile = rosterProgrammes.has(college.name);
    const rotation = squadRotation({
      sport, position, division: college.division, programme: college.name, rosterOnFile,
    });
    const bucket = rosterIndex?.get(college.name)?.positions?.get(position) ?? null;
    const competition = returningCompetition({
      returning: bucket ? returningDepthFor(bucket, entryYear) : null,
      position,
      places: typicalStarters(sport, position),
      rosterOnFile: Boolean(bucket && bucket.rows > 0),
      eligibilityRuled: entryYear !== null
        && eligibilityRuleFor({ division: college.division, season: entryYear })?.model !== ELIGIBILITY_MODEL.UNKNOWN,
      squadWeight: overrides.squadWeight,
      unknownWeight: overrides.unknownWeight,
      halfAt: overrides.halfAt,
    });
    const playing = playingPathway({
      competition, rotation,
      competitionShare: overrides.competitionShare,
    });
    const trajectory = programmeTrajectory({
      recentWinPct: college.recent_win_pct, priorWinPct: college.prior_win_pct,
      saturation: overrides.saturation,
    });
    const major = majorFit({ intendedMajor: athlete.intendedMajor, notableMajors: college.notable_majors });
    const location = locationFit({
      preferredStates: athlete.preferredStates ?? null,
      preferredRegions: athlete.preferredRegions ?? null,
      maxDistanceMiles: athlete.maxDistanceMiles ?? null,
      collegeState: college.state,
      distanceMiles: null,
    });
    const programmePercentile = (() => {
      const score = Number(college.soccer_score);
      if (!Number.isFinite(score)) return null;
      try { return percentileOf(score, sport); } catch { return null; }
    })();
    const outcome = athleticOutcome({
      competitiveLevelPriority: athlete.competitiveLevelPriority ?? null,
      athletePercentile,
      programmePercentile,
      span: overrides.levelSpan,
    });
    const academic = academicStrengthFit({
      academicStrengthPriority: athlete.academicStrengthPriority ?? null,
      academicPercentile: academicScale(college.academic_rating, college.academic_rating_source),
    });
    const result = athleteOpportunity({
      pathway: playing, trajectory, major, location, outcome, academic,
      priorityRanking: athlete.priorityRanking ?? null,
      competitiveLevelPriority: athlete.competitiveLevelPriority ?? null,
      playingOpportunityPriority: athlete.playingOpportunityPriority ?? null,
      academicStrengthPriority: athlete.academicStrengthPriority ?? null,
      floor: overrides.floor, lift: overrides.lift, ambitionLift: overrides.ambitionLift,
      valueWeights: overrides.valueWeights, preferenceWeights: overrides.preferenceWeights,
    });
    return {
      id: college.id, name: college.name, division: college.division, state: college.state,
      result, playing, trajectory, major, location, outcome, academic,
    };
  });

  const scored = results.filter((r) => isScoreable(r.result));
  const n = results.length || 1;
  const byDivision = {};
  const byReason = {};
  const grades = { [GRADE.MEASURED]: 0, [GRADE.PARTIAL]: 0 };
  const componentCoverage = {
    playingPathway: 0, programmeTrajectory: 0, majorFit: 0, locationFit: 0, athleticOutcome: 0, academicStrengthFit: 0,
  };
  const notApplicable = { majorFit: 0, locationFit: 0, athleticOutcome: 0, academicStrengthFit: 0 };

  for (const r of results) {
    const ok = isScoreable(r.result);
    const d = (byDivision[r.division ?? 'UNKNOWN'] ||= { n: 0, scoreable: 0, values: [] });
    d.n += 1;
    if (ok) { d.scoreable += 1; d.values.push(r.result.value); grades[r.result.grade] += 1; }
    else byReason[r.result.reason] = (byReason[r.result.reason] || 0) + 1;

    if (isScoreable(r.playing)) componentCoverage.playingPathway += 1;
    if (isScoreable(r.trajectory)) componentCoverage.programmeTrajectory += 1;
    if (isScoreable(r.major)) componentCoverage.majorFit += 1;
    if (isScoreable(r.location)) componentCoverage.locationFit += 1;
    if (isScoreable(r.outcome)) componentCoverage.athleticOutcome += 1;
    if (isScoreable(r.academic)) componentCoverage.academicStrengthFit += 1;
    if (isNotApplicable(r.major)) notApplicable.majorFit += 1;
    if (isNotApplicable(r.location)) notApplicable.locationFit += 1;
    if (isNotApplicable(r.outcome)) notApplicable.athleticOutcome += 1;
  }

  const share = (x) => Number((x / n).toFixed(4));

  return {
    athlete: { ...athlete },
    counts: {
      programmes: results.length,
      scoreable: scored.length,
      unscoreable: results.length - scored.length,
      scoreableRate: share(scored.length),
      measuredRate: share(grades[GRADE.MEASURED]),
      partialRate: share(grades[GRADE.PARTIAL]),
    },
    opportunity: summarise(scored.map((r) => r.result.value)),
    objectiveValue: summarise(scored.map((r) => r.result.basis.objectiveValue).filter((v) => v !== null)),
    playingPathway: summarise(results.filter((r) => isScoreable(r.playing)).map((r) => r.playing.value)),
    programmeTrajectory: summarise(results.filter((r) => isScoreable(r.trajectory)).map((r) => r.trajectory.value)),
    majorFit: summarise(results.filter((r) => isScoreable(r.major)).map((r) => r.major.value)),
    athleticOutcome: summarise(results.filter((r) => isScoreable(r.outcome)).map((r) => r.outcome.value)),
    ambition: {
      competitiveLevelPriority: readPriority(athlete.competitiveLevelPriority ?? null),
      playingOpportunityPriority: readPriority(athlete.playingOpportunityPriority ?? null),
      athletePercentile,
    },
    componentCoverage: Object.fromEntries(Object.entries(componentCoverage).map(([k, v]) => [k, share(v)])),
    notApplicable: Object.fromEntries(Object.entries(notApplicable).map(([k, v]) => [k, share(v)])),
    preferenceKnown: scored.length ? scored[0].result.basis.preferenceKnown : false,
    prioritiesApplied: scored.length ? scored[0].result.basis.priorities : null,
    byDivision: Object.fromEntries(Object.entries(byDivision)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => [k, {
        n: v.n, scoreable: v.scoreable,
        scoreableRate: Number((v.scoreable / v.n).toFixed(4)),
        opportunity: summarise(v.values),
      }])),
    unscoreableReasons: byReason,
    results,
  };
}

/** One programme, flattened for a report. */
export function opportunityRow(entry) {
  const { result } = entry;
  const common = { id: entry.id, name: entry.name, division: entry.division };
  if (!isScoreable(result)) {
    return { ...common, scoreable: false, reason: result.reason, coverage: result.coverage, missing: [...result.missing] };
  }
  const b = result.basis;
  return {
    ...common,
    scoreable: true,
    opportunity: Number(result.value.toFixed(4)),
    grade: result.grade,
    coverage: Number(result.coverage.toFixed(4)),
    objectiveValue: b.objectiveValue === null ? null : Number(b.objectiveValue.toFixed(4)),
    preferenceValue: b.preferenceValue === null ? null : Number(b.preferenceValue.toFixed(4)),
    preferenceKnown: b.preferenceKnown,
    playingPathway: isScoreable(entry.playing) ? Number(entry.playing.value.toFixed(4)) : null,
    playingShare: b.playing?.playingShare ?? null,
    playingLevel: b.playing?.level ?? null,
    programmeTrajectory: isScoreable(entry.trajectory) ? Number(entry.trajectory.value.toFixed(4)) : null,
    trajectoryChange: b.trajectory?.change ?? null,
    majorFit: isScoreable(entry.major) ? entry.major.value : null,
    athleticOutcome: isScoreable(entry.outcome) ? Number(entry.outcome.value.toFixed(4)) : null,
    levelGapBelow: b.outcome?.levelGapBelow ?? null,
    notApplicable: b.notApplicable,
  };
}
