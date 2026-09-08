# L1 — why Thriv3 is still generic, and where the intelligence actually is

Audit only. No Evidence kind, permission, qualification, copy, policy, taxonomy
or datum changed; all six baselines are byte-identical and the corpus is
unmoved. Every figure is reproducible from the probes named.

**The headline: the bottleneck is not the Evidence architecture. It is one
missing athlete field, and 217 programmes with no roster.**

---

## Coverage today

4,742 pairs · 1,755 personalised · 2,987 generic · RELATIONSHIP_FIRST 536 /
PLAYER_FIRST 4,206 · 2,842 sentences · 221 held. Men's 3,507 pairs / 1,562
personalised; women's 1,235 / 193.

## Why the 2,987 are generic

| primary reason | pairs | share |
|---|---:|---:|
| **ONLY_DENIED_EVIDENCE** — facts generated, every one denied for outreach | **1,925** | 64.4% |
| **NO_EVIDENCE_GENERATED** — nothing to say | 633 | 21.2% |
| **ONLY_RECOGNITION** — a congratulation rendered, which is not personalisation | 429 | 14.4% |

Secondary contributors: NOT_LICENSED 2,345, DEDUPED 187, UNQUALIFIED 6.

**Qualification is essentially never the blocker.** Across the entire corpus
there are 21 UNQUALIFIED dispositions and 30 HELD, against 37,635 NOT_LICENSED.
The engine is not failing to qualify what it knows; it is refusing to say it.

## Generic does not mean uninformed

Generated Evidence depth among the 2,987 generic pairs:

| kinds generated | pairs |
|---|---:|
| 10+ | 1,128 (37.8%) |
| 5–9 | 885 |
| 3–4 | 97 |
| 1–2 | 244 |
| **0** | **633 (21.2%)** |

**79% of generic pairs have at least one generated Evidence kind; 38% have ten
or more.** The engine usually knows a great deal and correctly says nothing.

## The unused inventory, and why it should stay unused

The twelve highest-coverage kinds present in generic pairs are all DENIED:

| kind | generated | in generic pairs |
|---|---:|---:|
| POSITION_GROUP_SIZE | 3,510 | 1,899 |
| FRESHMAN_MINUTES_LADDER | 3,355 | 1,844 |
| PROGRAMME_POOL_BENCHMARK | 3,355 | 1,844 |
| COACH_CONTEXT | 3,045 | 1,708 |
| POSITION_INTAKE_HISTORY | 2,993 | 1,660 |
| ELIGIBILITY_CLIFF | 3,023 | 1,537 |
| PROGRAMME_DEVELOPMENT_PATTERN | 2,720 | 1,488 |
| ATHLETE_COHORT_LADDER | 2,581 | 1,420 |
| INTERNATIONAL_ROSTER / _SHARE | 2,815 / 2,791 | 1,381 / 1,364 |
| TRANSFER_BEHAVIOUR | 2,750 | 1,374 |
| PROGRAM_MOMENTUM | 1,760 | 1,066 |

Their denials are product decisions with reasons already written down — the
roster kinds "grade their squad to their face", the development ladders are
"one sentence away from promising playing time", and the pool benchmark tells a
coach how they rank against peers. J2 refused POSITION_INTAKE_HISTORY on
measured base-rate grounds. **None should be reopened, and coverage is not an
argument for reopening any of them.**

**Every ALLOWED kind has `inGeneric = 0`.** Whenever a licensed kind generates,
the email is personalised. The licensed set is at full utilisation; there is no
slack in it.

## The finding that dominates L1

The engine consumes six athlete fields: name, position, class year, country,
**intended major**, sport.

Two of the four canonical athletes have no `intended_major`. Their hook
profiles show the cost directly:

| athlete | ACADEMIC_FIT as hook | personalised |
|---|---:|---:|
| Rhys Davies (major set) | 297 | 634 / 1,169 |
| Ryan Billings (major set) | 297 | 634 / 1,169 |
| **Shaan Anad (no major)** | **0** | **294 / 1,169** |
| **QA Fixture (no major)** | **0** | **193 / 1,235** |

Simulated read-only by supplying a major and re-running the real path:

- Shaan Anad **294 → 621 personalised (+327)**
- QA Fixture **193 → 705 personalised (+512)**

**+839 pairs — 28% of every generic pair in the corpus — from one field, using
an Evidence kind that already exists.** No new kind, no licensing change, no
copy change.

`gpa`, `sat_score`, `act_score` and `secondary_position` are collected and are
**not** consumed by any Evidence kind (GPA/SAT/ACT appear in the credentials
block, which is not Evidence). They are not missing inputs; they are inputs the
engine does not need.

## The second cohort: data acquisition

The 633 zero-evidence pairs span **257 distinct programmes**, of which **217
have no `roster_players` rows at all** and 256 have no `recruiting_arrivals`.
That is acquisition debt, not an ontology gap. Ranked by pairs affected:
roster history (217 programmes) dominates everything else.

The 260 high-intelligence generic pairs that do hold a licensed kind hold only
POSTSEASON_RESULT (113) and CONFERENCE_TITLE (147) — recognition, correctly not
counted as personalisation. **GENERIC_CORRECT.**

## Data assets not read by Evidence

The Evidence path reads five tables: `roster_players`, `recruiting_arrivals`,
`coach_seasons`, `colleges`, `athletics_domains`.

| unread asset | rows | assessment |
|---|---:|---|
| `programme_seasons` | 8,685 | Per-season W-D-L, 2022–25, 100% populated, 2,260 programmes. Descriptive, not relational, and PROGRAM_MOMENTUM already owns the trend claim — and is denied. **Duplicate authority.** |
| `graduating_seniors` | 2,110 | Official names and position data. POSITION_GRADUATION already owns this claim from `roster_players`. **Provenance upgrade, not a new kind.** |
| `programme_conference_seasons` | 7,219 | Conference movement. Base-rate; CONFERENCE_TITLE owns the recognition. |
| `coaches` | 6,347 | Contact records, not evidence. |

**No large unused relational asset exists.** Performance already reaches
Evidence through denormalised `colleges` columns.

## Hook saturation

| hook | share |
|---|---:|
| POSITION_GRADUATION | 35.6% |
| ACADEMIC_FIT | 33.8% |
| HISTORICAL_SAME_COUNTRY | 14.2% |
| COACH_ARRIVAL_SAME_COUNTRY | 10.1% |
| ARRIVAL_SAME_REGION_POSITION | 3.4% |
| ARRIVAL_SAME_COUNTRY_POSITION | 1.7% |
| CURRENT_SAME_COUNTRY | 1.3% |

By family: departure 36%, academic 34%, country 31%. **Healthily balanced across
three independent families** — no single-claim dependency. Worth noting the
country family rests entirely on the athlete being international, and the
academic family entirely on `intended_major`.

## Candidates

**Candidate 1 — collect `intended_major`. Not an Evidence kind.**
Claim: none new; ACADEMIC_FIT already says it. Athlete input: one field.
Coverage +839 pairs (28% of generic). Truth risk: none — the kind is unchanged
and already adversarially tested. Role: RELEVANCE, as today. Sport-general.
Men's/women's parity: identical, the kind reads `colleges.notable_majors`.
**VALUE HIGH · COVERAGE HIGH · TRUTH SAFETY HIGH · SPECIFICITY HIGH · DATA
READINESS MISSING (acquisition) · COMPLEXITY LOW.**

**Candidate 2 — roster acquisition for the 217 programmes with none.**
Not an Evidence kind either. Unblocks every roster-derived kind at once.
**VALUE HIGH · COVERAGE MEDIUM (633 pairs) · TRUTH SAFETY HIGH · READINESS
PARTIAL (a known pipeline exists) · COMPLEXITY MEDIUM.**

**Candidate 3 — `graduating_seniors` as a provenance source for
POSITION_GRADUATION.** Official roster URLs and confirmed position data behind a
claim currently inferred from `roster_players`. Raises confidence on the
single most-used hook (35.6%) rather than adding a new one. No new claim, no new
authority. **VALUE MEDIUM · COVERAGE MEDIUM · TRUTH SAFETY HIGH · READINESS
READY · COMPLEXITY MEDIUM · OUTREACH SUITABILITY: unchanged.**

**No fourth candidate is justified.** I looked for one and the audit does not
support inventing a new Evidence kind: the licensed set is fully exploited, the
denied set is denied for stated product reasons, and no unread table carries a
relational claim that an existing kind does not already own.

## Rejected

| idea | why not |
|---|---|
| Reopen POSITION_GROUP_SIZE / ELIGIBILITY_CLIFF / RETURNING_POSITION_DEPTH | Grades their squad to their face. Denial is a product decision, not a default. |
| Reopen FRESHMAN_MINUTES_LADDER / ATHLETE_COHORT_LADDER | One sentence from promising playing time. |
| Reopen PROGRAMME_POOL_BENCHMARK | Ranks a coach against peers, to that coach. |
| Reopen POSITION_INTAKE_HISTORY | J2 refused it on measured base-rate grounds; nothing has changed. |
| Reopen INTERNATIONAL_SHARE / _ROSTER | Proportion claims; completeness cannot support them. |
| A season-record kind from `programme_seasons` | Base-rate and descriptive; duplicates the denied PROGRAM_MOMENTUM. |
| A conference-movement kind | Base-rate; says nothing about this athlete. |
| Using GPA/SAT/ACT as Evidence | Athlete attributes, not programme relationships. They belong in credentials, where they already are. |

## Recommended Stage L scope

Two acquisition slices and one provenance slice. **No new Evidence kind.**

- **L2** — `intended_major` acquisition: collection path, validation, and a
  corpus rerun. Largest single lever in the audit.
- **L3** — roster acquisition for the 217 programmes, reusing the existing
  pipeline.
- **L4** — `graduating_seniors` as a provenance source for POSITION_GRADUATION.
- **L5** — closeout: corpus rerun, baseline repin with reasons, Stage L report.

The honest conclusion of L1 is that Stage L should mostly not be an Evidence
engineering stage. The engine is not short of expressive power; it is short of
two inputs.
