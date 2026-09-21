# L7ZT — structural target universe

**Result: DECISION REQUIRED. No code was changed, because the defect this stage
was approved to fix does not exist. The error was mine, and this is the second
time in three stages.**

L7ZR reported that `build_targets.py` still derives worklist membership from
adjacent-season roster files — the L6 "missing once → never asked again"
failure mode alive in the Python planner. L7ZS repeated it. L7ZT was approved to
fix it. It is already fixed, has been for some time, and is tested.

---

## What the planner actually does

`build_targets.py`, membership line:

```python
keys = sorted(set().union(*[set(p) for p in per.values()], set(REGISTRY)))
# Union, not replacement. The registry decides membership; the roster files
# still supply the candidate URLs for everything they cover.
```

`registry_universe()` reads `_registry_universe.csv`, written by
`npm run roster-targets -- --csv --out …`, and its docstring already states the
exact lesson L7ZT was convened to apply:

> *"The universe used to be `scan()` alone … which makes membership depend on
> already having a roster. A programme absent once is never asked for again …
> the 2025 D3 women's file held 394 schools against 418 in the registry."*

It is also covered by its own tests, among them *"admits an active programme
that has never had a roster"*, *"gives a history-less programme a discovery
method, not an exclusion"*, *"carries the registry division for a programme with
no sheet history"*, and — deliberately — *"behaves exactly as before when no
registry file is present"*.

---

## Proof, by A/B

Same registry, same reference sheets, same state; the only variable is whether
`_registry_universe.csv` is present:

| | rows | Bryn Athyn ×2 + NJCU present |
| --- | --- | --- |
| **without** the export | 1,721 | **0 of 3** |
| **with** the export | 1,763 | **3 of 3** |

And with the export present, **16 of the 16 current NCAA residuals appear in the
generated worklist**, including all three never-rostered programmes. Nothing was
appended by hand.

---

## How I got it wrong

Two compounding mistakes, both mine:

1. My L7ZR scratch environment wrote the registry export to `_targets.csv`
   rather than `_registry_universe.csv`, so `registry_universe()` returned `{}`
   and membership correctly fell back to roster scans — the documented,
   deliberate behaviour for a season with no export yet.

2. **The planner told me.** Its output carries the line
   `0 in the registry universe, 0 of them new to the worklist`. I piped that run
   through `tail -2` and a `grep` that did not match it, and never saw it.

So the fallback was neither silent nor a defect. I removed the evidence and then
reported its absence as a finding. The same shape as L7ZS: an ad-hoc measurement
that was never checked against the thing it was describing.

---

## Should anything be hardened anyway?

I considered making the fallback louder — a warning rather than a count. I am
recommending against it:

- the state is already reported on its own line;
- the fallback is a deliberate, documented, tested contract for seasons with no
  export, and refusing or shouting would put noise in the ordinary path;
- and changing production code to compensate for my having truncated its output
  would encode the wrong lesson.

The planner behaved correctly and said so. The fix belongs in how its output is
read, not in the planner.

---

## The one real finding: the export is stale

`_registry_universe.csv` on disk is dated 2026-09-18 and holds **1,761**
programmes. Today's structural derivation gives **1,755**.

| | |
| --- | --- |
| in the export, no longer active | **6** |
| active now, missing from the export | **0** |
| division changed | 0 |

The six: Southwest Minnesota State M, Anna Maria M, New Jersey City M,
Wisconsin-La Crosse M, Wisconsin-Oshkosh M, Anna Maria College W.

The drift is entirely in the **safe direction** — the planner would attempt six
programmes that are no longer active targets, which costs attempts, not
coverage. No active programme is missing. The planner already reports departures
under *"target(s) left the registry universe"*.

**Action: regenerate the export.** It is one routine command, not a code change:

```bash
npm run roster-targets -- --csv --out "$HOME/Documents/Thriv3/2026 Roster Sheets/_registry_universe.csv"
```

This stage does not run it: the file lives in the operator's sheet directory,
which no stage since L7ZO has written to, and regenerating it changes what the
next acquisition run attempts.

---

## Containment

No code changed. No product data written. No acquisition run.

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `2d694ab74f831491` | `2d694ab74f831491` |
| arrivals freshness | FRESH | FRESH |
| Manifest V6 | `cc28ee6accdb84ed` | `cc28ee6accdb84ed` |

Planner, universe and gap-queue tests: **55 passed**. All work ran in a copied
pipeline under a scratch `RB_ROOT`; the operator's sheet directory was not
written to.

The wrong claim is retracted in place in both `docs/L7ZR_…md` and
`docs/L7ZS_…md` so a later stage cannot inherit it.

---

## Recommendation

Two things are worth more than another planner stage:

1. **Regenerate the registry export**, then re-derive the residual queue so the
   six departed programmes stop being attempted.
2. **Virginia's cohort study**, carried over from L7ZS and still the only open
   question with real product value: whether *71% aged, season named, zero
   newcomers* is a recognised published-returners-only state.

And a note on method for my own part: both L7ZS and L7ZT were approved on
measurements I produced with ad-hoc tooling and never reconciled against the
system's own instruments. Where a pipeline has a parser, a diagnostic script, or
a printed summary, that is the measurement — anything else is a hypothesis about
it.
