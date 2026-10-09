# Deployment readiness procedures (draft for approval)

Drafted 2026-10-09 after the production-readiness audit, which was **NO-GO**. Nothing here has been run.

These procedures:
- inspect production without changing it;
- take and verify a backup;
- rehearse main's first boot on a **copy** of production's database;
- measure coach eligibility on that copy.

Each section needs its own approval before it runs. None of them deploys, migrates production, writes production data, changes Auto-Deploy, sends email or prints a secret value.

Target: main `43f01cd`. Production is believed to run `387b916`; §1 confirms or refutes this.

---

## 0. Ground rules for every step

- **Secrets never appear in output.** Environment variables are listed by **name** only. A secret's presence is reported as `set` / `MISSING`, never its value or length.
- **Render API keys are account-wide.** Render has no read-only key scope, so a key used here can also change production. Safer options, best first:
  1. You run the §1 commands and paste the output.
  2. Use a key created for this inspection and revoke it straight afterwards.
  3. Use dashboard screenshots.
- **Production's database file is never opened by these procedures.** Only `npm run backup`, which uses SQLite's online backup API and opens the *copy*, touches it. All measurement happens on that copy, off Render.
- **One operator at a time.** No outreach, confirmations or edits during the backup window. This is so the database, `reports/`, `uploads/` and `profiles/` are captured at one moment.

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
| Deployed commit (deploy history + `RENDER_GIT_COMMIT`) | `387b916` | the baseline for the rehearsal and for rollback |
| `autoDeploy` | `no` | a push to main must not deploy |
| Blueprint `autoSync` | to be recorded | `render.yaml` sets no `autoDeploy`, so a Blueprint sync could restore the platform default |
| `branch` | `main` | |
| build / start / health | as in `render.yaml` | |
| Disk size, `/data` usage, `/tmp` free | 5 GB | the migration rebuild and the backup each need free space ≥ the database size |
| `THRIV3_EDGE_URL`, `THRIV3_SYNC_SECRET` | both set | in production every manual draft needs the edge (audit B3) |
| `THRIV3_MAILBOX_KEY`, `THRIV3_SESSION_SECRET` | set | boot gate |
| `STRICT_CORROB_SCOPE`, `THRIV3_ALLOW_LEGACY_COACHES` | recorded values | inputs to §4 |
| Same key declared on the service **and** in the group | none | an empty service-level entry overrides the group (the `THRIV3_SYNC_SECRET` incident) |

**Stop condition.** If the deployed commit is not `387b916`, or Auto-Deploy is on, stop and report before anything else.

---

## 2. Production backup

**Taken immediately before the rehearsal, and again immediately before any deploy.**

### 2a. Gaps in the existing tool (handled manually below; a later PR should close them)

- `npm run backup` takes `database.sqlite`, `reports/` and `uploads/`. It does **not** take `/data/profiles`, the generated athlete pages (`THRIV3_BUILD_DIR`).
- Its manifest counts 8 tables. It leaves out the safety tables: `suppressions`, `coaches`, `outreach_send`, `engagement_rollup`, `athlete_programmes` and `matchmaking_selections`.

### 2b. On Render (Shell)

1. **Freeze.** Tell the operator no outreach or edits until step 2c is complete.
2. **Check free space** with `df -h /tmp /data`.
   - Use `/tmp` if it has at least 2× the size of `/data`, so nothing is written to the persistent disk.
   - Otherwise use `/data/backups`, and remove it after 2c (with approval).
3. **Take the backup:**
   ```bash
   cd /opt/render/project/src
   ```
   ```bash
   npm run backup -- /tmp/thriv3-backups
   ```
   Record the directory name it prints (`thriv3-…`) and the `integrity_check ok` line.
4. **Verify it:**
   ```bash
   npm run backup -- --verify /tmp/thriv3-backups/<dir>
   ```
5. **Add the generated pages:**
   ```bash
   tar -C /data -czf /tmp/thriv3-backups/<dir>/profiles.tgz profiles
   ```
6. **Record the supplementary counts** (read-only, on the **copy**):
   ```bash
   node -e 'const D=require("better-sqlite3");const db=new D(process.argv[1],{readonly:true,fileMustExist:true});for(const t of ["players","representatives","coaches","outreach","outreach_send","outreach_send_event","engagement_rollup","suppressions","athlete_programmes","matchmaking_runs","matchmaking_selections","programme_contacts","colleges","athletics_entities","athletics_domains","coach_seasons","generated_reports","operator_users"]){let n;try{n=db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}catch{n="absent"}console.log(t.padEnd(26),n)}' /tmp/thriv3-backups/<dir>/database.sqlite | tee /tmp/thriv3-backups/<dir>/supplementary-counts.txt
   ```
7. **Checksum and pack:**
   ```bash
   cd /tmp/thriv3-backups && find <dir> -type f -exec sha256sum {} + > <dir>.SHA256SUMS && tar -czf <dir>.tgz <dir> <dir>.SHA256SUMS && sha256sum <dir>.tgz
   ```
   Record the final hash.

### 2c. Off Render

1. **Download** the archive to your Mac over Render SSH/SCP. This needs your SSH public key added in Render → Account → SSH keys; confirm SCP support against Render's current documentation before relying on it.
   ```bash
   scp -s <service-ssh-address>:/tmp/thriv3-backups/<dir>.tgz ~/thriv3-backups/
   ```
2. **Check the archive arrived intact:** `shasum -a 256 ~/thriv3-backups/<dir>.tgz` must equal the hash from 2b.7.
3. **Verify locally, outside the repo.** Extract into a new empty directory, then run:
   ```bash
   cd <extracted dir> && shasum -a 256 -c ../<dir>.SHA256SUMS
   ```
   ```bash
   npm run backup -- --verify <extracted dir>
   ```
4. **Restore test into a fresh empty directory.** Every count must equal the manifest and `supplementary-counts.txt`.
   ```bash
   npm run backup -- --restore <extracted dir> --into <new empty dir>
   ```
5. **Store it.** The archive contains athletes, coach addresses and operator password hashes, so it is sensitive:
   - Keep two copies: the encrypted external drive (the Seagate) and a second encrypted location.
   - Permissions `600`.
   - Never in git or the repo tree.
   - Retention: pre-deploy backups for 30 days, then one a month (`docs/hosting.md`).
6. **Mailbox key.** `THRIV3_MAILBOX_KEY` belongs in the password manager, not beside the backup. Confirm it is recorded there; no mailboxes are connected now, but it is a boot requirement.
7. **Render's daily disk snapshot** is the floor underneath this. Confirm in the dashboard that one exists and note its date. It is not a substitute: a volume snapshot of a live SQLite file can miss its write-ahead log.
8. **Clean up on Render** (with approval): delete `/tmp/thriv3-backups`, or `/data/backups` if that was used.

---

## 3. Isolated migration rehearsal and rollback test

**On your Mac, against copies of the §2 backup. Never on Render.**

### 3a. Isolation

- **Inputs.** The verified backup is extracted to a scratch directory and set read-only (`chmod -R a-w`). Every run works on a fresh `cp` of `database.sqlite` (and the directories), made while no process has it open.
- **Code.** Run from `git archive` exports, never the working tree, with `node_modules` symlinked from the app checkout:
  - `rehearsal/old` = `387b916` (or whatever §1 found);
  - `rehearsal/new` = `43f01cd`.

  An uncommitted working tree would apply the wrong schema; that is the measure-from-a-pristine-export rule.
- **Environment for every run.** These keep anything from leaving the machine:
  ```bash
  export NODE_ENV=production API_HOST=127.0.0.1 THRIV3_TRUST_PROXY=1 THRIV3_APP_ORIGIN=http://127.0.0.1:4400 PORT=4400
  ```
  ```bash
  export RECRUITMATCH_DB=$R/db/recruitmatch.sqlite THRIV3_REPORT_STORE=$R/reports THRIV3_UPLOAD_DIR=$R/uploads THRIV3_BUILD_DIR=$R/profiles
  ```
  ```bash
  export THRIV3_SYNC_INTERVAL_MINUTES=0 THRIV3_EDGE_URL= THRIV3_SYNC_SECRET= THRIV3_PUBLIC_BASE_URL= CLOUDFLARE_API_TOKEN= CLOUDFLARE_ACCOUNT_ID= ANTHROPIC_API_KEY= THRIV3_GOOGLE_CLIENT_ID= THRIV3_GOOGLE_CLIENT_SECRET=
  ```
  ```bash
  export THRIV3_SESSION_SECRET=<a fresh local random value> THRIV3_MAILBOX_KEY=<a fresh local 32-byte base64 key>
  ```
  Never use production's key. `STRICT_CORROB_SCOPE` and `THRIV3_ALLOW_LEGACY_COACHES` take **production's values from §1**.
- **No outbound mail.** Outlook stays closed and no draft step is exercised except R6, which is expected to be **refused** because the edge is unconfigured. Preferably also run with networking off.

### 3b. Runs

| Run | On | What | Pass condition |
|---|---|---|---|
| R0 | pristine copy, read-only | Baseline. `integrity_check`, `foreign_key_check`, schema fingerprint (sha256 of `sqlite_master` ordered by type and name), table list against main's `schema.sql`, all §2 counts, per-table sha256 of the 5 outreach tables (`outreach`, `outreach_send`, `programme_contact_attempts`, `programme_messages`, `campaign_first_touch_approvals`), file size and free pages. | recorded |
| R1 | copy A | **Old code on its own data.** Boot `rehearsal/old`; `/healthz`; then stop. Re-measure. | boots; any startup writes recorded (expected: the +28 `corpus_revision` artefact) |
| R2 | copy B | **The migration alone, timed.** In `rehearsal/new`, import `server/db/client.js`, which runs every migration, then exit. Capture stdout/stderr and the wall time. | no exception |
| R3 | copy B | **What the migration did.** The 5 outreach tables were rebuilt with the same row counts and the same digests (the migration checks this itself; it is re-checked independently from R0). `programme_contact_id` is NULL everywhere. `integrity_check ok`. `foreign_key_check` is unchanged from R0. The schema is equivalent to a fresh main database. Only expected new objects: `representatives`, `programme_contacts`, `legacy_contact_reconciliation`, `trg_recipient_*` triggers, partial indexes. All §2 counts equal R0, **especially `suppressions`**. Record the file growth. | all hold |
| R4 | copy B | **Main boots and works.** Boot `rehearsal/new`; `/healthz` ok. Create a rehearsal operator **on the copy** (`npm run operator`) and sign in at `http://127.0.0.1:4400`. Check that these load with production's data: Players, an existing athlete's workspace (all tabs), Engagement counts against R0, "Selected for outreach", `/programmes` and one programme, the opt-out list, publish status (no publish). Run Matcher V2 for one existing athlete (a write on the copy). | no errors; counts consistent |
| R5 | copy B | **Restart is idempotent.** Stop and boot again. | no table rebuilt; schema fingerprint and `corpus_revision` unchanged |
| R6 | copy B | **Refusal path.** Open the manual composer for a programme with an eligible coach and prepare a draft. | refused with `EDGE_NOT_CONFIGURED` / `link-not-activated`; no `sent_at`; nothing outbound |
| R7 | copy B | **Eligibility measurements** (§4). | recorded |
| RB1 | copy C = copy of B after R4 | **Code rollback.** Boot `rehearsal/old` on the migrated copy. `/healthz`. Then exercise the old code's writes on the rebuilt tables, using a test athlete and a test coach created on the copy: draft record, confirm sent, discard, mark responded, opt-out. | the old code boots and none of its writes are refused by the new constraints or `trg_recipient_*` triggers. **If any write fails, code-only rollback is unsafe and rollback = data restore (RB2).** |
| RB2 | fresh directory | **Data rollback.** `npm run backup -- --restore <backup> --into <empty>`, then boot `rehearsal/old` on it. | counts equal R0; sha256 of `database.sqlite` equals the manifest |
| RB3 | copy C after RB1 | **Roll forward again.** Boot `rehearsal/new`. | no rebuild (already migrated); R3 checks still hold; RB1's test rows read correctly |

### 3c. Deliverables and exit criteria

- **Deliverables:** a rehearsal report with each run's output, timings and fingerprints. The R2 wall time is the minimum downtime: Render stops the old instance before starting the new one when a disk is attached.
- **GO evidence:** R2–R6 and RB2 pass, RB1's result is known, and the §4 numbers are accepted by you.
- **Any failure is a stop.** The fix goes through a PR and the rehearsal repeats from R0 on a fresh copy.

---

## 4. Coach eligibility: production data against the canonical engine

**Why.** Main's send rule (#64) requires every coach to pass two checks:
- the **row check**: a usable address, `email_status = 'verified'`, and not `PROVEN_STALE`;
- the **canonical decision**: `reconcileCoachRows` must mark the coach eligible at their filed programme, and the coach must not be in `server/data/seeds/coach_activation_holds.json`.

At `387b916` only the row check applied.

The canonical engine reads `coaches`, `coach_seasons`, `coach_email_absence_observations`, `athletics_domains`, `athletics_entities`, `institution_aliases`, `colleges` and `programme_row_links`, plus the repo file `docs/validation/generated/duplicate_unitid_canonical_map.json`. All the integrity work since early October went into the development database only. So production's answer is unknown.

**Where.** On the migrated rehearsal copy (R7), with main's code from the `rehearsal/new` export, using production's `STRICT_CORROB_SCOPE` value. The same script runs on the development reference database (corpus `d5371546`: 4,288 eligible) for comparison. A short read-only script calls the existing functions (`coachRowIneligibility`, `canonicalDecisions`, `canonicalIneligibility`, `activationHold`); it adds no new rule. That script will be its own reviewed PR.

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

**How the result decides the next step:**
- **E4 close to development and E5 small:** deploy with production's data as it is.
- **E4 materially lower** (e.g. pilot coverage drops): deployment needs a reference-data plan before GO. That means bringing production's reference tables (coaches, domains, entities, seasons) up to the development baseline, through the integrity promotion path. It must **not** copy the development database over production, which would lose production's athletes, outreach history and opt-outs. That plan would be its own audited workstream.
- **E8 > 0 is a blocker** whatever else holds.

The thresholds are for you to set. Proposed: pilot programmes with ≥1 eligible coach ≥ 90% of the development figure, and E5 explained reason by reason.
