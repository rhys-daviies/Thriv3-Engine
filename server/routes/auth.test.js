/**
 * THE PROTECTION BOUNDARY, END TO END — Phase 13K.
 *
 * This binds the REAL application — `server/index.js`, its middleware in its
 * real order — to an ephemeral port and talks to it over HTTP. A test that
 * builds its own Express app tests a reconstruction of the boundary, and the
 * boundary is the thing that has to be right: one missed `app.use` order and
 * the player list is public.
 *
 * So the sweep below asks for every protected surface with no session and
 * expects to be refused, and asks for the two deliberately public ones and
 * expects to be served.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.THRIV3_SCRYPT_COST = '14';
process.env.THRIV3_SESSION_SECRET = `integration-${'z'.repeat(40)}`;
process.env.THRIV3_APP_ORIGIN = 'http://localhost:5183';
process.env.THRIV3_REPORT_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-store-'));

const ORIGIN = 'http://localhost:5183';
const PASSWORD = 'a-perfectly-fine-passphrase';
const EMAIL = 'operator@example.com';

const { default: app } = await import('../index.js');
const { default: db } = await import('../db/client.js');
const { createOperator, resetLoginLimits, SESSION_COOKIE } = await import('../lib/operatorAuth.js');
const { STORE_ROOT } = await import('../lib/reportDelivery.js');

let server;
let base;

beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  db.exec('DELETE FROM operator_sessions; DELETE FROM operator_users;');
  resetLoginLimits();
  await createOperator({ email: EMAIL, password: PASSWORD });
});

/** Sign in and return the cookie header a browser would then send. */
async function signIn(email = EMAIL, password = PASSWORD) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : null;
  return { res, body: await res.json().catch(() => null), cookie };
}

/* -------------------------------------------------------------- signing in */

describe('signing in', () => {
  it('succeeds, and answers with an identity and an HttpOnly cookie', async () => {
    const { res, body, cookie } = await signIn();
    expect(res.status).toBe(200);
    expect(body).toEqual({ operator: { email: EMAIL } });
    // No hash, no id, no session token in the body.
    expect(JSON.stringify(body)).not.toMatch(/scrypt|password|token|\bid\b/);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // Not Secure here, because this test speaks http — and the runtime
    // contract refuses an http origin in production for exactly that reason.
    expect(cookie).toBeTruthy();
  });

  it('refuses a wrong password and an unknown address with one message', async () => {
    const wrong = await signIn(EMAIL, 'not-the-password');
    const unknown = await signIn('nobody@example.com', PASSWORD);
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    // Identical, so the response cannot be used to find out who has an account.
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error).toBe('Those details were not recognised.');
    expect(wrong.res.headers.get('set-cookie')).toBeNull();
  });

  it('refuses an empty submission without touching the account', async () => {
    for (const body of [{}, { email: EMAIL }, { password: PASSWORD }, { email: '', password: '' }]) {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(401);
    }
  });

  it('stops answering after enough attempts, and says so differently', async () => {
    let last;
    for (let i = 0; i < 12; i += 1) last = await signIn(EMAIL, `wrong-${i}-attempt`);
    expect(last.res.status).toBe(429);
    expect(last.body.code).toBe('rate_limited');

    // THE CEILING IS NOT A LOCKOUT. Resetting the window is what an operator
    // waiting five minutes does; an attacker cannot use the limit to keep the
    // real operator out for ever.
    resetLoginLimits();
    expect((await signIn()).res.status).toBe(200);
  });

  it('is refused from another origin, cookie or not', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('origin_rejected');
  });
});

/* ------------------------------------------------------------ the session */

describe('the session', () => {
  it('persists across requests', async () => {
    const { cookie } = await signIn();
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
      expect((await res.json()).operator).toEqual({ email: EMAIL });
    }
  });

  it('answers null for nobody rather than failing', async () => {
    const res = await fetch(`${base}/api/auth/me`);
    // "Am I signed in" is a question, not a protected resource: a 401 here
    // would make every page load look like a failure.
    expect(res.status).toBe(200);
    expect((await res.json()).operator).toBeNull();
  });

  it('is not accepted from a forged or edited cookie', async () => {
    const { cookie } = await signIn();
    const forged = [
      `${SESSION_COOKIE}=made-up-value`,
      `${cookie}x`,
      cookie.slice(0, -1),
      `${SESSION_COOKIE}=`,
    ];
    for (const bad of forged) {
      const res = await fetch(`${base}/api/entities/players`, { headers: { cookie: bad } });
      expect(res.status).toBe(401);
    }
  });

  it('stops working the moment it is signed out', async () => {
    const { cookie } = await signIn();
    expect((await fetch(`${base}/api/entities/players`, { headers: { cookie } })).status).toBe(200);

    const out = await fetch(`${base}/api/auth/logout`, {
      method: 'POST', headers: { cookie, Origin: ORIGIN },
    });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(new RegExp(`${SESSION_COOKIE}=;`));

    // THE COOKIE IS DEAD ON THE SERVER, not merely cleared in the browser.
    // Replaying the exact same header gets nothing.
    const replay = await fetch(`${base}/api/entities/players`, { headers: { cookie } });
    expect(replay.status).toBe(401);
  });

  it('signing out is idempotent and needs no session', async () => {
    const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Origin: ORIGIN } });
    expect(res.status).toBe(204);
  });
});

/* ------------------------------------------------ the unauthenticated sweep */

describe('with no session, nothing protected resolves', () => {
  const PROTECTED = [
    ['GET', '/api/entities/players', 'the athlete list'],
    ['GET', '/api/entities/players/any-id', 'one athlete'],
    ['GET', '/api/entities/colleges', 'the programme list'],
    ['GET', '/api/entities/roster_players', 'roster rows'],
    ['GET', '/api/reports/athletes', 'the delivery athlete picker'],
    ['GET', '/api/reports/programmes?q=mer', 'programme search'],
    ['GET', '/api/reports', 'generated-report history'],
    ['GET', '/api/reports/000000000000000000000000/download', 'a report artefact'],
    ['GET', '/api/philosophy/pool', 'benchmark pool status'],
    ['GET', '/api/philosophy/any-id/report.pdf', 'a programme report'],
    ['GET', '/api/players/any/philosophy/any/report.pdf', 'an athlete report'],
    ['GET', '/api/coaches/email-status', 'coach addresses'],
    ['GET', '/api/engagement/athlete/any-id', 'engagement data'],
    ['GET', '/api/engagement/sync', 'sync state'],
    ['GET', '/api/players/any-id/publish', 'publication state'],
    ['GET', '/uploads/anything.csv', 'an uploaded file'],
    ['POST', '/api/reports', 'generating a report'],
    ['POST', '/api/entities/players', 'creating an athlete'],
    ['POST', '/api/outreach/send', 'sending outreach'],
    ['POST', '/api/players/any-id/publish', 'publishing a profile'],
    ['POST', '/api/functions/buildGraduatingDatabase', 'a function call'],
    ['POST', '/api/csv-agent/chat', 'the CSV agent'],
    ['PUT', '/api/entities/players/any-id', 'editing an athlete'],
    ['DELETE', '/api/entities/players/any-id', 'deleting an athlete'],
  ];

  it.each(PROTECTED)('%s %s (%s) is refused', async (method, route) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: method === 'GET' ? undefined : '{}',
    });
    // 401 for a read, 401 for a write that came from the right origin: either
    // way the answer is "sign in", never data and never a redirect.
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain('Sign in to continue.');
    // Nothing about what exists behind the boundary leaks in the refusal.
    expect(body).not.toMatch(/full_name|college_name|sqlite|Error:|at Object/);
  });

  it('leaks nothing recognisable as athlete data in any refusal', async () => {
    const bodies = await Promise.all(PROTECTED
      .filter(([method]) => method === 'GET')
      .map(([, route]) => fetch(`${base}${route}`).then((r) => r.text())));
    const all = bodies.join('\n');
    expect(all).not.toMatch(/mercyhurst|davies|roster|position/i);
  });

  it('refuses a write from another origin before it refuses the session', async () => {
    // Ordering matters: the CSRF check runs first, so a cross-site POST is
    // rejected on its origin rather than being told whether a session existed.
    const res = await fetch(`${base}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});

/* ------------------------------------------------ what stays public, on purpose */

describe('the two deliberately public surfaces still work', () => {
  it('the event collector accepts an event with no session', async () => {
    // Called by athlete pages in coaches' browsers, cross-origin, with no
    // cookie. It answers 204 to everything, so it is not an oracle either.
    const res = await fetch(`${base}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'nonexistent', event_type: 'view', session_id: 'abc' }),
    });
    expect(res.status).toBe(204);
  });

  it('the collector answers a preflight from another origin', async () => {
    const res = await fetch(`${base}/api/track`, {
      method: 'OPTIONS', headers: { Origin: 'https://thriv3-profiles.pages.dev' },
    });
    expect(res.status).toBeLessThan(300);
  });

  it('a public athlete page answers with no session', async () => {
    const res = await fetch(`${base}/p/nosuchslug`);
    // 200 with the neutral page: an unknown slug and a revoked one must be
    // indistinguishable. What matters here is that the boundary did not eat it.
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/html/);
  });

  it('a public athlete page cannot be fetched straight off disk, bypassing revocation', async () => {
    // The static mount sits behind the gated route, and the handler strips
    // `.html` so both spellings reach it. If this ever returned a profile,
    // deactivating an athlete would stop event collection while every link
    // already in an inbox kept rendering.
    for (const route of ['/p/nosuchslug.html', '/p/nosuchslug.HTML']) {
      const res = await fetch(`${base}${route}`);
      const body = await res.text();
      expect(body).not.toMatch(/<video|highlights|position/i);
    }
  });

  it('the health endpoint answers, and says nothing private', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.checks).toEqual({ process: true, database: true, reportStore: true });
    // No version, no counts, no paths, no environment.
    expect(JSON.stringify(body)).not.toMatch(/\//);
    expect(Object.keys(body).sort()).toEqual(['checks', 'status', 'uptimeSeconds']);
  });
});

/* ---------------------------------------------------------------- headers */

describe('the security headers', () => {
  it('are on an API response', async () => {
    const res = await fetch(`${base}/api/auth/me`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    // No HSTS over plain http: on a shared localhost the browser would
    // remember it and apply it to every other project on 127.0.0.1.
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('include a content-security policy for the operator app', async () => {
    const res = await fetch(`${base}/api/auth/me`);
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // Remote college crests are real, so images cannot be 'self' — but they
    // are restricted to https so a stored http URL cannot downgrade the page.
    expect(csp).toContain('img-src');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
  });

  it('do NOT impose that policy on the public athlete pages', async () => {
    // Those pages carry an inline tracker and a YouTube embed. The operator
    // app's policy would break both, and silently: a page that renders with a
    // dead tracker looks fine.
    const res = await fetch(`${base}/p/nosuchslug`);
    expect(res.headers.get('content-security-policy')).toBeNull();
    // Everything that cannot break them still applies.
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

/* ---------------------------------------------------- protected downloads */

describe('report artefacts are only reachable through the protected route', () => {
  const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

  beforeEach(() => {
    db.exec('DELETE FROM generated_reports');
    fs.mkdirSync(STORE_ROOT, { recursive: true });
    fs.writeFileSync(path.join(STORE_ROOT, `${ID}.pdf`), Buffer.from('%PDF-1.7\n% test\n'));
    db.prepare(`INSERT INTO generated_reports
      (id, report_type, athlete_id, college_id, sport, athlete_name, college_name,
       filename, artifact_path, page_count, byte_size, sha256, content_sha256, engine_sha,
       status, error, generated_at)
      VALUES (?, 'athlete', 'p1', 'c1', 'mens-soccer', 'Test Athlete', 'Test College',
       'Thriv3_Test_Athlete_Test_College_Mens_Soccer.pdf', ?, 3, 16, 'x', 'y', 'z',
       'generated', NULL, '2026-09-03T00:00:00.000Z')`).run(ID, `${ID}.pdf`);
  });

  it('is refused with no session', async () => {
    const res = await fetch(`${base}/api/reports/${ID}/download`);
    expect(res.status).toBe(401);
    // An artefact id is not a capability: knowing it grants nothing.
    expect(await res.text()).not.toContain('%PDF');
  });

  it('is served to a session, under the canonical filename', async () => {
    const { cookie } = await signIn();
    const res = await fetch(`${base}/api/reports/${ID}/download`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition'))
      .toContain('Thriv3_Test_Athlete_Test_College_Mens_Soccer.pdf');
    expect(Buffer.from(await res.arrayBuffer()).toString('latin1')).toContain('%PDF');
  });

  it('still refuses traversal and nonsense ids, with a session', async () => {
    const { cookie } = await signIn();
    for (const id of [
      '../../../etc/passwd', '..%2F..%2F..%2Fetc%2Fpasswd', '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      `${ID}/../../../../etc/passwd`, "' OR 1=1--", 'aaaa', `${ID}A`, 'a'.repeat(24).toUpperCase(),
    ]) {
      const res = await fetch(`${base}/api/reports/${encodeURIComponent(id)}/download`,
        { headers: { cookie } });
      expect([400, 404]).toContain(res.status);
      const body = await res.text();
      expect(body).not.toContain('root:');
      expect(body).not.toContain('%PDF');
    }
  });

  it('answers a safe 404 for an artefact that is not on file', async () => {
    const { cookie } = await signIn();
    const res = await fetch(`${base}/api/reports/bbbbbbbbbbbbbbbbbbbbbbbb/download`,
      { headers: { cookie } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('That report is not on file.');
  });

  it('does not serve the store statically, session or not', async () => {
    const { cookie } = await signIn();
    for (const route of [
      `/reports/${ID}.pdf`, `/server/reports/${ID}.pdf`, `/api/reports/${ID}.pdf`,
    ]) {
      for (const headers of [{}, { cookie }]) {
        const res = await fetch(`${base}${route}`, { headers });
        expect(res.headers.get('content-type') || '').not.toContain('application/pdf');
      }
    }
  });
});

/* ------------------------------------------------------- unknown endpoints */

describe('an unknown API path', () => {
  it('answers JSON, not the operator app\'s HTML', async () => {
    const { cookie } = await signIn();
    const res = await fetch(`${base}/api/no-such-thing`, { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect((await res.json()).error).toBe('No such endpoint.');
  });
});
