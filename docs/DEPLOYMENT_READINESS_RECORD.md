# Deployment readiness record

**Status: NO-GO.** Deployment stays NO-GO until all of these have passed:
- backup verification (§2);
- the isolated migration rehearsal (§3);
- the coach eligibility assessment (§4);
- the rollback tests (§3, RB1–RB3).

This record holds what has been **observed**. Procedures are in `docs/DEPLOYMENT_READINESS_PROCEDURES.md`.

It contains no secret values. Credentials are recorded as *set* or *missing* only.

| | |
|---|---|
| Target (main) | `9af90ec4d5b6e1e7891193a8e8d161ac4fca9255` |
| Production (PR #63 merge commit) | `387b916758425d3f2a926c454fe1fee8d0ee7898`, tree `7f276c522584e3d2e3c905899270b5b600ac6339` |
| Service | `thriv3-operator` (Render, Blueprint-managed, `branch: main`) |

---

## 1. Read-only inspection (2026-10-09)

### 1d. Deployed SHA: three of four checks done

| Check | Result | Source |
|---|---|---|
| Render deploy history `commit.id` | **open** (needs §1a API output) | — |
| `RENDER_GIT_COMMIT` | `387b916758425d3f2a926c454fe1fee8d0ee7898` ✅ | Render Shell, by the user |
| `git cat-file -t` = commit; ancestor of `origin/main` | ✅ | local |
| Tree = `7f276c52…` | ✅ | local |

The process has been up since **2026-10-08 ~01:52 UTC**, two minutes after PR #63 merged at 01:49:57Z, and has not restarted. Source: `/healthz` uptime (108,709 s at 2026-10-09 08:03:54Z).

### 1b. Render Shell (by the user)

| Item | Observed |
|---|---|
| Branch / working directory | `main` / `/opt/render/project/src` |
| `NODE_ENV` | `production` |
| `THRIV3_SYNC_INTERVAL_MINUTES` | `0` (scheduled edge sync off) |
| `RECRUITMATCH_DB` | `/data/recruitmatch.sqlite` |
| Report, upload and profile directories | all on `/data` |
| `THRIV3_EDGE_URL`, `THRIV3_SYNC_SECRET`, `THRIV3_MAILBOX_KEY`, `THRIV3_SESSION_SECRET` | set |
| `STRICT_CORROB_SCOPE`, `THRIV3_ALLOW_LEGACY_COACHES`, `THRIV3_USE_RECONCILED_COACHES` | **unset** |
| `THRIV3_FROM_ADDRESS`, `ANTHROPIC_API_KEY`, `THRIV3_GOOGLE_CLIENT_ID` / `_SECRET` | **missing** |
| `THRIV3_COACH_WINDOW_DAYS`, `THRIV3_COACH_MAX_SENDS` | not reported. If unset, the code defaults are 30 days and 3 sends. **To confirm.** |
| Tools | GNU `find`, `sha256sum`, `tar` and `node` available |
| `/tmp` free | 72 GB |
| `/data` free | 4.4 GB |
| Database | 224 MB, plus 4.8 MB in the WAL |
| `reports/` / `uploads/` / `profiles/` | 1.1 MB / 25 MB / 128 KB |
| `/data/backups` | 235 MB of **existing backups. Preserve: never read, written or removed by these procedures.** |
| `profiles.staging` / `profiles.superseded` | none (no interrupted publish) |

No configuration change is authorised or made.

### 1a. Render API: **open**

Still needed:
- the deploy history (`commit.id`, trigger, status);
- `autoDeploy`;
- Blueprint `autoSync`;
- the service and `THRIV3` group environment variable **names**, including the check that no key is declared both on the service and in the group;
- the disk record.

The user has stated that Auto-Deploy is disabled. The API record is still to be captured.

### What the missing settings mean (from the code)

- **`THRIV3_FROM_ADDRESS`:** used only by the macOS Outlook path (`OUTLOOK_FROM_ADDRESS`, default `rhys@striv3.com`). On Render `isOutlookAvailable()` is false, because the platform isn't darwin, so hosted manual outreach is a mailto handoff to the operator's own mail app. No effect on the hosted service.
- **`ANTHROPIC_API_KEY`:** read only by `server/lib/anthropic.js`, which is used by `routes/csvAgent.js` and `routes/evaluateSoccerProgram.js`. Those AI features refuse with a clear error when used. Not part of the manual outreach workflow; not a boot requirement.
- **Google OAuth (both missing):** the mailbox flow is off. Both-absent is an allowed configuration; only half a configuration refuses to boot. Campaign sending and OAuth are deferred.

---

## Effective eligibility defaults (for the §4 comparison)

Read from the code, with the settings above unset.

### Production today (`387b916`)
- **Rule:** the **row check only**, in `coachIneligibility(row)`, `server/lib/coachEligibility.js`. A coach passes if they have a usable address, are not `PROVEN_STALE`, and have `email_status = 'verified'`.
- **No canonical decision and no activation holds:** `canonicalCoachEligibility.js` does not exist at this commit.
- **`THRIV3_ALLOW_LEGACY_COACHES` unset:** `applyCoachFloor` applies the row check to what is offered.
- **`THRIV3_USE_RECONCILED_COACHES` unset:** staff come from the legacy `coaches` table, not `coaches_reconciled`.
- **Opt-outs:** checked at send time. At `387b916` the offered staff list did not yet withhold opted-out coaches; that came in Phase 5 PR A.

### Main after deployment (`9af90ec`), with the same settings unset
- **Row check:** the same, now `coachRowIneligibility`. Its body and the `usable()` address test are **identical** to `387b916`'s `coachIneligibility`; only the name differs. So §4's "row-eligible" (E2) is exactly production's current rule.
- **Plus the canonical decision:** `canonicalDecisions(handle, { scope = process.env.STRICT_CORROB_SCOPE || 'NAIA' })`. With `STRICT_CORROB_SCOPE` unset, **the effective scope is `NAIA`**: the reconciler's strict-corroboration path is active for NAIA only (`coachReconciler.js`: "default NAIA-only, so no NCAA behaviour can change").
- **Plus the activation holds** in `server/data/seeds/coach_activation_holds.json`, which ship with the code. An unreadable holds file holds every coach.
- **Offers:**
  - `THRIV3_ALLOW_LEGACY_COACHES` unset: the full floor applies to offers.
  - `THRIV3_USE_RECONCILED_COACHES` unset: legacy `coaches` through that floor.
  - Opted-out coaches are withheld and named.
- **Per-coach cap:** `THRIV3_COACH_WINDOW_DAYS` (default 30) and `THRIV3_COACH_MAX_SENDS` (default 3), if unset.

### What this fixes for §4
- **Production** is measured with `--scope NAIA`, the effective value, recorded explicitly. The tool refuses to guess.
- **Development** must be measured with the **same** `--scope NAIA`. The gate refuses results measured under different scopes.
- Both are measured with `THRIV3_ALLOW_LEGACY_COACHES` and `THRIV3_USE_RECONCILED_COACHES` unset, as in production.

---

## 2. Backup: **not started**

Approved location: `/tmp/thriv3-backups`. Backups A and B together are about 510 MB, against 72 GB free; nothing is written to `/data`.

- **WAL capture.** `npm run backup` opens the database read-only and copies it with SQLite's online backup API. That includes every committed transaction still only in the WAL, and the result is one file with no WAL beside it.
- **Proof on the code.** The deployed `backup.js` matches main's apart from one message string. `server/scripts/backup.test.js` passes 9/9 on main `9af90ec`, including:
  - "a plain file copy of a WAL database can be missing committed rows";
  - "holds every row that was committed, including the ones only in the log".

**Still open before §2 can run:**
- the §1a record (Auto-Deploy, Blueprint auto-sync, deploy history);
- an SSH transfer test (a non-data file);
- the operator freeze window;
- confirmation of the two encrypted storage locations;
- approval of the 14 steps.

## 3. Rehearsal: **not started**

## 4. Coach eligibility: **not started**

The defaults above are fixed for it.

## Rollback tests: **not started**
