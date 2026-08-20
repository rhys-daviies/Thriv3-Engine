import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.stubEnv('THRIV3_EDGE_URL', 'https://edge.test');
vi.stubEnv('THRIV3_SYNC_SECRET', 'test-secret');

const db = (await import('../db/client.js')).default;
const { utcNow } = await import('./time.js');
const { findOrCreateCoach } = await import('./coaches.js');
const { createOutreach } = await import('./outreach.js');
const { deactivateAthlete } = await import('./athleteLifecycle.js');
const { pushTokens, pullEvents } = await import('./edgeSync.js');

let requests = [];
let pages = [];

beforeEach(() => {
  db.exec('DELETE FROM sync_state; DELETE FROM engagement_rollup; DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
  requests = [];
  pages = [];

  vi.stubGlobal('fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/api/tokens')) {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({ synced: body.tokens.length }), { status: 200 });
    }
    const page = pages.shift() || { events: [], cursor: 0, more: false };
    return new Response(JSON.stringify(page), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeOutreach() {
  const athleteId = randomUUID();
  const ts = utcNow();
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, public_slug)
    VALUES (?, ?, ?, 'A', 'Winger', ?)
  `).run(athleteId, ts, ts, randomUUID().slice(0, 10));
  const coach = findOrCreateCoach({ full_name: 'C', email: `${randomUUID()}@example.edu`, school: 'S', sport: 'mens-soccer' });
  return { athleteId, outreach: createOutreach({ athleteId, coachId: coach.id }) };
}

const edgeEvent = (id, token, overrides = {}) => ({
  id,
  token,
  session_id: 'sess-1',
  event_type: 'visit_qualified',
  coverage_pct: 50,
  watched_seconds: 100,
  duration_seconds: 200,
  dwell_seconds: 30,
  rewinds: 1,
  skips: 0,
  payload: '{}',
  created_at: utcNow(),
  ...overrides,
});

describe('pushing tokens up', () => {
  it('sends every token with its revoked state', async () => {
    const a = makeOutreach();
    const b = makeOutreach();
    deactivateAthlete(b.athleteId);

    const result = await pushTokens();
    expect(result.pushed).toBe(2);

    const body = JSON.parse(requests[0].options.body);
    const byToken = Object.fromEntries(body.tokens.map((t) => [t.token, t.revoked]));
    expect(byToken[a.outreach.token]).toBe(0);
    expect(byToken[b.outreach.token]).toBe(1);
  });

  it('authenticates with the shared secret', async () => {
    makeOutreach();
    await pushTokens();
    expect(requests[0].options.headers.Authorization).toBe('Bearer test-secret');
  });

  it('sends no athlete or coach identity, only opaque tokens', async () => {
    makeOutreach();
    await pushTokens();

    const body = JSON.parse(requests[0].options.body);
    for (const entry of body.tokens) {
      expect(Object.keys(entry).sort()).toEqual(['revoked', 'token']);
    }
  });
});

describe('pulling events down', () => {
  it('resolves each token to its outreach row', async () => {
    const { outreach } = makeOutreach();
    pages = [{ events: [edgeEvent(1, outreach.token)], cursor: 1, more: false }];

    const result = await pullEvents();
    expect(result.inserted).toBe(1);

    const row = db.prepare('SELECT * FROM tracking_events').get();
    expect(row.outreach_id).toBe(outreach.id);
    expect(row.remote_id).toBe(1);
  });

  it('does not duplicate when the same events are pulled again', async () => {
    const { outreach } = makeOutreach();
    const events = [edgeEvent(1, outreach.token), edgeEvent(2, outreach.token)];

    pages = [{ events, cursor: 2, more: false }];
    await pullEvents();

    // The cursor has moved on, but a replay of the same rows must be absorbed.
    db.prepare('UPDATE sync_state SET value = 0 WHERE key = ?').run('edge_events_cursor');
    pages = [{ events, cursor: 2, more: false }];
    const second = await pullEvents();

    expect(second.inserted).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM tracking_events').get().c).toBe(2);
  });

  it('advances the cursor so the next pull asks only for what is new', async () => {
    const { outreach } = makeOutreach();
    pages = [{ events: [edgeEvent(7, outreach.token)], cursor: 7, more: false }];
    await pullEvents();

    pages = [{ events: [], cursor: 7, more: false }];
    await pullEvents();

    expect(requests[requests.length - 1].url).toContain('since=7');
  });

  it('drops events whose token no longer resolves rather than storing them unattributed', async () => {
    makeOutreach();
    pages = [{ events: [edgeEvent(1, 'z'.repeat(32))], cursor: 1, more: false }];

    const result = await pullEvents();
    expect(result.unresolved).toBe(1);
    expect(result.inserted).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM tracking_events').get().c).toBe(0);
  });

  it('drops events for an archived athlete', async () => {
    const { athleteId, outreach } = makeOutreach();
    deactivateAthlete(athleteId);
    pages = [{ events: [edgeEvent(1, outreach.token)], cursor: 1, more: false }];

    expect((await pullEvents()).unresolved).toBe(1);
  });

  it('follows pagination until the edge says there is no more', async () => {
    const { outreach } = makeOutreach();
    pages = [
      { events: [edgeEvent(1, outreach.token)], cursor: 1, more: true },
      { events: [edgeEvent(2, outreach.token)], cursor: 2, more: true },
      { events: [edgeEvent(3, outreach.token)], cursor: 3, more: false },
    ];

    const result = await pullEvents();
    expect(result.fetched).toBe(3);
    expect(result.inserted).toBe(3);
  });

  it('rebuilds the rollup for every outreach it touched', async () => {
    const { outreach } = makeOutreach();
    pages = [{
      events: [
        edgeEvent(1, outreach.token, { event_type: 'visit_start' }),
        edgeEvent(2, outreach.token, { event_type: 'visit_qualified' }),
        edgeEvent(3, outreach.token, { event_type: 'session_end', coverage_pct: 80, watched_seconds: 160 }),
      ],
      cursor: 3,
      more: false,
    }];

    const result = await pullEvents();
    expect(result.rollups).toBe(1);

    const rollup = db.prepare('SELECT * FROM engagement_rollup WHERE outreach_id = ?').get(outreach.id);
    expect(rollup.qualified_visits).toBe(1);
    expect(rollup.best_coverage_pct).toBe(80);
  });
});
