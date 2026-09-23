# L8B-4 — Integration closeout

Two debts from L8B-3, closed. Then the readiness check for the reconciliation
PR.

**Starting `b101a62`. Pinned main `9a18d78`; `origin/main` fetched and still
`9a18d78`. Merge parents `9a18d78` + `e6ecd0b` intact.**

---

## 1. The four orphaned hashes

Fifteen stage documents, L7ZM through L8B-1, carry a "no product data changed"
table with four short per-table hashes. L8B-3 found that nothing in the tree
reproduces them. This is what they are.

### Where they came from: nowhere that survives

| table | quoted value | first recorded |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `af8a32f` (L7ZM) |
| `roster_season_trust` | `80279ea51e330ff6` | `423424f` (L7ZN) |
| `programme_status` | `2271489bb81e747a` | `423424f` (L7ZN) |
| `recruiting_arrivals` | `2d694ab74f831491` | `541714c` (L7ZP) |

**Generating instrument found: NO.** Searched exhaustively:

- Every ref, every commit, every path: `git log --all -S` finds them in
  **documentation only**. They have never appeared in a `.js`, `.py`, `.json`,
  `.sql` or `.sh` file on any branch.
- The originating documents carry no method note — no `sha256`, no `shasum`,
  no query, no script name anywhere near the tables.
- No surviving scratch code. Twenty session scratch directories remain on this
  machine and none contains them.

### Reproduction attempted, against the historical code itself

Disposable worktrees at `af8a32f` and `423424f` — the exact commits that first
recorded the values — run against a throwaway copy of the pinned corpus.
Canonical was never opened.

Both produce **V5**, aggregate `a433a7c149fe1628`, with per-table digests
`roster_players 927b5fa9`, `roster_season_trust 5391be73`,
`programme_status 0a1132f6`. That aggregate is exactly what the committed
artefact at `423424f` pins. **The instrument of the day reproduces perfectly,
and it does not produce the four values.**

Then a bounded mechanical search, on `programme_status` (6 rows) and
`roster_season_trust` (15 rows) because they are small enough to be decisive:

- 16 structural serialisations — `canonical()` over `SELECT *`, over
  sorted columns, per-row digests sorted and unsorted, line-joined sorted and
  natural, TSV, pipe-separated, JSON, the `{table,rows,digest}` envelope.
- Then 10 serialisations × 4 algorithms (sha256, sha1, md5, sha512) × 3
  slicings (first 16, last 16, base64) = **120 further combinations**.

The harness is known-good: it reproduces V7's `programme_status 32daab29b8c5a9dd`
exactly. **No combination produces the targets.**

### What the data says, which is the part that matters

Three generations of manifest, each run today against the current corpus, each
reproducing the aggregate pinned when it was current:

| instrument | pinned then | now |
| --- | --- | --- |
| V5 (`af8a32f` / `423424f`) | `a433a7c149fe1628` | reproduces exactly |
| V6 (`0cc3265`) | `cc28ee6accdb84ed` | reproduces exactly |
| V7 (`fc6c8ee`) | `8bb808b66db9ee3b` | reproduces exactly |

An aggregate is a hash over its per-table entries, so an aggregate that
reproduces is a statement about every component inside it. **The product data
is proven unchanged by three independent instruments.** The four values were
never a measurement of data that has since moved — they were never produced by
anything that survives.

**Classification: `LEGACY_UNREPRODUCIBLE_AUDIT_HASH`.** Retired from acceptance
and governance language, and recorded rather than erased: the historical stage
documents say what was believed at the time and are left alone.

### The recurrence is the finding

`docs/EVIDENCE_BASELINES.md` opens by saying that stages F to H proved their
changes with hashes that lived in a scratchpad and were quoted in a brief, and
that by H17 none could be reproduced. That file exists because of it. **The
same failure recurred one layer down** — not in the baselines, which are
committed and checked, but in the stage documents that report on them. The
hierarchy is now written down at the end of that file:

1. Manifest V7 — full product-data identity, held to the executed closure.
2. The pinned acceptance corpus V7 identity — what a digest was taken over.
3. The six behavioural baselines — what the product said about it.

Below that line everything is a diagnostic, and **a diagnostic hash must name
the function that produces it**.

---

## 2. The default-path test defect

### Reproduced

In a checkout with no working database, `npx vitest run
server/scripts/rosterGapQueue.test.js` left **a 786,432-byte database at
`server/data/recruitmatch.sqlite`** with 0 rows in `roster_players` and 0 in
`colleges`.

Root cause: the suite spawns children with
`RECRUITMATCH_DB=<ROOT>/server/data/recruitmatch.sqlite` and never asks whether
that file exists. `client.js` does not refuse an absent path — it creates the
database, runs `schema.sql` and `migrate()`. That is right for an operator
opening the application for the first time, and wrong for a test that meant to
read something.

### The two suites that then trust it

Measured, not inferred:

| state | `academicMajors.test.js` |
| --- | --- |
| empty database present | **2 failed**, gated tests ran against 0 rows |
| no database at all | **8 passed, 4 skipped** — correct |

`programmeStatusIntegration.test.js` has no existence guard at all and spawns
unconditionally, so it reads whatever is there.

Invisible in the Evidence worktree because `server/data/recruitmatch.sqlite` is
a **symlink** to the populated canonical file, so the path always existed. This
was tested with a plain file, never a symlink.

### Fix

`fileCorpusIfPresent(fallback, { minBytes })` beside `fileCorpusOr` in
`server/db/corpusIdentity.js` — the existing guard architecture, one function
wider. It answers "which corpus, and only if it is there", returns the path or
null, and rejects a bare-schema file because an empty database is not a present
one. `missingCorpusMessage` names the file it looked for.

Three suites adopted it: `rosterGapQueue.test.js`, `reacquisitionCohort.test.js`
and `programmeStatusIntegration.test.js`. The latter two also **hardcoded** the
path, so they were breaking the L7ZO rule as well — a suite may choose a
default, it may not overrule the corpus its caller selected. Both now go
through the resolver.

### A guard on the describe is not enough, and that was measured

The first attempt guarded only the `describe`. `describe.skip` still **runs the
suite factory** — it only marks the tests skipped — so `queue()` was still
called, and `RECRUITMATCH_DB: null` was coerced by the child's environment to
the **string `'null'`**. The result was a 786KB database in a file called
`null` at the repository root. The defect had moved, not gone.

So the refusal lives inside the spawn helper, and the call site does not call
it at all when there is no corpus.

### Production semantics: unchanged

`client.js` still creates the working database on first open. That is the
product's intended first-run behaviour and main's D3.2 guard already covers the
dangerous case (a bare `node -e` opening the default corpus). The fix is
contained to the tests and to one helper beside the guard that already owns
this question.

### Isolation proof

| | corpus absent | corpus present |
| --- | --- | --- |
| order 1 | 1 passed, 3 skipped — 8 passed, 47 skipped | 4 passed — 55 passed |
| order 2 (reversed) | 1 passed, 3 skipped — 8 passed, 47 skipped | 4 passed — 55 passed |

**No empty database created, no stray `null` file, no untracked file, in any
run.** Order-independent in both states.

One thing worth recording, because it bounds what the L7ZO rule can do:
`vitest.config.js` sets `RECRUITMATCH_DB: ':memory:'` in `test.env`, and that
**overrides the shell** — a test file always sees `':memory:'`, never an
explicit selection made outside. So "obey the caller's corpus" applies to the
CLI and to stage scripts, not to a suite's module scope, and the new helper's
selection logic is proven by unit test against an injected env rather than by
setting a variable that cannot arrive.

Seven tests added to `corpusIdentity.test.js`, including a regression guard
that fails if a fourth suite spawns at the default path without the helper —
because the damage from that always lands in a *different* suite.

---

## 3. Regression

| gate | result |
| --- | --- |
| missing acceptance corpus | REFUSED, exit 2, no file created |
| same bytes renamed | `8bb808b66db9ee3b` UNCHANGED |
| mutated corpus | `20e21cb221df4ebe` CHANGED |
| live fallback | impossible |
| canonical write refusal / throwaway ack / cross-language resolver | 40 passed |
| `npm run closure` | 10 registered, 10 executed, **difference 0** |
| Manifest V7 on the pinned corpus | `8bb808b66db9ee3b` |
| auth files vs `9a18d78` | all six **byte-identical** |
| auth suites | 161 passed |

Six behavioural outputs on the pinned corpus, all **PASS, no repins**:

| output | digest |
| --- | --- |
| OUTBOUND_DECISION | `dd49daddf7292d37` |
| COACH_COMPOSITION | `5e6fb62e12c3a022` |
| EMAIL_BODY | `54a05ec90e8937fd` |
| OPERATOR_WIRE | `9af185f0786665fd` |
| LOG_PAYLOAD | `6c1c24546ea2d310` |
| OPERATOR_EVIDENCE | `cdc14d31bd3fdc64` |

`EMAIL_BODY` and `COACH_COMPOSITION` are exactly the approved L8B-3 values.

**Full suite 325 files, 8,254 tests, 0 failed. Build clean.** One earlier run
of the same suite showed 3 transient failures — two `Test timed out in 5000ms`
and one `database is locked` — under parallel load; `campaignSchema.test.js`
passes 25/25 isolated and the suite passes clean uncontended. Recorded because
a flaky run is worth naming, not hiding.

---

## 4. Canonical — a change, and it is not ours

**`roster_players` gained three columns in the live canonical database during
this stage**, at 18:03. The live V7 digest moved
`8bb808b66db9ee3b` → `cd641a19e38225d5`.

Measured before concluding anything:

| | |
| --- | --- |
| objects added or removed | **0** |
| row-count movement, any table | **0** |
| columns added to `roster_players` | `projected_games_started`, `projected_games_played`, `projected_games_season` |
| rows differing in ANY of the 30 pre-existing columns | **0 of 281,159** |
| new columns populated on | 33,501 rows |
| `roster_season_trust`, `programme_status`, `coach_seasons`, `recruiting_arrivals`, `players`, `colleges`, `coaches`, `athletics_domains`, `recruiting_arrivals_build`, `roster_freshness` | all **unchanged** |

**None of those three column names exists anywhere in this repository** — not
at `9a18d78`, not at `e6ecd0b`, not at `HEAD`, not in `migrate.js`, not in
`schema.sql`, and not in any sibling worktree checked out on this machine.
Neither parent of the merge can have written them.

This is the L7ZL-C topology exactly: worktrees sharing one canonical SQLite
file, and another workstream — a games projection, sibling to
`projectRosterMinutes` — writing through it. L7ZL-C's lesson was that treating
a concurrent session's legitimate work as a defect in one's own branch is the
error; three restores were performed before that was understood.

**It does not touch this integration.** Every gate above ran against the pinned
acceptance corpus, which is immutable and still reproduces
`8bb808b66db9ee3b`. No code in this PR reads those columns, because no code in
this PR knows they exist.

The live digest moving is **V7 working as specified**: it hashes every column
of a manifest table, so a schema change to one IS dataset identity, and it said
so the first time it was asked.

Trust `15 / 2 RETAIN / 13 NULL / 0 EXCLUDE`, arrivals FRESH, programme_status
`32daab29b8c5a9dd`, NCAA `1,755 / 1,732 / 16 / 98.7%` — all unchanged.

---

## PR readiness

Clean tree, merge parents intact, V7 10/10, corpus identity correct, six
baselines green, auth green, suite green, build green, no product-data movement
attributable to this branch.

**Not pushed.** Stop condition 9 — "canonical product data changes" — fired in
letter during this stage, from an external writer. The facts are above; the
decision is the operator's.
