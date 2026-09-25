# L6 — NCAA roster source completion audit

Audit only. No dataset, code, alias, Evidence kind, permission or policy
changed; P6 unchanged, manifest `5bbca9054b7752d5` unchanged, all six baselines
byte-identical, corpus unmoved at 1,755 / 2,987.

**Two findings reorder the stage.** Seven of the 41 "source-missing" programmes
are duplicate registry rows whose twin already holds a roster — so the real
acquisition gap is **34**, not 41. And the acquisition pipeline the gap needs
**already exists and already works**; its worklist is simply seeded from last
season's successes, so a programme absent once is never asked for again.

---

## Reproduction

| division | sport | active gaps |
|---|---|---:|
| NCAA D1 | mens / womens | 0 / 0 |
| NCAA D2 | mens / womens | 2 (+2 inactive) / 6 |
| NCAA D3 | mens / womens | 7 / 26 |
| **total** | | **41 active**, 43 with inactive |

Matches L5 exactly. Method: every `colleges` row where `division LIKE 'NCAA%'`
with zero `roster_players` rows for its own `(college_name, sport)`.

## Seven of the 41 are duplicate registry rows

L5's lesson was that a pooled, sport-blind membership test invents identity
failures. Re-run here with a normalised name comparison **within each
programme's own sheet**, then verified against `unitid`, city and state rather
than name similarity:

| empty row | twin row holding the roster | unitid | city | twin rows |
|---|---|---:|---|---:|
| Cal Lutheran | California Lutheran University | 110413 | Claremont CA | 176 |
| UC Santa Cruz | University of California-Santa Cruz | 110714 | — | 144 |
| FDU-Florham | Fairleigh Dickinson University-Florham | 184694 | — | 129 |
| Claremont-Mudd-Scripps | Claremont McKenna College | 112260 | Claremont CA | 154 |
| Pomona-Pitzer | Pomona College | 121345 | Claremont CA | 152 |
| Mississippi College | Mississippi Christian | 176053 | Clinton MS | 194 |
| St. Joseph's University (Brooklyn) | St. Joseph's University (Long Island) | 195544 | Brooklyn NY | 131 |

All seven are **the same institution, same unitid, same sport, same city**. The
roster imported correctly under one spelling; the other row is a duplicate that
has never held data. The signature is consistent: **the empty twin has a blank
`conference` while the rostered row carries the full conference name**, which
says the two rows were created by different processes.

Registry-wide there are 11 NCAA `unitid`+`sport` groups with more than one row.
Seven are this defect. The other four — Commonwealth University
(Bloomsburg/Lock Haven/Mansfield), Vermont State (Johnson/Castleton/Lyndon) and
PennWest (Edinboro/Clarion/California) — are genuine multi-campus merges under a
single unitid and are **not** the same problem; they are left alone.

**These seven are a registry-deduplication task, not acquisition**, and they are
not fixed here: merging registry rows is a data mutation and L6 is an audit.
Two need care even then — "Mississippi Christian" and "St. Joseph's University
(Long Island)" are *misnamed* rows carrying the real roster, so the correct
survivor is not obviously the one holding the data.

**Corrected acquisition gap: 34 programmes.**

## Where the sheets come from

`npm run import-rosters` → `importRosterSheets.js` reads
`server/seed/data/rosters_<season>/`. Sheet columns:

```
School, Conference, Player Name, Class/Year, Total Minutes Played, Games Played,
Games Started, Nationality, Hometown, Country, Source Stats URL,
Source Roster URL, Data Confidence, Notes, Estimated Graduation, Position
```

**Provenance is embedded in the sheet itself** — every row carries its own
`Source Roster URL` and `Data Confidence`, which is why 99.7% of
`roster_players` rows hold a direct source URL.

Upstream, the sheets are produced by a real, durable pipeline **outside this
repository**: `~/Documents/Thriv3/_roster_pipeline/`, with state in
`<season> Roster Sheets/_state/` and a page cache. The 2026 run resolved
**1,910 of 2,104 school-sports (57,807 players)** across all divisions, gated by
a measured 0.85 turnover threshold that proves a live page is a new season
rather than a stale one. It is reproducible, cached, and refreshable.

**So there is no missing acquisition capability.** There is a missing *ask*.

## The root cause — and why it explains the D3 women's skew

`2026 Roster Sheets/_targets.csv` is the worklist: **2,104 rows**, every one
`Status: todo`, **2,102 carrying a `Roster URL 2025 (known good)`** and a
`Method` describing how to derive the 2026 URL from it ("year-swap (direct)",
"season-span swap", "archive in the later season", "recovered: url sourced from
the 2025 file").

Of those 2,104 targets, **2,028 already have roster data in the database**, and
**0 of the 41 gap programmes appear in the list at all**.

The worklist is seeded from programmes that already succeeded in the prior
season. A programme missing from the 2025 sheets is never asked for in 2026,
never acquires a known-good URL, and is therefore never asked for in 2027.
**The gap is structurally self-perpetuating**, and each refresh preserves it
exactly.

That is the answer to the D3 women's question, and it is not "women's D3 is
lower". The 2025 D3 women's sheet holds 394 schools against 418 in the
registry; the 24-school shortfall was carried into 2026 unchanged because the
2026 worklist was derived from the 2025 output rather than from the registry.
The same mechanism explains all four sheet deltas — the skew is proportional to
whatever each sheet happened to miss first. It is a **worklist-derivation
defect**, and it will reproduce the same gap every season until the seed changes.

There is precedent in the project's own record: the 2026 first pass read 386
NAIA programmes as "missing" when they had never been asked for, because
`build_targets.py` globbed only `ncaa_*_rosters.csv`. This is the same class of
bug at a different scope.

## Source discovery — partially answered, and honestly so

`athletics_domains` gives a repository-metadata answer for **28 of the 41** (a
verified athletics host such as `sagehens.com`, `uwlathletics.com`,
`beaconsathletics.com`); **13 have none**.

**Live source verification was not performed.** Visiting 34 athletics sites to
classify them OFFICIAL_STABLE / DYNAMIC / PARTIAL was out of proportion to a
stage whose answer turned out to be "re-point the existing pipeline", and any
verdict I produced would be superseded the moment that pipeline ran — it already
does source discovery, caching, turnover gating and soft-404 detection far more
rigorously than a one-off check would. **So items 16–19, 21–28 and 30–32 are
reported as NOT ASSESSED rather than guessed**, and the pipeline's own run is
the right instrument.

What *can* be said from the sheet contract: field availability, historical
availability and provenance are properties the pipeline already guarantees for
the 2,102 programmes it handles — name, position, class/year, nationality,
hometown, source URL and confidence are all sheet columns, and it resolved 91%
of what it was asked for. There is no reason the 34 differ in kind; they differ
in never having been asked.

## Acquisition options

| | truth | cost | maintenance | coverage | provenance | refreshable |
|---|---|---|---|---|---|---|
| **A** manual sheet completion | high | medium ×34 | high, repeats yearly | 34 | manual | **no — same gap next season** |
| **B** provider automation | high | high | medium | unknown | strong | yes |
| **C** direct site importers | high | very high ×34 | very high | 34 | strong | partly |
| **D** generic extractor | **low** | high | high | broad | weak | yes |
| **E** existing pipeline, re-seeded | **high** | **low** | **none new** | 34 + every future gap | **strong** | **yes, permanently** |

**D is rejected** on the same grounds as L4: completeness that nobody can
characterise. **A is rejected** less obviously but more importantly — it closes
2025 and leaves the defect that created it, so the same 34 reappear in 2027.

## Recommendation — gate **E, DATA_ALREADY_AVAILABLE**

Not because the rosters are already acquired — they are not — but because the
**acquisition infrastructure already exists, works, and needs no addition**. The
change is to what it is asked for.

**Implementation cohort, in order:**

1. **Re-seed the worklist from the registry.** `_targets.csv` should be derived
   from `colleges` (active, in-scope divisions) rather than from the prior
   season's output. This is the fix that stops the gap regenerating, and it is
   worth more than the 34 rows it recovers.
2. **Run the existing pipeline for the 34**, which then have no known-good prior
   URL and take the discovery path the pipeline already implements.
3. **Registry deduplication for the 7** — separately, deliberately, and with the
   two misnamed survivors decided by a human.

**Not in scope:** new scrapers, provider adapters, generic extraction,
`athletics_domains`, NAIA/NJCAA.

## Projection

Honest bounds, since live source availability is unverified:

| | now | if all 34 acquired | if 7 dedup only |
|---|---:|---:|---:|
| D1 | 100.0% | 100.0% | 100.0% |
| D2 | 97.9% | 99.6% | 98.9% |
| D3 | 95.5% | 100.0% | 96.2% |
| **NCAA** | **97.6%** | **99.9%** | **98.0%** |

The 34 figure assumes every one has an acquirable official roster, which the
pipeline's 91% resolution rate suggests is optimistic. A realistic outcome is
**~99%**, with a handful genuinely unavailable — and that residue should be
recorded as unavailable rather than chased to 100%.

Expected remaining active gaps after the recommended work: **0–5**, plus the 2
inactive programmes that are correctly empty.

## L7 handoff — athletics_domains

Recorded, not solved. Coverage: **D1 54%, D2 48%, D3 89%.**

Consumers, from this repository: `sourceVerification.js`
(`verifyRosterSource`, `canonicalHost`), `registryIntegrity.js`
(`classifyRegistry`, `integrityRefuses`), `rosterSourceAudit.js`, and
`operatorEvidence.js`, which is the only payload carrying `sourceUrl`. The
table is also fingerprinted in the H18 dataset manifest, so a re-scrape moves
`OPERATOR_EVIDENCE` and no other baseline.

**L7 must establish actual product impact before setting a target.** The
evidence available here suggests it gates the operator's *citable source links*
rather than Evidence generation itself — no Evidence kind reads
`athletics_domains` directly — but that should be measured, not assumed. Low
coverage is not automatically damage.

## Diagnostic thresholds — not product rules

L5's proposed bar (≥97% roster coverage, ≤3pp gender disparity, ≥75%
`athletics_domains`) remains **diagnostic only** and is not adopted here.

## The 41, in full

| programme | sport | div | unitid | athletics domain | classification |
|---|---|---|---|---|---|
| Pace | mens | D2 | 194310 | pace.edu | SOURCE_MISSING |
| Southwest Minnesota State | mens | D2 | 175078 | smsu.edu | SOURCE_MISSING |
| Azusa Pacific University | womens | D2 | 109785 | apu.edu | SOURCE_MISSING |
| Glenville State | womens | D2 | 237385 | gstatepioneers.com | SOURCE_MISSING |
| Mississippi College | womens | D2 | 176053 | gochoctaws.com | DUPLICATE_ROW |
| Northwood | womens | D2 | 171492 | gonorthwood.com | SOURCE_MISSING |
| Tuskegee | womens | D2 | 102377 | — | SOURCE_MISSING |
| Wayne State (MI) | womens | D2 | 172644 | — | SOURCE_MISSING |
| Anna Maria | mens | D3 | 164492 | annamaria.edu | SOURCE_MISSING |
| Bryn Athyn | mens | D3 | 210492 | brynathyn.edu | SOURCE_MISSING |
| Carlow | mens | D3 | 211431 | athletics.carlow.edu | SOURCE_MISSING |
| Goucher | mens | D3 | 162654 | athletics.goucher.edu | SOURCE_MISSING |
| New Jersey City | mens | D3 | 185129 | — | SOURCE_MISSING |
| Wisconsin-La Crosse | mens | D3 | 240329 | uwlathletics.com | SOURCE_MISSING |
| Wisconsin-Oshkosh | mens | D3 | 240365 | uwosh.edu | SOURCE_MISSING |
| Anna Maria College | womens | D3 | 164492 | annamaria.edu | SOURCE_MISSING |
| Bryn Athyn College of the New Church | womens | D3 | 210492 | brynathyn.edu | SOURCE_MISSING |
| Cal Lutheran | womens | D3 | 110413 | callutheran.edu | DUPLICATE_ROW |
| Carlow University | womens | D3 | 211431 | athletics.carlow.edu | SOURCE_MISSING |
| Claremont-Mudd-Scripps | womens | D3 | 112260 | — | DUPLICATE_ROW |
| College of Saint Benedict | womens | D3 | 174747 | gobennies.com | SOURCE_MISSING |
| Elms | womens | D3 | 167394 | athletics.elms.edu | SOURCE_MISSING |
| Endicott College | womens | D3 | 165699 | endicott.edu | SOURCE_MISSING |
| Eureka College | womens | D3 | 144971 | eureka.edu | SOURCE_MISSING |
| FDU-Florham | womens | D3 | 184694 | — | DUPLICATE_ROW |
| Goucher College | womens | D3 | 162654 | athletics.goucher.edu | SOURCE_MISSING |
| Lasell | womens | D3 | 166391 | laserpride.lasell.edu | SOURCE_MISSING |
| Mitchell | womens | D3 | 129774 | mitchell.edu | SOURCE_MISSING |
| New Jersey City University | womens | D3 | 185129 | — | SOURCE_MISSING |
| Norwich | womens | D3 | 230995 | norwichathletics.com | SOURCE_MISSING |
| Pomona-Pitzer | womens | D3 | 121345 | sagehens.com | DUPLICATE_ROW |
| Rivier | womens | D3 | 183211 | rivier.edu | SOURCE_MISSING |
| Saint Mary's College (IN) | womens | D3 | 152390 | — | SOURCE_MISSING |
| Simmons | womens | D3 | 167783 | athletics.simmons.edu | SOURCE_MISSING |
| St. Catherine University | womens | D3 | 175005 | stkate.edu | SOURCE_MISSING |
| St. Joseph's University (Brooklyn) | womens | D3 | 195544 | sjliathletics.com | DUPLICATE_ROW |
| Trinity Washington University | womens | D3 | 131876 | — | SOURCE_MISSING |
| UC Santa Cruz | womens | D3 | 110714 | goslugs.com | DUPLICATE_ROW |
| UMass Boston | womens | D3 | 166638 | beaconsathletics.com | SOURCE_MISSING |
| UMass Dartmouth | womens | D3 | 167987 | corsairathletics.com | SOURCE_MISSING |
| Wesleyan (GA) | womens | D3 | 141325 | — | SOURCE_MISSING |