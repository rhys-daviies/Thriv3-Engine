# A7.7.1B — Recruitability floor, and the academic / financial architecture

**Investigation record. Nothing here is implemented.** No scorer, weight, gate,
calibration or scoreability rule changed in this phase. The only behavioural
change is to the words an explanation prints.

Reproduce every figure with:

```bash
node server/scripts/v2RecruitabilityDiagnostic.js --trace=A --programme=MIT
node server/scripts/v2RecruitabilityDiagnostic.js --mit-like --zero-paths --phi --architectures --propensity
```

---

## 1. Terminology, corrected

A7.7.1A wrote "income/merit-bracketed net price". That was wrong and the error
mattered, because it implied Thriv3 holds evidence about merit money. It does
not. The five concepts are separate and only two of them exist here:

| concept | definition | held? |
|---|---|---|
| **Institutional average net price** | `NPT4_PUB` / `NPT4_PRIV` — average price paid by *all* first-time full-time students receiving Title IV aid, after **all grant and scholarship aid** | **yes**, imported as `colleges.net_price` |
| **Income-bracketed net price** | `NPT41..NPT45` — the same figure split by **family income band** (0–30k, 30–48k, 48–75k, 75–110k, 110k+) | **yes, on disk, not imported** |
| **Need-based aid** | institutional grant awarded on demonstrated financial need | **no** |
| **Merit aid** | institutional grant awarded on academic or other achievement, independent of need | **NONE** |
| **Athletic aid** | equivalency awards under association rules | **rule only**, never a dollar figure |

Net price is aid-inclusive, so grant money is already *netted out* of it. It
cannot be decomposed into need and merit components, and nothing in the
Scorecard distinguishes them. A number that already includes aid is not
evidence about the *kind* of aid.

## 2. Income-bracketed net price — audit

Source: `tools/matching/extract_scorecard_matching.py` →
`~/Documents/Thriv3/University individualisation/_raw/matching_raw_scorecard.csv`
(3,879 rows, extracted 2026-08-25 from `Most-Recent-Cohorts-Institution.csv`).

Public institutions populate the `_PUB` columns and private the `_PRIV`; each
row carries one family, never both.

| division | programmes | Scorecard row | all 5 brackets | partial | none | no row |
|---|---|---|---|---|---|---|
| NCAA D1 | 562 | 562 | 555 | 1 | 6 | 0 |
| NCAA D2 | 463 | 461 | 453 | 8 | 0 | 2 |
| NCAA D3 | 736 | 735 | 730 | 1 | 4 | 1 |
| NAIA | 391 | 385 | 374 | 10 | 1 | 6 |
| **NJCAA** | 228 | 226 | **196** | 30 | 0 | 2 |
| USCAA | 21 | 20 | 18 | 2 | 0 | 1 |

By control: 900/942 public and 1,426/1,447 private carry all five brackets.
**2,326 of 2,389** active programmes with a `unitid` are fully covered.

**Freshness.** One vintage, the "most recent cohort" as of the May 2026 dump.
Not a time series; no year column travels with the value.

**International students are not represented.** The cohort is first-time,
full-time, Title IV aid recipients — which excludes international students,
who are ineligible for Title IV. The existing `internationalCostCaveat` in the
financial layer already says net price understates the international case, and
bracketing by income does not repair it. For an international athlete these
columns are not merely unhelpful, they describe a population the athlete is
not in.

### What athlete input would be required

**Household income band.** Explicitly:

> `budget_range` is NOT income. It is what a family says it can pay per year.
> A family on $200k with three children in school and a family on $90k with
> one may state the same $20k–$25k band, and the Scorecard bracket that
> predicts their actual price differs by two rows.

To use these columns the intake must ask a **new, separate question** for
household income, on the Scorecard's own five bands. It is a materially more
sensitive question than a budget band, it will have a lower answer rate, and
the layer must therefore keep working without it — bracketed price when
declared, institutional average when not, and the honest statement of which
was used in the explanation.

## 3. Merit-aid evidence — audit

**NONE.**

- No column in any of the 41 tables matches `merit|scholar|aid|grant|award|cds`
  (the single hit is `mailbox_oauth_transactions.consent_grant_id`, unrelated).
- The Scorecard carries no merit field; `NPT*` are aid-inclusive net prices.
- No Common Data Set extract, scholarship table, award calculator or
  programme-specific award rule exists anywhere in the repository.

No proxy is available and none should be constructed. Academic credentials
correlate with *lower* net price at strong-academic institutions for reasons
that include selectivity, endowment and the composition of the aided cohort;
reading that correlation as "this athlete will be offered merit money" would
be inventing a number about an individual from a population average.

**Future sources, listed separately and not endorsed:** Common Data Set
section H2A (non-need institutional grants, self-published by most US
institutions); published automatic-award tables at the minority of
institutions that guarantee by GPA/test score; IPEDS SFA components. All
require per-institution collection and none is a drop-in.

## 4. `academic_strength_priority` — design, not implementation

### Input contract

| | |
|---|---|
| column | `academic_strength_priority` |
| type | `INTEGER`, nullable, **default NULL** |
| allowed | 1, 2, 3, 4, 5 |
| missing means | **UNDECLARED** — never a midpoint, never backfilled |
| question | "How important is the academic strength of the college to you?" |
| anchors | 1 not important · 2 slightly · 3 somewhat · 4 very · 5 one of my highest priorities |
| helper | "This is about what you want. It is not a question about your grades." |

Existing athlete records take the default. Nobody asked them, so nothing may
be recorded as their answer — the same rule as the two locked preference
fields.

### Component

`academicOutcome`, in **Athlete Opportunity / Fit**, at `PREFERENCE_WEIGHTS`
scale alongside `majorFit`, `locationFit` and `athleticOutcome`, and weighted
by `ambitionMultiplier(academic_strength_priority)` exactly as
`athleticOutcome` is weighted by competitive level.

**Reads exactly one input: `colleges.academic_rating`.** It must not read SAT,
ACT, GPA, admit rate or net price. Those belong to Admissions Viability and to
Financial Viability, and a component that touched them would make the
athlete's *preference* move a *constraint*.

### Normalisation of `academic_rating`

`academic_rating` is a 0–10 institutional score, complete for 1,155 of 1,166
men's programmes. Three options, with the same objection A7.5.1 raised against
raw division prestige:

- **Raw /10.** Simple; but the scale is not calibrated across the pool, and a
  D3 at 9.9 and a D1 at 9.9 are not the same claim.
- **Percentile within the sport's pool**, by the same nearest-rank method as
  `abilityScale`. Consistent with every other axis in V2, comparable across
  divisions, and pinnable with a digest. **Recommended.**
- **Percentile within division.** Rejected: it would make a weak D1 score the
  same as a strong D3, which is the division-prestige inversion in reverse.

Shape, mirroring `athleticOutcome`:

```
value = strength × percentile(academic_rating)        # higher is better
```

where `strength = priorityStrength(academic_strength_priority)`.

### The thing this design cannot settle

**A strong academic record is two levers pointing opposite ways.** A 4.0/1550
may want to target academically strong institutions, *or* may want to use
those credentials as leverage for admission and money at institutions that
will value them more. Both are coherent, and `academic_strength_priority`
only asks the first. An athlete pursuing the second answers "not important"
and is scored correctly — they do not care about institutional strength — but
the *leverage* they hold is still not represented anywhere, and cannot be
until merit evidence exists (§3).

Its value is also **conditional on budget**: negligible for an athlete at
$40k+/yr with no stated ceiling, potentially decisive at $5k–$10k. The
component does not read budget and should not; the interaction is real and
belongs in a later phase, named here so it is not forgotten.

### Interactions

| with | behaviour |
|---|---|
| `majorFit` | independent. Undeclared major + high academic ambition scores; declared major + low ambition scores. They share no input. |
| `competitive_level_priority` | independent weights on independent components. An athlete may want a strong *programme*, a strong *institution*, both or neither. |
| `playing_opportunity_priority` | independent. |
| undeclared | `NOT_APPLICABLE`, leaves the coverage denominator, reorders nothing. |

### The ceiling this component cannot break

Measured, not argued. Setting Opportunity to **1.0 for the entire pool** — the
bound on anything that could ever live in that layer — leaves MIT at **#221**
for Fixture C, *worse* than its current #217, because the bound lifts every
competitor too. **No Opportunity component can rescue a programme the
recruitability term has already suppressed.** Adding academic ambition will
reorder the reachable list. It will not put MIT in front of a rating-3
athlete, and it should not.

## 5. Admissions Viability — design, not implementation

An **informational assessment**, not a gate, not a score, and never a
probability.

| state | meaning |
|---|---|
| `STRONG` | the athlete's record sits clearly above the institution's admitted profile |
| `PLAUSIBLE` | within the admitted profile |
| `STRETCH` | materially below it |
| `UNKNOWN` | insufficient evidence on either side |

### Evidence audit

| | D1 | D2 | D3 | NAIA | NJCAA | USCAA |
|---|---|---|---|---|---|---|
| `sat_avg` | 171/213 | 126/203 | 242/318 | 89/193 | **1/228** | 9/11 |
| `admit_rate` | 211/213 | 191/203 | 315/318 | 163/193 | **5/228** | 10/11 |

An admissions state would be `UNKNOWN` for **225 of 228 NJCAA** programmes —
a *second* refusal on top of the recruitability one they already carry.

### The cases it must handle carefully, and mostly cannot yet

- **Recruited-athlete coach support.** The entire mechanism at selective D3
  and in the Ivy League. A coach's slot converts a 5%-admit application into
  something else entirely, and Thriv3 holds no evidence of slots, bands or
  coach influence at any institution. This is why Admissions Viability must
  not become a gate: it would model the published rate and miss the actual
  process.
- **Test-optional.** `sat_avg` is now computed from a self-selected submitting
  minority at many institutions and is biased upward. An athlete below it is
  not thereby below the admitted profile.
- **International credentials.** No transcript mapping, no national-system
  equivalence, no English-proficiency evidence. `UNKNOWN`, always.
- **Selective D1.** Stanford-like cases already carry a recruitability
  suppression from programme strength; adding an admissions demotion would
  demote the same fact twice.
- **Missing data.** `UNKNOWN`, and it must read as absence, never as `STRETCH`.

### What would be needed before it could constrain a ranking

1. Evidence of coach support in admissions — slot counts, academic bands, or
   any observed recruited-athlete admit rate. Without it the assessment
   describes the general applicant, not this athlete.
2. Test-optional status and submitting share per institution.
3. An international credential mapping.
4. A measured relationship between the assessment and an outcome we care
   about. None exists, and destination recall is not it (v1-freeze §6).

Until all four, it is displayed and never multiplied.

## 6. NJCAA remediation — priority

228 men's programmes, `LIMITED_DATA` wholesale, and for a developmental
athlete arguably the most relevant pathway in the pool. Ordered by what
unblocks the most for the least:

1. **Eligibility rule (highest value, smallest artefact).** `positionalOpportunity`
   refuses at `NO_ELIGIBILITY_RULE` before it looks at anything else. One
   verified rule for NJCAA unblocks the layer for all 228 — *if* a roster
   exists. It is a published-rules question, not a data-collection project.
2. **Current-season roster.** NJCAA carries no 2026 roster at all. This is the
   large piece of work and nothing positional is scoreable without it.
3. **Minutes / starter identification.** Required for `vacatedStarters` to
   mean anything (see §7 — this is not an NJCAA-specific problem).
4. **Cost is already solved.** 196/228 carry all five income brackets and 226
   carry an average net price, so Financial Viability scores NJCAA today.
5. **Admissions evidence is absent and should stay out of scope.** Adding an
   admissions assessment before the roster work would give NJCAA a second
   `UNKNOWN` and change nothing.

**Not solved in this phase, and nothing here is safely derivable without the
rule.** Inventing an NJCAA eligibility model would be exactly the
"fake recruitability score" A7.3 refused.

## 7. Coach Recruitability — what the floor question turned out to be

### The MIT trace (Fixture A, rating 9, midfield, entry 2028)

| | |
|---|---|
| athlete percentile | 0.960 |
| MIT programme percentile | 0.308 |
| athletic delta | +0.652 |
| **athletic plausibility A** | **0.996** |
| rows at MIDFIELD | 11 (0 unreadable) |
| all places vacated | 5 |
| **vacated STARTERS** | **0** |
| fill rate | 0.826 (526/637, division) |
| expected newcomer places | 0.000 |
| **core** | **0.000** |
| φ | 0.35 |
| **R = 0.996 × 0.350** | **0.348** |
| gate gR(R) | **1.000 — does not fire** |
| base = .5R + .2F + .3O | 0.525 |
| **rank** | **#539 of 860** |

**The gate is not the mechanism.** R sits above the 0.25 threshold, nothing is
gated, and the whole suppression is in the additive base: R contributes 0.174
where an unconstrained programme contributes up to 0.500.

### The zero is not a measurement

MIT's 2026 roster carries `minutes_played` on **0 of 34 rows** and
`projected_minutes` on 5. Exactly one player in the entire squad clears the
600-minute starter threshold. `vacatedStarters = 0` therefore means *nobody
could be identified as a starter*, not *no starting place opens* — and the
layer reports `grade: MEASURED` regardless, because the grade tracks
class-label readability and never looks at minutes.

### Zero versus unknown, quantified

Every programme × position, entry year 2028:

| pathway | men's | women's |
|---|---|---|
| scored **positive** | 1,844 (39.5%) | 2,530 (51.2%) |
| **ZERO** — no starter identified at the position at all | **1,099 (23.6%)** | **1,261 (25.5%)** |
| **ZERO** — starters present, none vacating | 507 (10.9%) | 815 (16.5%) |
| **ZERO** — every starter eligible to remain | 18 (0.4%) | 38 (0.8%) |
| UNSCOREABLE — no roster on file | 1,144 (24.5%) | 224 (4.5%) |
| UNSCOREABLE — no class labels | 52 (1.1%) | 68 (1.4%) |
| UNSCOREABLE — no eligibility rule | 0 | 4 (0.1%) |

**Roughly two thirds of every scored zero is an absence of minutes evidence,
not evidence of an absence** — inside a model whose founding rule is that an
absence must never be representable as a value.

So the answer to the semantic question is: **both, and the layer cannot tell
them apart.** `core = 0` today conflates a measured "no place opens" with an
unmeasured "no starter could be identified". The unscoreable paths are handled
correctly; this one is not, because it fails *after* the guards, on a quantity
none of them checks.

### How common the MIT case is

A ≥ threshold **and** R ≤ 0.40 — plausible athlete, suppressed by a weak core:

| threshold | share of eligible programmes | worst fixture |
|---|---|---|
| A ≥ 0.90 | **38.1%** | G goalkeeper **64.7%** |
| A ≥ 0.80 | **40.0%** | G goalkeeper 64.6% |
| A ≥ 0.70 | **42.8%** | G goalkeeper 67.5% |

Fixtures C and D (developmental) have **zero** cases at A ≥ 0.90 — no
programme is plausible enough to qualify. This is an at-or-above-level
phenomenon, not a D3 one, and it is the dominant case rather than an edge.

### φ sensitivity — φ is the wrong lever

| φ | Fixture A J100 | corr(strength, P) A | corr(strength, P) G | rescued (A) | weak-core promoted (A) |
|---|---|---|---|---|---|
| **0.35** (current) | 1.000 | **−0.507** | **−0.876** | 0 | 0 |
| 0.45 | 0.942 | −0.553 | −0.901 | 0 | 0 |
| 0.55 | 0.818 | −0.626 | −0.918 | 0 | 0 |
| 0.65 | 0.695 | −0.697 | −0.930 | 2 | 2 |
| 0.75 | 0.626 | **−0.758** | **−0.939** | 4 | 4 |

Two findings, both against raising it:

1. **Raising φ makes the programme-strength tilt worse, not better.** With φ
   high, R ≈ A, and A is high precisely where the programme is weak. The floor
   trades roster bias for a purer version of the strength bias.
2. **`rescued` equals `weak-core promoted` at every φ, on every fixture.** The
   floor cannot discriminate: each MIT-like case it lifts arrives with a
   genuinely weak-core programme beside it.

### Architectures

| | J25 (A) | corr(s,P) (A) | rescued | weak-core+ | MIT (A) | MIT (C) |
|---|---|---|---|---|---|---|
| CURRENT | 1.000 | −0.507 | 0 | 0 | #539 | #217 |
| R1 φ=0.55 | 0.786 | −0.626 | 0 | 0 | #463 | #198 |
| R1 φ=0.65 | 0.667 | −0.697 | 2 | 2 | #405 | #190 |
| R2 baseline-lift | **0.282** | **−0.832** | 24 | 24 | #239 | #221 |
| R3 demand vs congestion | 0.786 | −0.626 | 0 | 0 | #463 | #198 |

**R1** is φ by another name and carries φ's two defects.

**R2** (plausibility as a baseline that demand lifts above, rather than a
ceiling) is semantically the closest to the brief's hypothesis and
operationally the most destructive: the top 25 turns over almost completely
(J25 0.14–0.39 across fixtures), the strength tilt worsens to −0.83, and 24–47
weak-core programmes enter each top 100. It also breaks the one guarantee the
current form gives: that no amount of roster need lifts a below-level athlete.
MIT still only reaches #239.

**R3 is identical to R1 φ=0.55 on seven of eight fixtures** — and the reason
matters more than the result. Congestion is measured only through current
arrivals, and every fixture's entry year (2027, 2028) is **beyond the arrivals
horizon** of 2026, so `claims = 0` for every programme in every fixture. The
demand/congestion split is not refutable today; there is no congestion
evidence to separate.

### R4 — the recommendation

**Not a formula. An evidence rule, plus the missing signal.**

1. **Refuse the unevidenced zero.** When no player at the position can be
   identified as a starter, `positionalOpportunity` should refuse rather than
   score 0 — the same treatment `NO_ROSTER_ON_FILE` already gets. Measured
   cost, programmes leaving RANKED:

   | fixture | ranked now | zero-core | of those, no starter evidence | remaining |
   |---|---|---|---|---|
   | A/B/C/D midfield | 860 | 282 | **176** | 684 |
   | E defence | 861 | 315 | 188 | 673 |
   | F forward | 857 | 35 | 26 | 831 |
   | **G goalkeeper** | 858 | 585 | **453** | **405** |
   | H women's defence | 1,151 | 398 | 218 | 933 |

   Honest, and expensive — 53% of the goalkeeper list. It is the correct
   reading of the contract and it makes the minutes-coverage problem visible
   instead of silently scoring it as absence of demand.

2. **Fill the empty C slot.** For a domestic athlete
   `internationalPropensity` is `NOT_APPLICABLE`, so the core *is* roster
   demand with nothing balancing it. A measured alternative exists.

### Domestic coach-propensity audit

`recruiting_arrivals`, 88,879 rows.

| column | populated |
|---|---|
| `entry_type` | 100% — FRESHMAN 68.1%, EXPERIENCED 30.3%, UNKNOWN 1.7% |
| `canonical_position` | 100% |
| `coach` | 86.0% (`coach_attribution`: ATTRIBUTED 65,543, INHERITED 9,470, UNKNOWN 13,866) |
| `class_label_raw` | 98.6% |
| `prior_programme` | **14.6%** |
| `country` / `region` | 19.1% |

Sample sizes: 2,048 programmes, median 43 arrivals each (p10 15). Per
programme × position, median 9 (p10 2).

**Split-half reliability of the experienced-arrival rate**, odd against even
seasons — the same test that rejected newcomer minutes share at r = 0.05:

| unit | units | split-half r | verdict |
|---|---|---|---|
| **per programme, ≥5 per half** | 1,693 | **0.663** | **USABLE** |
| per programme, ≥10 per half | 1,673 | 0.664 | USABLE |
| per programme × position, ≥5 per half | 3,176 | 0.441 | MARGINAL |
| per coach, ≥5 per half | 1,635 | 0.623 | USABLE |

Confounds measured: corr with `soccer_score` **0.265**, with arrival count
**0.066**. Neither is disqualifying (the bench term removed at A7.3 ran to
0.945).

Division medians differ materially — D3 0.17, D1 0.33, D2 0.33, NAIA 0.42 — so
a programme rate must be read **relative to its division**, exactly as
`fillPropensity` already is.

**Candidate signals, ranked:**

1. **Programme freshman-intake share** (1 − experienced share), per programme,
   division-relative. r = 0.663, 1,693 programmes, low confound. *This is a
   real answer to "does this programme recruit players like this athlete" for
   a high-school recruit, and it is the strongest candidate to occupy the C
   slot.*
2. **Coach-level freshman share.** r = 0.623 on 1,635 coaches. Attractive
   because it survives a coaching change, but `coach` is 86% populated and
   9,470 rows are INHERITED rather than observed. Secondary.
3. **Programme × position freshman share.** r = 0.441 — marginal, and A7.3's
   precedent is to refuse marginal.
4. **Recruits-up/across/down from `prior_programme`.** **Rejected.** Only
   14.6% of rows carry a prior programme, only 12,951 resolve to two scored
   programmes, and just **5 programmes** reach 30 observations. Same refusal
   as programme-level fill history.

**Not proposed for implementation here.** A new core component changes R for
every programme and needs its own phase, its own weights and its own coverage
rule — including the fact that adding a 0.3-weight component to a core with a
0.6 coverage floor does not by itself save a programme whose positional
evidence is refused.
