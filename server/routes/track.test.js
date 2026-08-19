import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { findOrCreateCoach } from '../lib/coaches.js';
import { createOutreach } from '../lib/outreach.js';
import { deactivateAthlete } from '../lib/athleteLifecycle.js';
import { trackRouter, resetTrackRateLimits } from './track.js';

let baseUrl;
const SESSION = '123e4567-e89b-12d3-a456-426614174000';

beforeAll(async () => {
  const app = express();
  app.use('/api', trackRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

function makeAthlete() {
  const id = randomUUID();
  const ts = utcNow();
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, public_slug)
    VALUES (?, ?, ?, 'Test Athlete', 'Winger', ?)
  `).run(id, ts, ts, randomUUID().slice(0, 10));
  return id;
}

function seedOutreach() {
  const athleteId = makeAthlete();
  const coach = findOrCreateCoach({ full_name: 'C', email: `c${randomUUID()}@example.edu`, school: 'S', sport: 'mens-soccer' });
  return { athleteId, outreach: createOutreach({ athleteId, coachId: coach.id }) };
}

function event(overrides = {}) {
  return JSON.stringify({
    token: 'x'.repeat(32),
    event: 'play_start',
    sessionId: SESSION,
    coveragePct: 42,
    watchedSeconds: 73,
    ...overrides,
  });
}

const post = (body, headers = {}) =>
  fetch(`${baseUrl}/api/track`, { method: 'POST', body, headers });

const eventCount = () => db.prepare('SELECT COUNT(*) c FROM tracking_events').get().c;

beforeEach(() => {
  db.exec('DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
  resetTrackRateLimits();
});

describe('accepting real events', () => {
  it('writes a row for a valid token and answers 204', async () => {
    const { outreach } = seedOutreach();
    const res = await post(event({ token: outreach.token }), { 'Content-Type': 'application/json' });

    expect(res.status).toBe(204);
    expect(eventCount()).toBe(1);

    const row = db.prepare('SELECT * FROM tracking_events').get();
    expect(row.outreach_id).toBe(outreach.id);
    expect(row.event_type).toBe('play_start');
    expect(row.coverage_pct).toBe(42);
  });

  it('resolves the token to outreach at write time', async () => {
    const a = seedOutreach();
    const b = seedOutreach();
    await post(event({ token: a.outreach.token }), { 'Content-Type': 'application/json' });
    await post(event({ token: b.outreach.token }), { 'Content-Type': 'application/json' });

    const rows = db.prepare('SELECT outreach_id FROM tracking_events ORDER BY id').all();
    expect(rows.map((r) => r.outreach_id)).toEqual([a.outreach.id, b.outreach.id]);
  });

  it('stamps created_at itself rather than trusting the client clock', async () => {
    const { outreach } = seedOutreach();
    await post(event({ token: outreach.token, ts: '1999-01-01T00:00:00.000Z' }), { 'Content-Type': 'application/json' });

    const row = db.prepare('SELECT created_at, payload FROM tracking_events').get();
    expect(row.created_at.startsWith('1999')).toBe(false);
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(JSON.parse(row.payload).ts).toBe('1999-01-01T00:00:00.000Z');
  });

  it('accepts what sendBeacon actually sends, not only application/json', async () => {
    const { outreach } = seedOutreach();
    // sendBeacon takes Content-Type from the Blob and cannot set headers.
    for (const contentType of ['application/json', 'text/plain;charset=UTF-8', 'application/octet-stream']) {
      resetTrackRateLimits();
      await post(event({ token: outreach.token }), { 'Content-Type': contentType });
    }
    expect(eventCount()).toBe(3);
  });

  it('accepts a body sent with no Content-Type at all', async () => {
    const { outreach } = seedOutreach();
    const res = await post(new Blob([event({ token: outreach.token })]));
    expect(res.status).toBe(204);
    expect(eventCount()).toBe(1);
  });

  it('records every event type in the vocabulary', async () => {
    const { outreach } = seedOutreach();
    for (const type of ['visit_start', 'visit_qualified', 'coverage_50', 'chapter_jump', 'session_end']) {
      await post(event({ token: outreach.token, event: type }), { 'Content-Type': 'application/json' });
    }
    expect(eventCount()).toBe(5);
  });
});

describe('is not an enumeration oracle', () => {
  it('answers an unknown token identically to a valid one, writing nothing', async () => {
    const { outreach } = seedOutreach();
    const valid = await post(event({ token: outreach.token }), { 'Content-Type': 'application/json' });
    const unknown = await post(event({ token: 'z'.repeat(32) }), { 'Content-Type': 'application/json' });

    expect(unknown.status).toBe(valid.status);
    expect(unknown.status).toBe(204);
    expect(await unknown.text()).toBe(await valid.text());
    expect(eventCount()).toBe(1); // only the valid one
  });

  it('answers a revoked token identically, writing nothing', async () => {
    const { athleteId, outreach } = seedOutreach();
    deactivateAthlete(athleteId);

    const res = await post(event({ token: outreach.token }), { 'Content-Type': 'application/json' });
    expect(res.status).toBe(204);
    expect(eventCount()).toBe(0);
  });

  it.each([
    ['a malformed token', event({ token: 'short' })],
    ['an unknown event type', event({ token: 'z'.repeat(32), event: 'drop_table' })],
    ['malformed JSON', '{oh dear'],
    ['an empty body', ''],
  ])('answers 204 and writes nothing for %s', async (_label, body) => {
    seedOutreach();
    const res = await post(body, { 'Content-Type': 'application/json' });
    expect(res.status).toBe(204);
    expect(eventCount()).toBe(0);
  });

  it('answers 204 and writes nothing for an oversized body', async () => {
    const { outreach } = seedOutreach();
    const res = await post(event({ token: outreach.token, label: 'x'.repeat(50_000) }), { 'Content-Type': 'application/json' });
    expect(res.status).toBe(204);
    expect(eventCount()).toBe(0);
  });
});

describe('rate limiting', () => {
  it('cuts off a flood and stops writing rows', async () => {
    const { outreach } = seedOutreach();
    const body = event({ token: outreach.token });

    let limited = 0;
    for (let i = 0; i < 200; i++) {
      const res = await post(body, { 'Content-Type': 'application/json' });
      if (res.status === 429) limited++;
    }

    expect(limited).toBeGreaterThan(0);
    expect(eventCount()).toBeLessThan(200);
  });
});

describe('CORS', () => {
  it('answers the preflight', async () => {
    const res = await fetch(`${baseUrl}/api/track`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://pages.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });

  it('sets the origin header on real posts too', async () => {
    const { outreach } = seedOutreach();
    const res = await post(event({ token: outreach.token }), { 'Content-Type': 'application/json' });
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });
});
