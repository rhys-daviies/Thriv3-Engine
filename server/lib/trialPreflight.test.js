import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.stubEnv('THRIV3_EDGE_URL', 'https://edge.test');
vi.stubEnv('THRIV3_SYNC_SECRET', 'test-secret');
vi.stubEnv('THRIV3_PUBLIC_BASE_URL', 'https://edge.test');

const db = (await import('../db/client.js')).default;
const { utcNow } = await import('./time.js');
const { findOrCreateCoach } = await import('./coaches.js');
const { createOutreach } = await import('./outreach.js');
const { runPreflight } = await import('./trialPreflight.js');

const PROFILE = '<html>profile<script>fetch("/api/track")</script></html>';
const NEUTRAL = '<html><title>Profile unavailable — Thriv3</title></html>';

let health;
let pageFor;

beforeEach(() => {
  db.exec('DELETE FROM sync_state; DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
  health = {
    ok: true, liveTokens: 1, revokedTokens: 0, events: 0,
    maxEventId: 0, eventSequence: 0, guardUnlockedUntil: null, deletesLocked: true,
  };
  pageFor = (url) => (url.includes('ref=not-a-real-token') ? NEUTRAL : PROFILE);
});

afterEach(() => vi.unstubAllGlobals());

const fetchImpl = async (url) => (String(url).includes('/api/health')
  ? new Response(JSON.stringify(health), { status: 200 })
  : new Response(pageFor(String(url)), { status: 200 }));

function publishAthlete() {
  const id = randomUUID();
  const ts = utcNow();
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, graduation_year,
                         video_id, email, public_slug, published_at)
    VALUES (?, ?, ?, 'Test Athlete', 'Winger', 2027, 'vid', 'a@example.com', ?, ?)
  `).run(id, ts, ts, randomUUID().slice(0, 10), ts);
  return id;
}

function outreachFor(athleteId) {
  const coach = findOrCreateCoach({
    full_name: 'C', email: `${randomUUID()}@example.edu`, school: 'S', sport: 'mens-soccer',
  });
  return createOutreach({ athleteId, coachId: coach.id });
}

const find = (result, name) => result.checks.find((c) => c.name === name);
const run = () => runPreflight({ fetchImpl });

describe('choosing the athlete', () => {
  it('refuses to guess when nothing is published', async () => {
    const result = await run();
    expect(find(result, 'Trial athlete').status).toBe('fail');
    expect(result.ready).toBe(false);
  });

  // Sending as the wrong athlete is not a mistake you can take back.
  it('refuses to guess between two published athletes', async () => {
    publishAthlete();
    publishAthlete();
    const result = await run();
    expect(find(result, 'Trial athlete').detail).toMatch(/2 published/);
  });

  it('takes the only published athlete', async () => {
    outreachFor(publishAthlete());
    const result = await run();
    expect(find(result, 'Trial athlete').status).toBe('pass');
  });

  it('reports a profile missing a required field', async () => {
    const id = publishAthlete();
    db.prepare('UPDATE players SET video_id = NULL WHERE id = ?').run(id);
    const result = await run();
    expect(find(result, 'Profile has every required field').detail).toMatch(/video/);
    expect(result.ready).toBe(false);
  });
});

describe('edge state', () => {
  // The 2026-08-20 failure, which every test in the suite passed straight through.
  it('fails when the edge holds fewer live tokens than we do', async () => {
    const id = publishAthlete();
    outreachFor(id);
    health.liveTokens = 0;
    const result = await run();
    expect(find(result, 'Token allowlist in sync').status).toBe('fail');
    expect(result.ready).toBe(false);
  });

  it('fails when a live token serves the neutral page', async () => {
    const id = publishAthlete();
    outreachFor(id);
    pageFor = () => NEUTRAL;
    const result = await run();
    expect(find(result, 'Tracked link resolves').status).toBe('fail');
  });

  // Gating has to fail closed as well as open.
  it('fails when an unknown token is served the profile', async () => {
    const id = publishAthlete();
    outreachFor(id);
    pageFor = () => PROFILE;
    const result = await run();
    expect(find(result, 'Unknown token refused').status).toBe('fail');
  });

  it('fails when the cursor is past the edge high-water mark', async () => {
    const id = publishAthlete();
    outreachFor(id);
    db.prepare("INSERT INTO sync_state (key, value, updated_at) VALUES ('edge_events_cursor', '6', ?)").run(utcNow());
    health.eventSequence = 0;
    const result = await run();
    const c = find(result, 'Event cursor behind the edge');
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/6 event\(s\) of the trial would never be pulled/);
  });

  // Deleted rows keep their ids, which is the only reason cursor 6 was safe.
  it('passes when the cursor equals a sequence left behind by deleted rows', async () => {
    const id = publishAthlete();
    outreachFor(id);
    db.prepare("INSERT INTO sync_state (key, value, updated_at) VALUES ('edge_events_cursor', '6', ?)").run(utcNow());
    health.events = 0;
    health.eventSequence = 6;
    expect(find(await run(), 'Event cursor behind the edge').status).toBe('pass');
  });

  it('fails when the delete guard is unlocked', async () => {
    const id = publishAthlete();
    outreachFor(id);
    health.deletesLocked = false;
    health.guardUnlockedUntil = '2099-01-01 00:00:00';
    expect(find(await run(), 'Delete guard locked').status).toBe('fail');
  });

  it('warns rather than fails when the worker predates the health detail', async () => {
    const id = publishAthlete();
    outreachFor(id);
    health = { ok: true };
    const result = await run();
    expect(find(result, 'Edge reports its state').status).toBe('warn');
    expect(result.ready).toBe(true);
  });

  it('warns rather than fails when the athlete has no outreach yet', async () => {
    publishAthlete();
    health.liveTokens = 0;
    const result = await run();
    expect(find(result, 'Tracked link resolves').status).toBe('warn');
  });

  it('is clean when everything holds', async () => {
    const id = publishAthlete();
    outreachFor(id);
    const result = await run();
    expect(result.failures).toBe(0);
    expect(result.ready).toBe(true);
  });
});

describe('it is read-only', () => {
  it('writes nothing — no events, no outreach, no sync state', async () => {
    const id = publishAthlete();
    outreachFor(id);
    const before = ['tracking_events', 'outreach', 'sync_state', 'coaches']
      .map((t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n);
    await run();
    const after = ['tracking_events', 'outreach', 'sync_state', 'coaches']
      .map((t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n);
    expect(after).toEqual(before);
  });

  it('never posts — every request it makes is a GET', async () => {
    const id = publishAthlete();
    outreachFor(id);
    const seen = [];
    await runPreflight({
      fetchImpl: async (url, options) => {
        seen.push(options?.method ?? 'GET');
        return fetchImpl(url);
      },
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((m) => m === 'GET')).toBe(true);
  });
});
