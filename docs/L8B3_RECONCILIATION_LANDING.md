# L8B-3 — Landing the reconciliation

The Evidence branch and `main` had been apart for 209 and 62 commits. This
stage merges them, resolves every conflict on what the two sides MEAN rather
than on which text is newer, and proves the combined application against the
immutable corpus L8B-2 captured before any merged code existed.

**Pinned target `9a18d78`. `origin/main` is at `9a18d78` and did not move.**

---

## Topology

| | |
| --- | --- |
| Evidence start | `e6ecd0b` |
| pinned main | `9a18d78` |
| merge base | `c5c21d0` |
| main-unique | 209 commits |
| Evidence-unique | 62 commits |
| both-changed files | 15 |
| conflicting files | 10 |
| conflict hunks | 27 |

Ten conflicting files, the same ten as L8B. The hunks went 23 → 27, and all
four extra ones are L8B-1/L8B-2's own edits to files that were already
conflicting. **No new conflicting file appeared.**

---

## The conflicts, and what each one is

| file | class | resolution |
| --- | --- | --- |
| `.gitignore` | COMBINED_BEHAVIOR_REQUIRED | see below |
| `package.json` | SEMANTIC_UNION | 56 scripts, zero lost |
| `server/db/client.js` | COMBINED_BEHAVIOR_REQUIRED | corpus resolver + D3.2 guard |
| `server/db/schema.sql` | SEMANTIC_UNION | 101 objects, zero lost |
| `server/index.js` | SEMANTIC_UNION | every router from both sides |
| `server/lib/evidenceBaseline.js` | COMBINED_BEHAVIOR_REQUIRED | main's structure, V7's ten |
| `server/lib/evidenceBaseline.test.js` | COMBINED_BEHAVIOR_REQUIRED | V7 assertions + main's every-column check |
| `server/lib/philosophyQueries.js` | COMBINED_BEHAVIOR_REQUIRED | `division` AND `TRUSTED` |
| `server/scripts/__baselines__/evidence.json` | EVIDENCE_WINS + main's provenance | pinned-corpus pins, D3.3 history kept |
| `server/scripts/reports.test.js` | COMBINED_BEHAVIOR_REQUIRED | pinned snapshot, explicit selection wins |

### `.gitignore` — the one place the two rules cannot both apply

Main lists `server/data/` AND bare `server/data`, because a trailing slash
matches a directory and not a SYMLINK of the same name, and both paths were
once committed as dangling absolute symlinks. Evidence writes `server/data/*`
as a contents glob, because the verified-domain seeds under it have to be
re-included and git will not un-ignore a file whose parent DIRECTORY is
excluded.

These are incompatible, and that is measured rather than assumed: adding the
bare spelling makes `!server/data/seeds/*.json` stop matching, which
`git check-ignore -v` reports as `.gitignore:2:server/data`. So `server/data`
keeps the contents glob and the seeds, `server/uploads` carries the dual
spelling alone, and main's `server/reports/` is preserved. The comment in the
file says so, so the next person does not "fix" it.

### `client.js` — and a hole the merge itself opened

Evidence exports `dbPath = resolveDbPath()`; main refuses to open the default
database from a `node -e` one-liner. Both are kept.

The naive union has a gap. `resolveDbPath` TRIMS, so `RECRUITMATCH_DB="  "`
falls through to the default corpus, while main's predicate
`!process.env.RECRUITMATCH_DB` sees a truthy value and stands down — the guard
would be off for exactly the case it exists to refuse. The merged predicate is
the trimmed value, which is what the resolver acts on.

### `evidenceBaseline.js` — the same idea from both directions

Both branches independently arrived at the same `tableFingerprint`: every
column, column names sorted, each row hashed alone and the row hashes sorted.
Main's V3 essay is the origin of that method and is kept in full. V7's ten-table
list is kept.

The difference in table count is fully accounted for. Main's instrumentation
found SEVEN because seven is all that existed there: `roster_season_trust`,
`programme_status` and `recruiting_arrivals_build` are created by the Evidence
branch and by no other. Seven plus three is ten — and the ten were re-measured
on the merged tree rather than inferred from the arithmetic.

### `reports.test.js` — two rules that do not actually compete

Main's D3.2 says the default input is a pinned snapshot and never the working
database, on a disposable copy per run. Evidence's L7ZO says a test may CHOOSE
a default but may not OVERRULE the corpus the caller selected — this suite once
forced its own choice into a child's environment and L7ZN lost an experiment to
it. So an explicit selection wins, and absent one the pinned snapshot is
materialised. Falling back to the working database is what neither rule allows.

---

## Schema

Union of 101 objects. **Zero loss from either parent, and zero column drift:**
all 19 tables common to both sides have identical column sets, so the union is
purely additive — main's 97 plus Evidence's four (`programme_status`,
`recruiting_arrivals_build`, `roster_gap_reviews`, `roster_season_trust`).

`operator_users`, `operator_sessions`, `roster_season_trust`,
`programme_status`, `recruiting_arrivals_build` and the whole
campaign/mailbox/execution schema are present on a fresh database: 114 objects
after `migrate()`.

Migration on a representative current-schema database (the pinned corpus):
non-destructive, idempotent across two passes, `integrity_check ok`, row counts
identical, and — the property that matters here — **zero columns added to any
of the ten manifest tables**, which is why the corpus identity survives merged
code opening it. `migrate.js` auto-merged cleanly and was left alone.

---

## Auth and the middleware boundary

Every Phase 13K file is **byte-identical to `9a18d78`**: `operatorAuth.js`,
`auth.js`, `operatorEvidence.js` and their tests. Auth semantics did not change.

Executable order in `server/index.js`:

```
securityHeaders -> /healthz -> corsPolicy -> /api trackRouter (public)
  -> express.json -> attachOperator -> /api requireSameOrigin
  -> /api authRouter -> mailbox consent (public) -> /api requireOperator
  -> everything else
```

Nothing from main was removed. Both Evidence routers mount well after
`requireOperator`, so `rosterGaps` and `rosterSeasonTrust` are protected.
`/uploads` gained `requireOperator` on main — a tightening, carried across.

### The door L7ZK built, and the key main brought

`rosterSeasonTrust.js` shipped its write path built and shut: a disposition
needs an authenticated operator and the application had none, so the POST
answered 503. **The prerequisite is now met, and nothing had to change to open
it** — `operatorFromRequest` always read `req.operator.id`, which is what "the
change is one function" meant. The module's comment said the application has no
authentication; that is now false, and it has been corrected rather than left
to mislead.

`rosterSeasonTrust.operator.test.js` binds the real merged application to a port
and proves the join on a throwaway database:

- `req.operator` carries the signed-in identity
- a caller-supplied `reviewed_by_operator_id` is **refused 400**, not ignored
- RETAIN records the SERVER's operator id and the server clock
- a stale `expected_disposition` is **409**
- EXCLUDE_FROM_EVIDENCE still hits its own independent guard
- no session is still 503

No canonical operator, no canonical disposition, no reviewer backfill.

---

## Evidence authority

`sendSnapshot.js`, `templateMigration.js`, `compose.js`, `evidence/index.js`
and `outreachEvidence.js` are byte-identical **on both parents** — this layer
never diverged, so there was nothing to reconcile and nothing to regress. The
`{{evidence_paragraph}}` interface, structured composition as the authority,
the OUTREACH -> OUTREACH_SEND snapshot and `LEGACY_UNKNOWN` all stand.

Of everything under `shared/evidence/` and `shared/email/`, exactly one file
differs from the Evidence parent: `evidence.test.js`, where main had already
corrected a coach-tenure expectation — and its explanation is the same
94-verdict change this stage attributes the COACH_CONTEXT movement to.

---

## Manifest and closure

Manifest **V7**, ten tables, every column, `roster_freshness` retained as a
diagnostic. On the merged tree:

```
closure 10 table(s)   manifest 10 table(s)
Manifest V7 registers exactly what the walk reads.
```

No new table appeared. Guards on merged code:

| | |
| --- | --- |
| correct corpus | `8bb808b66db9ee3b` UNCHANGED |
| same bytes, different name | UNCHANGED — identity is the digest |
| mutated corpus | `20e21cb221df4ebe` CHANGED |
| missing corpus | REFUSED, **exit 2, no file created** |
| live fallback | impossible |

---

## Same-corpus acceptance

Run on the exact pinned corpus — not a refresh, not an equivalent, not live.
`datasetDigest 8bb808b66db9ee3b`, `dataset UNCHANGED`, 4,742 pairs.

| output | pre | post | changed pairs |
| --- | --- | --- | --- |
| OUTBOUND_DECISION | `cf1e7968` | `dd49dadd` | 183 |
| COACH_COMPOSITION | `5e6fb62e` | `5e6fb62e` | **0** |
| EMAIL_BODY | `54a05ec9` | `54a05ec9` | **0** |
| OPERATOR_WIRE | `8d502959` | `9af185f0` | 217 |
| LOG_PAYLOAD | `37544f26` | `6c1c2454` | 3,315 |
| OPERATOR_EVIDENCE | `7ca0e350` | `cdc14d31` | 2,802 |

`stats` and `invariants` are identical to pre-merge in every field.

### Attribution — nothing is UNEXPLAINED

**`9c0a036` — "A season nobody read is not a season nobody played."**
INTENDED_MAIN_FUNCTIONALITY. A programme-season whose stats page was never read
stops counting as measured zeros. Every one of 2,720 pool movements is
SMALLER — 770 seasons to 736 — and **not one is larger**. Refusals get more
honest with it: "only 0 in 0 seasons, too few to read separately" becomes
"nobody on file". This carries `pool.n/median/p25/p75`, `refused`, `band`,
`verdictNote`, and the removal of `FRESHMAN_MINUTES_LADDER`,
`PROGRAMME_POOL_BENCHMARK` and `ATHLETE_COHORT_LADDER` dispositions.

**`2555ff7` + `655dfc0` — the head coach was not always the head coach.**
INTENDED_MAIN_FUNCTIONALITY. `tenureFor` resolved a season's coach from any
name in the row, so a strength coach or a department became the programme's
head. 35 pairs across 16 programmes lose COACH_CONTEXT; Elms was filed under a
coach named "Sports Management". Main's own commit says 94 verdicts moved and
every one moved toward refusal.

**`9b700db`** — the additive `contributions[]` behind each ladder rung, 2,722
pairs. **`241fadc`** — the additive `previouslyUsed` marker; see the defect
below.

MERGE_RECONCILIATION: **none**. That is measured, not asserted. The only
resolution touching a behavioural query is `buildPoolBenchmarks`, where main's
`division` column joins Evidence's `TRUSTED` predicate. Re-running the whole
acceptance with `division` removed — Evidence's query exactly — produces **all
six digests byte-identical**. The column is inert for these outputs.

### Email quality

**Zero changed emails.** EMAIL_BODY and COACH_COMPOSITION are byte-identical
across all 4,742 pairs and 3.0MB of body text, so the review gate never fires.
GOOD/ACCEPTABLE/WEAK not applicable; **BAD = 0**.

That is not a coincidence. All 183 OUTBOUND_DECISION movements are REMOVALS of
`NOT_LICENSED` dispositions — claims that were never permitted in an outbound
email — so the emails could not have moved.

---

## The defect this stage found on main

`operatorEvidence.test.js` pins the composer route's exact key set. On the
merged tree it failed, carrying an extra `previouslyUsed`.

**It fails identically at `9a18d78`, before any merge.** That was run as a
control in a detached worktree at the pinned target.

`evidenceSummaries` states its own contract: with `coachIds` omitted, a caller
"receives exactly the payload it received before, **with no new keys at all**".
`241fadc` spread `previouslyUsed` unconditionally, so every finding of every
caller that never asked for history carried `previouslyUsed: null`. Main ships
two tests that cannot both pass: `evidence.test.js` is TITLED "adds no key at
all when no coaches are named" and then asserts `toBeNull()` — key present. The
prose and both test names agree on which is meant.

Fixed as its own commit so it can be reverted alone: the key is absent when
unasked, and the contradictory assertion now asserts what its title says.
**OPERATOR_WIRE moved 2,311 -> 217 changed pairs**, and no `previouslyUsed`
path remains anywhere in the residual.

---

## Pins

Four behavioural baselines repinned, with old/new/reason recorded in the
artefact's own `provenance.l8b3Repin`. **COACH_COMPOSITION and EMAIL_BODY were
NOT repinned** — an unchanged digest is not a repin. Manifest unchanged at
`8bb808b66db9ee3b`.

**Report pins did not move.** All 19 `reports.test.js` tests pass on the pinned
corpus, including the three "matches its recorded output" hashes.

---

## Canonical immunity

Measured on both instruments, before and after:

| | before | after |
| --- | --- | --- |
| Manifest V7 | `8bb808b66db9ee3b` | `8bb808b66db9ee3b` |
| Manifest V6 | `cc28ee6accdb84ed` | `cc28ee6accdb84ed` |
| `roster_players` (V7 / V6) | `3c9ae426` / `927b5fa9` | unchanged |
| `roster_measurements` | `2009f8afa02c1fb2` | unchanged |
| `roster_season_trust` (V7 / V6) | `6b4b9255` / `5391be73` | unchanged |
| `programme_status` (V7 / V6) | `32daab29` / `0a1132f6` | unchanged |
| `recruiting_arrivals` (V7 / semantic) | `fe7359e5` / `cf05efc2` | unchanged |
| arrivals freshness | FRESH | FRESH |
| trust | 15 / 2 RETAIN / 13 NULL / 0 EXCLUDE | unchanged |
| NCAA | 1,755 / 1,732 / 16 / 98.7% | unchanged |

**Canonical product data moved: NO.**

---

## Tests and build

**325 files, 8,247 tests, 0 failed, 1 skipped.** Production build clean.

---

## Two things worth knowing

**The short canonical hashes quoted in L7ZM through L8B-1 are not reproducible
by any instrument now in the tree.** `roster 3a83be9932c4c50d`, `trust
80279ea51e330ff6`, `programme_status 2271489bb81e747a`, `arrivals
2d694ab74f831491` (this document first wrote that last one as `2d694ab4`, which
was a transcription slip of mine): running V6's own `datasetManifest` against
canonical gives `927b5fa9`, `5391be73`, `0a1132f6` and `cf05efc2` instead. The DATA is provably unchanged — the V6 manifest
reproduces its pinned `cc28ee6accdb84ed` exactly, and that digest is taken over
those very per-table entries — so this is a question about which instrument
produced those four numbers, not about the rows. Reported rather than quietly
restated, because a figure carried forward across fifteen stage documents that
nothing can now recompute is worth naming. L8B-4 closed this: see
`docs/L8B4_INTEGRATION_CLOSEOUT.md` and the hash hierarchy at the end of
`docs/EVIDENCE_BASELINES.md`. Classification:
`LEGACY_UNREPRODUCIBLE_AUDIT_HASH`.

**A test creates an empty database at the default path, and other suites then
trust it.** `rosterGapQueue.test.js` spawns a child with
`RECRUITMATCH_DB=<ROOT>/server/data/recruitmatch.sqlite` and has no existence
guard, so in a checkout without a working database the child CREATES one.
`academicMajors.test.js` and `programmeStatusIntegration.test.js` gate on
`fs.existsSync` and then run against 0 rows. It is invisible in the Evidence
worktree because `server/data/recruitmatch.sqlite` is a symlink to the
populated canonical file. It is pre-existing Evidence-side behaviour, not a
merge regression, and it is the same shape as the hole L8B-2 closed in the
baseline runner: absent data read as empty data rather than as absent.
