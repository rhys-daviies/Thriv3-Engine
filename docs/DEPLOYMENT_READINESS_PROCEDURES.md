# Deployment readiness procedures (draft for approval)

Drafted 2026-10-09 after the production-readiness audit, which was **NO-GO**. Revised the same day after review of PR #82. Nothing here has been run.

These procedures:
- inspect production without changing it;
- take a consistent, verified backup;
- rehearse main's first boot on a **copy** of production's database, sealed off from every external service;
- measure coach eligibility on that copy.

Each section needs its own approval before it runs. None of them deploys, migrates production, writes production data, changes Auto-Deploy, sends email, contacts a real person or prints a secret value.

- **Old:** production runs PR #63's merge commit, `387b916758425d3f2a926c454fe1fee8d0ee7898` (§1d).
- **New:** main as it stands at rehearsal time, recorded as a full SHA in the rehearsal report. Today that is `0caa9e7`. Its runtime code is identical to `43f01cd`; only docs and tests differ.

---

## 0. Ground rules for every step

- **Secrets never appear in output.** Environment variables are listed by **name** only. A secret's presence is reported as `set` / `MISSING`, never its value or length.
- **Render API keys are account-wide.** Render has no read-only key scope, so a key used here can also change production. Safer options, best first:
  1. You run the §1 commands and paste the output.
  2. Use a key created for this inspection and revoke it straight afterwards.
  3. Use dashboard screenshots.
- **Production's database file is never opened by these procedures.** Only `npm run backup`, which uses SQLite's online backup API and opens the *copy*, touches it. All measurement happens on copies, off Render.
- **Nothing from the rehearsal ever goes back to production.** Rehearsal copies contain synthetic rows (§3d) and are destroyed afterwards. Production is only ever restored from a §2 backup.
- **Real people are never contacted.** No step sends, drafts to or publishes for a real coach, athlete or programme. Only the synthetic records of §3d are written to, and only on a rehearsal copy.

---

## 1. Read-only Render inspection

**Answers:** which commit is deployed, the Auto-Deploy and Blueprint sync settings, the environment variable names, and disk capacity.

### 1a. Through the Render API (GET requests only)

Run from your machine. `RENDER_API_KEY` is read from your shell, never pasted into chat. All output is reduced to non-secret fields by `jq`. Field names follow Render API v1; if a field comes back `null`, show the raw keys (`jq 'keys'`), never the values.

```bash
export RENDER_API="https://api.render.com/v1"
```
```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" "$RENDER_API/services?name=thriv3-operator&limit=20" | jq '.[].service | {id, name, type, branch, autoDeploy, repo, rootDir, suspended, createdAt, updatedAt, plan: .serviceDetails.plan, region: .serviceDetails.region, build: .serviceDetails.envSpecificDetails.buildCommand, start: .serviceDetails.envSpecificDetails.startCommand, healthCheckPath: .serviceDetails.healthCheckPath, numInstances: .serviceDetails.numInstances}'
```
```bash
export SRV=<service id from the previous command>
```
```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" "$RENDER_API/services/$SRV/deploys?limit=15" | jq '.[].deploy | {id, status, trigger, commit: .commit.id, message: (.commit.message // "" | split("\n")[0]), createdAt, finishedAt}'
```
```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" "$RENDER_API/services/$SRV/env-vars?limit=100" | jq -r '.[].envVar.key' | sort
```
```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" "$RENDER_API/env-groups?limit=50" | jq '.[].envGroup | {id, name}'
```
```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" "$RENDER_API/env-groups/<THRIV3 group id>" | jq -r '.envVars[].key' | sort
```
```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" "$RENDER_API/disks?serviceId=$SRV" | jq '.[].disk | {id, name, sizeGB, mountPath}'
```
```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" "$RENDER_API/blueprints?limit=20" | jq '.[].blueprint | {id, name, status, autoSync, repo, branch}'
```

### 1b. From the Render Shell (dashboard → service → Shell)

These commands read files and settings only; none of them writes anything.

```bash
echo "commit=$RENDER_GIT_COMMIT branch=$RENDER_GIT_BRANCH"
```
```bash
df -h /data /tmp
```
```bash
du -sh /data/* 2>/dev/null
```
```bash
ls -la /data /data/backups 2>/dev/null
```
```bash
node -e 'for (const k of ["THRIV3_EDGE_URL","THRIV3_SYNC_SECRET","THRIV3_PUBLIC_BASE_URL","CLOUDFLARE_API_TOKEN","CLOUDFLARE_ACCOUNT_ID","THRIV3_MAILBOX_KEY","THRIV3_SESSION_SECRET","THRIV3_SENDER_IDENTITY","THRIV3_POSTAL_ADDRESS","THRIV3_FROM_ADDRESS","ANTHROPIC_API_KEY","THRIV3_GOOGLE_CLIENT_ID","THRIV3_GOOGLE_CLIENT_SECRET"]) console.log(k.padEnd(28), process.env[k] ? "set" : "MISSING")'
```
```bash
node -e 'for (const k of ["NODE_ENV","THRIV3_SYNC_INTERVAL_MINUTES","STRICT_CORROB_SCOPE","THRIV3_ALLOW_LEGACY_COACHES","THRIV3_USE_RECONCILED_COACHES","THRIV3_COACH_WINDOW_DAYS","THRIV3_COACH_MAX_SENDS","RECRUITMATCH_DB","THRIV3_REPORT_STORE","THRIV3_UPLOAD_DIR","THRIV3_BUILD_DIR","THRIV3_APP_ORIGIN","THRIV3_TRACK_ENDPOINT"]) console.log(k.padEnd(32), process.env[k] ?? "(unset)")'
```

The second `node -e` prints **values**. Every name in it is a non-secret setting or path; none of them is a credential. `STRICT_CORROB_SCOPE` and `THRIV3_ALLOW_LEGACY_COACHES` change which coaches are eligible, so their values are needed.

### 1c. What to record (the inspection report)

| Item | Expected (from `render.yaml` and the audit) | Why it matters |
|---|---|---|
| Deployed commit (deploy history + `RENDER_GIT_COMMIT`) | `387b916758425d3f2a926c454fe1fee8d0ee7898` (§1d) | the baseline for the rehearsal and for rollback |
| `autoDeploy` | `no` (confirmed by hand 2026-10-09) | a push to main must not deploy |
| Blueprint `autoSync` | to be recorded | `render.yaml` sets no `autoDeploy`, so a Blueprint sync could restore the platform default |
| `branch` | `main` | |
| build / start / health | as in `render.yaml` | |
| Disk size, `/data` usage, `/tmp` free | 5 GB | the migration rebuild and the backup each need free space ≥ the database size |
| `THRIV3_EDGE_URL`, `THRIV3_SYNC_SECRET` | both set (confirmed by hand 2026-10-09) | in production every manual draft needs the edge (audit B3) |
| `THRIV3_MAILBOX_KEY`, `THRIV3_SESSION_SECRET` | set | boot gate |
| `STRICT_CORROB_SCOPE`, `THRIV3_ALLOW_LEGACY_COACHES` | recorded values | inputs to §4 |
| Same key declared on the service **and** in the group | none | an empty service-level entry overrides the group (the `THRIV3_SYNC_SECRET` incident) |

**Stop condition.** Stop and report before anything else if:
- the deployed commit is not exactly `387b916758425d3f2a926c454fe1fee8d0ee7898` (§1d);
- Auto-Deploy is on;
- `THRIV3_EDGE_URL` or `THRIV3_SYNC_SECRET` is missing.

### 1d. The deployed SHA, recorded exactly

You confirmed by hand on 2026-10-09: production is on PR #63, Auto-Deploy is disabled, `THRIV3_EDGE_URL` and `THRIV3_SYNC_SECRET` are present, and disk space is sufficient. "PR #63" names two commits, so the record pins the right one:

| | Full SHA | Tree |
|---|---|---|
| PR #63 **merge commit** on `main` (what Render builds from `branch: main`) | `387b916758425d3f2a926c454fe1fee8d0ee7898` | `7f276c522584e3d2e3c905899270b5b600ac6339` |
| PR #63 branch head (`feat/sidearm-staff-2`; **not** what Render deploys) | `b4cdf2ce53b9561c8ecb332318c4b79876d111e8` | — |

Merged 2026-10-08T01:49:57Z. Production's last start was about 01:52Z (from `/healthz` uptime).

**The record must hold all four of these, each from its own source, and they must agree:**
1. the Render deploy ID and its `commit.id` from deploy history (§1a), as a full 40-character SHA;
2. `RENDER_GIT_COMMIT` from the Render Shell (§1b);
3. `git cat-file -t <sha>` = `commit` and `git merge-base --is-ancestor <sha> origin/main` = true, run locally;
4. `git rev-parse <sha>^{tree}` = the tree above.

That SHA, and nothing shorter or looser, is then used for:
- the rehearsal's "old" export (§3);
- the rollback target ("redeploy deploy `<id>`", §3 RB1);
- the readiness record.

If items 1 and 2 disagree, or either one differs from `387b916758425d3f2a926c454fe1fee8d0ee7898`, stop: production runs something other than what was confirmed.

---


---

## 2. Production backup: one consistent moment

**Taken immediately before the rehearsal, and again immediately before any deploy.**

### 2a. What has to be consistent

Production keeps four things on `/data`, and rows in the database point into the other three:

| Store | Pointed at by | Written by |
|---|---|---|
| `recruitmatch.sqlite` (+ `-wal`) | — | every operator action and the background writers below |
| `reports/` | `generated_reports.artifact_path` | report generation (writes the file, then the row) |
| `uploads/` | `players.recommendations` (a path) | the previous engine's analysis save |
| `profiles/` | `players.public_slug` / `published_at` | publishing. A publish **rebuilds the athlete's directory and deletes the superseded one** (`sitePublisher.js`). |

`npm run backup` copies the database first (online backup API), then `reports/` and `uploads/`. It does **not** take `profiles/`, and its manifest leaves out the safety tables. Both are handled below, and a later PR should fix them in the tool.

### 2b. Every writer, and how each is stopped

| Writer | How it writes | Stopped by | Proved stopped by |
|---|---|---|---|
| The operator | any request; **every authenticated request also updates `operator_sessions.last_seen_at`** | the freeze: every app tab closed, nobody signed in | quiet window (2d) |
| Edge sync scheduler (`syncScheduler.js`) | pulls events, opt-outs and tokens into the database | `THRIV3_SYNC_INTERVAL_MINUTES=0` (set in `render.yaml`) | §1b shows `0`; nobody presses "Sync now" (freeze) |
| Engagement rollup (`engagementRollup.js`, a debounced timer) | rebuilds `engagement_rollup` after events arrive | no events arrive while the sync is off and the freeze holds | quiet window |
| Report generation, publishing, matching runs, opt-outs, confirmations | operator actions | the freeze | quiet window |
| Other Render jobs | none declared (`render.yaml` has one web service, no cron) | — | §1a lists the services |
| The Cloudflare edge | holds tokens, events and edge opt-outs **outside** this backup, and never writes into it except through the sync | — | recorded: events at the edge after `events_pulled_at` are not in the backup and arrive on the next sync |

Health checks (`/healthz`) only read (`SELECT 1`).

### 2c. On Render (Shell)

1. **Freeze.**
   - The operator closes every app tab and signs out.
   - Nobody uses the app until 2e is finished.
   - Record the freeze start time.
2. **Check free space:** `df -h /tmp /data`. Work in `/tmp` if it holds at least 3× `/data`, because two backups are taken. Otherwise use `/data/backups`, and remove it after 2e (with approval).
3. **Snapshot the file trees before.** This records each file's path, size, modified time and SHA-256, for every file:
   ```bash
   mkdir -p /tmp/thriv3-backups
   ```
   ```bash
   cd /data && find reports uploads profiles -type f -exec sha256sum {} + | sort -k2 > /tmp/thriv3-backups/files-before.txt
   ```
   ```bash
   find reports uploads profiles -type f -printf '%p %s %T@\n' | sort > /tmp/thriv3-backups/stat-before.txt
   ```
4. **Backup A:**
   ```bash
   cd /opt/render/project/src && npm run backup -- /tmp/thriv3-backups
   ```
   Then run `npm run backup -- --verify /tmp/thriv3-backups/<A>`.
5. **Backup B,** at least 2 minutes after A: the same two commands.
6. **Snapshot the file trees after:** step 3 again into `files-after.txt` and `stat-after.txt`.
7. **Add the profiles to backup B:**
   ```bash
   tar -C /data -czf /tmp/thriv3-backups/<B>/profiles.tgz profiles
   ```
   Then `cp files-before.txt files-after.txt` into `<B>`.

### 2d. The quiet-window proof (positive, not assumed)

The backup is accepted only if **all** of these hold. Otherwise discard both, find the writer, and repeat from 2c.1.

1. **Files didn't move:** `files-before.txt` = `files-after.txt` and `stat-before.txt` = `stat-after.txt`, byte for byte.
2. **The database didn't move.** Backups A and B have identical **content fingerprints**. The file hash may differ for page-layout reasons, so it is the content that is compared. The fingerprint is the row count and a SHA-256 over every row (ordered by `rowid`) of every table, including `operator_sessions`, `suppressions`, `outreach`, `outreach_send`, `outreach_send_event`, `engagement_rollup`, `generated_reports`, `players` and `athlete_programmes`. A short read-only script (its own reviewed PR) prints it on each **copy**.
3. **Each store agrees with the database** (on backup B):
   - `npm run backup -- --verify` passes: every `generated_reports` artefact and every `players.recommendations` upload is present.
   - **And** every player with `published_at` set has its profile directory in `profiles.tgz`, and no profile directory lacks a published player. The same script reports both lists.
4. **Integrity:** `PRAGMA integrity_check` = `ok` and `PRAGMA foreign_key_check` is empty on backup B.

Because the database is copied **before** the files, and the window is proven quiet, every row's file is in the copy. A file without a row would be harmless; a row without a file is a failure of check 3.

### 2e. Supplementary counts, checksums, packing

On backup B, read-only, on the **copy**:
```bash
node -e 'const D=require("better-sqlite3");const db=new D(process.argv[1],{readonly:true,fileMustExist:true});for(const t of ["players","representatives","coaches","outreach","outreach_send","outreach_send_event","engagement_rollup","suppressions","athlete_programmes","matchmaking_runs","matchmaking_selections","programme_contacts","colleges","athletics_entities","athletics_domains","coach_seasons","generated_reports","operator_users","operator_sessions"]){let n;try{n=db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}catch{n="absent"}console.log(t.padEnd(26),n)}' /tmp/thriv3-backups/<B>/database.sqlite | tee /tmp/thriv3-backups/<B>/supplementary-counts.txt
```
```bash
cd /tmp/thriv3-backups && find <B> -type f -exec sha256sum {} + > <B>.SHA256SUMS && tar -czf <B>.tgz <B> <B>.SHA256SUMS && sha256sum <B>.tgz
```
Record the archive hash, the freeze start and end, and the 2d results. **End the freeze.**

### 2f. Off Render

1. **Download** the archive over Render SSH/SCP. This needs your SSH public key in Render → Account → SSH keys; confirm SCP support against Render's current documentation first.
   ```bash
   scp -s <service-ssh-address>:/tmp/thriv3-backups/<B>.tgz ~/thriv3-backups/
   ```
2. **Check the archive arrived intact:** `shasum -a 256` must equal the hash from 2e.
3. **Extract outside the repo** into an empty directory, then run:
   ```bash
   shasum -a 256 -c <B>.SHA256SUMS
   ```
   ```bash
   npm run backup -- --verify <extracted B>
   ```
4. **Restore test into a fresh empty directory.** Every count must equal the manifest and `supplementary-counts.txt`; also extract `profiles.tgz`.
   ```bash
   npm run backup -- --restore <extracted B> --into <empty dir>
   ```
5. **Store it.** The archive contains athletes, coach addresses and operator password hashes, so it is sensitive:
   - Keep two encrypted copies: the external drive (the Seagate) and a second encrypted location.
   - Permissions `600`.
   - Never in git or the repo tree.
   - Retention: pre-deploy backups for 30 days, then one a month (`docs/hosting.md`).
6. **Mailbox key.** `THRIV3_MAILBOX_KEY` stays in the password manager, never beside the backup.
7. **Render's daily disk snapshot** is the floor underneath this: note the latest snapshot's date. It does not replace this backup.
8. **Clean up on Render** (with approval): remove `/tmp/thriv3-backups`, or `/data/backups` if that was used.

---

## 3. Isolated migration rehearsal and rollback test

**On your Mac, against copies of the §2 backup. Never on Render.**

### 3a. Positive isolation: proved, not assumed

Empty credentials are not enough. A default or a cached value could still reach a real service. So the rehearsal runs in an environment that **cannot** reach anything, and that is tested before every run.

**The container.** Docker (or OrbStack) with **no network at all**:
- `docker run --network none`, a Linux image pinned to the repo's Node version (24.18.0);
- the two `git archive` exports and their `node_modules` built inside the image (Linux `better-sqlite3`);
- the data copies mounted at `/r`.

All checks run **inside** the container through `docker exec` against `127.0.0.1`. No port is published to the Mac.

Fallback if Docker is unavailable: `sandbox-exec` with a profile that denies all `network-outbound` except `localhost`, and denies `process-exec` of `/usr/bin/osascript`. The same proofs below are required.

**Service-by-service, what stops it and the proof that it is stopped:**

| External service or job | Stopped by (structural) | Also blanked | Proof, run inside the isolation before each run |
|---|---|---|---|
| Any internet host (Render, Cloudflare, Anthropic, Google, SMTP) | `--network none` | — | `getent hosts api.render.com` fails; `node -e "fetch('https://example.com').then(()=>process.exit(1),()=>process.exit(0))"` exits 0; `nc -z -w2 1.1.1.1 443` fails |
| Outlook compose / send (`outlook.js`, AppleScript) | Linux container: no `osascript`, so `isOutlookAvailable()` is false | — | `node -e` importing `server/lib/outlook.js` prints `isOutlookAvailable() === false` |
| Edge sync scheduler and token activation | no network | `THRIV3_SYNC_INTERVAL_MINUTES=0`, `THRIV3_EDGE_URL=`, `THRIV3_SYNC_SECRET=` | boot log says the edge sync is off; `isEdgeConfigured()` is false |
| Cloudflare Pages publishing (`wrangler`) | no network; `wrangler` not installed in the image | `CLOUDFLARE_API_TOKEN=`, `CLOUDFLARE_ACCOUNT_ID=`, `THRIV3_PUBLIC_BASE_URL=` | `command -v wrangler` is empty; Go Live is never pressed |
| Anthropic API | no network | `ANTHROPIC_API_KEY=` | — |
| Google mailbox OAuth / Gmail send | no network; production's mailbox key is **not** used, so stored tokens cannot be decrypted | `THRIV3_GOOGLE_CLIENT_ID=`, `THRIV3_GOOGLE_CLIENT_SECRET=`, a fresh local `THRIV3_MAILBOX_KEY` | count of connected-mailbox rows recorded; the campaign transport returns null (deferred, unchanged) |
| Any timer or job in the process | the only timers are the sync scheduler (off) and the rollup debounce (local) | — | §2b inventory; the boot log is reviewed |
| The Mac's own state | the container sees only `/r` and the exports | — | `ls /` inside shows no home directory; nothing mounted read-write except `/r/work` |

After each run, the server log is searched for `fetch`, `ECONN`, `ENOTFOUND`, `osascript`, `wrangler` and `edge`. Any attempted egress is recorded, and blocked by construction.

**Environment** (inside the container):
```bash
export NODE_ENV=production API_HOST=127.0.0.1 THRIV3_TRUST_PROXY=1 THRIV3_APP_ORIGIN=http://127.0.0.1:4400 PORT=4400
```
```bash
export RECRUITMATCH_DB=/r/work/recruitmatch.sqlite THRIV3_REPORT_STORE=/r/work/reports THRIV3_UPLOAD_DIR=/r/work/uploads THRIV3_BUILD_DIR=/r/work/profiles
```
```bash
export THRIV3_SYNC_INTERVAL_MINUTES=0 THRIV3_EDGE_URL= THRIV3_SYNC_SECRET= THRIV3_PUBLIC_BASE_URL= CLOUDFLARE_API_TOKEN= CLOUDFLARE_ACCOUNT_ID= ANTHROPIC_API_KEY= THRIV3_GOOGLE_CLIENT_ID= THRIV3_GOOGLE_CLIENT_SECRET=
```
```bash
export THRIV3_SESSION_SECRET=<fresh local random> THRIV3_MAILBOX_KEY=<fresh local 32-byte base64>
```
`STRICT_CORROB_SCOPE` and `THRIV3_ALLOW_LEGACY_COACHES` take **production's values** from §1b.

**Data handling.** The extracted backup is read-only (`chmod -R a-w`), and every run starts from a fresh copy into `/r/work`. The copies contain real personal data, so they live on an encrypted volume and are deleted when the rehearsal report is accepted.

### 3b. Code under test

`git archive` exports, never a working tree; this is the measure-from-a-pristine-export rule:
- `old` = `387b916758425d3f2a926c454fe1fee8d0ee7898`;
- `new` = main's full SHA at rehearsal time.

Each export's tree hash is recorded.

### 3c. Runs

| Run | On | What | Pass condition |
|---|---|---|---|
| R0 | pristine copy, read-only | **Baseline.** `integrity_check`, `foreign_key_check`, schema fingerprint (sha256 of `sqlite_master` ordered by type and name), table list against main's `schema.sql`, all §2e counts. The §2d content fingerprint, per table, including the 5 outreach tables (`outreach`, `outreach_send`, `programme_contact_attempts`, `programme_messages`, `campaign_first_touch_approvals`). File size and free pages. | recorded |
| R1 | copy A | **Old code on its own data.** Boot `old`; `/healthz`; stop. Re-measure. | boots; startup writes recorded (expected: the +28 `corpus_revision` artefact) |
| R2 | copy B | **The migration alone, timed.** In `new`, import `server/db/client.js`, which runs every migration, then exit. | no exception; wall time recorded |
| R3 | copy B | **What the migration did.** The 5 outreach tables were rebuilt with the same counts and content fingerprints as R0. `programme_contact_id` is NULL everywhere. `integrity_check ok`. `foreign_key_check` is unchanged from R0. The schema is equivalent to a fresh main database. New objects are only `representatives`, `programme_contacts`, `legacy_contact_reconciliation`, the `trg_recipient_*` triggers and partial indexes. Every other table's fingerprint equals R0 **except** those the migration is documented to touch (the `corpus_revision` artefact), each listed and explained. **`suppressions` is byte-identical.** | all hold |
| R4 | copy B | **Main boots and reads production's data.** Boot `new`; `/healthz` ok. Create a rehearsal operator on the copy (`rehearsal-operator@rehearsal.example.test`); sign in through `curl` inside the container. Read-only GETs: players list, each existing athlete's workspace payloads, engagement, selections overview, `/programmes` and one programme, the opt-out list, publish status. **Nothing is published, and no existing athlete is edited, re-matched or written to.** | no errors; counts agree with R0 |
| R5 | copy B | **Restart is idempotent.** Stop and boot again. | no table rebuilt; schema fingerprint unchanged; `corpus_revision` unchanged |
| R6 | copy B | **The new code's writes, on synthetic records only (§3d).** As the rehearsal operator, through the HTTP API: create the synthetic athlete, run Matcher V2 for it, record a selection, open the manual composer for the synthetic programme, prepare a draft to the synthetic coach. Expected: refused with `link-not-activated` / `EDGE_NOT_CONFIGURED`, no `sent_at`, nothing outbound. Then mark responded and record an opt-out on the synthetic relationship. | each expected outcome; §3d no-collateral check passes |
| R7 | copy B | **Eligibility measurements** (§4), on the copy **before** R6's synthetic rows, or with them excluded by their marker. | recorded |
| RB1 | copy C = copy of B after R5 | **Code rollback.** Boot `old` on the migrated copy; `/healthz`. Then drive the **old code's** write paths against the rebuilt tables and new triggers, on synthetic records only (§3d), using `old`'s own domain functions in a script run from the `old` export: create outreach, record a draft, mark drafted, confirm sent, a follow-up draft (sequence 2), discard, mark responded, clear responded, opt out. Also run the old server's own HTTP routes for the same actions where they exist. | the old code boots, and **every** one of those writes succeeds, or the exact refusal is recorded. Any refusal by a `trg_recipient_*` trigger or the new CHECK means code-only rollback is unsafe, and rollback = data restore (RB2). §3d no-collateral check passes. |
| RB2 | fresh directory | **Data rollback.** `npm run backup -- --restore <B> --into <empty>`, extract `profiles.tgz`, boot `old`. | counts and fingerprints equal R0; sha256 of `database.sqlite` equals the manifest |
| RB3 | copy C after RB1 | **Roll forward again.** Boot `new`. | no rebuild (already migrated); R3 checks still hold; RB1's synthetic rows read correctly in the new UI payloads |

### 3d. Synthetic records: write tests without contacting anyone

Every write test (R6, RB1, RB3) uses only records created for it, on a rehearsal copy. Real athletes, coaches, programmes, outreach, opt-outs and reports are **only read**.

**One marker, used everywhere,** so the records can be found, excluded and proved separate:

| Record | Values |
|---|---|
| Programme | `colleges` row `id = 'RB-SYN-COLLEGE'`, `name = 'Rehearsal Synthetic College'`, `sport = 'mens-soccer'`, active. Its own athletics entity `RB-SYN-ENTITY` and verified domain `rehearsal.example.test`. |
| Coaches | `RB-SYN-COACH-1`, `RB-SYN-COACH-2`, named `Rehearsal Synthetic Coach 1/2`, addresses `coach1@rehearsal.example.test` and `coach2@rehearsal.example.test`, filed at the synthetic programme |
| Athlete | `full_name = 'Rehearsal Synthetic Athlete'`, `email = 'athlete@rehearsal.example.test'`, a `public_slug` of the form `rbsyn` + letters/digits (e.g. `rbsyn01`; slugs are alphanumeric only, so the hyphenated id prefix cannot be used); never published |
| Operator | `rehearsal-operator@rehearsal.example.test` |

- **Why `.example.test`:** `.test` is reserved (RFC 2606/6761). It cannot be delivered to or resolved. Combined with `--network none`, a mistaken send has nowhere to go. The repo's PII scan already treats `example.test` as approved.
- **Eligibility is not bent to make the test pass.** If the synthetic coaches need to clear the canonical rule to reach the code under test, they are given **real rows of evidence on the copy** (a verified domain, a current season), exactly as `server/testCanonicalCoaches.js` does in tests. Production's values of `STRICT_CORROB_SCOPE` and `THRIV3_ALLOW_LEGACY_COACHES` stay in force. If a path still refuses them, that refusal is the recorded result.

**The no-collateral check.** Before and after each write run, on the rehearsal copy:
```bash
node server/scripts/dbFingerprint.js <copy> --exclude-synthetic --ignore corpus_revision --out <before|after>.json
```
```bash
node server/scripts/dbFingerprint.js --compare before.json after.json
```
- **Excluded:** rows whose id, name, address or slug carries the marker, plus every row that references them, through declared foreign keys and the listed undeclared references, transitively.
- **Every other row of every table must be identical.** A difference fails the run, even if the run itself succeeded.
- **`corpus_revision` is the one table ignored by name.** It is a single counter row that triggers bump on any corpus write, so no row exclusion can attribute it. It gets its own check: still exactly one row, and the revision only went up.
- **Coverage is proven by a test.** `server/lib/rehearsalSyntheticCoverage.test.js` performs the rehearsal's synthetic writes through the real functions:
  - the programme, entity, domain and corroborated coaches;
  - the operator and a session;
  - the athlete and a Matcher V2 run with its per-programme results, which reference real colleges;
  - a selection and the athlete–programme relationship;
  - two manual drafts, a confirmation, a discard and a follow-up;
  - a reply event, responded set, cleared and set again, and an opt-out.

  It requires every other table to be identical, and requires the exclusion to have removed rows from each of the 17 tables those writes touch.

**Afterwards.** The copies are deleted. No synthetic row, or file containing one, is ever uploaded, synced or restored anywhere.

### 3e. Deliverables and exit criteria

- **The rehearsal report:** each run's output, timings, fingerprints, the isolation proofs (3a), the no-collateral results (3d), and the full SHAs and tree hashes of both exports.
- **Downtime estimate:** R2's wall time is the minimum, because Render stops the old instance before starting the new one when a disk is attached.
- **GO evidence:** R2–R6, RB2 and RB3 pass. RB1's result is known and the rollback method is chosen from it. The §4 criteria are met.
- **Any failure is a stop.** The fix goes through a PR, and the rehearsal repeats from R0 on a fresh copy.

---

## 4. Coach eligibility: production data against the canonical engine

**Why.** Main's send rule (#64) requires every coach to pass two checks:
- the **row check**: a usable address, `email_status = 'verified'`, and not `PROVEN_STALE`;
- the **canonical decision**: `reconcileCoachRows` must mark the coach eligible at their filed programme, and the coach must not be in `server/data/seeds/coach_activation_holds.json`.

At `387b916` only the row check applied.

The canonical engine reads `coaches`, `coach_seasons`, `coach_email_absence_observations`, `athletics_domains`, `athletics_entities`, `institution_aliases`, `colleges` and `programme_row_links`, plus the repo file `docs/validation/generated/duplicate_unitid_canonical_map.json`. All the integrity work since early October went into the development database only. So production's answer is unknown.

**Where.** On the migrated rehearsal copy (R7), inside the §3a isolation, with main's code from the `new` export, using production's `STRICT_CORROB_SCOPE` value, and **before** R6's synthetic writes. The same script runs on a copy of the development reference database (corpus `d5371546`: 4,288 eligible) for comparison.
```bash
node server/scripts/measureCoachEligibility.js <migrated copy> --scope <STRICT_CORROB_SCOPE> --out production.json
```
```bash
node server/scripts/measureCoachEligibility.js --gate production.json development.json
```
- **Existing rules only.** It calls the existing rule functions unchanged: `coachRowIneligibility`, `coachIneligibility`, `canonicalDecisions`, the activation holds, `programmeCoaches` and `isSuppressed`.
- **Read-only by construction.** The offer and opt-out functions are bound to the app's own database connection, so the app's connection is opened on the copy in the client's **read-only mode** (`RECRUITMATCH_DB_READONLY=1`): `SQLITE_OPEN_READONLY` plus `query_only`, with no `schema.sql` and no `migrate()`. Nothing in the process can write to the copy.
- **Independent check.** The copy's content is fingerprinted before opening, after opening and after measuring, and its file bytes are hashed. Any change voids the result.

| ID | Measurement | Reported as |
|---|---|---|
| E1 | Coaches in total, and by division × sport | count |
| E2 | Row-check result: eligible / `NO_USABLE_EMAIL` / `COACH_PROVEN_STALE` / `EMAIL_NOT_VERIFIED:<status>` | histogram (= what `387b916` allows) |
| E3 | Of the row-eligible coaches, the canonical result: eligible / `COACH_NO_CANONICAL_DECISION` / `COACH_NOT_CANONICALLY_ELIGIBLE` (with the reconciler's reason) / reassigned to another programme / `ACTIVATION_HELD:<hold>` | histogram |
| E4 | Final eligible under main, by division × sport, and **programmes with ≥1 eligible coach** (pilot priority: NCAA D1–D3 men's and women's) | counts and % of active programmes |
| E5 | **Loss: row-eligible under `387b916` but not under main**, by reason | count + list (coach id, programme, reason; no addresses in the report) |
| E6 | Production vs development, per coach (key: coach id, falling back to lower(email)+programme): eligible in both / production only / development only / absent from one | counts + list |
| E7 | **Existing relationships affected:** production outreach whose coach is now ineligible. Split into confirmed sends (follow-ups blocked), pending manual drafts (confirm still allowed? recorded), and campaign-linked (deferred) | counts per athlete |
| E8 | **Opt-outs kept:** every `suppressions` address is still excluded from every offer, and none is eligible at send time | must be 0 violations |
| E9 | Activation holds that match production coaches | count |
| E10 | Programme inbox fallback: `programme_contacts` rows in production (expected 0 → no fallback) | count |
| E11 | Reference freshness: newest `coach_seasons` / `athletics_domains.checked_at` / `colleges.updated_date` in production against development | dates |

**The criteria (set 2026-10-09, preliminary):**

1. **Coverage, per sport × division.** For each of the six pilot cells (NCAA D1, D2 and D3 × men's and women's soccer), production's share of active programmes with ≥1 eligible coach under main (E4) must be **≥ 90% of development's share for that same cell**.
   - Each cell is judged on its own. A strong cell does not make up for a weak one.
   - Development's figures come from the development reference database at a recorded corpus revision.
   - The non-pilot divisions (NAIA, NJCAA, USCAA) are measured and reported the same way, but are not part of this preliminary gate.
2. **Opt-out safety: zero violations (E8).** No suppressed address appears in any offer or passes the send-time check, under either code version. **One violation is a blocker** whatever the coverage.
3. **Every lost eligible coach is explained (E5).** Each coach eligible under `387b916`'s row check but not under main gets:
   - its canonical reason;
   - for `NOT_CANONICALLY_ELIGIBLE` and reassignments, the reconciler's own reason;
   - for holds, the hold entry.

   "Unexplained" is not an allowed category. A coach the measurement cannot explain is an open finding, and the gate is not met until it is closed.
4. **Canonical safety rules are not relaxed to meet the target.** None of the following is changed to raise E4:
   - the row check;
   - the canonical decision;
   - the activation holds;
   - `STRICT_CORROB_SCOPE`;
   - `THRIV3_ALLOW_LEGACY_COACHES`.

   If a cell falls short, the remedy is **better reference data in production**, brought up to the development baseline through the integrity promotion path. It is never a looser rule, and never a copy of the development database over production (which would lose production's athletes, outreach history and opt-outs). That remedy would be its own audited workstream.

**What it decides:**
- All four criteria met: §4 supports GO, alongside §3's exit criteria.
- Criterion 1 missed in any cell: NO-GO for deployment until the reference-data workstream closes the gap, measured again by this same procedure.
- Criterion 2 or 3 missed: NO-GO, whatever the coverage.
