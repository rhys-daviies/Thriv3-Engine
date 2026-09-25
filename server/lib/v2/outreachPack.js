/**
 * A7.13: build one athlete's OUTREACH-LIST review pack.
 *
 * READ-ONLY. It runs the same `runPursuit` every phase since A7.5 has run,
 * with the same weights, gates and calibration, and it changes nothing. The
 * pack is a rendering of what the model already said.
 *
 * -- VIEW B IS NOT BUILT HERE ---------------------------------------------
 *
 * Deliberately. A7.13 §10 requires View B not to exist until View A is
 * frozen, and the cheapest way to honour that is for the code that makes View
 * A to be incapable of making View B. Everything the reveal will need is
 * recoverable from the frozen inputs - the pool digest, the sample membership
 * and the athlete definition pin the run exactly - so nothing is lost by
 * refusing to compute it now. `buildOutreachReveal` is a later phase.
 *
 * -- THE BLIND VIEW IS BUILT FROM A WHITELIST -----------------------------
 *
 * `programmeFacts` is reused unchanged from A7.7, where it is already the
 * audited boundary: it names the fields a reviewer may see rather than
 * deleting the ones they may not. Deriving the blind view by deletion is how
 * a model answer leaks - one field added to the reveal, nobody updates the
 * deletion list, and the blind sheet quietly starts carrying the rank.
 */
import crypto from 'node:crypto';
import { normaliseAthlete } from '../../../shared/matching/pool.js';
import { canonicalPosition } from '../../../shared/positions.js';
import {
  CALIBRATION_ID, NORMS_DIGEST, PLAYING_NORMS_DIGEST,
  PURSUIT_WEIGHTS, PURSUIT_GATES, WEIGHTING_ARCHITECTURE, TOP_N,
  buildValidationAthlete, programmeFacts,
} from '../../../shared/matching/v2/index.js';
import { outreachSample } from '../../../shared/matching/v2/validation/outreachSample.js';
import {
  OUTREACH_PACK_FORMAT, PREREGISTERED_METRICS, METRIC_IDS,
  FIRST_100, ATHLETE_QUESTIONS, OUTREACH_CLASSIFICATION, outreachReviewRow,
} from '../../../shared/matching/v2/validation/outreachRubric.js';
import { runPursuit } from './pursuitRun.js';
import { buildValidationFacts } from './validationFacts.js';
import { academicPercentileScale } from './opportunityRun.js';

const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** Pins the pack to the pool it saw. A roster re-import moves this and the review knows. */
export function poolDigest(colleges) {
  return sha(colleges.map((c) => [c.id, c.soccer_score, c.division, c.net_price]).sort());
}

/**
 * The three preferences, read off the athlete record rather than a profile.
 *
 * A7.13 §1 requires every V3 athlete to be a shape production can persist,
 * and after 3056215 that means the answers live on the record. `PROFILES` is
 * not used here at all: a profile is a thing the harness supplies when the
 * record cannot, and the whole point of this phase is that it now can.
 */
function preferencesOf(player) {
  return {
    competitiveLevelPriority: player.competitive_level_priority ?? null,
    playingOpportunityPriority: player.playing_opportunity_priority ?? null,
    academicStrengthPriority: player.academic_strength_priority ?? null,
  };
}

/**
 * @param {object} args
 * @param {object} args.athlete   one entry of V3_ATHLETES
 * @param {object} args.ctx       a prepared pool context
 * @param {object} args.commits   { v2Commit, preferenceCommit, checkpointCommit }
 * @param {string} args.rosterSeason
 * @param {string} args.generatedAt
 */
export function buildOutreachPack({ athlete: def, ctx, commits, rosterSeason, generatedAt }) {
  const player = def.player;
  const sport = player.sport;
  const colleges = ctx.colleges;
  if (!colleges.length) throw new Error(`outreachPack: no active ${sport} programmes in this database`);

  const prefs = preferencesOf(player);
  for (const [k, v] of Object.entries(prefs)) {
    /**
     * REFUSED, not defaulted. A7.13 §1 forbids generating a pack from a
     * profile production cannot persist, and an undeclared preference is
     * exactly that shape - the pack would be labelled as though the athlete
     * had answered and the reviewer would be told they had.
     */
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new Error(`outreachPack: ${def.id} must state ${k} as 1-5, got ${JSON.stringify(v)}`);
    }
  }

  const position = canonicalPosition(player.position);
  const v1Shape = normaliseAthlete({ ...player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete, inputs } = buildValidationAthlete({
    record: player, v1Shape, position, label: def.id, profile: prefs,
  });

  const run = runPursuit({ athlete, sport, colleges, ctx });

  const packId = def.id;
  const sample = outreachSample({
    ranked: run.pipeline.ranked,
    limited: run.pipeline.limited,
    packId,
    equivalentStrength: inputs.equivalentProgrammeScore,
    eliteOversample: Boolean(def.eliteOversample),
    topN: TOP_N,
  });

  const factsById = buildValidationFacts({
    colleges, ctx, sport, position,
    entryYear: player.recruiting_class_year,
    athleteState: player.state ?? null,
    athleteIsInternational: v1Shape.origin === 'International',
    academicScale: academicPercentileScale(colleges),
  });
  const collegesById = new Map(colleges.map((c) => [c.id, c]));

  /**
   * View A. Facts only, in hashed order, numbered by that order - so the
   * number a reviewer writes against is the blind number and stays
   * attributable after the reveal without ever having carried the rank.
   */
  const viewA = sample.blindOrder.map((row, i) => ({
    reviewNo: i + 1,
    id: row.id,
    facts: programmeFacts(collegesById.get(row.id), factsById.get(row.id) ?? null),
  }));

  const provenance = {
    generatedAt,
    packFormat: OUTREACH_PACK_FORMAT,
    v2Commit: commits.v2Commit,
    preferenceCommit: commits.preferenceCommit,
    checkpointCommit: commits.checkpointCommit,
    calibrationId: CALIBRATION_ID,
    positionalNormsDigest: NORMS_DIGEST,
    playingNormsDigest: PLAYING_NORMS_DIGEST,
    weights: { ...PURSUIT_WEIGHTS },
    gates: JSON.parse(JSON.stringify(PURSUIT_GATES)),
    weightingArchitecture: WEIGHTING_ARCHITECTURE,
    topN: TOP_N,
    rosterSeason,
    athleteId: def.id,
    role: def.role,
    basedOn: def.basedOn,
    eliteOversample: Boolean(def.eliteOversample),
    contributionIsNewAnswer: Boolean(def.contributionIsNewAnswer),
  };

  /**
   * THE FREEZE. Four digests, each over one thing that must not move once a
   * human starts writing on the sheet.
   *
   * `sampleDigest` covers membership AND presentation order, because a
   * reshuffle that kept the same programmes would silently renumber every
   * answer already written down.
   */
  const digests = {
    athlete: sha(player),
    pool: poolDigest(colleges),
    sample: sha(sample.blindOrder.map((r) => r.id)),
    viewA: sha(viewA),
    metrics: sha(METRIC_IDS),
    /**
     * The seed the blind order actually used. Usually the pack id; a
     * re-seeded suffix where the first hash happened to track the ranking.
     * No RNG anywhere - the seed is derived, recorded, and reproducible.
     */
    orderingSeed: sample.orderingSeed,
    orderCorrelation: sample.orderCorrelation,
  };

  const pack = {
    formatVersion: OUTREACH_PACK_FORMAT,
    packId,
    generatedAt,
    provenance,
    digests,
    athlete: {
      ...inputs,
      role: def.role,
      basedOn: def.basedOn,
      contributionIsNewAnswer: Boolean(def.contributionIsNewAnswer),
      contributionState: player.contribution_state,
      maxAnnualContributionUsd: player.max_annual_contribution_usd,
    },
    /**
     * The shape of the universe this sample was drawn from. Counts only -
     * nothing here is about a particular programme, so it can sit beside the
     * blind view without telling the reviewer anything about a row.
     */
    universe: {
      poolSize: run.counts.evaluated,
      ranked: run.counts.ranked,
      limitedData: run.counts.limitedData,
      ineligible: run.counts.ineligible,
      suppressed: run.counts.suppressed,
    },
    sample: {
      size: sample.size,
      counts: sample.counts,
      composition: sample.composition,
      /**
       * Membership, SORTED, never in rank order.
       *
       * It was `sample.rows.map(...)` - which is the model's own ordering -
       * and the pack JSON sits in the same directory as the sheet Rhys reads.
       * Anybody opening it would have had the ranking, so the blind review
       * would have depended on nobody being curious. The rank order lives in
       * the sealed file and nowhere else; sorting still pins membership, and
       * `digests.sample` already pins the presentation order.
       */
      frozenMembership: sample.rows.map((r) => r.id).sort(),
    },
    viewA: { programmes: viewA },
    questionnaire: {
      classification: Object.keys(OUTREACH_CLASSIFICATION),
      first100: FIRST_100,
      athleteQuestions: ATHLETE_QUESTIONS,
    },
    metrics: { preregistered: PREREGISTERED_METRICS, ids: METRIC_IDS },
    review: {
      meta: {
        packId,
        v2Commit: commits.v2Commit,
        calibrationId: CALIBRATION_ID,
        athleteDigest: digests.athlete,
        poolDigest: digests.pool,
        sampleDigest: digests.sample,
        reviewer: null,
        startedAt: null,
        completedAt: null,
        modelRevealed: false,
        athleteAnswers: Object.fromEntries(ATHLETE_QUESTIONS.map((q) => [q.id, null])),
      },
      rows: viewA.map((v) => outreachReviewRow(v.reviewNo, v)),
    },
    /** Kept out of the pack on purpose. The reveal is a later phase. */
    viewB: null,
  };

  /**
   * The run and the sample travel BESIDE the pack, never inside it. A caller
   * that wants the model state has to take it deliberately; one that
   * serialises `pack` cannot get it by accident.
   */
  return { pack, run, sample };
}

/**
 * Everything the reveal will need, kept OUT of the pack file.
 *
 * Written to a separate sealed file so that the pack a human reads cannot
 * contain it even by accident, and so the reveal can be reconstructed exactly
 * rather than re-derived from a pool that may have moved.
 */
export function sealedModelState({ pack, run, sample }) {
  return {
    packId: pack.packId,
    sealedAt: pack.generatedAt,
    digests: pack.digests,
    note: 'SEALED. Do not open until View A is answered. Opening this file ends the blind review.',
    rows: sample.rows.map((r) => ({
      id: r.id,
      reviewNo: pack.viewA.programmes.find((v) => v.id === r.id)?.reviewNo ?? null,
      name: r.name,
      rank: r.rank,
      strata: r.strata,
      programmeStrength: r.programmeStrength,
      strengthDelta: r.strengthDelta,
    })),
    counts: run.counts,
  };
}
