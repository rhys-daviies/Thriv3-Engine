# L8A — operator authentication architecture

Audit and design only. Nothing implemented, no user or session created, no
route changed, no product data touched.

**Result: DECISION REQUIRED — stop condition 1. Operator authentication already
exists, is complete, and is deployed on `main`. L7ZK's finding is out of date.
This is not a design stage; it is an adoption stage, and the design work is
already done and better than what I would have specified.**

---

## The finding

L7ZK recorded: no application authentication, `operator_users` and
`operator_sessions` "empty and vestigial, not populated by repository
application code", no `req.user`, no session, no middleware.

That is still true **of this branch**. It is not true of the repository.

`main` carries `server/lib/operatorAuth.js` — "OPERATOR ACCESS — Phase 13K" —
with the middleware mounted:

```js
app.use('/api', authRouter);        // login / logout / me — the only unauthenticated /api
app.use(mailboxConsentPageRouter);  // public capability-token surfaces, above the line
app.use('/api', mailboxConsentPublicRouter);
app.use('/api', requireOperator);   // <- the boundary
app.use('/api', mailboxRouter);
app.use('/uploads', requireOperator, express.static(UPLOADS_DIR));
```

| | `main` | `engagement-tracking` (here) |
| --- | --- | --- |
| `operatorAuth.js` | ✅ | ❌ |
| `requireOperator` boundary | ✅ mounted at `/api` | ❌ |
| `authRouter` login/logout/me | ✅ | ❌ |
| `operator_users` / `operator_sessions` in `schema.sql` | ✅ | ❌ |
| bootstrap CLI (`npm run operator`) | ✅ | ❌ |
| `rosterSeasonTrust` route | ❌ | ✅ |

The branches diverged: **main is 167 commits ahead, this branch is 57 ahead.**
The tables exist in the live database because the corpus is shared — another
checkout's migrations created them, which is exactly the L7ZM topology.

---

## What already exists, audited

### Credentials

scrypt from `node:crypto` — OWASP-recommended, already in the platform, so no
second native module beside `better-sqlite3`. `timingSafeEqual` for comparison.
Parameters travel in a self-describing string, so the cost can be raised without
invalidating stored hashes.

### Sessions

Opaque 256-bit random tokens, resolved server-side. The cookie carries no
identity, no claims, no expiry — nothing for a client to edit and no signature
to get wrong.

**The token is never stored.** The table holds HMAC-SHA256 of it under
`THRIV3_SESSION_SECRET`, so a leaked dump or an old backup contains no usable
session, and rotating the secret signs everybody out.

Both an **idle** and an **absolute** deadline, with the idle one sliding and
clamped to the absolute:

```js
const slid = iso(now + config.sessionIdleHours * 3600_000);
slideSession.run(stamp, slid < row.absolute_expires_at ? slid : row.absolute_expires_at, key);
return { user: { id: row.user_id, email: row.email }, expiresAt: row.expires_at };
```

Default idle 12 hours (`THRIV3_SESSION_IDLE_HOURS`).

### Cookie

`httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/'`,
`maxAge = sessionIdleHours`.

### CSRF

`requireSameOrigin` — OWASP "Verifying Origin With Standard Headers", chosen
over a synchroniser token because app and API share an origin in production and
the cookie is already `SameSite=Lax`. **Fails closed**: no Origin and no Referer
is a refusal, on the reasoning that browsers always send one and a non-browser
caller has no ambient cookie to abuse.

### Rate limiting

Login attempts bounded through the collector's existing limiter, keyed on
**both** address and account, so neither one client hammering an account nor one
client trying many is unbounded. Explicitly proportionate — no lockout an
attacker could trigger against a real operator.

### Startup validation

Production refuses to start without `THRIV3_SESSION_SECRET`, and checks its
length. An origin allow-list is required in production; the dev fallback is
separate.

### Surface

`authRouter` (login / logout / me) is the **only** unauthenticated `/api`
surface. The athlete mailbox-consent routes sit above the boundary deliberately
and are capability-token protected — unauthenticated in the session sense, not
in the capability sense, and with no code path to `createSession`.

---

## Options, re-scored against reality

| | verdict |
| --- | --- |
| **A** — first-party email+password, opaque server session, existing tables | **already implemented on `main`, and well.** Nothing to design |
| **B** — external IdP / OIDC | reject. Adds a dependency and an outage surface for a handful of internal operators, and would discard working code |
| **C** — platform access control only | **reject — it cannot answer the question.** See below |
| **D** — signed static token / API key | reject. A shared key is not a person; it cannot attribute a review |
| **E** — other | none. The existing design already chose better defaults than I would have specified |

### Why platform protection is not enough

Vercel/Render protection answers *"is this request allowed?"*. Trust
attribution needs *"which human decided this?"*. A platform gate admits a set of
people and records none of them against a row, so
`reviewed_by_operator_id` would still be null and L7ZK's governance rule would
still be unmet. **Platform protection sufficient for reviewer identity: NO.**

---

## The trust write path fits with no domain change

This branch's `operatorFromRequest`:

```js
export function operatorFromRequest(req) { return req?.operator?.id ?? null; }
```

`main`'s attach step:

```js
if (session) req.operator = session.user;   // { id, email }
```

L7ZK built the door to the exact shape of the lock that already existed. Once
the branches are merged, `POST /api/roster-season-trust/disposition` authenticates
with **zero changes to `rosterSeasonTrust.js` or `seasonTrustReview.js`**:

- client body carries domain intent only — identity, disposition, evidence,
  next_action, expected_disposition
- **server owns** `reviewed_by_operator_id` (from `req.operator.id`) and
  `reviewed_at` (server clock)
- `SERVER_OWNED` spoof rejection stays a 400 naming the field
- `expectedDisposition` optimistic concurrency stays a 409

Nothing about the domain contract changes. The 503 simply stops firing, because
an operator is present.

---

## EXCLUDE consistency — reconfirmed closed

`exclusionBlockedReason(sport)` returns **null** for both sports today, because
L7ZP left `recruiting_arrivals` FRESH. So if an authenticated
`EXCLUDE_FROM_EVIDENCE` were written:

1. the trust row is written with a real reviewer and a server timestamp
2. the effective roster loses that programme-season immediately — every raw
   roster read already appends the trust predicate
3. `effectiveInputDigest` moves, so the materialisation becomes **STALE**
4. `assertServable` **raises** on both recruiting-pattern loaders, so no stale
   arrival claim can reach Evidence or coach copy
5. `npm run build:recruiting` rebuilds without that season and returns FRESH
6. Manifest V6 moves — it now carries `recruiting_arrivals` *and*
   `roster_season_trust`, so the dataset identity cannot miss either half
7. baselines move and would need a deliberate repin with attribution

**Materialisation blocker: CLOSED. Authentication was the only one left, and it
turns out to exist.**

---

## Requirements

**Must have now** — all already satisfied by `main`: stable operator id, unique
login identifier, server-created session, HttpOnly + Secure + SameSite cookie,
CSRF posture, idle and absolute expiry, logout revocation, password hashing with
a documented upgrade path, attempt throttling, disabled-operator handling,
server-owned reviewer and timestamp.

**Later hardening**, none blocking: session listing and remote revocation for an
operator, periodic expired-session cleanup, audit log of sign-ins, and an
absolute-expiry review once real usage exists.

**RBAC: not now.** Every authenticated account is an operator with the same
reach, which the module states explicitly, and no repository privilege
distinction contradicts it. Authentication and authorisation stay separate.

---

## What this stage changes about the plan

The original decomposition assumed building auth. It should not be built.

| stage | scope |
| --- | --- |
| **L8B** | **Reconcile the branches.** Merge `main` into `engagement-tracking` (167 commits), resolve conflicts, prove the L7Z invariants survive: roster/trust/arrivals hashes, arrivals FRESH, Manifest V6, six baselines, P6. This is the whole of the work and it is not small |
| **L8C** | Mount `requireOperator` over the trust route and prove the write path end to end: unauthenticated 503/401, authenticated RETAIN, spoof rejection, concurrency, service-secret separation |
| **L8D** | Operator review UI for the 13 undispositioned trust records — and only then, the first real disposition |

L8B is a merge stage, not a feature stage, and it is where the risk is. `main`
has 167 commits of campaign, mailbox, execution and V1-baseline work; this
branch has 57 commits of Evidence-governance work including Manifest V6 and the
materialisation contract. Both touch `schema.sql`, `migrate.js`, `index.js` and
the baseline pins.

**Bootstrap** is already solved: `npm run operator` →
`server/scripts/createOperator.js`. No operator is created here.

---

## Test plan

Most of it exists on `main` — `server/lib/operatorAuth.test.js` and
`server/routes/auth.test.js`. What L8C must add is the *intersection*: the trust
route under a real boundary. Correct login, wrong password, unknown and disabled
operator, session creation, idle and absolute expiry, revocation, logout, cookie
flags, middleware attachment, unauthenticated write refusal, authenticated
RETAIN, EXCLUDE preconditions, reviewer and timestamp server ownership, spoof
rejection, optimistic concurrency, `SYNC_SECRET` separation, same-origin
behaviour, and local development without HTTPS.

---

## Data immunity

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `2d694ab74f831491` | `2d694ab74f831491` |
| arrivals freshness | FRESH | FRESH |
| Manifest V6 | `cc28ee6accdb84ed` | `cc28ee6accdb84ed` |

Trust unchanged at 15 / 2 RETAIN / 13 NULL / 0 EXCLUDE. No operator, no session,
no route, no migration.

---

## A note on method

The locked discipline says to reproduce a claimed defect through the production
function responsible before acting on it. Applied here it caught something
larger than a defect: **the premise of the stage**. L7ZK's audit was accurate
when written and had simply been overtaken by work on another branch — the same
shared-repository blind spot as L7ZL-C, in a new place.

Reading `main` before designing cost one command and saved designing a system
that already exists.
