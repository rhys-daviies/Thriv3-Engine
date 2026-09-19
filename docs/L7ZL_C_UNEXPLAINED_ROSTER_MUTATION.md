# L7ZL-C — the unexplained roster mutation, explained

L7ZL closed DECISION REQUIRED because 39,430 `roster_players` rows changed
during the stage and could not be attributed. This is the investigation that
attributes them.

**Result: ATTRIBUTED.** The writer was `server/scripts/projectRosterMinutes.js`,
run by **another Claude session working in the main checkout**
`/Users/rhysdavies/Documents/Recruitmatch/app` on branch
`fix/v1-baseline-repair`. It reached this stage's database because
`thriv3-l7g/server/data/recruitmatch.sqlite` is a **symlink** to that
checkout's database file. Nothing in L7ZL caused it, and nothing in the test
corpus could ever have reproduced it.

---

## The finding in one line

```
thriv3-l7g/server/data/recruitmatch.sqlite
  -> /Users/rhysdavies/Documents/Recruitmatch/app/server/data/recruitmatch.sqlite
```

`git worktree list` returns **21 worktrees**. The database is not isolated per
worktree, so it is not isolated per stage, per branch, or per session. Every
containment hash this roadmap has taken was a statement about a file that
several other branches were also using — which nothing in the toolchain said.

---

## Forensic chain

| time (NZST, 2026-09-19) | event | evidence |
| --- | --- | --- |
| 19:56:04 | L7ZL committed `a8d3291`; roster verified clean immediately before | commit timestamp |
| **20:17:05** | **live database written** | `recruitmatch.sqlite` mtime |
| 20:22:45 | main checkout commits `754a70c` *"Eligibility is a rule, and the rule depends on the association"*, rewriting **`projectRosterMinutes.js`** (115 lines) and adding its test (128 lines) | `git log` in `app` |
| 20:31:35 | main checkout commits `bdfb7ff` *"Give the bulk-outreach roster a class to be read from"* | `git log` in `app` |
| 20:51 | main checkout's `tools/roster_pipeline/` writes 8 Python pipeline artefacts | file mtimes |
| 21:01:07 | main checkout commits `480a915` *"Re-pin the baselines the corrected semantics moved"* | `git log` in `app` |

The database was written **five minutes before** the commit that rewrote the
only script capable of writing those columns. That session was actively
developing `projectRosterMinutes.js` and ran it against the working database —
an entirely ordinary thing for it to do.

---

## Mutation shape, reconstructed

Diffed live against `snapshot-pre-l7zj-2026-09-19T02-06-14Z`:

| | |
| --- | --- |
| rows changed | **39,430** — the incident count exactly |
| season | **2026, 100%** (of 62,257 season-2026 rows) |
| sport | mens-soccer 17,567 / womens-soccer 21,863 |
| division | D3 13,655 · D1 10,803 · D2 9,164 · NAIA 5,794 · USCAA 14 |
| programmes | 2,041 |
| players | 38,678 |

Column level — **every change is an addition; nothing was removed**:

| column | changed | NULL → value | value → NULL |
| --- | --- | --- | --- |
| `prior_programme` | 38,211 | 38,211 | 0 |
| `projected_minutes` | 31,019 | 31,019 | 0 |
| `projected_minutes_season` | 31,019 | 31,019 | 0 |

`projected_minutes_season` is **uniformly `'2025'`** — one projection run, one
source season.

---

## Value signature vs the writer

`projectRosterMinutes.js` lines 70–71:

```sql
UPDATE roster_players
   SET projected_minutes = NULL, projected_minutes_season = NULL, prior_programme = NULL
 WHERE season = ?
```

then repopulates all three from the source season. That is a **three-column,
single-season, whole-cohort** write. Every property of the observed mutation
follows from it: the exact column set, the 100%-season-2026 scope, the constant
`projected_minutes_season`, and the all-additions NULL pattern.

Classification: **EXACT_MATCH** on columns, scope, value semantics and NULL
pattern, with an independent timing and commit chain. No reproduction run was
needed, and none was attempted against the live database.

---

## Why no test ever reproduced it

Because no test can. The write requires a deliberate CLI invocation:

- `projectRosterMinutes.js` has a correct `import.meta.url === file://${process.argv[1]}`
  main guard, so importing it does nothing. **Not** the module-scope defect class
  found in earlier stages.
- `vitest.config.js` forces `RECRUITMATCH_DB=':memory:'` for every test file.
- `scripts.test.js` spawns scripts with `':memory:'` explicitly.
- In this checkout the only non-test writers of these columns are
  `projectRosterMinutes.js`, `alignRosterSchoolNames.js`, `applyUscaaDivision.js`
  and `refreshGraduationYears.js` — all CLI-guarded, none reachable from a test.

L7ZL ran each of these eliminations and they were all correct. The search was
sound; it was simply bounded to the wrong tree.

---

## WAL verdict

WAL is a **separate finding**, not the root writer.

- `journal_mode = wal`, `wal_autocheckpoint = 1000`.
- WAL explains only why the **first restore did not survive** a force-quit: the
  restore sat un-checkpointed in the write-ahead log and was lost.
- It cannot explain the mutation itself. `projected_minutes` values are
  *computed* by carrying 2025 minutes forward onto 2026 rows; that computation
  was never previously in this database's WAL, so there is no old committed
  state for a replay to resurrect.

Safe procedure, confirmed: a repair is not durable until
`wal_checkpoint(TRUNCATE)`.

---

## The restores were the actual harm

This is the part worth stating plainly. L7ZL restored those 39,430 rows to
their pre-L7ZJ values **three times**, believing it was reversing a corruption.
It was overwriting another session's deliberate, correct work — a legitimate
minutes projection — and then recording the reappearance as evidence of a
recurring defect.

The current values are that session's, recomputed after my last restore. **They
have been left exactly as they are.** Restoring again would destroy foreign
work on the basis of a misattribution that has now been corrected.

---

## Behavioural consequence, not repinned

The baseline correctly localises the change:

```
roster_players        281159 rows  927b5fa9290cb654  unchanged
roster_measurements   281159 rows  2009f8afa02c1fb2  MOVED
dataset               a433a7c149fe1628  CHANGED  (was 48ff9511e307817c)
```

| baseline | state |
| --- | --- |
| OUTBOUND_DECISION | moved → `e1bb8f2f4032c63b` |
| OPERATOR_WIRE | moved → `daf48688908e2cc8` |
| LOG_PAYLOAD | moved → `009192626440119e` |
| OPERATOR_EVIDENCE | moved → `72cbb26eb24896e1` |
| COACH_COMPOSITION | unchanged |
| EMAIL_BODY | unchanged |

Exactly the signature of a minutes projection: it feeds outbound decisions and
evidence, and does not touch coach composition or email body text. The
projection is therefore **behaviourally live**, as L7ZL suspected.

**Nothing has been repinned.** The movement belongs to the main checkout's work
and to whatever stage owns it; that session re-pinned its own baselines at
21:01. Repinning here would claim another branch's data change as this
branch's.

---

## Containment fix

The fix is not a restriction. Sharing the database across worktrees may well be
deliberate, and refusing it would break the arrangement the operator has chosen.
What was missing was that nothing ever *said* so.

`server/db/corpusIdentity.js` resolves the real path behind the configured one
and reports whether the bytes live outside this checkout. The Evidence baseline
prints it above the numbers, because it changes how every number below should
be read:

```
  SHARED CORPUS — /Users/rhysdavies/Documents/Recruitmatch/app/server/data/recruitmatch.sqlite
             server/data/recruitmatch.sqlite is a symlink to a database outside
             this checkout. Other checkouts and sessions can write these rows, so
             a moved digest is not on its own evidence of a local defect.
```

It refuses nothing and changes no behaviour. Six tests pin it, including the
`:memory:` case so test runs are never warned.

### Prerequisite, not implemented here

True per-stage containment requires the database to stop being shared — a
per-worktree copy, or an explicit `RECRUITMATCH_DB` per checkout. That is an
operator decision about ~200MB per worktree and about whether these branches are
meant to see each other's data at all. It is documented as a prerequisite rather
than taken unilaterally.

---

## Test suite state — red, and correctly so

The full suite was **176/176 files green at 19:4x**, before the foreign write.
It is now **4 files / 14 tests red**, and every one of them is downstream of
that write:

| file | tests | cause |
| --- | --- | --- |
| `evidenceBaseline.test.js` | 8 | *"DATASET CHANGED — the underlying rows moved"*. The guard firing exactly as designed. |
| `reports.test.js` | 3 | recorded report outputs, read from the live corpus |
| `campaignAttribution.test.js` | 1 | 5s timeout backing up a database that has grown to 222MB |
| `outreachMessageState.test.js` | 2 | same |

Verified by isolation: the two timeout files pass **72/72** on their own, so
they are size- and load-dependent, not broken. The L7ZL and L7ZL-C tests pass
**88/88**.

**These 11 pinned-output failures are not being fixed here.** Repinning them
would record another branch's data change as this branch's work, which is the
same mistake as the restores — in the opposite direction. They belong to
whichever stage owns the projection change; the main checkout re-pinned its own
baselines at 21:01.

This is the sharpest available demonstration of the underlying problem: a test
suite that is green or red depending on what a different checkout did twenty
minutes ago is not, on its own, telling you about your branch.

---

## L7ZL code review, independent of the incident

Reviewed against the live implementation and its 19 tests:

| property | verdict |
| --- | --- |
| FRESH / STALE / LEGACY_UNVERIFIED semantics | correct |
| production remains LEGACY_UNVERIFIED | confirmed — `recruiting_arrivals_build` has 0 rows |
| builder applies the trust predicate | confirmed, and pinned by a test |
| fingerprint reflects the effective semantic input | confirmed — roster after trust predicate, plus `coach_seasons` |
| a DIAGNOSIS does not stale | pinned |
| a RETAIN does not stale | pinned |
| an EXCLUDE stales | pinned |
| clearing an exclusion stales | pinned |
| typed stale is distinguishable from no-evidence | pinned — raises `StaleMaterialisationError` |
| data + fingerprint commit atomically | pinned — same transaction |
| a failed rebuild cannot appear fresh | pinned |
| no stale coach-facing claim escapes | both loaders assert |
| no real disposition changed | 15 rows, 2 RETAIN, 13 NULL, 0 EXCLUDE |
| auth still absent, write route still disabled | 503, unchanged |

The one L7ZL defect found after that review was its own cache key, corrected
before commit: `MAX(updated_date)` was both the timeout it existed to avoid
(76ms a call) and blind to in-place UPDATEs. Replaced with
`data_version` + `total_changes()`.

---

## Recommendation

**L7ZL engineering: APPROVE.** The blocker that held it was not its code. The
mutation is attributed to a different checkout, the invariant it implements is
sound, and its one real defect was found and fixed before the commit.

**L7ZL-C: the mutation is ATTRIBUTED, and the roadmap can proceed** — with one
honest caveat carried forward: while the database is shared, a moved digest is
not on its own evidence about this branch. The notice makes that visible; the
per-worktree database remains an open operator decision.
