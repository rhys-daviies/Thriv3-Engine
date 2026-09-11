# Google mailbox authorisation — D3

How an athlete authorises Thriv3 to send from their own Gmail, and what has to
exist in Google Cloud before it works. **No mailbox has been connected yet**;
this describes the flow the code implements and the project setup it needs.

## The model

Thriv3 has one authenticated operator. Athletes have no account, no login and
no dashboard, and D3 does not change that. What an athlete gets is a
**capability**: one unguessable token that authorises exactly one action.

```
operator picks an athlete
  → POST /api/players/:id/mailbox-consents        (session + same-origin)
  → link returned ONCE:  https://…/mailbox-consent#<token>
  → athlete opens it     GET /mailbox-consent     ← no token in the request
  → page script reads location.hash, clears it with history.replaceState
  → POST /api/mailbox-consent/resolve  { token }  → first name, nothing else
  → athlete presses Connect
  → POST /api/mailbox-consent/start    { token }  → { authorization_url }
  → page navigates to Google; athlete signs in on Google's page
  → GET /api/mailbox-consent/google/callback?state&code
  → mailbox + encrypted refresh token stored (D2)
```

The link grants no session, no operator access and no dashboard. There is no
code path from a consent grant to `createSession`, and a test asserts it.

## Why the token is after a `#` — D3.1

D3 served the page at `/api/mailbox-consent/:token`. That put a live bearer
capability in the request path, and a request path is not a private channel. It
was measured against this application rather than assumed: with a logging proxy
in front of the real app, **two of the four request-log lines contained the raw
token**, and the second contained it twice — once in the request line and once
in `Referer`, because the page then posted to `/:token/start`. The standard
combined access-log format records both fields.

The platform makes the same point. Render's logging documentation lists `path`
as a first-class, filterable field of its HTTP request logs, retained 7–30 days
by plan and optionally streamed to a third-party log provider. So the exposure
is not hypothetical and not confined to a proxy we control: browser history, the
platform's own log store, any log stream downstream of it, and every copy of the
URL a support conversation makes.

A **URL fragment is the one part of a URL a browser never transmits.** So:

1. the page at `/mailbox-consent` is the same bytes for every visitor — the
   server has not been told which grant this is, so there is nothing to log;
2. its one script reads `location.hash`, then removes it with
   `history.replaceState` so it leaves the address bar and the history entry;
3. the token is POSTed in a **request body** to `/resolve`, and again to
   `/start` — bodies are not in request logs, and both POSTs sit under the
   existing same-origin check;
4. the page navigates to Google itself, under `referrer-policy: no-referrer`,
   so Google receives nothing about where the athlete came from.

The token is therefore in no path, no query string, no `Referer`, no cookie, no
`localStorage`, no `sessionStorage` and no log line. It lives in a closure
variable for the life of the page. A reload loses it and the athlete opens the
link again, which costs one tap and spends nothing — opening a link has never
consumed the grant.

The script is an **external file**, not an inline block, so the operator app's
`script-src 'self'` policy covers the page as it stands. Hardening the consent
flow did not loosen the policy protecting everything else.

**What is still in a URL, deliberately:** Google's `state`, because OAuth
returns it in a query string. That is why it is a separate secret — ten minutes,
single use, spent by the callback on any outcome, and worthless without the PKCE
verifier this server holds and never sends. It names a transaction; it grants
nothing.

**The residue, stated plainly.** The fragment is still in the athlete's email
and may be recorded in their own browser's local history before
`replaceState` rewrites the entry. Neither is reachable by us, by a proxy or by
a log; both are bounded by the same thirty-minute, single-use expiry. And the
page requires JavaScript — with it off, the athlete is told so and nothing
happens, which is the price of not putting the secret in the URL.

## The two secrets, and why they are separate

| | lifetime | single-use | stored as |
|---|---|---|---|
| consent token | 30 minutes | yes — spent only on success | HMAC-SHA256 under the session secret |
| OAuth `state` | 10 minutes | yes — spent by the callback, whatever the outcome | HMAC-SHA256 under the session secret |

The consent token is **not** used as `state`. Doing so would put a live bearer
capability through Google's servers, the browser history and the `Referer` of
every link on the callback page. `state` is a nonce; the grant is a capability.
`state` is also the only one of the two that appears in a URL at all — see the
fragment section above.

Neither raw value is ever stored, so a database dump contains no usable link and
no forgeable callback. Rotating `THRIV3_SESSION_SECRET` invalidates every
outstanding grant and transaction at once.

**The grant survives** a refresh, a cancelled Google screen and a failed
exchange — none of those is the athlete having connected anything. It is spent
only when a mailbox actually exists.

## PKCE

Authorization code + PKCE, S256. Used **even though this is a confidential
client with a secret**, because the two defend different things: the secret
proves the exchange came from our server; the verifier proves it came from the
browser session that started the redirect. A code intercepted at the redirect is
useless without the verifier, and the client secret does nothing about that.

The verifier is encrypted at rest with the D2 mailbox key (transaction id as
AAD) and never reaches a browser — only the S256 challenge goes to Google.

### Why there is no OIDC `nonce` — D3.1, and the one thing to check in D4

We do not send `nonce`, and it was considered rather than overlooked.

`nonce` binds an ID token to the request that asked for it. It earns its place
in the **implicit and hybrid** flows, where an ID token arrives through the
browser and could therefore be swapped for another. This is the **authorization
code flow with a confidential client**: the ID token is returned directly by
Google's token endpoint, over TLS, in response to our own code, our PKCE
verifier and our client secret. There is no front channel for a token to be
injected into, so there is nothing for a nonce to catch there.

The attack a nonce would otherwise cover here is **authorization code
injection** — an attacker planting their own code in the athlete's callback so
the athlete's grant binds to the attacker's mailbox. PKCE already defeats it:
the attacker's code was issued against the attacker's `code_challenge`, and the
verifier this server stored will not match. The OAuth 2.0 Security Best Current
Practice treats PKCE and `nonce` as **alternative** mitigations for exactly that
attack, and we have PKCE with S256. Adding a nonce would be a second lock on the
same door.

So it does not materially improve replay or substitution resistance, and it is
not added for ceremony.

> **The open question, flagged rather than answered.** Google's own OpenID
> Connect documentation lists `nonce` as **(Required)** in its authentication
> URI parameter table, even though OIDC Core makes it optional for the code
> flow. D3 performed no real Google round trip, so we do not know whether
> Google's endpoint enforces that. **D4's first live authorization must check
> it**: if Google rejects a request without `nonce`, add one — the transaction
> row already has the shape for it (store an HMAC alongside `state_hmac`, check
> the ID token's `nonce` claim in `exchangeCodeForIdentity`). That is a
> conformance fix, not a security one, and this note exists so it is a decision
> rather than a surprise.

## Scopes

| scope | why |
|---|---|
| `openid` | asks for an ID token at all; without it there is no signed identity |
| `.../auth/userinfo.email` | the verified address, which becomes the mailbox identity |
| `.../auth/gmail.send` | send-only — cannot read, list, label or draft |

`profile` is **not** requested: it buys a display name, and asking a recruit for
their Google profile to store a nicety is the wrong trade on a consent screen.

`gmail.send` is requested now although D3 sends nothing. Google presents scopes
at consent, so deferring it to D5 would mean asking the same athlete a second
time — and a second consent request reads like something went wrong.

### What `gmail.send` actually costs us

> **`gmail.send` is a SENSITIVE scope, not a restricted one.** Google's Gmail
> API scope table lists it under Sensitive. The **restricted** Gmail scopes are
> the ones that can read or alter mail — `https://mail.google.com/`,
> `gmail.readonly`, `gmail.compose`, `gmail.insert`, `gmail.modify`,
> `gmail.metadata`, `gmail.settings.basic`, `gmail.settings.sharing` — and we
> request none of them.

The distinction decides what go-live costs:

| | applies to | what it is |
|---|---|---|
| **OAuth app verification** | sensitive **and** restricted scopes | **we need this.** Brand review plus a justification for each scope, before the app may be published to external users. |
| **Annual independent security assessment** (CASA) | **restricted scopes only** | **we do not trigger this.** It is not required for a sensitive scope, and `gmail.send` is sensitive. |

Until verification is granted, Google shows an unverified-app screen and the
project is capped at **100 users** — a lifetime cap on the project that cannot
be reset, so do not spend it on throwaway test accounts. Testing publishing
status is separately limited to 100 named test users.

Choosing send-only is therefore not only least-privilege on the consent screen;
it is what keeps us out of the assessment regime entirely. Adding any Gmail read
or modify scope later would move this app into the restricted tier and bring the
annual assessment with it — a scope change with a recurring bill attached, not a
one-line edit.

## Identity

`provider_account_id` is the ID token's **`sub`** — stable, and unaffected by an
address change. `email_address` is the token's `email`, and **`email_verified`
must be true** or the connection is refused: it becomes the address a coach sees
a message come from.

Nothing the browser sends can name the account. Not the consent link, not a
query parameter, not what the athlete typed — only the signed payload.

`access_type=offline` with `prompt=consent`, because Google withholds a refresh
token on re-authorisation unless consent is re-requested. **No refresh token
means no connection**: an access token lasts an hour and is never stored, so a
mailbox recorded without one would be `CONNECTED` and unable to send.

## Reconnection and collisions

| case | behaviour |
|---|---|
| same Google account, same athlete | reconnection — identity reused, credential replaced, revocation cleared |
| same Google account, different athlete | **refused**; an operator must resolve it |
| same address, different Google account | two mailboxes — the account is the identity, not the string |

## Google Cloud setup

1. Create a project; enable the **Gmail API**.
2. **OAuth consent screen** — External. Publishing status Testing while under
   development (add each test mailbox as a Test user); Production requires
   OAuth app verification, because `gmail.send` is a sensitive scope. It does
   **not** require the restricted-scope security assessment — see above.
3. Add scopes: `openid`, `userinfo.email`, `gmail.send`.
4. **Credentials → OAuth client ID → Web application.**
5. **Authorised redirect URI** — exactly, one per environment:
   `https://<THRIV3_APP_ORIGIN>/api/mailbox-consent/google/callback`
   Local: `http://127.0.0.1:8787/api/mailbox-consent/google/callback`.
   Google matches exactly; a trailing slash is a different URI.
6. No authorised JavaScript origin is needed — the exchange is server to server.
7. Put the client id and secret in the environment. **Never in the repository.**
   Separate credentials per environment, so a development client can never mint
   tokens usable against production data.

## Configuration

| variable | |
|---|---|
| `THRIV3_GOOGLE_CLIENT_ID` | both or neither; half a configuration fails at startup |
| `THRIV3_GOOGLE_CLIENT_SECRET` | |

The redirect URI is **derived** from `THRIV3_APP_ORIGIN` and never accepted from
a caller. Without both variables the flow is disabled and the routes say so —
the process still starts, because an installation that has not set up a Google
project should still run everything else.
