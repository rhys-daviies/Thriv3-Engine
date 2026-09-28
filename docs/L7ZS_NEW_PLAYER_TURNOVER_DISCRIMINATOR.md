# L7ZS — new-player turnover discriminator

**Result: DECISION REQUIRED. The rule was not implemented, because the
measurement it was approved on was wrong — and the mistake was mine.**

L7ZR reported that Vanderbilt, Miami and Virginia each carried 10–15 players
absent from both stored reference seasons, and argued that a newcomer count
would resolve them without weakening the gate. That approval was granted on
those numbers. They do not survive measurement with the pipeline's own parser.

---

## The error

L7ZR counted newcomers by extracting `a[href*="/roster/"]` anchors from a
headless browser and differencing them against stored roster names.

That anchor set contains **coaching and support staff** and other roster links.
The gate does not count those: `run._players()` applies `lib.clean_name`,
`lib.is_staff` and `lib.name_is_staff` first, and its docstring is explicit
about why — the same conflation once "ran the gate low by up to 33 points and
let stale rosters through".

I never validated my extraction against that parser. This is the failure mode
already on record in this roadmap: *a conversion tested only against itself*.

| programme | L7ZR claimed | actual (pipeline parser) |
| --- | --- | --- |
| Vanderbilt W | 12 new | **1** |
| Miami (FL) W | 15 new | **0** |
| Virginia W | 10 new | **0** |

Measured three independent ways, all agreeing: raw-HTML `lib.parse_any`, the
pipeline's browser path `browse.load` + `browse.extract`, and
`diagnose_cohort.py`'s ladder walk (digest `f30707b66167d2c1`, all five
`TURNOVER_REFUSED`).

---

## The authoritative table

Parsed through `browse.extract` → `run._players`, compared against the trusted
2025 reference, with the gate's own ageing statistic beside it:

| programme | parsed | **newcomers** | share | aged | aged % | title names season |
| --- | --- | --- | --- | --- | --- | --- |
| Vanderbilt W | 26 | **1** | 4% | 13/25 | 52% | yes |
| Miami (FL) W | 31 | **0** | 0% | 1/31 | 3% | yes |
| Virginia W | 28 | **0** | 0% | 20/28 | **71%** | yes |
| **Arkansas W** *(control)* | 28 | **3** | 11% | 4/25 | 16% | **no** |
| **Frostburg State M** *(control)* | 31 | **1** | 3% | 0/30 | 0% | yes |

---

## Why no threshold exists

The newcomer signal does not separate the approved three from the negative
controls. It inverts them.

- **Arkansas**, a designated negative control, has the **most** newcomers of the
  five (3).
- **Miami and Virginia**, two of the three the rule was meant to rescue, have
  **zero**.
- **Vanderbilt (1) and Frostburg (1) are indistinguishable.**

So:

| candidate threshold | admits | violates |
| --- | --- | --- |
| newcomers ≥ 1 | Vanderbilt, **Frostburg** | stop condition 2 |
| newcomers ≥ 3 | **Arkansas** only | stop condition 3, and rescues none of the three |
| newcomers ≥ 0 | everything | stop condition 1 — every stale page |
| share ≥ 4% | Vanderbilt, **Arkansas** | rescues neither Miami nor Virginia |

A rule permissive enough to admit a page with **zero** newcomers is not a
discriminator at all; it is the flipped-season-label acceptance the gate was
built to stop, and it would reopen the 40-of-46 class directly.

**There is no bounded newcomer threshold that satisfies the approval's own
constraints.** The conjunctive framing does not save it either: the conjunction
can only be as strong as its weakest term, and this term carries no signal.

---

## What the pages actually are

The measurement does say something useful, just not what L7ZR claimed.

- **Miami (FL)** — 31 players, 100% of the stored 2025 squad, **1 of 31**
  returners aged. A page titled 2026-27 serving last season's list. The gate is
  correct.
- **Frostburg State** — 31 players, **0 of 30** aged. Same shape.
- **Arkansas** — title names no season, and fails at branch A before turnover is
  reached. Correct.
- **Vanderbilt** — 52% aged, 1 newcomer. Ambiguous, and below the ageing bar.
- **Virginia** — **71% aged**, 0 newcomers. The only programme with real
  positive evidence that the page is a year later than the stored reference:
  twenty of twenty-eight returners have advanced a class. It fails the ageing
  test by four percentage points against a 75% threshold the decision explicitly
  forbids lowering.

Virginia is the single genuine edge case in the set, and the only lever that
reaches it is the one that is locked.

---

## Recommendation

**Implement nothing.** The gate is correct as built for four of these five, and
the fifth cannot be reached without lowering a threshold that is deliberately
where it is.

If Virginia is to be pursued, the honest question is not "how many are new" but
whether **71% aged with a season-naming title and a zero-newcomer roster** is a
recognised state — a programme that has published its returner list for the new
season and not yet added its incoming class. That is a different rule from the
one approved here, it needs its own evidence across a cohort rather than one
school, and it should not be smuggled in under a newcomer discriminator.

Recommended next step is a **cohort study**, not a code change: measure the
ageing distribution across the programmes that *did* acquire cleanly for 2026,
and find out whether 71%-with-zero-newcomers is a real published-returners-only
state or just a stale page with drifting class labels. Until that exists, these
three remain correctly refused.

---

## Containment

No code was changed. No canonical write was made. No acquisition ran.

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `2d694ab74f831491` | `2d694ab74f831491` |
| arrivals freshness | FRESH | FRESH |
| Manifest V6 | `cc28ee6accdb84ed` | `cc28ee6accdb84ed` |

All work ran in a copied pipeline against a scratch `RB_ROOT`; the operator's
sheet directory was not written to. No trust disposition, programme status,
baseline or report pin was touched.

`build_targets.py` was reported here as still deriving membership from
adjacent-season roster files. **That was wrong — retracted by L7ZT.** It takes
membership from the registry export and includes all three never-rostered
programmes when that file is present; the omission I saw was my scratch
environment lacking `_registry_universe.csv`.
