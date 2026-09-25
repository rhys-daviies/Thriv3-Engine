/**
 * A7.13 §18 — validate the validator.
 *
 * The blind audit is the thing standing between a leaked rank and a spoiled
 * review, and a review can only be spoiled once. So it is tested two ways:
 * that it PASSES a real pack, and that it FAILS a pack somebody has broken -
 * an audit nobody has watched fail is an audit nobody knows works.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../db/client.js';
import { seedPool, SEASON } from './seedTestPool.js';
import { buildPoolContext } from './poolContext.js';
import { buildOutreachPack, sealedModelState } from './outreachPack.js';
import { auditBlindPack } from './blindAudit.js';
import { renderOutreachViewA } from '../../../shared/matching/v2/validation/renderOutreach.js';
import { METRIC_IDS, PREREGISTERED_METRICS, FIRST_100, ATHLETE_QUESTIONS } from '../../../shared/matching/v2/validation/outreachRubric.js';
import { V3_ATHLETES, v3Athlete } from '../../scripts/v3Athletes.js';

const COMMITS = { v2Commit: '711af51', preferenceCommit: '3056215', checkpointCommit: '2ded421' };
let ctx;
let built;
let markdown;

beforeAll(() => {
  // Big enough to have a real tail beyond the hundred, plus programmes with
  // no roster at all so the LIMITED_DATA half of the sheet is exercised.
  seedPool('mens-soccer', { count: 150, unscoreable: 12 });
  ctx = buildPoolContext({ db, sport: 'mens-soccer', season: SEASON });
  built = buildOutreachPack({
    athlete: v3Athlete('A'), ctx, commits: COMMITS, rosterSeason: SEASON,
    generatedAt: '2026-09-25T00:00:00.000Z',
  });
  markdown = renderOutreachViewA(built.pack);
});

afterAll(() => {
  db.prepare("DELETE FROM colleges WHERE name LIKE 'Seed %'").run();
  db.prepare("DELETE FROM roster_players WHERE college_name LIKE 'Seed %'").run();
});

const audit = () => auditBlindPack({ pack: built.pack, markdown, ctx, sample: built.sample });

describe('the athlete definitions', () => {
  it('states all three preferences on every V3 athlete', () => {
    for (const a of V3_ATHLETES) {
      for (const f of ['competitive_level_priority', 'playing_opportunity_priority', 'academic_strength_priority']) {
        const v = a.player[f];
        expect(Number.isInteger(v) && v >= 1 && v <= 5, `${a.id} ${f} = ${v}`).toBe(true);
      }
    }
  });

  it('states an exact family contribution on every V3 athlete, never a band', () => {
    for (const a of V3_ATHLETES) {
      expect(a.player.contribution_state, a.id).toBe('STATED');
      expect(Number.isFinite(a.player.max_annual_contribution_usd), a.id).toBe(true);
      expect(a.player.budget_range, a.id).toBeNull();
    }
  });

  it('covers the six roles the brief asks for', () => {
    expect(V3_ATHLETES.map((a) => a.role)).toEqual([
      'ELITE / LEVEL-FOCUSED', 'ELITE / BALANCED', 'STRONG / PLAYING-FOCUSED',
      'DEVELOPMENTAL / BALANCED', 'ACADEMIC-PRIORITY', 'FINANCIALLY CONSTRAINED',
    ]);
  });

  it('says where a stated contribution is a new answer rather than a conversion', () => {
    // The two $40k+ athletes convert exactly; the bounded bands do not, and
    // claiming they did would invent the family's maximum.
    const converted = V3_ATHLETES.filter((a) => !a.contributionIsNewAnswer);
    expect(converted.every((a) => a.player.max_annual_contribution_usd === 40000)).toBe(true);
  });
});

describe('the pack refuses a shape production cannot persist', () => {
  it('throws on an undeclared preference', () => {
    const broken = { ...v3Athlete('A'), player: { ...v3Athlete('A').player, competitive_level_priority: null } };
    expect(() => buildOutreachPack({
      athlete: broken, ctx, commits: COMMITS, rosterSeason: SEASON, generatedAt: 'x',
    })).toThrow(/competitiveLevelPriority/);
  });

  it('throws on an out-of-range preference', () => {
    const broken = { ...v3Athlete('A'), player: { ...v3Athlete('A').player, academic_strength_priority: 7 } };
    expect(() => buildOutreachPack({
      athlete: broken, ctx, commits: COMMITS, rosterSeason: SEASON, generatedAt: 'x',
    })).toThrow(/academicStrengthPriority/);
  });
});

describe('the pack is blind', () => {
  it('passes every audit check', () => {
    const a = audit();
    expect(a.failures.map((f) => `${f.name}: ${f.detail}`)).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.checks.length).toBeGreaterThanOrEqual(20);
  });

  it('carries no view B at all', () => {
    expect(built.pack.viewB).toBeNull();
    expect(JSON.stringify(built.pack)).not.toContain('"viewB":{');
  });

  it('refuses to render a pack that has grown a view B', () => {
    expect(() => renderOutreachViewA({ ...built.pack, viewB: { programmes: [] } }))
      .toThrow(/no longer blind/);
  });

  it('never prints a rank, a priority or a layer value', () => {
    expect(markdown).not.toMatch(/\brank(ed|ing)? *#? *\d+/i);
    expect(markdown).not.toMatch(/pursuit/i);
    expect(markdown).not.toMatch(/\bgate\b/i);
  });

  it('keeps every review row unanswered', () => {
    expect(built.pack.review.rows.every((r) => r.classification === null)).toBe(true);
    expect(built.pack.review.rows.every((r) => r.first100 === null)).toBe(true);
    expect(Object.values(built.pack.review.meta.athleteAnswers).every((v) => v === null)).toBe(true);
  });
});

/**
 * THE AUDIT MUST FAIL WHEN IT SHOULD.
 *
 * Each of these breaks the pack in a way a careless change could, and
 * asserts the audit notices. Without them the audit's 26 passes would be
 * evidence of nothing.
 */
describe('the audit catches a broken pack', () => {
  const broken = (mutate) => {
    const pack = JSON.parse(JSON.stringify(built.pack));
    const md = mutate(pack) ?? markdown;
    return auditBlindPack({ pack, markdown: md, ctx, sample: built.sample });
  };

  it('catches a rank smuggled into a fact block', () => {
    const a = broken((p) => { p.viewA.programmes[0].facts.rank = 7; });
    expect(a.ok).toBe(false);
    expect(a.failures.map((f) => f.name)).toContain('view A JSON carries no model-output key');
  });

  it('catches a layer value smuggled into a fact block', () => {
    const a = broken((p) => { p.viewA.programmes[0].facts.recruitability = 0.82; });
    expect(a.ok).toBe(false);
  });

  it('catches a layer grade outside evidenceState', () => {
    const a = broken((p) => { p.viewA.programmes[0].facts.academic.standing = 'MEASURED'; });
    expect(a.ok).toBe(false);
    expect(a.failures.map((f) => f.name)).toContain('no layer grade appears outside evidenceState');
  });

  it('allows the evidence state that A7.7.6 added on purpose', () => {
    const states = built.pack.viewA.programmes
      .map((p) => p.facts?.roster?.evidenceState).filter(Boolean);
    expect(states.length).toBeGreaterThan(0);
    expect(audit().ok).toBe(true);
  });

  it('catches a stratum name reaching the sheet', () => {
    const a = broken(() => `${markdown}\n\nsampled as: TOP_1_10`);
    expect(a.ok).toBe(false);
    expect(a.failures.map((f) => f.name)).toContain('no rank band or stratum name appears');
  });

  it('catches explanation prose reaching the sheet', () => {
    const a = broken(() => `${markdown}\n\nThis programme would recruit this athlete.`);
    expect(a.ok).toBe(false);
  });

  it('catches a duplicated programme', () => {
    const a = broken((p) => { p.viewA.programmes.push({ ...p.viewA.programmes[0], reviewNo: 999 }); });
    expect(a.ok).toBe(false);
    expect(a.failures.map((f) => f.name)).toContain('no duplicate programme id');
  });

  it('catches a programme that is not in this athlete\'s pool', () => {
    const a = broken((p) => {
      p.viewA.programmes[0].id = 'not-a-real-college';
    });
    expect(a.ok).toBe(false);
  });

  it('catches a renamed programme', () => {
    const a = broken((p) => { p.viewA.programmes[0].facts.name = 'Somewhere Else'; });
    expect(a.ok).toBe(false);
    expect(a.failures.map((f) => f.name)).toContain('every programme name matches its college row');
  });

  it('catches an answered row', () => {
    const a = broken((p) => { p.review.rows[0].classification = 'PURSUE'; });
    expect(a.ok).toBe(false);
    expect(a.failures.map((f) => f.name)).toContain('every review row is unanswered');
  });

  it('catches a metric added after the fact', () => {
    const a = broken((p) => { p.metrics.ids = [...p.metrics.ids, 'inventedLater']; });
    expect(a.ok).toBe(false);
    expect(a.failures.map((f) => f.name)).toContain('metrics were pre-registered before any answer');
  });

  it('catches a page order that tracks the ranking', () => {
    const a = broken((p) => {
      // Re-order the sheet into the model's own order.
      const rank = new Map(built.sample.rows.map((r, i) => [r.id, i]));
      p.viewA.programmes.sort((x, y) => rank.get(x.id) - rank.get(y.id));
      p.viewA.programmes.forEach((x, i) => { x.reviewNo = i + 1; });
    });
    expect(a.ok).toBe(false);
    expect(a.failures.map((f) => f.name)).toContain('page order does not track model order');
  });
});

describe('the freeze', () => {
  it('produces the same pack twice', () => {
    const again = buildOutreachPack({
      athlete: v3Athlete('A'), ctx, commits: COMMITS, rosterSeason: SEASON,
      generatedAt: '2026-09-25T00:00:00.000Z',
    });
    expect(again.pack.digests).toEqual(built.pack.digests);
    expect(again.pack.viewA.programmes.map((p) => p.id))
      .toEqual(built.pack.viewA.programmes.map((p) => p.id));
    expect(renderOutreachViewA(again.pack)).toBe(markdown);
  });

  it('does not carry the model ordering anywhere in the pack', () => {
    const sorted = [...built.pack.sample.frozenMembership].sort();
    expect(built.pack.sample.frozenMembership).toEqual(sorted);
    const modelOrder = built.sample.rows.map((r) => r.id);
    expect(built.pack.sample.frozenMembership).not.toEqual(modelOrder);
  });

  it('pins the athlete, the pool, the sample, the sheet and the metrics', () => {
    for (const k of ['athlete', 'pool', 'sample', 'viewA', 'metrics', 'orderingSeed']) {
      expect(built.pack.digests[k], k).toBeTruthy();
    }
  });

  it('moves the sample digest if the order moves', () => {
    const a = built.pack.digests.sample;
    const other = buildOutreachPack({
      athlete: v3Athlete('B'), ctx, commits: COMMITS, rosterSeason: SEASON, generatedAt: 'x',
    });
    expect(other.pack.digests.sample).not.toBe(a);
  });
});

describe('the questionnaire', () => {
  it('asks the classification and the first-100 question, and nothing else per programme', () => {
    expect(built.pack.questionnaire.first100.answers).toEqual(['YES', 'NO', 'UNSURE']);
    expect(built.pack.questionnaire.classification).toContain('INSUFFICIENT_INFORMATION');
    expect(Object.keys(built.pack.review.rows[0]).sort())
      .toEqual(['classification', 'first100', 'notes', 'programmeId', 'programmeName', 'reviewNo', 'reviewedAt']);
  });

  it('asks three athlete-level questions, one of them free text', () => {
    expect(ATHLETE_QUESTIONS).toHaveLength(3);
    expect(ATHLETE_QUESTIONS.filter((q) => q.freeText)).toHaveLength(1);
  });

  it('renders an answer template under every programme', () => {
    const blocks = (markdown.match(/^### \d+\. /gm) ?? []).length;
    expect(blocks).toBe(built.pack.viewA.programmes.length);
    const firstHundred = markdown.split('First-100 outreach?').length - 1;
    expect(firstHundred).toBe(built.pack.viewA.programmes.length);
  });

  it('never asks for a rank', () => {
    expect(markdown).toMatch(/Do not try to guess a rank/);
    expect(FIRST_100.question).not.toMatch(/what rank/i);
  });

  it('tells the reviewer that insufficient information is a real answer', () => {
    expect(markdown).toMatch(/not a mild answer/);
  });
});

describe('the pre-registered metrics', () => {
  it('are frozen into the pack before any answer exists', () => {
    expect(built.pack.metrics.ids).toEqual(METRIC_IDS);
    expect(built.pack.metrics.preregistered).toEqual(PREREGISTERED_METRICS);
  });

  it('name exactly one primary metric, and it is the elite comparison', () => {
    const primary = PREREGISTERED_METRICS.filter((m) => m.primary === true);
    expect(primary).toHaveLength(1);
    expect(primary[0].id).toBe('eliteRelativeDistribution');
  });

  it('do not lead with Kendall tau', () => {
    expect(PREREGISTERED_METRICS.find((m) => m.id === 'kendallTauB').primary).toBe(false);
  });

  it('every metric states what it counts and over which rows', () => {
    for (const m of PREREGISTERED_METRICS) {
      expect(m.statement.length, m.id).toBeGreaterThan(25);
      expect(m.over, m.id).toBeTruthy();
    }
  });
});

describe('the sealed model state', () => {
  it('is a separate object the pack does not contain', () => {
    const sealed = sealedModelState(built);
    expect(sealed.rows.length).toBe(built.pack.viewA.programmes.length);
    expect(sealed.rows.every((r) => Number.isFinite(r.reviewNo))).toBe(true);
    expect(JSON.stringify(built.pack)).not.toContain('sealedAt');
  });

  it('says what opening it costs', () => {
    expect(sealedModelState(built).note).toMatch(/ends the blind review/i);
  });
});
