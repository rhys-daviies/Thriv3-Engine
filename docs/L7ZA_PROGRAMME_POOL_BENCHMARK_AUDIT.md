# L7ZA — what PROGRAMME_POOL_BENCHMARK actually depends on

L7Y changed six 2025 programme-seasons and moved internal Evidence for **864**
athlete-programme pairs, one of them crossing a comparison band while its own
median never moved. This stage measures why, before anyone changes anything.

**Nothing was changed.** No roster row, no threshold, no cohort, no permission,
no copy. Coverage, manifest and all six baselines are unchanged.

**The headline: the behaviour is mathematically correct and the cohort is
defensible — but the claim misreports its own pool size, and the manifest cannot
see every change that moves the benchmark.**

---

## Containment

Started at `d2a9ca5`, nothing intervening, tree clean. `roster_players` 281,148,
coverage 1,748 / 1,731 / 17 / 14 / 3 = 99.0%, `programme_status` 6, reviews 7,
manifest `4955986edd3bc976`, six baselines PASS, P6. All perturbation
experiments ran against a `VACUUM INTO` copy or inside a rolled-back
transaction.

## Dependency chain

```
roster_players  (sport, season ∈ 2022–2025)
  └─ buildPoolBenchmarks(sport)            server/lib/philosophyQueries.js:140
       ├─ group by college_name            → one bucket per programme
       ├─ programmePhilosophy({rows})      shared/philosophy.js:234
       │    └─ freshmanProfile → byRank    → one median per programme per rank
       ├─ ladders[rank].push(median)       → the quantile sample
       ├─ vacancyObservations(rows)        → one per position-season
       └─ quantile(sorted, q)              → nearest-rank, no interpolation
  └─ poolBenchmarks(sport)                 cached per sport, 15-min recheck
       └─ fingerprint = COUNT(*)|MAX(updated_date) over 2022–2025
  └─ programmePoolBenchmark(athlete, ctx)  shared/evidence/philosophyEvidence.js:283
       ├─ bandOf(top.median, poolRank1)    → comparison.band
       └─ defineEvidence('PROGRAMME_POOL_BENCHMARK', …)
  └─ kinds.js: OPERATOR_EVIDENCE QUALIFIED · OUTREACH DENIED
  └─ operatorEvidence.js / operatorFacts.js → operator panel
  └─ developmentEvidenceCopy.js            → the words a person reads
```

## What it means, in product language

| | |
|---|---|
| **subject** | one programme |
| **measurement** | the median minutes played by its most-used first-year (ladder rank 1) |
| **comparison population** | every programme **in the same sport** with a readable freshman ladder |
| **time window** | 2022, 2023, 2024, 2025 — historical only; 2026 is excluded |
| **statistic** | which quartile of the pool the programme's median falls in |
| **interpretation** | *"first-year opportunity here, against the rest of the sport"* |

It is a **relative** claim by construction. Its value depends on the population
as much as on the programme, and the population is every other programme's
roster data.

## Population unit and weighting

**The programme** — `byProg` groups by `college_name`, and each contributes
exactly one median per ladder rank. A programme with four seasons of history has
no more influence on the quantiles than one with a single season.

**The dials do not work this way.** `vacancyObservations(rows)` yields one
observation per position-season, so a programme with four seasons and five
position groups contributes twenty. Two different population units live in one
object, and L7Y moved both:

```
womens-soccer   programmes 1,202   ladder n (rank 1) 1,045   dial observations 9,014
mens-soccer     programmes   920   ladder n (rank 1)   770   dial observations 6,262
```

Season spread across the 2,122 pooled programme-sports: **1,700 have all four
seasons, 401 have one.**

## Cohort boundaries — measured, not assumed

Perturbation experiments on a copy, each a whole division's historical rows
removed:

| change | women's pool | men's pool |
|---|---|---|
| men's D1 removed | **unchanged** | moved (p25 901 → 895) |
| women's D1 removed | moved (p25 998 → 983) | **unchanged** |
| women's D3 removed | moved (p25 998 → 1000) | **unchanged** |
| 2026 removed (all sports) | **unchanged** | **unchanged** |

* **Sport and gender: fully isolated.** `sport` is the only cohort filter, and
  gender is carried inside it (`mens-soccer` / `womens-soccer`).
* **Division: pooled, not isolated.** A D1 programme is benchmarked against D3
  and NAIA programmes. This is implicit — no code states it and no document
  claims it.
* **Season window: historical only**, `SEASONS = 2022–2025`; `SQUAD_SEASON`
  2026 contributes nothing.
* **No status filter of any kind.** The query reads `roster_players` alone and
  never joins `colleges` or `programme_status`, so `colleges.active = 0`,
  `NOT_ACTIVE` and `FUTURE` programmes all contribute through historical rows.
  Today exactly **one** inactive programme does (Andrew College, men's), and
  none of the six `programme_status` rows has any historical roster data — so
  the absence of a filter currently costs almost nothing, by luck rather than
  by design.

## Data sufficiency

A programme enters the ladder quantiles only if `programmePhilosophy` produced a
`freshman` profile with a rank-1 median. The gap between the two counts is the
readability filter: **1,202 programmes with rows, 1,045 with a usable ladder.**

`sufficient: false` returns nulls rather than zeros when there is not enough on
file — the guard that stops "unread" being drawn as "plays no freshmen".

## Statistic inventory

| statistic | population | notes |
|---|---|---|
| `ladderByRank[rank].{n, p25, median, p75}` | programmes, ranks 1–6 | equal weight |
| `dials.{freshman,newcomer,returning}.{p25,median,p75}` | readable position-seasons | unequal weight, `pct()` → one decimal |
| `fillMix[]` | readable observations, 7 vacancy bins | means, not quantiles |
| `vacancy.{starterDeparted,noStarterDeparted}` | readable observations | share with a fresh starter |
| `byPosition[]` | readable observations per position | share with a fresh starter |
| `programmes`, `observations`, `readable` | counts | |

**Quantile:** `sorted[min(len-1, floor(q * len))]` — nearest-rank, **no
interpolation**, so every reported quantile is an observed value.
**Bands:** `median <= p25` → at-or-below-p25, then `<= median`, then `<= p75`,
else above-p75. A programme sitting *exactly* on a threshold falls in the lower
band.

## Reproducing L7Y

Perturbing the same six programmes on a copy moved
`dials.newcomer.p75` **14.6 → 14.7** — the exact reverse of L7Y's 14.7 → 14.6,
confirming the mechanism — while the rank-1 quantiles held and no band crossed.
So the *class* of effect reproduces; the specific band crossings depended on
L7Y's particular new values.

The band mechanism was then demonstrated directly on measured data:

```
p25 998 → 997 :  1 programme changes band   Saint Mary's (median 998)
p25 998 → 999 :  2 programmes               Charleston, Eckerd (median 999)
p75 1375 → 1374: 3 programmes
programmes with rank-1 median exactly 998:  1 — Saint Mary's
```

**Saint Mary's is precisely the programme L7Y reported flipping.** Its own
median never moved; the population it is compared against moved underneath it.

## Fan-out and boundary sensitivity

**Theoretical fan-out is total within a sport**: the pool block is carried by
every one of the 1,045 benchmarked women's programmes, so any change to a
quantile or a dial reaches every women's pair. Cross-gender, cross-sport and
cross-season fan-out is **zero**.

Observed fan-out is small, because the thresholds are sparse:

| threshold (women's rank 1) | exactly on | within 1 | within 2 | within 5% |
|---|---|---|---|---|
| p25 = 998 | **1** | 5 | 6 | 94 |
| median = 1200 | 1 | 5 | 5 | 168 |
| p75 = 1375 | 3 | 6 | 8 | 183 |

That is why L7Y produced 864 *payload* movements but only **two** band changes:
almost every movement is a number shifting inside an unchanged verdict.

## Self-inclusion

A programme **is** in the pool it is benchmarked against. Measured leave-one-out
across the live corpus: **0 of 1,045 programmes would change band** if their own
value were removed. At this pool size self-influence is immaterial, and
leave-one-out would be a change with no observable effect.

## Alternative cohorts (diagnostic only)

| cohort | n | p25 | median | p75 | programmes that would change band |
|---|---|---|---|---|---|
| **current (sport only)** | 1,045 | 998 | 1,200 | 1,375 | — |
| D1 only | 345 | 1,005 | 1,189 | 1,350 | 23 of 345 |
| D2 only | 235 | 990 | 1,200 | 1,377 | 1 of 235 |
| D3 only | 351 | 988 | 1,187 | 1,369 | 11 of 351 |
| NAIA only | 113 | 948 | 1,242 | 1,467 | **29 of 113** |
| NCAA only | 931 | 1,001 | 1,192 | 1,362 | 30 of 931 |
| active only | 1,045 | 998 | 1,200 | 1,375 | 0 |
| complete 4-season history | 921 | 1,001 | 1,190 | 1,361 | 33 of 921 |

**The NCAA divisions are barely distinguishable** — D1, D2 and D3 p25 values sit
within 2% of one another. Pooling them is therefore not distorting most
programmes: splitting by division would move 23, 1 and 11 programmes
respectively. **NAIA is the genuine outlier** (lower p25, much higher p75), and
26% of NAIA programmes would read differently against their own association.

This is measurement, not a recommendation. A cohort should be chosen because it
is the right comparison, never because it reduces movement.

## Documented intent versus implementation

**Documented** (`docs/EMAIL_INTELLIGENCE.md`): the four Philosophy kinds are
playing-time intelligence, the one category the outreach contract forbids by
name, so *"Philosophy stays operator-only."* That intent is implemented exactly:
`OUTREACH: DENIED`.

**Not documented anywhere**: that the comparison pool crosses divisions and
associations, that it excludes the current season, that it applies no
activity filter, and that the ladder and the dials use different population
units. These are implementation facts no document states — which is why this
audit exists and why the tests added here pin them.

**No intent mismatch on permissions.** One concrete mismatch on reporting, below.

## Surfaces, and why L7Y moved only two

| surface | permission | moved in L7Y |
|---|---|---|
| OUTREACH / EMAIL_BODY / COACH_COMPOSITION | **DENIED** | no |
| OPERATOR_WIRE (`toWire`, gated on the OUTREACH permission) | denied by that gate | no |
| OUTBOUND_DECISION | selector over outreach-permitted kinds | no |
| OPERATOR_EVIDENCE | **QUALIFIED** | **yes** |
| LOG_PAYLOAD | internal record | **yes** |

The kind is structurally barred from every coach-facing surface, which is why a
population-wide statistical shift moved 864 internal payloads and **zero
emails**. The permission model did exactly its job.

## Claim wording

**Accurate about relativity.** The headline a person reads is *"At or below the
pool's 25th percentile"*, the detail states the pool's three quartiles, and
`comparison.basis` names the population and the seasons. `percentile` is
deliberately null with a comment explaining that only a quartile is knowable.
Nothing implies an absolute property of the programme.

**One concrete defect.** `comparison.poolSize` reports `bench.programmes` —
every programme with historical rows — while the quantiles were computed from
`data.pool.n`, the programmes with a readable ladder:

```
womens-soccer   poolSize 1,202   but n = 1,045   overstated by 157
mens-soccer     poolSize   920   but n =   770   overstated by 150
```

The basis string says *"programmes with a readable freshman ladder"* and the
number attached to it counts programmes that had no readable ladder. The claim
overstates its own evidence base by about 15%.

## Reproducibility and the manifest

**Yes — identical programme data can produce a different band**, because the
band is a function of the pool as well as the programme. Saint Mary's is the
worked example.

**And the manifest cannot always explain it.** The dataset fingerprint projects
`roster_players` to `(college_name, sport, season, player_name)`, and
`roster_freshness` watches the **current** season's timestamps. Minutes appear
in neither. Demonstrated on a copy:

```
a historical minutes-only correction, 1,762 rows, 60 programmes
  manifest roster_players digest   UNCHANGED
  manifest roster_freshness        UNCHANGED
  POOL BENCHMARK                   CHANGED
```

A behavioural baseline could move while the dataset line reports UNCHANGED —
which is precisely the misdiagnosis the manifest was built to prevent, in a new
place. L7Y did not hit this because it changed *which players* were present, and
that the fingerprint does see.

## Baseline interpretation

The baselines are **correct but highly coupled**, not incorrect. They faithfully
record that a coach-facing output did not move and an operator-facing one did.
The coupling is a property of a relative claim carried on every pair, not a
defect in the baseline architecture — with the one caveat above, that the
dataset line cannot always account for the movement.

## Classification

**B — INTENDED_BUT_NEEDS_BETTER_EXPLANATION**, with one narrow instance of D.

The evidence for B:

* a relative benchmark *should* move when its reference population moves; that
  is what "percentile among peers" means;
* isolation is exactly where it should be — sport and gender separate, the
  current season excluded, coach-facing surfaces structurally barred;
* the cohort is defensible on the numbers: NCAA divisions differ by under 2%,
  and splitting them would change 1–23 programmes out of hundreds;
* self-inclusion changes no band at this scale;
* observed fan-out is 2 band changes out of 1,045 programmes.

The narrow D: **`comparison.poolSize` reports a different population from the
one the statistic used.** That is an implementation detail not matching its own
stated basis, and it is a factual error in an operator-facing claim.

Not C: the coupling is broad but it is confined to internal surfaces by design,
and the product consequence measured so far is two band changes.

## Recommendation — one action

**Correct `comparison.poolSize` to the population the statistic actually used,
and document the cohort in the kind's own definition.**

`poolSize` should be `data.pool.n` (the readable-ladder programmes), not
`bench.programmes`. It is a one-line change to a number the operator panel
displays, it makes the claim's stated basis and its stated size agree, and it
requires no change to the cohort, the thresholds, the quantile or any
permission.

Alongside it, write the cohort down where the kind is defined: same sport, all
divisions and associations, historical seasons only, no activity filter. Three
of those four facts are currently discoverable only by reading the SQL.

**Explicitly not recommended now:** leave-one-out (measured effect: zero),
division cohorts (the divisions are nearly identical, and NAIA is the only case
worth revisiting), and snapshot or periodic pools. On stability:

* **live pool** — most accurate, least reproducible; a band can change with no
  local cause, and today the manifest cannot always show why;
* **versioned snapshot** — reproducible and auditable, at the cost of going
  stale and needing an explicit version to reason about;
* **periodic** — a compromise that adds a cadence nobody currently has a reason
  to choose.

The reproducibility gap is the one that might justify revisiting this: if the
manifest included a minutes-sensitive component, a live pool would become
auditable and the case for snapshots would weaken further. That is a manifest
question, not a benchmark question, and it belongs to a separate stage.
