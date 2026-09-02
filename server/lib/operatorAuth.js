/**
 * OPERATOR ACCESS — Phase 13K.
 *
 * The smallest authentication that is genuinely secure for the product this
 * is: one or a few internal Thriv3 operators, one hosted instance, one
 * database. Not a multi-tenant platform, not client accounts, not roles.
 * Every authenticated account is an operator with the same reach, and the
 * moment that stops being true this file needs a design, not a flag.
 *
 * WHAT IS AND IS NOT HAND-ROLLED HERE.
 *
 * Passwords are hashed with scrypt from `node:crypto` — OpenSSL's
 * implementation of RFC 7914, one of the three password hashing functions
 * OWASP recommends. It is in the platform, so it adds no second native module
 * to a container that already compiles better-sqlite3, and `timingSafeEqual`
 * gives the constant-time comparison. Nothing about the algorithm is invented
 * here; what this file writes is the parameter string and the plumbing.
 *
 * Sessions are opaque 256-bit random tokens looked up server-side. The cookie
 * carries no identity, no claims and no expiry, so there is nothing in it for
 * a client to edit and no signature to get wrong — which is the part of a
 * client-trusting session that goes wrong. Signing out deletes the row.
 *
 * THE TOKEN IS NEVER STORED. What the table holds is HMAC-SHA256 of the token
 * under the session secret, so a leaked database or an old backup contains no
 * usable session — and rotating THRIV3_SESSION_SECRET signs everybody out,
 * which is the lever you want at 2am and cannot build later.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import db from '../db/client.js';
import { utcNow } from './time.js';
import { createRateLimiter } from '../../shared/rateLimit.js';
import { resolveConfig, sessionSecretFor } from './runtimeConfig.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'thriv3_session';

/* ---------------------------------------------------------------- passwords */

const R = 8;
const P = 1;
const KEYLEN = 64;

/** scrypt needs 128·N·r bytes; ask for double so it never fails at the edge. */
const maxmemFor = (N) => 128 * N * R * 2;

/**
 * `scrypt$N$r$p$salt$hash`, base64, self-describing.
 *
 * The parameters travel with the hash so raising the work factor later does
 * not invalidate existing accounts: an old hash still verifies against its own
 * N, and the next sign-in can be re-hashed at the new one.
 */
export async function hashPassword(password, { cost } = {}) {
  const N = 2 ** (cost ?? resolveConfig().scryptCost);
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P, maxmem: maxmemFor(N) });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const N = Number(n);
  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0) return false;

  let expected;
  let actual;
  try {
    expected = Buffer.from(hashB64, 'base64');
    const salt = Buffer.from(saltB64, 'base64');
    /**
     * THE DEGENERATE HASH, REFUSED — found by the malformed-input test.
     *
     * `Buffer.from('y', 'base64')` is zero bytes, and a zero-length key
     * compares equal to a zero-length derivation, so a stored value of
     * `scrypt$16384$8$1$x$y` would have accepted EVERY password. Nothing this
     * module writes looks like that, which is exactly why it needed a floor
     * rather than trust: a hash that arrives from anywhere else — a bad
     * migration, a hand-edited row, a restored backup — must fail closed.
     */
    if (expected.length < 32 || salt.length < 8) return false;
    actual = await scrypt(String(password), salt, expected.length,
      { N, r: Number(r), p: Number(p), maxmem: maxmemFor(N) });
  } catch {
    return false;
  }
  // Equal lengths by construction, but timingSafeEqual throws on a mismatch
  // and a thrown comparison is itself an oracle.
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * A real hash of a value nobody knows, verified against when no account
 * matches — so an unknown email costs the same time as a known one.
 *
 * Without this, sign-in is a user-enumeration oracle that no amount of
 * identical wording can close: the response for an unknown address comes back
 * in a millisecond and the response for a known one takes two hundred.
 */
let decoyHash;
async function decoy() {
  decoyHash ??= await hashPassword(crypto.randomBytes(32).toString('hex'));
  return decoyHash;
}

/* -------------------------------------------------------------------- users */

const selectByEmail = db.prepare(
  'SELECT * FROM operator_users WHERE email = ?',
);
const selectById = db.prepare('SELECT * FROM operator_users WHERE id = ?');
const insertUser = db.prepare(`INSERT INTO operator_users
  (id, email, password_hash, active, created_at, last_login_at)
  VALUES (@id, @email, @password_hash, @active, @created_at, NULL)`);
const updateHash = db.prepare('UPDATE operator_users SET password_hash = ? WHERE id = ?');
const updateActive = db.prepare('UPDATE operator_users SET active = ? WHERE id = ?');
const touchLogin = db.prepare('UPDATE operator_users SET last_login_at = ? WHERE id = ?');

export const normaliseEmail = (email) => String(email ?? '').trim().toLowerCase();

/** Deliberately loose: this validates a typo, not an identity. */
export const looksLikeEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normaliseEmail(email));

export function operatorCount() {
  return db.prepare('SELECT COUNT(*) n FROM operator_users WHERE active = 1').get().n;
}

export function listOperators() {
  return db.prepare('SELECT id, email, active, created_at, last_login_at FROM operator_users '
    + 'ORDER BY email').all();
}

/**
 * Create or re-password one operator.
 *
 * There is no self-service registration and no default password: an account
 * exists because somebody with shell access to the host created it, which for
 * a tool with one to three users is a feature. `createOperator` is what the
 * bootstrap script calls; nothing reachable over HTTP calls it.
 */
export async function createOperator({ email, password, reset = false }) {
  const addr = normaliseEmail(email);
  if (!looksLikeEmail(addr)) throw new Error(`"${email}" is not an email address.`);
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  const password_hash = await hashPassword(password);
  const existing = selectByEmail.get(addr);
  if (existing) {
    if (!reset) throw new Error(`${addr} already has an account. Pass --reset to set a new password.`);
    updateHash.run(password_hash, existing.id);
    // A password change ends every session that was opened with the old one.
    // Otherwise "I reset my password because I think somebody had it" changes
    // nothing at all for the person who had it.
    destroyUserSessions(existing.id);
    return { id: existing.id, email: addr, created: false };
  }
  const id = crypto.randomUUID();
  insertUser.run({ id, email: addr, password_hash, active: 1, created_at: utcNow() });
  return { id, email: addr, created: true };
}

/**
 * The only password rule, and it is about length.
 *
 * Composition rules ("one capital, one symbol") measurably produce worse
 * passwords, and NIST dropped them. Twelve characters with scrypt behind it is
 * the defensible floor for a tool with three accounts and a rate limiter.
 */
export function passwordProblem(password) {
  const value = String(password ?? '');
  if (value.length < 12) return 'A password must be at least 12 characters.';
  if (value.length > 512) return 'A password must be at most 512 characters.';
  if (value.trim() === '') return 'A password cannot be only whitespace.';
  return null;
}

export function setOperatorActive(id, active) {
  updateActive.run(active ? 1 : 0, id);
  // Deactivation has to reach the sessions, or the account keeps working until
  // its cookie happens to expire.
  if (!active) destroyUserSessions(id);
  return selectById.get(id);
}

/**
 * Verify credentials. Returns the user, or null — never which half was wrong.
 *
 * The decoy hash above is why an unknown address is indistinguishable from a
 * wrong password in both the response and the time it takes.
 */
export async function authenticate({ email, password }) {
  const user = selectByEmail.get(normaliseEmail(email));
  const hash = user?.active ? user.password_hash : await decoy();
  const ok = await verifyPassword(password, hash);
  if (!ok || !user?.active) return null;
  touchLogin.run(utcNow(), user.id);
  return { id: user.id, email: user.email };
}

/* ----------------------------------------------------------------- sessions */

const insertSession = db.prepare(`INSERT INTO operator_sessions
  (token_sha256, user_id, created_at, last_seen_at, expires_at, absolute_expires_at,
   created_ip, user_agent)
  VALUES (@token_sha256, @user_id, @created_at, @last_seen_at, @expires_at,
   @absolute_expires_at, @created_ip, @user_agent)`);
const selectSession = db.prepare(`SELECT s.*, u.email, u.active
  FROM operator_sessions s JOIN operator_users u ON u.id = s.user_id
  WHERE s.token_sha256 = ?`);
const slideSession = db.prepare(
  'UPDATE operator_sessions SET last_seen_at = ?, expires_at = ? WHERE token_sha256 = ?',
);
const deleteSession = db.prepare('DELETE FROM operator_sessions WHERE token_sha256 = ?');
const deleteUserSessions = db.prepare('DELETE FROM operator_sessions WHERE user_id = ?');
const deleteExpired = db.prepare(
  'DELETE FROM operator_sessions WHERE expires_at <= ? OR absolute_expires_at <= ?',
);

/** Keyed, not plain: see the file header. */
function tokenKey(token) {
  return crypto.createHmac('sha256', sessionSecretFor(resolveConfig()))
    .update(String(token)).digest('hex');
}

/** Same shape as `utcNow` — ISO-8601 UTC with an explicit Z — so timestamps
 * from this module and from every other one sort against each other. */
const iso = (ms) => new Date(ms).toISOString();

export function createSession(userId, { ip = null, userAgent = null, now = Date.now() } = {}) {
  const config = resolveConfig();
  const token = crypto.randomBytes(32).toString('base64url');
  insertSession.run({
    token_sha256: tokenKey(token),
    user_id: userId,
    created_at: iso(now),
    last_seen_at: iso(now),
    expires_at: iso(now + config.sessionIdleHours * 3600_000),
    absolute_expires_at: iso(now + config.sessionMaxDays * 86_400_000),
    created_ip: ip,
    user_agent: userAgent ? String(userAgent).slice(0, 200) : null,
  });
  return token;
}

/**
 * The session behind a cookie, or null.
 *
 * Expiry is enforced here, on the server, against the row — never against
 * anything the browser sent. An expired row is deleted on the way past rather
 * than left for a sweep, so a stolen cookie stops working at the deadline even
 * if nothing else ever runs.
 */
export function resolveSession(token, { now = Date.now() } = {}) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const key = tokenKey(token);
  const row = selectSession.get(key);
  if (!row) return null;

  const stamp = iso(now);
  if (row.expires_at <= stamp || row.absolute_expires_at <= stamp || !row.active) {
    deleteSession.run(key);
    return null;
  }

  // Slide the idle deadline, never past the absolute one, and only once a
  // minute: every authenticated request would otherwise be a write.
  const config = resolveConfig();
  if (row.last_seen_at <= iso(now - 60_000)) {
    const slid = iso(now + config.sessionIdleHours * 3600_000);
    slideSession.run(stamp, slid < row.absolute_expires_at ? slid : row.absolute_expires_at, key);
  }

  return { user: { id: row.user_id, email: row.email }, expiresAt: row.expires_at };
}

export function destroySession(token) {
  if (!token) return false;
  return deleteSession.run(tokenKey(token)).changes > 0;
}

export function destroyUserSessions(userId) {
  return deleteUserSessions.run(userId).changes;
}

export function sweepSessions({ now = Date.now() } = {}) {
  const stamp = iso(now);
  return deleteExpired.run(stamp, stamp).changes;
}

/* ------------------------------------------------------------------ cookies */

/** Express 4 has no cookie reader and this needs three lines, not a dependency. */
export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/**
 * HttpOnly so no script can read it — including a script that got onto the
 * page through a dependency. SameSite=Lax so a cross-site POST does not carry
 * it, which is the first half of the CSRF answer; the Origin check in
 * `requireSameOrigin` is the second. Secure whenever the app is served over
 * HTTPS, which in production is always.
 */
export function setSessionCookie(res, token, config = resolveConfig()) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionIdleHours * 3600_000,
  });
}

export function clearSessionCookie(res, config = resolveConfig()) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/',
  });
}

/* --------------------------------------------------------------- middleware */

/**
 * Login attempts, bounded. Reuses the collector's limiter rather than adding a
 * dependency, and keys on both address and account so neither a single client
 * hammering one account nor one client trying many is unbounded.
 *
 * This is proportionate, not intrusion detection: no lockout an attacker could
 * trigger against a real operator, no alerting pipeline.
 */
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const loginByIp = createRateLimiter({ limit: 10, windowMs: LOGIN_WINDOW_MS });
export const loginByEmail = createRateLimiter({ limit: 5, windowMs: LOGIN_WINDOW_MS });

export function resetLoginLimits() {
  loginByIp.reset();
  loginByEmail.reset();
}

/** Whatever identifies the caller, honouring only as many proxies as configured. */
export function callerIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Puts `req.operator` there when a valid session says so, and nothing otherwise. */
export function attachOperator(req, _res, next) {
  try {
    const session = resolveSession(readCookie(req, SESSION_COOKIE));
    if (session) req.operator = session.user;
  } catch (err) {
    // A broken session store must not become an open door.
    console.error('[auth] session lookup failed', err);
  }
  next();
}

/**
 * THE PROTECTION BOUNDARY.
 *
 * 401 and a sentence, never a redirect: every caller of this is an API client,
 * and a 302 to a login page is what turns "you are signed out" into a JSON
 * parse error in the browser console. The operator app watches for 401 and
 * shows the login screen itself.
 */
export function requireOperator(req, res, next) {
  if (req.operator) return next();
  return res.status(401).json({ error: 'Sign in to continue.', code: 'unauthenticated' });
}

/**
 * CSRF: verify the origin of every state-changing request.
 *
 * OWASP's "Verifying Origin With Standard Headers", chosen over a synchroniser
 * token because the operator app and the API are one origin in production, the
 * cookie is already SameSite=Lax, and a token adds a second thing that can be
 * out of date in the browser without adding a case this refuses to catch.
 *
 * FAIL CLOSED. A request with no Origin and no Referer is refused rather than
 * allowed: browsers send Origin on every cross-origin and every same-origin
 * POST, so the only callers without one are not browsers — and a non-browser
 * caller has no ambient cookie to be abused in the first place, so it loses
 * nothing by sending a header.
 */
export function requireSameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const config = resolveConfig();
  const allowed = config.appOrigins;

  const origin = req.headers.origin
    || (req.headers.referer ? originOf(req.headers.referer) : null);

  if (origin && allowed.includes(origin.replace(/\/$/, ''))) return next();

  // Same-origin by construction: the request arrived on the host the app is
  // served from. Only consulted when no allow-list is configured, which is
  // development — production startup refuses to run without one.
  if (!allowed.length && origin && originOf(`http://${req.headers.host}`) === originOf(origin)) {
    return next();
  }

  return res.status(403).json({
    error: 'That request did not come from the Thriv3 application.',
    code: 'origin_rejected',
  });
}

function originOf(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return null; }
}
