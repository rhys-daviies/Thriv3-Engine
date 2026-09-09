/**
 * THE MAILBOX CONSENT SURFACE, END TO END — Phase D3.
 *
 * Bound to the REAL application, like `auth.test.js`, and for the same reason:
 * D3 adds the first new public surface since hosting, and whether it is
 * correctly placed around `requireOperator` is a property of the middleware
 * order in `server/index.js`, not of a reconstruction of it.
 *
 * The three questions asked here are the three trust boundaries: can an
 * athlete with a token do the one thing, can they do anything else, and can
 * somebody without a token or a session do either.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

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
const tokenOf = (url) => url.split('/').pop();

// ---------------------------------------------------------------------------

describe('issuing a link is an operator action', () => {
  it('returns the URL once, with the athlete named for confirmation', async () => {
    const { status, body } = await issueLink();
    expect(status).toBe(201);
    expect(body.consent).toMatchObject({
      athlete_id: ATHLETE, athlete_name: 'Jordan Fisher', provider: 'GOOGLE',
    });
    expect(body.url).toMatch(/^http:\/\/localhost:5183\/api\/mailbox-consent\/[A-Za-z0-9_-]{43}$/);
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

describe('the athlete page needs no account', () => {
  it('is served to somebody with no session at all', async () => {
    const { body } = await issueLink();
    const res = await fetch(body.url.replace('http://localhost:5183', base));
    const html = await res.text();

    expect(res.status).toBe(200);
    // Their own first name, so they know the link is theirs.
    expect(html).toContain('Jordan');
    expect(html).toContain('Continue with Google');
    // What is and is not being asked for.
    expect(html).toContain('send email from this address');
    expect(html).toMatch(/read, open or search any email/);
  });

  it('sets no cookie and offers no way into the application', async () => {
    const { body } = await issueLink();
    const res = await fetch(body.url.replace('http://localhost:5183', base));
    const html = await res.text();
    // A capability is not a session.
    expect(res.headers.getSetCookie?.() ?? []).toHaveLength(0);
    expect(html).not.toMatch(/<a\s/i);
    // No internal identifiers, no campaign, no operator data.
    expect(html).not.toContain(ATHLETE);
    expect(html).not.toContain(operatorId);
    expect(html).not.toContain(EMAIL);
  });

  it('refuses an unknown, expired or revoked link the same way', async () => {
    const unknown = await fetch(`${base}/api/mailbox-consent/${'x'.repeat(43)}`);
    expect(unknown.status).toBe(410);
    expect(await unknown.text()).toContain('cannot be used');

    const { body } = await issueLink();
    const id = db.prepare('SELECT id FROM mailbox_consent_grants').get().id;
    await api(`/api/mailbox-consents/${id}/revoke`, { method: 'POST', body: '{}' });
    const revoked = await fetch(body.url.replace('http://localhost:5183', base));
    expect(revoked.status).toBe(410);
    // Nothing tells the reader whether the link was ever real.
    expect(await revoked.text()).not.toMatch(/revoked|expired/i);
  });

  it('sends the athlete to Google, and burns nothing by being opened', async () => {
    const { body } = await issueLink();
    const url = body.url.replace('http://localhost:5183', base);
    await fetch(url); await fetch(url);
    expect(db.prepare('SELECT consumed_at FROM mailbox_consent_grants').get().consumed_at).toBeNull();

    const start = await fetch(`${url}/start`, { method: 'POST', headers: { Origin: ORIGIN }, redirect: 'manual' });
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get('location'));
    expect(to.origin).toBe('https://accounts.google.com');
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('access_type')).toBe('offline');
    // Still not consumed: the athlete has authorised nothing yet.
    expect(db.prepare('SELECT consumed_at FROM mailbox_consent_grants').get().consumed_at).toBeNull();
  });

  it('puts no secret in the redirect it sends the browser', async () => {
    const { body } = await issueLink();
    const url = body.url.replace('http://localhost:5183', base);
    const start = await fetch(`${url}/start`, { method: 'POST', headers: { Origin: ORIGIN }, redirect: 'manual' });
    const location = start.headers.get('location');

    const tx = db.prepare('SELECT * FROM mailbox_oauth_transactions').get();
    expect(location).not.toContain(tokenOf(body.url));      // not the capability
    expect(location).not.toContain('test-secret');          // not the client secret
    expect(location).not.toContain(tx.verifier_ciphertext); // and not the verifier
  });
});

// ---------------------------------------------------------------------------

describe('the callback', () => {
  const startFlow = async () => {
    const { body } = await issueLink();
    const url = body.url.replace('http://localhost:5183', base);
    const start = await fetch(`${url}/start`, { method: 'POST', headers: { Origin: ORIGIN }, redirect: 'manual' });
    return new URL(start.headers.get('location')).searchParams.get('state');
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

describe('the public surface grew by exactly three routes', () => {
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
    const url = body.url.replace('http://localhost:5183', base);
    const start = await fetch(`${url}/start`, { method: 'POST', headers: { Origin: ORIGIN }, redirect: 'manual' });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
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
