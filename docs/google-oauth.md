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
  → link returned ONCE, operator sends it to the athlete
  → athlete opens  GET /api/mailbox-consent/:token
  → athlete presses Connect
  → POST /api/mailbox-consent/:token/start        → 302 to Google
  → athlete signs in with Google, on Google's page
  → GET /api/mailbox-consent/google/callback?state&code
  → mailbox + encrypted refresh token stored (D2)
```

The link grants no session, no operator access and no dashboard. There is no
code path from a consent grant to `createSession`, and a test asserts it.

## The two secrets, and why they are separate

| | lifetime | single-use | stored as |
|---|---|---|---|
| consent token | 30 minutes | yes — spent only on success | HMAC-SHA256 under the session secret |
| OAuth `state` | 10 minutes | yes — spent by the callback, whatever the outcome | HMAC-SHA256 under the session secret |

The consent token is **not** used as `state`. Doing so would put a live bearer
capability through Google's servers, the browser history and the `Referer` of
every link on the callback page. `state` is a nonce; the grant is a capability.

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

> **`gmail.send` is a RESTRICTED scope.** Publishing to external users requires
> Google verification and, for restricted scopes, a third-party security
> assessment. Budget for that before go-live; unverified apps are capped at 100
> users and show an unreviewed-app warning.

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
   verification, and the restricted-scope assessment above.
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
