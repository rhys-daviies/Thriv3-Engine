# L7ZU — registry universe synchronisation

An operational stage: regenerate the operator's `_registry_universe.csv` with
the repository's own generator, prove the six departed programmes leave and
nothing active does, and hand the next stage a worklist that matches the
authority.

**Result: synchronised. 1,761 → 1,755, six removed, none added, no product data
touched, and every piece of operational state preserved.**

---

## Official generator

```bash
node server/scripts/rosterTargetUniverse.js --csv --out PATH   # npm run roster-targets
```

Scoped to `TARGET_DIVISIONS = ['NCAA D1','NCAA D2','NCAA D3']` and filtered by
`activeForSeason(status, season)` at `TARGET_SEASON = 2026`. The export is
**NCAA-only by design**: `build_targets.py`'s `scan()` already covers "every
division held, not just the NCAA six", so NAIA and USCAA membership comes from
the roster sheets and is untouched by this file.

It writes exactly one file — a single `writeFileSync` to `--out`.

Operator root: `~/Documents/Thriv3` (the `RB_ROOT` default).

---

## Authoritative universe

| | |
| --- | --- |
| active NCAA targets for 2026 | **1,755** — D1 562, D2 462, D3 731 |
| gap queue reconciliation | 1,732 rostered + 7 registry duplicates + 16 residuals = 1,755 ✓ |
| coverage | 98.7% |

Reconciles with the L7ZT figure exactly.

---

## The diff

| | |
| --- | --- |
| old export | 1,761 (D1 562, D2 463, D3 736), digest `a1ffdac7e0e51681`, dated 2026-09-11 |
| new export | **1,755**, digest `e7d7af64ddc5cf34` |
| added | **0** |
| removed | **6** |
| changed | **0** |

*(L7ZT dated the export 2026-09-18. That was wrong — an `ls` of two files whose
paths contain spaces, column-shifted by `awk`. The universe export was
2026-09-11; the 09-18 file was `_registry_candidates.csv`.)*

### The six, checked structurally rather than by name

Every one evaluated through `allStatuses()` / `programmeKey()` /
`activeForSeason(status, TARGET_SEASON)` — all **false**:

| programme | status | why |
| --- | --- | --- |
| Southwest Minnesota State M | `NOT_ACTIVE` | — |
| Anna Maria M | `NOT_ACTIVE` | — |
| New Jersey City M | `NOT_ACTIVE` | — |
| Wisconsin-La Crosse M | `NOT_ACTIVE` | — |
| Anna Maria College W | `NOT_ACTIVE` | — |
| **Wisconsin-Oshkosh M** | `FUTURE` | `activeFromSeason: 2027`, reason `LAUNCHING`; site navigation reads *"Soccer (Coming in 2027)"* and the 2027 roster page carries zero players |

`programme_status` holds exactly six rows, and these are them.

**Active NCAA programmes missing from the new export: 0.** The new export *is*
the authority's own output, and the old-vs-new diff adds nothing — every
removal is a programme the status contract now excludes.

---

## Residual preservation

Re-derived natively with `rosterGapQueue.js --json`, not carried over:
**16 residuals**, and **16 of 16 present** in the proposed export before the
write.

---

## Planner simulation

On a disposable 205MB copy of the operator sheet directory, replacing only
`_registry_universe.csv`:

| | old export | new export |
| --- | --- | --- |
| school-sports | 2,165 | **2,159** |
| registry universe | 1,761 | 1,755 |
| Status carried | 2,165 | **2,159** |
| Notes carried | 2,165 | **2,159** |
| new targets initialised | — | **0** |

Row-by-row against the pre-run baseline: **6 removed, 0 added, 0 Status
changes, 0 Notes changes, 0 other field changes** across all 2,159 survivors.

The planner announces the departures itself:

> *6 target(s) left the registry universe and are no longer listed; their
> durable state in `_state/` is untouched*

**Fallback control:** untouched. No production code changed, and the existing
test *"behaves exactly as before when no registry file is present"* still holds.

**Determinism:** three generations from identical inputs, all
`e7d7af64ddc5cf34`, byte-identical to the reviewed copy.

---

## Write gate — PASS

All nine: count reconciles · removals explained · 0 active lost · 16/16
residuals kept · Status/Notes/state preserved · deterministic · no acquisition ·
corpus stable · P6 unchanged.

```bash
node server/scripts/rosterTargetUniverse.js --csv \
  --out "$HOME/Documents/Thriv3/2026 Roster Sheets/_registry_universe.csv"
```

### Post-write proof

| | |
| --- | --- |
| written digest | `e7d7af64ddc5cf34` — **matches the reviewed expected output** |
| rows | 1,755 |
| six stale programmes | absent, 0 occurrences each |
| other files in the directory | untouched — every roster sheet still dated 09-18/09-19 |

Then `python3 build_targets.py 2026` (no `--reset-state`) against the
synchronised export: 2,165 → **2,159**, 6 removed, 0 added, **0 Status and 0
Notes changes**, and **16/16 residuals present** in the operator worklist.

---

## Product-data immunity

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `2d694ab74f831491` | `2d694ab74f831491` |
| arrivals freshness | FRESH | FRESH |
| Manifest V6 | `cc28ee6accdb84ed` | `cc28ee6accdb84ed` |
| coverage | 1,732 / 1,755 = 98.7% | unchanged |

No acquisition ran: no HTTP roster fetch for acquisition, no import, no roster
database write.

---

## Authoritative residual queue

**16**, unchanged by the synchronisation. `EXISTING_CANDIDATE` 13,
`NEW_VERIFIED_HOST_CANDIDATES` 2, `NO_TRUSTED_HOST` 1; 13 historical-only, 3
never rostered.

| division | g | programme | current native error |
| --- | --- | --- | --- |
| D1 | M | Bradley | unreachable / nothing parsed |
| D1 | M | George Mason | too few players parsed |
| D1 | W | Arkansas | turnover |
| D1 | W | Miami (FL) | turnover |
| D1 | W | Vanderbilt | turnover |
| D1 | W | **Virginia** | repeats 100% of the 2025 squad |
| D2 | M | Eastern New Mexico | page season |
| D2 | M | Frostburg State | turnover |
| D2 | M | San Francisco State | page season |
| D2 | W | Montevallo | page season is not 2026 (title "2025-26 …") |
| D3 | M | Bryn Athyn | no candidate *(never rostered)* |
| D3 | M | SCAD | page season is not 2026 (title "2025 Men…") |
| D3 | W | Bryn Athyn College of the New Church | no candidate *(never rostered)* |
| D3 | W | CUNY York College | page season is not 2026 (title "2025 Wom…") |
| D3 | W | New Jersey City University | no candidate *(never rostered)* |
| D3 | W | University of Valley Forge | connection error |

---

## Virginia — native diagnostics for the cohort study

`diagnose_cohort.py`, digest `09abc7b4ec999309`. No ad-hoc extraction.

| | |
| --- | --- |
| active | **yes** — in the 1,755 |
| class | **TURNOVER_REFUSED** |
| url | `https://virginiasports.com/sports/womens-soccer/roster` (rung 3 of 5; 0,1,2,4 are 404) |
| parser | `roster-card` |
| **raw parsed records** | **38** |
| **players after staff filter** | **28** ← what the gate measures |
| historical reference | 2025 sheet, **28** names |
| turnover | **1.0** (100%) |
| comparable returners | **28** |
| aged | **20** |
| aged share | **71.4%** — against `RETURNER_AGED_MIN` 0.75 |
| page-season identity | `season_ok = True`; title *"Women's Soccer 2026-27"* |

### A reconciliation worth recording

The diagnostic's `n = 38` and my L7ZS figure of 28 are **not** in conflict:
`n` is the raw parse, `overlap` and the gate run on `_players()` after the staff
filter, which is 28. Both were right about different quantities.

That distinction is exactly what I got wrong in L7ZR, where staff inflated an
ad-hoc count into twelve phantom newcomers. Per the locked rule, the native
instrument was run first here and the ad-hoc number reconciled against it rather
than the other way round.

---

## What changed on disk

Two operator artefacts, neither versioned in this repository:

- `~/Documents/Thriv3/2026 Roster Sheets/_registry_universe.csv` — regenerated
- `~/Documents/Thriv3/2026 Roster Sheets/_targets.csv` — rebuilt by the planner

A pre-write copy of the old export is in the session scratch directory and is
not committed; the file is deterministically regenerable from the repository in
any case.
