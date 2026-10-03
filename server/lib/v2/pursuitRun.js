/**
 * Run the whole V2 pipeline for one athlete over one pool, and describe it
 * beside the frozen V1 answer.
 *
 * READ-ONLY and ADOPTS NOTHING. V1 continues to serve every recommendation;
 * this exists so that the difference can be argued about before anything is
 * decided.
 */
import {
  rankPool, isScoreable, RANKING_STATE, TOP_N,
} from '../../../shared/matching/v2/index.js';
import { evaluateFinancial } from './financialRun.js';
import { evaluateRecruitability } from './recruitabilityRun.js';
import { evaluateOpportunity } from './opportunityRun.js';

function summarise(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  return {
    n: s.length,
    min: Number(s[0].toFixed(4)), p10: Number(at(10).toFixed(4)), p25: Number(at(25).toFixed(4)),
    median: Number(at(50).toFixed(4)), p75: Number(at(75).toFixed(4)), p90: Number(at(90).toFixed(4)),
    max: Number(s[s.length - 1].toFixed(4)), mean: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(4)),
  };
}

function correlation(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let c = 0; let va = 0; let vb = 0;
  for (let i = 0; i < n; i += 1) { const d = a[i] - ma; const e = b[i] - mb; c += d * e; va += d * d; vb += e * e; }
  return (va === 0 || vb === 0) ? null : Number((c / Math.sqrt(va * vb)).toFixed(3));
}

const composition = (rows) => Object.fromEntries(
  Object.entries(rows.reduce((acc, r) => { acc[r.division] = (acc[r.division] || 0) + 1; return acc; }, {}))
    .sort((a, b) => b[1] - a[1]));

/**
 * Evaluate the three layers and run the pipeline.
 *
 * `suppressedIds` and `ineligible` are passed in rather than queried, so the
 * pipeline can be tested without a database and so that the two states cannot
 * be confused with each other by accident.
 */
export function runPursuit({
  athlete, sport, colleges, ctx, suppressedIds = new Set(), ineligible = new Map(),
  weights, gates, topN = TOP_N, recruitabilityOverrides = {}, opportunityOverrides = {},
}) {
  const fin = evaluateFinancial({ athlete: athlete.v1Shape, colleges, sport });
  const rec = evaluateRecruitability({
    athlete: athlete.recruitability, colleges,
    rosterIndex: ctx.rosterIndex, arrivalIndex: ctx.arrivalIndex,
    arrivalsHorizon: ctx.arrivalsHorizon,
    marketIndex: ctx.marketIndex, centroids: ctx.centroids,
    overrides: recruitabilityOverrides,
  });
  const opp = evaluateOpportunity({
    athlete: athlete.opportunity, colleges, rosterProgrammes: ctx.rosterProgrammes,
    /**
     * The roster index and the entry year, so Playing Pathway can read who is
     * projected to still be there. Recruitability already reads the departing
     * side of the same index; this is the returning side of it.
     */
    rosterIndex: ctx.rosterIndex ?? null,
    entryYear: athlete.recruitability?.entryYear ?? null,
    /** A7.37. How far the entry year sits past the roster this is read from. */
    rosterSeason: ctx.rosterSeason ?? null,
    overrides: opportunityOverrides,
  });
  // Carried out so a diagnostic can show which preference produced which list.
  const ambition = opp.ambition;

  const byId = new Map(colleges.map((c) => [c.id, {
    id: c.id, name: c.name, division: c.division, state: c.state, soccerScore: c.soccer_score,
    suppressed: suppressedIds.has(c.id),
    ineligible: ineligible.has(c.id),
    ineligibleReason: ineligible.get(c.id) ?? null,
  }]));
  for (const r of fin.results) byId.get(r.id).financial = r.result;
  for (const r of rec.results) byId.get(r.id).recruitability = r.result;
  for (const r of opp.results) byId.get(r.id).opportunity = r.result;

  const pipeline = rankPool([...byId.values()], {
    topN, weights, gates,
    // A7.18: the athlete's own level statement, given authority outside the
    // layer that cannot hear it. See pursuitRules.js.
    competitiveLevelPriority: athlete.opportunity?.competitiveLevelPriority ?? null,
  });

  const priorities = pipeline.ranked.map((r) => r.pursuitPriority.value);
  const gatesFired = {
    recruitability: pipeline.ranked.filter((r) => r.pursuitPriority.basis.recruitabilityGateFired).length,
    financial: pipeline.ranked.filter((r) => r.pursuitPriority.basis.financialGateFired).length,
  };

  return {
    athlete: athlete.label,
    ambition,
    counts: pipeline.counts,
    pursuitPriority: summarise(priorities),
    compression: {
      below005: Number((priorities.filter((p) => p < 0.05).length / (priorities.length || 1)).toFixed(4)),
      above090: Number((priorities.filter((p) => p > 0.9).length / (priorities.length || 1)).toFixed(4)),
    },
    layers: {
      recruitability: summarise(pipeline.ranked.map((r) => r.recruitability.value)),
      financial: summarise(pipeline.ranked.map((r) => r.financial.value)),
      opportunity: summarise(pipeline.ranked.map((r) => r.opportunity.value)),
    },
    gateFiringRate: {
      recruitability: Number((gatesFired.recruitability / (pipeline.ranked.length || 1)).toFixed(4)),
      financial: Number((gatesFired.financial / (pipeline.ranked.length || 1)).toFixed(4)),
    },
    /**
     * How much programme STRENGTH ends up driving the priority.
     *
     * `soccer_score` enters directly in exactly one place - the recruitability
     * ceiling - and yet all three layers lean the same way: a weaker programme
     * is easier to be recruited by, cheaper, and spreads its minutes more
     * widely. Adding them compounds it, and the compound is larger than any
     * single layer. Reported on every run because it is the thing most likely
     * to make a ranking look wrong to an operator, and because nothing in V2
     * currently pulls the other way: the athlete's level ambition is the one
     * preference that would, and it is not collected.
     */
    programmeStrengthInfluence: (() => {
      const withScore = pipeline.ranked.filter((r) => typeof r.soccerScore === 'number');
      const s = withScore.map((r) => r.soccerScore);
      return {
        n: withScore.length,
        pursuitPriority: correlation(s, withScore.map((r) => r.pursuitPriority.value)),
        recruitability: correlation(s, withScore.map((r) => r.recruitability.value)),
        financial: correlation(s, withScore.map((r) => r.financial.value)),
        opportunity: correlation(s, withScore.map((r) => r.opportunity.value)),
      };
    })(),
    topComposition: composition(pipeline.actionable),
    top25Composition: composition(pipeline.actionable.slice(0, 25)),
    limitedComposition: composition(pipeline.limited),
    limitedReasons: pipeline.limited.reduce((acc, r) => {
      const key = r.missingLayers.join('+');
      acc[key] = (acc[key] || 0) + 1; return acc;
    }, {}),
    pipeline,
  };
}

/** One ranked programme, flattened to what a diagnostic needs. */
export function pursuitRow(entry) {
  if (entry.rankingState !== RANKING_STATE.RANKED) {
    return {
      rank: null, id: entry.id, name: entry.name, division: entry.division,
      rankingState: entry.rankingState,
      pursuitPriority: null,
      missingLayers: entry.missingLayers ?? null,
      layerReasons: entry.layerReasons ?? null,
      layersKnown: entry.order?.layersKnown ?? null,
      coverage: entry.order?.coverage ?? null,
      recruitability: isScoreable(entry.recruitability) ? Number(entry.recruitability.value.toFixed(4)) : null,
      financial: isScoreable(entry.financial) ? Number(entry.financial.value.toFixed(4)) : null,
      opportunity: isScoreable(entry.opportunity) ? Number(entry.opportunity.value.toFixed(4)) : null,
    };
  }
  const b = entry.pursuitPriority.basis;
  return {
    rank: entry.rank, id: entry.id, name: entry.name, division: entry.division,
    rankingState: entry.rankingState,
    pursuitPriority: Number(entry.pursuitPriority.value.toFixed(4)),
    grade: entry.pursuitPriority.grade,
    recruitability: Number(b.recruitability.toFixed(4)),
    financial: Number(b.financial.toFixed(4)),
    opportunity: Number(b.opportunity.toFixed(4)),
    base: Number(b.base.toFixed(4)),
    recruitabilityGate: Number(b.recruitabilityGate.toFixed(4)),
    financialGate: Number(b.financialGate.toFixed(4)),
    recruitabilityGateLoss: Number(b.recruitabilityGateLoss.toFixed(4)),
    financialGateLoss: Number(b.financialGateLoss.toFixed(4)),
  };
}
