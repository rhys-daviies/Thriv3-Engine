import express from 'express';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import {
  createConsentGrant, resolveConsentToken, revokeConsentGrant, consumeConsentGrant,
  beginOAuthTransaction, claimOAuthTransaction, grantsForAthlete,
  CONSENT_REFUSAL, OAUTH_REFUSAL, CONSENT_TTL_MINUTES,
} from '../lib/mailboxConsent.js';
import { authorizationUrl, exchangeCodeForIdentity } from '../lib/googleMailboxOAuth.js';
import {
  createConnectedMailbox, storeMailboxCredential, mailboxesForAthlete,
  MAILBOX_STATUS,
} from '../lib/connectedMailboxes.js';
import { resolveConfig, googleOAuthConfigured, googleRedirectUri } from '../lib/runtimeConfig.js';

/**
 * CONNECTING AN ATHLETE'S MAILBOX, ACROSS THREE DIFFERENT TRUST BOUNDARIES.
 *
 * This file is split in two routers because the requests arriving at it are
 * authorised three different ways, and mounting them together would give one of
 * them the wrong protection:
 *
 *   OPERATOR   issuing and revoking a link, and reading mailbox status. Session
 *              cookie plus the same-origin check, mounted BELOW the boundary
 *              with everything else internal.
 *   ATHLETE    the consent page and the redirect to Google. No session and no
 *              account — authorised by possession of one purpose-specific
 *              capability, which authorises exactly one action.
 *   GOOGLE     the callback. Authorised by an unguessable `state` this server
 *              minted minutes earlier, which is the only thing it could be:
 *              Google's redirect carries no cookie of ours and no origin we
 *              could check.
 *
 * The public router is mounted ABOVE `requireOperator` and nothing else moves.
 * The existing public surfaces — tracking, the athlete profile, unsubscribe,
 * health, sign-in — are untouched, and no mailbox MANAGEMENT route is public.
 */

export const mailboxConsentPublicRouter = express.Router();
export const mailboxRouter = express.Router();

const html = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/**
 * One page, one message, no navigation.
 *
 * Deliberately not the operator app: this is served to somebody who has no
 * account here and should be given nothing to click but the one thing they came
 * for. No bundle, no session, no links.
 */
function page({ title, body, status = 200 }, res) {
  res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${html(title)} · Thriv3</title>
<style>
  :root { color-scheme: light }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#f7f7f8; color:#18181b;
         font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif }
  main { max-width:34rem; padding:2.5rem; margin:1rem; background:#fff; border-radius:14px;
         box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.04) }
  h1 { margin:0 0 1rem; font-size:1.35rem; letter-spacing:-.01em }
  p { margin:0 0 1rem } ul { margin:0 0 1.25rem; padding-left:1.1rem } li { margin:.3rem 0 }
  .muted { color:#71717a; font-size:.9rem }
  button { font:inherit; font-weight:600; padding:.7rem 1.3rem; border:0; border-radius:9px;
           background:#18181b; color:#fff; cursor:pointer }
</style></head><body><main>${body}</main></body></html>`);
}

const athleteName = (id) => db.prepare('SELECT full_name FROM players WHERE id = ?').get(id)?.full_name ?? null;
const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'this athlete';

/* ========================================================================== */
/* PUBLIC — the athlete's two steps and Google's one                          */
/* ========================================================================== */

/** What an athlete is told when a link cannot be used. Never why it existed. */
const REFUSAL_COPY = Object.freeze({
  [CONSENT_REFUSAL.NOT_FOUND]: 'This link is not valid. Ask Thriv3 for a new one.',
  [CONSENT_REFUSAL.EXPIRED]: 'This link has expired. Ask Thriv3 for a new one.',
  [CONSENT_REFUSAL.ALREADY_USED]: 'This link has already been used to connect a mailbox.',
  [CONSENT_REFUSAL.REVOKED]: 'This link is not valid. Ask Thriv3 for a new one.',
});

mailboxConsentPublicRouter.get('/mailbox-consent/:token', (req, res) => {
  const { ok, reason, grant } = resolveConsentToken(req.params.token);
  if (!ok) {
    return page({
      title: 'Link unavailable', status: 410,
      body: `<h1>This link cannot be used</h1><p>${html(REFUSAL_COPY[reason])}</p>`,
    }, res);
  }
  if (!googleOAuthConfigured(resolveConfig())) {
    return page({
      title: 'Not available', status: 503,
      body: '<h1>Not available yet</h1><p>Mailbox connection is not switched on for this '
        + 'installation. Nothing has been changed.</p>',
    }, res);
  }

  const name = firstName(athleteName(grant.athlete_id));
  /**
   * INFORMED CONSENT, AND ONLY WHAT INFORMS IT. The athlete's first name so
   * they know the link is theirs, who is asking, what is being asked for and
   * what it does not include. No internal ids, no campaign, no programme list,
   * nothing about the operator's application.
   */
  return page({
    title: 'Connect your mailbox',
    body: `
      <h1>Connect ${html(name)}'s email to Thriv3</h1>
      <p>Thriv3 sends college recruiting emails on ${html(name)}'s behalf. Connecting the
         mailbox means those emails come from ${html(name)}'s own address, rather than
         from an agency — coaches are far more likely to read them.</p>
      <p>You will sign in with Google on Google's own page. Thriv3 never sees the password.</p>
      <p><strong>Thriv3 will be able to:</strong></p>
      <ul><li>send email from this address</li></ul>
      <p><strong>Thriv3 will not be able to:</strong></p>
      <ul>
        <li>read, open or search any email</li>
        <li>see contacts, files or calendar</li>
        <li>delete or change anything in the mailbox</li>
      </ul>
      <p class="muted">You can disconnect at any time from your Google account's security
         settings, or by asking Thriv3. This link works once and expires
         ${html(CONSENT_TTL_MINUTES)} minutes after it was created.</p>
      <form method="POST" action="/api/mailbox-consent/${encodeURIComponent(req.params.token)}/start">
        <button type="submit">Continue with Google</button>
      </form>`,
  }, res);
});

/**
 * Begin the redirect.
 *
 * A POST because it creates a transaction, so a link preview, a prefetch or a
 * mail scanner opening the page cannot burn one. The form posts from the page
 * above, so the same-origin check that guards every other mutation is
 * satisfied without exempting anything.
 */
mailboxConsentPublicRouter.post('/mailbox-consent/:token/start', (req, res) => {
  const { ok, reason, grant } = resolveConsentToken(req.params.token);
  if (!ok) {
    return page({
      title: 'Link unavailable', status: 410,
      body: `<h1>This link cannot be used</h1><p>${html(REFUSAL_COPY[reason])}</p>`,
    }, res);
  }
  try {
    const { state, codeChallenge } = beginOAuthTransaction(grant.id, { provider: grant.provider });
    return res.redirect(302, authorizationUrl({ state, codeChallenge }));
  } catch (err) {
    console.error(`[mailbox-consent/start] ${err.code ?? 'ERROR'}`);
    return page({
      title: 'Something went wrong', status: 500,
      body: '<h1>Something went wrong</h1><p>Thriv3 could not start the connection. '
        + 'Please try the link again.</p>',
    }, res);
  }
});

/** What the athlete sees when the round trip fails. Internal codes stay in logs. */
const failed = (res, message) => page({
  title: 'Not connected', status: 400,
  body: `<h1>The mailbox was not connected</h1><p>${html(message)}</p>`,
}, res);

mailboxConsentPublicRouter.get('/mailbox-consent/google/callback', async (req, res) => {
  const { state, code, error } = req.query ?? {};

  /**
   * THE STATE IS CLAIMED FIRST, WHATEVER ELSE ARRIVED.
   *
   * Even a denial consumes it. A nonce that survives its own callback can be
   * presented twice, which is not a nonce — so the claim happens before the
   * error is read, and a replay of any callback finds the transaction spent.
   */
  const claim = claimOAuthTransaction(state, { provider: 'GOOGLE' });
  if (!claim.ok) {
    console.error(`[mailbox-consent/callback] ${claim.reason}`);
    return failed(res, claim.reason === OAUTH_REFUSAL.ALREADY_USED
      ? 'This authorisation has already been completed.'
      : 'This authorisation is no longer valid. Ask Thriv3 for a new link.');
  }
  // The athlete pressed Cancel, or Google refused. The grant survives.
  if (error) {
    console.error('[mailbox-consent/callback] provider_denied');
    return failed(res, 'The connection was cancelled. Your mailbox has not been changed.');
  }

  const { grant, codeVerifier } = claim;
  let identity;
  try {
    identity = await exchangeCodeForIdentity({ code, codeVerifier });
  } catch (err) {
    // The code and the verifier never reach this line's output.
    console.error(`[mailbox-consent/callback] ${err.code ?? 'EXCHANGE_FAILED'}`);
    return failed(res, err.code === 'MISSING_REFRESH_TOKEN'
      ? 'Google did not give Thriv3 a lasting permission for this mailbox. If you have connected '
        + 'it before, remove Thriv3 from your Google account\'s security settings and try again.'
      : 'Google could not complete the connection. Please ask Thriv3 for a new link.');
  }

  try {
    const mailboxId = connectMailbox({ grant, identity });
    consumeConsentGrant(grant.id, { mailboxId });
  } catch (err) {
    console.error(`[mailbox-consent/callback] ${err.code ?? 'CONNECT_FAILED'}`);
    return failed(res, err.code === 'MAILBOX_CLAIMED_BY_ANOTHER_ATHLETE'
      ? 'This Google account is already connected to a different athlete. Please contact Thriv3.'
      : 'Thriv3 could not save the connection. Please ask Thriv3 for a new link.');
  }

  return page({
    title: 'Mailbox connected',
    body: '<h1>Your mailbox has been connected</h1>'
      + '<p>Thriv3 can now send recruiting emails from this address. You can close this window.</p>'
      + '<p class="muted">You can disconnect at any time from your Google account\'s security '
      + 'settings, or by asking Thriv3.</p>',
  }, res);
});

/**
 * IDENTITY IS THE PROVIDER ACCOUNT, AND THE COLLISION RULES FOLLOW FROM THAT.
 *
 *   Same account, same athlete   reconnection. The durable identity is reused
 *                                and the credential replaced, so the mailbox id
 *                                that message history will reference survives.
 *   Same account, other athlete  REFUSED. Moving a mailbox between athletes
 *                                silently would reassign every message ever
 *                                sent through it; an operator has to resolve it.
 *   Same address, other account  two mailboxes. The address is an attribute;
 *                                the account is the identity, and collapsing
 *                                them on a string match is how one person's
 *                                alias becomes another person's mailbox.
 */
function connectMailbox({ grant, identity }) {
  const existing = db.prepare(
    'SELECT id, athlete_id, operator_user_id FROM connected_mailboxes '
    + 'WHERE provider = ? AND provider_account_id = ?',
  ).get(grant.provider, identity.providerAccountId);

  if (existing && existing.athlete_id && existing.athlete_id !== grant.athlete_id) {
    const err = new Error('This Google account is already connected to a different athlete.');
    err.code = 'MAILBOX_CLAIMED_BY_ANOTHER_ATHLETE';
    throw err;
  }

  const owner = existing?.operator_user_id ?? grant.operator_user_id;
  const mailboxId = existing?.id ?? createConnectedMailbox({
    operatorUserId: grant.operator_user_id,
    athleteId: grant.athlete_id,
    provider: grant.provider,
    providerAccountId: identity.providerAccountId,
    emailAddress: identity.email,
    displayName: identity.displayName,
    scopes: identity.scopes,
  }).id;

  /**
   * Storing the credential is what makes it CONNECTED and clears any earlier
   * revocation — D2's rule, reused rather than restated. `last_verified_at`
   * stays null: exchanging a code proves the athlete authorised us, not that a
   * send will succeed, and D5 is what will first know that.
   */
  storeMailboxCredential(mailboxId, {
    refreshToken: identity.refreshToken,
    operatorUserId: owner,
  });
  return mailboxId;
}

/* ========================================================================== */
/* OPERATOR — below the boundary, session required                            */
/* ========================================================================== */

const badRequest = (message) => { const e = new Error(message); e.status = 400; return e; };

function handle(label, fn) {
  return async (req, res) => {
    try {
      const { status = 200, body } = await fn(req);
      return res.status(status).json(body);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      const map = { ATHLETE_NOT_FOUND: 404, CONSENT_GRANT_NOT_FOUND: 404,
        UNKNOWN_PROVIDER: 422, CONSENT_ALREADY_USED: 409 };
      if (map[err.code]) return res.status(map[err.code]).json({ error: err.message, code: err.code });
      console.error(`[${label}]`, err);
      return res.status(500).json({ error: 'Unexpected error.' });
    }
  };
}

/**
 * Issue a link for one athlete.
 *
 * THE RAW TOKEN IS RETURNED HERE AND NOWHERE ELSE. The operator has to be able
 * to send it, so this response carries it once; every later read of a grant
 * cannot express it, because the column holds only an HMAC.
 */
mailboxRouter.post('/players/:playerId/mailbox-consents', handle('mailbox-consents/create', (req) => {
  const provider = req.body?.provider ?? 'GOOGLE';
  if (provider !== 'GOOGLE') {
    throw badRequest(`Only GOOGLE mailbox connection is available. Asked for "${provider}".`);
  }
  if (!googleOAuthConfigured(resolveConfig())) {
    throw badRequest('Google mailbox connection is not configured on this server.');
  }
  const { grant, token } = createConsentGrant({
    operatorUserId: req.operator.id, athleteId: req.params.playerId, provider,
  });
  const origin = resolveConfig().appOrigins[0] ?? '';
  return {
    status: 201,
    body: {
      consent: {
        id: grant.id,
        athlete_id: grant.athlete_id,
        athlete_name: athleteName(grant.athlete_id),
        provider: grant.provider,
        expires_at: grant.expires_at,
        created_at: grant.created_at,
      },
      // Once. Send it to the athlete; it cannot be read back.
      url: `${origin}/api/mailbox-consent/${token}`,
    },
  };
}));

/** Links issued for this athlete. Never the tokens. */
mailboxRouter.get('/players/:playerId/mailbox-consents', handle('mailbox-consents/list', (req) => ({
  body: { consents: grantsForAthlete(req.params.playerId, { operatorUserId: req.operator.id }) },
})));

/** Withdraw an unused link. Not the same as revoking a mailbox — see the lib. */
mailboxRouter.post('/mailbox-consents/:id/revoke', handle('mailbox-consents/revoke', (req) => ({
  body: { consent: revokeConsentGrant(req.params.id, { operatorUserId: req.operator.id }) },
})));

/**
 * Is this athlete's mailbox connected?
 *
 * The narrowest read that answers the operator's only question. It returns
 * D2's public projection, which cannot carry credential material — the
 * ciphertext lives in a table this never joins to.
 */
mailboxRouter.get('/players/:playerId/mailboxes', handle('mailboxes/list', (req) => ({
  body: { mailboxes: mailboxesForAthlete(req.params.playerId, { operatorUserId: req.operator.id }) },
})));

export { MAILBOX_STATUS, googleRedirectUri, utcNow, consumeConsentGrant };
