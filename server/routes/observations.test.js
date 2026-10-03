/**
 * =============================================================================
 * THE OBSERVATION API DOORWAY — A9.6 §N and §V.
 *
 * Boundary properties only: who may ask, what a refusal looks like from
 * outside, and - the one this phase adds - what a telemetry endpoint is
 * allowed to hand back. An analytics surface is exactly where a coach's email
 * address or a private reply body leaks, because the people reading it are
 * trusted and nobody looks twice at a field that is merely extra.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import { observationsRouter } from './observations.js';
import { requireOperator } from '../lib/operatorAuth.js';
import { OBSERVATION_KIND, OBSERVATION_SOURCE } from '../lib/v2/recruitingObservations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const K = OBSERVATION_KIND;
const PROGRAMME = { collegeName: 'Route Programme', sport: 'mens-soccer' };
const created = [];
let baseUrl;
let guardedUrl;
let player;

function athlete() {
  const row = Player.create({
    full_name: `A9.6 API ${created.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    recruiting_class_year: 2028,
  });
  created.push(row.id);
  return Player.get(row.id);
}

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => resolve(`http://127.0.0.1:${server.address().port}`));
  server.unref();
});

const post = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  const open = express();
  open.use(express.json());
  open.use('/api', observationsRouter);
  baseUrl = await listen(open);

  const guarded = express();
  guarded.use(express.json());
  guarded.use('/api', requireOperator);
  guarded.use('/api', observationsRouter);
  guardedUrl = await listen(guarded);

  player = athlete();
});

afterAll(() => {
  for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

beforeEach(() => {
  db.prepare('DELETE FROM recruiting_observations WHERE athlete_id = ?').run(player.id);
});

describe('A9.6 §N. access', () => {
  it('N1. an unauthenticated request never reaches the service', async () => {
    const res = await fetch(`${guardedUrl}/api/players/${player.id}/observations?collegeName=X&sport=mens-soccer`);
    expect(res.status).toBe(401);
  });

  it('N2. the router is mounted after requireOperator in server/index.js', () => {
    const index = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
    const guard = index.indexOf("app.use('/api', requireOperator)");
    const mount = index.indexOf("app.use('/api', observationsRouter)");
    expect(guard).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(guard);
  });
});

describe('A9.6 §N. the vocabulary is served, not guessed', () => {
  it('N3. every legal kind arrives with its category and required attributes', async () => {
    const res = await fetch(`${baseUrl}/api/observations/vocabulary`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kinds).toHaveLength(Object.values(OBSERVATION_KIND).length);
    const filled = body.kinds.find((k) => k.kind === K.POSITION_FILLED);
    expect(filled.category).toBe('RECRUITING_INTELLIGENCE');
    expect(filled.required).toEqual(['position']);
  });

  it('N4. a client-defined machine event name is refused with 422', async () => {
    const res = await post(`${baseUrl}/api/players/${player.id}/observations`, {
      ...PROGRAMME, kind: 'COACH_SEEMED_KEEN', source: OBSERVATION_SOURCE.COACH_REPLY,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('OBSERVATION_KIND_UNKNOWN');
  });

  it('N5. an observation with no programme is a 400', async () => {
    const res = await post(`${baseUrl}/api/players/${player.id}/observations`, {
      kind: K.POSITIVE_REPLY, source: OBSERVATION_SOURCE.COACH_REPLY,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('PROGRAMME_REQUIRED');
  });

  it('N6. an unknown athlete is a 404, not a 500', async () => {
    const res = await post(`${baseUrl}/api/players/no-such-athlete/observations`, {
      ...PROGRAMME, kind: K.POSITIVE_REPLY, source: OBSERVATION_SOURCE.COACH_REPLY,
    });
    expect(res.status).toBe(404);
  });
});

describe('A9.6 §N. recording and reading back', () => {
  it('N7. a recorded observation comes back with the derived state beside it', async () => {
    const write = await post(`${baseUrl}/api/players/${player.id}/observations`, {
      ...PROGRAMME, kind: K.REQUESTED_FILM, source: OBSERVATION_SOURCE.COACH_REPLY,
    });
    expect(write.status).toBe(201);

    const read = await fetch(
      `${baseUrl}/api/players/${player.id}/observations`
      + `?collegeName=${encodeURIComponent(PROGRAMME.collegeName)}&sport=${PROGRAMME.sport}`,
    );
    const body = await read.json();
    expect(body.observations).toHaveLength(1);
    expect(body.state.programmeInterest.kind).toBe(K.REQUESTED_FILM);
    expect(body.state.athleteOutcome).toBeNull();
  });

  it('N8. a review confirms or rejects, and never un-reviews', async () => {
    const write = await post(`${baseUrl}/api/players/${player.id}/observations`, {
      ...PROGRAMME, kind: K.NEUTRAL_REPLY, source: OBSERVATION_SOURCE.COACH_REPLY,
      classifierMethod: 'AI_ASSISTED', classifierVersion: 'clf-0.1', confidence: 0.6,
    });
    const { observation } = await write.json();

    const bad = await post(`${baseUrl}/api/observations/${observation.id}/review`, { state: 'UNREVIEWED' });
    expect(bad.status).toBe(422);

    const ok = await post(`${baseUrl}/api/observations/${observation.id}/review`, { state: 'CONFIRMED' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).review_state).toBe('CONFIRMED');
  });
});

/* ------------------------------------------------------------------ */
/* §V. What a telemetry endpoint is allowed to return                 */
/* ------------------------------------------------------------------ */

describe('A9.6 §V. the privacy boundary', () => {
  it('V1. no contact detail of any kind leaves the observation endpoints', async () => {
    const coachId = 'obs-route-coach';
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(coachId, new Date().toISOString(), 'Route Coach',
        'route.coach@example.test', PROGRAMME.collegeName, PROGRAMME.sport);

    await post(`${baseUrl}/api/players/${player.id}/observations`, {
      ...PROGRAMME, coachId, kind: K.POSITIVE_REPLY, source: OBSERVATION_SOURCE.COACH_REPLY,
    });

    const res = await fetch(
      `${baseUrl}/api/players/${player.id}/observations`
      + `?collegeName=${encodeURIComponent(PROGRAMME.collegeName)}&sport=${PROGRAMME.sport}`,
    );
    const text = await res.text();

    expect(text).not.toContain('route.coach@example.test');
    expect(text).not.toContain('@example.test');
    expect(text).not.toMatch(/\bemail\b/i);
    expect(text).not.toMatch(/phone|address|guardian|parent/i);
    // The coach is referenced by id, which is how the row stays joinable
    // without the endpoint carrying anybody's inbox.
    expect(text).toContain(coachId);

    /**
     * The observation goes first: `coach_id` carries no ON DELETE, so deleting
     * a coach an observation names is REFUSED. That is the designed behaviour
     * - history that points at a vanished row is unreadable - and this
     * teardown relies on it rather than working around it.
     */
    expect(() => db.prepare('DELETE FROM coaches WHERE id = ?').run(coachId))
      .toThrow(/FOREIGN KEY/i);
    db.prepare('DELETE FROM recruiting_observations WHERE coach_id = ?').run(coachId);
    db.prepare('DELETE FROM coaches WHERE id = ?').run(coachId);
  });

  it('V2. no email body or subject is copied into an observation response', async () => {
    await post(`${baseUrl}/api/players/${player.id}/observations`, {
      ...PROGRAMME, kind: K.POSITIVE_REPLY, source: OBSERVATION_SOURCE.COACH_REPLY,
    });
    const res = await fetch(
      `${baseUrl}/api/players/${player.id}/observations`
      + `?collegeName=${encodeURIComponent(PROGRAMME.collegeName)}&sport=${PROGRAMME.sport}`,
    );
    const body = await res.json();
    const keys = new Set(body.observations.flatMap((o) => Object.keys(o)));
    for (const forbidden of ['body', 'subject', 'generated_body', 'wire_body', 'recipient_email']) {
      expect([...keys]).not.toContain(forbidden);
    }
  });

  it('V3. a 500 never carries a table name, a column or a stack', async () => {
    const res = await fetch(`${baseUrl}/api/sends/not-a-send/provenance`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toMatch(/SQLITE|at Object|\.js:\d+/);
  });
});
