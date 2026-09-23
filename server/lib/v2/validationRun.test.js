import { describe, it, expect } from 'vitest';
import { buildValidationPack, poolDigest } from './validationRun.js';
import { runPursuit } from './pursuitRun.js';
import { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } from './rosterEvidence.js';
import { buildRosterIndex, normaliseAthlete } from '../../../shared/matching/pool.js';
import {
  RANKING_STATE, FORBIDDEN_LANGUAGE, renderViewA, renderPack,
  CALIBRATION_ID, PURSUIT_WEIGHTS, PURSUIT_GATES,
} from '../../../shared/matching/v2/index.js';

const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];
const colleges = Array.from({ length: 200 }, (_, i) => ({
  id: `c${i}`, name: `College ${String(i).padStart(3, '0')}`,
  division: DIVISIONS[i % DIVISIONS.length], conference: `Conf ${i % 9}`,
  control: (i % 3 === 0) ? 1 : 2,
  net_price: i === 11 ? null : 6000 + ((i * 397) % 42000),
  tuition_in_state: 9000 + ((i * 97) % 6000), tuition_out_state: 21000 + ((i * 131) % 14000),
  city: 'Town', state: ['OH', 'CA', 'TX', 'NY'][i % 4],
  soccer_score: 20 + ((i * 11) % 78),
  academic_rating: i % 13 === 0 ? null : 3 + ((i * 7) % 60) / 10,
  sat_avg: i % 17 === 0 ? null : 1000 + ((i * 13) % 500),
  admit_rate: ((i * 23) % 90) / 100,
  national_ranking: i + 1, postseason_2025_round: null,
  recent_win_pct: ((i * 17) % 100) / 100, prior_win_pct: ((i * 29) % 100) / 100,
  notable_majors: '["Business","Kinesiology"]',
}));
const roster = colleges.filter((c) => c.division !== 'NJCAA').flatMap((c, i) =>
  Array.from({ length: 14 }, (_, j) => ({
    college_name: c.name, player_name: `p${i}-${j}`,
    position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
    class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.'][(i + j) % 5],
    division: c.division, season: '2026', minutes_played: null,
    projected_minutes: j % 3 === 0 ? 1200 : 100,
    games_started: null, projected_games_started: null,
    estimated_graduation_year: 2027 + ((i + j) % 3), eligibility_end_year: 2027 + ((i + j) % 3),
    country: (i + j) % 6 === 0 ? 'England' : 'USA',
  })));
const arrivals = colleges.flatMap((c, i) => Array.from({ length: 10 }, (_, j) => ({
  programme: c.name, sport: 'mens-soccer', arrival_season: '2026',
  canonical_position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
  is_international: (i + j) % 4 === 0 ? 1 : 0,
})));

const ctx = {
  colleges,
  roster,
  rosterProgrammes: new Set(roster.map((r) => r.college_name)),
  rosterIndex: buildPositionIndex(roster),
  v1RosterIndex: buildRosterIndex(roster),
  arrivalIndex: buildArrivalIndex(arrivals),
  divisionArrivals: divisionArrivalRates(arrivals, new Map(colleges.map((c) => [c.name, c]))),
  arrivalsHorizon: 2026,
};

const FIXTURE = {
  id: 'T-test-athlete',
  why: 'THE PATHOLOGY FIXTURE: an elite programme should fall a long way here.',
  player: {
    sport: 'mens-soccer', football_ability: 6, position: 'Midfielder',
    recruiting_class_year: 2028, gpa: 3.4, sat_score: 1200, act_score: null,
    budget_range: '$20k-$25k/yr', state: 'OH', city: 'Columbus',
    nationality: 'USA', origin: 'USA', academic_minimum: null,
    preferred_divisions: '[]', preferred_conferences: '[]',
    match_weights: null, criterion_ranking: null,
  },
};

const COMMITS = { v2Commit: 'aaa', explanationCommit: 'bbb', v1FreezeCommit: 'ccc' };
const build = (profileId = 'UNDECLARED') => buildValidationPack({
  fixture: FIXTURE, profileId, ctx, commits: COMMITS,
  rosterSeason: '2026', generatedAt: '2026-09-20T00:00:00.000Z',
});

/**
 * THE POINT OF A7.7: building a review pack must not change the thing being
 * reviewed. The model is compared against a run made with no pack in sight.
 */
describe('generating a pack changes no model output', () => {
  const athlete = {
    label: { id: 'T-test-athlete' },
    v1Shape: normaliseAthlete({ ...FIXTURE.player, preferred_divisions: '[]', preferred_conferences: '[]' }),
    recruitability: { sport: 'mens-soccer', rating: 6, position: 'MIDFIELD', entryYear: 2028, isInternational: false },
    opportunity: {
      sport: 'mens-soccer', position: 'MIDFIELD', rating: 6, intendedMajor: null,
      priorityRanking: null, competitiveLevelPriority: null, playingOpportunityPriority: null,
    },
  };
  const bare = runPursuit({ athlete, sport: 'mens-soccer', colleges, ctx });
  const { run } = build('UNDECLARED');

  const flatten = (rep) => rep.pipeline.ranked.map((e) => ({
    id: e.id, rank: e.rank, state: e.rankingState,
    priority: e.pursuitPriority.value, basis: e.pursuitPriority.basis,
    R: e.recruitability.value, F: e.financial.value, O: e.opportunity.value,
    grades: [e.recruitability.grade, e.financial.grade, e.opportunity.grade],
    coverage: [e.recruitability.coverage, e.financial.coverage, e.opportunity.coverage],
  }));

  it('produces a deeply equal ranked list', () => {
    expect(flatten(run)).toEqual(flatten(bare));
  });

  it('produces a deeply equal limited-data list, in the same order', () => {
    expect(run.pipeline.limited.map((e) => [e.id, e.missingLayers, e.order]))
      .toEqual(bare.pipeline.limited.map((e) => [e.id, e.missingLayers, e.order]));
  });

  it('produces the same counts and the same top 100', () => {
    expect(run.counts).toEqual(bare.counts);
    expect(run.pipeline.actionable.map((e) => e.id)).toEqual(bare.pipeline.actionable.map((e) => e.id));
  });

  it('is unchanged by building the pack twice', () => {
    expect(flatten(build('UNDECLARED').run)).toEqual(flatten(bare));
  });
});

describe('the undeclared profile is the control', () => {
  it('reproduces the run every earlier phase reported, because no fixture states a preference', () => {
    const { pack } = build('UNDECLARED');
    expect(pack.athlete.competitiveLevelPriority).toBeNull();
    expect(pack.athlete.playingOpportunityPriority).toBeNull();
    expect(pack.athlete.preferenceProfile).toBe('UNDECLARED');
  });

  it('records which profile the pack was generated under', () => {
    const { pack } = build('LEVEL_FIRST');
    expect(pack.provenance.profileId).toBe('LEVEL_FIRST');
    expect(pack.athlete.competitiveLevelPriority).toBe(5);
    expect(pack.athlete.playingOpportunityPriority).toBe(1);
  });

  it('refuses a profile it does not know rather than falling back to a default', () => {
    expect(() => build('WHATEVER')).toThrow(/unknown profile/);
  });
});

describe('provenance', () => {
  const { pack } = build();

  it('pins the pack to the exact model that produced it', () => {
    expect(pack.provenance.calibrationId).toBe(CALIBRATION_ID);
    expect(pack.provenance.weights).toEqual({ ...PURSUIT_WEIGHTS });
    expect(pack.provenance.gates).toEqual(JSON.parse(JSON.stringify(PURSUIT_GATES)));
    expect(pack.provenance.v1FreezeCommit).toBe('ccc');
    expect(pack.provenance.rosterSeason).toBe('2026');
  });

  it('pins it to the pool as well as the model, because a roster import moves the answers', () => {
    expect(pack.provenance.poolDigest).toBe(poolDigest(colleges));
    const moved = poolDigest(colleges.map((c, i) => (i === 0 ? { ...c, soccer_score: 1 } : c)));
    expect(moved).not.toBe(pack.provenance.poolDigest);
  });

  it('digests the athlete and the profile together, so the same person asked differently is a different pack', () => {
    expect(build('UNDECLARED').pack.provenance.fixtureDigest)
      .not.toBe(build('LEVEL_FIRST').pack.provenance.fixtureDigest);
  });
});

describe('a real athlete who answered the intake questions', () => {
  const declared = {
    ...FIXTURE, id: 'R-real-athlete',
    player: { ...FIXTURE.player, competitive_level_priority: 4, playing_opportunity_priority: 2 },
  };
  const { pack } = buildValidationPack({
    fixture: declared, profileId: 'UNDECLARED', ctx, commits: COMMITS,
    rosterSeason: '2026', generatedAt: '2026-09-20T00:00:00.000Z',
  });

  it('keeps their own answers rather than overwriting them with the profile', () => {
    expect(pack.athlete.competitiveLevelPriority).toBe(4);
    expect(pack.athlete.playingOpportunityPriority).toBe(2);
  });

  it('does not label the pack UNDECLARED when the athlete was in fact asked', () => {
    expect(pack.packId).toBe('R-AS_STATED');
    expect(pack.provenance.effectiveProfile).toBe('AS_STATED');
    expect(pack.provenance.profileId).toBe('UNDECLARED');
  });

  it('reports what the record did not carry instead of filling it in', () => {
    const fields = pack.athlete.missing.map((m) => m.field);
    expect(fields).toContain('act_score');
    for (const m of pack.athlete.missing) expect(m.consequence.length).toBeGreaterThan(10);
  });

  it('names the fields the product does not ask anybody', () => {
    expect(pack.athlete.notCollected.join(' ')).toMatch(/intended_major/);
    expect(pack.athlete.intendedMajor).toBeNull();
  });
});

describe('the review file', () => {
  const { pack } = build();

  it('carries everything a detached review needs to be replayed later', () => {
    for (const k of ['packId', 'v2Commit', 'explanationCommit', 'calibrationId',
      'fixtureDigest', 'poolDigest', 'reviewer', 'completedAt']) {
      expect(k in pack.review.meta).toBe(true);
    }
  });

  it('starts with the model unrevealed and every row empty', () => {
    expect(pack.review.meta.modelRevealed).toBe(false);
    expect(pack.review.rows.every((r) => r.classification === null)).toBe(true);
    expect(pack.review.rows).toHaveLength(pack.sample.size);
  });
});

describe('the ambition comparison', () => {
  const { pack } = build();

  it('runs the same athlete under all three profiles', () => {
    expect(Object.keys(pack.ambition.profiles)).toEqual(['UNDECLARED', 'LEVEL_FIRST', 'PLAYING_FIRST']);
  });

  it('reports overlap between the lists rather than a difference of scores', () => {
    expect(pack.ambition.levelVsPlayingJaccard).toBeGreaterThan(0);
    expect(pack.ambition.levelVsPlayingJaccard).toBeLessThanOrEqual(1);
  });

  it('gives each sampled ranked programme its rank under each profile', () => {
    const ranked = pack.viewB.programmes.filter((p) => p.model.rankingState === RANKING_STATE.RANKED);
    expect(ranked.every((p) => p.ambitionSensitivity && p.ambitionSensitivity.undeclared)).toBe(true);
  });
});

describe('the V1 comparison', () => {
  const { pack } = build();

  it('says out loud that it compares positions and not scores', () => {
    expect(pack.v1Comparison.comparesScores).toBe(false);
    expect(pack.v1Comparison.note).toMatch(/never be differenced/);
  });

  it('shows where V1\'s own top ten ended up, including the ones V2 will not score', () => {
    expect(pack.v1Comparison.v1Top10).toHaveLength(10);
    for (const r of pack.v1Comparison.v1Top10) {
      expect(r.v2Rank === null || typeof r.v2Rank === 'number').toBe(true);
    }
  });
});

describe('the generated document', () => {
  const { pack } = build();
  const md = renderPack(pack);
  const blind = renderViewA(pack);

  it('keeps the fixture\'s expected behaviour out of the blind half', () => {
    expect(blind).not.toContain('PATHOLOGY');
    expect(md).toContain('PATHOLOGY');
  });

  it('never names a V2 rank, a priority or a gate in the blind half', () => {
    expect(blind).not.toMatch(/priority \*\*/);
    expect(blind).not.toMatch(/V1 rank/);
    expect(blind).not.toMatch(/sampled as/);
  });

  it('uses none of the forbidden language anywhere', () => {
    const lower = md.toLowerCase();
    for (const phrase of FORBIDDEN_LANGUAGE) expect(lower).not.toContain(phrase);
  });

  it('never writes a missing figure as a number', () => {
    expect(blind).not.toMatch(/Infinity|NaN|undefined/);
    expect(blind).not.toMatch(/rating 0\.0/);
  });

  it('gives the operator between 35 and 50 programmes', () => {
    expect(pack.sample.size).toBeGreaterThanOrEqual(35);
    expect(pack.sample.size).toBeLessThanOrEqual(50);
  });
});
