/**
 * Assemble one athlete's human-review packet.
 *
 * PURE. Takes an already-computed pipeline report and produces a
 * JSON-serialisable packet. It recomputes no score and calls no scorer; a test
 * proves the pipeline outputs are identical before and after building a pack.
 *
 * -- THE BLIND VIEW IS A SEPARATE OBJECT, NOT A FILTER --------------------
 *
 * `viewA` is built from its own whitelist of programme facts rather than by
 * deleting fields from `viewB`. Deriving it by deletion is how a model answer
 * leaks: one new field added to the reveal later, nobody updates the deletion
 * list, and the blind view quietly starts carrying the rank. The two views
 * share nothing but the programme id.
 *
 * -- WHAT THE BLIND VIEW DELIBERATELY DOES SHOW ---------------------------
 *
 * Programme strength is shown. It is a model input - Coach Recruitability's
 * ceiling reads it - and withholding it would make the blind question
 * unanswerable, because "would you contact this school for this athlete" is
 * not a question anybody can answer without knowing the school's standard. The
 * athlete's own calibrated percentile is shown too, for the same reason. What
 * is withheld is every model OUTPUT: the delta between the two, the layer
 * values, the gates, the rank and the prose.
 */
import { RANKING_STATE, isScoreable } from '../types.js';
import { explainProgramme } from '../explain/explain.js';
import { renderExplanation, renderMovement } from '../explain/render.js';
import { explainMovement } from '../explain/movement.js';
import { STRATUM } from './sample.js';

export const PACK_FORMAT = 'thriv3-v2-validation-pack/1';

const r3 = (n) => (Number.isFinite(n) ? Number(n.toFixed(3)) : null);
const r4 = (n) => (Number.isFinite(n) ? Number(n.toFixed(4)) : null);

/**
 * The facts a blind reviewer is given, and nothing else.
 *
 * Published or externally checkable programme attributes, of the kind an
 * operator would look up before emailing anyway. No Thriv3 judgement about
 * this athlete appears here.
 */
/**
 * Evidence states a blind reviewer may see. These are DESCRIPTIONS OF WHAT WE
 * HOLD, never of what the model concluded from it.
 */
export const EVIDENCE_STATE = Object.freeze({
  FULL: 'FULL', PARTIAL: 'PARTIAL', INSUFFICIENT: 'INSUFFICIENT', UNKNOWN: 'UNKNOWN',
});

/**
 * @param {object} college
 * @param {object|null} evidence  factual roster / market / academic context,
 *                                built server-side and carrying no model value
 */
export function programmeFacts(college, evidence = null) {
  if (!college) return null;
  return {
    /**
     * A7.7.6. The first review found View A asked the reviewer to judge
     * roster-related recommendations while withholding the roster. Three
     * reason codes were unanswerable and a fourth was marked on all 43 rows.
     * These are counts and states only - no component value, no score, no
     * model conclusion.
     */
    roster: evidence?.roster ?? null,
    recruitingMarket: evidence?.market ?? null,
    academic: evidence?.academic ?? null,
    name: college.name,
    division: college.division,
    conference: college.conference ?? null,
    city: college.city ?? null,
    state: college.state ?? null,
    control: college.control ?? null,
    programmeStrength: college.soccer_score ?? null,
    nationalRanking: college.national_ranking ?? null,
    postseason2025: college.postseason_2025_round ?? null,
    recentWinPct: r3(college.recent_win_pct),
    priorWinPct: r3(college.prior_win_pct),
    academicRating: college.academic_rating ?? null,
    satAvg: college.sat_avg ?? null,
    admitRate: r3(college.admit_rate),
    netPrice: college.net_price ?? null,
    tuitionInState: college.tuition_in_state ?? null,
    tuitionOutState: college.tuition_out_state ?? null,
    notableMajors: college.notable_majors ?? null,
  };
}

/** The layer numbers for one ranked entry, flattened. */
function modelRow(entry) {
  if (entry.rankingState !== RANKING_STATE.RANKED) {
    return {
      rankingState: entry.rankingState,
      pursuitPriority: null,
      missingLayers: [...(entry.missingLayers ?? [])],
      layerReasons: entry.layerReasons ?? null,
      layersKnown: entry.order?.layersKnown ?? null,
      coverage: r3(entry.order?.coverage),
      recruitability: isScoreable(entry.recruitability) ? r3(entry.recruitability.value) : null,
      financial: isScoreable(entry.financial) ? r3(entry.financial.value) : null,
      opportunity: isScoreable(entry.opportunity) ? r3(entry.opportunity.value) : null,
    };
  }
  const b = entry.pursuitPriority.basis;
  return {
    rankingState: entry.rankingState,
    rank: entry.rank,
    pursuitPriority: r4(entry.pursuitPriority.value),
    recruitability: r3(b.recruitability),
    financial: r3(b.financial),
    opportunity: r3(b.opportunity),
    base: r3(b.base),
    recruitabilityGate: r3(b.recruitabilityGate),
    financialGate: r3(b.financialGate),
    recruitabilityGateLoss: r3(b.recruitabilityGateLoss),
    financialGateLoss: r3(b.financialGateLoss),
    grade: entry.pursuitPriority.grade,
    coverage: r3(entry.pursuitPriority.coverage),
    evidence: ['recruitability', 'financial', 'opportunity'].map((k) => ({
      layer: k,
      grade: isScoreable(entry[k]) ? entry[k].grade : null,
      coverage: r3(entry[k].coverage),
    })),
  };
}

/**
 * Build the packet.
 *
 * @param {object} args
 * @param {string} args.packId
 * @param {object} args.provenance   every identifier the review must be pinned to
 * @param {object} args.athlete      the declared inputs, in full
 * @param {object} args.run          the runPursuit report
 * @param {Map}    args.v1Ranks
 * @param {object} args.sample       from stratifiedSample
 * @param {Map}    args.collegesById for the blind facts
 * @param {object} [args.ambitionSensitivity] rank under each ambition profile, by programme id
 */
export function buildPack({
  packId, provenance, athlete, run, v1Ranks, sample, collegesById,
  ambitionSensitivity = null, factsById = null,
}) {
  const ranked = run.pipeline.ranked;
  const poolMedianPriority = run.pursuitPriority?.median ?? null;
  const context = (e) => ({
    rank: e.rank ?? null, outOf: ranked.length,
    poolSize: run.counts.evaluated, poolMedianPriority,
  });

  const viewA = sample.blindOrder.map((row, i) => ({
    reviewNo: i + 1,
    id: row.id,
    facts: programmeFacts(collegesById.get(row.id), factsById?.get(row.id) ?? null),
  }));

  const blindNo = new Map(viewA.map((v) => [v.id, v.reviewNo]));

  const viewB = sample.rows.map((row) => {
    const explanation = explainProgramme(row.entry, context(row.entry));
    const rendered = renderExplanation(explanation);
    const movement = explainMovement(row.entry, row.v1Rank, { v2Rank: row.rank });
    return {
      reviewNo: blindNo.get(row.id),
      id: row.id,
      name: row.name,
      division: row.division,
      strata: row.strata,
      rank: row.rank,
      v1Rank: row.v1Rank,
      programmeStrength: collegesById.get(row.id)?.soccer_score ?? null,
      model: modelRow(row.entry),
      standing: explanation.standing,
      layerSummary: explanation.layerSummary ?? null,
      explanation: {
        codes: explanation.reasons.map((r) => ({ code: r.code, layer: r.layer, polarity: r.polarity })),
        lines: rendered.lines,
        gates: rendered.gates,
        gateEffects: explanation.gateEffects,
        checks: rendered.checks,
        evidenceQuality: explanation.evidenceQuality,
      },
      movement: {
        direction: movement.direction,
        delta: movement.delta,
        comparesScores: movement.comparesScores,
        sentence: renderMovement(movement),
      },
      ambitionSensitivity: ambitionSensitivity?.get(row.id) ?? null,
    };
  });

  /**
   * One empty row per sampled programme, keyed by the BLIND number, so a
   * review filled in during view A is still attributable after the reveal.
   */
  const reviewTemplate = viewA.map((v) => ({
    reviewNo: v.reviewNo,
    programmeId: v.id,
    programmeName: v.facts?.name ?? null,
    classification: null,
    reasonTags: [],
    notes: '',
    explanationReview: {
      helpful: null, accurate: null, tooMuchDetail: null,
      missingImportantReason: '', misleadingClaim: '',
    },
    disagreement: null,
    reviewedAt: null,
  }));

  return {
    formatVersion: PACK_FORMAT,
    packId,
    generatedAt: provenance.generatedAt,
    provenance,
    athlete,
    distribution: {
      poolSize: run.counts.evaluated,
      ranked: run.counts.ranked,
      limitedData: run.counts.limitedData,
      ineligible: run.counts.ineligible,
      suppressed: run.counts.suppressed,
      actionable: run.counts.actionable,
      pursuitPriority: run.pursuitPriority,
      compression: run.compression,
      layers: run.layers,
      gateFiringRate: run.gateFiringRate,
      programmeStrengthInfluence: run.programmeStrengthInfluence,
      topComposition: run.topComposition,
      top25Composition: run.top25Composition,
      limitedComposition: run.limitedComposition,
      limitedReasons: run.limitedReasons,
      /**
       * Repeated at the top of the packet because it is the single number
       * most likely to make a rank misread: where the whole pool sits.
       */
      poolMedianPriority,
      poolMostlyOutOfReach: Number.isFinite(poolMedianPriority) && poolMedianPriority < 0.10,
    },
    sample: { size: sample.size, counts: sample.counts, strata: STRATUM },
    viewA: { programmes: viewA },
    viewB: { programmes: viewB },
    ranked: run.pipeline.actionable.map((e) => ({
      rank: e.rank, id: e.id, name: e.name, division: e.division,
      programmeStrength: collegesById.get(e.id)?.soccer_score ?? null,
      v1Rank: v1Ranks.get(e.id) ?? null,
      ...modelRow(e),
    })),
    limited: run.pipeline.limited.slice(0, 60).map((e) => ({
      id: e.id, name: e.name, division: e.division,
      v1Rank: v1Ranks.get(e.id) ?? null,
      ...modelRow(e),
    })),
    review: {
      /**
       * Everything a standalone `pack-<id>.review.json` needs to prove which
       * model it was filled against, without carrying the pack with it. A
       * review detached from its provenance cannot be replayed, and replaying
       * it against the next model is the only reason to collect it.
       */
      meta: {
        packId,
        v2Commit: provenance.v2Commit,
        explanationCommit: provenance.explanationCommit,
        calibrationId: provenance.calibrationId,
        fixtureDigest: provenance.fixtureDigest,
        poolDigest: provenance.poolDigest,
        reviewer: null,
        startedAt: null,
        completedAt: null,
        /** Set true once View B has been read: after that this pack is no longer blind. */
        modelRevealed: false,
        questionAnswers: {},
        redFlagVerdicts: {},
        overall: { wouldSendThisList: null, changeFirst: '' },
      },
      rows: reviewTemplate,
    },
  };
}
