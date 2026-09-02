/**
 * OPERATOR ACCESS — Phase 13K.
 *
 * The properties that matter are the ones an attacker uses: what a failed
 * sign-in reveals, whether a password can be recovered from what is stored,
 * whether a session outlives the thing that should have ended it. Those are
 * what this file tests, rather than that the functions return values.
 *
 * The work factor is turned down for the suite (log2 N = 14 rather than 16),
 * because a hundred real hashes is twenty seconds. The parameters travel with
 * each hash, so this exercises the same code path at a cheaper cost.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import crypto from 'node:crypto';

process.env.THRIV3_SCRYPT_COST = '14';
process.env.THRIV3_SESSION_SECRET = `test-${'x'.repeat(40)}`;

const {
  hashPassword, verifyPassword, createOperator, authenticate, passwordProblem,
  createSession, resolveSession, destroySession, destroyUserSessions, sweepSessions,
  setOperatorActive, normaliseEmail, looksLikeEmail, operatorCount, listOperators,
  readCookie, SESSION_COOKIE, requireOperator, requireSameOrigin,
  setSessionCookie, resetLoginLimits, loginByIp, loginByEmail,
} = await import('./operatorAuth.js');
const { default: db } = await import('../db/client.js');

const PASSWORD = 'a-perfectly-fine-passphrase';

beforeEach(() => {
  db.exec('DELETE FROM operator_sessions; DELETE FROM operator_users;');
  resetLoginLimits();
});

/* --------------------------------------------------------------- passwords */

describe('what is stored is not the password', () => {
  it('never contains the password, in any encoding', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(Buffer.from(PASSWORD).toString('base64'));
    expect(stored).not.toContain(Buffer.from(PASSWORD).toString('hex'));
  });

  it('is salted, so the same password hashes differently every time', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toEqual(b);
    // ...and both still verify, which is the point of a salt rather than a
    // pepper: two operators with the same password share no hash, so cracking
    // one does not crack the other and a rainbow table is useless.
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(PASSWORD, b)).toBe(true);
  });

  it('carries its own parameters, so a future work factor does not lock anybody out', async () => {
    const cheap = await hashPassword(PASSWORD, { cost: 14 });
    const dear = await hashPassword(PASSWORD, { cost: 15 });
    expect(cheap).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(dear).toMatch(/^scrypt\$32768\$8\$1\$/);
    // Verified against the cost each was made at, not the current default.
    expect(await verifyPassword(PASSWORD, cheap)).toBe(true);
    expect(await verifyPassword(PASSWORD, dear)).toBe(true);
  });

  it('refuses a wrong password and every near-miss', async () => {
    const stored = await hashPassword(PASSWORD);
    for (const wrong of [
      '', 'wrong', PASSWORD.slice(0, -1), `${PASSWORD} `, PASSWORD.toUpperCase(),
    ]) {
      expect(await verifyPassword(wrong, stored)).toBe(false);
    }
  });

  it('uses the whole password, however long', async () => {
    // bcrypt silently ignores everything past 72 bytes, so a long passphrase
    // and its 72-character prefix are one password. scrypt has no such limit,
    // and this is the test that would notice if the algorithm were swapped.
    const long = `${'long-passphrase-'.repeat(6)}tail`;
    expect(long.length).toBeGreaterThan(90);
    const stored = await hashPassword(long);
    expect(await verifyPassword(long, stored)).toBe(true);
    expect(await verifyPassword(long.slice(0, 72), stored)).toBe(false);
  });

  it('refuses a malformed or hostile stored value instead of throwing', async () => {
    for (const junk of [
      null, undefined, '', 'not-a-hash', 'scrypt$$$$', 'scrypt$0$8$1$x$y',
      'scrypt$notanumber$8$1$x$y', 'scrypt$16385$8$1$x$y', // N must be a power of two
      'bcrypt$16384$8$1$x$y', `scrypt$16384$8$1$${'x'.repeat(9999)}$y`,
      // THE ONE THAT WAS ACCEPTED. 'y' is zero bytes of base64, so the stored
      // key was empty, a zero-length derivation compared equal to it, and this
      // row would have accepted any password at all. Nothing writes such a
      // row; a restored backup or a hand-edited one could hold it.
      'scrypt$16384$8$1$c2FsdHNhbHQ=$y',
      'scrypt$16384$8$1$c2FsdHNhbHQ=$',
      // A one-byte salt is not a salt.
      `scrypt$16384$8$1$eA==$${'A'.repeat(88)}`,
    ]) {
      expect(await verifyPassword(PASSWORD, junk)).toBe(false);
    }
  });

  it('holds one length rule and no composition rules', () => {
    expect(passwordProblem('short')).toMatch(/12 characters/);
    expect(passwordProblem('            ')).toMatch(/whitespace/);
    expect(passwordProblem('x'.repeat(600))).toMatch(/at most/);
    // No "needs a capital and a symbol": NIST dropped composition rules
    // because they measurably produce worse passwords.
    expect(passwordProblem('correcthorsebatterystaple')).toBeNull();
    expect(passwordProblem('안녕하세요 반갑습니다 정말')).toBeNull();
  });
});

/* ------------------------------------------------------------------- accounts */

describe('accounts exist because somebody with shell access made one', () => {
  it('creates one, and stores the address lowercased', async () => {
    const { id, created } = await createOperator({ email: '  Rhys@Example.COM ', password: PASSWORD });
    expect(created).toBe(true);
    const row = db.prepare('SELECT * FROM operator_users WHERE id = ?').get(id);
    expect(row.email).toBe('rhys@example.com');
    expect(row.active).toBe(1);
    expect(row.last_login_at).toBeNull();
    expect(row.password_hash).not.toContain(PASSWORD);
  });

  it('refuses a second account for one address unless a reset is asked for', async () => {
    await createOperator({ email: 'a@b.co', password: PASSWORD });
    await expect(createOperator({ email: 'A@B.CO', password: PASSWORD }))
      .rejects.toThrow(/already has an account/);
    expect(operatorCount()).toBe(1);
  });

  it('ends every session when a password is reset', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const token = createSession(id);
    expect(resolveSession(token)).not.toBeNull();

    await createOperator({ email: 'a@b.co', password: 'a-different-passphrase', reset: true });

    // Otherwise "I reset it because I think somebody had my password" changes
    // nothing at all for the person who had it.
    expect(resolveSession(token)).toBeNull();
    expect(await authenticate({ email: 'a@b.co', password: PASSWORD })).toBeNull();
    expect(await authenticate({ email: 'a@b.co', password: 'a-different-passphrase' })).toBeTruthy();
  });

  it('refuses an address that is not one', async () => {
    for (const bad of ['', 'rhys', 'rhys@', '@example.com', 'a b@c.co', null]) {
      await expect(createOperator({ email: bad, password: PASSWORD })).rejects.toThrow();
    }
  });

  it('deactivation stops sign-in and ends live sessions', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const token = createSession(id);
    setOperatorActive(id, false);

    expect(resolveSession(token)).toBeNull();
    expect(await authenticate({ email: 'a@b.co', password: PASSWORD })).toBeNull();
    expect(operatorCount()).toBe(0);
    // The account is still there, so history attributed to it still reads.
    expect(listOperators()).toHaveLength(1);

    setOperatorActive(id, true);
    expect(await authenticate({ email: 'a@b.co', password: PASSWORD })).toBeTruthy();
  });

  it('records the last sign-in, and only on a successful one', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    await authenticate({ email: 'a@b.co', password: 'wrong-but-long-enough' });
    expect(db.prepare('SELECT last_login_at l FROM operator_users WHERE id = ?').get(id).l)
      .toBeNull();
    await authenticate({ email: 'a@b.co', password: PASSWORD });
    expect(db.prepare('SELECT last_login_at l FROM operator_users WHERE id = ?').get(id).l)
      .toBeTruthy();
  });

  it('normalises and validates addresses the same way everywhere', () => {
    expect(normaliseEmail(' A@B.CO ')).toBe('a@b.co');
    expect(looksLikeEmail('a@b.co')).toBe(true);
    expect(looksLikeEmail('a@b')).toBe(false);
  });
});

/* -------------------------------------------------- user enumeration */

describe('a failed sign-in reveals nothing about who has an account', () => {
  beforeAll(async () => {
    // Warm the decoy hash before timing anything, so its one-off cost is not
    // measured as the unknown-address path being slower.
    await authenticate({ email: 'nobody@example.com', password: PASSWORD });
  });

  it('answers identically for an unknown address, a wrong password and a dead account', async () => {
    const { id } = await createOperator({ email: 'known@example.com', password: PASSWORD });
    expect(await authenticate({ email: 'unknown@example.com', password: PASSWORD })).toBeNull();
    expect(await authenticate({ email: 'known@example.com', password: 'wrong-but-long' })).toBeNull();
    setOperatorActive(id, false);
    expect(await authenticate({ email: 'known@example.com', password: PASSWORD })).toBeNull();
  });

  it('takes comparable time whether or not the address exists', async () => {
    await createOperator({ email: 'known@example.com', password: PASSWORD });

    const median = async (email) => {
      const runs = [];
      for (let i = 0; i < 5; i += 1) {
        const started = process.hrtime.bigint();
        await authenticate({ email, password: 'a-wrong-password-here' });
        runs.push(Number(process.hrtime.bigint() - started) / 1e6);
      }
      return runs.sort((a, b) => a - b)[2];
    };

    const known = await median('known@example.com');
    const unknown = await median('unknown@example.com');

    // THE DECOY HASH IS WHAT MAKES THIS TRUE. Without it the unknown address
    // returns before scrypt runs, and the difference — milliseconds against
    // hundreds — is a reliable oracle for "does this person have an account",
    // no matter how identical the wording is.
    expect(unknown).toBeGreaterThan(known * 0.4);
    expect(unknown).toBeLessThan(known * 2.5);
  });
});

/* -------------------------------------------------------------------- sessions */

describe('sessions live on the server', () => {
  it('stores no token, only a keyed hash of one', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const token = createSession(id);
    const rows = db.prepare('SELECT * FROM operator_sessions').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].token_sha256).not.toBe(token);
    expect(JSON.stringify(rows[0])).not.toContain(token);
    // Not a plain digest either: an HMAC under the session secret, so
    // rotating the secret invalidates every session.
    expect(rows[0].token_sha256)
      .not.toBe(crypto.createHash('sha256').update(token).digest('hex'));
  });

  it('resolves a live session and refuses a forged, truncated or empty one', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const token = createSession(id);
    expect(resolveSession(token).user.email).toBe('a@b.co');

    for (const bad of [
      null, undefined, '', 'x', `${token}x`, token.slice(0, -1), token.toUpperCase(),
      crypto.randomBytes(32).toString('base64url'),
    ]) {
      expect(resolveSession(bad)).toBeNull();
    }
  });

  it('expires on the idle deadline, and deletes the row on the way past', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const token = createSession(id, { now: Date.now() });

    const thirteenHoursOn = Date.now() + 13 * 3600_000;
    expect(resolveSession(token, { now: thirteenHoursOn })).toBeNull();
    // Gone, not merely refused — so a stolen cookie stops working at the
    // deadline whether or not anything ever sweeps.
    expect(db.prepare('SELECT COUNT(*) n FROM operator_sessions').get().n).toBe(0);
  });

  it('expires after the idle window even inside the absolute lifetime', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const start = Date.now();
    const token = createSession(id, { now: start });
    // Idle is 12 hours and the absolute lifetime is 7 days. A laptop closed
    // overnight is signed out in the morning, which is the intended shape.
    expect(resolveSession(token, { now: start + 11 * 3600_000 })).not.toBeNull();

    // A SECOND SESSION, because the line above is itself activity: resolving
    // at eleven hours slides the deadline to twenty-three, so asking the same
    // token about thirteen hours would be asking about a session that has just
    // been used. Which is right, and is why this needs its own.
    const untouched = createSession(id, { now: start });
    expect(resolveSession(untouched, { now: start + 13 * 3600_000 })).toBeNull();
  });

  it('slides the idle deadline while in use, but never past the absolute one', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const start = Date.now();
    const token = createSession(id, { now: start });
    const absolute = db.prepare('SELECT absolute_expires_at a FROM operator_sessions').get().a;

    // Used every six hours: each use pushes the idle deadline forward, so a
    // working week never signs the operator out mid-task.
    for (let hours = 6; hours <= 6 * 24; hours += 6) {
      expect(resolveSession(token, { now: start + hours * 3600_000 })).not.toBeNull();
    }
    // ...and the pushed deadline is clamped to the absolute one throughout.
    expect(db.prepare('SELECT expires_at e FROM operator_sessions').get().e <= absolute)
      .toBe(true);

    // Eight days in it is over regardless of activity: a session that renews
    // for ever is a credential nobody ever rotates.
    expect(resolveSession(token, { now: start + 8 * 86_400_000 })).toBeNull();
  });

  it('signing out deletes the session, and is idempotent', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const token = createSession(id);
    expect(destroySession(token)).toBe(true);
    expect(resolveSession(token)).toBeNull();
    expect(destroySession(token)).toBe(false);
    expect(destroySession(null)).toBe(false);
  });

  it('ends one operator\'s sessions without touching another\'s', async () => {
    const a = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const b = await createOperator({ email: 'b@b.co', password: PASSWORD });
    const tokenA = createSession(a.id);
    const tokenB = createSession(b.id);
    expect(destroyUserSessions(a.id)).toBe(1);
    expect(resolveSession(tokenA)).toBeNull();
    expect(resolveSession(tokenB)).not.toBeNull();
  });

  it('sweeps expired rows without touching live ones', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const old = createSession(id, { now: Date.now() - 20 * 86_400_000 });
    const fresh = createSession(id);
    expect(sweepSessions()).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM operator_sessions').get().n).toBe(1);
    expect(resolveSession(fresh)).not.toBeNull();
    expect(old).toBeTruthy();
  });

  it('rotating the session secret invalidates every session', async () => {
    const { id } = await createOperator({ email: 'a@b.co', password: PASSWORD });
    const token = createSession(id);
    expect(resolveSession(token)).not.toBeNull();

    const previous = process.env.THRIV3_SESSION_SECRET;
    process.env.THRIV3_SESSION_SECRET = `rotated-${'y'.repeat(40)}`;
    try {
      // The stored key was made under the old secret, so it cannot be
      // recomputed — which is the "sign everybody out now" lever.
      expect(resolveSession(token)).toBeNull();
    } finally {
      process.env.THRIV3_SESSION_SECRET = previous;
    }
    expect(resolveSession(token)).not.toBeNull();
  });
});

/* ------------------------------------------------------------------- cookies */

describe('the session cookie', () => {
  it('is HttpOnly, SameSite=Lax and path-scoped', () => {
    const set = [];
    const res = { cookie: (name, value, options) => set.push({ name, value, options }) };
    setSessionCookie(res, 'token-value', {
      cookieSecure: true, sessionIdleHours: 12, production: true,
    });
    expect(set[0].name).toBe(SESSION_COOKIE);
    expect(set[0].options).toMatchObject({
      httpOnly: true, sameSite: 'lax', secure: true, path: '/',
    });
  });

  it('is not Secure over plain http, which is what makes local development work', () => {
    const set = [];
    const res = { cookie: (name, value, options) => set.push({ options }) };
    setSessionCookie(res, 'token-value', {
      cookieSecure: false, sessionIdleHours: 12, production: false,
    });
    expect(set[0].options.secure).toBe(false);
  });

  it('is read out of a header holding several cookies', () => {
    const req = { headers: { cookie: `other=1; ${SESSION_COOKIE}=abc123; third=x` } };
    expect(readCookie(req, SESSION_COOKIE)).toBe('abc123');
    expect(readCookie({ headers: {} }, SESSION_COOKIE)).toBeNull();
    expect(readCookie({ headers: { cookie: 'malformed' } }, SESSION_COOKIE)).toBeNull();
  });
});

/* ---------------------------------------------------------------- middleware */

describe('the middleware refuses before it allows', () => {
  const fakeRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  };

  it('requireOperator answers 401 with a sentence, never a redirect', () => {
    const res = fakeRes();
    let passed = false;
    requireOperator({}, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('unauthenticated');
    // A 302 to a login page is what turns "you are signed out" into a JSON
    // parse error in the browser console.
    expect(res.body).not.toHaveProperty('redirect');
  });

  it('requireOperator lets a session through', () => {
    let passed = false;
    requireOperator({ operator: { id: 'x', email: 'a@b.co' } }, fakeRes(), () => { passed = true; });
    expect(passed).toBe(true);
  });

  it('requireSameOrigin ignores reads and checks writes', () => {
    const previous = process.env.THRIV3_APP_ORIGIN;
    process.env.THRIV3_APP_ORIGIN = 'https://app.example.com';
    try {
      const allowed = (req) => {
        let passed = false;
        const res = fakeRes();
        requireSameOrigin(req, res, () => { passed = true; });
        return { passed, res };
      };

      // Reads pass without an Origin: they change nothing.
      expect(allowed({ method: 'GET', headers: {} }).passed).toBe(true);

      // The right origin passes.
      expect(allowed({
        method: 'POST', headers: { origin: 'https://app.example.com' },
      }).passed).toBe(true);

      // A Referer is accepted where Origin is absent.
      expect(allowed({
        method: 'POST', headers: { referer: 'https://app.example.com/player/1/reports' },
      }).passed).toBe(true);

      // Another site's POST is refused — this is the CSRF case.
      const attacker = allowed({ method: 'POST', headers: { origin: 'https://evil.example' } });
      expect(attacker.passed).toBe(false);
      expect(attacker.res.statusCode).toBe(403);
      expect(attacker.res.body.code).toBe('origin_rejected');

      // FAIL CLOSED. No Origin and no Referer on a write is refused: a browser
      // always sends one, so the caller is not a browser and has no ambient
      // cookie to be abused.
      expect(allowed({ method: 'POST', headers: {} }).passed).toBe(false);

      // A near-miss host is not the same origin.
      expect(allowed({
        method: 'POST', headers: { origin: 'https://app.example.com.evil.test' },
      }).passed).toBe(false);
      expect(allowed({
        method: 'POST', headers: { origin: 'http://app.example.com' },
      }).passed).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.THRIV3_APP_ORIGIN;
      else process.env.THRIV3_APP_ORIGIN = previous;
    }
  });

  it('a successful sign-in forgets the failures before it', () => {
    resetLoginLimits();
    for (let i = 0; i < 4; i += 1) loginByEmail.check('a@b.co');
    // The route clears the key on a correct password, so the budget is about
    // wrong guesses rather than about how often somebody signs in.
    loginByEmail.clear('a@b.co');
    const after = Array.from({ length: 5 }, () => loginByEmail.check('a@b.co'));
    expect(after.every(Boolean)).toBe(true);
  });

  it('the login limiter has a ceiling', () => {
    resetLoginLimits();
    const attempts = Array.from({ length: 12 }, () => loginByIp.check('10.0.0.1'));
    expect(attempts.filter(Boolean)).toHaveLength(10);
    expect(attempts.slice(10)).toEqual([false, false]);
    // Another address is unaffected: a shared ceiling would let one attacker
    // lock the operator out.
    expect(loginByIp.check('10.0.0.2')).toBe(true);
  });
});
