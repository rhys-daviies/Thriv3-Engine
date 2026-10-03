/**
 * =============================================================================
 * THE SERVER-SIDE V2 SERVICE — A9.1.
 *
 * The service is an adapter around a frozen engine, so these tests are about
 * ADAPTATION, not scoring. The question in every one of them is whether the
 * product shape preserves an engine fact or quietly reshapes it.
 *
 * Full-universe parity against the A8.3 acceptance artifact needs the working
 * corpus and runs in the phase report, not here: vitest gives every suite a
 * `:memory:` database on purpose, and a test that could read the operator's
 * database is a test that could write it. What belongs in CI is the part that
 * holds over any universe.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool, SEASON } from './seedTestPool.js';
import {
  computeMatchmakingV2, clearContextCache, contextCacheState, poolContextFor,
  findProgrammeResult, topSlice, bandForRank, BAND, STATUS, MATCHER_VERSION,
  contributionReadiness, resultDigest,
} from './matchmakingService.js';
import { FREEZE_ENGINE_HEAD } from '../../../shared/matching/v2/freeze.js';

const created = [];

function athlete({ sport = 'mens-soccer', contribution = { contribution_state: 'STATED', max_annual_contribution_usd: 25000 }, ...extra } = {}) {
  const row = Player.create({
    full_name: `A9.1 ${created.length}`,
    sport,
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    ...contribution,
    ...extra,
  });
  created.push(row.id);
  return Player.get(row.id);
}

beforeAll(() => {
  seedPool('mens-soccer');
  seedPool('womens-soccer');
  clearContextCache();
});

afterAll(() => {
  for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

describe('A9.1 service: the full universe survives adaptation', () => {
  it('S1. every evaluated programme is returned, in exactly one state', () => {
    const r = computeMatchmakingV2(db, athlete());
    expect(r.programmes.length).toBe(r.counts.poolSize);
    expect(r.counts.ranked + r.counts.limitedData + r.counts.unsupported)
      .toBe(r.programmes.length);
    for (const p of r.programmes) {
      expect([STATUS.RANKED, STATUS.SUPPORTED_LIMITED_DATA, STATUS.UNSUPPORTED_ASSOCIATION])
        .toContain(p.status);
    }
  });

  it('S2. ranks are a dense 1..N and the ordering is the engine\'s', () => {
    const r = computeMatchmakingV2(db, athlete());
    const ranked = r.programmes.filter((p) => p.status === STATUS.RANKED);
    ranked.forEach((p, i) => expect(p.rank).toBe(i + 1));
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].pursuit).toBeGreaterThanOrEqual(ranked[i].pursuit);
    }
  });

  it('S3. the Top 100 is a prefix of the one ordering, and #101+ are retained', () => {
    const r = computeMatchmakingV2(db, athlete());
    const ranked = r.programmes.filter((p) => p.status === STATUS.RANKED);
    const top = topSlice(r);
    expect(top.every((p, i) => p.programmeId === ranked[i].programmeId)).toBe(true);
    /** Whatever the pool size, nothing ranked is dropped from the payload. */
    expect(ranked.length).toBe(r.counts.ranked);
  });

  it('S4. the same athlete over the same corpus produces identical engine facts', () => {
    const a = athlete();
    expect(resultDigest(computeMatchmakingV2(db, a)))
      .toBe(resultDigest(computeMatchmakingV2(db, a)));
  });

  it('S5. bands are presentation over the exact rank, and the rank stays', () => {
    expect(bandForRank(1)).toBe(BAND.PRIORITY_OUTREACH);
    expect(bandForRank(25)).toBe(BAND.PRIORITY_OUTREACH);
    expect(bandForRank(26)).toBe(BAND.STRONG_PURSUIT);
    expect(bandForRank(50)).toBe(BAND.STRONG_PURSUIT);
    expect(bandForRank(51)).toBe(BAND.VIABLE_CONSIDERATION);
    expect(bandForRank(100)).toBe(BAND.VIABLE_CONSIDERATION);
    expect(bandForRank(101)).toBe(BAND.BROADER_UNIVERSE);
    const r = computeMatchmakingV2(db, athlete());
    for (const p of r.programmes.filter((x) => x.status === STATUS.RANKED)) {
      expect(p.band).toBe(bandForRank(p.rank));
      expect(typeof p.rank).toBe('number');
    }
  });

  it('S6. a refusal carries no number at all — not even a zero', () => {
    const r = computeMatchmakingV2(db, athlete());
    for (const p of r.programmes) {
      for (const L of ['recruitability', 'financial', 'opportunity']) {
        if (p[L].state === 'UNSCOREABLE') {
          expect(p[L].value, `${p.name}/${L}`).toBeUndefined();
          expect(typeof p[L].reason).toBe('string');
        }
      }
      if (p.status !== STATUS.RANKED) {
        expect(p.rank).toBeUndefined();
        expect(p.pursuit).toBeUndefined();
      }
    }
  });

  it('S7. an unranked programme says which layers refused', () => {
    const r = computeMatchmakingV2(db, athlete());
    for (const p of r.programmes.filter((x) => x.status !== STATUS.RANKED)) {
      expect(Array.isArray(p.missingLayers)).toBe(true);
      const refused = ['recruitability', 'financial', 'opportunity']
        .filter((L) => p[L].state !== 'SCOREABLE').sort();
      expect(p.missingLayers).toEqual(refused);
    }
  });

  it('S8. the result is stamped with its matcher, freeze and corpus', () => {
    const r = computeMatchmakingV2(db, athlete());
    expect(r.matcherVersion).toBe(MATCHER_VERSION);
    expect(r.engineFreeze).toBe(FREEZE_ENGINE_HEAD);
    expect(r.corpusDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof r.computedAt).toBe('string');
  });
});

describe('A9.1 service: the contribution precondition', () => {
  it('C1. an unresolved contribution refuses rather than returning a pool of refusals', () => {
    const a = athlete({ contribution: { contribution_state: 'NEEDS_CONFIRMATION' } });
    expect(() => computeMatchmakingV2(db, a)).toThrowError(/resolved family contribution/i);
    try { computeMatchmakingV2(db, a); } catch (e) { expect(e.code).toBe('CONTRIBUTION_UNRESOLVED'); }
  });

  it('C2. STATED and NOT_A_CONSTRAINT are both ready', () => {
    for (const contribution of [
      { contribution_state: 'STATED', max_annual_contribution_usd: 10000 },
      { contribution_state: 'NOT_A_CONSTRAINT' },
    ]) {
      const r = computeMatchmakingV2(db, athlete({ contribution }));
      expect(r.counts.ranked).toBeGreaterThan(0);
    }
  });

  it('C3. readiness uses the engine\'s own predicate, so unresolved is never zero', () => {
    expect(contributionReadiness({ contribution_state: 'NEEDS_CONFIRMATION' }).resolved).toBe(false);
    expect(contributionReadiness({}).resolved).toBe(false);
    expect(contributionReadiness({ contribution_state: 'NOT_A_CONSTRAINT' }).resolved).toBe(true);
    expect(contributionReadiness({ budget_range: '$20k-$25k/yr' }).resolved).toBe(true);
  });
});

describe('A9.1 service: the pool-context cache', () => {
  it('K1. a second request for the same sport and corpus reuses the context', () => {
    clearContextCache();
    const first = poolContextFor(db, 'mens-soccer', { season: SEASON });
    expect(first.built).toBe(true);
    const second = poolContextFor(db, 'mens-soccer', { season: SEASON });
    expect(second.built).toBe(false);
    expect(second.ctx).toBe(first.ctx);
  });

  it('K2. men\'s and women\'s contexts cannot collide', () => {
    clearContextCache();
    const m = poolContextFor(db, 'mens-soccer', { season: SEASON });
    const w = poolContextFor(db, 'womens-soccer', { season: SEASON });
    expect(w.ctx).not.toBe(m.ctx);
    expect(contextCacheState().map((e) => e.sport).sort())
      .toEqual(['mens-soccer', 'womens-soccer']);
    /** And the men's entry is still the men's one afterwards. */
    expect(poolContextFor(db, 'mens-soccer', { season: SEASON }).ctx).toBe(m.ctx);
  });

  it('K3. a write to a scoring table rebuilds the context', () => {
    clearContextCache();
    const before = poolContextFor(db, 'mens-soccer', { season: SEASON });
    /** A scoring input: `colleges` is one of the three tables V2 reads. */
    const target = db.prepare("SELECT id FROM colleges WHERE sport='mens-soccer' AND active=1 LIMIT 1").pluck().get();
    db.prepare('UPDATE colleges SET soccer_score = COALESCE(soccer_score, 0) + 1 WHERE id = ?').run(target);
    const after = poolContextFor(db, 'mens-soccer', { season: SEASON });
    expect(after.ctx).not.toBe(before.ctx);
    expect(after.corpusDigest).not.toBe(before.corpusDigest);
  });

  it('K4. a write that touches nothing V2 reads keeps the context and the digest', () => {
    clearContextCache();
    const before = poolContextFor(db, 'mens-soccer', { season: SEASON });
    /**
     * The 7B case. `coaches` is not a V2 input, so the cheap change token
     * moves and the content digest does not - and the 939ms context survives.
     */
    db.prepare("INSERT INTO coaches (id, created_at, full_name) VALUES (?, '2026-01-01T00:00:00.000Z', 'A9.1 cache probe')")
      .run(`coach-a91-${Date.now()}`);
    const after = poolContextFor(db, 'mens-soccer', { season: SEASON });
    expect(after.ctx).toBe(before.ctx);
    expect(after.corpusDigest).toBe(before.corpusDigest);
    expect(after.built).toBe(false);
    expect(after.digestRecomputed).toBe(true);
  });
});

describe('A9.1 service: one ordering, reachable by programme', () => {
  it('L1. a programme is found by id with its full-universe rank and status', () => {
    const r = computeMatchmakingV2(db, athlete());
    const ranked = r.programmes.filter((p) => p.status === STATUS.RANKED);
    const deep = ranked[ranked.length - 1];
    const found = findProgrammeResult(r, deep.programmeId);
    expect(found.programmeId).toBe(deep.programmeId);
    expect(found.rank).toBe(deep.rank);
    expect(found.status).toBe(STATUS.RANKED);
    expect(findProgrammeResult(r, 'no-such-programme')).toBe(null);
  });
});
