import { describe, it, expect } from 'vitest';
import { buildPack, programmeFacts, PACK_FORMAT } from './pack.js';
import { renderPack, renderViewA } from './renderPack.js';
import { stratifiedSample } from './sample.js';
import { buildValidationAthlete, PROFILES } from './athleteInput.js';
import { RANKING_STATE, GRADE, scoreable, unscoreable, REASON } from '../types.js';
import { pursuitPriority } from '../layers/pursuit.js';
import { PURSUIT_WEIGHTS, PURSUIT_GATES } from '../pursuitRules.js';
import { AID_POLICY_STATUS } from '../aidPolicy.js';
import { FORBIDDEN_LANGUAGE } from '../explain/vocabulary.js';

const L = (v, basis, grade = GRADE.MEASURED) => scoreable({ value: v, grade, coverage: 1, basis });

const recruitability = (v = 0.55, delta = 0.05) => L(v, {
  athleticPlausibility: 0.8, athleticDelta: delta,
  athleticBasis: { rating: 8, athletePercentile: 0.89, programmePercentile: 0.89 - delta, delta },
  core: 0.5, coreBasis: { components: {}, missing: [], notApplicable: [] }, phi: 0.35, ceilingLoss: 0.1,
  positional: {
    position: 'MIDFIELD', typicalStarters: 5, vacatedStarters: 2, expectedNewcomerPlaces: 1.7,
    arrivals: 0, arrivalsKnown: true, arrivalsApplicable: true, arrivalsHorizon: 2026,
    claims: 0, claimsCapped: false, fillRate: 0.83, fillLevel: 'division',
    fillHits: 526, fillTrials: 637,
    contextOnly: { positionRows: 10, allOpenings: 3, eligibleToRemain: 6, unreadableRows: 0 },
  },
  international: null, internationalApplicable: false,
});

const financial = (v = 0.9) => L(v, {
  aidPolicy: AID_POLICY_STATUS.EQUIVALENCY, aidPolicyKnown: true, aidRule: 'NCAA D2',
  mayClaimNoAthleticAid: false, aidHeadroomFraction: 0.7, athleticAwardAssumed: 0,
  netPrice: 22000, costFloored: false, costBasis: 'NET_PRICE_PRIVATE',
  applicableCostRange: [22000, 22000], budgetRange: '$20k-$25k/yr', budgetIsLegacyBand: false,
  familyContributionRange: [20000, 25000], fundingGapRange: [0, 2000],
  viabilityRange: [0.8, 1], budgetCeilingUnstated: false,
  isInternational: false, internationalCostCaveat: null, outOfStatePremium: 0,
});

const opportunity = (v = 0.6) => L(v, {
  components: {}, missing: [], notApplicable: ['locationFit'],
  objectiveScored: 2, objectiveValue: v, preferencesDeclared: 0, preferenceValue: null,
  preferenceKnown: false, priorities: { applied: false, multipliers: {}, ignored: [], ranking: null },
  ambition: { competitiveLevelPriority: null, playingOpportunityPriority: null, multipliers: {}, declared: false },
  playing: { playingShare: 0.68, seasons: 4, level: 'programme', scaleP10: 0.42, scaleMedian: 0.59, scaleP90: 0.76, measure: 'x' },
  trajectory: { recentWinPct: 0.6, priorWinPct: 0.5, change: 0.1, saturation: 0.3, direction: 'improving' },
  major: null, outcome: null,
});

function makeRun(n = 160) {
  const ranked = [];
  const limited = [];
  for (let i = 0; i < n; i += 1) {
    const R = recruitability(0.9 - (i * 0.005), 0.3 - (i * 0.004));
    const F = financial(1 - (i * 0.004));
    const O = opportunity(0.9 - (i * 0.004));
    ranked.push({
      id: `p${i + 1}`, name: `Programme ${String(i + 1).padStart(3, '0')}`,
      division: ['NCAA D1', 'NCAA D2', 'NCAA D3'][i % 3], soccerScore: 95 - (i * 0.4),
      recruitability: R, financial: F, opportunity: O,
      rankingState: RANKING_STATE.RANKED,
      pursuitPriority: pursuitPriority({ recruitability: R, financial: F, opportunity: O }),
      rank: i + 1,
    });
  }
  for (let i = 0; i < 8; i += 1) {
    limited.push({
      id: `l${i + 1}`, name: `Limited ${i + 1}`, division: 'NJCAA', soccerScore: 30,
      recruitability: unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'], available: [], coverage: 0 }),
      financial: financial(0.8), opportunity: opportunity(0.5),
      rankingState: RANKING_STATE.LIMITED_DATA, pursuitPriority: null,
      missingLayers: ['recruitability'],
      layerReasons: { recruitability: REASON.NO_ROSTER_ON_FILE },
      order: { layersKnown: 2, coverage: 0.6, bestEvidencedValue: 0.8 },
    });
  }
  return {
    pipeline: { ranked, limited, actionable: ranked.slice(0, 100), counts: { evaluated: n + 8, ranked: n, limitedData: 8, ineligible: 0, suppressed: 0, actionable: 100 } },
    counts: { evaluated: n + 8, ranked: n, limitedData: 8, ineligible: 0, suppressed: 0, actionable: 100 },
    pursuitPriority: { n, median: 0.31, p10: 0.1, p25: 0.2, p75: 0.5, p90: 0.7, max: 0.8, min: 0.05, mean: 0.35 },
    compression: { below005: 0, above090: 0 },
    layers: {}, gateFiringRate: { recruitability: 0.1, financial: 0.05 },
    programmeStrengthInfluence: { n, pursuitPriority: -0.4, recruitability: -0.5, financial: -0.2, opportunity: -0.1 },
    topComposition: { 'NCAA D1': 34, 'NCAA D2': 33, 'NCAA D3': 33 },
    top25Composition: { 'NCAA D1': 9, 'NCAA D2': 8, 'NCAA D3': 8 },
    limitedComposition: { NJCAA: 8 }, limitedReasons: { recruitability: 8 },
  };
}

const RECORD = {
  sport: 'mens-soccer', football_ability: 8, position: 'Midfielder',
  recruiting_class_year: 2028, gpa: 3.4, sat_score: 1200, act_score: null,
  budget_range: '$20k-$25k/yr', state: 'OH', city: 'Columbus',
  nationality: 'USA', origin: 'USA',
};
const V1_SHAPE = { origin: 'USA', divisions: [], conferences: [], criterionRanking: null };

function makePack({ profileId = 'UNDECLARED', colleges } = {}) {
  const run = makeRun();
  const all = [...run.pipeline.ranked, ...run.pipeline.limited];
  const v1Ranks = new Map(all.map((r, i) => [r.id, ((i * 53) % all.length) + 1]));
  const sample = stratifiedSample({ ranked: run.pipeline.ranked, limited: run.pipeline.limited, v1Ranks, topN: 100, packId: 'T' });
  const { inputs } = buildValidationAthlete({
    record: RECORD, v1Shape: V1_SHAPE, position: 'MIDFIELD',
    profile: PROFILES[profileId], label: 'T-test athlete',
  });
  const collegesById = new Map(all.map((r) => [r.id, colleges ? colleges(r) : {
    id: r.id, name: r.name, division: r.division, conference: 'Test Conf',
    city: 'Town', state: 'OH', control: 1, soccer_score: r.soccerScore,
    net_price: 21000, tuition_in_state: 12000, tuition_out_state: 26000,
    academic_rating: 6.2, sat_avg: 1180, admit_rate: 0.62,
    recent_win_pct: 0.55, prior_win_pct: 0.5, national_ranking: 120,
    postseason_2025_round: null, notable_majors: null,
  }]));
  const pack = buildPack({
    packId: 'T', provenance: {
      generatedAt: '2026-09-20T00:00:00.000Z', v2Commit: 'abc', explanationCommit: 'abc',
      v1FreezeCommit: 'def', calibrationId: 'cal-1', positionalNormsDigest: 'n1', playingNormsDigest: 'n2',
      weights: PURSUIT_WEIGHTS, gates: PURSUIT_GATES, weightingArchitecture: 'global',
      rosterSeason: '2026', fixtureDigest: 'fd', poolDigest: 'pd',
    },
    athlete: inputs, run, v1Ranks, sample, collegesById,
    ambitionSensitivity: new Map(all.map((r) => [r.id, { undeclared: r.rank ?? null, levelFirst: r.rank ?? null, playingFirst: r.rank ?? null }])),
  });
  pack.ambition = {
    profiles: {
      UNDECLARED: { label: 'neither declared', topComposition: { 'NCAA D1': 34 }, medianProgrammeStrengthTop100: 75.2, programmeStrengthCorrelation: -0.4 },
      LEVEL_FIRST: { label: 'level 5', topComposition: { 'NCAA D1': 51 }, medianProgrammeStrengthTop100: 81.0, programmeStrengthCorrelation: -0.2 },
      PLAYING_FIRST: { label: 'playing 5', topComposition: { 'NCAA D3': 60 }, medianProgrammeStrengthTop100: 62.4, programmeStrengthCorrelation: -0.6 },
    },
    levelVsPlayingJaccard: 0.55, undeclaredVsLevelJaccard: 0.7, undeclaredVsPlayingJaccard: 0.72,
  };
  pack.v1Comparison = {
    comparesScores: false, note: 'Ranks only.',
    overlapTop100: 51, enteredTop100: 49, leftTop100: 49,
    v1Top100NowLimitedData: 4, v1Top100NowLimitedDataExamples: [],
    v1Top10: [{ v1Rank: 1, name: 'Programme 002', division: 'NCAA D2', v2Rank: 2, v2State: 'RANKED' }],
  };
  return pack;
}

describe('the packet', () => {
  const pack = makePack();

  it('states its format so a later reader knows what it is holding', () => {
    expect(pack.formatVersion).toBe(PACK_FORMAT);
  });

  it('carries every provenance field the review must be pinned to', () => {
    for (const k of ['v2Commit', 'explanationCommit', 'v1FreezeCommit', 'calibrationId',
      'positionalNormsDigest', 'playingNormsDigest', 'weights', 'gates', 'rosterSeason',
      'fixtureDigest', 'poolDigest']) {
      expect(pack.provenance[k]).toBeDefined();
    }
  });

  it('gives every sampled programme a review row, empty', () => {
    expect(pack.review.rows).toHaveLength(pack.sample.size);
    for (const r of pack.review.rows) {
      expect(r.classification).toBeNull();
      expect(r.reasonTags).toEqual([]);
    }
  });

  it('numbers view A and view B the same way, so a blind answer survives the reveal', () => {
    const a = new Map(pack.viewA.programmes.map((p) => [p.id, p.reviewNo]));
    for (const p of pack.viewB.programmes) expect(p.reviewNo).toBe(a.get(p.id));
  });

  it('orders view B by rank and view A by neither', () => {
    const ranks = pack.viewB.programmes.map((p) => p.rank ?? Infinity);
    expect([...ranks]).toEqual([...ranks].sort((x, y) => x - y));
    expect(pack.viewA.programmes.map((p) => p.id)).not.toEqual(pack.viewB.programmes.map((p) => p.id));
  });

  it('never gives a limited-data programme a standing or a priority', () => {
    for (const p of pack.viewB.programmes) {
      if (p.model.rankingState === RANKING_STATE.LIMITED_DATA) {
        expect(p.standing).toBeNull();
        expect(p.model.pursuitPriority).toBeNull();
        expect(p.rank).toBeNull();
      }
    }
  });

  it('carries the explanation as codes as well as sentences', () => {
    const p = pack.viewB.programmes[0];
    expect(p.explanation.codes.length).toBeGreaterThan(0);
    expect(p.explanation.lines.length).toBeGreaterThan(0);
  });

  it('never compares a V1 score with a V2 priority', () => {
    for (const p of pack.viewB.programmes) expect(p.movement.comparesScores).toBe(false);
  });
});

describe('the blind view leaks nothing', () => {
  const pack = makePack();
  const blindFields = pack.viewA.programmes.flatMap((p) => Object.keys(p.facts ?? {}));

  it('carries no model output on any programme', () => {
    for (const forbidden of ['rank', 'pursuitPriority', 'recruitability', 'financial',
      'opportunity', 'gate', 'standing', 'explanation', 'v1Rank', 'strata', 'movement']) {
      expect(blindFields).not.toContain(forbidden);
    }
  });

  it('builds view A from its own whitelist rather than by deleting from view B', () => {
    // Proven by construction: a field added to the reveal must not appear in
    // the blind view without someone adding it to programmeFacts.
    const facts = programmeFacts({ name: 'X', division: 'NCAA D1', soccer_score: 80, secret_model_field: 1 });
    expect('secret_model_field' in facts).toBe(false);
  });

  it('keeps every model number out of the rendered blind half', () => {
    const viewA = renderViewA(pack);
    expect(viewA).not.toMatch(/pursuit priority/i);
    expect(viewA).not.toMatch(/V1 rank/i);
    expect(viewA).not.toMatch(/\bgate\b/i);
    expect(viewA).not.toMatch(/sampled as/i);
    expect(viewA).not.toMatch(/Explanation as the operator/i);
    for (const p of pack.viewB.programmes.slice(0, 5)) {
      for (const line of p.explanation.lines) expect(viewA).not.toContain(line);
    }
  });

  it('keeps the fixture\'s own purpose out of the blind half', () => {
    const withWhy = makePack();
    withWhy.whyThisAthlete = 'THE PATHOLOGY FIXTURE: an elite programme should fall here.';
    const rendered = renderPack(withWhy);
    expect(renderViewA(withWhy)).not.toContain('PATHOLOGY');
    expect(rendered).toContain('PATHOLOGY');
  });

  it('shows programme strength, deliberately, because the question is otherwise unanswerable', () => {
    expect(renderViewA(pack)).toMatch(/Programme strength/);
  });
});

describe('the rendered pack', () => {
  const pack = makePack();
  const md = renderPack(pack);

  it('puts the divider between the two halves exactly once', () => {
    expect(md.split('\n# STOP\n')).toHaveLength(2);
  });

  it('gives the operator somewhere to write on every sampled programme', () => {
    expect((md.match(/PURSUE STRONGLY/g) ?? []).length).toBeGreaterThanOrEqual(pack.sample.size);
    expect((md.match(/Misleading claim/g) ?? []).length).toBe(pack.sample.size);
  });

  it('asks all thirteen questions and lists every red flag', () => {
    for (let i = 1; i <= 13; i += 1) expect(md).toContain(`**Q${i}.**`);
    expect(md).toContain('UNRECRUITABLE_IN_TOP_25');
  });

  it('never prints a missing number as zero', () => {
    // Number(null) === 0 was live in the first generated pack: a school with
    // no College Scorecard match rendered as "rating 0.0", which reads as the
    // worst academics in the country rather than as no record.
    const sparse = makePack({
      colleges: (r) => ({
        id: r.id, name: r.name, division: r.division, conference: null,
        city: null, state: null, control: null, soccer_score: null,
        net_price: null, tuition_in_state: null, tuition_out_state: null,
        academic_rating: null, sat_avg: null, admit_rate: null,
        recent_win_pct: null, prior_win_pct: null, national_ranking: null,
        postseason_2025_round: null, notable_majors: null,
      }),
    });
    // Checked on the BLIND half, where a fabricated zero would be read as a
    // fact about the school rather than as a model output.
    const blind = renderViewA(sparse);
    expect(blind).not.toMatch(/rating 0\.0/);
    expect(blind).not.toMatch(/\$0\b/);
    expect(blind).not.toMatch(/win rate 0%/);
    expect(blind).not.toMatch(/admit rate 0%/);
    expect(blind).not.toMatch(/Programme strength 0/);
    expect(blind).toMatch(/not rated/);
  });

  it('never prints an unbounded budget as infinity', () => {
    expect(md).not.toMatch(/Infinity|NaN|undefined|\bnull\b/);
  });

  it('uses none of the language the explanations are forbidden', () => {
    const lower = md.toLowerCase();
    for (const phrase of FORBIDDEN_LANGUAGE) expect(lower).not.toContain(phrase);
  });

  it('says the ambition comparison is a comparison of lists, not of scores', () => {
    expect(md).toMatch(/Jaccard of 1\.0 would mean declaring an ambition changed nothing/);
  });
});
