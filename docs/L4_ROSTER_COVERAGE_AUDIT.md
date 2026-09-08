# L4 — roster coverage audit

Audit only. No Evidence kind, permission, policy, dataset or code changed; all
six baselines are byte-identical and the corpus is unmoved at 1,755 / 2,987.

**Headline: the roster gap is 81% junior college, and ~80% of the pairs it
explains are already recoverable by the academic field L3 finished — with no
roster at all. Roster acquisition is a real but second-order lever, and only 12
programmes are cheaply recoverable today.**

---

## Corrected architecture note (supersedes L2)

L2 stated that `shared/academicMajors.js` was shared by athlete matching **and**
programme academic ingestion. **That was wrong**, and L3 proved it:
`server/scripts/importNotableMajors.js` contains **zero** references to
`majorLabelFor` — it writes `colleges.notable_majors` from a CIP-keyed CSV.

The accurate statement: athlete-side normalisation and programme-side ingestion
**share the `CIP_FAMILIES` label vocabulary, but do not share a normalisation
function.** `majorLabelFor` is athlete-side only, consumed by `generate.js`,
`emailTemplate.js` and `EvidenceTab.jsx`.

This is why L3's alias changes provably could not move programme data. The L2
document is left as written — it records what was believed then — and this note
is the correction of record.

## Reproduction

Exactly as L1, at P6:

| | |
|---|---:|
| canonical pairs | 4,742 |
| `NO_EVIDENCE_GENERATED` pairs | **633** |
| distinct programmes in that cohort | **257** |
| of those, with zero `roster_players` rows | **217** |
| canonical programmes (`colleges` rows) | 2,404 |
| with roster rows | 2,122 |
| **zero-roster overall** | **282** |

Method: drive every athlete × programme pair through `evidenceFor`, count pairs
where `ev.all` is empty, then join each programme against `roster_players`.

## The pipeline is CSV import, not scraping

`npm run import-rosters` → `server/scripts/importRosterSheets.js` reads
per-sport, per-division CSVs from `server/seed/data/rosters_<season>/` →
`registrySchoolName()` alias resolution → `RosterPlayer` → `roster_players`.

Eight sheets exist for 2025 (NCAA D1/D2/D3 and NAIA, men's and women's), six for
2024. Provenance is carried per row: **275,934 of 276,745 rows (99.7%) hold a
`source_roster_url`**, and every row holds `data_confidence` (high/medium/low).

**So the acquisition question is not "can we scrape 217 sites" — it is "does a
bulk source sheet exist for this cohort".**

## Acquisition vs identity — the decisive cut

Every zero-roster programme was checked against the 1,509 distinct school names
appearing in the 2025 sheets, under both its own name and its
`registrySchoolName` alias:

| | programmes |
|---|---:|
| **absent from source entirely** — acquisition blocked | **270** |
| **present in source, no rows** — identity blocked | **12** |

**This is an acquisition problem, not an identity problem** — the opposite of
what H15/H16's registry findings would have suggested. The 12 identity-blocked
programmes are named in full below and are the cheapest recoverable cohort in
the audit.

### Bucket classification (all 282)

| bucket | count | share |
|---|---:|---:|
| **C. SOURCE_MISSING_OR_UNAVAILABLE** — no bulk sheet covers this tier | **228** (all NJCAA) | 80.9% |
| **A. SOURCE_EXISTS_NOT_INGESTED** — same tiers as existing sheets, absent from them | 42 (NAIA 10, D3 27, D2 5) | 14.9% |
| **B. IDENTITY_MAPPING_BLOCKED** — in the sheet, unmatched | 12 | 4.3% |
| D. SOURCE_UNUSABLE | 0 assessed | — |
| E. NOT_EXPECTED_TO_HAVE_ROSTER | 2 (`active = 0`) | 0.7% |
| F. INGESTION_FAILURE_OR_STALE | 0 observed | — |
| G. UNKNOWN | 0 | — |

Bucket D is reported as **not assessed**, not as zero: per-site feasibility was
deliberately not tested, because the pipeline ingests bulk sheets and a
site-by-site verdict would not change the acquisition route. That is a real gap
in this audit and is named as one.

## Distribution — it clusters almost entirely in one tier

| division | zero-roster |
|---|---:|
| **NJCAA** | **228** |
| NCAA D3 | 33 |
| NAIA | 11 |
| NCAA D2 | 10 |

By sport: men's 249, women's 33. By status: 280 active, 2 inactive.
Of the 270 absent from source, **228 are NJCAA men's soccer** — a single
junior-college tier that was never in acquisition scope.

NJCAA's footprint: **228 colleges, 0 with any roster, 0 with any recruiting
arrival**, but **226 with `notable_majors`** and 132 with a `soccer_score`.

## Source and identity readiness

| division | colleges | with `unitid` | with `athletics_domain` |
|---|---:|---:|---:|
| NCAA D3 | 736 | 735 | 653 |
| NCAA D1 | 562 | 562 | 304 |
| NAIA | 392 | 386 | 229 |
| NCAA D2 | 465 | 462 | 225 |
| **NJCAA** | **228** | **226** | **26 (11%)** |
| USCAA | 21 | 20 | **0** |

NJCAA identity is fine (226/228 carry a unitid). What it lacks is the verified
athletics-domain layer that provenance leans on — 11% against 89% for D3. So
NJCAA acquisition carries an H16-shaped dependency before its rows could cite a
source with the confidence every other row does.

## The finding that reorders the whole stage

The 633 zero-evidence pairs by athlete: Shaan 210, Rhys 188, Ryan 188,
QA Fixture 47.

Supplying an academic major and re-running the real path, **with no roster
data whatsoever**:

| athlete | zero-evidence pairs | rescued by a major alone |
|---|---:|---:|
| Shaan Anad | 210 | **171 (81%)** |
| QA Fixture | 47 | **37 (79%)** |

NJCAA programmes hold `notable_majors` even though they hold no roster, so
`ACADEMIC_FIT` reaches them today. **Roughly four fifths of the cohort L1
attributed to missing rosters is in fact the missing academic field** — the
lever L2 sized and L3 hardened, requiring no acquisition at all.

The residual that a roster would have to earn: **425 pairs** — 376 for Rhys and
Ryan, who already have a major, plus 39 and 10 for the other two.

## What a roster is actually worth

Personalisation rate at programmes **with** a roster versus **without**:

| athlete | rostered | zero-roster |
|---|---:|---:|
| Rhys / Ryan | 66.7% | 8.0% |
| Shaan | 32.0% | 0.0% |
| QA Fixture | 16.1% | 0.0% |

Applying the rostered rate to the zero-roster cohort is an **upper bound**, and
knowingly so: junior colleges are smaller, later-recruiting and less
internationally staffed than the four-year programmes those rates come from.

| estimate | pairs | assumption |
|---|---:|---|
| **LOW** | ~110 | only roster-derived kinds fire, at a JUCO-discounted rate |
| **MEDIAN** | ~190 | half the four-year rate |
| **HIGH** | ~377 | full four-year rate, which the cohort will not reach |

### Current versus historical acquisition

`recruiting_arrivals` is derived from roster **transitions**, so:

- **one current season** unlocks `POSITION_GRADUATION`, `CURRENT_SAME_COUNTRY`,
  `SQUAD_GRADUATION` and the roster-shaped denied kinds.
- **two or more seasons** additionally unlock every arrival-derived kind —
  `ARRIVAL_SAME_COUNTRY_POSITION`, `ARRIVAL_SAME_REGION_POSITION`,
  `COACH_ARRIVAL_SAME_COUNTRY` — which is where the strongest hooks live.

A single-season NJCAA acquisition would therefore buy the weaker half. No new
Evidence kind is required or proposed either way.

## Minimum quality bar

| field | verdict |
|---|---|
| player name | **REQUIRED** — `isPlausibleName` already gates it |
| season | **REQUIRED** — historical/current semantics depend on it |
| programme identity (name → registry, unitid) | **REQUIRED** — must fail closed |
| `source_roster_url` | **REQUIRED** — 99.7% of existing rows carry one; a new tier must not be the exception |
| retrieved_at / freshness | **REQUIRED** — `rosterUpdatedAt` feeds `freshness`, and K3A made it manifest-covered |
| position | **OPTIONAL** — absence narrows which kinds qualify, and the field-coverage floor already handles it |
| class / year | **OPTIONAL** |
| country / nationality | **OPTIONAL** — but **never substituted from hometown**. K3B measured a 2–3% hometown-vs-country residual, and inferring one from the other would manufacture the international signal |

## Completeness safety

K3B's rule is unchanged and load-bearing here: **presence may be licensed by
observation; absence and proportion require completeness.** A newly acquired
roster must land as `OBSERVED_PARTIAL` until something independent establishes
otherwise — never as `COMPLETE_ENOUGH` because a page parsed. `countryAbsence`
already refuses on `UNVALIDATED` coverage and `INTERNATIONAL_SHARE` is denied
for every sport, so no absence claim can open as a side effect of acquisition.
**No absence-based Evidence is proposed.**

## Architecture options

| | truth | complexity | maintenance | coverage | provenance | identity risk |
|---|---|---|---|---|---|---|
| **A** manual operator entry | high | low | high per-row | poor at 270 | operator-attested | low |
| **B** source-specific importers | high | medium | medium | good where a bulk sheet exists | strong | low |
| **C** generic web extractor | **low** | high | **high** | broad | weak | **high** |
| **D** hybrid — B where a sheet exists, A for the tail | high | medium | medium | best available | strong | low |

**C is rejected.** A generic extractor across 228 heterogeneous junior-college
sites would produce rows whose completeness nobody can characterise, and the one
thing this system must not do is let "we parsed a page" become "this is the
roster". That is exactly the absence/presence boundary K3B drew.

## Tiers

| tier | programmes | what it is |
|---|---:|---|
| **Tier 1 — ready and valuable** | **12** | present in the 2025 sheets, unmatched by name. Pure alias work. |
| **Tier 2 — valuable, source work needed** | **42** | NAIA 10, D3 27, D2 5 — same tiers and same acquisition route as existing sheets |
| **Tier 3 — needs a product decision first** | **228** | NJCAA. New source ecosystem, 11% domain coverage, and an unanswered question about whether junior college is a target at all |
| **Tier 4 — do not pursue** | **21 + 2** | USCAA (0 athletics domains, 21 programmes) and the 2 inactive |

## Recommendation — gate E, split

**Not a roster acquisition project.**

1. **Operational academic backfill first.** It is built, it needs no
   engineering, and it recovers ~80% of the cohort L1 attributed to rosters.
   This outranks everything below.
2. **Tier 1 alias fix (12 programmes).** The data is already on disk and
   already imported; twelve names do not match. Small, deterministic,
   high-confidence — a natural L5.
3. **Tier 2 (42 programmes)** as a bounded option-B slice, if the sheets can be
   obtained for the same divisions already covered.
4. **Tier 3 (NJCAA, 228)** is a **product decision, not an engineering one**:
   is junior college a pathway Thriv3 recruits into? If yes it needs a source
   ecosystem, athletics-domain verification, and at least two seasons to be
   worth more than half its value. If no, 228 of the 282 zero-roster programmes
   are correctly empty and the gap largely closes on paper.

**Do not pursue Tier 3 on coverage grounds alone.** 504 of the 633 zero-evidence
pairs are NJCAA, which makes it the largest number in this audit and the one
most likely to be chased for the wrong reason.
