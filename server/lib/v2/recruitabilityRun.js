/**
 * Evaluate Coach Recruitability across a pool, and describe what came out.
 *
 * NOT A RANKER, for the same reason financialRun.js is not: one layer is not a
 * recommendation, and an order built from it would look like one. Pursuit
 * priority does not exist yet and nothing here invents it.
 */
import {
  athleticPlausibility, positionalOpportunity, recruitingMarket,
  coachRecruitability, isScoreable, GRADE,
} from '../../../shared/matching/v2/index.js';
import { positionEvidence } from './rosterEvidence.js';
import { athleteDistanceKm } from './recruitingMarketEvidence.js';

function summarise(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  return {
    n: s.length,
    min: Number(s[0].toFixed(4)),
    p10: Number(at(10).toFixed(4)),
    p25: Number(at(25).toFixed(4)),
    median: Number(at(50).toFixed(4)),
    p75: Number(at(75).toFixed(4)),
    p90: Number(at(90).toFixed(4)),
    max: Number(s[s.length - 1].toFixed(4)),
    mean: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(4)),
  };
}

/**
 * @param {object} p
 * @param {object} p.athlete   { rating, position, entryYear, isInternational, sport }
 * @param {Array}  p.colleges
 * @param {Map}    p.rosterIndex   from buildPositionIndex
 * @param {Map}    p.arrivalIndex  from buildArrivalIndex
 * @param {object} p.marketIndex  from buildMarketIndex
 * @param {Map}    p.centroids    from stateCentroids
 * @param {object} [p.overrides]   heuristic overrides, for the sensitivity run
 */
export function evaluateRecruitability({
  athlete, colleges, rosterIndex, arrivalIndex, arrivalsHorizon = null,
  marketIndex = null, centroids = null, overrides = {},
}) {
  const { sport, rating, position, entryYear, isInternational, homeState = null } = athlete;

  const results = colleges.map((college) => {
    const plaus = athleticPlausibility({
      rating, soccerScore: college.soccer_score, sport,
      atLevel: overrides.atLevel, decay: overrides.decay, rise: overrides.rise,
    });
    const evidence = positionEvidence({
      programme: college.name, position, sport, division: college.division,
      entryYear, rosterIndex, arrivalIndex, arrivalsHorizon,
    });
    const opportunity = positionalOpportunity({
      sport, position, evidence, weights: overrides.opportunityWeights ?? {},
    });
    const market = recruitingMarket({
      isInternational,
      distanceKm: isInternational ? null
        : athleteDistanceKm({ athleteState: homeState, college, centroids }),
      programme: marketIndex?.programmes?.get(college.name) ?? null,
      division: marketIndex?.divisions?.get(college.division) ?? null,
      minArrivals: overrides.minArrivals,
      pseudoCount: overrides.pseudoCount,
      nearBandKm: overrides.nearBandKm,
      saturation: overrides.saturation,
    });
    const result = coachRecruitability({
      athletic: plaus, positional: opportunity, market,
      phi: overrides.phi, weights: overrides.behaviourWeights,
    });
    return {
      id: college.id, name: college.name, division: college.division,
      soccerScore: college.soccer_score,
      result, plaus, opportunity, market,
    };
  });

  const scored = results.filter((r) => isScoreable(r.result));
  const n = results.length || 1;
  const byDivision = {};
  const byReason = {};
  const grades = { [GRADE.MEASURED]: 0, [GRADE.PARTIAL]: 0 };

  for (const r of results) {
    const ok = isScoreable(r.result);
    const d = (byDivision[r.division ?? 'UNKNOWN'] ||= { n: 0, scoreable: 0, values: [] });
    d.n += 1;
    if (ok) { d.scoreable += 1; d.values.push(r.result.value); grades[r.result.grade] += 1; }
    else byReason[r.result.reason] = (byReason[r.result.reason] || 0) + 1;
  }

  /**
   * The violation that must be zero: a programme the athlete is clearly not
   * plausible for, nevertheless scoring well. This is the V1 pathology stated
   * as a count rather than described.
   */
  const violations = scored.filter((r) => r.plaus.value < 0.15 && r.result.value > 0.3);

  return {
    athlete: { ...athlete },
    counts: {
      programmes: results.length,
      scoreable: scored.length,
      unscoreable: results.length - scored.length,
      scoreableRate: Number((scored.length / n).toFixed(4)),
      measuredRate: Number((grades[GRADE.MEASURED] / n).toFixed(4)),
      partialRate: Number((grades[GRADE.PARTIAL] / n).toFixed(4)),
    },
    recruitability: summarise(scored.map((r) => r.result.value)),
    athleticPlausibility: summarise(results.filter((r) => isScoreable(r.plaus)).map((r) => r.plaus.value)),
    positionalOpportunity: summarise(results.filter((r) => isScoreable(r.opportunity)).map((r) => r.opportunity.value)),
    recruitingMarket: summarise(results.filter((r) => isScoreable(r.market)).map((r) => r.market.value)),
    byDivision: Object.fromEntries(Object.entries(byDivision)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => [k, {
        n: v.n,
        scoreable: v.scoreable,
        scoreableRate: Number((v.scoreable / v.n).toFixed(4)),
        recruitability: summarise(v.values),
      }])),
    unscoreableReasons: byReason,
    violations: { lowPlausibilityHighRecruitability: violations.length, examples: violations.slice(0, 5).map((r) => r.name) },
    results,
  };
}

/** One programme, flattened for a report. */
export function recruitabilityRow(entry) {
  const { result } = entry;
  const common = { id: entry.id, name: entry.name, division: entry.division, soccerScore: entry.soccerScore };
  if (!isScoreable(result)) {
    return {
      ...common, scoreable: false, reason: result.reason, coverage: result.coverage,
      missing: [...result.missing],
      athleticPlausibility: isScoreable(entry.plaus) ? Number(entry.plaus.value.toFixed(4)) : null,
    };
  }
  const b = result.basis;
  return {
    ...common,
    scoreable: true,
    recruitability: Number(result.value.toFixed(4)),
    grade: result.grade,
    coverage: result.coverage,
    athleticPlausibility: Number(b.athleticPlausibility.toFixed(4)),
    delta: Number(b.athleticDelta.toFixed(4)),
    core: Number(b.core.toFixed(4)),
    positionalOpportunity: isScoreable(entry.opportunity) ? Number(entry.opportunity.value.toFixed(4)) : null,
    vacatedStarters: b.positional?.vacatedStarters ?? null,
    typicalStarters: b.positional?.typicalStarters ?? null,
    arrivals: b.positional?.arrivals ?? null,
    fillRate: b.positional?.fillRate ?? null,
    fillLevel: b.positional?.fillLevel ?? null,
    recruitingMarket: isScoreable(entry.market) ? Number(entry.market.value.toFixed(4)) : null,
    marketArm: isScoreable(entry.market) ? entry.market.basis.arm : null,
  };
}
