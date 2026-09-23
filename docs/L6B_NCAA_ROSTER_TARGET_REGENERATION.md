# L6B — NCAA roster target regeneration

**Previous roster success is no longer the authority for current target
membership.** The registry decides who must be considered; prior source history
only suggests where to look.

P6 unchanged, manifest `5bbca9054b7752d5` unchanged, all six baselines
byte-identical, corpus unmoved at 1,755 / 2,987, full suite 3,623 passing.

---

## Root cause

`_roster_pipeline/build_targets.py` built its universe from `scan()`, which
reads the **roster CSV files of adjacent seasons**:

```python
per  = {y: scan(y) for y in LATER}
keys = sorted(set().union(*[set(p) for p in per.values()]))
```

A `(School, sport)` pair can only be a key if it already appears in a roster
file. So membership required already having a roster:

> Wisconsin-Oshkosh men's is absent from the 2025 D3 men's sheet → it is not a
> key when the 2026 worklist is built → it is never fetched in 2026 → it is
> absent from the 2026 sheet → it is not a key in 2027.

The file's own docstring shows the defect had already been half-fixed once —
the universe was moved off the *previous worklist* and onto the *roster files*
after the 2024 list inherited a blind spot of 18 programmes. That was an
improvement to the same wrong idea: both are last-season output.

Same class as the NAIA glob bug the project already hit, where 386 programmes
"read as a coverage gap and were a worklist one".

## Old authority vs new

| | old | new |
|---|---|---|
| **who is considered** | pairs appearing in adjacent seasons' roster files | **active NCAA programmes in the registry** |
| where to look | first non-empty `Source Roster URL` from the nearest season | unchanged |
| no prior URL | **excluded from the worklist** | target with `no later URL on record — discover from scratch` |

`server/scripts/rosterTargetUniverse.js` (this repo, versioned) exports the
registry universe; `build_targets.py` unions it into `keys`. **Union, not
replacement** — the roster files still supply every candidate URL they cover,
so no known-good URL is lost and the repair-preservation logic is untouched.

Absent `_registry_universe.csv`, `build_targets.py` behaves exactly as before.

## Exclusion rules

- `active = 0` — a discontinued programme has no current roster to find, and
  asking turns a correct absence into a recorded failure.
- Divisions outside `TARGET_DIVISIONS` (`NCAA D1/D2/D3`). NAIA, NJCAA and USCAA
  are deferred; including them would silently re-scope a run.
- Sports outside `TARGET_SPORTS`.

**Duplicate registry rows are deliberately NOT excluded.** L6 found seven whose
twin already holds the roster, two of them carrying it under the wrong name.
Suppressing them by name would be precisely the ad-hoc identity guess L4 made
and L5 had to undo. They stay targets, will resolve to a real source, and are
handed off below.

## Target universe validation

| | count |
|---|---:|
| committed worklist | 2,104 |
| regenerated, **no** registry file (existing generator, refreshed) | 2,123 |
| regenerated **with** registry | **2,165** |

Isolated by running the generator both ways:

- **19 additions are not from this change.** All USCAA, all `season-span swap`,
  i.e. the existing `scan()` picking up USCAA roster files added since the
  committed worklist was built. The committed list was simply stale. USCAA
  enters through `scan()`, not through the registry export, which is NCAA-only.
- **42 additions are from this change**, every one NCAA: D3 34, D2 8.
  - **all 41 active NCAA gaps — 41 of 41 present**
  - plus **Penn State Brandywine** (NCAA D3 women's), which *has* 85 roster rows
    but a NULL `unitid` and was missing from the worklist. It would have been
    dropped next season. The defect was never limited to zero-roster programmes.
- **0 removals.** Nothing previously targeted was lost.

## Sport / gender / division isolation

Permanent tests in `server/scripts/rosterTargetUniverse.test.js` (11 passing),
written against the exact bug L4 shipped and L5 caught:

- every programme is keyed by `(school, sport)`, so a men's entry can never
  answer for a women's programme — asserted on 100+ schools fielding both
- every row carries a division and `(school, sport, division)` is unique
- deferred associations are absent
- inactive programmes are absent
- selection never reads `roster_players` — asserted on the source text, so a
  future edit cannot quietly reintroduce fetch-outcome membership
- ordering is deterministic, so two seasons can be diffed

## Refresh guarantee

The point of the stage, and more important than the 34:

- a current active programme with no prior success **is** in the next worklist
- a programme added to the registry appears without any source history
- a previously failed target is retried under the pipeline's existing rules
- prior success is an optimisation, never membership

## What was NOT done, and why

**Phases 10–14 (live acquisition, import, Evidence impact, email review) were
not run.** No source was fetched, no roster row imported, no Evidence measured.

Three reasons, stated plainly rather than buried:

1. **The pipeline is not version-controlled.** `~/Documents/Thriv3/_roster_pipeline`
   has no `.git`, and neither does `~/Documents/Thriv3`. There is no revision to
   report and no revert path except the backup taken here.
2. Running it makes live network requests to ~41 athletics sites and writes
   roster sheets, state and cache outside this repository — "do not mutate
   uncontrolled production state" is hard to honour while doing that.
3. The brief's own ordering: *"This is more important than closing all 34
   today."* The structural fix is complete and proven; the acquisition run is an
   operation, not a validation.

The run is now a single command, and the worklist it would read is correct:

```
cd ~/Documents/Thriv3/_roster_pipeline && ./run_season_current.sh 2026 2025
```

Consequently there is **no coverage change to report**: D1 100%, D2 97.9%,
D3 95.5%, NCAA 97.6% — unchanged, with 41 rows still open (34 genuine gaps,
7 duplicates), plus 2 inactive.

## External changes, disclosed

Outside this repository and **not version-controlled**:

| path | change | backup |
|---|---|---|
| `_roster_pipeline/build_targets.py` | +`registry_universe()`, union into `keys`, registry fallback for a no-scan entry, one log line | `build_targets.py.orig`, sha256 `703a641e3254…` |
| `2026 Roster Sheets/_targets.csv` | regenerated: 2,104 → 2,165 rows | `_targets.csv.orig`, sha256 `4530181794…` |
| `2026 Roster Sheets/_registry_universe.csv` | **new**, 1,761 rows, generated by `npm run roster-targets` | regenerable |

Backups are in this session's scratchpad, which the pipeline's own README warns
is not durable. **If these edits are to be kept, they need a real home** — the
pipeline being unversioned is itself the largest risk surfaced by this stage.

## Registry duplicate handoff — not repaired

| pair | classification |
|---|---|
| Cal Lutheran / California Lutheran University | SAFE_CANONICAL_DUPLICATE |
| UC Santa Cruz / University of California-Santa Cruz | SAFE_CANONICAL_DUPLICATE |
| FDU-Florham / Fairleigh Dickinson University-Florham | SAFE_CANONICAL_DUPLICATE |
| Claremont-Mudd-Scripps / Claremont McKenna College | HUMAN_DECISION_REQUIRED — CMS is the athletics consortium; the roster sits under one member college |
| Pomona-Pitzer / Pomona College | HUMAN_DECISION_REQUIRED — same consortium shape |
| Mississippi College / **Mississippi Christian** | HUMAN_DECISION_REQUIRED — the row holding the roster is the *misnamed* one |
| St. Joseph's (Brooklyn) / **St. Joseph's (Long Island)** | HUMAN_DECISION_REQUIRED — same; both name the Brooklyn campus |

Three are safe spelling duplicates. Four need a person, because the survivor is
not the row holding the data. None is `LEGITIMATE_MULTI_ENTITY` — the four such
groups (Commonwealth, Vermont State, PennWest) are outside this seven.
