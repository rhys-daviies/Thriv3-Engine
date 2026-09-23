# L7ZR — NCAA residual closure

**Result: DECISION REQUIRED. No canonical write was made, and none should be
until one locked gate question is answered.**

The residual set was re-derived from current data, every one of the sixteen was
re-attempted live through the existing pipeline, and the outcome is not "the
sources are missing". Ten of the sixteen have a reachable official page today.
What stops them is a deliberate acquisition gate whose rationale is documented,
evidence-backed, and — on this evidence — too strict for at least three of them.

The brief's own condition applies: *"Do not fix verify_gate unless one exact
current NCAA residual proves it is the only safe blocker and STOP for approval
first."* That condition is met. This is the stop.

---

## The universe, re-derived

`rosterTargetUniverse.js` applies `programmeStatus.activeForSeason`:

| | |
| --- | --- |
| active NCAA programmes for 2026 | **1,755** |
| with a 2026 roster | **1,732** — 98.7% |
| registry duplicates | 7 — a registry job, not an acquisition one |
| genuine residuals | **16** |
| reconciles | 1,732 + 7 + 16 = 1,755 ✓ |

**L7ZP's 1,761 / 29-missing was wrong.** That came from my own ad-hoc
`colleges WHERE division LIKE 'NCAA%' AND active = 1`, which is a weaker
criterion than the status contract. The brief was right not to inherit it.

Of the 16: 13 historical-only, 3 never rostered. Historical coverage across all
seasons is 1,745 / 1,755 = 99.4%, which is not a 2026 number and is not the
target.

---

## The sixteen, freshly diagnosed

Every one re-attempted through `run_season_current.sh` — direct, variants,
selector and browser stages — in an isolated environment: a copied pipeline with
no stale stage files, a scratch `RB_ROOT`, and the 2025 reference sheets. Scope
held: **0 out-of-scope records absorbed** at every stage.

| classification | n | programmes |
| --- | --- | --- |
| **TURNOVER_REFUSED** | 5 | Arkansas W, Miami (FL) W, Vanderbilt W, Virginia W, Frostburg State M |
| **PAGE_PRIOR_SEASON** | 5 | Eastern New Mexico M, San Francisco State M, Montevallo W, SCAD M, CUNY York W |
| **PARSE_ZERO** | 2 | Bradley M, George Mason M |
| **NO_CANDIDATE** | 3 | Bryn Athyn M, Bryn Athyn College of the New Church W, New Jersey City University W |
| **SITE_UNREACHABLE** | 1 | University of Valley Forge W (`fetch ConnectionError`) |

The stale counts carried in from an earlier stage (TURNOVER_REFUSED 5,
PARSE_ZERO 2, SITE_UNREACHABLE 2) were close on two categories and wrong on the
rest. Re-derivation was the right instruction.

**Acquired this stage: 0.** Every stage ran; nothing passed.

---

## The blocker, and why it is not simply wrong

`run.py` in CURRENT mode:

```
# A site can flip its season label and URL before it swaps the roster content,
# and 40 of 46 stale 2026 pages passed on exactly that: the page said 2026
# while serving the 2025 squad. Self-declared metadata is not evidence that
# the underlying data changed.
```

So a page naming 2026 is admitted only if its returners have also **aged**:
`RETURNER_AGED_MIN = 0.75`, `RETURNER_AGED_COUNT = 3`,
`RETURNER_COMPARABLE_MIN = 4`. Two independent readings of the same page must
agree. That is good design and it demonstrably caught 40 real failures.

---

## What the live pages actually contain

> ## ⚠ RETRACTED BY L7ZS — THE NEWCOMER COUNTS BELOW ARE WRONG
>
> The "new players" column in this section was produced by counting
> `a[href*="/roster/"]` anchors in a headless browser and differencing them
> against stored names. That anchor set includes **coaching and support staff**
> and other roster links, and it was never validated against the pipeline's own
> parser.
>
> Measured with `lib.parse_any` + `run._players` — the same parse and staff
> filter the gate uses — through the pipeline's **own browser path**:
>
> | programme | parsed | **newcomers** | reported below |
> | --- | --- | --- | --- |
> | Vanderbilt W | 26 | **1** | 12 ✗ |
> | Miami (FL) W | 31 | **0** | 15 ✗ |
> | Virginia W | 28 | **0** | 10 ✗ |
>
> The conclusion drawn from these numbers — that a newcomer discriminator would
> resolve three residuals — **does not hold**. See
> `docs/L7ZS_NEW_PLAYER_TURNOVER_DISCRIMINATOR.md`. The rest of this document
> (universe derivation, classification, containment) stands.



Measured directly with the pipeline's own browser, against the stored seasons:

| programme | live | 2025 overlap | 2024 overlap | **new players** | page title | aged |
| --- | --- | --- | --- | --- | --- | --- |
| Vanderbilt W | 37 | 25 / 26 | 6 / 27 | **12** | Soccer **2026-27** | 13/25 = 52% |
| Miami (FL) W | 46 | 31 / 31 | 7 / 29 | **15** | Soccer **2026-27** | 1/31 = 3% |
| Virginia W | 38 | 28 / 28 | 0 | **10** | Women's Soccer **2026-27** | 20/28 = **71%** |
| Arkansas W | 28 | 25 / 27 | 11 / 35 | **3** | *(no season in title)* | n/a |
| Frostburg State M | 32 | 30 / 41 | 11 / 34 | **2** | **2026** Men's Soccer Roster | 0/30 = 0% |

The first three are, on the evidence, genuine 2026-27 rosters:

- the squad **grew** (26→37, 31→46, 28→38)
- each carries **10–15 players absent from the stored 2025 squad** and absent
  from 2024
- the low 2024 overlap confirms the stored 2025 is a real, distinct season, so
  this is not the L7ZG mis-capture pattern

A page serving last season back has **zero** new names. These have ten to
fifteen.

Virginia fails the aged test at **71% against a 75% threshold** — four
percentage points.

Frostburg (0/30 aged, 2 new) and Arkansas (title names no season, 3 new) are
materially weaker and should not ride on the same decision.

---

## The decision this stage cannot take

The gate uses two signals: *how many names repeat*, and *whether returners
aged*. Both are readings of the returning cohort. **Neither looks at the
players who are new.**

That is the gap. "The page contains N players who were not in the reference
season" is independent of both existing signals, and it is exactly what a
stale page cannot fake — the 40-of-46 stale pages would still be refused,
because a re-served squad has no new names.

**Proposed, NOT implemented:** admit a CURRENT-mode page that names the season
when it also carries a meaningful count of players absent from the reference —
a third independent reading, alongside the existing aged test rather than
replacing it or lowering its threshold.

This is a locked acquisition gate. The brief requires a stop, and this is it.
Three residuals (Vanderbilt, Miami, Virginia) would resolve under the proposal;
Frostburg and Arkansas would still need their own answer.

---

## The other eleven

- **PAGE_PRIOR_SEASON (5)** — the page served at the 2026 path names an earlier
  season. This is the gate working correctly; the 2026 page is not published at
  that route. Eastern New Mexico and San Francisco State are the two programmes
  carrying L7ZG trust records, untouched here.
- **PARSE_ZERO (2)** — Bradley and George Mason both sit on legacy
  `roster.aspx?rp_id=NNNN` routes. The year-swapped form returns HTTP 200 with a
  36-byte body: a soft 404. No 2026 roster is published at the known route, and
  the correct modern route was not discovered.
- **NO_CANDIDATE (3)** — the three never-rostered programmes. Two have a
  verified host (`brynathynathletics.com`) and no working route; NJCU has
  **no trusted host at all**.
- **SITE_UNREACHABLE (1)** — University of Valley Forge, `ConnectionError`.
  Temporary or terminal is not yet distinguishable.

---

## A pipeline defect found in passing — ⚠ RETRACTED BY L7ZT

> **This section was wrong.** `build_targets.py` already takes membership from
> the registry: `keys = union(roster scans, REGISTRY)`, reading
> `_registry_universe.csv`, with the L6 reasoning written out in
> `registry_universe()` and pinned by its own tests — including one for the
> no-export fallback.
>
> I saw the fallback because my scratch environment never contained
> `_registry_universe.csv`, and the planner's output says **"0 in the registry
> universe"** on exactly that line, which I truncated away with `tail -2`.
> Proven by A/B: without the export 1,721 rows and 0 of the three never-rostered
> programmes; with it 1,763 rows and all 3 — and 16/16 current residuals present.
>
> No planner change is required. See `docs/L7ZT_STRUCTURAL_TARGET_UNIVERSE.md`.

`build_targets.py` still derives worklist membership from the **roster files of
adjacent seasons**, so the three never-rostered programmes did not appear in the
worklist at all until I appended them from the registry. `rosterTargetUniverse.js`
was written precisely to end that ("the REGISTRY decides WHO must be
considered"), but the Python planner has not been moved onto it.

That is the L6 blind spot alive in a second place: a programme absent once is
never asked for again. Not fixed here — it is a pipeline change, not a residual.

---

## Containment

No canonical write was attempted or made.

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `2d694ab74f831491` | `2d694ab74f831491` |
| arrivals freshness | FRESH | FRESH |
| Manifest V6 | `cc28ee6accdb84ed` | `cc28ee6accdb84ed` |

The operator's real sheet directory was not written to — the run used a scratch
`RB_ROOT`. No trust disposition, no programme status, no baseline or report pin
was touched.

---

## Foundation assessment

**FOUNDATION_NOT_COMPLETE**, and deliberately so rather than by percentage.

Coverage is 1,732 / 1,755 = **98.7%**. The question the brief poses is whether
every *recoverable* current roster is acquired or explicitly bounded. It is not:
**three residuals have a reachable, published, correctly-seasoned 2026 page
today** and are held only by a gate whose change requires approval. They are
recoverable, identified, and blocked on one decision — not on a missing source
and not on a missing capability.

The other thirteen are bounded with specific reasons above.
