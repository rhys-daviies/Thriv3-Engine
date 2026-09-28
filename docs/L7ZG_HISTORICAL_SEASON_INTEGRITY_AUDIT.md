# L7ZG — historical season integrity audit

**Two programme-seasons out of 6,844 are probable duplicate captures. Nothing
else is.** The population is healthy; the two L7ZF found are the whole of it.

And one thing that is not about history at all: **the current pipeline can still
store a season on no evidence**, in one narrow case. That is reported as a
blocker, not repaired.

No data moved. Audit only.

Starting SHA `a71814c` (L7ZF).

---

## How a historical row got its season

Traced through code, not inferred.

| step | who decides | what it is |
|---|---|---|
| requested season | `RB_SEASON` env var | what the run was asked for |
| page-established season | `lib.season_ok(title)` | **True**, **False**, or **None** |
| acceptance | `run.evaluate` | refuses on `False` only |
| sheet | `write_out.py` | no season column at all |
| import season | `--season` CLI argument | `const SEASON = String(season)` |
| DB season | that argument, verbatim | never read from the page |

**The DB season is the operator's request, start to finish.** No column in the
sheet carries a season, and `recordsFromFile` stamps every row with the CLI
value. The only thing that ever connects a row to a page's own season is
`season_ok`, three layers upstream, at acquisition time.

`season_ok` is deliberately three-valued:

```python
if re.search(rf'\b{season}\b|{season}-{nxt%100:02d}|...', t): return True
for other in (season-2, season-1, nxt, season+2, season+3):
    if re.search(...): return False
return None
```

`evaluate` refuses only on `False`. **`None` falls through** — a page whose
title names no season cannot contradict the request, so the request stands.
That is the legacy hole and it is still open; what changed between the legacy
and hardened eras is the turnover gate that now stands behind it, and the
`run_season_current.sh` header says so explicitly: *"a page need not name its
season; it must instead show a turned-over squad"*.

---

## The audit universe

NCAA, 2022–2025, identities that actually join (`college_name = colleges.name`
for the sport — a row that fails that is invisible to every consumer).

| | |
|---|---|
| programme-seasons | **6,844** |
| programmes | **1,720** |
| rows | **206,282** |
| by season | 2022: 1,709 · 2023: 1,700 · 2024: 1,715 · 2025: 1,720 |
| by sport | men's 2,890 · women's 3,954 |
| by division | D1 2,226 · D2 1,817 · D3 2,801 |

---

## Source route inventory

Shape only. An explicit season path is **not** thereby trusted — L7ZF showed
seven sites serving a fallback for any season segment, and two of them appear
below for exactly that reason.

| class | programme-seasons | rows |
|---|---|---|
| **A** EXPLICIT_SEASON_PATH | 6,440 | 194,746 |
| **B** EXPLICIT_SEASON_QUERY_OR_ARCHIVE | 318 | 9,024 |
| **C** BARE_CURRENT_ROUTE | **82** | 2,412 |
| **D** PLAYER_BIO_OR_NON_ROSTER | 0 | 0 |
| **E** UNKNOWN_OR_MISSING | 1 | 26 |
| **F** OTHER | 3 | 74 |

The bare-current route is **entirely confined to 2025**:

| season | bare-route programme-seasons |
|---|---|
| 2022 | 0 of 1,709 |
| 2023 | 0 of 1,700 |
| 2024 | 0 of 1,715 |
| **2025** | **82 of 1,720 (4.8%)** |

That shape is the current-season acquisition path, and 2025 is the only season
in the window ever acquired as a current season. The three backfilled seasons
were taken from explicit season URLs throughout.

Five programme-seasons carry an A/B URL naming a **different** season from the
one they are stored under. All five are Clemson. They are dealt with below, and
they are not what they first look like.

---

## Provenance availability

| | rows |
|---|---|
| `source_page_season` known | **0** of 206,282 |
| `source_fetched_at` known | **0** |
| `source_parser` known | **0** |

L7Z was deliberately not backfilled — unknown stays unknown — and this is the
binding constraint on the whole audit. **Not one historical row can be asked
what season its page claimed.** Every conclusion below is therefore inference
from route shape, squad resemblance and dated archive anchors, and is stated as
such.

---

## Overlap distribution

Normalised player-name sets, the pipeline's own key, over 5,114 adjacent
programme-season pairs.

| forward overlap (`|A∩B| / |B|`) | pairs |
|---|---|
| < 0.50 | 925 |
| 0.50 – < 0.70 | 3,108 |
| 0.70 – < 0.85 | 1,032 |
| **≥ 0.85** | **49** |
| exact player-set equality | **1** |

The distribution is a healthy one: the mode is 50–70%, which is what a squad
that graduates a quarter and recruits a quarter looks like. Forty-nine pairs
sit at or above the turnover gate — **0.96% of the population**.

Those 49, broken down:

| | |
|---|---|
| by transition | 2022→2023: 19 · 2023→2024: 19 · 2024→2025: 11 |
| by division | D3 26 · D2 12 · D1 11 |
| by sport | women's 39 · men's 10 |
| by route of the later season | A 46 · C 2 · B 1 |

**46 of the 49 came from an explicit season URL.** They are programmes that
kept their squad, which is a thing programmes do.

---

## Source reuse

The measurement that separates a retained squad from a repeated capture.

| among the 49 pairs at ≥ 0.85 | count |
|---|---|
| both seasons from **distinct explicit season URLs** | **46** |
| both seasons from the **same bare current route** | 0 |
| both seasons from the **same exact URL** | 0 |
| later season from a bare current route | **2** |
| either season missing a source URL | 0 |

Two independent official season-specific pages agreeing that a squad returned
is evidence *for* the data, not against it. The two exceptions are the two
L7ZF found.

---

## The classification contract

Six classes, and the rule that governs all of them: **neither signal decides
alone.**

- **A_VERIFIED_DISTINCT** — overlap below the gate, and something asserts the
  season (provenance, or a season-bearing route).
- **B_HIGH_OVERLAP_BUT_PLAUSIBLE** — overlap at or above the gate, but
  season-specific source evidence supports both seasons.
- **C_SEASON_IDENTITY_UNPROVEN** — the stored season exists and nothing
  surviving can establish it. *Not a claim that it is wrong.*
- **D_PROBABLE_DUPLICATE_CAPTURE** — resemblance **and** absence of season
  evidence, together.
- **E_DEFINITE_MISMATCH** — surviving evidence names another season **and** the
  rows corroborate it by resembling that season.
- **F_UNRESOLVABLE_LEGACY** — not even a source URL survives.

| class | pairs |
|---|---|
| A_VERIFIED_DISTINCT | **4,980** |
| B_HIGH_OVERLAP_BUT_PLAUSIBLE | **47** |
| C_SEASON_IDENTITY_UNPROVEN | **85** |
| D_PROBABLE_DUPLICATE_CAPTURE | **2** |
| E_DEFINITE_MISMATCH | **0** |
| F_UNRESOLVABLE_LEGACY | **0** |

The 85 unproven are the 82 bare-route 2025 seasons plus 3 Clemson pairs. They
are *unproven*, not *wrong* — the distinction the brief insisted on and the one
this audit exists to hold.

### The correction this audit made to itself

The first draft classified every URL/season disagreement as
`E_DEFINITE_MISMATCH` and reported **five, all Clemson**. That was wrong for
the mirror-image reason the brief warned about for overlap: it convicted from a
single signal.

Three pieces of evidence cleared Clemson:

1. **Its stored seasons decay normally.** Men's 2022→2023 55%, 2023→2024 68%,
   2024→2025 52%, and falling with distance (2022 vs 2025: 17%). A shifted or
   duplicated chain repeats; it does not decay.
2. **Two of its seasons are anchored to dated Wayback captures** —
   `20241007161208` and `20251127211131`. An archive timestamp is the one piece
   of season evidence a site cannot retroactively revise, and both sit exactly
   where they are stored. A control query confirmed the index was answering:
   four Clemson captures returned for Aug 2024 – Jan 2025, including that exact
   timestamp.
3. **Clemson women's 2024 and 2025 carry the same `season/2025` URL** while
   holding squads that overlap only 57%. One of those two URL records must be
   wrong — which is direct evidence that the *URL field* is the unreliable one
   here, not the season label.

Bounded live verification (three official Clemson pages, no third party) showed
`season/2023` now titled "2023-24", `season/2024` as "2024-25",
`season/2025` as "2025-26". So the recorded URLs disagree with the stored
labels today. Against that sit a normal decay curve and two immutable archive
anchors. **The honest verdict is C: the URL record is unreliable for this
programme, and the season labels are unproven rather than wrong.**

Separately, **117 of the 122 programme-seasons on the `/roster/season/<N>`
route have `N` equal to the stored season.** Only Clemson's five differ, which
makes this a per-programme record defect rather than a convention the audit
mis-read.

---

## Eastern New Mexico — `D_PROBABLE_DUPLICATE_CAPTURE`

| | |
|---|---|
| stored 2024 | 32 players, `.../mens-soccer/roster/2024` (A) |
| stored 2025 | 32 players, `.../mens-soccer/roster` (**C, bare**) |
| forward overlap 2024→2025 | **100%** |
| exact player-set equality | **YES** |
| L7Z provenance | none |
| live page today | titled **"2024 Men's Soccer Roster"**, n=32 |
| our 2024 vs live | **100%** · our 2025 vs live | **100%** |

The decisive structural fact, from L7ZF: **the site ignores the season segment
entirely.** `/roster`, `/roster/2024`, `/roster/2025` and `/roster/2026` all
return the same 2024 page. So for this host even an A-class URL asserts
nothing, and the two stored seasons cannot be told apart by any surviving
evidence.

One wrinkle recorded rather than resolved: the 2024 rows' acquisition note says
*"2025 name overlap 0%"*, meaning that when 2024 was captured the 2025 sheet
was a **different** squad. The 2025 rows were imported two days later, and
their note has since been overwritten by the minutes backfill. Something
replaced a distinct 2025 squad with a bare-route capture; the surviving state
cannot say what.

## San Francisco State — `D_PROBABLE_DUPLICATE_CAPTURE`

| | |
|---|---|
| stored 2024 | 30 players, `.../mens-soccer/roster/2024` (A) |
| stored 2025 | 30 players, `.../mens-soccer/roster` (**C, bare**) |
| forward overlap 2024→2025 | **93.3%** |
| exact player-set equality | no (28 of 30 shared) |
| L7Z provenance | none |
| live page today | titled **"2024 Men's Soccer Roster"**, n=30 |
| our 2024 vs live | **100%** · our 2025 vs live | **93.3%** |

Same host behaviour, same shape, slightly less extreme. The 2024 rows' note
records *"2025 name overlap 93%"* — consistent throughout, unlike ENMU.

### Why these two and nothing else

They are the only pairs in 5,114 where a resemblance at or above the gate
coincides with a later season whose route asserts no season and whose
provenance is absent. Every other high-overlap pair has two distinct official
season URLs behind it.

---

## Evidence and pool exposure

| | |
|---|---|
| suspect programme-seasons | **2**, both inside the 2022–2025 window |
| rows | 62 (32 + 30) |
| canonical athlete-programme pairs touching a suspect programme | **6** |

Every roster-derived kind reads the same `ROSTER_COLUMNS` projection through
`philosophyQueries`, so the exposed kinds are the philosophy family —
`PROGRAMME_POOL_BENCHMARK`, `FRESHMAN_MINUTES_LADDER`,
`PROGRAMME_DEVELOPMENT_PATTERN`, `ATHLETE_COHORT_LADDER`,
`POSITION_INTAKE_HISTORY`, `POSITION_GROUP_SIZE`, `INTERNATIONAL_ROSTER` — for
those two programmes only.

### Pool, measured on a rolled-back transaction

Deleting both suspect programme-seasons and rebuilding:

| | before | after |
|---|---|---|
| men's rank-1 `n` | 770 | **770** |
| men's rank-1 p25 / **median** / p75 | 901 / **1118** / 1289 | 901 / **1119** / 1289 |
| men's ranks 2–6 | — | **unchanged** |
| women's, all ranks | — | **unchanged** |

**One minute, on one threshold, in one sport.** Both programmes still
contribute a rank-1 median from their other seasons, so `n` does not move at
all. Boundary sensitivity: 3 programmes sit at exactly 1118 and 2 at exactly
1119, so a 1118→1119 median would reclassify at most the two at 1119, moving
them from `median-to-p75` into `p25-to-median`.

The transaction was rolled back and the live pool re-read to confirm it
returned to its pre-transaction values.

---

## Manifest behaviour

The same rolled-back deletion, measured against `datasetManifest()`:

| | |
|---|---|
| manifest before | V4 `7d256f519c130dd6` |
| manifest after a simulated repair | **`5f61edd09e3b4c14`** |
| verdict | **MOVES** |
| components moved | `roster_players` 281,159 → 281,097 · `roster_measurements` 281,159 → 281,097 |

**No blind spot.** L7ZB's V4 sees both the membership change and the
measurement change, so a future repair cannot land silently.

---

## Repairability

A repair source must establish the **exact historical season**. A current bare
route is not one — that is the defect, not the cure.

| | |
|---|---|
| REPAIR_SOURCE_AVAILABLE | **0** |
| REPAIR_SOURCE_NOT_AVAILABLE | **2** — Eastern New Mexico M 2025 · San Francisco State M 2025 |
| REQUIRES_HUMAN_REVIEW | 0 for sourcing; **2 for disposition** |

Both sites serve only 2024 at every route, so the live web cannot establish
2025. The archive cannot either: bounded `cdx` queries returned **0 captures
for either host in the 2025 season window (Aug 2025 – Jan 2026)**, against a
control that returned 4 Clemson captures for the equivalent 2024 window — so
the index was answering, and the absence is real. Both hosts do have captures
all-time (ENMU 5, SFSU 8), none of them in the window that matters.

So there is no automated repair. **What to do with two unsourceable
programme-seasons — leave, flag, or remove — is an operator decision**, and
this stage does not make it.

---

## Scale

**Isolated legacy contamination.** Not a bounded cohort, and not systemic.

- 2 probable duplicates in 6,844 programme-seasons — **0.03%**
- Both share one signature: a 2025 current-season capture from a bare route on
  a host that ignores season segments
- The 82 bare-route programme-seasons are the population at risk, and 80 of
  them show ordinary turnover
- The three backfilled seasons used explicit season URLs throughout and
  contribute **zero** candidates

The pool effect of the whole finding is one minute on one threshold.

---

## Future ingestion safety — **the blocker**

Seven scenarios against the current hardened gate, season 2026, CURRENT mode.

| # | scenario | `season_ok` | accepted | why |
|---|---|---|---|---|
| 1 | bare route serving the prior season (2025) | `False` | **refused** | page names another season |
| 2 | explicit wrong season (2024) | `False` | **refused** | same |
| 3 | untitled roster, squad turned over | `None` | **ACCEPTED** | by design — turnover is the substitute proof |
| 4 | redirect to current (title 2025) | `False` | **refused** | same as 1 |
| 5 | untitled roster, squad repeats 100% | `None` | **refused** | turnover gate |
| 6 | wrong season named, **no reference squad** | `False` | **refused** | the season guard does not need a reference |
| 7 | **untitled roster, no reference squad** | `None` | **ACCEPTED** | ← **nothing applied** |

**Verdict: the pipeline cannot recreate the shape this audit investigated** — a
page naming a different season is refused in every form, with or without a
reference. Case 3 is documented, deliberate design.

**Case 7 is a real hole.** `overlap()` returns `None` when the programme has no
prior-season squad on file, and `evaluate` guards the turnover test with
`if ov is not None`. So a **first-ever acquisition of a programme, from a page
that names no season, is accepted on no season evidence at all** — the note it
records is the empty string, which is an accurate summary of what was checked.

Exposure, measured: 1,730 of 6,844 historical programme-seasons had no prior
season on file, but 1,709 of those are 2022 — the first season in the window,
where nothing earlier can exist by construction. The genuinely exposed set is
**21**: 2023 (1), 2024 (15), 2025 (5).

Narrow, but it is stop condition 10, so it is reported as a blocker and
**nothing was changed to close it** — that is a decision, and it needs its own
stage.

---

## Nothing moved

| artifact | before | after |
|---|---|---|
| `roster_players` | 281,159 `9281abaf1826f897` | **identical** |
| `programme_status` | 6 `4e84caabfc568577` | **identical** |
| `colleges` | 2,404 `b558769138b04ee3` | **identical** |
| `athletics_domains` | 2,723 `3a3d9871d7b3cc88` | **identical** |
| `roster_gap_reviews` | 7 `0ff82ba6889a11df` | **identical** |
| sheets / state / targets / stage files | `a00a9e3052679779` / `c65b4bcc6245a5ab` / `369a9f40cbd274cc` / `c65b4bcc6245a5ab` | **identical** |

Coverage 1,748 / 1,732 / 16 / 13 / 3 · **99.1%**. Manifest V4
`7d256f519c130dd6`, no repin. All six baselines PASS, no repin. P6 unchanged.

---

## Unexpected findings

**An explicit season URL is not evidence when the host ignores the season
segment.** This is the generalisable lesson and it undercuts the obvious
heuristic. ENMU and SFSU return the identical page for `/roster`,
`/roster/2024`, `/roster/2025` and `/roster/2026`. Every one of their A-class
URLs looks like proof and asserts nothing. Route shape is a *filter*, never a
*verdict* — which is why the classifier requires corroboration on both sides.

**The audit convicted the wrong five before it convicted the right two.** The
first pass reported `E_DEFINITE_MISMATCH: 3` plus `D: 2` and named Clemson in
three of them. Clemson's overlaps are 55–76%: not a duplicate signature at all.
The classifier had been written to guard against convicting from overlap alone
and then convicted from URL alone. Both corrections are now pinned by tests.

**The one exact-duplicate pair in the entire population is Eastern New
Mexico.** 6,844 programme-seasons, 5,114 adjacent pairs, and exactly one pair
where the two squads are the same set of names. That is a strong statement
about how healthy the rest of the data is.

**The bare-current route exists only in 2025** — 82 programme-seasons, 4.8% of
that season, zero in the three backfilled seasons. The hazard is confined to
the one season acquired as a current season, which is also the season whose
pages have since rolled forward and can no longer be re-read.

---

## Recommended next action

**L7ZH — close the no-evidence acceptance path**, scoped to case 7 and nothing
else. When `overlap` is `None` *and* `season_ok` is `None`, the current gate
applies no season test whatsoever and accepts. The smallest correct change is
to fail closed in exactly that intersection: a programme with no prior season,
from a page that names no season, has produced no evidence and should be
recorded as unresolved rather than stored. Test 7 in
`server/scripts/seasonIntegrity.test.js` is written against today's behaviour
and inverts the day it is closed, so the fix has a failing assertion waiting
for it.

Deliberately not recommended: repairing the two programme-seasons. There is no
source that can establish their 2025 season, the pool effect is one minute on
one threshold, and removing rows nobody can replace is a product decision the
operator should make with these measurements in front of them — not a
consequence of an audit.
