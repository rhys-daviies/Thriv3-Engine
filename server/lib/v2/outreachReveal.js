/**
 * A7.13 reveal: View B, and every pre-registered metric.
 *
 * -- THE ORDER OF OPERATIONS IS THE WHOLE POINT --------------------------
 *
 * This module may only run against a pack whose answers already exist. It
 * re-runs the same pipeline the pack was generated from, checks the pool has
 * not moved underneath it, and then joins the model's answers to the
 * reviewer's. It computes only the metrics named in `PREREGISTERED_METRICS`;
 * anything else a reader wants is a hypothesis for a later phase, not a V3
 * result.
 *
 * READ-ONLY. Changes no scorer, no constant and no record.
 */
import { normaliseAthlete } from '../../../shared/matching/pool.js';
import { canonicalPosition } from '../../../shared/positions.js';
import {
  buildValidationAthlete, isScoreable, RANKING_STATE, TOP_N,
  explainProgramme, renderExplanation, kendallTauB,
} from '../../../shared/matching/v2/index.js';
import {
  PREREGISTERED_METRICS, rankDistanceBand, RANK_DISTANCE_BAND,
  relativeBand, RELATIVE_BAND, isPursueSet, classificationOrdinal,
} from '../../../shared/matching/v2/validation/outreachRubric.js';
import { runPursuit } from './pursuitRun.js';
import { poolDigest } from './outreachPack.js';

const r3 = (n) => (Number.isFinite(n) ? Number(n.toFixed(3)) : null);
const r4 = (n) => (Number.isFinite(n) ? Number(n.toFixed(4)) : null);
export const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const share = (k, n) => (n ? Number((k / n).toFixed(4)) : null);

/** Re-run the pipeline the pack was built from, and refuse if the pool moved. */
export function rerun({ athleteDef, ctx, pack }) {
  const player = athleteDef.player;
  const digest = poolDigest(ctx.colleges);
  if (digest !== pack.digests.pool) {
    throw new Error(`outreachReveal: the pool has moved since the pack was frozen `
      + `(${pack.digests.pool} -> ${digest}). The review cannot be scored against a different universe.`);
  }
  const v1Shape = normaliseAthlete({ ...player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete, inputs } = buildValidationAthlete({
    record: player, v1Shape, position: canonicalPosition(player.position), label: athleteDef.id,
    profile: {
      competitiveLevelPriority: player.competitive_level_priority,
      playingOpportunityPriority: player.playing_opportunity_priority,
      academicStrengthPriority: player.academic_strength_priority,
    },
  });
  const run = runPursuit({ athlete, sport: player.sport, colleges: ctx.colleges, ctx });
  return { run, inputs, athlete };
}

/** Everything about one sampled programme, model side and human side. */
export function joinRows({ pack, run, answers, collegesById, equivalent }) {
  const ranked = new Map(run.pipeline.ranked.map((e) => [e.id, e]));
  const limited = new Map(run.pipeline.limited.map((e) => [e.id, e]));
  const byNo = new Map(answers.map((a) => [a[0], a]));

  return pack.viewA.programmes.map((p) => {
    const a = byNo.get(p.reviewNo);
    const e = ranked.get(p.id) ?? limited.get(p.id) ?? null;
    const college = collegesById.get(p.id);
    const strength = college?.soccer_score ?? null;
    const isRanked = Boolean(e && e.rankingState === RANKING_STATE.RANKED);
    const b = isRanked ? e.pursuitPriority.basis : null;
    const rb = e && isScoreable(e.recruitability) ? e.recruitability.basis : null;
    const ob = e && isScoreable(e.opportunity) ? e.opportunity.basis : null;
    const sig = (k) => rb?.signals?.find((s) => s.key === k)?.value ?? null;
    const comp = (k) => ob?.components?.[k]?.value ?? null;

    return {
      reviewNo: p.reviewNo,
      id: p.id,
      name: a?.[1] ?? p.facts?.name,
      division: p.facts?.division ?? null,
      classification: a?.[2] ?? null,
      first100: a?.[3] ?? null,
      pursue: isPursueSet(a?.[2]),
      ordinal: classificationOrdinal(a?.[2]),
      rankingState: e ? e.rankingState : 'NOT EVALUATED',
      rank: isRanked ? e.rank : null,
      inTop100: isRanked ? e.rank <= TOP_N : false,
      pursuitPriority: isRanked ? r4(e.pursuitPriority.value) : null,
      grade: isRanked ? e.pursuitPriority.grade : null,
      R: e && isScoreable(e.recruitability) ? r3(e.recruitability.value) : null,
      F: e && isScoreable(e.financial) ? r3(e.financial.value) : null,
      O: e && isScoreable(e.opportunity) ? r3(e.opportunity.value) : null,
      rGrade: e && isScoreable(e.recruitability) ? e.recruitability.grade : null,
      fGrade: e && isScoreable(e.financial) ? e.financial.grade : null,
      oGrade: e && isScoreable(e.opportunity) ? e.opportunity.grade : null,
      base: isRanked ? r3(b.base) : null,
      gR: isRanked ? r3(b.recruitabilityGate) : null,
      gF: isRanked ? r3(b.financialGate) : null,
      gRloss: isRanked ? r4(b.recruitabilityGateLoss) : null,
      gFloss: isRanked ? r4(b.financialGateLoss) : null,
      athleticPlausibility: rb ? r3(rb.athleticPlausibility) : null,
      athleticDelta: rb ? r3(rb.athleticDelta) : null,
      positional: sig('positionalOpportunity') === null ? null : r3(sig('positionalOpportunity')),
      positionalState: rb?.positionalState ?? null,
      market: sig('recruitingMarket') === null ? null : r3(sig('recruitingMarket')),
      marketState: rb?.marketState ?? null,
      support: rb ? r3(rb.support) : null,
      playingPathway: comp('playingPathway') === null ? null : r3(comp('playingPathway')),
      athleticOutcome: comp('athleticOutcome') === null ? null : r3(comp('athleticOutcome')),
      academicStrengthFit: comp('academicStrengthFit') === null ? null : r3(comp('academicStrengthFit')),
      trajectory: comp('programmeTrajectory') === null ? null : r3(comp('programmeTrajectory')),
      missingLayers: e && e.rankingState === RANKING_STATE.LIMITED_DATA ? [...e.missingLayers] : [],
      layerReasons: e && e.rankingState === RANKING_STATE.LIMITED_DATA ? e.layerReasons : null,
      programmeStrength: strength,
      strengthDelta: Number.isFinite(strength) ? r3(strength - equivalent) : null,
      relativeBand: Number.isFinite(strength) ? relativeBand(strength - equivalent) : null,
      rankDistanceBand: isRanked ? rankDistanceBand(e.rank) : null,
      entry: e,
    };
  });
}

/** Every pre-registered metric, computed and keyed by its id. */
export function runMetrics({ rows, run, equivalent, collegesById }) {
  const out = {};
  const rankedRows = rows.filter((r) => r.rank !== null);
  const judged = rows.filter((r) => r.classification !== null);
  const pursue = rankedRows.filter((r) => r.pursue);
  const yes = rankedRows.filter((r) => r.first100 === 'YES');
  const no = rankedRows.filter((r) => r.first100 === 'NO');

  out.pursueInTopN = {
    n: pursue.length,
    cuts: Object.fromEntries([10, 25, 50, 100].map((c) => [
      `top${c}`, { k: pursue.filter((r) => r.rank <= c).length, share: share(pursue.filter((r) => r.rank <= c).length, pursue.length) },
    ])),
    programmes: pursue.map((r) => ({ name: r.name, rank: r.rank, classification: r.classification })),
  };

  out.first100YesInsideTop100 = {
    n: yes.length,
    inside: yes.filter((r) => r.inTop100).length,
    outside: yes.filter((r) => !r.inTop100).length,
    shareInside: share(yes.filter((r) => r.inTop100).length, yes.length),
    medianRank: median(yes.map((r) => r.rank)),
  };

  out.first100YesRankDistance = {
    n: yes.filter((r) => !r.inTop100).length,
    bands: Object.fromEntries(RANK_DISTANCE_BAND.map((b) => [
      b.label, yes.filter((r) => !r.inTop100 && rankDistanceBand(r.rank) === b.key).length,
    ])),
    programmes: yes.filter((r) => !r.inTop100)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({ name: r.name, rank: r.rank, beyondCutoff: r.rank - TOP_N, band: r.rankDistanceBand })),
  };

  out.first100NoInsideTop100 = {
    n: no.length,
    inside: no.filter((r) => r.inTop100).length,
    shareInside: share(no.filter((r) => r.inTop100).length, no.length),
    programmes: no.filter((r) => r.inTop100).sort((a, b) => a.rank - b.rank)
      .map((r) => ({ name: r.name, rank: r.rank, classification: r.classification, strengthDelta: r.strengthDelta })),
  };

  const shapeOf = (set) => ({
    n: set.length,
    medianStrength: median(set.map((r) => r.programmeStrength)),
    medianStrengthDelta: median(set.map((r) => r.strengthDelta)),
    medianR: median(set.map((r) => r.R)),
    medianF: median(set.map((r) => r.F)),
    medianO: median(set.map((r) => r.O)),
  });
  out.pursueSetShape = shapeOf(pursue);

  const top100 = run.pipeline.ranked.slice(0, TOP_N).map((e) => ({
    programmeStrength: collegesById.get(e.id)?.soccer_score ?? null,
    strengthDelta: Number.isFinite(collegesById.get(e.id)?.soccer_score)
      ? collegesById.get(e.id).soccer_score - equivalent : null,
    R: e.recruitability.value, F: e.financial.value, O: e.opportunity.value,
  }));
  out.modelTopShape = shapeOf(top100);

  const dist = (set) => {
    const withBand = set.filter((r) => r.relativeBand ?? relativeBand(r.strengthDelta));
    const counts = Object.fromEntries(RELATIVE_BAND.map((b) => [b.key, 0]));
    for (const r of withBand) {
      const k = r.relativeBand ?? relativeBand(r.strengthDelta);
      if (k) counts[k] += 1;
    }
    const n = withBand.length;
    return {
      n,
      counts,
      shares: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, share(v, n)])),
    };
  };
  out.eliteRelativeDistribution = {
    modelTop100: dist(top100.map((r) => ({ ...r, relativeBand: relativeBand(r.strengthDelta) }))),
    humanYes: dist(yes),
    humanPursue: dist(pursue),
    sampleAll: dist(rankedRows),
  };

  const tabulate = (set, key) => {
    const groups = {};
    for (const r of set) {
      const k = key(r);
      if (k === null || k === undefined) continue;
      groups[k] ??= { n: 0, pursue: 0, yes: 0, no: 0, unsure: 0, wouldNot: 0, insufficient: 0 };
      const g = groups[k];
      g.n += 1;
      if (r.pursue) g.pursue += 1;
      if (r.first100 === 'YES') g.yes += 1;
      if (r.first100 === 'NO') g.no += 1;
      if (r.first100 === 'UNSURE') g.unsure += 1;
      if (r.classification === 'WOULD_NOT_PURSUE') g.wouldNot += 1;
      if (r.classification === 'INSUFFICIENT_INFORMATION') g.insufficient += 1;
    }
    return groups;
  };

  out.agreementByRelativeBand = tabulate(rankedRows, (r) => r.relativeBand);
  out.agreementByRankBand = tabulate(judged, (r) => (r.rank === null ? 'LIMITED_DATA'
    : r.rank <= 10 ? '1-10' : r.rank <= 25 ? '11-25' : r.rank <= 50 ? '26-50'
      : r.rank <= 100 ? '51-100' : r.rank <= 150 ? '101-150' : r.rank <= 250 ? '151-250'
        : r.rank <= 500 ? '251-500' : '501+'));
  out.agreementByDivision = tabulate(judged, (r) => r.division);
  const quintile = (set, get) => {
    const vals = set.map(get).filter(Number.isFinite).sort((a, b) => a - b);
    if (!vals.length) return () => null;
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)];
    return (r) => {
      const v = get(r);
      if (!Number.isFinite(v)) return null;
      return v <= cuts[0] ? 'Q1 (lowest)' : v <= cuts[1] ? 'Q2' : v <= cuts[2] ? 'Q3' : v <= cuts[3] ? 'Q4' : 'Q5 (highest)';
    };
  };
  out.agreementByLayerBand = {
    R: tabulate(rankedRows, quintile(rankedRows, (r) => r.R)),
    F: tabulate(rankedRows, quintile(rankedRows, (r) => r.F)),
    O: tabulate(rankedRows, quintile(rankedRows, (r) => r.O)),
  };
  out.agreementByEvidence = {
    pursuitGrade: tabulate(rankedRows, (r) => r.grade),
    limitedData: tabulate(judged, (r) => (r.rank === null ? 'LIMITED_DATA' : 'RANKED')),
  };

  const lim = rows.filter((r) => r.rank === null && r.classification !== null);
  out.limitedDataReadAsAbsence = {
    n: lim.length,
    readAsAbsence: lim.filter((r) => ['INSUFFICIENT_INFORMATION', 'BORDERLINE'].includes(r.classification)).length,
    readAsPoor: lim.filter((r) => r.classification === 'WOULD_NOT_PURSUE').length,
    shareReadAsAbsence: share(lim.filter((r) => ['INSUFFICIENT_INFORMATION', 'BORDERLINE'].includes(r.classification)).length, lim.length),
    programmes: lim.map((r) => ({ name: r.name, classification: r.classification, first100: r.first100, missing: r.missingLayers })),
  };

  const groupA = rankedRows.filter((r) => (r.pursue || r.first100 === 'YES') && !r.inTop100);
  const groupB = rankedRows.filter((r) => r.inTop100
    && ['LOW_PRIORITY', 'WOULD_NOT_PURSUE'].includes(r.classification));
  const describe = (set) => ({
    n: set.length,
    medianAthleticPlausibility: median(set.map((r) => r.athleticPlausibility)),
    medianPositional: median(set.map((r) => r.positional)),
    medianMarket: median(set.map((r) => r.market)),
    medianR: median(set.map((r) => r.R)),
    medianStrength: median(set.map((r) => r.programmeStrength)),
    medianStrengthDelta: median(set.map((r) => r.strengthDelta)),
    medianAthleticOutcome: median(set.map((r) => r.athleticOutcome)),
    medianPlayingPathway: median(set.map((r) => r.playingPathway)),
    medianF: median(set.map((r) => r.F)),
    medianRank: median(set.map((r) => r.rank)),
    programmes: set.sort((a, b) => a.rank - b.rank).map((r) => r.name),
  });
  out.recruitabilityVsLevel = {
    humanWantsModelBuried: describe(groupA),
    modelPromotesHumanRejects: describe(groupB),
  };

  const pairs = rankedRows.filter((r) => r.ordinal !== null)
    .map((r) => ({ human: r.ordinal, rank: r.rank }));
  out.kendallTauB = { n: pairs.length, ...(kendallTauB(pairs) ?? {}) };

  return out;
}

/** View B, per A7.13 §10. */
export function buildViewB({ rows, run, pack, equivalent }) {
  const ranked = run.pipeline.ranked;
  const poolMedianPriority = run.pursuitPriority?.median ?? null;
  return rows
    .slice()
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name))
    .map((r) => {
      let explanation = null;
      try {
        const ex = explainProgramme(r.entry, {
          rank: r.rank ?? null, outOf: ranked.length,
          poolSize: run.counts.evaluated, poolMedianPriority,
        });
        explanation = renderExplanation(ex).lines;
      } catch { explanation = null; }
      const { entry, ...rest } = r;
      return { ...rest, athleteEquivalentStrength: equivalent, explanation };
    });
}

export { PREREGISTERED_METRICS };
