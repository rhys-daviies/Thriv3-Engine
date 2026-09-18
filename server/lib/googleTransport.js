import { OAuth2Client } from 'google-auth-library';
import {
  mailboxCredential, storeMailboxCredential, MAILBOX_PROVIDER,
} from './connectedMailboxes.js';
import { resolveConfig, googleOAuthConfigured } from './runtimeConfig.js';
import { buildRfc822 } from './rfc822.js';
import { TRANSPORT_OUTCOME } from './outboundTransport.js';

/**
 * HANDING ONE FROZEN MESSAGE TO GMAIL — D5.1.
 *
 * ===========================================================================
 * IT IS NOT REACHABLE FROM THE PRODUCT, AND THAT IS DELIBERATE FOR THIS SLICE.
 *
 * `productionTransport()` still returns null. Nothing in the application
 * constructs this adapter, the send endpoint still refuses every request with
 * 503 TRANSPORT_NOT_CONFIGURED, and a test asserts that `productionTransport`
 * imports nothing at all. D5.1 builds the adapter and proves it against mocks;
 * wiring it to a real mailbox is a separate, later decision with its own gate.
 *
 * So: no Gmail request has ever been issued by this code.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * ADAPTED FROM F11e, CONVERGED ONTO MAIN'S VOCABULARY.
 *
 * F11 carried its own four-value outcome enum whose fourth was `AMBIGUOUS`.
 * Main's is `UNKNOWN`, and D5.0 added `REFUSED_BEFORE_TRANSPORT` to main with
 * the same meaning F11 gave it. One vocabulary, imported from
 * `outboundTransport.js`; F11's duplicate is not brought across, because two
 * enums for one concept is how a mapping bug eventually sends a duplicate.
 *
 * `transportSnapshot.js` is likewise NOT brought across. There is one snapshot
 * authority — `executionSnapshot` — and this adapter receives the facts it
 * needs on the transport request, provider-neutrally.
 * ---------------------------------------------------------------------------
 *
 * THE ORDER OF OPERATIONS IS THE SAFETY PROPERTY:
 *
 *   1  encode the message      no credential has been touched yet
 *   2  read the credential     decrypted here and nowhere else
 *   3  verify the identity     a separate GET, before any mutation
 *   4  ONE POST to Gmail       and exactly one, structurally
 *
 * Anything that fails at 1, 2 or 3 is REFUSED_BEFORE_TRANSPORT: no Gmail
 * request existed, so no message can exist at the other end. That is the whole
 * value of doing the cheap deterministic work first — a malformed subject stops
 * the send while the refresh token is still encrypted at rest.
 */

/** VERIFIED GOOGLE FACT: the documented endpoint for sending a message. */
export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/**
 * The OpenID Connect UserInfo endpoint, and the reason it rather than Gmail's
 * own `users.getProfile`.
 *
 * VERIFIED against Google's Gmail API reference: `users.getProfile` authorises
 * only under `mail.google.com`, `gmail.modify`, `gmail.compose`,
 * `gmail.readonly` and `gmail.metadata` — every one of which we deliberately do
 * not hold. UserInfo returns `sub` for the `openid` scope and `email` for the
 * email scope, and both are already granted. No new scope, no new consent
 * screen, no CASA assessment.
 *
 * `tokeninfo` is deliberately not used: Google's own documentation calls it a
 * debugging endpoint and warns that requests to it may be throttled.
 */
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/**
 * A FIXED, CONSERVATIVE CEILING — not a runtime setting.
 *
 * This is a safety parameter rather than a tuning knob. Lowering it converts
 * recoverable waits into permanent UNKNOWN_PROVIDER_RESULT rows, which is the
 * most expensive state in the system: a message that may be in a coach's inbox
 * and can never be sent again. Thirty seconds is long enough that a slow-but-
 * successful Gmail call completes; the injection seam below exists for tests
 * and for nothing else.
 */
export const SEND_TIMEOUT_MS = 30_000;

/** Identity is a small GET and must not hold a send open. */
export const IDENTITY_TIMEOUT_MS = 10_000;

/**
 * WHY, IN A VOCABULARY ORCHESTRATION CAN BRANCH ON WITHOUT PARSING PROSE.
 *
 * Provider-neutral names only. Nothing here spells `invalid_grant`, an HTTP
 * status or a Google error string: those are facts about one provider and they
 * belong in the payload, not in a vocabulary the result boundary switches on.
 */
export const TRANSPORT_REASON = Object.freeze({
  /* --- refused before any request was issued ------------------------------ */
  REQUEST_INCOMPLETE: 'REQUEST_INCOMPLETE',
  PROVIDER_UNSUPPORTED: 'PROVIDER_UNSUPPORTED',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  MESSAGE_UNBUILDABLE: 'MESSAGE_UNBUILDABLE',
  CREDENTIAL_MISSING: 'CREDENTIAL_MISSING',
  MAILBOX_AUTH_FAILED: 'MAILBOX_AUTH_FAILED',
  CREDENTIAL_NOT_PERSISTED: 'CREDENTIAL_NOT_PERSISTED',
  IDENTITY_UNVERIFIABLE: 'IDENTITY_UNVERIFIABLE',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  PROVIDER_UNREACHABLE: 'PROVIDER_UNREACHABLE',
  /* --- the provider answered, and the answer was no ----------------------- */
  PROVIDER_REFUSED: 'PROVIDER_REFUSED',
  /* --- we cannot say ------------------------------------------------------ */
  PROVIDER_SERVER_ERROR: 'PROVIDER_SERVER_ERROR',
  TRANSPORT_TIMEOUT: 'TRANSPORT_TIMEOUT',
  CONNECTION_LOST: 'CONNECTION_LOST',
  RESPONSE_UNREADABLE: 'RESPONSE_UNREADABLE',
});

function fail(reason, message) {
  const err = new Error(message);
  err.code = reason;
  err.transportReason = reason;
  return err;
}

/**
 * AN ERROR'S OWN CODE, AND NOTHING ELSE FROM IT.
 *
 * Provider and network errors carry request context — headers, bodies, the
 * config that produced them — and a gaxios error's `config` holds the refresh
 * token and the client secret in its form body. Only a machine-readable code
 * matching a narrow pattern crosses into anything this module returns, logs or
 * raises. Nothing else from the original object escapes.
 */
function safeCode(err) {
  const code = err?.code ?? err?.cause?.code ?? err?.name;
  return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : 'unknown';
}

const address = (value) => String(value ?? '').trim().toLowerCase();

/**
 * CONNECTION FAILURES WHERE NO REQUEST EXISTED, AND THE LIST IS SHORT ON
 * PURPOSE.
 *
 * DNS resolution failing and a connection being refused both happen before a
 * socket is open, so no request bytes were written and Gmail cannot have seen
 * anything. Those are provable and are treated as refusals.
 *
 * EVERYTHING ELSE IS AMBIGUOUS, EVEN WHERE IT LOOKS LIKE IT BELONGS HERE. A
 * reset can arrive after the request was fully transmitted, and a connect
 * timeout is not reliably distinguishable from a response timeout across Node
 * versions. Being wrong about one of those sends a coach a duplicate, so this
 * set must not be expanded without a proof that no bytes could have left.
 */
const NEVER_CONNECTED = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);

/* ========================================================================== */
/* The credential boundary                                                     */
/* ========================================================================== */

/**
 * AN ACCESS TOKEN, FROM A REFRESH TOKEN, AND THE LIBRARY OWNS THE EXCHANGE.
 *
 * ---------------------------------------------------------------------------
 * THE DEPENDENCY SPLIT IS ALSO THE ONE-POST GUARANTEE.
 *
 * `google-auth-library` is already a dependency, is Google's own, and owns the
 * refresh exchange — the part nobody should hand-roll. But the SEND is a bare
 * `fetch`, and that is not a style preference:
 *
 *   `OAuth2Client.requestAsync` REPLAYS its request after a 401 or 403 — it
 *   refreshes and re-issues the same call — and gaxios underneath will retry
 *   when handed a `retryConfig`. Neither is reachable here, because the send
 *   never goes through the client. There is exactly one `fetch` call in this
 *   file and no code path that reaches it twice.
 *
 * `setCredentials` is given the refresh token AND NOTHING ELSE, which makes the
 * library's 401 replay unreachable even if somebody later routed a request
 * through the client: that branch requires a stored `access_token`, and there
 * is never one here.
 *
 * The endpoints the library DOES retry are Google's token endpoints. Those are
 * not mutations of a mailbox and retrying one cannot produce an email.
 * ---------------------------------------------------------------------------
 *
 * NEITHER TOKEN LEAVES THIS FUNCTION EXCEPT AS A RETURN VALUE THE CALLER USES
 * IMMEDIATELY. The refresh token is a parameter, the access token is never
 * stored, and neither is placed on a result, an event or an error.
 *
 * @returns {{ token, refreshToken }} — `refreshToken` is Google's replacement
 *   if it issued one, otherwise the one it was given. See the rotation note in
 *   `send` for why that distinction is handled rather than assumed away.
 */
async function defaultAccessTokenFor(refreshToken, config = resolveConfig()) {
  if (!googleOAuthConfigured(config)) {
    throw fail(TRANSPORT_REASON.PROVIDER_NOT_CONFIGURED,
      'Google OAuth is not configured on this server, so no mailbox can be authenticated.');
  }
  const client = new OAuth2Client({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
  });
  client.setCredentials({ refresh_token: refreshToken });

  let token;
  try {
    ({ token } = await client.getAccessToken());
  } catch (err) {
    /**
     * THE ORIGINAL IS DISCARDED, and this is the single most important line in
     * the file for secret hygiene: a token-exchange failure from gaxios carries
     * `err.config`, and that config carries the refresh token AND the client
     * secret in its form body. Re-throwing it would put both into whatever logs
     * the error. Only `safeCode` survives.
     */
    throw fail(TRANSPORT_REASON.MAILBOX_AUTH_FAILED,
      `Google would not renew this mailbox's access (${safeCode(err)}). The athlete probably `
      + 'needs to reconnect it.');
  }
  if (!token) {
    throw fail(TRANSPORT_REASON.MAILBOX_AUTH_FAILED,
      'Google returned no access token for this mailbox.');
  }
  /**
   * ROTATION IS READ, NEVER ASSUMED EITHER WAY.
   *
   * Google's web-server OAuth documentation lists a refresh response as
   * `access_token`, `expires_in`, `scope` and `token_type` — a replacement
   * `refresh_token` is documented at INITIAL authorisation, not at refresh. So
   * the normal case is that nothing rotates.
   *
   * The library would surface one on `client.credentials.refresh_token` if it
   * ever arrived, and handling it costs one line, so it is handled. What must
   * NOT happen is the opposite mistake: treating an absent `refresh_token` as
   * "the old one is gone" and clearing a credential that is still perfectly
   * good. Hence the `??` — absent means unchanged.
   */
  return { token, refreshToken: client.credentials?.refresh_token ?? refreshToken };
}

/* ========================================================================== */
/* Identity                                                                    */
/* ========================================================================== */

/**
 * IS THE ACCOUNT HOLDING THIS TOKEN THE ACCOUNT WE FROZE?
 *
 * ---------------------------------------------------------------------------
 * TWO COMPARISONS, BOTH MANDATORY, AND `sub` IS THE IMPORTANT ONE.
 *
 * `connected_mailboxes.email_address` was verified by Google at OAuth time from
 * a signed ID token and has not been checked since. A Workspace admin can
 * rename a user; a primary address can be swapped for an alias. If it has
 * drifted, the account that would actually send is not the account a named
 * operator authorised, and the coach receives mail from an address appearing
 * nowhere in the message's provenance.
 *
 * The `sub` claim is immutable for the life of a Google account and is exactly
 * what `provider_account_id` stores. The email comparison catches drift; the
 * `sub` comparison catches the much worse case, where the credential belongs to
 * a different account altogether.
 *
 * IT REFUSES, IT DOES NOT REPAIR. Updating `connected_mailboxes` from here
 * would resolve the disagreement by believing the newer of the two facts, which
 * is precisely the judgement a transport must not make — the mailbox row is the
 * provenance of every message already sent through it.
 * ---------------------------------------------------------------------------
 *
 * FAILS CLOSED, AND A FAILURE HERE IS A REFUSAL RATHER THAN AN AMBIGUITY. This
 * is a separate GET that happens BEFORE the Gmail POST; however it fails —
 * unreadable, timed out, refused — no message submission has occurred, because
 * the submission had not been attempted yet. That is why an ambiguous UserInfo
 * result is still REFUSED_BEFORE_TRANSPORT and must not be confused with an
 * ambiguous SEND.
 */
async function verifyAuthenticatedAccount({ request, accessToken, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(GOOGLE_USERINFO_URL, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
  } catch (err) {
    throw fail(TRANSPORT_REASON.IDENTITY_UNVERIFIABLE,
      'Google could not be asked which account this mailbox\'s credential belongs to '
      + `(${safeCode(err)}). Nothing was sent.`);
  }

  if (!response?.ok) {
    throw fail(TRANSPORT_REASON.IDENTITY_UNVERIFIABLE,
      'Google refused to say which account this mailbox\'s credential belongs to '
      + `(HTTP ${response?.status ?? 'no status'}). Nothing was sent.`);
  }

  let profile;
  try {
    profile = await response.json();
  } catch {
    throw fail(TRANSPORT_REASON.IDENTITY_UNVERIFIABLE,
      'Google\'s answer about the authenticated account could not be read. Nothing was sent.');
  }

  const subject = String(profile?.sub ?? '');
  const email = address(profile?.email);
  if (!subject || !email) {
    throw fail(TRANSPORT_REASON.IDENTITY_UNVERIFIABLE,
      'Google named no account for this credential. Nothing was sent.');
  }

  if (subject !== String(request.providerAccountId)) {
    /**
     * NEITHER ACCOUNT IS NAMED IN THE MESSAGE. The frozen one is ours to say,
     * but echoing the subject Google returned would put an identifier for a
     * third party's account into a log line, and the operator does not need it
     * to act: the instruction is the same either way.
     */
    throw fail(TRANSPORT_REASON.IDENTITY_MISMATCH,
      'The Google account this mailbox\'s credential authenticates is not the account the '
      + 'mailbox was connected as. Nothing was sent. Reconnect the mailbox.');
  }
  if (email !== address(request.from)) {
    throw fail(TRANSPORT_REASON.IDENTITY_MISMATCH,
      'This message was authorised to be sent from a different address than the Google account '
      + 'now sends as. Nothing was sent; the message would have gone out under provenance that '
      + 'is no longer true.');
  }
  return { subject, email };
}

/* ========================================================================== */
/* The adapter                                                                 */
/* ========================================================================== */

const refused = (reason, message, extra = {}) => Object.freeze({
  outcome: TRANSPORT_OUTCOME.REFUSED_BEFORE_TRANSPORT,
  provider: MAILBOX_PROVIDER.GOOGLE,
  reason,
  detail: message,
  httpStatus: null,
  ...extra,
});

/**
 * A GMAIL TRANSPORT, SHAPED LIKE EVERY OTHER TRANSPORT IN THIS BUILD.
 *
 * `{ name, send(request) }` — the same contract `fakeTransport` implements, so
 * `attemptSend` drives it without knowing which it holds and the result
 * boundary cannot tell them apart. Every dependency is injected: `fetchImpl`
 * for both HTTP calls, `accessTokenFor` for the credential exchange, and
 * `persistRefreshToken` for rotation. Production passes none of them — and,
 * for this slice, production never constructs this at all.
 *
 * WHAT IT RETURNS IS PROVIDER-NEUTRAL AND CARRIES NO PROVIDER OBJECT. Two ids,
 * a reason, a status and a duration. Gmail's Message resource echoes labels, a
 * snippet and potentially content, and letting it out of here would put message
 * text into whatever logs a result.
 *
 * NO `acceptedAt`. A timestamp is business state: it becomes
 * `provider_accepted_at`, it lands in a transaction, and it must agree with
 * every other clock reading in that transaction. `executionResult` owns it. An
 * adapter reading its own clock is how two columns on one row come to disagree
 * by a second.
 */
export function googleTransport({
  fetchImpl = globalThis.fetch,
  accessTokenFor = defaultAccessTokenFor,
  persistRefreshToken = storeMailboxCredential,
  timeoutMs = SEND_TIMEOUT_MS,
  date = undefined,
} = {}) {
  return {
    name: MAILBOX_PROVIDER.GOOGLE,

    async send(request) {
      /* ---- 1. is this even a transport input? --------------------------- */
      const need = ['mailboxId', 'from', 'to', 'subject', 'body',
        'providerAccountId', 'operatorUserId'];
      const missing = need.filter((k) => !request?.[k]);
      if (missing.length) {
        return refused(TRANSPORT_REASON.REQUEST_INCOMPLETE,
          `This is not a complete frozen execution: ${missing.join(', ')} missing.`);
      }

      /* ---- 2. the bytes, BEFORE anything is decrypted ------------------- */
      /**
       * BUILT FIRST ON PURPOSE, AND THE ORDERING IS TESTED.
       *
       * A subject carrying a newline, or an address that is really two, must
       * stop the send while the refresh token is still encrypted at rest. The
       * cheapest and most deterministic failure happens first; the credential
       * is never touched for a message that could never have been encoded.
       */
      let built;
      try {
        built = buildRfc822({
          from: request.from,
          to: request.to,
          subject: request.subject,
          body: request.body,
          /** Deferred for the MVP — see the module header in rfc822.js. */
          internetMessageId: null,
          ...(date ? { date } : {}),
        });
      } catch (err) {
        return refused(TRANSPORT_REASON.MESSAGE_UNBUILDABLE, err.message);
      }

      /* ---- 3. the credential, in the narrowest scope there is ----------- */
      /**
       * SCOPED TO THE OPERATOR WHO HOLDS THE MAILBOX. `mailboxCredential`
       * refuses a mailbox that operator does not own, so the ownership tie is
       * enforced by the existing authority rather than by a new one — and the
       * operator id itself was derived from the mailbox row the claim already
       * proved they held.
       *
       * THIS IS THE ONLY PLACE IN THE SEND PATH A REFRESH TOKEN IS DECRYPTED.
       * Not the claim, not the snapshot, not the route, not the result.
       */
      let accessToken;
      try {
        const credential = mailboxCredential(request.mailboxId, {
          operatorUserId: request.operatorUserId,
        });
        if (!credential?.refreshToken) {
          return refused(TRANSPORT_REASON.CREDENTIAL_MISSING,
            'This mailbox has no stored credential, so it cannot be authenticated. It was '
            + 'probably revoked. Nothing was sent.');
        }

        const issued = await accessTokenFor(credential.refreshToken);
        accessToken = typeof issued === 'string' ? issued : issued?.token;
        if (!accessToken) {
          return refused(TRANSPORT_REASON.MAILBOX_AUTH_FAILED,
            'No access token could be obtained for this mailbox. Nothing was sent.');
        }

        /**
         * A REPLACEMENT REFRESH TOKEN IS PERSISTED BEFORE THE SEND, NEVER
         * AFTER — and if it cannot be, the send does not happen.
         *
         * The failure this prevents: Google rotates the token, we send
         * successfully, and the write fails afterwards. The credential on file
         * is then the OLD one, which Google has just invalidated, and the
         * mailbox is silently dead until somebody notices. Refusing before the
         * POST costs one message that can be explicitly retried; the other
         * order costs every future message with no signal at all.
         *
         * Rotation is rare — see the note in `defaultAccessTokenFor` — so this
         * branch is normally not taken, and when it is not taken the stored
         * token is left exactly as it was.
         */
        const rotated = typeof issued === 'object' ? issued?.refreshToken : null;
        if (rotated && rotated !== credential.refreshToken) {
          try {
            persistRefreshToken(request.mailboxId, {
              refreshToken: rotated,
              operatorUserId: request.operatorUserId,
            });
          } catch (err) {
            return refused(TRANSPORT_REASON.CREDENTIAL_NOT_PERSISTED,
              'Google issued a replacement credential for this mailbox and it could not be '
              + `stored (${safeCode(err)}). Nothing was sent, because sending now would leave `
              + 'a credential on file that Google has already replaced.');
          }
        }
      } catch (err) {
        return refused(err.transportReason ?? TRANSPORT_REASON.MAILBOX_AUTH_FAILED,
          err.transportReason ? err.message
            : `This mailbox could not be authenticated (${safeCode(err)}). Nothing was sent.`);
      }

      /* ---- 4. and is it the account we think it is? --------------------- */
      try {
        await verifyAuthenticatedAccount({ request, accessToken, fetchImpl });
      } catch (err) {
        return refused(err.transportReason ?? TRANSPORT_REASON.IDENTITY_UNVERIFIABLE,
          err.message);
      }

      /* ---- 5. EXACTLY ONE MUTATION ------------------------------------- */
      const startedAt = Date.now();
      let response;
      try {
        response = await fetchImpl(GMAIL_SEND_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ raw: built.raw }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const code = safeCode(err);
        if (NEVER_CONNECTED.has(code)) {
          return refused(TRANSPORT_REASON.PROVIDER_UNREACHABLE,
            `Gmail could not be reached (${code}); no connection was established, so no request `
            + 'was made. Nothing was sent.', { durationMs });
        }
        /**
         * EVERYTHING ELSE IS UNRESOLVED, INCLUDING THE TIMEOUT.
         *
         * A timeout is the case this taxonomy exists for: the request body may
         * have been transmitted in full and Gmail may have accepted it, and the
         * only thing this process observed is that no answer came back. It is
         * not a failure. Calling it one would license a resend of a message a
         * coach may already be reading.
         */
        return Object.freeze({
          outcome: TRANSPORT_OUTCOME.UNKNOWN,
          provider: MAILBOX_PROVIDER.GOOGLE,
          reason: code === 'TimeoutError' || code === 'AbortError'
            ? TRANSPORT_REASON.TRANSPORT_TIMEOUT
            : TRANSPORT_REASON.CONNECTION_LOST,
          detail: `The Gmail request did not complete (${code}). It may or may not have been `
            + 'accepted, and must not be retried automatically.',
          httpStatus: null,
          durationMs,
        });
      }

      const durationMs = Date.now() - startedAt;
      const status = Number(response?.status);

      /* ---- 6. what did it say? ----------------------------------------- */
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }

      if (status >= 200 && status < 300) {
        const providerMessageId = payload?.id ? String(payload.id) : null;
        if (!providerMessageId) {
          /**
           * A 2xx WE CANNOT READ IS STILL NOT AN ACCEPTANCE WE CAN RECORD.
           *
           * Gmail almost certainly took the message. But ACCEPTED without a
           * provider message id is a claim with no evidence behind it, and the
           * row's whole purpose is to be auditable. UNKNOWN is the honest
           * answer and also the safe one: ambiguity never licenses a resend, so
           * nothing bad follows from being pessimistic here.
           */
          return Object.freeze({
            outcome: TRANSPORT_OUTCOME.UNKNOWN,
            provider: MAILBOX_PROVIDER.GOOGLE,
            reason: TRANSPORT_REASON.RESPONSE_UNREADABLE,
            detail: `Gmail answered ${status} but named no message, so the send cannot be `
              + 'recorded as accepted.',
            httpStatus: status,
            durationMs,
          });
        }
        return Object.freeze({
          outcome: TRANSPORT_OUTCOME.ACCEPTED,
          provider: MAILBOX_PROVIDER.GOOGLE,
          providerMessageId,
          providerThreadId: payload?.threadId ? String(payload.threadId) : null,
          /**
           * NULL FOR THE MVP. Gmail assigns its own Message-ID and we send
           * none; learning it would need a read scope we deliberately do not
           * hold. `internet_message_id` stays NULL on the row.
           */
          internetMessageId: null,
          httpStatus: status,
          durationMs,
        });
      }

      const providerReason = String(payload?.error?.errors?.[0]?.reason ?? '') || null;

      /**
       * 4xx IS A REFUSAL. 5xx IS NOT.
       *
       * VERIFIED from Google's Gmail API error guide: 400 (client error), 401
       * (invalid credentials), 403 (understood, not permitted — domain policy,
       * daily limit, rate limit), 404 and 429 (per-user or sending limits) are
       * all documented as the server declining a request it understood. None of
       * them is a message.
       *
       * THE 5xx READING IS OURS AND IT IS THE CONSERVATIVE ONE. Google
       * documents 500/502/503/504 as "an unexpected error occurred while
       * processing the request" and recommends retrying with exponential
       * backoff — correct advice for an idempotent call, and unsafe for this
       * one. "While processing" is precisely the window in which a message may
       * already have been queued, and Gmail offers no idempotency key with
       * which to find out afterwards. So a 5xx is UNKNOWN, and we do not retry.
       */
      if (status >= 500) {
        return Object.freeze({
          outcome: TRANSPORT_OUTCOME.UNKNOWN,
          provider: MAILBOX_PROVIDER.GOOGLE,
          reason: TRANSPORT_REASON.PROVIDER_SERVER_ERROR,
          providerCode: providerReason,
          detail: `Gmail answered ${status}, which it gives for a failure while processing a `
            + 'request. Whether the message was queued first is not knowable from here.',
          httpStatus: status,
          durationMs,
        });
      }

      if (status >= 400) {
        return Object.freeze({
          outcome: TRANSPORT_OUTCOME.REJECTED,
          provider: MAILBOX_PROVIDER.GOOGLE,
          reason: TRANSPORT_REASON.PROVIDER_REFUSED,
          providerCode: providerReason,
          /**
           * GOOGLE'S OWN MESSAGE IS NOT PASSED THROUGH. It is written for a
           * developer, it can quote the offending part of the request, and the
           * request is an email. The status and the machine-readable reason are
           * enough to act on and carry no content.
           */
          providerMessage: `Gmail refused this message (HTTP ${status}`
            + `${providerReason ? `, ${providerReason}` : ''}). Nothing was sent.`,
          httpStatus: status,
          durationMs,
        });
      }

      /** 1xx or 3xx from a JSON API is not an answer anybody modelled. */
      return Object.freeze({
        outcome: TRANSPORT_OUTCOME.UNKNOWN,
        provider: MAILBOX_PROVIDER.GOOGLE,
        reason: TRANSPORT_REASON.RESPONSE_UNREADABLE,
        detail: `Gmail answered ${Number.isFinite(status) ? status : 'nothing recognisable'}, `
          + 'which is not an outcome this transport can interpret.',
        httpStatus: Number.isFinite(status) ? status : null,
        durationMs,
      });
    },
  };
}
