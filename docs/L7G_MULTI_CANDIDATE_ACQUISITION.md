# L7G — a ranked list of hypotheses, walked in order

L7F lost Southwest Minnesota State to an architecture rather than to the web:
the generator ranked 24 candidates, the roster was the tenth, and the worklist
carried one. This stage connected the ranking to the acquirer.

**The ladder works and is proven.** It reached SMSU's candidate seven, fetched
it, and every gate refused what came back — because the page is not SMSU men's
soccer. **SMSU is not acquirable**, and L7E's readiness report was wrong about
it for a reason worth more than the row.

No data changed anywhere: no import, no manifest movement, no repin, P6 unchanged.

---

## 1. The root cause, and the distinction that fixes it

Two different operations had been collapsed into one.

| | |
|---|---|
| **ladder** | the same page, addressed differently — `/roster` → `/roster/2026` → `/roster/season/2026` |
| **candidate** | a different hypothesis about where the roster lives, from the shape catalogue |

Transforming candidate one never reaches candidate ten's shape family. The list
became a single URL at `rosterCandidatePlan.js --csv`, which wrote
`p.candidates[0].url` and nothing else; `_registry_candidates.csv`,
`_targets.csv` and `variants.work()` then each carried one.

## 2. How often it matters

Across the **1,605** NCAA roster URLs known to be real, **1,601 are reproduced
somewhere in the generated ranking**:

| ordinal | n | cumulative |
|---:|---:|---:|
| 1 | 1,474 | 92.1% |
| 2 | 14 | 92.9% |
| 4 | 32 | 94.9% |
| 5 | 45 | 97.8% |
| 7–9 | 14 | 98.6% |
| 10 | 5 | **98.9%** |
| 11–13 | 14 | 99.8% |
| 16 | 3 | 100.0% |

**92.1% win at candidate one** — which is why the single-candidate design
survived this long — and **7.9%, about 127 programmes, do not.** SMSU is not an
edge case.

**Bound: 16**, the observed maximum. Not a guess and not the whole catalogue;
nothing beyond sixteen has ever won. The remaining eight entries stay catalogued
and are not attempted. Raising it is one constant if a new shape appears.

## 3. What changed

`shared/roster/rosterCandidates.js` — `MAX_ATTEMPTED_CANDIDATES = 16`, with the
measurement above written beside it.

`rosterCandidatePlan.js --csv` — emits `Candidates`, the ordered list, alongside
`Candidate`, which stays as the first so nothing reading one URL breaks.

`build_targets.py` — carries the list into a new `Generated Candidates` column.
**Every candidate goes through the same `swap()` normalisation as the first**,
which is L7C's lesson: a raw Presto candidate kept `?view=table` and the ladder
appended a season to the query. Normalisation also deduplicates — SMSU's 16
collapse to 9 distinct URLs.

`variants.py` — `attempt_urls(row)` is the new seam:

```python
gen = row['Generated Candidates'].split('|')
if not gen:
    return [(0, u) for u in ladder(row['_cand'], row[REFCOL])]   # unchanged
for ordinal, cand in enumerate(gen[:MAX_CANDIDATES], 1):
    for u in ladder(cand, ''):                                    # each still laddered
        yield ordinal, u
```

Candidates outer, ladder inner. Every URL still faces `run.evaluate`, the season
check, the turnover gate, the parser and the ≥5-row floor, unchanged.

### Precedence, unchanged

1. **known-good historical URL** — a row with one carries no generated list and
   walks its own ladder exactly as before
2. **hand repair** — `repairs()` keeps its own Method and its own single URL;
   `GENERATED_METHODS` still separates the two, so a rebuild can replace a
   generated candidate and can never overwrite a human one
3. **generated ranking** — only when there was no URL to transform

A generated candidate never reaches the known-good column, however many there
are. A hypothesis is not an observation.

### Stop on success

The first candidate that passes every gate ends the walk; nothing lower is
fetched. The winning ordinal is recorded on the state entry as `candidate`, so a
resolved roster stays traceable to the hypothesis that produced it — runtime
diagnostics rather than schema, which is all correctness needs here.

### Failure semantics

Walking a ranking means most entries are 404s on shapes a host does not use, and
`err = tried[-1]` would report whichever wrong guess came last — burying a
turnover rejection from candidate one behind a 404 from candidate sixteen.

`summarise()` now ranks: a **content** failure (turnover, season, parse, too few
rows — the page was served and refused) is reported ahead of any number of
**route** failures (nothing was served), with the route count appended. That is
how this stage learned what was actually wrong with SMSU.

**Identity cannot drift while walking.** Every candidate is generated for one
host whose identity was established before any URL existed, so progression
cannot wander to another institution. Asserted, not assumed.

## 4. SMSU

```
TO ATTEMPT 1 · write set: ncaa_d2_mens only · USCAA: NO · NAIA: NO
snapshot: VACUUM INTO, integrity ok, 277,360 = 277,360
npm run roster:acquire -- 2026 2025 --keys /tmp/l7g-smsu.txt
```

The ladder reached candidate 7 of 9 —
`smsumustangs.com/sports/msoc/roster/season/2026`, the URL L7F could not reach —
fetched it, and the parser returned zero players. The new summary said why:

```
too few players parsed (0)   (+21 route failures across the candidate ranking)
```

**The page is `Sonya Smith - Women's Soccer - SMSU Athletics`.** A women's bio,
served at a men's soccer path. `/sports/msoc` on the same host returns a
football event page. This site's `.aspx` routing answers men's-soccer paths with
whatever its CMS resolves.

**Result: `SOFT_404`.** Not resolved, and correctly not resolved. No roster row,
no sheet change, no import — every sheet byte-identical, state unchanged, 0
entries moved.

### The report that was wrong

L7E classified SMSU `200_ROSTER` and L7F carried it into the ready cohort. The
verifier checked HTTP 200, the right host, a roster-shaped path and 82 roster
markers — and never checked the **sport on the page**. The markers were no
defence: a site's navigation carries roster markup on every page it serves.

`sportContradicted()` now refuses a page whose own title names the other
gender's programme and not its own. A page naming both is accepted, because a
roster's navigation legitimately lists every programme the school fields. Run
again under the guard, SMSU reports **404 on all 24** — no candidate serves a
men's soccer roster on that host.

**Nothing wrong was ever imported.** The production gates refused the page in
L7F and again here; it was only the readiness report that was optimistic. Every
source URL from L7E and L7F was re-checked against its programme's sport:
**11 of 11 correct, 0 wrong-sport.**

## 5. State after

| | |
|---|---|
| NCAA coverage | **1,743**, unchanged |
| legitimate active gaps | **11**, unchanged |
| roster rows | 277,360, unchanged |
| manifest | `fe23cac71c83ec0e`, **UNCHANGED** |
| six baselines | **all PASS**, nothing repinned |
| P6 | unchanged |
| pairs affected / new emails | 0 / 0 — no BAD, because none exists |

SMSU moves from `ACQUISITION_FAILED` to **`SOURCE_NOT_AVAILABLE`**: its roster
is not addressable through the catalogue on that host, which is a different
statement from "we failed to try".

Residual eleven, reproduced from data: 2 site-temporarily-unavailable (Anna
Maria), 2 client-render (Northwood, Wisconsin-Oshkosh), **3** source-not-available
(Bryn Athyn ×2, **SMSU**), 2 programme-status-question (New Jersey City ×2), 1
manual review (Wisconsin-La Crosse), 1 no-trusted-host (Trinity Washington).

## 6. Debt

**`BASE_ONLY` in the strict profile** — the trusted set is exactly the seven
known-wrong rows since L7E repaired Regis, and all seven are already quarantined
downstream by `registryIntegrity` or the unitid comparison. Removing the class
from STRICT now has **zero product effect**, confirmed and not implemented here.

**`verified: true`** — no new caller. Multi-candidate execution introduces no
new assertion site: `candidatesForLookup` still derives it from an authority
lookup. Contained, recorded.

**The verifier is a report, not a gate.** L7G found it optimistic twice over —
first about shapes, now about sport. The production gates caught both. Worth
remembering which of the two is load-bearing.

## 7. Next

The ladder is in place and unused: every remaining gap fails for a reason the
ladder cannot fix. The cheapest real win is Anna Maria's two, which need only
their site out of maintenance, and the two client-render cases, which need the
browser stage rather than more URLs.
