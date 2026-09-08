# External competitive collection — parser proof

**Phase 12C. Research only.** No collector was productionised, nothing was
rendered, and no file in this repository changed except this one — every
artefact lives in `../phase12c/`. Base: `research/competitive-programme-intelligence` @ `655dfc0`.

The question 12A could not answer and 12B.1 made urgent: **what is the route
coverage**, and can external collection supply the `historical_division` that
every benchmark now refuses without?

## The answer in one table

| | coverage | who has it |
|---|--:|---|
| season fetched | **82.0%** | 328 of 400 programme-seasons |
| **official overall record** | **82.0%** | 100% of both Sidearm routes |
| **official conference record** | **82.0%** | 100% of both Sidearm routes |
| fixtures with goals | 81.8% | both Sidearm routes |
| home/away/neutral | 81.3% | both |
| **historical conference** | **19.8%** | Nuxt 96.7%, legacy 5.2% |
| **historical division** | **19.5%** | derived from the conference |
| per-fixture conference flag | 14.8% | Nuxt only |
| tournament metadata | 11.0% | Nuxt mostly |
| three-way reconciled | **71.5%** | — |

**Two things are near-universal and two are not.** The record and the fixtures
are there on 82% of programme-seasons. Historical conference — the thing 12B.1
needs — is on 20%, because the legacy Sidearm route does not carry it. That is
the finding this phase exists to deliver.

## Correcting 12A

12A reported that Nuxt sites carry no official-record header. **They do.** It
sits in the `__NUXT_DATA__` payload as an object with `overall`,
`overall_percentage`, `conference`, `home`, `away`, `neutral` — Akron 2022 reads
`11 - 4 - 5`, `0.675`, conference `5-0-3`. So **both** Sidearm routes give the
official overall and conference record, and `overall_percentage` is a third
independent confirmation that NCAA winning percentage is the right canonical
rate: .675 = (11 + 2.5)/20.

The Nuxt payload also carries **the team's own conference for that season**.
California reads `Pac-12` in 2022 and `Atlantic Coast Conference` in 2024 — the
realignment, from the official source, per season.

## The route that answers the division question

Historical division is not on any schedule page. It is derivable from the
conference, because a conference is a division-level entity by NCAA rule: 270 of
276 conference-sport groups in our own membership data sit unanimously in one
division, so a conference name collected from an official 2022 page resolves
that season's division as `DERIVED_FROM_OFFICIAL_MEMBERSHIP`.

For the 67% of programmes on the legacy route, the conference has to come from
**the conference's own site**, and it does. `standings.aspx?standings={id}`,
with the id read from the current page's option list, returns a historical
standings table — 6 of 8 conferences probed gave all four seasons, with the page
title confirming the year. One fetch yields every member's conference, division
and conference record for that season.

`?year=2022` is silently ignored and returns the current season. That is the
shape of error that would publish this year's table as 2022's, so the id route
is not an optimisation, it is the only correct one.

**Mercyhurst, the required test:** PSAC in 2022 and 2023, NEC in 2024 and 2025 —
so **D2, D2, D1, D1**, against a current `colleges.division` of D1. The benchmark
machinery routes its 2022 season to the men's D2 pool and never to D1.

## What the three-way reconciliation caught

Comparing the external official header, the external fixture-derived record and
the internal `programme_seasons` row found **two wrong-school domain entries** in
`known_domains.json` — `gocolumbialions.com` is Columbia University (NY), not
Columbia College (MO); `maryvillesaints.com` is Maryville University (MO), not
Maryville College (TN). Eight programme-seasons of confidently wrong data, from a
correct-looking fetch of a real athletics site, detectable by nothing else.

That is the argument for the acceptance gate below: **programme identity has to
be verified against a second source, not assumed from a domain map.**

## Parser defects this phase found and fixed

| defect | evidence |
|---|---|
| score orientation is site-dependent | College of Idaho publishes `L 1-0` and `L 2-1` — winner first. Blue Mountain publishes `L 0-4` — team first. Resolved from the result letter. |
| time cells read as opponents | "11 a.m. PT / 12 p.m. MT", "6:30 PM CDT", "TBD" arrived as team names. Fixed by taking the cell after the Home/Away/Neutral column. |
| exhibitions in four spellings | `(EXHIBITION)`, `(EX)`, `(Exh.)`, `(exhib.)`, plus `Exhibition` / `Spring Season` / `Alumni Day` in the Nuxt tournament field. |
| place names as tournaments | A keyword sweep matched "Springfield, Mo.", "Spring Hill", "Spring Arbor" — 34 locations entered the tournament vocabulary. Fixed by position plus vocabulary; 109 distinct titles fell to 54. |
| row order is not conference finish | The PSAC table lists East then West, each seeded `(1)(2)(3)`, so Mercyhurst — first in the West — is eighth by row. Finish is **not** claimed. |
| `tournament.title` is not only competitions | It also carries "Senior Day", "Breast Cancer Awareness Game", "Real 'Cats Wear Pink". |

## Quarantine, not correction

Goals are publishable only from a fixture set that reproduces the official
record: **286 of 327 (87.5%)**. The other 41 are **QUARANTINED** with the
reconciliation class attached. No fixture was deleted to force agreement.

Independent check on the ones that do reconcile: the count of home fixtures
equals the official home record at **286 of 286**.

## Opponent identity

5,966 references, no fuzzy matching and no similarity:

| stage | | |
|---|--:|--:|
| EXACT | 3,587 | 60.1% |
| NORMALISED | 1,345 | 22.5% |
| CURATED_ALIAS | 52 | 0.9% |
| LOCATION_DISAMBIGUATED | 108 | 1.8% |
| UNRESOLVED | 874 | 14.6% |
| **resolved** | **5,092** | **85.4%** |

The step that mattered was reading the state the source writes into the name
itself — "Aquinas College (Mich.)", "Georgetown College (Ky.)" — which is
evidence, not a guess, and lifted coverage from 74.7%. **All 46 distinct
location-disambiguated matches were inspected and all 46 are correct**,
including the pairs that would defeat a similarity matcher: Maryville
University [MO] and Maryville (TN); College of Charleston [SC] and University of
Charleston [WV].

## Non-claims

Unchanged. No competitive score, no GOOD/BAD, no RISING/FALLING, no forecast, no
causal coach language, no schedule strength, no stronger/similar/weaker, no
current rating as history, and no universal postseason depth scale — 54 raw
titles were collected precisely so that a normalisation map can be judged on
evidence later.
