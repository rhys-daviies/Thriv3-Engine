# L6C — roster pipeline versioning and ownership

The roster acquisition pipeline is now under version control, in this
repository, with its behaviour proved unchanged by the move.

**No live acquisition was performed. No source was fetched, no roster row
imported, no dataset row altered.** P6 unchanged, manifest
`5bbca9054b7752d5` unchanged, all six baselines byte-identical, corpus unmoved
at 1,755 / 2,987, full suite 3,629 passing.

---

## The risk this closes

`~/Documents/Thriv3/_roster_pipeline` had no `.git`, and neither did its
parent. The code that performs target generation, source discovery, turnover
gating, soft-404 handling, cache/state writes and sheet generation had no
revision history, no diff, and no rollback.

Its own README records what that already cost once: on 2026-08-26 a session
restart deleted the pipeline, an 11,000-page fetch cache, and the state file
recording 1,475 resolved programmes. It was recoverable only because every file
had been created by a shell heredoc the transcript happened to preserve. That
was luck, and L6B's edits were sitting on the same luck.

## Inventory

| class | files | size |
|---|---:|---:|
| **SOURCE_CODE** (32 `.py`, 6 `.sh`) | **38** | **199 KB** |
| DOCUMENTATION (`README.md`) | 1 | 1 KB |
| STATE (`state_variants_2026.json`, `st_*.json`, `geo25.json`) | 14 | **11.3 MB** |
| GENERATED_OUTPUT (`.txt`) | 17 | 81 KB |
| LOG | 6 | 7 KB |
| TEMPORARY (`.pre-consolidate`) | 1 | 10 KB |

Reproducing **target generation** needs `build_targets.py` and the season sheet
directories. Reproducing **source discovery** needs `lib.py` (30 KB, the bulk of
the logic), `run.py`, `selector.py`, `variants.py`, `wayback2.py`, `browse.py`,
`state.py`, `verify_gate.py`, `write_out.py` and the `run_season*.sh` drivers.

## Secret and local-path audit

**No secrets.** Two files matched a keyword scan and both are false positives:
`school_tokens()` in `coaches_lib.py`, and a docstring about clinical
credentials plus a comment about a parsing token in `lib.py`. No long
high-entropy literals exist — the only long strings are status codes such as
`matched_but_nothing_usable`.

**No hardcoded usernames.** All paths are `~`-relative via `expanduser`, never
`/Users/<name>`. The fetch cache lives in `~/Library/Caches/recruitmatch-rb`,
which the README explains is deliberate: refetchable, not work product.

## How this repo depended on it

Loosely, and invisibly. The pipeline writes `<season> Roster Sheets/*.csv`;
`npm run import-rosters` reads `server/seed/data/rosters_<season>/`. **Nothing
automated connects the two** — sheets were moved by hand. The repo functions
without the pipeline present; it simply cannot acquire a new season. L6B added
the only formal coupling: `npm run roster-targets` writes
`_registry_universe.csv`, which `build_targets.py` reads.

## Ownership model

| | reproducibility | usability | data separation | auditability | CI | expansion |
|---|---|---|---|---|---|---|
| **A** into this repo | strong — one SHA covers schema, import contract and acquisition | one checkout | needs ignore rules | full | reachable | NAIA/NJCAA are a division list |
| **B** separate repo | strong, but two SHAs to correlate | two checkouts, version skew | clean | full | separate setup | same |
| **C** external runtime, snapshot only | **weak — the snapshot can drift from what actually runs** | confusing | clean | partial | no | same |

**Selected: A.** The pipeline feeds the import contract and the registry export
in this repo; splitting them means a roster sheet whose shape is defined here
is produced by code versioned elsewhere, and L6B has already shown how a
worklist and a registry drift apart when nothing ties them together. B is
defensible if the pipeline ever grows its own deploy target; it does not have
one today.

## Version-control boundary

**Versioned** — `tools/roster_pipeline/`: 38 source files, README, new
`paths.py`, `.gitignore`, and a test.

**Not versioned**, by `tools/roster_pipeline/.gitignore`: `*.json` (11.3 MB of
resolver state), `*.log`, `*.txt` (generated output), `*.pre-consolidate`,
`_state/`. Nothing was deleted — the originals remain in place at
`~/Documents/Thriv3/_roster_pipeline`, which stays the working runtime until
someone chooses to switch.

## The move changed nothing

All 39 copied files are **byte-identical** to their source. Running the
versioned copy against the real root produced a `_targets.csv`
**byte-identical** to the external run:

| | external | versioned |
|---|---:|---:|
| targets, no registry file | 2,123 | 2,123 |
| targets, with registry | **2,165** | **2,165** |
| registry-derived additions | 42 | 42 |
| prior 2,104 preserved | yes | yes |
| the 41 known gaps | 41/41 | 41/41 |
| Penn State Brandywine | present | present |

`RB_ROOT` was then pointed at a scratch directory and the generator ran fully
isolated, producing 2,123 with no registry file — the expected no-registry
baseline, from a root containing nothing real.

## Path normalisation — partial, and deliberately so

`paths.py` provides `sheets_root()` (honouring `RB_ROOT`, defaulting to
`~/Documents/Thriv3`) and `season_dir()`. **`build_targets.py` now has zero
`expanduser` calls.**

The other thirteen files still expand their own paths, 25 call sites in total.
That is left alone on purpose: rewriting them in the same change that
establishes ownership would make *"did the move alter behaviour?"* unanswerable,
and the answer above — byte-identical — is worth more than tidiness. With
`RB_ROOT` unset both styles compute the same string, so mixing them is safe.
Finishing it is a refactor for a later stage.

## Commands

```
npm run roster:universe -- "<root>/2026 Roster Sheets/_registry_universe.csv"
npm run roster:targets -- 2026            # dry run: worklist only, no network
npm run roster:acquire -- 2026 2025       # LIVE acquisition — L6D, not L6C
```

`roster:targets` is the dry-run mode: it reads sheets and the registry export
and writes one CSV. It touches no network and is what CI exercises.

## Generated-data policy

- **Canonical seed input:** `server/seed/data/rosters_<season>/` — committed,
  read by `npm run import-rosters`.
- **Pipeline output:** `<root>/<season> Roster Sheets/` — generated, not
  committed, reviewed before being promoted to seed data.
- **Cache:** `~/Library/Caches/recruitmatch-rb` — local only, refetchable.
- **State:** `<season> Roster Sheets/_state/` and the pipeline's `*.json` —
  local only.

A season becomes repository data by an explicit human step, never by a
pipeline run.

## CI coverage

`tools/roster_pipeline/buildTargets.test.js` — 6 tests, **no network**, driving
the real `build_targets.py` against fixture sheets in a temporary `RB_ROOT`:

- an active programme with no roster history enters the worklist
- it arrives with `discover from scratch` and an empty candidate, not excluded
- a known-good URL is still reused and year-swapped
- with no registry file, output is identical to before
- **a men's sheet entry does not satisfy a women's programme** — the L4 defect
- a registry-only programme carries its registry division and conference

These sit alongside the 11 in-repo `rosterTargetUniverse` tests, which are
unchanged and still passing. `vitest.config.js` gained `tools/**/*.test.js`.

## Operating model

> **The registry defines who exists.**
> **Source history helps find where.**
> **Roster output does not define future target membership.**

| responsibility | owner |
|---|---|
| target universe | `server/scripts/rosterTargetUniverse.js` — the registry |
| worklist assembly | `tools/roster_pipeline/build_targets.py` |
| acquisition, gating, provenance | the pipeline's `run_season*.sh` |
| roster import | `npm run import-rosters` |
| provenance entry | the sheet row's `Source Roster URL` / `Data Confidence` |

A new season: export the universe, build targets, run acquisition, review, move
sheets to seed data, import. A new programme enters automatically the moment it
is in the registry. A failed target is retried next cycle because failure never
removed it. NAIA/NJCAA later become entries in `TARGET_DIVISIONS`.

## L6D handoff

Run the versioned pipeline from a known SHA against the 34 legitimate NCAA
source-missing programmes; safe-import what resolves; measure P6 first-touch
Evidence impact; report actual NCAA coverage. The 7 duplicates and the 2
inactive rows stay out of the gain figure.
