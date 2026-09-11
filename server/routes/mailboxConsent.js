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
 * This file is split into three routers because the requests arriving at it are
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
 * The public routers are mounted ABOVE `requireOperator` and nothing else moves.
 * The existing public surfaces — tracking, the athlete profile, unsubscribe,
 * health, sign-in — are untouched, and no mailbox MANAGEMENT route is public.
 *
 * ===========================================================================
 * THE CAPABILITY IS NEVER IN A URL — D3.1.
 *
 * D3 served the consent page at `/api/mailbox-consent/:token`, which put a live
 * bearer capability in the request path. A request path is not a private
 * channel. It is written to the platform's HTTP request log (Render logs
 * `path` as a first-class filterable field and keeps it 7–30 days), to any
 * reverse proxy's access log, and — because the page then posted to
 * `/:token/start` — to the `Referer` field of the very next line, so the
 * standard combined format recorded the same secret twice in two columns.
 * That was measured against this application, not assumed.
 *
 * So the token now travels in a URL FRAGMENT, which a browser never puts in a
 * request:
 *
 *   operator sends   https://…/mailbox-consent#<token>
 *   browser requests GET /mailbox-consent          ← no token, nothing to log
 *   page script      reads location.hash, clears it with history.replaceState
 *   page script      POSTs the token in a request BODY to resolve, then start
 *
 * The token exists in this flow as a fragment the browser holds and a request
 * body over TLS. It is in no path, no query string, no `Referer`, no cookie,
 * no storage API and no log line. The one thing that must stay in a URL is
 * Google's `state`, because OAuth returns it in a query string — which is
 * exactly why `state` is a separate ten-minute nonce and not this token.
 * ===========================================================================
 */

/** Served at the ROOT, not under /api: this is a page, not an endpoint. */
export const mailboxConsentPageRouter = express.Router();
/** Public /api endpoints: the two the page calls, and Google's return. */
export const mailboxConsentPublicRouter = express.Router();
/** Operator routes, below the authentication boundary. */
export const mailboxRouter = express.Router();

/** Where the operator's link points. The token goes after the `#`. */
export const CONSENT_PAGE_PATH = '/mailbox-consent';
const CONSENT_SCRIPT_PATH = '/mailbox-consent/consent.js';

const html = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/**
 * One page, one message, no navigation.
 *
 * Deliberately not the operator app: this is served to somebody who has no
 * account here and should be given nothing to click but the one thing they came
 * for. No bundle, no session, no links.
 *
 * `no-referrer` so that navigating on to Google sends nothing about where the
 * athlete came from. The same-origin `fetch` calls below still carry an
 * `Origin` header, which is what the CSRF check reads, so this costs nothing.
 */
function page({ title, body, status = 200, script = null }, res) {
  res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
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
  button[disabled] { opacity:.55; cursor:default }
</style></head><body><main>${body}</main>${
  script ? `<script src="${html(script)}"></script>` : ''
}</body></html>`);
}

const athleteName = (id) => db.prepare('SELECT full_name FROM players WHERE id = ?').get(id)?.full_name ?? null;
const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'this athlete';

/* ========================================================================== */
/* THE PAGE — root-mounted, tokenless, and the same bytes for everybody        */
/* ========================================================================== */

/**
 * The shell knows nothing.
 *
 * It is the identical response for every athlete and every visitor, because
 * the server has not been told which grant this is — the token is still in the
 * fragment, in the browser. That is the property being bought: there is
 * nothing in this request to log, and nothing in this response to leak.
 *
 * The consent copy itself is HERE rather than assembled by the script, so the
 * words an athlete is consenting to are server-rendered static HTML that no
 * client-side branch can alter. The script fills in one thing: their name.
 */
mailboxConsentPageRouter.get(CONSENT_PAGE_PATH, (_req, res) => page({
  title: 'Connect your mailbox',
  script: CONSENT_SCRIPT_PATH,
  body: `
    <div id="state-loading"><h1>Checking your link…</h1>
      <p class="muted">One moment.</p></div>

    <div id="state-error" hidden><h1>This link cannot be used</h1>
      <p id="state-error-text"></p></div>

    <div id="state-consent" hidden>
      <h1>Connect <span data-name>this athlete</span>'s email to Thriv3</h1>
      <p>Thriv3 sends college recruiting emails on <span data-name>this athlete</span>'s
         behalf. Connecting the mailbox means those emails come from
         <span data-name>this athlete</span>'s own address, rather than from an agency —
         coaches are far more likely to read them.</p>
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
      <button id="continue" type="button">Continue with Google</button>
    </div>

    <noscript><h1>Please turn on JavaScript</h1>
      <p>This page needs JavaScript to read your link without sending it to our
         servers in a web address. Turn it on and open the link again.</p></noscript>`,
}, res));

/**
 * THE WHOLE CLIENT, AND IT DOES FOUR THINGS.
 *
 * An external file rather than an inline block, so the operator app's
 * Content-Security-Policy — `script-src 'self'`, which covers this path — is
 * satisfied as it stands. Hardening the consent flow must not require
 * loosening the policy that protects everything else.
 *
 * The token lives in a closure variable for the life of the page and is put
 * nowhere else: not `localStorage`, not `sessionStorage`, not a cookie, not
 * back into the URL. A reload therefore loses it and the athlete opens the
 * link again — which costs them one tap and spends nothing, because opening a
 * link has never consumed the grant.
 */
mailboxConsentPageRouter.get(CONSENT_SCRIPT_PATH, (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').send(`(function () {
  var byId = function (id) { return document.getElementById(id); };
  var fail = function (message) {
    byId('state-loading').hidden = true;
    byId('state-consent').hidden = true;
    byId('state-error-text').textContent = message;
    byId('state-error').hidden = false;
  };

  /* The capability arrives after the '#'. A browser never transmits that, so
     it has reached this script without touching a log. Read it once, then take
     it out of the address bar and out of this history entry. */
  var token = window.location.hash.replace(/^#/, '');
  try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* older browser */ }

  if (!token) {
    fail('Open the link from your email again — the address bar is missing the part that identifies you.');
    return;
  }

  /* credentials: 'omit' — an athlete's consent is a capability, never a
     session, and this request should not carry one even if the browser has one. */
  var post = function (path, body) {
    return fetch(path, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, data: data };
      });
    });
  };

  var GENERIC = 'Something went wrong. Please ask Thriv3 for a new link.';

  post('/api/mailbox-consent/resolve', { token: token }).then(function (r) {
    if (!r.ok || !r.data.ok) { fail(r.data.message || GENERIC); return; }

    var names = document.querySelectorAll('[data-name]');
    for (var i = 0; i < names.length; i += 1) names[i].textContent = r.data.athlete_first_name;

    byId('state-loading').hidden = true;
    byId('state-consent').hidden = false;

    var button = byId('continue');
    button.addEventListener('click', function () {
      button.disabled = true;
      post('/api/mailbox-consent/start', { token: token }).then(function (s) {
        if (!s.ok || !s.data.authorization_url) {
          button.disabled = false;
          fail(s.data.message || GENERIC);
          return;
        }
        window.location.assign(s.data.authorization_url);
      }).catch(function () { button.disabled = false; fail(GENERIC); });
    });
  }).catch(function () { fail(GENERIC); });
}());
`);
});

/* ========================================================================== */
/* PUBLIC /api — the two the page calls, and Google's one                      */
/* ========================================================================== */

/** What an athlete is told when a link cannot be used. Never why it existed. */
const REFUSAL_COPY = Object.freeze({
  [CONSENT_REFUSAL.NOT_FOUND]: 'This link is not valid. Ask Thriv3 for a new one.',
  [CONSENT_REFUSAL.EXPIRED]: 'This link has expired. Ask Thriv3 for a new one.',
  [CONSENT_REFUSAL.ALREADY_USED]: 'This link has already been used to connect a mailbox.',
  [CONSENT_REFUSAL.REVOKED]: 'This link is not valid. Ask Thriv3 for a new one.',
});

/**
 * The token arrives in the BODY, and only ever in the body.
 *
 * Both endpoints below are POSTs for that reason alone — neither changes
 * anything an idempotent GET could not — and being POSTs they also sit under
 * `requireSameOrigin`, so only the page Thriv3 served can call them.
 */
const bodyToken = (req) => (typeof req.body?.token === 'string' ? req.body.token : '');

/** A refusal an athlete can read, and an internal reason the page never shows. */
const refuse = (res, reason) => res.status(410).json({
  ok: false, reason, message: REFUSAL_COPY[reason] ?? REFUSAL_COPY[CONSENT_REFUSAL.NOT_FOUND],
});

/**
 * Resolve a link into the little that informs consent.
 *
 * SPENDS NOTHING. Opening the page, refreshing it, or a mail scanner following
 * the link cannot burn a grant — the same rule D3 had, kept.
 *
 * INFORMED CONSENT, AND ONLY WHAT INFORMS IT. The athlete's first name so they
 * know the link is theirs, and how long it lasts. No internal ids, no campaign,
 * no programme list, no operator, nothing about the application.
 */
mailboxConsentPublicRouter.post('/mailbox-consent/resolve', (req, res) => {
  const { ok, reason, grant } = resolveConsentToken(bodyToken(req));
  if (!ok) return refuse(res, reason);
  if (!googleOAuthConfigured(resolveConfig())) {
    return res.status(503).json({
      ok: false, reason: 'NOT_CONFIGURED',
      message: 'Mailbox connection is not switched on for this installation. '
        + 'Nothing has been changed.',
    });
  }
  return res.json({
    ok: true,
    athlete_first_name: firstName(athleteName(grant.athlete_id)),
    provider: grant.provider,
    ttl_minutes: CONSENT_TTL_MINUTES,
  });
});

/**
 * Begin the redirect.
 *
 * Returns the URL rather than a 302, because the caller is `fetch`: a redirect
 * to Google would be followed by the fetch itself and die on Google's CORS
 * policy. The page navigates instead, which also means the browser's own
 * request to Google carries nothing of ours — no `Referer`, by the page's
 * referrer policy, and no fragment, because there no longer is one.
 */
mailboxConsentPublicRouter.post('/mailbox-consent/start', (req, res) => {
  const { ok, reason, grant } = resolveConsentToken(bodyToken(req));
  if (!ok) return refuse(res, reason);
  try {
    const { state, codeChallenge } = beginOAuthTransaction(grant.id, { provider: grant.provider });
    return res.json({ ok: true, authorization_url: authorizationUrl({ state, codeChallenge }) });
  } catch (err) {
    console.error(`[mailbox-consent/start] ${err.code ?? 'ERROR'}`);
    return res.status(500).json({
      ok: false, reason: 'START_FAILED',
      message: 'Thriv3 could not start the connection. Please try the link again.',
    });
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
   *
   * This is the one value in the flow that HAS to travel in a URL, because
   * OAuth returns it in a query string and it will be logged. It is built for
   * that: ten minutes, single use, worthless without the verifier this server
   * holds, and it names a transaction rather than granting anything.
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
      /**
       * Once. Send it to the athlete; it cannot be read back.
       *
       * THE TOKEN IS AFTER THE '#'. That is not cosmetic: a fragment is the
       * only part of a URL a browser keeps to itself, so this link can sit in
       * an email, be clicked, and reach the page without the secret appearing
       * in a request line, a proxy log or a `Referer`.
       */
      url: `${origin}${CONSENT_PAGE_PATH}#${token}`,
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
