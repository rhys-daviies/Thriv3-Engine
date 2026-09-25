# L8B — main / Evidence branch reconciliation

**Result: DECISION REQUIRED — stop condition 9. The merge is tractable except
for one thing, and that one thing is not a conflict to resolve. `main` has
independently rebuilt the manifest, neither version is a superset of the other,
and choosing either silently regresses the other's coverage.**

No merge was committed. A trial merge ran in a disposable worktree, was
analysed, aborted, and removed. No product data moved.

---

## Topology — and a correction to the brief

The brief locked "main +167, Evidence +57". That was measured against the local
`main` ref, which is **stale**.

| | |
| --- | --- |
| Evidence HEAD | `268614d` (`engagement-tracking`) |
| local `main` | `dba5658` — **42 commits behind**, clean ancestor |
| **`origin/main`** | **`9a18d78`**, updated **2026-09-23 12:02** |
| merge base | `c5c21d0`, 2026-09-08 |
| real divergence | **origin/main +209, Evidence +58** |

`origin/main` moved *today*. A merge stage against a branch that is actively
advancing needs a pinned target; this analysis pins `9a18d78`.

---

## Collision map

Far smaller than feared:

| | files |
| --- | --- |
| main-only | 384 |
| Evidence-only | 222 |
| **changed on both** | **15** |
| **conflicting** | **10** (23 hunks) |

`server/db/migrate.js` auto-merged cleanly — the migration reconciliation the
brief flagged as high-risk is a non-event.

| file | hunks | risk | resolution |
| --- | --- | --- | --- |
| `.gitignore` | 1 | LOW | **resolved** |
| `package.json` | 1 | LOW | **resolved** — 55 scripts, 0 lost from either side |
| `server/db/client.js` | 1 | MEDIUM | **resolved** |
| `server/lib/philosophyQueries.js` | 2 | HIGH | **resolved** |
| `server/index.js` | 2 | CRITICAL | additive router union; tractable |
| `server/db/schema.sql` | 1 | CRITICAL | adjacent table definitions; union |
| `server/lib/evidenceBaseline.js` | 2 | **BLOCKING** | see below |
| `server/lib/evidenceBaseline.test.js` | 1 | HIGH | follows the manifest decision |
| `server/scripts/__baselines__/evidence.json` | 10 | HIGH | follows the manifest decision |
| `server/scripts/reports.test.js` | 2 | MEDIUM | follows the corpus decision |

### Resolved, and how

- **`client.js`** — kept **both**: Evidence's `export const dbPath = resolveDbPath()`
  (L7ZO corpus contract) *and* main's D3.2 guard refusing to open the default
  database from a bare `node -e`. Neither property is optional.
- **`philosophyQueries.js`** — kept **both**: main's `, division` on the
  sport-wide query (appended only there, deliberately) *and* Evidence's
  `AND ${TRUSTED}` predicate. The pool needs the column; an excluded
  programme-season must not reach any roster read.
- **`.gitignore`** — the seed re-inclusion wins, because the seeds are versioned
  evidence the tests read and a bare `server/data` line would exclude the
  directory and break it. main's dual-spelling symlink guard survives on
  `server/uploads`, where nothing is re-included. Documented in the file.
- **`package.json`** — union of the scripts object; verified programmatically
  that **zero scripts from either branch are missing**.

---

## The blocker: two manifests, convergent, neither a superset

`main` did not stand still on baseline governance. It reached **V3** by the same
road L7ZQ travelled, and independently named the same two blind spots:

> *"TWO TABLES WERE MISSING ENTIRELY. Instrumenting `buildBaselines` … shows the
> walk reads SEVEN tables. V2 fingerprinted five. `recruiting_arrivals` is
> queried once per pair (4,742 times) and `coach_seasons` 3,963 times, and
> neither was in the manifest."*

That is L7ZQ's finding, reached first, by instrumentation rather than by
mutation testing.

But the two designs differ in method, and each covers what the other does not:

| | **main V3** | **Evidence V6** |
| --- | --- | --- |
| method | **every column** of every table the walk reads, list derived by instrumenting `buildBaselines` | hand-picked semantic columns per component |
| tables | 7: players, colleges, roster_players, coaches, athletics_domains, **recruiting_arrivals**, **coach_seasons** | 11 components |
| has that the other lacks | every-column coverage | **`roster_season_trust`**, **`programme_status`**, `roster_freshness`, `roster_measurements` |
| stance on `built_at` | material — "move all six hashes" | **excluded** as operational |
| stance on `roster_row_id` | cited as inert, but included by the every-column rule | **excluded** — L7ZP measured 24,929 rows churning on re-import |

Main's argument against my method is strong and directly aimed at it:

> *"COLUMN MATERIALITY CANNOT BE PREDICTED BY NAME … Any hand-picked projection
> is a guess, and a guess that is wrong in the omitting direction is silent."*

Mine against main's is that V3 cannot see `roster_season_trust` — the table
whose `disposition` decides whether Evidence reads a programme-season **at
all** — nor `programme_status`, which decides eligible destinations. `main` has
neither table, so V3 could not have included them.

**Taking either version wholesale regresses the other.** That is stop
condition 9, and it is an architectural decision, not a conflict resolution:
whichever way it goes, the dataset digest changes and **both branches' baseline
pins are invalidated**, which makes every downstream acceptance number in this
stage dependent on it.

### Recommendation for the decision

**V7 = main's method applied to the union of both table lists.** Every column of
eleven tables: main's seven plus `roster_season_trust`, `programme_status`,
`roster_freshness` and `roster_measurements`.

It keeps what each side proved by measurement — main's "do not guess at
columns", Evidence's "these four tables change behaviour" — and discards
neither. The two deliberate exclusions I made in V6 (`roster_row_id`, `region`)
become unnecessary under the every-column rule *provided* the input is a pinned
snapshot as main's D3.2 established; against a live corpus they would reintroduce
the 24,929-row churn L7ZP measured. **That corpus question has to be settled with
the manifest question — they are the same decision.**

This is a stage of its own. It needs a deliberate repin with attribution under
Phase 11/22 discipline, and it cannot be done as a side effect of a merge.

---

## What is NOT blocked

Everything else about this reconciliation looks routine:

- **Auth**: no conflict at all. `operatorAuth.js`, `routes/auth.js`,
  `createOperator.js` and the operator tables are main-only files — they arrive
  untouched. **Auth semantics change: NO.**
- **`req.operator` integration**: unchanged from L8A — main attaches
  `{ id, email }`, Evidence's `operatorFromRequest` reads `.id`. Compatible.
- **Trust route**: Evidence-only file, arrives intact. After merge it sits below
  `requireOperator` by virtue of the global `/api` boundary. **No canonical
  disposition was written and none should be until L8C.**
- **Migrations**: auto-merged.
- **Campaign / mailbox / execution**: main-only files, 384 of them, untouched by
  Evidence.
- **Evidence architecture**: 222 Evidence-only files, untouched by main.

---

## Canonical immunity

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `2d694ab74f831491` | `2d694ab74f831491` |

Trust 15 / 2 RETAIN / 13 NULL / 0 EXCLUDE. Arrivals FRESH. Manifest V6
`cc28ee6accdb84ed`. P6 unchanged. The trial merge ran in a disposable worktree
against no database; the worktree and its branch are removed.

---

## Recommended sequence

1. **Decide the manifest.** V7-union as above, or an explicit choice of one
   side with the regression accepted and recorded. Settle the corpus question
   (live canonical vs pinned snapshot) in the same decision.
2. **L8B-2 — land the merge.** Six conflicts are resolved above; `index.js` and
   `schema.sql` are unions; the three baseline/pin files follow from step 1.
   Pin the target at a specific `origin/main` SHA, because it is moving.
3. **L8C** — mount and prove the trust write path end to end.
4. **L8D** — operator review UI, and only then the first real disposition.

Re-deriving the six baselines, the 4,742-pair behavioural diff and the NCAA
foundation counts all belong to step 2, after the manifest is settled — running
them now would produce numbers that the manifest decision immediately
invalidates.
