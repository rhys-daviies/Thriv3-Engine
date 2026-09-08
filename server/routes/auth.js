/**
 * THREE AUTH ROUTES — Phase 13K.
 *
 * Sign in, sign out, who am I. No registration, no password reset over HTTP,
 * no email verification, no invitations: an account is created by somebody
 * with shell access to the host, which is the right shape for a tool with one
 * to three internal users and removes every self-service flow that would
 * otherwise need its own threat model.
 *
 * WHAT A CALLER LEARNS FROM A FAILED SIGN-IN: nothing. One message for an
 * unknown address, a wrong password and a deactivated account, and the same
 * time taken for each (see the decoy hash in operatorAuth.js).
 */
import express from 'express';
import {
  authenticate, createSession, destroySession, readCookie, setSessionCookie,
  clearSessionCookie, SESSION_COOKIE, loginByIp, loginByEmail, callerIp, normaliseEmail,
  sweepSessions,
} from '../lib/operatorAuth.js';
import { resolveConfig } from '../lib/runtimeConfig.js';

export const authRouter = express.Router();

/** One sentence for every failure, so the response is not an oracle. */
const REJECTED = 'Those details were not recognised.';

authRouter.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const addr = normaliseEmail(email);
  const ip = callerIp(req);

  // Bounded before any work is done, so the rate limiter is also the defence
  // against somebody using the scrypt cost as a denial of service.
  if (!loginByIp.check(ip) || !loginByEmail.check(addr || ip)) {
    console.warn('[auth] login rate limited', { ip });
    return res.status(429).json({
      error: 'Too many sign-in attempts. Wait a few minutes and try again.',
      code: 'rate_limited',
    });
  }

  if (!addr || !password) return res.status(401).json({ error: REJECTED, code: 'rejected' });

  try {
    const user = await authenticate({ email: addr, password });
    if (!user) {
      // Logged at a safe level: the address that was tried, never the password
      // and never whether the address exists.
      console.warn('[auth] login failed', { ip, email: addr });
      return res.status(401).json({ error: REJECTED, code: 'rejected' });
    }

    // Correct password: forget the failures. Otherwise an operator who signs
    // in a handful of times in one window — a restart, a second tab — is
    // refused by the defence meant for somebody guessing.
    loginByEmail.clear(addr);
    loginByIp.clear(ip);

    const token = createSession(user.id, { ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(res, token, resolveConfig());
    // Cheap and self-maintaining: the store is swept whenever somebody signs
    // in, so no cron is needed to stop expired rows accumulating.
    sweepSessions();
    console.log('[auth] login', { ip, email: user.email });
    return res.json({ operator: { email: user.email } });
  } catch (err) {
    console.error('[auth] login error', err);
    return res.status(500).json({ error: 'Sign-in is unavailable. Try again shortly.' });
  }
});

/**
 * Signing out deletes the session row, so the cookie is dead even if the
 * browser keeps it. Answers 204 whether or not there was a session: "sign me
 * out" is idempotent and its result must not depend on state the caller can
 * already see.
 */
authRouter.post('/auth/logout', (req, res) => {
  try {
    destroySession(readCookie(req, SESSION_COOKIE));
  } catch (err) {
    console.error('[auth] logout error', err);
  }
  clearSessionCookie(res, resolveConfig());
  return res.status(204).end();
});

/**
 * The operator app's first call. 200 with an identity or 200 with null —
 * never 401, because "am I signed in" is a question, not a protected resource,
 * and a 401 here would make every page load look like a failure.
 */
authRouter.get('/auth/me', (req, res) => {
  res.json({ operator: req.operator ? { email: req.operator.email } : null });
});
