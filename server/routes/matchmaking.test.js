/**
 * =============================================================================
 * THE V2 MATCHMAKING API DOORWAY — A9.1.
 *
 * Route tests over real HTTP, because the properties under test are boundary
 * properties: who may ask, what a refusal looks like from outside, and what
 * leaves the building. A service can be correct while a route hands a client
 * something it should never have seen - a stack trace, a SQL fragment, a
 * coach's email - and none of that is visible from inside the library.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import { matchmakingRouter } from './matchmaking.js';
import { requireOperator } from '../lib/operatorAuth.js';
import { seedPool } from '../lib/v2/seedTestPool.js';
import { clearContextCache, STATUS } from '../lib/v2/matchmakingService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const created = [];
let baseUrl;
let guardedUrl;

function athlete(extra = {}) {
  const row = Player.create({
    full_name: `A9.1 API ${created.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    contribution_state: 'STATED',
    max_annual_contribution_usd: 25000,
    ...extra,
  });
  created.push(row.id);
  return Player.get(row.id);
}

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => resolve(`http://127.0.0.1:${server.address().port}`));
  server.unref();
});

beforeAll(async () => {
  seedPool('mens-soccer');
  clearContextCache();

  const open = express();
  open.use(express.json());
  open.use('/api', matchmakingRouter);
  baseUrl = await listen(open);

  /** The production stack: nothing reaches the router without an operator. */
  const guarded = express();
  guarded.use(express.json());
  guarded.use('/api', requireOperator);
  guarded.use('/api', matchmakingRouter);
  guardedUrl = await listen(guarded);
});

afterAll(() => {
  for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

describe('A9.1 API: access', () => {
  it('A1. an unauthenticated request never reaches the service', async () => {
    const a = athlete();
    const res = await fetch(`${guardedUrl}/api/players/${a.id}/matchmaking`);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('unauthenticated');
  });

  /**
   * Asserted at the SOURCE, in the idiom v2CallerContract.test.js set. The
   * route carries no auth of its own - `requireOperator` is mounted app-wide -
   * so the only thing that can prove it is guarded is where it sits in
   * server/index.js, and that is invisible to any behavioural test of the
   * router.
   */
  it('A2. the router is mounted after requireOperator in server/index.js', () => {
    const index = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
    const guard = index.indexOf("app.use('/api', requireOperator)");
    const mount = index.indexOf("app.use('/api', matchmakingRouter)");
    expect(guard).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(guard);
  });

  /**
   * `players` carries no ownership column - it is a shared operator store -
   * so any signed-in operator may read any athlete. Pinned because inventing
   * a per-operator rule here would be a new access model in the application,
   * and removing the shared one would be a silent lockout.
   */
  it('A3. access follows the existing shared-operator model exactly', () => {
    /**
     * `players.created_by_id` EXISTS, and is not an access control: no route
     * or library filters a player read by it, which the first draft of this
     * test got wrong by assuming the column's absence rather than checking
     * its use. What must stay true is that this route adds no scoping of its
     * own, so an operator sees exactly the athletes every other player
     * surface shows them.
     */
    const route = fs.readFileSync(path.join(root, 'server/routes/matchmaking.js'), 'utf8');
    for (const scoping of ['created_by_id', 'operator_id', 'owner_id', 'req.operator.id']) {
      expect(route, scoping).not.toContain(scoping);
    }
    expect(route).toContain('Player.get(req.params.id)');
  });
});

describe('A9.1 API: the error contract', () => {
  it('E1. an unknown player is a 404 that does not echo internals', async () => {
    const res = await fetch(`${baseUrl}/api/players/no-such-athlete/matchmaking`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('PLAYER_NOT_FOUND');
    expect(JSON.stringify(body)).not.toMatch(/SELECT|sqlite|\/Users\/|at Object\./i);
  });

  it('E2. an unresolved contribution is a 409 with a stable machine code', async () => {
    const a = athlete({
      contribution_state: 'NEEDS_CONFIRMATION', max_annual_contribution_usd: null,
    });
    const res = await fetch(`${baseUrl}/api/players/${a.id}/matchmaking`);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('CONTRIBUTION_UNRESOLVED');
    /** The frontend branches on this to render a prompt, not an empty list. */
    expect(body.error).toMatch(/resolved family contribution/i);
    /** It may SAY it is not treated as zero; it must not BE zero. */
    expect(body.error).toMatch(/not treated as zero/i);
  });

  it('E3. an athlete who cannot be ranked yet is a typed 422, not a 500', async () => {
    const a = athlete({ recruiting_class_year: null });
    const res = await fetch(`${baseUrl}/api/players/${a.id}/matchmaking`);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('ATHLETE_PROFILE_INCOMPLETE');
  });

  /**
   * An intake defect the engine refuses to clamp. It arrives as a 500 the
   * moment the adapter forgets that a calibration throw is about the athlete
   * and not about the server - which is exactly what happened first.
   */
  it('E3b. an unreadable profile is a typed 422 carrying no internals', async () => {
    const a = athlete({ football_ability: 0 });
    const res = await fetch(`${baseUrl}/api/players/${a.id}/matchmaking`);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('ATHLETE_PROFILE_INVALID');
    expect(JSON.stringify(body)).not.toMatch(/\/Users\/|at Module|SELECT/i);
  });

  /**
   * The catch-all path, asserted at the source. A behavioural test would need
   * the service to fail unexpectedly on demand, and the only ways to arrange
   * that are to export the handler for tests or to corrupt the database -
   * both of which change the thing under test. What matters is a property of
   * the code: an unrecognised error is logged in full and reported as nothing.
   *
   * The first draft of this test asserted that two local variables were
   * defined, which proved nothing at all.
   */
  it('E4. an unrecognised failure is logged in full and reported as nothing', () => {
    const route = fs.readFileSync(path.join(root, 'server/routes/matchmaking.js'), 'utf8');
    expect(route).toContain("console.error(`[${label}]`, err)");
    expect(route).toContain("res.status(500).json({ error: 'Unexpected error.' })");
    /** The 500 body is a literal: nothing from the error reaches the client. */
    expect(route).not.toMatch(/status\(500\)[\s\S]{0,120}err\.(message|stack)/);
  });
});

describe('A9.1 API: the response contract', () => {
  let body;
  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/api/players/${athlete().id}/matchmaking`);
    expect(res.status).toBe(200);
    body = await res.json();
  });

  it('R1. carries its matcher, freeze, corpus and counts', () => {
    expect(body.matcherVersion).toBe('v2');
    expect(body.engineFreeze).toMatch(/^[0-9a-f]{40}$/);
    expect(body.corpusDigest).toMatch(/^[0-9a-f]{64}$/);
    for (const k of ['poolSize', 'supportedUniverse', 'ranked', 'limitedData', 'unsupported']) {
      expect(typeof body.counts[k], k).toBe('number');
    }
  });

  it('R2. returns the full universe, not the Top 100', () => {
    expect(body.programmes.length).toBe(body.counts.poolSize);
    expect(body.counts.ranked + body.counts.limitedData + body.counts.unsupported)
      .toBe(body.programmes.length);
  });

  it('R3. exposes no engine internals', () => {
    const text = JSON.stringify(body);
    for (const leaked of ['basis', 'midrank', 'weight', 'share', 'percentile', 'calibration', 'rosterIndex']) {
      expect(text.toLowerCase(), leaked).not.toContain(`"${leaked}"`);
    }
  });

  it('R4. exposes no person-level data', () => {
    const text = JSON.stringify(body);
    for (const pii of ['player_name', 'email', 'hometown', 'coaching_staff', '@']) {
      expect(text, pii).not.toContain(pii);
    }
  });

  it('R5. never describes a refusal as a bad match or a zero', () => {
    const text = JSON.stringify(body).toLowerCase();
    for (const forbidden of ['bad match', 'poor fit', 'low score', 'does not offer']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    for (const p of body.programmes.filter((x) => x.status !== STATUS.RANKED)) {
      expect(p.pursuit).toBeUndefined();
    }
  });
});
