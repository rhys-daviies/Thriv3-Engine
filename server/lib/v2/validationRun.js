/**
 * Run one athlete and produce the packet a human reviews.
 *
 * READ-ONLY, ADOPTS NOTHING, CHANGES NO MODEL. The pipeline call here is the
 * same `runPursuit` every earlier phase used, with the same weights, the same
 * gates and the same calibration; a test proves the ranked list is deeply
 * equal to a run with no pack built at all.
 *
 * -- WHY THE V1 COMPARISON IS COMPUTED BUT WITHHELD ----------------------
 *
 * A7.7 §11 asks for the V1 rank AFTER the operator has classified. It is
 * computed here because it is cheap and because a pack generated without it
 * could never be compared later - but it appears only in view B, beside the V2
 * rank, and `programmeFacts` cannot reach it. Neither system's answer is in
 * the blind view.
 */
import crypto from 'node:crypto';
import { normaliseAthlete, rankMatches } from '../../../shared/matching/pool.js';
import { canonicalPosition } from '../../../shared/positions.js';
import {
  CALIBRATION_ID, NORMS_DIGEST, PLAYING_NORMS_DIGEST,
  PURSUIT_WEIGHTS, PURSUIT_GATES, WEIGHTING_ARCHITECTURE, TOP_N,
  RANKING_STATE,
  buildValidationAthlete, stratifiedSample, buildPack, PROFILES,
} from '../../../shared/matching/v2/index.js';
import { runPursuit } from './pursuitRun.js';

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** Pins the pack to the pool it saw. A roster re-import moves this and the review knows. */
export function poolDigest(colleges) {
  return digest(colleges.map((c) => [c.id, c.soccer_score, c.division, c.net_price]).sort());
}

/**
 * @param {object} args
 * @param {object} args.fixture    { id, player, recruitType? }
 * @param {string} args.profileId  a key of PROFILES
 * @param {object} args.ctx        the prepared pool context (see v2Pursuit.js)
 * @param {object} args.commits    { v2Commit, explanationCommit, v1FreezeCommit }
 * @param {string} args.rosterSeason
 */
export function buildValidationPack({ fixture, profileId, ctx, commits, rosterSeason, generatedAt }) {
  const profile = PROFILES[profileId];
  if (!profile) throw new Error(`validationRun: unknown profile ${JSON.stringify(profileId)}`);
  const sport = fixture.player.sport;
  const colleges = ctx.colleges;
  if (!colleges.length) throw new Error(`validationRun: no active ${sport} programmes in this database`);

  const position = canonicalPosition(fixture.player.position);
  const v1Shape = normaliseAthlete({ ...fixture.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete, inputs } = buildValidationAthlete({
    record: fixture.player, v1Shape, position, label: `${fixture.id} · ${profile.label}`,
    profile, recruitType: fixture.recruitType ?? null,
  });

  /**
   * The pack is named for what was actually used, not for what was asked for.
   *
   * A profile only supplies a preference the record does not already state,
   * so a REAL athlete who answered the intake questions keeps their own
   * answers even under the UNDECLARED profile - and calling that pack
   * "UNDECLARED" would describe a run that did not happen. Caught on the first
   * real-athlete run, where a record stating 4 and 2 produced a pack labelled
   * as though nobody had been asked.
   */
  const recordDeclared = profileId === 'UNDECLARED'
    && (inputs.competitiveLevelPriority !== null || inputs.playingOpportunityPriority !== null);
  const effectiveProfile = recordDeclared ? 'AS_STATED' : profileId;
  const packId = `${fixture.id.split('-')[0]}-${effectiveProfile}`;

  const run = runPursuit({ athlete, sport, colleges, ctx });

  // Frozen V1, for comparison only. Never used to calibrate or to order anything.
  const v1 = rankMatches({ athlete: v1Shape, colleges, rosterIndex: ctx.v1RosterIndex });
  const v1Ranks = new Map(v1.results.map((r, i) => [r.id, i + 1]));

  const sample = stratifiedSample({
    ranked: run.pipeline.ranked, limited: run.pipeline.limited, v1Ranks, topN: TOP_N, packId,
  });

  /**
   * The same athlete under each ambition profile, so §5 and §6 of the
   * validation questions can be answered from one pack rather than by asking
   * the operator to hold two documents side by side.
   */
  const ambitionSensitivity = new Map();
  const profileRuns = {};
  for (const key of ['UNDECLARED', 'LEVEL_FIRST', 'PLAYING_FIRST']) {
    const p = PROFILES[key];
    const alt = key === profileId ? run : runPursuit({
      athlete: {
        ...athlete,
        opportunity: {
          ...athlete.opportunity,
          competitiveLevelPriority: p.competitiveLevelPriority,
          playingOpportunityPriority: p.playingOpportunityPriority,
        },
      },
      sport, colleges, ctx,
    });
    profileRuns[key] = alt;
    for (const e of alt.pipeline.ranked) {
      const slot = ambitionSensitivity.get(e.id) ?? {};
      slot[key === 'UNDECLARED' ? 'undeclared' : key === 'LEVEL_FIRST' ? 'levelFirst' : 'playingFirst'] = e.rank;
      ambitionSensitivity.set(e.id, slot);
    }
  }
  const topIds = (r) => new Set(r.pipeline.actionable.map((x) => x.id));
  const jaccard = (a, b) => {
    const inter = [...a].filter((x) => b.has(x)).length;
    return Number((inter / (a.size + b.size - inter)).toFixed(4));
  };

  const provenance = {
    generatedAt,
    v2Commit: commits.v2Commit,
    explanationCommit: commits.explanationCommit,
    v1FreezeCommit: commits.v1FreezeCommit,
    calibrationId: CALIBRATION_ID,
    positionalNormsDigest: NORMS_DIGEST,
    playingNormsDigest: PLAYING_NORMS_DIGEST,
    weights: { ...PURSUIT_WEIGHTS },
    gates: JSON.parse(JSON.stringify(PURSUIT_GATES)),
    weightingArchitecture: WEIGHTING_ARCHITECTURE,
    topN: TOP_N,
    rosterSeason,
    fixtureId: fixture.id,
    fixtureValidationOnly: Boolean(fixture.validationOnly),
    profileId,
    effectiveProfile,
    preferenceProfile: inputs.preferenceProfile,
    fixtureDigest: digest({ player: fixture.player, profileId }),
    poolDigest: poolDigest(colleges),
  };

  const pack = buildPack({
    packId, provenance, athlete: inputs, run, v1Ranks, sample,
    collegesById: new Map(colleges.map((c) => [c.id, c])),
    ambitionSensitivity,
  });

  pack.whyThisAthlete = fixture.why;
  pack.athlete.notes = [
    fixture.validationOnly
      ? 'This athlete exists only for validation. They are not in any regression baseline.'
      : 'This athlete is one of the eight the frozen V1 baseline is pinned on.',
  ];

  pack.ambition = {
    profiles: Object.fromEntries(Object.entries(profileRuns).map(([k, r]) => [k, {
      label: PROFILES[k].label,
      ranked: r.counts.ranked,
      topComposition: r.topComposition,
      top25Composition: r.top25Composition,
      medianProgrammeStrengthTop100: (() => {
        const v = r.pipeline.actionable.map((x) => x.soccerScore).filter((x) => typeof x === 'number').sort((a, b) => a - b);
        return v.length ? Number(v[Math.floor(v.length / 2)].toFixed(1)) : null;
      })(),
      programmeStrengthCorrelation: r.programmeStrengthInfluence.pursuitPriority,
    }])),
    levelVsPlayingJaccard: jaccard(topIds(profileRuns.LEVEL_FIRST), topIds(profileRuns.PLAYING_FIRST)),
    undeclaredVsLevelJaccard: jaccard(topIds(profileRuns.UNDECLARED), topIds(profileRuns.LEVEL_FIRST)),
    undeclaredVsPlayingJaccard: jaccard(topIds(profileRuns.UNDECLARED), topIds(profileRuns.PLAYING_FIRST)),
  };

  /** V1 comparison, for §11. Never a score-to-score comparison: positions only. */
  const v1Top = new Set(v1.results.slice(0, TOP_N).map((r) => r.id));
  const v2Top = new Set(run.pipeline.actionable.map((r) => r.id));
  pack.v1Comparison = {
    comparesScores: false,
    note: 'Ranks only. A V1 weighted score and a V2 pursuit priority answer different questions and must never be differenced.',
    overlapTop100: [...v2Top].filter((id) => v1Top.has(id)).length,
    enteredTop100: [...v2Top].filter((id) => !v1Top.has(id)).length,
    leftTop100: [...v1Top].filter((id) => !v2Top.has(id)).length,
    v1Top100NowLimitedData: run.pipeline.limited.filter((r) => v1Top.has(r.id)).length,
    v1Top100NowLimitedDataExamples: run.pipeline.limited.filter((r) => v1Top.has(r.id)).slice(0, 5)
      .map((r) => ({ id: r.id, name: r.name, division: r.division, v1Rank: v1Ranks.get(r.id), missing: [...r.missingLayers] })),
    v1Top10: v1.results.slice(0, 10).map((r, i) => {
      const entry = run.pipeline.ranked.find((x) => x.id === r.id)
        ?? run.pipeline.limited.find((x) => x.id === r.id);
      return {
        v1Rank: i + 1, id: r.id, name: r.name, division: r.division,
        v2Rank: entry && entry.rankingState === RANKING_STATE.RANKED ? entry.rank : null,
        v2State: entry ? entry.rankingState : 'NOT EVALUATED',
      };
    }),
  };

  return { pack, run, v1Ranks, sample };
}
