# L6D — controlled NCAA roster acquisition: BLOCKED before the run

**No live acquisition was performed.** No source fetched, no sheet written, no
roster row imported, no dataset row altered. P6 unchanged, manifest
`5bbca9054b7752d5` unchanged, all six baselines byte-identical, corpus unmoved
at 1,755 / 2,987.

**Blocker: stop condition 10.** The only supported invocation would attempt
**75 non-NCAA programmes** — NAIA 55, USCAA 20 — which this stage explicitly
forbids, and the pipeline offers no way to scope the acquiring stages.

---

## Containment — stop condition 1 is clear

`npm run roster:acquire` resolves to `tools/roster_pipeline/run_season_current.sh`,
which begins `cd "${0:a:h}"` — its own directory, wherever it lives. The
**versioned copy executes**; the old external tree does not. Verified before
anything else.

## The cohort reproduces exactly

43 NCAA zero-roster rows → 2 inactive → 7 duplicates → **34**.

| division | mens | womens |
|---|---:|---:|
| NCAA D2 | 2 | 5 |
| NCAA D3 | 7 | 20 |

Full inventory with unitid, conference and athletics domain is in the L6 audit;
the cohort is regenerated deterministically by the probe recorded here.

## Pre-run snapshot

| | |
|---|---|
| worklist targets | 2,165 |
| pipeline state | 1,910 `done`, 194 `failed` |
| `roster_players` rows | 276,745 |
| distinct programme-sports with a roster | 2,122 |
| manifest | `5bbca9054b7752d5` |
| corpus | 1,755 personalised / 2,987 generic |
| baselines | all six PASS |

## Why the run cannot proceed as scoped

The runner is state-driven and resumable: it attempts `targets() − done`. With
1,910 done against a 2,165-row worklist, **255 programmes are eligible**:

| division | remaining |
|---|---:|
| NCAA D3 | 144 |
| NCAA D2 | 18 |
| NCAA D1 | 18 |
| **NAIA** | **55** |
| **USCAA** | **20** |

Two problems, and neither is avoidable with the current interface.

**1. Non-NCAA acquisition would be triggered.** 75 of the 255 are NAIA and
USCAA. L6D forbids them, and the deferred-expansion decision is a product one.

**2. Even NCAA-only is not the 34.** 180 NCAA rows are eligible, because the 194
previously-`failed` targets are correctly still eligible for retry — that is the
refreshability guarantee L6B built working as designed. The 34 are a subset of a
larger legitimate retry set.

`run.py` takes only `stage`, `--workers` and `--limit` — **no key or division
filter**. `selector.py` accepts `--keys`, but it is a later stage; starting
there would skip `direct` and `variants` and change how sources are found, which
is not a faithful run. There is no supported way to scope the acquiring stages
to a cohort.

**I did not work around this.** Rewriting `_targets.csv` to contain only the 34
would have scoped the run, and would also have destroyed the registry-membership
guarantee L6B exists to provide — the worklist would once again be a statement
about what we intend to fetch rather than what exists. Adding a filter to
`run.py` is a change to the acquisition path that this stage was not authorised
to make.

## Recommended unblock

Smallest correct change, in the versioned pipeline, testable offline:

- add `--divisions "NCAA D1,NCAA D2,NCAA D3"` and `--keys <file>` to `run.py`
  and `variants.py`, mirroring the `--keys` flag `selector.py` already has;
- filter **which targets a stage attempts**, never which targets exist;
- cover it with the existing network-free fixture harness.

That preserves the L6B guarantee — membership stays registry-derived; only this
run's attempt set narrows — and it makes every future stage able to say exactly
what it touched. It is a prerequisite for any controlled acquisition, not just
this one.

With that in place, L6D runs in two steps: NCAA-only retry of the 180 eligible
rows, of which the 34 are the coverage-relevant subset; or `--keys` scoped to
exactly the 34 if a tighter first run is preferred.

## External copy status

**STILL_REQUIRED_FOR_STATE.** Code authority has moved, but `state.py` hardcodes
`~/Documents/Thriv3/<season> Roster Sheets/_state` and the fetch cache remains at
`~/Library/Caches/recruitmatch-rb`. Only `build_targets.py` was routed through
`paths.py` in L6C. Before the old tree can be archived, `state.py`'s three path
sites and the cache location need the same `RB_ROOT` treatment — a small,
behaviour-preserving change, and the natural companion to the filter above.

Nothing was deleted.

## Unchanged

P6 · manifest `5bbca9054b7752d5` · six baselines PASS · corpus 1,755 / 2,987 ·
276,745 roster rows · 2,122 programme-sports. Coverage remains D1 100%,
D2 97.9%, D3 95.5%, **NCAA 97.6%**, with 34 legitimate active gaps, 7
duplicates and 2 inactive rows.
