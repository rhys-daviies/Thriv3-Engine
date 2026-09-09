import { describe, it, expect } from 'vitest';
import worker from './index.js';

/**
 * The edge is where an already-sent link is actually resolved, so its failure
 * behaviour IS the permanence guarantee. These tests are about what happens
 * when the parts it depends on are broken.
 */

/** A D1 stand-in. `rows` decides what a lookup finds; `fail` makes it throw. */
function fakeDb({ rows = [], fail = false } = {}) {
  return {
    prepare() {
      return {
        bind() { return this; },
        async first() {
          if (fail) throw new Error('D1_ERROR: network connection lost');
          return rows.length ? rows[0] : null;
        },
        async all() {
          if (fail) throw new Error('D1_ERROR: network connection lost');
          return { results: rows };
        },
        async run() {
          if (fail) throw new Error('D1_ERROR: network connection lost');
          return { meta: { changes: 0 } };
        },
      };
    },
    async batch() { if (fail) throw new Error('D1_ERROR'); return []; },
  };
}

const PROFILE_HTML = '<html><body>Athlete profile</body></html>';

const assets = {
  async fetch(request) {
    const url = new URL(request.url);
    return url.pathname.startsWith('/p/known')
      ? new Response(PROFILE_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } })
      : new Response('nope', { status: 404 });
  },
};

const get = (path) => new Request(`https://thriv3-profiles.pages.dev${path}`);

describe('serving a profile when the tracking database is down', () => {
  it('still serves the page for a link that carries a token', async () => {
    // The link in a coach's inbox always carries ?ref=. If a D1 outage took
    // that path down, every profile we have ever sent would read as withdrawn
    // at once. Availability of the page does not depend on the database we
    // consult only for revocation.
    const res = await worker.fetch(get('/p/known.html?ref=tok123'), {
      DB: fakeDb({ fail: true }), ASSETS: assets,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PROFILE_HTML);
  });

  it('still serves the page when the D1 binding is missing entirely', async () => {
    const res = await worker.fetch(get('/p/known.html?ref=tok123'), { ASSETS: assets });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PROFILE_HTML);
  });

  it('still refuses a token the database can positively say is revoked', async () => {
    // Failing open is only for "we could not ask". A clean answer of "no live
    // token" is a decision and is honoured.
    const res = await worker.fetch(get('/p/known.html?ref=revoked'), {
      DB: fakeDb({ rows: [] }), ASSETS: assets,
    });
    expect(await res.text()).not.toBe(PROFILE_HTML);
  });

  it('serves the page for a live token', async () => {
    const res = await worker.fetch(get('/p/known.html?ref=live'), {
      DB: fakeDb({ rows: [{ 1: 1 }] }), ASSETS: assets,
    });
    expect(await res.text()).toBe(PROFILE_HTML);
  });

  it('returns the neutral page, not a 404, for a slug with no asset', async () => {
    const res = await worker.fetch(get('/p/missing.html'), { DB: fakeDb(), ASSETS: assets });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toBe(PROFILE_HTML);
  });
});

describe('recording an event is best-effort', () => {
  const post = (body) => new Request('https://thriv3-profiles.pages.dev/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const event = {
    token: 'tok123',
    session_id: 'sess-1',
    event_type: 'visit_qualified',
    coverage_pct: 40,
    watched_seconds: 20,
    duration_seconds: 100,
    dwell_seconds: 15,
    rewinds: 0,
    skips: 0,
  };

  it('answers 204 rather than erroring when the database write fails', async () => {
    // The collector shares an origin with the pages. An unhandled throw here
    // becomes a Cloudflare error on the same host a coach is reading.
    const res = await worker.fetch(post(event), { DB: fakeDb({ fail: true }) });
    expect(res.status).toBe(204);
  });

  it('answers 204 for a normal write too, so nothing is distinguishable', async () => {
    const res = await worker.fetch(post(event), { DB: fakeDb({ rows: [{ 1: 1 }] }) });
    expect(res.status).toBe(204);
  });

  it('does not touch the profile path when tracking fails', async () => {
    const env = { DB: fakeDb({ fail: true }), ASSETS: assets };
    await worker.fetch(post(event), env);
    const res = await worker.fetch(get('/p/known.html?ref=tok123'), env);
    expect(await res.text()).toBe(PROFILE_HTML);
  });
});
