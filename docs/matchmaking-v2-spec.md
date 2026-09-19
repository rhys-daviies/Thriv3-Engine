# Matchmaking V2 — mathematical specification

**A6. Design only. Nothing here is implemented, and V1 (frozen at `cc6e337`) is untouched.**

The target is PURSUIT PRIORITY: *how strongly should Thriv3 spend outreach effort on
this programme for this athlete?* Not *which school resembles where athletes
historically enrolled* — that is what V1 measures and it is the wrong question,
because destination is decided as much by who recruited, visited and offered
first as by fit.

Every number in this document was measured against the working database on
2026-09-19. Where a claim is an assumption it says so.

---

## 1. Layer semantics

Five layers. Four produce scores; the fifth is a combination rule and produces
no evidence of its own.

### A. Eligibility / hard viability

| | |
|---|---|
| **Question** | Can this athlete be considered here at all? |
| **Output** | `ELIGIBLE` \| `EXCLUDED(reason)` — **not a number** |
| **UNKNOWN** | Not permitted. A rule we cannot evaluate returns `ELIGIBLE` and records the gap. |
| **Hard-blocks** | **Yes. The only layer that may.** |
| **Gates** | No — it removes rather than scales. |

Exclusions are counted and returned so the UI can say what was removed, as V1
already does. **Nothing may be excluded for being a poor fit**; this layer
carries sport availability, programme active status, athlete-stated division and
conference constraints, the athlete's academic floor, and operator suppressions
from `athlete_programmes`. An athlete's eligibility to compete is *not* here —
we hold no data on it (§17).

### B. Coach Recruitability

| | |
|---|---|
| **Question** | How plausible is it that this programme would recruit this athlete? |
| **Output** | `[0,1]` ∪ `UNSCOREABLE` |
| **0** | Implausible on the evidence — not "no evidence". |
| **0.5** | **Has no privileged meaning.** It is the middle of the range and nothing else. No prior sits here. |
| **1** | As plausible as this model can express. |
| **UNKNOWN** | **Permitted, as `UNSCOREABLE`** — a distinct state, never a number. |
| **PARTIAL** | Permitted: scored from a subset of components, carrying reduced coverage. |
| **Hard-blocks** | No. |
| **Gates** | **Yes** — gates Pursuit Priority. |

### C. Financial Viability

| | |
|---|---|
| **Question** | Can this athlete plausibly make this school financially workable? |
| **Output** | `[0,1]` ∪ `UNSCOREABLE` |
| **0** | The funding gap is not plausibly closeable. |
| **0.5** | Mid-range gap. No prior meaning. |
| **1** | No gap, or a gap the family has stated it will cover. |
| **UNKNOWN** | Permitted as `UNSCOREABLE`. |
| **PARTIAL** | Permitted. |
| **Hard-blocks** | **No** — financial difficulty demotes, never deletes (product decision). |
| **Gates** | **Yes** — gates Pursuit Priority. |

### D. Athlete Opportunity / Fit

| | |
|---|---|
| **Question** | Would attending be a good outcome for this athlete? |
| **Output** | `[0,1]` ∪ `UNSCOREABLE` |
| **0** | Nothing here serves the athlete's stated priorities. |
| **1** | Everything does. |
| **UNKNOWN** | Permitted. |
| **PARTIAL** | Permitted — and normal, since most athlete preferences are uncollected. |
| **Hard-blocks** | No. |
| **Gates** | **No.** Deliberate: a programme the athlete is lukewarm about but can attend and be recruited by is a legitimate option. Gating fit produces a list of four schools. |

### E. Pursuit Priority

| | |
|---|---|
| **Question** | How strongly should we spend outreach effort here? |
| **Output** | `[0,100]` ∪ `UNRANKED` |
| **UNKNOWN** | Inherited: if a gating layer is `UNSCOREABLE`, the programme is `UNRANKED`. |
| **Hard-blocks / gates** | Neither — it *is* the combination. |

**Evidence semantics, all layers.** Every component returns
`{ value, grade, basis }` where `grade ∈ {MEASURED, PARTIAL, UNSCOREABLE}` and
`basis` names the rule or data that produced it. A layer additionally returns
`coverage` — the weight-share of its components that were `MEASURED` or
`PARTIAL`. See §9.

---

## 2. Signal ownership matrix

`WIRED` = used by V1 today. `AVAILABLE` = in the repo, unused. `ABSENT` = not held.

### Athlete

| Signal | Primary layer | Secondary | Must NOT appear in | Status |
|---|---|---|---|---|
| `football_ability` (1–10) | **B** (athletic plausibility) | D (playing opportunity) | C — see §3 | WIRED |
| `position` | **B** (positional need) | D | — | WIRED |
| `recruiting_class_year` | **B** (entry year for the cohort) | — | — | WIRED |
| `gpa`, `sat_score`, `act_score` | **A** (academic floor) | D (academic fit) | **C** — see §5 | WIRED |
| `budget_range` | **C** (family contribution) | — | B, D | WIRED |
| family income band | **C** | — | — | **ABSENT — blocks §5** |
| `intended_major` | **D** | — | — | AVAILABLE (column exists; **form does not collect it**) |
| `state`, `city` | **D** (distance) + **C** (residency) | — | B | WIRED |
| `nationality` / `origin` | **B** (international propensity) | — | D | WIRED |
| `criterion_ranking` | **D** weights + **E** weights | — | — | WIRED (V1: global weights) |
| recruit type (freshman/transfer) | **B** | — | — | **ABSENT** |
| eligibility remaining | **A** | — | — | **ABSENT** |

### Programme

| Signal | Primary | Secondary | Must NOT appear in | Status |
|---|---|---|---|---|
| `soccer_score` | **B** (as *delta* to athlete) | — | **D as a level term**, C | WIRED |
| `recent_win_pct − prior_win_pct` (trajectory) | **D** | — | B | WIRED |
| `recent_win_pct` (level) | — | — | **nowhere** — r=0.399 with `soccer_score` | WIRED (drop) |
| `division` | **C** (aid rules) + **A** | B (via eligibility) | — | WIRED |
| `conference` | **C** (Ivy rule) + **D** (title) | A | — | WIRED |
| eligibility ceiling / confirmed openings | **B** (need) | — | D | WIRED (A5.3) |
| returning positional depth | **B** (need, negatively) | — | **D — see §3.4** | AVAILABLE (`positionAvailability`) |
| `projected_minutes` / vacated starter quality | **B** (need quality) | **D** (minutes available) | — | WIRED (B only) |
| historical opening behaviour (`positionHistory`) | **B** | — | — | **AVAILABLE, unused** |
| `recruiting_arrivals` (current cycle) | **B** (need already met) | — | — | **AVAILABLE, unused** |
| freshman / newcomer share | **D** (first-year minutes ladder) | B | — | **AVAILABLE, unused** |
| international share of roster | **B** (propensity) | — | D | WIRED (inside geography) |
| same-country players | **B** | — | D | WIRED (inside geography) |
| `net_price` | **C** | — | B, D | WIRED |
| income-bracketed net price | **C** (preferred basis) | — | — | **AVAILABLE on disk, not imported** |
| `cost_of_attendance_academic_yr` | **C** | — | — | **AVAILABLE on disk (1,455/1,462)** |
| `tuition_in_state` / `out_state` | **C** (residency) | — | D | WIRED |
| athletic-aid rules | **C** | — | — | WIRED |
| `academic_rating`, `sat_avg`, `admit_rate` | **A** (floor) + **D** (academic fit) | — | **C** | WIRED |
| `notable_majors` | **D** | — | — | AVAILABLE (evidence layer only) |
| postseason / conference champion | **D** | — | B | WIRED (email only) |
| continuity / turnover | **B** | — | — | AVAILABLE, unused |
| roster limits / scholarship counts | **B** and **C** | — | — | **ABSENT** |

---

## 3. Double-counting risks, measured

Programme-level correlations, men's soccer, entry 2028, midfield, n=880.

### 3.1 Confirmed redundant — never score both

| Pair | r | Ruling |
|---|---|---|
| roster international share × arrivals international share | **0.941** | One signal. Keep the roster share; drop the arrivals variant. |
| position group size × arrivals at position | **0.730** | Arrivals **must** be normalised by group size or it measures squad size. |
| returning depth × arrivals at position | **0.673** | Same cause. Do not add both. |
| returning depth × position group size | **0.629** | Returning depth must be a *ratio* to typical starter count, not a count. |

### 3.2 Partly shared — one composite, not two terms

| Pair | r | Ruling |
|---|---|---|
| confirmed openings × vacated starter quality | 0.468 | Vacated quality is a *weighting* of openings, not a second term. |
| confirmed openings × position group size | 0.489 | Normalise openings by group size. |
| `academic_rating` × `net_price` | 0.448 | Academic fit (D) and affordability (C) partly cancel. Acceptable **because they sit in different layers**; would be a defect inside one. |
| `soccer_score` × `recent_win_pct` | 0.399 | Drop win-rate *level*. Keep only trajectory. |

### 3.3 Reassuringly independent — the model needs these

| Pair | r |
|---|---|
| `soccer_score` × `net_price` | **0.008** |
| confirmed openings × returning depth | −0.171 |
| `soccer_score` × confirmed openings | −0.207 |

Affordability carries genuinely new information relative to programme level.

### 3.4 The sharpest risk in the new architecture, which the brief does not name

**Athletic level and returning depth each drive TWO layers in opposite directions.**

- Athlete far above programme level → *more* recruitable (B) **and** *more*
  likely to play (D) **and**, in V1, a larger expected award (C).
- Deep returning depth at the position → *less* need (B) **and** *less* playing
  time (D).

Putting each in both layers and then combining multiplies one fact by itself.

**Ruling.** Each quantity has exactly one primary home, and the other layer may
use only a *derived quantity that is not a monotone function of it*:

- Athletic delta lives in **B**. Layer D may not use delta. D's playing-opportunity
  term uses **minutes actually available** (vacated starter minutes ÷ projected
  competition) and the programme's **observed first-year minutes ladder** — both
  measured from roster history, not from the athlete's own level.
- Returning depth lives in **B**. D's competition term uses the same rows but as
  *projected minutes held by returners*, which is a minutes quantity, not a count.
- **Athletic delta must be removed from C entirely** (§5).

### 3.5 `programQuality` does not survive

Measured in V1: athletic fit × programme quality correlate **r = +0.893** for an
ability-9.5 athlete and **r = −0.864** for an ability-3 athlete. It is not a
constant double count — it is a *sign-flipping* one, and together the two
criteria carry 40% of V1's weight on one axis. For a fixed athlete,
`quality(p)` and `A_plaus(a−p)` are deterministically related.

**Delete the level component.** Programme standing enters D only through
components nearly independent of `soccer_score`: trajectory, postseason round,
conference title.

---

## 4. Coach Recruitability

### 4.1 The input scale is broken, and this is the highest-leverage fix

`level = football_ability × 10` is the input to every athletic calculation.
Against the real distribution of 1,069 men's programmes (range 15–100, median 48):

| slider | `×10` level | % of programmes at or below | quantile-map level |
|---|---|---|---|
| 1 | 10 | **0.0%** | 27.8 |
| 2 | 20 | **0.7%** | 35.6 |
| 3 | 30 | 7.2% | 39.5 |
| 5 | 50 | 54.3% | 46.3 |
| 8 | 80 | **94.3%** | 59.8 |
| 9 | 90 | **97.9%** | 69.5 |
| 10 | 100 | 100.0% | 81.5 |

Two slider values are unusable at the bottom; three are compressed into the top
6% at the top — exactly where Division I discrimination matters. **Replace with
a quantile map** onto the sport's programme distribution:

```
q_athlete = (ability − 0.5) / 10                    ∈ (0,1)
q_prog    = empirical CDF of soccer_score, within sport
δ         = q_athlete − q_prog                       ∈ (−1,1)
```

δ is then in percentile units and means the same thing everywhere. **This must
be calibrated per sport and re-derived whenever `soccer_score` is rebuilt.**

### 4.2 Athletic plausibility — the Gaussian does not survive

V1 uses a Gaussian peaked slightly above the programme's level, decaying on both
sides. That shape answers *"is this a good outcome for the athlete"*, which is
Layer D's question. **A coach at a weaker programme is not less interested in a
much stronger player.** Recruitability in the athletic dimension is monotone and
saturating:

```
A_plaus(δ) = 1 / (1 + exp(−(δ − δ₀) / s))          logistic, δ₀ ≈ 0, s ≈ 0.12
```

The over-qualification penalty moves to D, where it becomes a *preference-weighted*
term (some athletes want to be the best player in the squad; others want stretch).

A "serious athletic reach" is then definable rather than asserted: δ below the
point where `A_plaus < 0.15`, i.e. roughly 20 percentile points below programme
level at s = 0.12. Calibrate s; do not pick it.

### 4.3 The ceiling — three candidates

Requirement: money, academics and roster need must not make a clearly
under-level athlete appear recruitable.

| Candidate | Form | Assessment |
|---|---|---|
| **(a) Separate ceiling** | `R = min(f(A_plaus), additive core)` | Counts athletic twice — once in the core, once in the ceiling. Reject. |
| **(b) Pure multiplier** | `R = A_plaus × Core` | A perfect-fit programme with no positional need scores 0. Too harsh; need is a modulator, not a precondition. Reject. |
| **(c) Bounded multiplier — RECOMMENDED** | `R = A_plaus × (φ + (1−φ)·Core)` | Athletic appears **once**, as the ceiling. `A_plaus = 0.1` ⇒ `R ≤ 0.1` whatever the other evidence says. `φ ≈ 0.35` keeps a plausible athlete visible at a programme with no current need. |

With (c), athletic plausibility is *the* ceiling — there is no second athletic
term anywhere in B.

### 4.4 Positional need — not "number of seniors"

Four measured components, then two modulators.

```
openings      = EXPIRED at position at entry year          (A5.3 eligibility ceiling)
vacatedQuality= Σ projected minutes of those leavers, ÷ a starter season
returning     = ELIGIBLE_TO_REMAIN at position
typicalStarters = median players reaching 600+ minutes at this position
                  (shared/lifecycle/positionUtilisation.js — already computed)

NetNeed = (openings·(1 + λ·vacatedQuality) − returning) / typicalStarters
```

Normalising by `typicalStarters` rather than by `EXPECTED_ANNUAL_NEED` removes
the group-size confound (r = 0.489 / 0.629). Then:

```
Need = clamp01(NetNeed) × alreadyRecruited × fillPropensity
```

- **`alreadyRecruited`** — from `recruiting_arrivals` for the current cycle:
  a programme that has already signed two midfielders needs a third less.
  Must be normalised by group size (r = 0.730).
- **`fillPropensity`** — the historical answer to *does an opening here actually
  become a newcomer's place?* Measured pool-wide: across 4,750 programme-position
  openings, a true freshman reached a starter's season **48.4%** of the time and
  any newcomer **45.9%**. This is the measured prior that replaces the assumption
  that a departure equals demand.

**Coverage floor.** Only **25.5%** of programme-positions have ≥3 openings and
**50.5%** have ≥3 readable transitions. Below the floor, `fillPropensity`
falls back to the **pool** rate (which is measured, not assumed) and the
component is graded `PARTIAL`.

### 4.5 Programme recruiting behaviour

Of the candidate signals, only these are independent enough to score:

| Signal | Keep? | Why |
|---|---|---|
| International share of roster | **Yes** | The spread is real: 105 men's programmes carry none, 116 are over 60%. |
| Same-country players | **Yes** | Strongest evidence of a live pipeline; distinct from the share. |
| Arrivals international share | **No** | r = 0.941 with roster share. |
| Transfer propensity | **Not yet** | `prior_programme` resolves ~16% at D1 and 3% at D3; a rate over that denominator measures scraping coverage, not behaviour. |
| Continuity / turnover | **Not yet** | Measures retention, which under the 2026 rule change has no forward meaning (§13). |

International propensity moves **out of geography** and into B, per the locked
principles. For a domestic athlete it is `UNSCOREABLE`, not 0 — the component
simply does not apply, and its weight is redistributed within B.

### 4.6 Recruit type

**Architect for it; do not implement.** The athlete side has no recruit-type
field at all. The programme side can already distinguish `FRESHMAN` from
`EXPERIENCED` arrivals (87,449 rows, 2023–2026), so the *programme* half is
ready and the *athlete* half is absent. Design `Need` and `fillPropensity` to
take an `entryType` parameter defaulting to `FRESHMAN`, and populate it when
intake collects it.

### 4.7 Proposed submodel

```
Core_B  = w₁·Need + w₂·IntlPropensity                    (weights renormalised
                                                          over scoreable parts)
R       = A_plaus(δ) × (φ + (1 − φ)·Core_B)
```

---

## 5. Financial Viability

### 5.1 The equation, and one correction to the brief

The brief proposes
`FundingGap = EffectiveCost − NonAthleticAid − FamilyContribution`.

**Subtracting non-athletic aid from a net price double-counts it.** Net price is
*already* cost after all grant aid. The equation is only correct if
`EffectiveCost` is the **sticker** cost of attendance:

```
EffectiveCost   = COA (+ out-of-state premium where the institution is public
                       and the athlete is not a resident)
NonAthleticAid  = grant aid this family would typically receive
FundingGap      = EffectiveCost − NonAthleticAid − FamilyContribution
AthleticNeeded  = FundingGap                       (what a coach must close)
```

And `EffectiveCost − NonAthleticAid` **is** the income-bracketed net price. So:

```
CostAfterInstitutionalAid = net_price[income_bracket]       ← preferred
                          = net_price + OOS premium          ← fallback, averaged
                                                               over all incomes
```

### 5.2 Data audit

| Input | Availability |
|---|---|
| Scorecard join | **1,462 of 1,462** active unitids — 100% |
| `cost_of_attendance_academic_yr` | 1,455 |
| Income-bracketed net price | 676 public + 779 private = **1,455** |
| `tuition_in_state` / `out_state` | 1,457 |
| Athletic-aid rule | D1/D2/D3/NAIA configured; **NJCAA/USCAA `UNKNOWN`** |
| **Family income band** | **ABSENT** |

### 5.3 The blocking gap

The income-bracketed net price is the single most valuable unused asset in the
repository **and it cannot be used today.** It is indexed by *family income*;
intake collects *budget* — what a family says it will pay. These are different
quantities, and inferring one from the other is exactly the kind of assumption
this project has repeatedly had to unwind.

**Owner decision required (§16).** Until intake collects an income band, Layer C
must use the averaged `net_price` and grade itself `PARTIAL`.

### 5.4 Merit aid — and why "strong GPA = more money" stays out

A defensible proxy exists: at private institutions,
`COA − net_price[110k+ bracket]` is the discount given to families with no
demonstrated need. Measured over 771 private institutions: median **$24,132**,
p25 $18,316, p75 $31,069, **min $0**, max $51,245.

It varies widely, so it discriminates — and the `$0` floor is the important part:
some institutions discount nothing.

**But it must not be added as athlete-specific merit leverage**, because a
family in a lower bracket already has that discount inside their bracket price.
Adding it again is double counting. Ruling:

- Bracket price already embeds **average** institutional generosity, need and merit.
- **Above-average merit leverage requires institutional evidence we do not hold.**
  Default `meritLeverage = 0`, graded `UNSCOREABLE`.
- The proxy may be surfaced as *context* ("this institution discounts even at
  high incomes") and must not enter the score.

### 5.5 Athletic aid

Unchanged from V1's repaired form: per division and sport, conference override
for the Ivy League, and **`UNKNOWN` never becomes zero**. `NJCAA`/`USCAA` return
`UNKNOWN`, which propagates as reduced coverage rather than a claimed
no-scholarship environment.

The **award concentration term must move out**. V1 scales the expected award by
how far the athlete is above the programme's level — putting athletic delta into
the financial layer and counting it a third time (§3.4). It is a real effect and
it belongs in the *reported award range*, not in Financial Viability's score.

### 5.6 Viability from the gap

```
Gap       = max(0, CostAfterInstitutionalAid − AthleticAidExpected − FamilyContribution)
scale     = max(8_000, FamilyContribution × 0.6)
F         = φ_F + (1 − φ_F) · exp(−Gap / scale)
```

### 5.7 Behaviour under missing data — the rule that matters

| Missing | V1 behaviour | **V2 requirement** |
|---|---|---|
| Family contribution | neutral prior 0.5 | `UNSCOREABLE` |
| Net price | neutral prior 0.5 | `UNSCOREABLE` |
| Merit aid | n/a | `UNSCOREABLE`, weight redistributed |
| Athletic-aid rule | claimed 0 (fixed in A5.1) | `UNSCOREABLE` |

**No combination of missing inputs may produce a score above the mid-range.**
The failure mode to design against is a programme looking affordable because we
know nothing about it.

---

## 6. Athlete Opportunity / Fit

Distinguish sharply from B: **a programme can be willing to recruit an athlete
and still offer poor playing time.** These are different questions and V1 conflates
them inside one Gaussian.

| Component | Source | Status |
|---|---|---|
| Projected playing opportunity | vacated starter minutes ÷ projected returning competition; programme's first-year minutes ladder | AVAILABLE, unused |
| Intended-major availability | `notable_majors` × `intended_major` | AVAILABLE — **form does not collect the major** |
| Programme trajectory | `recent − prior` win rate | WIRED |
| Postseason / conference title | `postseason_2025_round`, `conference_champion_2025` | WIRED (email only) |
| Distance from home | state centroid → coordinates | WIRED (as "geography") |
| Academic quality + admissibility | `academic_rating`, `sat_avg`, `admit_rate` | WIRED |
| Athlete explicit priorities | `criterion_ranking` | WIRED |

**Programme level is deliberately absent** (§3.5).

**Geography moves here in full**, per the locked principles. Its two
non-preference jobs leave: residency pricing → C, international propensity → B.
Note the consequence — V1's `need-favours-staying-in-state` coupling, which
weights location up for money reasons, **must be deleted**; the in-state benefit
is priced once, in C.

### Athlete priorities: which of A / B / C?

**Answer: A — inside this layer only.**

`criterion_ranking` expresses what the athlete values *in an opportunity*. Using
it to reweight the Pursuit Priority combination as well would let a stated
preference change how much *recruitability* or *financial viability* matter,
which are facts about the world rather than matters of taste. An athlete cannot
prefer their way into being recruitable.

One exception worth an owner decision: a stated *willingness to pay above budget*
is a statement about C's input, not about weights.

```
O = Σ wᵢ·componentᵢ   over scoreable components, weights from criterion_ranking,
                       renormalised over what is scoreable
```

---

## 7. Evidence architecture — MEASURED / PARTIAL / UNSCOREABLE

### 7.1 `ASSUMED` is abolished

V1 has four grades and the fourth, `ASSUMED`, is the neutral prior — a number
that *looks like* a score and is not one. It produces the inversion this layer
exists to remove:

> At entry 2027, **72% of men's programmes we hold a roster for** score a
> *measured* zero on roster opportunity, while the **441 we hold no roster for**
> keep 0.5. A programme we have data for sits **0.298 below** one we know
> nothing about.

**V2 has three grades.** `UNSCOREABLE` is a state, not a value, and never
participates in arithmetic.

### 7.2 The A-vs-B question, answered

> Programme A: measured positional need = 0. Programme B: no roster data.

They are **not comparable on that component**, and the architecture must say so
rather than resolve it:

1. **Within a layer**, an `UNSCOREABLE` component is *dropped* and the remaining
   weights renormalised. A's `Need = 0` counts; B's does not exist. B's layer
   score is then computed from fewer components and its **coverage** falls.
2. **Coverage is carried, not folded in.** `Layer = { value, coverage }` where
   coverage is the weight-share that was scoreable.
3. **Below a coverage floor the layer is `UNSCOREABLE`**, and a programme whose
   *gating* layer is unscoreable is `UNRANKED` — listed in a separate, labelled
   bucket, never interleaved with scored programmes.

So A is ranked on a measured zero. B is either ranked on its other evidence with
visible low coverage, or placed in the unscoreable bucket. **B never outranks A
by virtue of our ignorance.**

### 7.3 Why not an uncertainty penalty

A penalty (`value − k·(1−coverage)`) is tempting and wrong here: it converts
"we don't know" into "this is worse", which is a different claim and would bury
the 239 NJCAA programmes for a reason that is about us rather than them. Bucket
them; do not defame them.

### 7.4 The acid test: NJCAA

| Layer | NJCAA coverage |
|---|---|
| Eligibility | fine |
| **Recruitability** | **0% roster, 0% history, 0% arrivals, 58% soccer_score** → `UNSCOREABLE` |
| Financial | 99% net price, 99% tuition → scoreable |
| Opportunity | partial (no playing-time evidence) |

228 men's programmes — 20% of the pool — are **financially scoreable and
recruitability-unscoreable**. Any architecture that produces a single number for
them is lying. This is the case the bucket design exists for.

---

## 8. Pursuit Priority — comparison of rules

Evaluated with illustrative weights R 0.45 / F 0.30 / O 0.25.

| Scenario | R | F | O | additive | multiplicative | geometric | min | **gated** |
|---|---|---|---|---|---|---|---|---|
| A excellent × 3 | .95 | .92 | .93 | 93.6 | 81.3 | 93.6 | 92.0 | **93.6** |
| B great recruit, **poor finance** | .95 | .15 | .95 | **71.0** | 13.5 | 54.6 | 15.0 | **19.9** |
| C **poor recruit**, great finance+fit | .18 | .95 | .95 | 60.3 | 16.2 | 44.9 | 18.0 | **28.0** |
| D strong R+F, **poor fit** | .85 | .85 | .20 | 68.8 | 14.4 | 59.2 | 20.0 | **68.8** |
| F athletic reach, big need | .30 | .70 | .85 | 55.8 | 17.8 | 50.2 | 30.0 | 55.8 |
| G target, little need | .62 | .75 | .70 | 67.9 | 32.5 | 67.7 | 62.0 | 67.9 |
| H cheap strong-academic D3 | .70 | .95 | .72 | 78.0 | 47.9 | 77.3 | 70.0 | **78.0** |
| I expensive D1 reach | .34 | .22 | .90 | 44.4 | 6.7 | 38.1 | 22.0 | **22.1** |

Orderings:

```
additive        A > H > B > D > G > C > F > I     B third — the floor problem
multiplicative  A > H > G > F > C > D > B > I     collapses everything; D punished as if fatal
geometric       A > H > G > D > B > F > C > I     B fifth at 54.6 — too lenient on near-fatal finance
min             A > H > G > F > I > D > C > B     discards all but the worst dimension
gated           A > H > D > G > F > C > I > B     ✔
```

**Gated additive is confirmed on evidence, not by instruction.** It alone
satisfies all four product principles simultaneously: B (poor finance) falls
from 71.0 to 19.9 — demoted, not deleted; C and I (athletic reaches) are
constrained to 28.0 and 22.1 but remain visible; D (poor fit) stays at 68.8
because fit is not gated; A and H remain on top.

### 8.1 Recommended rule

```
Core = (w_R·R + w_F·F + w_O·O) / (w_R + w_F + w_O)        over scoreable layers

g(v, κ, γ) = 1                    if v ≥ κ
           = (v / κ)^γ            if v < κ

PursuitPriority = 100 · Core · g(F, κ_F, γ_F) · g(R, κ_R, γ_R)
```

Properties that matter:

- **Additive in the normal range** — explicable, tunable, and every existing
  breakdown UI keeps working.
- **Superlinear below κ** — a near-fatal dimension leaves the actionable hundred
  rather than costing fifteen places.
- **Auditable** — `g < 1` is a fact the card can state in words.
- **Only two gates.** Never gate O.
- **A gate must not fire on an `UNSCOREABLE` value.** If a gating layer is
  unscoreable the programme is `UNRANKED` (§7.2).

---

## 9. Parameters requiring calibration

**None of these should be chosen by intuition.**

| Parameter | Meaning | Calibrate from |
|---|---|---|
| `q_prog` CDF | programme quantile map | Current data — deterministic |
| `s`, `δ₀` | logistic width / offset of athletic plausibility | Engagement (replies) |
| `φ` | recruitability floor under the athletic ceiling | Engagement |
| `λ` | weight of vacated starter quality | Current roster history |
| `typicalStarters` | per position, per division | **Already computed** |
| `fillPropensity` | opening → newcomer rate | **Already measured: 48.4% / 45.9%** |
| `κ_F`, `γ_F` | financial gate point and steepness | Commitment / cost outcomes |
| `κ_R`, `γ_R` | recruitability gate point and steepness | Engagement |
| `w_R`, `w_F`, `w_O` | layer weights | Engagement + outcomes |
| coverage floor | when a layer becomes unscoreable | Current data (distributional) |
| `φ_F`, `scale` | affordability floor and decay | Cost outcomes |

---

## 10. Calibration plan — what is possible now

### Now, from current data

- **`q_prog`** — the quantile map. Deterministic, per sport.
- **`fillPropensity`** — measured (4,750 openings).
- **`typicalStarters`** — already in `positionUtilisation.js`.
- **`λ`** — from whether vacated *starter* minutes predict a newcomer starter better than vacated minutes generally.
- **Coverage floors** — from the distribution of scoreable weight-share.
- **Sanity invariants** — no athlete's top 100 is ≥90% one division without a stated reason; no `UNSCOREABLE` programme outranks a measured one.

### Not now — and the honest statement

**Destination backtests cannot calibrate recruitability.** `npm run backtest`
measures where athletes *ended up*. Measured directly in this repository:
opportunity at the school an athlete chose (0.445) is **no higher than at a
programme drawn at random** (0.447). A parameter tuned to maximise recall on
destinations is tuned to reproduce enrolment patterns — which is the question
this rebuild exists to stop answering.

So `s`, `φ`, `κ_R`, `γ_R` and the layer weights are **heuristic at launch** and
must be declared as such.

### Future, from outreach

Engagement tables already exist (`outreach_send_event`, `engagement_rollup`,
`programme_contact_attempts`). The ladder: sent → delivered → opened → replied →
positive reply → call → evaluation → offer → amount → commitment.

- **Replied / positive reply** calibrates `R` directly. This is the one signal
  that actually answers *"would this coach want this athlete"*.
- **Offer and amount** calibrate C's award model — the first per-player award
  data that would exist anywhere in this project.
- **Commitment** calibrates the combination weights.

**The 2026 → 2027 roster scrape remains the highest-value single acquisition**:
the first observation of fifth-year uptake, which is the largest unknown in B.

---

## 11. Synthetic regression scenarios

Expected *qualitative* behaviour. These become V2 fixtures.

| # | Athlete | Expected |
|---|---|---|
| 1 | Elite NZ international, ability 9 | Top ranks are D1 with international history and same-country players. Programmes with zero internationals demoted via B, not removed. |
| 2 | Strong D1-level domestic, ability 8 | D1/D2 dominate. 2027 entry shows **few confirmed openings** at D1 (transition squeeze) — `Need` low, `A_plaus` high; must not collapse the list. |
| 3 | D2-level target, ability 6 | D2/NAIA top. D1 constrained by the ceiling, still visible. |
| 4 | Developmental, ability 3 | **No elite programme in the actionable hundred.** V1 puts one at rank 262 with athletic fit 0.00; V2's ceiling must put it far lower. NJCAA should not sweep the list by default (see #10). |
| 5 | Goalkeeper, any level | `typicalStarters` ≈ 1 at GK, so one departure is decisive. Must not saturate every GK's `Need` at 1.0. |
| 6 | Low budget, ability 7 | F gates expensive programmes down; D3 (no athletic aid, by rule) demoted on cost but present. Cheap public in-state rises via C, **not** via geography. |
| 7 | High academic, ability 5 | Academic fit lifts O. **Must not lift C** — no merit leverage without evidence. |
| 8 | International, no country cluster anywhere | Same-country component `UNSCOREABLE`; B scored on the remainder with reduced coverage. Must not read as 0. |
| 9 | Transfer (when collected) | `entryType = EXPERIENCED` changes `fillPropensity`. Until intake collects it, defaults to FRESHMAN and says so. |
| 10 | 2027 entrant, any level | D1/D2 show **0.34–0.73 openings per squad**; D3/NAIA **1.45–2.72**. The list should tilt to D3/NAIA on *need* — and this must be visibly attributable to the eligibility transition, not to a scoring artefact. |
| 11 | NJCAA-heavy pool | Recruitability `UNSCOREABLE` for all 228. They belong in the labelled bucket, not at ranks 1–91 as in V1. |

---

## 12. Unresolved owner decisions

1. **Collect a family income band?** Blocks the income-bracketed net price — the single largest available financial improvement. Without it C stays `PARTIAL` for everyone.
2. **Collect `intended_major`?** The column and `notable_majors` both exist; the form does not ask.
3. **Collect recruit type and eligibility remaining?** Without them B cannot differentiate freshman from transfer, and A cannot assess eligibility at all.
4. **How should `UNRANKED` programmes be presented?** A second list, a filter, or suppressed by default. Affects 239 men's programmes.
5. **Does the actionable list stay at 100?** `tierForRank` has no band above 100, and the unscoreable bucket needs somewhere to live.
6. **Is "willingness to exceed budget" a separate intake question?** It is C input, not a weight.
7. **Recalibrate `football_ability` or replace the slider?** The quantile map fixes the *scale*; it does not fix a coarse ten-bucket operator judgement.

---

## 13. Risks and assumptions

| Risk | Note |
|---|---|
| **Fifth-year uptake is unmeasured** | Openings for 2027 span 1.1–7.3 per squad across plausible uptake — a 6.6× range on the nearest class. `Need` is least reliable exactly where it is most used. **Do not invent a retention probability.** |
| Recruitability is uncalibrated at launch | Its weight is the largest in the combination and its parameters are heuristic. State this in the UI. |
| Class label is a proxy for eligibility | No enrolment year, seasons used, or age. Breaks on transfers and late starts. |
| D3 rules may change | A 2027 Convention proposal governs 10,191 of 29,000 men's rows. The rules table is built for it; re-verify in January. |
| Merit proxy is not literally merit | `COA − net_price[110k+]` includes non-need institutional discounting generally. Context only, never scored. |
| Roster limits absent | Under a five-year regime "eligible to remain" and "will be kept" diverge, and caps decide. |
| `soccer_score` is itself a model | Every δ rests on it. A rebuild of it silently re-calibrates the quantile map. |
| Gate discontinuity | `g` is continuous but not smooth at κ. Acceptable for ranking; would matter if gradients were ever fitted. |

---

## 14. Recommended next task — A6.2 implementation spec

Design is not yet buildable. A6.2 should produce, **before any code**:

1. **Module boundaries and signatures** — `shared/matching/v2/{eligibility,recruitability,financial,opportunity,combine}.js`, each pure, each returning `{ value, grade, basis, components }`.
2. **The `UNSCOREABLE` type contract** — how it propagates, how weights renormalise, where the coverage floor is enforced, and how `UNRANKED` reaches the UI without touching `recommendations`/`reserve`.
3. **The quantile map** — derivation, storage, and the invariant that ties it to `soccer_score`.
4. **A parallel-run harness** — V1 and V2 over the same fixtures, reporting rank displacement per layer, so V2 is argued about against the frozen baseline rather than adopted.
5. **The V2 fixture set** — §11, with expectations written as invariants rather than pinned numbers, so calibration can move values without rewriting tests.
6. **Which parameters ship as declared heuristics**, and where that is surfaced.

**Recommended sequence:** A6.2 spec → quantile map + sanity invariants (calibratable today) → Layers A and C (best coverage, least dependent on uncalibrated parameters) → Layer B behind a flag, parallel-run only → Layer D → combination → calibrate on engagement once volume exists.
