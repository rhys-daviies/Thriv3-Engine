# L6D — controlled NCAA roster acquisition: the run happened, and resolved nothing

The scoping layer worked exactly as L6D-PRE designed it. The acquisition did
not, and the reason is not a defect in the run: **all 34 targets are programmes
for which no roster URL has ever been known**, and the current-season runner has
no discovery stage. Every one of its four acquiring stages transforms a URL it
already has.

So the cohort L6D was created to acquire is precisely the cohort that cannot be
acquired without the `athletics_domains` work this stage is forbidden to touch.

**Result: 0 of 34 resolved, all NO_SOURCE_FOUND.** No roster row imported, no
dataset row altered, no coverage moved, P6 unchanged, manifest
`5bbca9054b7752d5` unchanged, all six baselines byte-identical at 1,755 / 2,987.

Two findings came out of it that were worth the run.

---

## Finding 1 — the versioned pipeline could not execute at all

The first command L6D ran raised `FileNotFoundError`.

```
lib.py:408  GEO = json.load(open(os.path.join(HERE, 'geo25.json')))
            → No such file: tools/roster_pipeline/geo25.json
```

L6C copied 38 source files under version control and declared the repository the
code authority. It was not. `geo25.json` is a 1.2 MB reference table that
`lib.py` loads **at import time**, and L6C's blanket `*.json` ignore left it
behind in the external tree. Every module in the acquisition path imports `lib`,
so nothing in the pipeline could start.

It is not state and not refetchable output. It is the lookup that turns a
hometown string into a nationality — the authority behind every country claim
the Evidence layer makes downstream. An empty or absent one does not fail
loudly; `lib.geo()` falls through to `return 'USA', ''`, which would silently
call every international athlete American. It belongs in history.

Fixed: `geo25.json` committed byte-identical (`d93087607afac697`), and
`.gitignore` given a `!geo25.json` exception with the reasoning attached.

**Why no test caught it:** the L6C suite only ever imported the worklist
generator. `buildTargets.test.js` now imports all ten modules in the acquisition
path under an empty `RB_ROOT`, so "the code in this repository is the code that
runs" is now a checked claim rather than an assumed one. Removing `geo25.json`
fails 7 of them.

## Finding 2 — the 34 are a discovery problem, not an acquisition one

Every one of the 34 carries an empty `Roster URL 2025 (known good)` **and** an
empty candidate URL, and none has a 2025 reference roster. They are L6B's
registry-fallback rows, and `build_targets.py:139` already said so in a comment
written before anyone tried to run them:

> A registry-only programme has no scanned entry and therefore no candidate URL.
> It is a discovery job, not an omission.

`run_season_current.sh` has four acquiring stages and all four are URL
transformations:

| stage | what it does | with no base URL |
|---|---|---|
| `run.py direct` | year-swaps the known-good URL | nothing to swap |
| `variants.py` | permutes the known-good URL | `variants: none` |
| `selector.py` | picks the season on a known roster page | no page |
| `browse.py` | browser-renders URL variants | requests `?view=table` |

State recorded all 34 identically:

```json
{"status": "failed", "stage": "variants", "err": "no candidate",
 "tried": ["variants: none"]}
```

**No HTTP request was made against any of the 34 institutions.** The browser
stage's `?view=table` is not a resolvable URL; it errors before the network.

Acquiring these needs a starting domain per programme, which is the
`athletics_domains` work recorded as the L7 concern (D1 54%, D2 48% populated).
L6D cannot close its own cohort without it.

---

## The run

```bash
node server/scripts/rosterTargetUniverse.js --gap-keys --out /tmp/l6d-keys.txt
npm run roster:acquire -- 2026 2025 --keys /tmp/l6d-keys.txt
```

`--divisions` deliberately not used: it matches verbatim, so a typo narrows
silently, and the derived 34-key allowlist is already the strongest scope.

Key file `e4ca69df42411123…`, 34 lines. The runner printed the plan before its
first stage:

```
  target universe        2165   (membership — unchanged by scope)
  already done           1910
  eligible this season   255
  TO ATTEMPT             34
  excluded by scope      221  (left eligible for a future run)
        2  NCAA D2  mens-soccer      7  NCAA D3  mens-soccer
        5  NCAA D2  womens-soccer   20  NCAA D3  womens-soccer
  excluded: NAIA 55 · NCAA D1 18 · NCAA D2 11 · NCAA D3 117 · USCAA 20
  previously failed and being retried: 0    never attempted before: 34
```

0 NAIA, 0 USCAA, 0 other NCAA. The scoping layer held.

### The 34

**NCAA D2 men** Pace · Southwest Minnesota State
**NCAA D2 women** Azusa Pacific University · Glenville State · Northwood ·
Tuskegee · Wayne State (MI)
**NCAA D3 men** Anna Maria · Bryn Athyn · Carlow · Goucher · New Jersey City ·
Wisconsin-La Crosse · Wisconsin-Oshkosh
**NCAA D3 women** Anna Maria College · Bryn Athyn College of the New Church ·
Carlow University · College of Saint Benedict · Elms · Endicott College ·
Eureka College · Goucher College · Lasell · Mitchell · New Jersey City
University · Norwich · Rivier · Saint Mary's College (IN) · Simmons ·
St. Catherine University · Trinity Washington University · UMass Boston ·
UMass Dartmouth · Wesleyan (GA)

### Classification

| result | n | programmes |
|---|---:|---|
| `NO_SOURCE_FOUND` | **34** | all of the above |
| `RESOLVED` · `SOFT_404` · `TURNOVER_REJECTED` · `SOURCE_PARSE_FAILURE` · `IDENTITY_MISMATCH` · `NETWORK_FAILURE` · `OTHER` | 0 | — |

Success rate 0%. The historical ~91% is not a comparable figure: it describes
re-acquiring programmes whose URL was already known. On its own population —
programmes with no known source and no discovery stage — this run's ceiling was
0% before it started.

---

## Output safety

`write_out.py` rebuilt all sheets from state, as designed.

| sheet | rows before → after | |
|---|---|---|
| ncaa_d1_mens / d1_womens / d2_mens / d2_womens / d3_mens / d3_womens | 6155 / 9327 / 6906 / 7485 / 8465 / 9317 | byte-identical |
| naia_mens / naia_womens | 5557 / 4576 | byte-identical |
| uscaa_womens | 19 → 19 | **one field changed** |

Programmes 1,910 → 1,910. Rows 57,807 → 57,807. **Rows added 0, removed 0.**
No unrelated roster data disappeared; stop condition 4 is clear.

**The one change, and why it matters.** `uscaa_womens` kept all 19 players and
changed `Conference` on every row, Pennsylvania State University Athletic
Conference → Eastern College Athletic Conference. Nothing in this run touched
USCAA. The cause is that the *state* row carries ECAC from its August browser
read, while the *sheet* had been repaired to PSUAC out-of-band — a repair never
written back to state. Rebuilding from state reverted it. The registry agrees
with the sheet, not with state.

This is the L6D-PRE concern about an unscoped `write_out.py` arriving in
miniature: a sheet-level correction that was never persisted is silently undone
by any future run. The sheet has been **restored to its pre-run bytes**; all
nine now hash identically to the pre-run backup. State was left alone — the
programme is USCAA and out of scope — and the underlying defect is handed to a
separate stage.

One new artefact: `uscaa_mens_soccer_2026_rosters.csv`, header only, 0 rows.
`write_out` emits a file per (division, sport) and USCAA men's has no resolved
programme. Left in place, not deleted.

## Import, coverage, Evidence

Nothing resolved, so nothing was imported. `roster_players` unchanged at
276,745 total / 57,807 for 2026. The database was not opened for writing.

| | programmes | with roster | before → after |
|---|---:|---:|---|
| D1 men | 213 | 213 | 213 → 213 |
| D1 women | 349 | 349 | 349 → 349 |
| D2 men | 203 | 201 | 201 → 201 |
| D2 women | 260 | 254 | 254 → 254 |
| D3 men | 318 | 311 | 311 → 311 |
| D3 women | 418 | 392 | 392 → 392 |
| **NCAA total** | **1,761** | **1,720** | **1,720 → 1,720** |

Remaining gaps 41 = **34 legitimate active** + 7 duplicate registry rows. The 2
inactive rows are outside the universe entirely. Duplicates and inactive rows
are not acquisition failures and are not counted as such.

Evidence impact is nil by construction: 0 canonical pairs affected, 0 generic →
personalised, 0 supplemented, 4,742 unchanged. No newly personalised email
exists to review, so the GOOD/ACCEPTABLE/WEAK/BAD review has an empty
population and stop condition 9 cannot be reached. History depth is likewise
empty — no programme resolved, so none is CURRENT_ONLY or otherwise.

## Retry behaviour

The 34 now carry `failed` state and **remain fully eligible**:

* `--gap-keys` re-run after the acquisition emits the same 34 keys, same digest
  `e4ca69df42411123`.
* `plan.py` re-run reports `TO ATTEMPT 34` unchanged.
* `_targets.csv` still holds 2,165 rows — membership untouched.
* the 221 excluded targets were not written to state and stay eligible.

`verify_gate.py` re-measured all 1,910 done rosters against the current 85%
turnover gate and demoted **0**, both before and after the run.

## Manifest and policy

Manifest `5bbca9054b7752d5` **before and after** — dataset inputs did not move,
so the comparison is **COMPARABLE** under the H18 rules and no baseline surface
should move. All six PASS unrepinned. P6 unchanged; no Evidence semantics were
touched and no historical send snapshot changed.

## Remaining gap triage

All 34 classify identically, because they share one cause:

**`MANUAL_SOURCE_REVIEW` — blocked on athletics_domains (L7).** Source
discovered: NO for all 34. Failure reason: no candidate URL and no discovery
stage. `RETRY_AUTOMATICALLY` would be wrong — re-running this command changes
nothing until a starting domain exists. No manual repair performed.

The 7 duplicate registry rows and 2 inactive rows remain untouched and are not
part of this debt.

## External state handoff

**STATE_STILL_REQUIRED.** L6D-PRE proposed READY_FOR_CONTROLLED_MIGRATION; this
run shows that was premature for a reason it could not have known. The external
tree held `geo25.json`, without which the versioned pipeline does not import —
the code copy was still load-bearing, not merely stale. That specific dependency
is now closed, but the sheets and the 31 MB `state2026.json` remain the only
record of 1,910 resolved programmes and still live at
`~/Documents/Thriv3/2026 Roster Sheets`. Cache stays at
`~/Library/Caches/recruitmatch-rb` (8.6 GB). Nothing deleted or migrated.

## Verification

Six baselines PASS · manifest unchanged · baseline 33 · generalisation 21 ·
reports 19 · operations 16 · registry + pipeline + scoping 49 (25 of them the
pipeline's, up from 14) · **full suite 3,648 passing, 133 files** · build ✓.
