# L7ZM — shared corpus isolation and baseline governance

L7ZL-C proved that a roadmap stage cannot tell the difference between "my code
broke something" and "another checkout wrote the database". This makes that
difference visible, and gives a stage a corpus that holds still while it
measures.

Nothing about the shared arrangement is forbidden here. It is announced.

---

## Correction to an L7ZL-C claim

L7ZL-C said twenty-one worktrees resolve to one database. **That was an
overstatement**, and this stage measured the real topology:

| population | count | corpus |
| --- | --- | --- |
| resolve to the canonical `app` database | **7** | `app` itself + 6 symlinks (`app-delivery`, `app-hosted-publish`, `app-main`, `app-narrative`, `app-release`, `thriv3-l7g`) |
| share a **separate** staging corpus | 3 | `app-coach-intel`, `app-competitive`, `app-v2-lifecycle` → one scratchpad `staging.sqlite` |
| private database | 7 | `app` (222MB), `d3` (219MB), `d46`–`d49` and `dbase` (~745KB seeds), `app-report-v2` |
| no database | 4 | `d50`, `d51`, `d52`, `app-lifecycle` |

The finding stands and is if anything more interesting: there are **three
distinct corpus populations**, and nothing in the repository says which one a
given checkout is in.

**No repository code creates these symlinks.** They were made by hand, and
`server/data/*` is gitignored — which is exactly why nobody saw them.

---

## Path resolution, and its bypasses

The intended resolver is one line in `server/db/client.js`:

```js
export const dbPath = process.env.RECRUITMATCH_DB || path.join(dataDir, 'recruitmatch.sqlite');
```

Precedence: `RECRUITMATCH_DB`, else a path relative to **the module**, so it
follows the checkout. 126 modules import it. There is no `DATABASE_URL`, no
`DB_PATH`, and no CLI database argument.

**Bypasses found:**

| bypass | risk |
| --- | --- |
| `server/scripts/dbSnapshot.js` | re-implements the precedence from `process.cwd()`, not the module — resolves differently depending on where it is invoked |
| `server/scripts/migrateEmailTemplates.js` | same |
| `tools/soccer/fix_scores.py` | **hardcodes the absolute canonical path and writes.** Ignores `RECRUITMATCH_DB` entirely; writes canonical from any checkout |
| `tools/soccer/impossible_games.py`, `dedupe_schools.py` | hardcode the absolute canonical path, read-write connections |

Nine Python tools reach the database directly and none of them consult the
JavaScript resolver. Three hardcode `/Users/rhysdavies/Documents/Recruitmatch/app/...`.

---

## Workflow classification

| workflow | class | corpus it should use |
| --- | --- | --- |
| Evidence baseline, manifest, audits | READ_ONLY measurement | a **stage snapshot** |
| report generation (`evidence`, `outreach-qa`) | READ_ONLY | canonical |
| roster acquisition / import | MUTATING_CANONICAL | canonical — **deliberately** |
| minutes projection | MUTATING_CANONICAL | canonical — deliberately |
| `recruiting_arrivals` rebuild | MUTATING_CANONICAL | canonical |
| migration | MUTATING_CANONICAL | canonical, automatic on open |
| operator API / server routes | MUTATING_CANONICAL | canonical, **no friction permitted** |
| tests | TEST_EPHEMERAL | `:memory:` |

The point worth stating: **most mutating workflows here are supposed to write
canonical.** An architecture that isolated them all would break the product.

---

## Options

| | correctness | disk | verdict |
| --- | --- | --- | --- |
| **A** private DB per worktree by default | isolates, but each copy diverges the moment it is made, so a stage measures a corpus the product does not have | 222MB × 7 ≈ 1.5GB, on a volume currently **97% full with 7.6GiB free** | **rejected** — it buys isolation by making measurements untrue |
| **B** shared canonical + advisory stage lock | advisory locks bind only those who check them; independent Claude sessions and Python tools will not, and an 8-minute baseline would hold it across seven checkouts | none | **rejected** — unenforceable against the actual writers |
| **C** immutable snapshot for measurement, shared DB for the app | measurement is stable and reproducible; canonical keeps working normally | one 202MB snapshot per measuring stage, deleted after | **strong** |
| **D** C **plus** an explicit acknowledgement for maintenance writes | C's measurement guarantee, and the write that caused L7ZL-C now announces itself | same as C | **chosen** |

**Chosen: D.** C is the measurement half; the mutation contract is the half that
addresses how the incident actually happened.

---

## Corpus identity

`server/db/corpusIdentity.js` answers **which database am I attached to**, by
resolved path:

| category | meaning |
| --- | --- |
| `EPHEMERAL_TEST` | `:memory:` |
| `STAGE_SNAPSHOT` | **declared** with `THRIV3_CORPUS=snapshot` |
| `CANONICAL_SHARED` | the bytes live outside this checkout — another tree can reach them |
| `WORKTREE_LOCAL` | the checkout owns the file |

Two deliberate choices:

- **`WORKTREE_LOCAL` includes the main checkout's canonical database.** Not a
  gap. Canonical operations *belong* in the tree that owns the file; what needs
  announcing is a side checkout reaching across into it.
- **A snapshot is declared, never guessed from a filename.** Inferring identity
  from appearances is the failure this module exists to end.

Reachability is the discriminator because it is the property that actually
caused the misattribution, it is cheap, and it is true regardless of what
anyone believes about the file.

---

## The canonical write contract

One mechanism, one flag, applied to the audited large-write scripts:

```
EPHEMERAL_TEST    write freely
WORKTREE_LOCAL    write freely — including the main checkout
STAGE_SNAPSHOT    write freely, it is a throwaway
CANONICAL_SHARED  pass --canonical, or point RECRUITMATCH_DB at a copy
```

Guarded: `projectRosterMinutes.js` (the L7ZL-C writer), `buildRecruitingHistory.js`,
`alignRosterSchoolNames.js`, `applyUscaaDivision.js`, `refreshGraduationYears.js`.
For the three that already default to dry-run, the guard sits **on the `--apply`
path**, so a dry run is never refused.

**The server never calls this.** The guard lives at script entry points, not in
`client.js`, precisely so operator and application writes are untouched. Proven
by test.

Simulated end to end against a disposable corpus — canonical never involved:

```
without acknowledgement  ->  CANONICAL_WRITE_REFUSED, naming the real file and both ways out
with --canonical         ->  passes the guard, proceeds to the script's own logic
canonical afterwards     ->  roster 3a83be9932c4c50d, unchanged
```

---

## The measurement guard

`evidenceBaseline.js` takes a corpus change token before and after the run
(`data_version` + `total_changes()`). If anything wrote during the measurement:

```
CORPUS MOVED DURING THIS RUN — UNCOMPARABLE, not a regression.
```

Exit code non-zero, `--update` refused. The same principle H18 set for the
manifest: when the question changed underneath the answer, the verdict is
UNCOMPARABLE, never FAIL, and **never "this branch mutated data"**.

The token is deliberately a **separate copy** of the same two-line SQLite
primitive that `recruitingMaterialisation` uses. Merging them would let a change
to either silently retune the other, and they answer different questions — see
"L7ZL interaction".

---

## Stage snapshots

`server/lib/dbSnapshot.js` already did this correctly with `VACUUM INTO`, which
runs inside a read transaction and therefore **includes rows committed to the
WAL but not yet checkpointed** — the failure that cost L7ZL a restore. Pinned by
a test that commits a row, confirms `-wal` exists, snapshots, and finds the row.

Measured: **6.7s, 202MB, `integrity: ok`**, and the six baselines computed on the
snapshot are **byte-identical** to the same six on live. Snapshots live in the
session scratchpad, are gitignored by location, and are deleted at stage end.

---

## Baseline governance — four states, not two

| state | meaning | verdict |
| --- | --- | --- |
| A | baseline code regression | **FAIL** |
| B | expected product-data movement | UNCOMPARABLE, repin deliberately |
| C | external corpus movement during the stage | **CORPUS_MOVED**, says nothing about this branch |
| D | intentional baseline update | `--update`, with an explanation |

Before L7ZM, C was indistinguishable from A. That is precisely what cost L7ZL a
stage.

---

## Reconciling the current movement

Measured on the stage snapshot, so the corpus could not move underneath it:

```
dataset  a433a7c149fe1628   (pinned: 48ff9511e307817c)
         roster_measurements MOVED; roster_players identity unchanged
```

| baseline | state |
| --- | --- |
| OUTBOUND_DECISION | moved → `e1bb8f2f4032c63b` |
| OPERATOR_WIRE | moved → `daf48688908e2cc8` |
| LOG_PAYLOAD | moved → `009192626440119e` |
| OPERATOR_EVIDENCE | moved → `72cbb26eb24896e1` |
| **COACH_COMPOSITION** | **unchanged** |
| **EMAIL_BODY** | **unchanged** |

4,742 athlete-programme pairs measured; 221 held claims; **no
rendered/recorded contradictions**. Email bodies did not change and coach-facing
composition did not change, so there is **no unsafe coach-facing regression**.

### Who owns the change

Commit `754a70c` in the main checkout. It introduced:

| file | |
| --- | --- |
| `shared/eligibility.js` | **300 lines, a new module — absent from this branch** |
| `shared/matching/pool.js` | 240 lines changed |
| `shared/classYear.js` | 52 lines changed |
| `server/scripts/projectRosterMinutes.js` | 115 lines changed |
| `server/scripts/projectRosterMinutes.test.js` | new, absent here |

**The canonical corpus is now produced by, and meant to be read by, code this
branch does not have.**

---

## Repin decision — NO

| criterion | |
| --- | --- |
| 1. movement is deliberate | **yes** — attributed in L7ZL-C |
| 2. interpreting code exists on this branch | **NO** — `shared/eligibility.js` absent |
| 3. behavioural movement understood | partly — the surfaces are known, the semantics live in code not present here |
| 4. no unsafe email/outreach regression | **yes** — both coach-facing baselines held |
| 5. corpus stable for the measurement | **yes** — snapshot |
| 6. manifest and data ownership reconciled | **NO** — owned by another branch |

Two criteria fail, so **nothing is repinned**. Repinning here would record
another branch's data change as this branch's work — the same error as L7ZL's
restores, in the opposite direction.

This is why `evidenceBaseline.test.js` (8) and `reports.test.js` (3) are red:
**this branch's pins do not match a corpus another branch's code produced.** That
is a true statement and the correct signal. Turning it green would be repinning
by stealth.

---

## Restore policy

> **Never restore the shared canonical corpus because a hash moved.**

A moved hash is a question, not a finding. Before any restoration:

1. **Attribute the writer** — `git log` and file mtimes in the *other*
   checkouts, especially `app`; compare against the corpus change token.
2. **Confirm the change is unwanted** by the party that made it. It usually is
   not: L7ZL restored legitimate work three times.
3. Only then restore, via `snapshotDatabase` (`VACUUM INTO`), and finish with
   `wal_checkpoint(TRUNCATE)` — **a repair is not durable until it is
   checkpointed.**

---

## L7ZL interaction

Corpus identity and materialisation freshness are **different questions** and
stay in different modules:

| module | question |
| --- | --- |
| `server/db/corpusIdentity.js` | which database am I using, and who else can write it? |
| `server/lib/recruitingMaterialisation.js` | does this derived table still match its semantic inputs? |

They share a two-line SQLite idiom and nothing else. Neither imports the other,
pinned by a test that strips comments before checking — L7ZI was bitten by a
guard that convicted the prose explaining the very coupling it was avoiding.

`FRESH` / `STALE` / `LEGACY_UNVERIFIED` are unchanged; production
`recruiting_arrivals` remains **LEGACY_UNVERIFIED** with zero build records.

---

## Manifest governance — corpus identity stays OUT

The manifest describes **semantic dataset content**. A filesystem path, a
checkout name or a symlink target is not content, and a manifest that moved when
a file was relocated would be answering a different question from the one every
committed digest was taken under.

Stage tooling **pairs** the two — the baseline header prints corpus identity
beside the manifest digest — without either one entering the other. No
filesystem identity was added to Manifest V5.

---

## Developer workflow

```bash
# measure something, on a corpus nothing else can move
node -e "import('./server/lib/dbSnapshot.js').then(m=>m.snapshotDatabase(SRC, SNAP, {overwrite:true}))"
RECRUITMATCH_DB=$SNAP THRIV3_CORPUS=snapshot npm run evidence:baseline

# deliberately change canonical data from a side checkout
node server/scripts/projectRosterMinutes.js --season 2026 --canonical

# a hash moved and you did not expect it
#   -> check the OTHER checkouts before touching anything
```
