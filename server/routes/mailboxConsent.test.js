/**
 * THE MAILBOX CONSENT SURFACE, END TO END — Phase D3, hardened in D3.1.
 *
 * Bound to the REAL application, like `auth.test.js`, and for the same reason:
 * D3 adds the first new public surface since hosting, and whether it is
 * correctly placed around `requireOperator` is a property of the middleware
 * order in `server/index.js`, not of a reconstruction of it.
 *
 * The three questions asked here are the three trust boundaries: can an
 * athlete with a token do the one thing, can they do anything else, and can
 * somebody without a token or a session do either.
 *
 * D3.1 adds a fourth, and it is the one with a measurement behind it: does the
 * capability ever reach a URL. `the capability never reaches a URL` below puts
 * a logging proxy in front of the real application and drives the whole flow
 * through it, because that is what a reverse proxy and a hosting platform
 * actually record — and against D3's route shape, two of four log lines
 * contained the raw token.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import express from 'express';

process.env.THRIV3_SCRYPT_COST = '14';
process.env.THRIV3_SESSION_SECRET = `consent-${'q'.repeat(40)}`;
process.env.THRIV3_APP_ORIGIN = 'http://localhost:5183';
process.env.THRIV3_REPORT_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-consent-'));
process.env.THRIV3_GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.THRIV3_GOOGLE_CLIENT_SECRET = 'test-secret';

const ORIGIN = 'http://localhost:5183';
const PASSWORD = 'a-perfectly-fine-passphrase';
const EMAIL = 'operator@example.com';
const ATHLETE = 'a-route-consent';

const { default: app } = await import('../index.js');
const { default: db } = await import('../db/client.js');
const { createOperator, resetLoginLimits } = await import('../lib/operatorAuth.js');

let server; let base; let cookie; let operatorId;

const api = (route, opts = {}) => fetch(`${base}${route}`, {
  redirect: 'manual',
  ...opts,
  headers: {
    ...(opts.body ? { 'Content-Type': 'application/json', Origin: ORIGIN } : {}),
    ...(opts.cookie === false ? {} : cookie ? { Cookie: cookie } : {}),
    ...opts.headers,
  },
});

beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  db.exec(`DELETE FROM mailbox_oauth_transactions; DELETE FROM mailbox_consent_grants;
           DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM operator_sessions; DELETE FROM operator_users; DELETE FROM players;`);
  resetLoginLimits();
  const user = await createOperator({ email: EMAIL, password: PASSWORD });
  operatorId = user.id;
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
    public_slug) VALUES (?, 'x', 'x', 'Jordan Fisher', 'MIDFIELD', 'mens-soccer', ?)`)
    .run(ATHLETE, randomUUID().slice(0, 10));

  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  cookie = (res.headers.getSetCookie?.() ?? [])[0]?.split(';')[0] ?? null;
});

const issueLink = async () => {
  const res = await api(`/api/players/${ATHLETE}/mailbox-consents`, {
    method: 'POST', body: JSON.stringify({ provider: 'GOOGLE' }),
  });
  return { status: res.status, body: await res.json() };
};
/** The token is the fragment now, which is the whole point of D3.1. */
const tokenOf = (url) => url.split('#').pop();
const CONSENT_PAGE = '/mailbox-consent';

/** POST a token the way the page's script does: in the body, never in the URL. */
const publicPost = (route, body, extra = {}) => fetch(`${base}${route}`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...extra },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------

describe('issuing a link is an operator action', () => {
  it('returns the URL once, with the athlete named for confirmation', async () => {
    const { status, body } = await issueLink();
    expect(status).toBe(201);
    expect(body.consent).toMatchObject({
      athlete_id: ATHLETE, athlete_name: 'Jordan Fisher', provider: 'GOOGLE',
    });
    // Root-mounted page, token AFTER the '#' — a browser never transmits it.
    expect(body.url).toMatch(/^http:\/\/localhost:5183\/mailbox-consent#[A-Za-z0-9_-]{43}$/);
  });

  it('is refused without a session', async () => {
    const res = await api(`/api/players/${ATHLETE}/mailbox-consents`, {
      method: 'POST', body: JSON.stringify({ provider: 'GOOGLE' }), cookie: false,
    });
    expect(res.status).toBe(401);
  });

  it('is refused from another origin', async () => {
    const res = await api(`/api/players/${ATHLETE}/mailbox-consents`, {
      method: 'POST', body: JSON.stringify({ provider: 'GOOGLE' }),
      headers: { Origin: 'https://evil.test' },
    });
    expect(res.status).toBe(403);
  });

  it('refuses an athlete that does not exist, and a provider that is not built', async () => {
    const missing = await api('/api/players/nobody/mailbox-consents', {
      method: 'POST', body: JSON.stringify({ provider: 'GOOGLE' }),
    });
    expect(missing.status).toBe(404);
    const wrong = await api(`/api/players/${ATHLETE}/mailbox-consents`, {
      method: 'POST', body: JSON.stringify({ provider: 'MICROSOFT' }),
    });
    expect(wrong.status).toBe(400);
  });

  it('never returns the token again', async () => {
    const { body } = await issueLink();
    const list = await api(`/api/players/${ATHLETE}/mailbox-consents`).then((r) => r.json());
    const raw = JSON.stringify(list);
    expect(raw).not.toContain(tokenOf(body.url));
    expect(raw).not.toMatch(/token_hmac|url/);
  });
});

// ---------------------------------------------------------------------------

describe('the athlete page carries no token at all', () => {
  it('is the same bytes for everybody, because the server was told nothing', async () => {
    const { body } = await issueLink();
    const withToken = await fetch(`${base}${CONSENT_PAGE}`); // the fragment never arrives
    const withNothing = await fetch(`${base}${CONSENT_PAGE}`);

    expect(withToken.status).toBe(200);
    const [a, b] = [await withToken.text(), await withNothing.text()];
    expect(a).toBe(b);
    // Nothing about this athlete, this grant, or any athlete.
    expect(a).not.toContain(tokenOf(body.url));
    expect(a).not.toContain('Jordan');
    expect(a).not.toContain(ATHLETE);
  });

  it('states what is and is not being asked for, before any script runs', async () => {
    const html = await fetch(`${base}${CONSENT_PAGE}`).then((r) => r.text());
    // The consent copy is server-rendered, so no client branch can alter it.
    expect(html).toContain('Continue with Google');
    expect(html).toContain('send email from this address');
    expect(html).toMatch(/read, open or search any email/);
    expect(html).toContain('<noscript>');
  });

  it('sets no cookie and offers no way into the application', async () => {
    const res = await fetch(`${base}${CONSENT_PAGE}`);
    const html = await res.text();
    // A capability is not a session.
    expect(res.headers.getSetCookie?.() ?? []).toHaveLength(0);
    expect(html).not.toMatch(/<a\s/i);
    expect(html).not.toContain(operatorId);
    expect(html).not.toContain(EMAIL);
  });

  it('serves its script from this origin, so the app CSP need not be loosened', async () => {
    const res = await fetch(`${base}${CONSENT_PAGE}/consent.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    const js = await res.text();
    // It reads the fragment and then removes it from the address bar.
    expect(js).toContain('window.location.hash');
    expect(js).toContain('history.replaceState');
    // And puts it nowhere that outlives the page.
    expect(js).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});

// ---------------------------------------------------------------------------

describe('resolving a link takes the token in the body', () => {
  it('returns the first name and nothing else, and burns nothing', async () => {
    const { body } = await issueLink();
    const res = await publicPost('/api/mailbox-consent/resolve', { token: tokenOf(body.url) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      ok: true, athlete_first_name: 'Jordan', provider: 'GOOGLE', ttl_minutes: 30,
    });
    // Resolving twice is still not consenting.
    await publicPost('/api/mailbox-consent/resolve', { token: tokenOf(body.url) });
    expect(db.prepare('SELECT consumed_at FROM mailbox_consent_grants').get().consumed_at).toBeNull();
  });

  it('refuses an unknown, revoked or absent token the same way', async () => {
    const unknown = await publicPost('/api/mailbox-consent/resolve', { token: 'x'.repeat(43) });
    expect(unknown.status).toBe(410);
    expect((await unknown.json()).message).toMatch(/not valid/);

    const empty = await publicPost('/api/mailbox-consent/resolve', {});
    expect(empty.status).toBe(410);

    const { body } = await issueLink();
    const id = db.prepare('SELECT id FROM mailbox_consent_grants').get().id;
    await api(`/api/mailbox-consents/${id}/revoke`, { method: 'POST', body: '{}' });
    const revoked = await publicPost('/api/mailbox-consent/resolve', { token: tokenOf(body.url) });
    expect(revoked.status).toBe(410);
    // Nothing tells the reader whether the link was ever real.
    expect((await revoked.json()).message).not.toMatch(/revoked|expired/i);
  });

  it('is refused from another origin, like every other mutation', async () => {
    const { body } = await issueLink();
    const res = await publicPost('/api/mailbox-consent/resolve',
      { token: tokenOf(body.url) }, { Origin: 'https://evil.test' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------

describe('starting the redirect hands back a URL rather than a 302', () => {
  it('returns Google authorization URL, and consumes nothing', async () => {
    const { body } = await issueLink();
    const res = await publicPost('/api/mailbox-consent/start', { token: tokenOf(body.url) });
    const data = await res.json();

    expect(res.status).toBe(200);
    const to = new URL(data.authorization_url);
    expect(to.origin).toBe('https://accounts.google.com');
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('access_type')).toBe('offline');
    // Still not consumed: the athlete has authorised nothing yet.
    expect(db.prepare('SELECT consumed_at FROM mailbox_consent_grants').get().consumed_at).toBeNull();
  });

  it('puts no secret in the URL it hands the browser', async () => {
    const { body } = await issueLink();
    const { authorization_url: url } = await publicPost('/api/mailbox-consent/start',
      { token: tokenOf(body.url) }).then((r) => r.json());

    const tx = db.prepare('SELECT * FROM mailbox_oauth_transactions').get();
    expect(url).not.toContain(tokenOf(body.url));      // not the capability
    expect(url).not.toContain('test-secret');          // not the client secret
    expect(url).not.toContain(tx.verifier_ciphertext); // and not the verifier
  });

  it('refuses a token it will not resolve', async () => {
    const res = await publicPost('/api/mailbox-consent/start', { token: 'x'.repeat(43) });
    expect(res.status).toBe(410);
  });
});

// ---------------------------------------------------------------------------

describe('the callback', () => {
  const startFlow = async () => {
    const { body } = await issueLink();
    const { authorization_url: url } = await publicPost('/api/mailbox-consent/start',
      { token: tokenOf(body.url) }).then((r) => r.json());
    return new URL(url).searchParams.get('state');
  };

  it('refuses a state it never minted', async () => {
    const res = await fetch(`${base}/api/mailbox-consent/google/callback?state=forged&code=c`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('was not connected');
  });

  it('spends the state even when the athlete cancels, and keeps the link alive', async () => {
    const state = await startFlow();
    const denied = await fetch(`${base}/api/mailbox-consent/google/callback?state=${state}&error=access_denied`);
    expect(denied.status).toBe(400);
    expect(await denied.text()).toContain('cancelled');

    // The state is spent — a nonce that survives its own callback is not one.
    const replay = await fetch(`${base}/api/mailbox-consent/google/callback?state=${state}&code=c`);
    expect(await replay.text()).toContain('already been completed');
    // The grant is not: the athlete may follow the link again.
    expect(db.prepare('SELECT consumed_at FROM mailbox_consent_grants').get().consumed_at).toBeNull();
  });

  it('refuses a replay of a successful-looking callback', async () => {
    const state = await startFlow();
    await fetch(`${base}/api/mailbox-consent/google/callback?state=${state}&code=c`);
    const again = await fetch(`${base}/api/mailbox-consent/google/callback?state=${state}&code=c`);
    expect(await again.text()).toContain('already been completed');
  });

  it('needs no session, and issues none', async () => {
    const state = await startFlow();
    const res = await fetch(`${base}/api/mailbox-consent/google/callback?state=${state}&code=c`);
    // Google's redirect carries no cookie of ours; the state is the authority.
    expect(res.status).not.toBe(401);
    expect(res.headers.getSetCookie?.() ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('the public surface is exactly the five routes D3.1 leaves', () => {
  /**
   * The token-in-path routes D3 shipped are GONE, not merely unused. A route
   * that still resolves a capability out of a URL would still write it to a
   * log, however few callers use it.
   */
  it('no longer answers on any token-bearing path', async () => {
    const { body } = await issueLink();
    const token = tokenOf(body.url);
    const tried = [
      ['GET', `/api/mailbox-consent/${token}`],
      ['POST', `/api/mailbox-consent/${token}/start`],
      ['GET', `/mailbox-consent/${token}`],
    ];
    for (const [method, route] of tried) {
      const res = await fetch(`${base}${route}`, {
        method, redirect: 'manual',
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: method === 'GET' ? undefined : '{}',
      });
      /**
       * 401 under /api — the path fell through to `requireOperator`, which is
       * the correct destination for a route that no longer exists: it is now
       * INSIDE the boundary, not a forgotten public one. 404 at the root.
       */
      expect([401, 404], route).toContain(res.status);
      expect(await res.text(), route).not.toContain('Continue with Google');
    }
    // And the grant is untouched by all of it.
    expect(db.prepare('SELECT consumed_at FROM mailbox_consent_grants').get().consumed_at).toBeNull();
  });

  const PROTECTED = [
    ['POST', `/api/players/${ATHLETE}/mailbox-consents`, 'issuing a link'],
    ['GET', `/api/players/${ATHLETE}/mailbox-consents`, 'listing links'],
    ['GET', `/api/players/${ATHLETE}/mailboxes`, 'mailbox status'],
    ['POST', '/api/mailbox-consents/any-id/revoke', 'revoking a link'],
  ];

  it.each(PROTECTED)('%s %s (%s) needs a session', async (method, route) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: method === 'GET' ? undefined : '{}',
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Sign in to continue.');
  });

  it('left every existing protected route protected', async () => {
    for (const route of ['/api/entities/players', '/api/coaches/email-status', '/api/reports']) {
      expect((await fetch(`${base}${route}`)).status, route).toBe(401);
    }
  });

  it('added no public mailbox management', async () => {
    // Reading or listing mailboxes without a session must not be possible by
    // any path the consent router opened.
    for (const route of ['/api/mailboxes', `/api/players/${ATHLETE}/mailboxes`,
      '/api/mailbox-consent/any/credential', '/api/mailboxes/any/credential']) {
      const res = await fetch(`${base}${route}`);
      expect([401, 404], route).toContain(res.status);
      expect(await res.text(), route).not.toMatch(/ciphertext|refresh|auth_tag/);
    }
  });
});

// ---------------------------------------------------------------------------

describe('nothing secret is persisted or served', () => {
  it('holds no raw token, state, verifier, code or credential in the clear', async () => {
    const { body } = await issueLink();
    const { authorization_url: url } = await publicPost('/api/mailbox-consent/start',
      { token: tokenOf(body.url) }).then((r) => r.json());
    const state = new URL(url).searchParams.get('state');
    await fetch(`${base}/api/mailbox-consent/google/callback?state=${state}&code=an-auth-code`);

    const dump = ['mailbox_consent_grants', 'mailbox_oauth_transactions',
      'connected_mailboxes', 'connected_mailbox_credentials']
      .map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all())).join('\n');

    for (const secret of [tokenOf(body.url), state, 'an-auth-code', 'test-secret']) {
      expect(dump, secret.slice(0, 12)).not.toContain(secret);
    }
  });

  it('serves the operator no credential material', async () => {
    await issueLink();
    const text = await api(`/api/players/${ATHLETE}/mailboxes`).then((r) => r.text());
    expect(text).not.toMatch(/ciphertext|iv|auth_tag|key_version|refresh|token/i);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE INVARIANT D3.1 EXISTS FOR, MEASURED RATHER THAN ASSERTED.
 *
 * A logging proxy is put in front of the REAL application and the whole flow is
 * driven through it, recording what nginx's combined format and Render's HTTP
 * request logs record: the request line, and the `Referer`. Render documents
 * `path` as a filterable field of its request logs, retained for 7–30 days and
 * optionally streamed onward, so "the platform probably does not log URLs" was
 * never a defence available to us.
 *
 * Against D3's route shape this test found the raw token in two of four lines,
 * and twice in one of them. It must now find it in none.
 */
describe('the capability never reaches a URL', () => {
  let proxy; let proxyBase; let lines;

  const runFlow = async (origin) => {
    // The operator issues the link on the real base; only the athlete's half
    // of the flow needs to go through the proxy.
    const { body } = await issueLink();
    const token = tokenOf(body.url);
    const post = (route, payload, referer) => fetch(`${proxyBase}${route}`, {
      method: 'POST', redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        // The page sends none, by its referrer policy. Sent anyway, so this
        // proves the token is absent even from a browser that leaks more.
        ...(referer ? { Referer: referer } : {}),
      },
      body: JSON.stringify(payload),
    });

    const pageUrl = `${proxyBase}/mailbox-consent`;
    await fetch(pageUrl);                                  // the athlete opens the link
    await fetch(`${pageUrl}/consent.js`);                  // the page loads its script
    await post('/api/mailbox-consent/resolve', { token }, pageUrl);
    const started = await post('/api/mailbox-consent/start', { token }, pageUrl);
    const { authorization_url: authUrl } = await started.json();
    const state = new URL(authUrl).searchParams.get('state');
    await fetch(`${proxyBase}/api/mailbox-consent/google/callback?state=${state}&code=a-code`);
    return { token, authUrl };
  };

  beforeEach(async () => {
    lines = [];
    const front = express();
    front.use((req, _res, next) => {
      lines.push(`"${req.method} ${req.originalUrl}" referer="${req.headers.referer ?? '-'}"`);
      next();
    });
    front.use(app);
    await new Promise((resolve) => { proxy = front.listen(0, '127.0.0.1', resolve); });
    proxyBase = `http://127.0.0.1:${proxy.address().port}`;
  });
  afterEach(() => new Promise((resolve) => proxy.close(resolve)));

  it('appears in no request line and no Referer, anywhere in the flow', async () => {
    const { token } = await runFlow(ORIGIN);

    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) expect(line, line).not.toContain(token);
    // Not a prefix of it either — a truncated secret is still a head start.
    for (const line of lines) expect(line, line).not.toContain(token.slice(0, 16));
  });

  it('does not leak it to Google either, only the ten-minute state', async () => {
    const { token, authUrl } = await runFlow(ORIGIN);
    expect(authUrl).not.toContain(token);

    // `state` IS in a URL, unavoidably — OAuth returns it in a query string.
    // That is why it is a different secret with a different lifetime.
    const state = new URL(authUrl).searchParams.get('state');
    expect(lines.some((l) => l.includes(state))).toBe(true);
    const tx = db.prepare('SELECT state_hmac, consumed_at, expires_at FROM mailbox_oauth_transactions').get();
    expect(tx.state_hmac).not.toContain(state); // stored only as an HMAC
    expect(tx.consumed_at).not.toBeNull();      // and already spent by the callback
  });
});
