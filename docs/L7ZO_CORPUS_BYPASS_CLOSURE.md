# L7ZO — corpus bypass closure

L7ZM made the JavaScript honest about which database it was on. It did not
reach the rest of the repository. This stage makes the contract true across it:
after L7ZO, selecting a corpus actually selects it, in both languages, including
inside the test suite.

Containment only. No product intelligence changed, no canonical data written,
no pins moved.

---

## Complete bypass inventory

Every database opener outside `node_modules`, classified:

| classification | count | what |
| --- | --- | --- |
| `USES_CANONICAL_RESOLVER` | 1 | `server/db/client.js` — 126 modules import it |
| `INTENTIONAL_SPECIAL_CASE` | 1 | `server/lib/dbSnapshot.js` — takes explicit source and destination paths |
| `TEST_EPHEMERAL` | many | test files opening their own fixtures |
| `BYPASS` | **17** | 9 Python tools, 2 JS scripts, 6 test suites |

L7ZM had named six. The audit found **eleven more of the same shapes**, all
newly discovered here:

| newly found | why it is a bypass |
| --- | --- |
| `tools/soccer/dedupe_schools.py` | **a second Python WRITER**, hardcoding the absolute canonical path — L7ZM named only `fix_scores.py` |
| `tools/soccer/build.py` | a **fourth** absolute-canonical path, via `BASE = "/Users/rhysdavies/Documents/Recruitmatch"` |
| `operations.test.js`, `rosterGapQueue.test.js`, `verifiedDomainBackfill.test.js`, `sendMigration.test.js`, `rosterCandidatePlan.test.js` | the `reports.test.js` pattern exactly: hardcode the checkout database, then force it into every child's environment |

So the corrected count is **4 absolute canonical paths, not 3**, and **2 Python
writers, not 1**.

---

## Python inventory

| tool | mode | previous path mechanism | honoured override |
| --- | --- | --- | --- |
| `soccer/fix_scores.py` | **WRITES** (`--apply`) | absolute canonical | no |
| `soccer/dedupe_schools.py` | **WRITES** (`--apply`) | absolute canonical | no |
| `soccer/impossible_games.py` | read | absolute canonical | no |
| `soccer/build.py` | read | absolute via `BASE` | no |
| `soccer/turnover_error_rate.py` | read | `file:server/data/…?mode=ro`, cwd-relative | no |
| `soccer/merge_harvested_rosters.py` | read | cwd-relative | no |
| `soccer/repair_athletics_domain.py` | read | cwd-relative | no |
| `soccer/discover_roster_urls.py` | read | cwd-relative, inline | no |
| `academic/build_crosswalk_naia_njcaa.py` | read | module-relative | no |

Both writers already defaulted to dry-run, which is why this had not yet caused
an incident. With `--apply` either of them wrote canonical from any checkout.

---

## The cross-language contract

> **`RECRUITMATCH_DB` is the one override.** When it is set, that is the
> database. When it is not, each caller's own default stands, unchanged.

One variable, deliberately — the one JavaScript already used. A second name for
the same idea would be a second way to be wrong about which corpus you are on.

`tools/corpus.py` is the Python half: a path, a category and a refusal, in the
same vocabulary as `server/db/corpusIdentity.js` so that a reader who knows one
knows the other. It is not a framework and should not become one.

```python
resolve_db(default=None)     # RECRUITMATCH_DB wins; else the caller's default
read_only_uri(path)          # file:…?mode=ro, for the read-only tools
corpus_category(path)        # EPHEMERAL_TEST / STAGE_SNAPSHOT / CANONICAL_SHARED / WORKTREE_LOCAL
assert_canonical_write(...)  # the L7ZM refusal, same words
```

The four cwd-relative tools now resolve **module-relative**, which is also what
they meant: run from `/tmp`, the old path pointed at nothing.

---

## Writer guard

Applied to the two Python writers on their `--apply` path only, so a dry run is
never refused. Proven end to end against a disposable copy — canonical was never
involved:

```
fix_scores.py --apply                 -> CANONICAL_WRITE_REFUSED, nothing written
fix_scores.py --apply --canonical     -> 852 scores corrected, 19 set to NULL,
                                         in the THROWAWAY; canonical untouched
```

Before this stage, that second command would have written canonical no matter
which checkout it was run from.

---

## JavaScript corrections

**`resolveDbPath()`** now lives in `corpusIdentity.js` and has no side effects —
`client.js` resolves through it, so there is one definition. Importing
`client.js` to ask "which corpus am I on" would open the file and run the
migrations, which is precisely what a snapshot tool pointed elsewhere must not
do.

- **`dbSnapshot.js`** took its source from `process.cwd()`. A snapshot's source
  must be the corpus that was selected.
- **`migrateEmailTemplates.js`** took both its backup path and its write target
  from `process.cwd()`, so in principle the two could describe different
  databases. It now resolves properly and, because it is a hand-invoked
  maintenance migration that rewrites operator-authored copy, carries the
  canonical-write guard. `migrate()` in `client.js` — the one that runs on every
  open — is deliberately untouched.
- **Six test suites** hardcoded the checkout database and forced it into their
  children. They now use `fileCorpusOr(fallback)`.

### Why `fileCorpusOr` treats `:memory:` as "no selection"

`vitest.config.js` sets `RECRUITMATCH_DB=':memory:'` for every test file in the
repository. That is a blanket default, not anyone choosing a corpus — and these
suites drive real subprocesses that must open a file or they have nothing to
read. So an in-memory setting falls through to the checkout default, exactly as
before, while an explicit path is obeyed. Getting this wrong first made all 19
report tests skip silently, which is the failure mode worth guarding against.

---

## Subprocess propagation

Every `execFileSync`/`spawnSync` in the repository spreads `...process.env` —
**no clean-env bypass exists**. The problem was never propagation; it was the
six suites overwriting `RECRUITMATCH_DB` with a hardcoded path on the way
through. Fixed at the source rather than at each call site.

---

## Proof

Two fixtures, each naming itself, so "which did you read" has a positive answer
rather than merely the absence of a crash.

| check | result |
| --- | --- |
| Python `resolve_db` honours the override, falls back otherwise | ✓ |
| JavaScript `resolveDbPath` resolves identically, opening nothing | ✓ |
| **a Python reader observes B, never A** | ✓ |
| a Python tool run from `/tmp` still reads the selected corpus | ✓ |
| `:memory:` falls through; an explicit path is obeyed | ✓ |
| canonical write refused / allowed with `--canonical` / allowed on a snapshot | ✓ |
| refusal uses the same vocabulary as the JavaScript | ✓ |
| a snapshot is taken of the corpus that was selected | ✓ |
| a snapshot still carries rows committed to the WAL | ✓ |

### Reports follow the selection — positive evidence

```
evidenceReport on the stage snapshot  ->  8105bf98447a9cfe   = the committed pin
evidenceReport on a marked corpus     ->  eab87ae9af6e076b   different
```

The marked corpus differs only in Jacksonville's `soccer_score`. Two corpora,
two answers, and the snapshot reproduces the pin exactly.

A first attempt at this proof used a corpus whose 871 changed rows were all for
*other* colleges, so both runs passed and discriminated nothing. A proof that
cannot fail is not a proof.

### A note on read-only opens and WAL

The selection fixtures are deliberately **not** in WAL mode. A strict `mode=ro`
open — how the read-only Python tools connect — cannot create the shared-memory
file a WAL database needs, and even `wal_checkpoint(TRUNCATE)` leaves a
zero-length `-wal` that is enough to make the open fail. Canonical never hits
this because something is always attached to it, keeping its `-shm` alive. The
WAL case is exercised on a fixture of its own.

---

## The measurement guard still works

`CORPUS_MOVED` was re-proven against a real mid-run write:

```
[writer] changed 1 rows at t+12s
CORPUS MOVED DURING THIS RUN — UNCOMPARABLE, not a regression.     exit 1
```

Two earlier attempts to show this **failed to fire, and both were my mistiming,
not a defect**: one write landed after the run had already finished, the other
during the ~6 second import-and-migrate phase, before the opening token is
taken. A probe that also looked like a defect turned out to be a no-op `UPDATE`
setting a column to its own value, which commits nothing for `data_version` to
see.

Known limit, stated rather than hidden: the guard covers the window from the
opening token to the closing one. A write during process startup is outside it —
and is harmless, because the measurement then reads one consistent post-write
state.

---

## Canonical immunity

| table | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `recruiting_arrivals` | `1cff960c09a9693c` | `1cff960c09a9693c` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |

Measured either side of a full suite run. Trust remains 15 / 2 RETAIN / 13 NULL
/ **0 EXCLUDE**; `recruiting_arrivals` remains **LEGACY_UNVERIFIED** with no
production rebuild. Manifest V5 `a433a7c149fe1628` unchanged, all six baselines
PASS on the stage snapshot, **no repin**, P6 unchanged.

---

## Remaining intentional special cases

- `server/lib/dbSnapshot.js` takes explicit paths — that is its job.
- `migrate()` in `client.js` runs on every open and is not guarded, because it
  is application startup rather than maintenance.
- Test files that open their own fixtures are `TEST_EPHEMERAL` and are left
  alone.
- `tools/roster_pipeline` writes its own state files and opens no database.
