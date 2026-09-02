# Hosting the operator application

Phase 13K. What has to be true for the internal Thriv3 application to run
somewhere other than one laptop, and the runbooks for putting it there and
taking it back.

Read `report-release.md` for what the report is and `report-delivery.md` for
the operator workflow around it. Neither changes here. This is the boundary and
the runtime underneath them.

## The shape

```
                    ┌─────────────────────────────────────────────┐
   operator ──TLS──▶│  one Node process, one instance             │
                    │                                             │
                    │  express                                    │
                    │   ├─ /                 the built app (public shell)
                    │   ├─ /healthz          liveness (public)
                    │   ├─ /p/:slug          athlete pages (public)
                    │   ├─ /api/track        event collector (public)
                    │   ├─ /api/auth/*       sign in / out / me
                    │   └─ /api/*            SESSION REQUIRED
                    └───────────────┬─────────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────────┐
                    │  one persistent volume, mounted at /data     │
                    │   recruitmatch.sqlite    the record          │
                    │   reports/               generated artefacts │
                    │   uploads/               stored analyses     │
                    └─────────────────────────────────────────────┘
```

Three things on the disk, not two. See **Three persistent paths** below — the
third one was found by a restore, not by reading the schema.

## Access

**Every `/api` route requires a session**, enforced by one `app.use` placed
before any route is declared, so a route added later is protected by default.
Four surfaces are deliberately outside it and an invariant checks the list is
exactly those four:

| | why it is public |
|---|---|
| `GET /` and the built assets | the shell that draws the sign-in screen; it holds no data |
| `GET /healthz` | the host calls it from outside, before any session exists |
| `GET /p/:slug` | athlete pages, read by coaches who have signed in to nothing |
| `/api/track` | the event collector those pages post to, cross-origin, cookie-less |

`/uploads` is **not** on that list. It holds uploaded files and every stored
matching analysis, so it sits behind the boundary like the API.

### Accounts

One table, no roles. Every authenticated account is an operator with the same
reach; the moment that stops being true it needs a design, not a flag.

```bash
npm run operator -- rhys@example.com          # prompts, echo off
THRIV3_OPERATOR_PASSWORD='…' npm run operator -- rhys@example.com
npm run operator -- --list
npm run operator -- rhys@example.com --reset      # ends every session
npm run operator -- rhys@example.com --deactivate # ends every session
```

There is no registration, no password reset over HTTP and no default password:
an account exists because somebody with shell access to the host made one. The
password reaches the script through the environment or a prompt with echo off,
never as an argument — an argument is in `ps` and in the shell history of
everybody who has typed it.

Passwords are hashed with **scrypt** from `node:crypto` (RFC 7914, OpenSSL's
implementation, one of the three functions OWASP recommends), salted, with the
parameters stored beside each hash so the work factor can be raised without
locking anybody out. `THRIV3_SCRYPT_COST` is log2(N) and defaults to **16**
(64 MiB, measured at 120–150 ms per verification). OWASP's floor is 17; this is
one notch below it deliberately, because two concurrent sign-ins at 17 would be
128 MiB each on an instance that already holds a benchmark pool. Login is rate
limited, so the attack the parameter defends against — offline cracking of a
stolen hash — still meets 64 MiB per guess.

### Sessions

An opaque 256-bit random token in an `HttpOnly; SameSite=Lax; Secure` cookie,
resolved against a row on the server. The cookie carries no identity, no claims
and no expiry, so there is nothing in it to edit. What the table stores is
**HMAC-SHA256 of the token under `THRIV3_SESSION_SECRET`**, which means a
leaked database or an old backup contains no usable session — and **rotating
the secret signs everybody out**, which is the lever you want at 2am and cannot
add later.

Idle timeout 12 hours, pushed forward on use; absolute lifetime 7 days. Signing
out deletes the row, so a replayed cookie gets nothing.

### CSRF

Every state-changing `/api` request must carry an `Origin` (or `Referer`)
matching `THRIV3_APP_ORIGIN`. This is OWASP's *Verifying Origin With Standard
Headers*, chosen over a synchroniser token because the app and its API are one
origin in production and the cookie is already `SameSite=Lax` — a token would
add a second thing that can be stale in the browser without catching a case
this misses. **It fails closed**: a write with no `Origin` and no `Referer` is
refused, because every browser sends one and a non-browser caller has no
ambient cookie to abuse.

### CORS and headers

Production allows exactly the app's own origin, with credentials. Never a
credentialed wildcard. The collector at `/api/track` keeps its own permissive
headers, deliberately: it is called from athlete pages on another origin,
carries no cookies and identifies nobody.

Headers come from `helmet`, with one deliberate split — the operator app gets a
real Content-Security-Policy and **`/p/` does not**, because those pages carry
an inline tracker and a YouTube embed that the app's policy would break
silently. The policy allows `fonts.googleapis.com` and `fonts.gstatic.com`
because `src/index.css` imports Space Grotesk and Inter; browser QA caught
that, and the symptom was the app rendering in fallback faces with nothing on
screen to explain it. HSTS is set only where TLS is real.

## The runtime contract

`server/lib/runtimeConfig.js` validates the environment at startup and
**exits 1 with every problem listed at once** rather than serving
half-configured. In development nothing is required.

| variable | required in production | what it is |
|---|---|---|
| `THRIV3_SESSION_SECRET` | yes, ≥32 chars | the key session tokens are hashed under; rotating it signs everybody out |
| `THRIV3_APP_ORIGIN` | yes, https | the app's own origin: the CORS allow-list and the CSRF check |
| `API_HOST` | yes | `0.0.0.0` to be reachable. The default is `127.0.0.1` and stays that way |
| `THRIV3_TRUST_PROXY` | yes | how many proxies are in front: `1` on a platform that terminates TLS, `0` if nothing does |
| `RECRUITMATCH_DB` | yes, absolute | the SQLite file, on the persistent volume |
| `THRIV3_REPORT_STORE` | yes, absolute | generated artefacts, on the same volume |
| `THRIV3_UPLOAD_DIR` | yes, absolute | uploaded files and stored analyses, on the same volume |
| `THRIV3_CLIENT_DIR` | no | where the built app is served from (`dist`) |
| `API_PORT` | no | default 8787 |
| `THRIV3_SCRYPT_COST` | no | log2(N), 14–20, default 16 |
| `THRIV3_SESSION_IDLE_HOURS` / `_MAX_DAYS` | no | default 12 / 7 |

Two rules worth stating out loud:

- **Loopback is still the default.** 13J bound `127.0.0.1` because the app had
  no authentication. A process reachable from the network is now a decision
  somebody wrote down, and it is only safe because the boundary above exists.
- **`trust proxy` is a hop count, never `true`.** Too low and no `Secure`
  cookie can be set, so sign-in fails with no visible error — startup catches
  exactly that combination. Too high and the process believes whatever
  `X-Forwarded-For` a caller invents, which is what the rate limiter counts.

An http `THRIV3_APP_ORIGIN` is refused in production **unless it is loopback**,
which is what allows a local production-mode run — a cookie on a loopback
origin is not a credential in transit anywhere, and a real deployment's origin
is a domain, so it cannot take that path by accident.

## Three persistent paths

`players.recommendations` does not hold an analysis. It holds a **path**, like
`/uploads/<uuid>-recommendations-<athlete>.json`. A restore of the database and
the report artefacts into a clean directory therefore produced an application
that signed in, listed every athlete, and said *"No matches yet"* for all of
them — because the third persistent thing was still on the machine the backup
was taken from.

On a container host, `server/uploads/` is discarded on the next deploy. So it
is a first-class persistent path: given explicitly in production, validated at
startup, and included in every backup. All three must be **on one volume**, so
one snapshot is one consistent moment; startup refuses a configuration that
spreads them across different top-level paths.

## SQLite, and the single-instance rule

The workload is one or a few operators, mostly reads, with narrow delivery
writes. That is a good SQLite profile and there is no reason to move to
Postgres because the app is hosted.

**SINGLE INSTANCE REQUIRED.** One process against one volume. Two processes
writing one SQLite file over a network filesystem is corruption, and neither
the artefact store nor the upload directory is shared storage. This is not a
comment to be remembered — the recommended host enforces it: a Render service
with a disk attached **cannot** be scaled beyond one instance, and a deploy
stops the old instance before starting the new one instead of overlapping them.
The cost is a few seconds of downtime per deploy, which for this tool is the
right trade.

## The recommended host

**Render**, one web service on the **Standard** plan (1 CPU / 2 GB), with a
5 GB persistent disk mounted at `/data`. `render.yaml` is the blueprint.

| | Render | Fly.io | Railway |
|---|---|---|---|
| persistent volume | yes, $0.25/GB/month | yes, $0.15/GB/month | yes, $0.15/GB/month |
| single instance | **enforced** with a disk attached | must be prevented by hand | one per volume |
| deploy overlap | old stopped before new — correct for SQLite | can overlap | can overlap |
| snapshots | daily, ≥7 days retained | daily, 5 days retained | less clearly documented |
| Node native modules | yes | yes | yes |
| TLS + custom domain | included | included | included |
| operational surface | git push | `fly.toml`, machines, CLI | usage-based billing |

Fly is cheaper and Railway is simpler to start, but Render is the one where the
constraint this architecture actually has — exactly one process on exactly one
disk — is a platform guarantee rather than a rule somebody has to keep. That is
worth more than a few dollars a month for a tool holding client documents.

**Not Cloudflare Pages/Workers**, and not by preference: Workers have no
filesystem and no native modules, so neither `better-sqlite3` nor the artefact
store can exist there. The Pages project stays what it is — the public athlete
profiles and the event collector, which is a different deployment.

### Cost

| | |
|---|---|
| Standard web service | **requires confirmation** — the docs pages available here do not carry the compute price; Render's pricing page is the source |
| 5 GB disk | $1.25/month, at the documented $0.25/GB |
| TLS, custom domain, daily snapshots | included |

Verified from Render's own documentation: disk storage $0.25/GB/month; daily
disk snapshots with at least seven days of retention; a service with a disk
cannot scale past one instance and does not get zero-downtime deploys. The
compute price is the one number that needs checking before provisioning.

For comparison, verified from Fly's pricing page: `shared-cpu-1x` at 256 MB is
$2.02/month, 512 MB $3.32, 1 GB $5.92; volumes $0.15/GB/month with automatic
daily snapshots kept 5 days.

### Why Standard and not Starter

Measured, in production mode, against the real database:

| | |
|---|---|
| RSS at boot | 46 MB |
| RSS after one cold report (one sport's benchmark pool built) | **378 MB** |
| RSS with both sports' pools resident | **389 MB** |
| a sign-in (scrypt, N=2¹⁶) | +64 MiB transient |

Starter is 512 MB. 389 MB resident plus a concurrent sign-in leaves almost
nothing, and an OOM kill mid-generation is a failed report with a `failed` row.
Standard's 2 GB is the honest choice. The pool is cached per process, which is
also why a serverless model is wrong here: a cold start pays 4.5 s every time.

### Limits that matter

- **Disk**: 5 GB. Artefacts are 73–100 KB each, so that is tens of thousands of
  reports; the database is 219 MB today.
- **No spin-down** on a paid Render instance, which matters because the first
  report after a restart pays 4.5 s to build the benchmark pool.
- **Deploys interrupt.** A few seconds, by design (see the single-instance rule).
- **Egress** is not material: the operator downloads PDFs measured in tens of
  kilobytes.
- The app loads its two webfonts from Google. On a host with no outbound
  network they fall back to system faces — cosmetic, and the CSP already
  permits the two hosts.

## Backups

```bash
npm run backup -- /path/to/backups                    # take one
npm run backup -- --verify /path/to/backups/thriv3-…  # read it back
npm run backup -- --restore /path/to/backups/thriv3-… --into /empty/dir
```

**A plain file copy is not a backup.** SQLite in WAL mode holds committed rows
in a separate log, so `cp` can produce a database missing its most recent
transactions — in 13J a copy reported three players where the live database had
four. It opened cleanly and looked right. So the script uses SQLite's **online
backup API**, then **opens the copy and counts it**, and writes a manifest with
the row counts, the integrity check and the file's hash. A test proves the file
copy is wrong and the API is right on the same database in the same state.

A backup holds all three paths — `database.sqlite`, `reports/`, `uploads/` —
and a manifest. It also reports, in both directions, any history row whose
artefact is absent and any artefact no row points at, and any athlete whose
stored analysis is missing.

**Frequency**: Render's daily disk snapshot (≥7 days retained) is the floor and
needs no work. On top of it, take an application backup with this script
**before every deploy and before any migration**, because Render's own
documentation warns against restoring a database disk from a snapshot — a
volume snapshot of a live SQLite file has the same WAL problem as `cp`.

**Retention**: keep the pre-deploy backups for 30 days and one a month
indefinitely. Generated artefacts are client documents; nothing deletes them
automatically, here or anywhere else in the product.

**Destination**: off the volume the app runs on. A backup on the disk it
protects is not a backup.

### Restore rehearsal — performed, not described

Run on 2026-09-03 against the real working database:

1. `npm run backup` — 219.1 MB, `integrity_check ok`, 4 players, 2,404
   colleges, 276,745 roster rows, 99 uploaded files (23.3 MB).
2. `--verify` — matched its manifest, hash `1cfb7fa3bdbb659d…`.
3. `--restore --into` a clean directory — every count identical.
4. Started the app against the restored copy in production mode.
5. Created an operator, signed in, opened an athlete's workspace: 100 schools
   on Program Philosophy, so the restored analyses were intact.
6. Generated a report from the restored data, downloaded it, regenerated it —
   two immutable artefacts, one fingerprint.

The rehearsal is also what found the missing third path: the first attempt
restored the database and the artefacts, signed in fine, and showed *"No
matches yet"* for every athlete.

## Artefact and database consistency

A restore can land the two halves at different moments. What the product does
about each case:

| | behaviour |
|---|---|
| history row, artefact missing | the row stays; the download answers 410 with *"The report was recorded but its file is missing from the store. Regenerate it."* **It is never regenerated silently** — a document that was sent cannot be recreated from today's data and called the same document |
| artefact present, no history row | kept, and reported by `--verify`. Deleting a file nothing points at is how the wrong file gets deleted |
| athlete points at a missing analysis | the Program Philosophy tab reads *"No matches yet"*, which is indistinguishable from never having been analysed — so `--verify` names the athletes |

**Historical integrity wins.** That is why all three paths share one volume and
one snapshot.

## Deployment runbook

Not executed. Nothing is deployed.

1. **Provision** a Render web service from `render.yaml` (Standard plan, region
   nearest the operator). Do not deploy yet.
2. **Attach** the 5 GB disk at `/data`.
3. **Set the environment**: `THRIV3_SESSION_SECRET` (let Render generate it),
   `THRIV3_APP_ORIGIN` (the service's URL or the custom domain),
   `ANTHROPIC_API_KEY`, `THRIV3_SENDER_IDENTITY`, `THRIV3_POSTAL_ADDRESS`,
   `THRIV3_SYNC_SECRET`, `THRIV3_PUBLIC_BASE_URL`. The blueprint sets the rest.
4. **Take a local backup** — `npm run backup -- ~/thriv3-backups` — and check
   the integrity line before going near the host.
5. **Copy the database up** with the backup's `database.sqlite`, never a `cp`
   of a live file, to `/data/recruitmatch.sqlite`.
6. **Copy `reports/` and `uploads/`** to `/data/reports` and `/data/uploads`.
7. **Deploy.** Watch the boot log: it prints the runtime line — mode, bind
   address, whether authentication is required, whether cookies are Secure, and
   the origin. If configuration is missing, the process exits with the list.
8. **Health check**: `GET /healthz` → `{"status":"ok"}` with all three checks
   true.
9. **Create the first operator** from the host's shell:
   `THRIV3_OPERATOR_PASSWORD='…' npm run operator -- rhys@example.com`, then
   `--list` to confirm. Unset the variable afterwards.
10. **Sign in** over HTTPS. Confirm the cookie is `Secure` and `HttpOnly`.
11. **Generate one test report**, download it, confirm the filename, then
    delete that history row and artefact if it was only a test.
12. **Restart the service** and confirm the report history and the artefact are
    both still there — that is the persistence check, and the only one that
    matters.

## Rollback runbook

1. **Know the previous version**: the deploy before this one in Render's
   history, and the git SHA it built. `generated_reports.engine_sha` records
   which engine produced each artefact.
2. **Take a backup first**, even of a broken state. It is the only way back
   from a rollback that turns out to be wrong.
3. **Roll the code back** — redeploy the previous deploy from Render's history.
   Code and data are independent: rolling back code changes no row and deletes
   no file.
4. **Reverse a migration only if the new code wrote something the old code
   cannot read.** 13J and 13K added nullable columns only:
   ```sql
   ALTER TABLE generated_reports DROP COLUMN generated_by;
   ALTER TABLE generated_reports DROP COLUMN generated_by_email;
   ALTER TABLE generated_reports DROP COLUMN content_sha256;
   DROP TABLE operator_sessions;
   DROP TABLE operator_users;
   ```
   Old code ignores all of them, so **the usual answer is to reverse nothing**.
5. **Generated PDFs are never lost to a rollback.** They are files on the
   volume keyed by an id, and no code path deletes them. A rollback past 13J
   leaves the artefacts on disk with nothing reading them, which is recoverable;
   the reverse would not be.
6. **Restore data only if the data is what broke** — and then into a clean
   directory first, look at it, and swap it in. The script refuses to restore
   over a live database for exactly that reason.
7. **Rotating `THRIV3_SESSION_SECRET`** signs everybody out and is the right
   move if a session may have leaked. It costs one sign-in.

## Local development

Unchanged. `npm run dev` starts the API on 8787 and Vite on 5183, nothing is
required in the environment, and the API still binds loopback. The one new step
is that you need an account:

```bash
THRIV3_OPERATOR_PASSWORD='a-long-enough-local-password' \
  npm run operator -- you@example.com
```

The development session secret is random per boot rather than a fixed value in
the repository, because a fixed development secret becomes a production one the
first time somebody copies the file. A restart signs you out; signing back in
takes four seconds.

To run the production route shape locally — built client served by Express, one
origin, authentication on:

```bash
npm run build
NODE_ENV=production API_PORT=8791 API_HOST=127.0.0.1 THRIV3_TRUST_PROXY=0 \
  THRIV3_APP_ORIGIN=http://127.0.0.1:8791 \
  THRIV3_SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  RECRUITMATCH_DB=/tmp/stage/recruitmatch.sqlite \
  THRIV3_REPORT_STORE=/tmp/stage/reports \
  THRIV3_UPLOAD_DIR=/tmp/stage/uploads \
  THRIV3_CLIENT_DIR=dist node server/index.js
```

## The future send flow

Still not built, and the boundary is unchanged by authentication: a send will
reference **an existing `generated_reports.id`** and will never regenerate.
What 13K adds is the operator identity that a send needs — `generated_by`
already records who produced each artefact, and a `sent_reports` row would
record who sent which one.

```
GENERATE  →  REVIEW  →  SEND EXISTING ARTEFACT
```

## Logging

At a safe level, on purpose:

```
[auth] login              { ip, email }          — success
[auth] login failed       { ip, email }          — never whether the address exists
[auth] login rate limited { ip }
[reports/generate]        { report, operator, pages, status }
[reports/download] refused{ report, status, operator }
```

Never logged: a password, a session token, a whole cookie, PDF bytes, or an
athlete's record. A configuration failure at startup prints the problems and
nothing else.
