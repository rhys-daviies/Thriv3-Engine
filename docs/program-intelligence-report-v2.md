# Program Intelligence Report v2 — Specification

> **Where this file sits.** This is the page-by-page build history: what each
> page shows, why, and what was discovered while building it. For what the
> system *is* — the module map, the thresholds, the claims it may not make and
> the known limitations — read
> [`programme-intelligence-baseline.md`](programme-intelligence-baseline.md),
> which is the current baseline document. Phases 6A through 9C are recorded in
> the branch history and in that file rather than here.

**Status:** specification only. No production code changes accompany this document.
**Branch:** `feature/program-intelligence-report-v2`
**Base:** `1ac5eaa` (`origin/main`)
**Worktree:** `/Users/rhysdavies/Documents/Recruitmatch/app-report-v2` (isolated; the shared `app/` worktree is untouched)

---

## 0. Scope and standing rules

### 0.1 What v2 is

v1 (`renderProgramReport` in `server/lib/philosophyReport.js`) is a single linear document of twelve sections. It is correct, and its safeguards are the most valuable thing in the module. What it is not is *navigable*, and it leaves a large amount of already-computed analysis undrawn.

v2 keeps every safeguard and restructures the document into five layers:

| Layer | Pages | Purpose |
|---|---|---|
| 1 | 1 | Navigation — what is in the report, how deep it goes |
| 2 | 2–3 | Interpretation — the answers a reader needs in ninety seconds |
| 3 | 4–12 | Programme evidence |
| 4 | 13–16 | Athlete evidence |
| 5 | 17+ | Supporting data tables and methodology |

### 0.2 The ten rules, restated as testable constraints

These are the report philosophy given in the brief, written so a test can assert them.

1. **No reduction for brevity.** A section is dropped only when it has no information, never because the report is long.
2. **Conclusions first.** Pages 2–3 carry classification and interpretation; pages 4+ carry the evidence those classifications were drawn from.
3. **Full evidence behind.** Every classification on pages 2–3 names the page its evidence lives on.
4. **Programme interpretation precedes programme evidence.** Page 2 before pages 4–12.
5. **Athlete interpretation precedes athlete evidence.** Page 3 before pages 13–16.
6. **Experienced-arrival analysis is core.** It is Layer 3's centre of gravity (pages 7–10), not an appendix. The repo's own research supports this: transfer usage repeats across a coach's tenure at r=0.475, freshman usage at r=0.104 (`shared/philosophy.js` header).
7. **Never a forecast.** `whatThisIs()` already states this at full size on page one; v2 repeats the constraint on every page that touches the entry season.
8. **Missing ≠ zero.** `null` propagates; `frame()` throws on a chart with data absent and no stated reason; `bar`/`stacked`/`columns`/`heatGrid` each render a reason instead of a zero-length mark.
9. **Thin samples are not classified confidently.** Every module on pages 2–3 carries an evidence-strength state, and `insufficient` suppresses the classification rather than softening it.
10. **Existing safeguards preserved.** Enumerated in §0.3; any change to them must be argued in this document, not made silently.

### 0.3 Safeguards that must survive v2 unchanged

Each of these exists because it caught a real defect. They are listed with the constant or function that enforces them so a reviewer can grep for regressions.

| Safeguard | Enforced by | Defect it prevents |
|---|---|---|
| Unreadable season ≠ zero freshmen | `MIN_MEASURED_SHARE = 0.5`, `freshmanProfile.readable()` | 154 programmes reported "best freshman: 0 minutes" |
| Blank minutes ≠ benching | `minutesAreMissing()` (reads `games_played`, not `minutes_played`) | A published-zero read as a coaching decision |
| Thin squad ≠ measurable share | `MIN_SQUAD = 10`, `freshmanShare()` | Marywood: a squad share computed from 3 of 39 rows |
| Thin position-season ≠ measurable mix | `MIN_POSITION_MINUTES = 1500`, `vacancyObservations()` | A "mix" that describes two legible rows |
| Unreadable class labels ≠ no freshmen | `freshmenReadable` on every observation | Bates/Hamilton/Elmira filed as freshman-averse |
| Cohort too thin → refuse, don't relax silently | `MIN_COHORT_PLAYERS = 6`, `MIN_COHORT_SEASONS = 2`, `cohort.refused` / `.relaxed` | 46,826 phantom freshman goalkeepers |
| Relax one dimension at a time | the `chain` in `freshmanProfile()` | A US defender handed McKendree's international ladder |
| Ladder ranks stop being comparable | `comparable` flag in `ladderByRank()` | A ladder that improves as you read down it |
| A median the seasons disagree on | `AGREEMENT_RATIO = 3` → `agreement: 'wide'` | Quoting 42 for a cohort that ran 42, 1001, 14 |
| Coaching gap ≠ continuity | `unknownSeasons` vs `vacantSeasons` in `tenureFor()` | Bellarmine's three coaches read as one |
| New coach ≠ owns predecessor's record | `new-coach-no-record`, `FIRST_SEASON_IS_INHERITED` | North Florida's record attributed to a coach who never coached it |
| Unresolved entry-season coach | `stillInPost()` returning `null` | Assuming the 2026 coach is still there |
| Empty chart | `frame()` throws on `empty && !unavailable` | A confident empty axis |
| Truncated PDF | `render()` buffers to a `Buffer`; never pipes | A 200 carrying a blank file |
| Chart cursor drift | the wrapper loop at `philosophyPdf.js:797` | Fourteen blank pages carrying only a footer |
| Two programmes merged | the `programmes.size > 1` throw in `vacancyObservations()` | A findings table about a team that does not exist |
| Pool percentile invented | `percentileOfLadderTop()` returns `null`, never 50 | A made-up midpoint that looks measured |

### 0.4 Terminology rulings

**"Experienced arrival"** is the default historical term for a non-freshman arrival, replacing v1's mixed use of "transfer" and "newcomer". The roster cannot separate a transfer from a JUCO arrival from an older recruit, and `vacancyObservations` deliberately groups them (`newcomerMin`, `newcomerShare`). The model field names stay `newcomer*` — renaming them touches the analytics core for no analytical gain — but **no rendered string may say "transfer"** where the underlying data is a `newcomer*` field. The one exception is page 8, where `prior_programme` names an actual origin programme, and "arrived from X" is a fact rather than an inference.

**"Current projected minutes associated with players whose eligibility ends before entry."** Never "available minutes", never "minutes up for grabs", never "opportunity". `projected_minutes` is a property of the current squad, not a quantity that transfers to a recruit. This wording rule applies to pages 3, 11, 12, 14 and 15, and is asserted in tests as a forbidden-substring check.

**"Opening"** means `departedStarters > 0` at a position across one season transition. It does not mean a place is available now.

---

## 1. Architecture and data flow (as built)

```
colleges ─────────┐
roster_players ───┼─→ philosophyQueries.philosophyFor(collegeId)
coach_seasons ────┘         │  { college, philosophy, rows, squad }
                            │
                  shared/philosophy.programmePhilosophy({rows, coachRows})
                            │  ← shared/freshmanMinutes.*  (ladder, verdicts, guards)
                            │  ← shared/coachTenure.*      (segments, gaps, stillInPost)
                            │
           routes/philosophy.programReportModel({collegeId, playerId?})
                            │  one plain-JSON model, no rendering
                            │
              lib/philosophyReport.renderProgramReport(model)
                            │  ← lib/philosophyPdf.{kit, charts, sections, THEME}
                            │
                     index.js sendPdf()   Buffer → Content-Disposition
```

Two cost regimes, and v2 does not change them: one programme is ~15 ms and is computed per request; the pool benchmarks read 218,586 rows (~1.7 s) and are process-cached behind a `COUNT(*)|MAX(updated_date)` fingerprint rechecked every `THRIV3_PHILOSOPHY_RECHECK_MINUTES` (default 15).

### 1.1 Model field inventory

The single source v2 renders from is `programReportModel()`. Its shape, with provenance:

| Path | Produced by | v1 use |
|---|---|---|
| `college` | `philosophyQueries.college()` | masthead |
| `recruitSeason` / `squadSeason` / `entrySeason` / `entrySeasonKnown` | constants + `players.recruiting_class_year` | masthead, cliff, facet |
| `describes` | `profile.seasons[].season` | `whatThisIs` |
| `verdict` | `classifyProgramme()` | `whoRunsIt` |
| `tenure` | `tenureFor()` | `whoRunsIt` (segments only) |
| `coach`, `coachForRecruitSeason`, `coachStillInPost`, `coachForEntrySeason` | `programmePhilosophy` | `whoRunsIt` |
| `seasons[]` `{season, intake, played, starters, share}` | `profile.seasons` | `ladderSection` (starters count only) |
| `ladder[]` | `profile.byRank` (maxRank 6) | `ladderSection` (top 5) |
| `weightedLadder[]` | `ladderByRank(..., {weights})` | **never rendered** |
| `dials` `{n, freshman, newcomer, returning}` | `dials(observations)` | `fillMixSection` |
| `byPosition[]` | `positionHistory()` × 4 | `positionSection` (counts line only) |
| `benchmarks` | `buildPoolBenchmarks()` | `benchmarkSection` (`ladderByRank` only), `fillMixSection` (`poolMix` only) |
| `benchmarksReason` | ditto | `benchmarkSection` |
| `freshman.points[]` | `freshmanPoints()` | scatter, origin facet |
| `freshman.intake[]` | `intakeBySeason()` | columns × 2 |
| `freshman.progression[]` | `secondYearProgression()` | slope |
| `freshman.retention` | derived count | one sentence |
| `freshman.grid[]` | `positionSeasonGrid()` | heatGrid |
| `transfer.points[]` | `newcomerPoints()` | scatter / fact list |
| `transfer.window` | `arrivalWindow()` | headline, scatter lanes |
| `transfer.measurable`, `.density` | derived | headline branching |
| `squad.rostered`, `.cliff`, `.arrivals`, `.depth` | `eligibilityCliff()`, `namedArrivals()`, `depthChartAt()` | cliff columns, fact lists |
| `athlete` | `players` row | masthead, facets |
| `fit` | `playerFit()` | position facet |

---

## 2. Page specifications

Each page documents the ten required items. **Scope** is one of programme-only, athlete-only, both.

---

### PAGE 1 — Contents / Report Map

**1. Reader question.** *What is in this report, how deep does it go, and where do I find the part I care about?*

**2. Existing data/functions available.** Nothing. This page is entirely new. Its inputs are counts derivable from the model: `describes.length`, `freshman.points.length`, `transfer.points.length`, `dials.n`, `squad.rostered`, `fit.position.transitions`.

**3. Existing data currently underused.** `profile.unreadableSeasons`, `profile.unknownRows`, `benchmarks.programmes`, `benchmarks.observations` — all present, none surfaced. They belong here as scope figures.

**4. New calculations required.**
- A **section registry**: an ordered array of `{ id, title, layer, scope, applies(model) → boolean, scope Line(model) → string|null }`. Every section on every page is registered; `renderProgramReport` iterates the registry rather than calling twelve functions by hand. This is the mechanism that makes the dynamic-page rule enforceable rather than a convention.
- A **page-index recorder**: as each section renders, record `doc.bufferedPageRange().count` so the contents can print real page numbers.
- **Scope counts**, computed once:

| Label | Expression |
|---|---|
| Seasons analysed | `describes.length` and the range `describes[0]–describes.at(-1)` |
| Freshmen measured | `sum(freshman.intake[].freshmen)` — note this counts *measured* freshmen only |
| Freshmen on roster, minutes unpublished | `sum(seasons[].intake) − sum(freshman.intake[].freshmen)` |
| Experienced arrivals measured | `transfer.points.length` across `transfer.window.measurable` |
| Vacancy observations | `dials.n` (readable) and `observations.length` (total) |
| Current squad players | `squad.rostered` |
| Athlete-position observations | `fit.position.transitions` and `fit.position.openings` |
| Benchmark pool | `benchmarks.programmes` programmes, `benchmarks.readable` observations |

**5. Cannot currently be produced.** Nothing.

**6. Recommended chart/visual.** No chart. A two-column contents list: section title and page number on the left, a muted scope line on the right (`"4 seasons · 61 freshmen measured · 9 unpublished"`). Layer dividers as small caps rules, reusing `k.heading`'s rule style at reduced weight.

**7. Interpretation style.** None. This page states, it does not interpret. The only sentence is a one-line frame: *"This report is a record of what has happened at this programme. It contains no predictions."*

**8. Missing-data fallback.** A section that does not apply is **absent from the contents list**, not greyed. Where an entire layer is absent (no athlete), its divider is absent too. Where a section renders only an explicit unavailable state, its scope line reads the reason (`"not enough on file — see page 9"`).

**9. Evidence-strength inputs.** None displayed. The page may optionally carry a single overall data-coverage line — `"4 of 4 seasons readable"` — derived from `describes.length` vs `SEASONS.length` and `profile.unreadableSeasons`.

**10. Scope.** Both. Athlete rows appear only when `model.athlete` is present.

> **Implementation note — the two-pass problem.** Page numbers are not known until the document is finished. Do **not** render twice. `PDFDocument` is already constructed with `bufferPages: true`, and `footer()` already demonstrates the pattern: finish the document, then `doc.switchToPage(0)` and draw. v2 should reserve page 1 with `doc.addPage()` at the start, render every section while recording page indices, then switch back to page 0 and draw the contents. This is the same mechanism as the footer and inherits its one hazard — writing below the bottom margin adds pages mid-walk — so the contents must fit page 1 or paginate deliberately.

---

### PAGE 2 — Programme at a Glance

**1. Reader question.** *In one page: how willing is this programme to play freshmen, how much does it rely on experienced arrivals, who gets minutes when they open, how stable is the coaching behind that evidence, and what is turning over now?*

**2. Existing data/functions available.** All five modules are computable today.

| Module | Dominant metric | Source |
|---|---|---|
| 1 Freshman Opportunity | `ladder[0].median` (+ `band`, `agreement`) | `ladderByRank()` |
| 2 Experienced Arrival Reliance | `dials.newcomer` | `dials(observations)` |
| 3 Replacement Behaviour | `dials` three-way split | `dials(observations)` |
| 4 Coach Context | `verdict.verdict` | `classifyProgramme()` |
| 5 Squad Turnover | minutes expiring at `entrySeason − 1` and `entrySeason` | `eligibilityCliff()` |

Supporting metrics available now: `seasons[].starters`, `profile.seasonsWithAnImpactFreshman`, `profile.medianIntake`, `profile.medianPlayed`, `benchmarks.ladderTopPercentile`, `benchmarks.dials`, `benchmarks.vacancy`, `tenure.segments`, `squad.rostered`, `squad.arrivals.length`.

**3. Existing data currently underused.** This is where the largest v1 gap sits. `benchmarks.dials` (pool p25/median/p75 for all three dials), `benchmarks.vacancy` (`pctWithAFreshStarter` when a starter departed vs did not — the headline finding of the whole module: 51% vs 30%), and `benchmarks.ladderTopPercentile` are all computed, carried into the model, and never drawn. `profile.medianIntake`, `medianPlayed`, `medianImpactPerSeason` and `seasonsWithAnImpactFreshman` likewise.

**4. New calculations required.**
- **Descriptive classification per module.** Bands, not scores. Proposed thresholds, each anchored to an existing constant or to the pool rather than invented:

| Module | Classification | Rule |
|---|---|---|
| Freshman Opportunity | `regular starters` / `selective` / `rare` / `not readable` | `ladder[0].band === 'impact'` and `seasonsWithAnImpactFreshman ≥ ⌈seasonsObserved/2⌉` → regular; `ladder[0].band ∈ {rotation, fringe}` → selective; `band === 'none'` → rare |
| Experienced Arrival Reliance | `heavy` / `moderate` / `light` / `none observed` | `dials.newcomer` against `benchmarks.dials.newcomer.{p25,median,p75}` — above p75 heavy, below p25 light |
| Replacement Behaviour | `promotes from within` / `recruits into the gap` / `buys experience` / `mixed` | whichever of `returning` / `freshman` / `newcomer` leads by ≥10 points (`STEP_POINTS`), else mixed |
| Coach Context | reuse `VERDICT_LABEL` verbatim | no new logic |
| Squad Turnover | `heavy` / `moderate` / `light` | expiring projected minutes as a share of total squad projected minutes |
- **Evidence strength** — see §3.
- **A generic pool-percentile helper.** `percentileOfLadderTop()` is hardcoded to rank 1 and returns a coarse 25/50/75/90. Module 2 needs the same treatment for `dials.newcomer`. Requires either a generalised `percentileIn(quantiles, value)` or richer quantiles in the pool build (see §5.2).

**5. Cannot currently be produced.** Any figure requiring the 2026 season to have been played. Any statement about *why* a coach uses freshmen. Any overall programme score — explicitly excluded by the brief and by the repo's own convention that colour tracks confidence, not quality (`src/lib/philosophyLabels.js`).

**6. Recommended chart/visual.** Five module cards in a 2-2-1 grid. Each card: classification chip, dominant metric at display size, one to three supporting metrics as small `facts`, a compact visual, an evidence-strength chip, and one interpretive sentence. Compact visuals per module:
1. A four-segment sparkline of `seasons[].starters` — reuse `charts.columns` at ~40pt.
2. A single `k.bar` of `dials.newcomer` against the pool median as `marker`.
3. `k.stacked` at reduced height — the existing primitive is already exactly right.
4. A tenure strip: one block per season, coloured by segment, hatched for `unknownSeasons`, outlined for `vacantSeasons`. **New primitive.**
5. A two-bar `charts.paired`: minutes expiring before entry vs total squad projected minutes.

**7. Interpretation style.** One sentence per module, past tense, subject = the programme, no second person, no causal verbs. *"Across the four seasons on file, a first-year here has typically played a starter's season."* Not *"this coach likes freshmen"*, not *"you would likely play"*.

**8. Missing-data fallback.** A module with `insufficient` strength prints its classification slot as *"not enough on file to classify"* plus the specific reason, and suppresses the dominant metric entirely. It keeps its card — the absence of a classification is itself information at a glance. This is the one place where an unavailable state is preferred over omission.

**9. Evidence-strength inputs.** Module 1: `seasonsObserved`, `unreadableSeasons.length`, `ladder[0].agreement`, `ladder[0].comparable`. Module 2: `dials.n`, `transfer.window.measurable.length`. Module 3: `dials.n`, `observations.length − dials.n` (unreadable observations). Module 4: `verdict.verdict`, `tenure.unknownSeasons.length`, `tenure.vacantSeasons.length`. Module 5: `squad.rostered`, count of squad rows with non-null `eligibility_end_year`.

**10. Scope.** Programme-only. Renders identically with and without an athlete.

---

### PAGE 3 — Athlete Opportunity at a Glance

**1. Reader question.** *Given this athlete's position and entry year: who is already there, who is still eligible when they arrive, who is not, and what has historically happened at this position when a place opened?*

**2. Existing data/functions available.** `athlete.position` / `positionLabel` / `origin` / `classYear` / `level`; `entrySeason`, `entrySeasonKnown`; `squad.depth` (`depthChartAt`) with `projectedMinutes`, `eligibleTo`, `arrivedFrom`; `fit.position` (`positionHistory`) with `transitions`, `openings`, `freshmanTookIt`, `newcomerTookIt`, `startersDeparted`, per-season detail; `fit.ladder` / `fit.cohort`; `freshman.grid` filtered to the athlete's position.

**3. Existing data currently underused.** `fit.wholeIntakeLadder` (present, used only in the retired player PDF), `fit.seasonsObserved`, `fit.cohort.thin` / `.refused` / `.relaxed`, `fit.position.dials` (a per-position three-way mix — never drawn anywhere), `benchmarks.byPosition` (`pctFreshStarter_gone` / `_stay` per position — computed, never drawn). `depthChartAt` output is truncated to ten rows by the renderer.

**4. New calculations required.**
- **Positional eligibility split** relative to `entrySeason`:
  - `remainEligible = depth.filter(d => d.eligibleTo != null && d.eligibleTo >= entrySeason)`
  - `expireBeforeEntry = depth.filter(d => d.eligibleTo != null && d.eligibleTo < entrySeason)`
  - `eligibilityUnknown = depth.filter(d => d.eligibleTo == null)` — **must be shown**, never folded into either bucket.
- **Projected minutes attached to expiring positional players**: `sum(expireBeforeEntry.map(d => d.projectedMinutes ?? 0))`, reported alongside the count of those rows with a null `projectedMinutes`.
- **Athlete-position experienced arrivals**: `transfer.points.filter(p => p.position === canonicalPosition(athlete.position))`. Trivial, but not currently exposed.

**5. Cannot currently be produced.** Who else is arriving in the athlete's class. Whether the programme will sign an experienced arrival at this position. The entry-season coach for any entrant after 2026 (`coach_seasons` stops at 2026; `coachForEntrySeason` is correctly `null` beyond it). Any probability of playing.

**6. Recommended chart/visual.** A **positional eligibility timeline**: one row per current player at the athlete's position, a horizontal bar running from now to `eligibleTo`, a vertical entry-season marker, bar width proportional to `projectedMinutes`, and a distinct hatched treatment for `eligibilityUnknown`. Beneath it, a compact three-figure `facts` block for the vacancy history. **New primitive** (see §5.3).

**7. Interpretation style.** Conditional and past-referring. *"Of the six defenders on the 2026 roster, two are out of eligibility before 2027. Across the seasons on file, a place opened at this position twice; a first-year took it once and an experienced arrival once."* Then, mandatorily: *"Who is on the roster in 2027 is not something this report can know."*

**8. Missing-data fallback.** No `squad.depth` (position absent from the roster, or no 2026 roster) → state which, and keep the historical vacancy half of the page. No `fit.position.transitions` → state that the position does not carry enough recorded minutes, and keep the current-squad half. Both absent → the page is omitted and does not appear in the contents.

**9. Evidence-strength inputs.** `fit.position.transitions`, `fit.position.openings`, `fit.cohort.thin/refused/relaxed`, `depth.length`, count of null `eligibleTo`, count of null `projectedMinutes`, `entrySeasonKnown`.

**10. Scope.** Athlete-only.

> **Wording rule, enforced.** This page is the highest-risk location for the "available minutes" error. Every figure derived from `expireBeforeEntry` must be labelled *"current projected minutes associated with players whose eligibility ends before entry"*. A test should assert the report text contains none of `available minutes`, `minutes up for grabs`, `open minutes`, `minutes available`.

---

### PAGE 4 — Freshman Intake

**1. Reader question.** *How many first-years arrive here each year, how many get on the pitch, and how many play a real season?*

**2. Existing data/functions available.** `freshman.points` (`freshmanPoints`), `freshman.intake` (`intakeBySeason`) with `rostered`, `measured`, `readable`, `load`, `freshmen`, `freshmanMinutes`, `freshmanPlayed`, `freshmanStarters`, `freshmanShare`. v1 renders `charts.scatter` and one `charts.columns` from these.

**3. Existing data currently underused.** `intake[].freshmanShare` — the share of squad minutes going to freshmen, per season, computed and never charted. `intake[].rostered` and `.measured` — the readability denominators. `freshman.points[].band` and `.priorProgramme`. `profile.seasons[].redshirted` — redshirt freshmen are counted by `freshmanSeason()` and surfaced nowhere; they are a genuinely distinct answer to "will I play in year one".

**4. New calculations required.**
- A **share-of-squad-minutes series** chart from `intake[].freshmanShare` (v1 has the number, no visual).
- A **coverage line** per season: `rostered − measured` unpublished rows, so the reader can see the denominator the guards are operating on.
- **Redshirt count** per season, promoted from `profile.seasons[].redshirted`.

**5. Cannot currently be produced.** Why a given freshman did not play. Whether a redshirt was medical or strategic.

**6. Recommended chart/visual.** Keep `charts.scatter` (one dot per player, x = minutes, size = games played, fill = started ≥ half) — it is the best thing in v1. Keep the intake/played/started `charts.columns`. Add a small share-of-squad-minutes line or column strip beneath, on the same season axis.

**7. Interpretation style.** Counting sentences, no adjectives. *"Nineteen first-years arrived across the four seasons; fourteen had minutes published; four played a starter's season."*

**8. Missing-data fallback.** Already correct in v1 and must be preserved: a season with `readable === false` keeps its column slot, hatched, labelled *"not recorded"* (`charts.columns` handles this). Players with unpublished minutes are excluded from the scatter and counted in its footer (`"n with no minutes recorded, not shown"`), never plotted at zero.

**9. Evidence-strength inputs.** `seasonsObserved` vs `SEASONS.length`, `unreadableSeasons`, `unknownRows`, per-season `measured / rostered`.

**10. Scope.** Both. In an athlete report, the athlete's position is highlighted in the scatter (ring, not a colour change — colour already encodes origin).

---

### PAGE 5 — Freshman Ladder

**1. Reader question.** *If I am their best incoming freshman — or their third — what did that player actually get?*

**2. Existing data/functions available.** `ladder[]` from `ladderByRank(profile.seasons, {maxRank: 6})`: `rank`, `median`, `low`, `high`, `band`, `agreement`, `comparable`, `seasonsWithThisMany`. `weightedLadder[]` from the same function with `weightsFromVerdict()`. `benchmarks.ladderByRank[]` (`p25`/`median`/`p75` per rank across the pool) and `benchmarks.ladderTopPercentile`.

**3. Existing data currently underused.** **`weightedLadder` is computed on every request and never drawn.** `benchmarks.ladderByRank` is used only for rank 1 — ranks 2–6 are available and unrendered. `ladderTopPercentile` is computed and unrendered. `ladder[5]` (rank 6) is computed and cut by `slice(0, 5)`.

**4. New calculations required.**
- **Per-rank contributing observations.** The brief asks for "seasonal observations contributing to each rank". `ladderByRank()` currently discards them: it builds `atRank = [{minutes, season}]` internally and returns only `seasonsWithThisMany` (a count). **This requires a change to `shared/freshmanMinutes.js`** to also return `contributions: [{season, minutes}]`. It is additive, does not alter any existing field, and is the single most valuable small change in this spec — it turns each ladder rung from a number into a visible sample. Test impact: `shared/freshmanMinutes.test.js`.
- **Weighted vs unweighted presentation** — see the ruling below.

**5. Cannot currently be produced.** A ladder position for the athlete themselves. Confidence intervals — the sample is 2–4 seasons and an interval would be theatre.

**6. Recommended chart/visual.** One row per rank. Median as a `k.bar` with the `STARTER_MINUTES` marker (as v1), plus a low–high whisker drawn behind it for every rank, not only `agreement === 'wide'`, plus the individual contributing seasons as small dots on the same axis. Pool `p25`–`p75` as a pale band behind each row. Ranks 1–6.

**7. Interpretation style.** Second person is permitted here and only here, because the ladder exists to be self-placed against — but only in the framing, never the finding. *"If you would be their best incoming forward, the players who held that rank got:"* followed by the historical figures.

**8. Missing-data fallback.** `comparable === false` → render the reason (*"the seasons are not comparable this far down"*) instead of a bar, as v1 does. `agreement === 'wide'` → the range replaces the band label. No `ladder` at all → the page is omitted; the classification on page 2 already carries `not readable`.

**9. Evidence-strength inputs.** `seasonsWithThisMany` per rank, `agreement`, `comparable`, `seasonsObserved`, `benchmarks.sufficient`.

**10. Scope.** Both. Athlete reports add the cohort ladder (`fit.ladder`) beside the whole-intake ladder on page 13, not here.

> #### Ruling: weighted vs unweighted ladder
>
> The brief asks this to be analysed explicitly rather than resolved silently. **Both are shown, labelled, and neither replaces the other.**
>
> - The **unweighted ladder** is *programme history*. It answers "what has happened here", weights every observed season equally, and is the correct number when the reader is assessing the institution.
> - The **weighted ladder** is *current-regime-relevant history*. `weightsFromVerdict()` returns `null` unless the verdict carries a `weightFrom` — which happens only for `regime-change`, `policy-shift-same-coach`, `vacancy-in-window` and `change-too-recent`. Where it is non-null, seasons from `weightFrom` count 1 and earlier seasons count 0.35. It answers "what has happened under the current approach".
>
> Consequences for rendering:
> 1. Where `weightedLadder` is `null` — the common case, including every `steady`, `continuity-through-change` and `structural-through-changes` programme — show the unweighted ladder alone and state that no reweighting applied *because the seasons all describe the same approach*. Do not show an empty second ladder.
> 2. Where it is non-null, show both, with the verdict's own `note` as the caption explaining why they differ. If they do not differ (the weighting did not move any median), say so — that is a finding.
> 3. The `weighted: true` flag already returned per rank by `ladderByRank()` must drive the label, so a reader is never left guessing which number they are reading.
> 4. Page 2's Freshman Opportunity module uses the **unweighted** ladder as its dominant metric, for stability, and notes when the weighted view disagrees.

---

### PAGE 6 — Freshman Development

**1. Reader question.** *If a first-year does not play here, do they play in year two — or do they disappear?*

**2. Existing data/functions available.** `freshman.progression` (`secondYearProgression`): `season`, `name`, `position`, `year1`, `year2`, `year2State ∈ {measured, unrecorded, gone}`. `freshman.retention` `{stayed, of}`.

**3. Existing data currently underused.** `progression[].position` — present on every row, never used to group or filter. In an athlete report this is exactly the split the reader wants.

**4. New calculations required.**
- **Grouping by year-one band.** Bucket each pair by `bandFor(year1)` (`impact` / `rotation` / `fringe` / `none`) and report, per bucket: n, median year-two minutes among `measured`, and counts of `unrecorded` and `gone`. This is the "do the ones who did not play in year one play in year two" question stated precisely. Safe to derive; requires a minimum-n guard before any bucket is characterised — propose n ≥ 4 to state a bucket median, otherwise show the individual pairs and no summary.
- **Positional filter** for athlete reports.

**5. Cannot currently be produced.** **Why anyone left.** The roster records absence, not cause. A name off the next roster may be a transfer out, an injury, a player who stopped, a graduate, or a spelling the join could not match — and `nameKey()`'s own validation puts the residual false-split rate at 3–5%. No page may attribute a departure to a cause, and the three `year2State` values must never be collapsed to two.

**6. Recommended chart/visual.** Keep `charts.slope` — year one left, year two right, one line per player, and the existing gutter with an open circle for `gone`. Add small-multiple slopes, one per year-one band, when every band clears the n ≥ 4 guard; otherwise the single combined slope.

**7. Interpretation style.** Strictly enumerative. *"Of the eleven first-years with published minutes and a following season on file, seven were on the next roster with minutes published, one was on it with none published, and three were not on it."* v1's existing note about the four meanings of a departure is well-judged and should be kept verbatim.

**8. Missing-data fallback.** No pair has a following season (the 2025 cohort has none within `SEASONS`) → state that rather than draw. `year2State === 'unrecorded'` keeps its line, drawn to the gutter, never to zero.

**9. Evidence-strength inputs.** `progression.length`, count by `year2State`, number of seasons contributing pairs.

**10. Scope.** Both. Athlete reports add the position-filtered view.

---

### PAGE 7 — Experienced Arrival Intake

**1. Reader question.** *Does this programme bring in players who are not first-years, how many, and do they play?*

**2. Existing data/functions available.** `transfer.points` (`newcomerPoints`), `transfer.window` (`arrivalWindow`) with `measurable` / `unmeasurable`, `transfer.measurable`, `transfer.density ∈ {none, few, many}`, `freshman.intake[].newcomers` / `.newcomerMinutes` / `.newcomerStarters` / `.arrivalsMeasurable`.

**3. Existing data currently underused.** `transfer.points[].priorProgramme` (present on historical points, not only current squad rows), `.band`, `.classLabel`. `intake[].newcomerShare`.

**4. New calculations required.**
- **Arrivals per measurable season** as an explicit series — currently only inferable by grouping `points` by season.
- **Minutes earned by arrivals as a share of squad load** per season, from `intake[].newcomerShare`.
- A **share of arrivals reaching `STARTER_MINUTES`**, guarded: report as `"4 of 9"`, not 44%, whenever n < 10.

**5. Cannot currently be produced.** Transfer vs JUCO vs older recruit. Where an arrival came from when `prior_programme` is null (37% of squad rows; higher historically). Whether an arrival was recruited to start.

**6. Recommended chart/visual.** `charts.scatter`, drawn identically to page 4's freshman scatter — same axis, same marker, same sizing — so the two pages can be laid side by side. This is already v1's stated intent and should be preserved. Add a per-season count strip above the lanes.

**7. Interpretation style.** v1's three-way branch on `density` is correct and should be kept: *not measurable* → say the comparison cannot be made; *none* → say the programme added nobody, and that about a quarter of programmes are the same, so zero is a finding rather than a hole; *few* → list them and refuse to call it a policy; *many* → chart them.

**8. Missing-data fallback.** Seasons in `window.unmeasurable` are **excluded from the lanes** and named in a note — an empty lane reads as "nobody came" when it means "we could not look". This is already correct in v1 and is a hard requirement.

**9. Evidence-strength inputs.** `window.measurable.length`, `points.length`, `density`, per-season `arrivalsMeasurable`.

**10. Scope.** Both.

---

### PAGE 8 — Experienced Arrival Profile / Current Arrivals

**1. Reader question.** *Who has actually arrived for the current season, from where, and what are they expected to do?*

**2. Existing data/functions available.** `squad.arrivals` (`namedArrivals`): `name`, `position`, `classLabel`, `from`, `projectedMinutes`. `squad.rostered`.

**3. Existing data currently underused.** `arrivals[].projectedMinutes` — the list is *sorted* by it and the value is never printed.

**4. New calculations required.**
- **Athlete-position arrivals**: `squad.arrivals.filter(a => a.position === canonicalPosition(athlete.position))`.
- A **historical-vs-current separation** in the layout, because these are different quantities: page 7's minutes are *played*, page 8's are *projected*.

**5. Cannot currently be produced.** Arrivals not yet on the published roster. Anything about players whose `prior_programme` is null — they are indistinguishable from returners by this route and must not be inferred into the list.

**6. Recommended chart/visual.** A table (see §5.4), not a chart: name, position, class, prior programme, projected minutes. Grouped by position, athlete's position first in athlete reports.

**7. Interpretation style.** Naming, not characterising. *"Four players on the 2026 roster are recorded as arriving from another programme."* Then the count of squad rows with a null `prior_programme`, so the reader knows the list's coverage.

**8. Missing-data fallback.** No 2026 roster → say so (v1 already distinguishes this from an empty arrivals list). Roster present, no arrivals → say that nobody is *recorded* as arriving, and give the null-`prior_programme` count in the same breath.

**9. Evidence-strength inputs.** `squad.rostered`, count of non-null `prior_programme`, count of non-null `projected_minutes`.

**10. Scope.** Both. Athlete-position subsection is athlete-only.

> **Defect to fix while here.** `philosophyReport.js:365` filters a depth-chart row's `arrivedFrom` with a raw string comparison `d.arrivedFrom !== model.college.name`, while `namedArrivals()` uses `nameKey(r.prior_programme) !== nameKey(school)`. The raw comparison will show a returner as an arrival whenever the roster spells the school differently from `colleges.name` — which is precisely the class of defect the `school-spelled-two-ways` work existed to eliminate. Pages 8, 12 and 14 must all route through `nameKey`.

---

### PAGE 9 — Replacing Minutes *(marquee section)*

**1. Reader question.** *When established players leave, where do the following season's positional minutes actually go?*

**2. Existing data/functions available.** This is the best-supported page in the report. `vacancyObservations()` yields, per position-season transition: `departed`, `departedStarters`, `departedStarterNames`, `vacated`, `vacatedStarter`, `vacatedShare`, `vacatedStarterShare`, `freshMin`, `newcomerMin`, `returningMin`, `freshShare`, `newcomerShare`, `returningShare`, `freshStarters`, `newcomerStarters`, `bestFresh`, `freshmenReadable`, `prevLoad`, `nextLoad`. `dials()` aggregates them. `benchmarks.fillMix` bands the pool by `vacatedStarterShare` across `BINS = [0, .1, .2, .3, .4, .5, .7, 1.01]`, and `poolMixForBand()` selects the band matching this programme.

**3. Existing data currently underused.** `benchmarks.vacancy` — `{starterDeparted: {n, pctWithAFreshStarter}, noStarterDeparted: {n, pctWithAFreshStarter}}`. This is the module's headline pool finding (a departing starter moves the odds of a freshman starting from ~30% to ~51%) and it is computed, carried in the model, and never rendered anywhere. It belongs on this page. Also unrendered: `vacatedShare` vs `vacatedStarterShare` as distinct quantities, the raw `freshMin`/`newcomerMin`/`returningMin` minutes, `observations.length` vs `dials.n`.

**4. New calculations required.**
- **Programme-level vacancy rate**: `mean(observations.map(o => o.vacatedStarterShare))` — computed already inside `programmeModel()` as `meanVacated` purely to select the pool band, then discarded. Surface it.
- **The pool contrast pair**, rendered from `benchmarks.vacancy`.
- **Observation counts** shown beside every share: `dials.n` readable of `observations.length` total.

**5. Cannot currently be produced.** Causation. The data supports *"the minutes went to X"*, never *"the coach chose X"* or *"because Y left, X played"*. A position group's minutes may move for reasons wholly outside the roster.

**6. Recommended chart/visual.** `k.stacked` for this programme and `k.stacked` for the comparable pool band, one above the other — v1 already does this and the primitive is well suited, since the three shares partition the minutes exactly. Add beneath: a two-row `charts.paired` of `pctWithAFreshStarter` when a starter departed vs when none did, programme value against pool value.

**7. Interpretation style.** Descriptive and comparative, never causal. *"Across 23 readable position-seasons, 61% of the following season's minutes went to returning players, 22% to first-years and 17% to arrivals from elsewhere. Among programmes losing a comparable share of starter minutes, the pool split 58 / 19 / 23."* No "therefore", no "so", no "because".

**8. Missing-data fallback.** `dials.n === 0` → the existing *"no position-seasons here carry enough recorded minutes"* string, with the `MIN_POSITION_MINUTES` threshold named. `benchmarks.poolMix === null` → show the programme bar alone and state the pool could not be banded.

**9. Evidence-strength inputs.** `dials.n`, `observations.length − dials.n`, number of distinct positions contributing, number of distinct transitions contributing, `benchmarks.sufficient`, `benchmarks.readable`.

**10. Scope.** Both.

---

### PAGE 10 — Replacement Behaviour by Position

**1. Reader question.** *At each position, how often has a place actually opened, and who took it?*

**2. Existing data/functions available.** `byPosition[]` from `positionHistory(observations, pos)` for each of `POSITIONS`: `transitions`, `startersDeparted`, `openings`, `freshmanTookIt`, `newcomerTookIt`, `dials`, and `seasons[{season, startersDeparted, departedNames, freshStarters, newcomerStarters, bestFresh}]`.

**3. Existing data currently underused.** `byPosition[].dials` — a full three-way mix per position, computed and never drawn. `byPosition[].seasons[].bestFresh`. `benchmarks.byPosition` — `pctFreshStarter_gone` / `pctFreshStarter_stay` per position across the pool, computed and never drawn. v1 renders a single sentence per position and discards the rest.

**4. New calculations required.**

> #### Ruling: there is no `returningTookOpening`, and it must not be computed
>
> **Do not calculate `returningTookOpening = openings − freshmanTookIt − newcomerTookIt`.** The subtraction is invalid, and the reason is structural rather than a matter of sample size.
>
> `positionHistory` counts an opening as a season transition where `departedStarters > 0`. It then counts `freshmanTookIt` as those openings where `freshStarters > 0`, and `newcomerTookIt` as those where `newcomerStarters > 0`. **These two sets overlap and neither is exhaustive.** One opening can see a first-year and an experienced arrival both reach `STARTER_MINUTES` — in which case it is counted in both — and an opening can equally see neither, with the minutes absorbed by players already on the roster. The three outcomes are not a partition, so subtracting two of them from the total does not yield the third. On a programme where every opening produced both a freshman and an arrival starter, the expression returns a negative number.
>
> **Represent returning behaviour through the minutes share instead.** `positionHistory().dials` already returns `{n, freshman, newcomer, returning}` for that position, computed from `returningShare` — the fraction of the following season's positional minutes taken by players who were on the previous roster. Those three shares *do* partition the minutes exactly, by construction in `vacancyObservations`, which is precisely what makes them safe to present together and the opening counts unsafe to subtract.
>
> The page therefore carries two different kinds of quantity, and must label them as such:
>
> | Quantity | Unit | Source | Safe operation |
> |---|---|---|---|
> | `openings`, `freshmanTookIt`, `newcomerTookIt` | counts of season transitions | `positionHistory` | report as `"2 of 5"`; never subtract |
> | `dials.returning` / `.freshman` / `.newcomer` | shares of positional minutes | `positionHistory().dials` | present together; they sum to 100% |
>
> The accompanying sentence must make the non-exclusivity explicit, e.g. *"A place opened five times. A first-year started in two of them and an experienced arrival in three; these can be the same season, because one opening can be filled by more than one player."*
>
> If a genuine count is wanted later, `returningStarters` can be added to `vacancyObservations` as `returning.filter(r => minutesOf(r) >= STARTER_MINUTES).length`. That is a change to the analytics core, belongs in its own commit with its own tests, and still would not make the three counts a partition — it would add a fourth overlapping set.

- **Pool comparison per position**, from `benchmarks.byPosition`.

**5. Cannot currently be produced.** Sub-position detail — a left back and a centre back are both `DEFENSE` (`shared/positions.js`), and the report must say so. Whether a freshman starting was a promotion or a signing.

**6. Recommended chart/visual.** A four-row table, one per canonical position: transitions, starters departed, openings, "a first-year then started", "an experienced arrival then started", and a compact `k.stacked` of that position's dials. Counts as `"2 of 5"` throughout, per the brief and per v1's existing note. Athlete's position highlighted with a rule and a claret label, never a different chart.

**7. Interpretation style.** Counts, never rates, below n = 10. v1's note is exactly right and should be retained: *"Counts, not percentages: with at most three seasons to look at, a percentage of three reads far more confidently than it deserves to."*

**8. Missing-data fallback.** `transitions === 0` for a position → the row stays, with *"not enough recorded minutes at this position"* — a position dropped from the table reads as a position that never turns over. Goalkeepers frequently land here and the methodology page explains why.

**9. Evidence-strength inputs.** Per position: `transitions`, `openings`, `dials.n`, and whether `benchmarks.byPosition[pos].n` is non-zero.

**10. Scope.** Both. Highlighting is athlete-only.

---

### PAGE 11 — Current Squad / Eligibility Outlook

**1. Reader question.** *On the roster as it stands, when does eligibility run out, and how many projected minutes sit with those players?*

**2. Existing data/functions available.** `squad.cliff` (`eligibilityCliff`): `[{year, total, byPosition: [{position, minutes, players}]}]`. `squad.rostered`.

**3. Existing data currently underused.** **`cliff[].byPosition` is computed in full and only `total` is rendered.** The brief asks for a position breakdown and it already exists.

**4. New calculations required.**
- **Coverage**: `eligibilityCliff()` filters to rows with a non-null `eligibility_end_year` and returns `null` if none. The count of squad rows *excluded* by that filter is not reported and must be — otherwise a cliff built from 60% of the squad reads as the whole squad.
- **Null-`projected_minutes` count** per year, for the same reason.

**5. Cannot currently be produced.** Fifth-year returns, transfers out, medical redshirts — every one of which moves the cliff. v1's note says this and should be kept. Actual minutes for 2026: all 46,028 squad-season rows carry null minutes by construction (`SQUAD_SEASON` is deliberately excluded from `SEASONS`), so only `projected_minutes` exists.

**6. Recommended chart/visual.** A **timeline grouped by position**, as the brief recommends: years across the x-axis, one band per canonical position, segment height proportional to expiring projected minutes, with the entry season marked. This is a stacked-column chart with a marker — `charts.columns` already supports `stacked: true` (a code path that is **currently never exercised anywhere in the codebase**) and needs only a vertical marker to serve. Prefer extending it over writing a new primitive.

**7. Interpretation style.** Present-tense description of a current roster, future-tense only about eligibility rules, never about people. *"Of the 27 players on the 2026 roster, 8 have eligibility ending in 2026 and are associated with about 4,900 projected minutes."*

**8. Missing-data fallback.** `cliff === null` → state that no squad row carries an eligibility end year, and give `squad.rostered` so the reader knows a roster exists. No 2026 roster → v1's existing wording.

**9. Evidence-strength inputs.** `squad.rostered`, non-null `eligibility_end_year` count, non-null `projected_minutes` count.

**10. Scope.** Both. Entry-season marker only in athlete reports; programme reports mark `RECRUIT_SEASON`.

---

### PAGE 12 — Current Depth

**1. Reader question.** *Who is on the roster right now, and what is each of them expected to do?*

**2. Existing data/functions available.** `squad` rows carry `player_name`, `position`, `class_year_label`, `projected_minutes`, `eligibility_end_year`, `prior_programme`. `depthChartAt(squad, position)` exposes exactly these for one position.

**3. Existing data currently underused.** There is **no whole-squad depth accessor** — `depthChartAt` takes a position and returns `null` for `UNKNOWN`. The full squad table is a straightforward derivation that does not exist. `philosophyReport.js:360` also truncates the positional depth chart at ten rows.

**4. New calculations required.**
- `squadDepth(squadRows)` — the whole roster, grouped by `canonicalPosition`, sorted within group by `projectedMinutes` descending, with `UNKNOWN` kept as its own group rather than dropped.
- Removal of the `slice(0, 10)` truncation; rule 1 forbids it.
- `nameKey`-based comparison for `prior_programme` (see the page 8 note).

**5. Cannot currently be produced.** Depth chart position in the coach's sense — this is roster order by projected minutes, not a selection.

**6. Recommended chart/visual.** A table (§5.4): player, position, class, projected minutes, eligibility through, prior programme. Grouped by position with subtotals.

**7. Interpretation style.** None beyond a caption. This page is evidence.

**8. Missing-data fallback.** Empty cells render as `—`, never 0. A position group with no players is shown as an empty group, because an absent group reads as an omission.

**9. Evidence-strength inputs.** Field-level coverage counts, printed as a caption: *"class known for 27 of 27, projected minutes for 24, eligibility end for 25, prior programme for 17."*

**10. Scope.** Both. Athlete's position group ordered first and ruled in athlete reports.

---

### PAGE 13 — Athlete Position History

**1. Reader question.** *Everything the record says about this one position — nothing about the others.*

**2. Existing data/functions available.** `fit.position` (`positionHistory` at the athlete's position), `fit.ladder` (cohort ladder), `fit.cohort`, `fit.wholeIntakeLadder`, `freshman.grid` row for the position, `freshman.points` filtered by position, `transfer.points` filtered by position.

**3. Existing data currently underused.** `fit.position.dials`, `fit.seasonsObserved`, `fit.wholeIntakeLadder` (drawn only in the retired player PDF), `fit.cohort.thin`.

**4. New calculations required.** Positional filters over `freshman.points` and `transfer.points` (trivial, currently absent). Positional freshman-minute share is already `freshman.grid[pos].cells[].share`.

**5. Cannot currently be produced.** Sub-position specialisation. Anything about the athlete's own quality relative to those players.

**6. Recommended chart/visual.** Three stacked blocks on one page: (a) the cohort ladder beside the whole-intake ladder as paired bars — the difference between them is itself the finding, and `playerFit`'s own comment records that narrowing moved the ladder top downward at 17 of 19 programmes for a pilot athlete; (b) the position's freshman-share row from the heat grid; (c) the position's vacancy seasons as a small table.

**7. Interpretation style.** Comparative between cohort and whole intake, explicitly. *"Read across the whole intake, the best first-year here played 1,850 minutes. Read for US recruits at this position, it is 999."* Then the refusal state if one applies.

**8. Missing-data fallback.** `fit.cohort.refused` set → print `humanCohort(refused)` — the existing helper turns stored keys (`DEFENSE`, `domestic`) into words, and must be used, because the raw keys are map keys and not words anybody says. `relaxed` set → state which wider group is being shown instead. No positional data at all → omit the page.

**9. Evidence-strength inputs.** `fit.seasonsObserved`, `fit.cohort.thin/refused/relaxed`, `fit.position.transitions`, `fit.position.openings`.

**10. Scope.** Athlete-only.

---

### PAGE 14 — Current Competition

**1. Reader question.** *Who exactly would I be competing with, and how long is each of them there for?*

**2. Existing data/functions available.** `squad.depth` (`depthChartAt`) — full field set.

**3. Existing data currently underused.** The whole list beyond ten rows; `arrivedFrom` on every row.

**4. New calculations required.** The three-way eligibility split from page 3 (`remainEligible`, `expireBeforeEntry`, `eligibilityUnknown`), rendered here in full rather than summarised.

**5. Cannot currently be produced.** Players arriving at this position in the athlete's own class or between now and entry.

**6. Recommended chart/visual.** Table (§5.4), sectioned into the three eligibility buckets with a heading each, sorted by projected minutes within bucket.

**7. Interpretation style.** Enumerative, with the wording rule applied: *"three of the six are eligible into 2027; two are not; one has no eligibility end recorded."*

**8. Missing-data fallback.** `depth === null` (no such position on the roster, or position `UNKNOWN`) → state which, and note that the historical positional evidence on page 13 stands regardless.

**9. Evidence-strength inputs.** `depth.length`, null counts for `eligibleTo` and `projectedMinutes`.

**10. Scope.** Athlete-only.

---

### PAGE 15 — Entry-Year Context / Pathway

**1. Reader question.** *What is known, today, about the position in the year I would arrive — and what is unknowable?*

**2. Existing data/functions available.** `entrySeason`, `entrySeasonKnown`, `coachForEntrySeason`, `squad.depth`, `fit.position`, `squad.cliff` filtered to the athlete's position via `cliff[].byPosition`.

**3. Existing data currently underused.** `cliff[].byPosition` at the athlete's position specifically. `coachForEntrySeason` is correctly `null` beyond 2026 and that null is currently rendered only as a box on the entry facet.

**4. New calculations required.** Positional expirations before `entrySeason` with their associated projected minutes (shared with page 3 — compute once in the model, render twice).

**5. Cannot currently be produced.** **This is the page defined by what it cannot produce.** Future recruits. Future experienced arrivals. Transfers out. Fifth-year decisions. The coaching staff beyond 2026. Any probability, expectation or likelihood of playing time.

**6. Recommended chart/visual.** The same positional eligibility timeline as page 3, at full size, with the entry-season marker emphasised and everything to the right of it visibly shaded as unknown territory. The shading *is* the argument.

**7. Interpretation style.** Two paragraphs, in this order: what is known (positional expirations, historical vacancy behaviour, coach if within 2026), then a full-width `k.box` of what is not. The unknowable half must be at least as visually prominent as the known half.

**8. Missing-data fallback.** `entrySeasonKnown === false` → v1's existing box, kept verbatim: *"We hold rosters and coaching records through 2026. You would arrive in 2027, so who is in charge and who is on the squad by then is not something this report can tell you."*

**9. Evidence-strength inputs.** `entrySeasonKnown`, `entrySeason − Number(SQUAD_SEASON)` (the horizon gap), `fit.position.openings`, `depth` null counts.

**10. Scope.** Athlete-only.

> **Hard constraint.** This page must never be framed as a playing-time forecast. Test assertion: the page's text contains no instance of `likely`, `expect to play`, `should play`, `chance of`, `projected to start`, or `opportunity for you`.

---

### PAGE 16 — Athlete Cohort / Origin Context

**1. Reader question.** *Does where I am coming from change what the record says about this programme?*

**2. Existing data/functions available.** `athlete.origin` (derived in `programReportModel`), `originOf()` on every roster row, `freshman.points[].origin`, `fit.cohort.origin`, `fit.ladder` when the cohort applied on origin.

**3. Existing data currently underused.** The pool has no origin split at all — `buildPoolBenchmarks()` does not compute one. v1's origin facet quotes a pool-wide figure (37% vs 27%, and no effect at D-III) as **prose from prior research**, not as a computed value. That is honest but brittle: the sentence will drift from the data.

**4. New calculations required.**
- Programme-level: starter-season rate by origin among measured freshmen, with counts (`4 of 11`), never a percentage below n = 10.
- Pool-level (optional, Status C): add `byOrigin: {domestic: {n, pctImpact}, international: {...}}` to `buildPoolBenchmarks`, ideally split by division since the research says the effect vanishes at D-III. This converts a hardcoded prose claim into a measured one. It adds one pass over an already-loaded row set, so the marginal cost on the 1.7 s build is small.

**5. Cannot currently be produced.** Country-level effects. `originOf()` returns `null` for 1,834 rows with neither nationality nor country, and those rows must stay `null` rather than defaulting to domestic. Any origin claim at a programme with fewer than `MIN_COHORT_PLAYERS` measured freshmen of the athlete's origin.

**6. Recommended chart/visual.** `charts.paired` — this programme's rate by origin, against the pool's rate by origin at the same division — with counts printed beside every bar.

**7. Interpretation style.** Programme-specific first, pool second, and the pool framed as context rather than expectation. The existing v1 note is a good model and should be retained in substance: the effect is real across the game, disappears at D-III, and runs the other way at some programmes, so it must be measured per programme.

**8. Missing-data fallback.** Fewer than six measured freshmen recording an origin → refuse the split outright, state the count, and show the unsplit figure. This mirrors `MIN_COHORT_PLAYERS` and should reuse the constant rather than introduce a second threshold.

**9. Evidence-strength inputs.** Count of measured freshmen with non-null origin, count in the athlete's origin group, `fit.cohort.refused/relaxed` when origin was the refused dimension, `benchmarks.sufficient`.

**10. Scope.** Athlete-only.

---

### PAGES 17+ — Supporting Historical Detail

**1. Reader question.** *Show me the rows.*

**2. Existing data/functions available.** Every table is a projection of an existing array: `freshman.points`, `transfer.points`, `observations`, `squad`.

**3. Existing data currently underused.** `observations` is never rendered at row level anywhere. It is the richest structure in the module (18 fields per position-season transition) and the reader currently sees only its aggregates.

**4. New calculations required.** Flattening and sorting only. The vacancy table needs one derivation: joining `departedStarterNames` (an array per observation) into rows, one per departed starter, carrying the observation's following-season outcome.

Proposed tables:

| Table | Columns | Source |
|---|---|---|
| Freshmen | season, name, position, minutes, games, starts, origin | `freshman.points` |
| Experienced arrivals | season, name, position, prior programme, minutes, games, starts | `transfer.points` |
| Vacancies | transition, position, departed starter, vacated minutes, following-season outcome | `observations` + `departedStarterNames` |
| Current squad | player, position, class, projected minutes, eligibility end, prior programme | `squad` |

**5. Cannot currently be produced.** Rows for players whose minutes were never published — they are excluded from `points` by construction. Their **count** must appear as a table caption so the omission is visible.

**6. Recommended chart/visual.** Tables (§5.4). Sorted by season descending then minutes descending. Zebra striping at 3% claret. Repeated header on continuation pages.

**7. Interpretation style.** Captions only. No interpretation on these pages by design — they exist so a sceptical reader can check the charts.

**8. Missing-data fallback.** An empty table is omitted, since the charts above already stated the absence and its reason. Null cells render `—`.

**9. Evidence-strength inputs.** Row counts and excluded-row counts in each caption.

**10. Scope.** Both; the vacancy table is filtered to the athlete's position in athlete reports *in addition to* the full table, never instead of it.

---

### FINAL PAGE — Methodology / Limitations

**1. Reader question.** *How was any of this worked out, and where does it stop being reliable?*

**2. Existing data/functions available.** `limits()` in `philosophyPdf.js` already carries five bullets and accepts an `extra` array. v2 expands it into a structured page.

**3. Existing data currently underused.** Every threshold constant is documented in source comments and none reaches the reader: `STARTER_MINUTES`, `MIN_POSITION_MINUTES`, `MIN_SQUAD`, `MIN_MEASURED_SHARE`, `MIN_COHORT_PLAYERS`, `MIN_COHORT_SEASONS`, `AGREEMENT_RATIO`, `STEP_POINTS`, `SPREAD_POINTS`, `BINS`.

**4. New calculations required.** None. This page renders constants and prose.

**5. Cannot currently be produced.** Nothing.

**6. Recommended chart/visual.** None. Headed prose, one short block per topic:

| Topic | Substance |
|---|---|
| Historical evidence vs forecast | The recruited season has not been played; every figure describes seasons that have |
| True freshman | `readClassYear()`: first year on campus, redshirt freshmen excluded and counted separately; the Texas Tech club-column failure is why the reader is told the label can be unreadable |
| 600-minute starter season | `STARTER_MINUTES`; the same threshold the rest of the product uses |
| Ladder, not average | Freshman minutes are bimodal; Bentley 2025 — three freshmen over 1,000 minutes, five at none, mean 340 describing nobody |
| Missing minutes | `minutesAreMissing()` reads `games_played`, because the importer coerces a blank minutes cell to 0; `MIN_MEASURED_SHARE = 0.5` per season and per position-season |
| Experienced-arrival terminology | The roster cannot separate transfer, JUCO and older recruit; they are grouped and named accordingly |
| Vacancy methodology | Position-season transitions; `MIN_POSITION_MINUTES = 1500` either side; name matching via `nameKey`, validated at a 3–5% residual false-split rate; the three shares partition the minutes exactly |
| Counts vs shares | An opening can be filled by more than one player, so "a first-year started" and "an experienced arrival started" are overlapping counts and neither excludes a returning player keeping the minutes. Counts are never subtracted from one another; where a three-way split is shown it is a split of MINUTES, which does partition exactly |
| Projected minutes | A property of the current roster, not minutes available to a recruit; stated in those words |
| Eligibility | `eligibility_end_year` is the last season a player may play; `classYear.js` offsets model five-year eligibility, and graduation year is exactly one year later |
| Future recruiting | Unknown and unknowable from this data |
| Coaching change | `tenureFor()` measures inside the observed window only; a gap is `unknown` or `vacant`, never continuity; a new coach's first season is inherited |
| Broad position groups | Four canonical groups; a left back and a centre back are counted together |
| Goalkeeper caveat | One keeper plays nearly every minute and the rest play none, so a typical figure describes nobody |
| Benchmark pool | `buildPoolBenchmarks()`: all programmes in the sport across `SEASONS`, `sufficient: false` rather than zeros when unreadable, percentiles null rather than 50 |
| Evidence strength | §3 of this document, stated in plain words: it measures how much data stands behind a statement, not how good the programme is |

**7. Interpretation style.** Plain, second person permitted, no hedging about the hedges.

**8. Missing-data fallback.** N/A — always renders.

**9. Evidence-strength inputs.** N/A.

**10. Scope.** Both; entries for athlete-only methods appear only in athlete reports.

---

## 3. Evidence strength

A four-state label attached to every classification on pages 2–3 and to each evidence page's header.

```
'strong' | 'moderate' | 'thin' | 'insufficient'
```

**It measures confidence in the statement, not quality of the programme.** This mirrors the existing convention in `src/lib/philosophyLabels.js`, where badge colour tracks predictability rather than merit, and must be stated on the methodology page.

Proposed home: a new pure module `shared/evidenceStrength.js`, with one function per module rather than a universal scorer, because the units differ — position-seasons, players, seasons and roster rows are not interchangeable.

Inputs, all already available:

| Dimension | Fields |
|---|---|
| Sample size | `dials.n`, `positionHistory.transitions`, `positionHistory.openings`, `points.length`, `depth.length`, `seasonsObserved` |
| Coverage loss | `profile.unreadableSeasons.length`, `profile.unknownRows`, `intake[].readable === false` count, `observations.length − dials.n` |
| Internal agreement | `ladder[].agreement`, `ladder[].comparable`, `verdict.spread` |
| Cohort integrity | `cohort.thin`, `cohort.refused`, `cohort.relaxed` |
| Attribution | `verdict.verdict ∈ {coach-unknown, coach-unknown-recent, new-coach-no-record, too-few-seasons}`, `tenure.unknownSeasons.length`, `tenure.vacantSeasons.length` |
| Pool availability | `benchmarks.sufficient` |

Rule shape: begin from a sample-size band, demote one level for any coverage loss or attribution gap, and floor at `insufficient` when below the module's stated minimum. `insufficient` **suppresses** the classification rather than softening it — rule 9.

The thresholds must be recorded here once agreed, and reuse existing constants (`MIN_COHORT_PLAYERS`, `MIN_COHORT_SEASONS`, `MIN_MEASURED_SHARE`) wherever the quantity is the same, rather than introducing a parallel set.

---

## 4. Implementation-gap matrix

**A** — available and currently rendered · **B** — available but underused or unrendered · **C** — derivable, needs new calculation · **D** — cannot be produced safely

### Status A — keep as is

| Component | Function / field | Page |
|---|---|---|
| Freshman scatter | `freshmanPoints()` → `charts.scatter` | 4 |
| Intake / played / started columns | `intakeBySeason()` → `charts.columns` | 4 |
| Ladder bars, top 5 | `ladderByRank()` → `k.bar` | 5 |
| Pool rank-1 comparison | `benchmarks.ladderByRank[0]` | 5 |
| Year 1 → year 2 slope | `secondYearProgression()` → `charts.slope` | 6 |
| Position × season heat grid | `positionSeasonGrid()` → `charts.heatGrid` | 4 / 13 |
| Experienced-arrival scatter, density branching | `newcomerPoints()`, `arrivalWindow()` | 7 |
| Named current arrivals | `namedArrivals()` | 8 |
| Three-way fill mix + pool band | `dials()`, `poolMixForBand()` → `k.stacked` | 9 |
| Position counts line | `positionHistory()` | 10 |
| Eligibility cliff totals | `eligibilityCliff()` → `charts.columns` | 11 |
| Positional depth (first 10) | `depthChartAt()` | 12 / 14 |
| Coach segments + verdict note | `tenureFor()`, `classifyProgramme()` | 2 |
| Origin facet | `originOf()` → `charts.paired` | 16 |
| Limits bullets | `limits()` | final |

### Status B — available, unrendered or underused

| Component | Function / field | Target page |
|---|---|---|
| **Weighted ladder** | `model.weightedLadder` — computed every request, never drawn | 5 |
| **Pool dial percentiles** | `benchmarks.dials.{freshman,newcomer,returning}.{p25,median,p75}` | 2, 9 |
| **Pool vacancy contrast** | `benchmarks.vacancy.{starterDeparted,noStarterDeparted}.pctWithAFreshStarter` — the module's headline finding | 9 |
| **Pool per-position rates** | `benchmarks.byPosition[].pctFreshStarter_{gone,stay}` | 10 |
| **Ladder-top percentile** | `benchmarks.ladderTopPercentile` | 2, 5 |
| Ladder rank 6 | `ladder[5]`, cut by `slice(0, 5)` | 5 |
| Per-position dials | `byPosition[].dials` | 10 |
| Cliff by position | `cliff[].byPosition` | 3, 11, 15 |
| Freshman share series | `intake[].freshmanShare`, `.newcomerShare` | 4, 7 |
| Squad-minutes share per season | `seasons[].share` (`shareOfSquadMinutes`) | 4 |
| Redshirt freshmen | `profile.seasons[].redshirted` | 4 |
| Readability denominators | `intake[].rostered`, `.measured`, `profile.unknownRows`, `profile.unreadableSeasons` | 1, 4, all captions |
| Profile medians | `medianIntake`, `medianPlayed`, `medianImpactPerSeason`, `seasonsWithAnImpactFreshman` | 2 |
| Whole-intake vs cohort ladder | `fit.wholeIntakeLadder` — drawn only in the retired player PDF | 13 |
| Cohort refusal state | `fit.cohort.thin/refused/relaxed` + `humanCohort()` | 13, 16 |
| Arrival projected minutes | `arrivals[].projectedMinutes` — sorted by, never printed | 8 |
| Historical prior programme | `points[].priorProgramme` on `newcomerPoints` | 7, 17+ |
| Progression position | `progression[].position` | 6, 13 |
| Verdict internals | `verdict.spread`, `.step`, `.describes`, `.unknownSeasons`, `.knownThrough`, `.coaches`, `.swing` | 2 |
| Tenure gaps | `tenure.unknownSeasons`, `.vacantSeasons`, `.changes`, `.continuous` | 2 |
| Full observation rows | `observations[]` — 18 fields, never rendered at row level | 17+ |
| Stacked column mode | `charts.columns({stacked: true})` — implemented, never called | 11 |
| Brand fields | `colleges.logo_url`, `.primary_color` — selected, unused | masthead |

### Status C — derivable, needs new calculation

| Component | Derivation | Touches |
|---|---|---|
| **Section registry + page-index recorder** | New; drives contents and the dynamic-page rule | `philosophyReport.js` |
| **Contents page scope counts** | Aggregations over existing model arrays | new module |
| **Evidence strength** | §3 | new `shared/evidenceStrength.js` |
| **Per-rank contributing seasons** | `ladderByRank()` already builds `atRank`; return it as `contributions` | `shared/freshmanMinutes.js` + test |
| **Module classifications ×5** | Banding rules in §Page 2 | new module |
| Generic pool percentile | Generalise `percentileOfLadderTop()`; needs richer quantiles | `philosophyQueries.js` |
| Pool dial quantiles retained | `buildPoolBenchmarks()` computes `dialSeries` and discards it — keep deciles | `philosophyQueries.js` |
| Pool origin split (optional) | One extra pass over already-loaded rows, split by division | `philosophyQueries.js` |
| Positional eligibility split | `depth` partitioned on `eligibleTo` vs `entrySeason`, with an explicit unknown bucket | model |
| Projected minutes on expiring positional players | Sum over that partition, plus null count | model |
| Whole-squad depth | `squadDepth(squadRows)` grouped by position, `UNKNOWN` retained | `shared/philosophy.js` |
| Progression by year-one band | Bucket on `bandFor(year1)`, n ≥ 4 guard | model |
| Athlete-position arrival filters | Filters over `transfer.points`, `squad.arrivals` | model |
| Programme mean vacated share | `meanVacated` — computed in `programmeModel()` then discarded | model |
| Vacancy evidence rows | Flatten `observations` × `departedStarterNames` | model |
| `returningStarters` (optional) | Add to `vacancyObservations`; see the page 10 caution | `shared/philosophy.js` |
| Field-coverage captions | Null counts per rendered field | model |
| `nameKey` for depth `arrivedFrom` | Replace the raw string compare at `philosophyReport.js:365` | `philosophyReport.js` |
| Remove `slice(0, 10)` on depth | Rule 1 | `philosophyReport.js` |

### Status D — cannot be produced safely

| Wanted | Why not |
|---|---|
| Why a player left a roster | The roster records absence, not cause; four causes are indistinguishable and `nameKey` carries a 3–5% residual false-split rate |
| Playing-time forecast / probability | The season has not been played; rule 7 |
| Future recruits or arrivals in the entry class | Not in any table |
| Coach for an entry season after 2026 | `coach_seasons` stops at 2026; `coachForEntrySeason` is correctly `null` |
| Actual 2026 minutes | All squad-season rows carry null minutes by construction; only `projected_minutes` exists |
| Transfer vs JUCO vs older recruit | Not distinguishable; the terminology ruling exists because of this |
| Country-level origin effects | Never enough players from one country at one programme |
| Sub-position detail (CB vs LB) | Four canonical groups only |
| Overall programme score | Excluded by the brief; colour and labels track confidence, not merit |
| Athlete ability vs programme level | `soccer_score` is built from results, `football_ability` is self-entered; v1's caveat box is the correct treatment and must stay |
| Injuries, admissions, scholarships | Not in the data |
| Fifth-year returns / transfers out | Move the cliff and are unknowable |

---

## 5. Rendering primitives

### 5.1 Existing primitives v2 reuses unchanged

`kit()`: `title`, `heading`, `body`, `note`, `box`, `facts`, `bullets`, `bar`, `stacked`, `slot`, `room`, `gap`, `dim`.
`charts`: `scatter`, `slope`, `columns` (including its unused `stacked` mode), `heatGrid`, `paired`.
Sections: `masthead`, `whatThisIs`, `whoRunsIt`, `limits`, `footer`.
Helpers: `minutes()`, `humanCohort()`, `render()`, `THEME`.

**Every new chart must be registered on the `charts` object**, so it inherits the cursor-restoring wrapper at `philosophyPdf.js:797`. A chart added outside that object will reintroduce the blank-page defect.

### 5.2 Primitives to extend

| Primitive | Change |
|---|---|
| `charts.columns` | Add an optional vertical marker (entry season) and exercise the existing `stacked` path |
| `charts.paired` | Currently `row.b` is drawn but the two series share one label pair; give it real per-series legends for programme-vs-pool |
| `percentileOfLadderTop` | Generalise to any series; keep the null-not-50 rule |
| `limits` | Grow into the structured methodology page |

### 5.3 New primitives required

| Primitive | Used by | Notes |
|---|---|---|
| `kit.contents` | 1 | Two-column list with layer dividers; drawn last via `switchToPage(0)` |
| `kit.moduleCard` | 2 | Classification chip, dominant metric, supporting facts, compact visual slot, strength chip, one sentence |
| `kit.strengthChip` | 2, 3, evidence headers | Four states; muted palette, never red/green — it is confidence, not merit |
| `charts.tenureStrip` | 2 | One block per season, coloured by segment, hatched for unknown, outlined for vacant |
| `charts.eligibilityTimeline` | 3, 11, 15 | One row per player or position; bar to `eligibleTo`; entry marker; hatched unknown; shaded unknowable region right of entry |
| `charts.ladderRow` | 5 | Median bar + low–high whisker + contributing-season dots + pool p25–p75 band |
| `kit.table` | 8, 10, 12, 14, 17+ | **The hardest one — see below** |

### 5.4 The table primitive

Every other primitive draws inside a fixed `k.slot()` box in absolute coordinates. A table cannot: it must span pages. It therefore has to be built on the **flow** model that `k.facts` and `k.bullets` use — `k.room()` before each row, `doc.y` advanced per row — not on `slot()`.

Requirements:
- Column spec `{key, label, width, align, format}` with widths summing to `THEME.W`.
- `k.room(rowHeight)` per row; on a page break, **repeat the header** and append " (continued)" to the caption.
- Null cells render `—`, never `0` or blank.
- Numeric columns right-aligned, formatted through `minutes()` or `toLocaleString('en-US')`.
- Zebra at ~3% fill; header rule in `THEME.LINE`.
- Group headings with subtotals.
- A caption line carrying row count and excluded-row count.

This primitive is the largest single piece of new drawing work in v2 and should be built and unit-tested against a synthetic 200-row model **before** any page consumes it.

---

## 6. Dynamic page rule

The report has no fixed length. Implemented through the section registry:

```
{ id, title, layer, scope, applies(model), render(k, model) }
```

- `applies(model) === false` → the section does not render **and does not appear in the contents**.
- A section renders an explicit unavailable state only when **the absence itself is informative** — the page-2 module cards, the page-10 position rows, the page-7 unmeasurable-season note, the page-4 unreadable-season columns.
- No section may render a heading followed by nothing.
- `frame()` throws on a chart with no data and no reason, so `applies()` must be decided **before** the chart call, never by letting the chart decide.

Because `applies()` runs before rendering, the contents page can be assembled from the same registry pass that produced the page indices — one traversal, no second render.

---

## 7. Closing analysis

### 7.1 Biggest implementation risks

1. **The contents page's page numbers.** Ranked first because getting it wrong is expensive and the wrong fix — rendering the document twice — is the obvious one. Use the `bufferPages` / `switchToPage(0)` route that `footer()` already proves. Its known hazard is that writing below the bottom margin adds pages while walking, which is what produced sixteen blank pages once already; `footer()` solves it by zeroing `page.margins.bottom` for the duration, and the contents must do the same or fit comfortably.
2. **The table primitive's page breaks.** It is the only primitive that does not fit the `slot()` model, and every table page depends on it. Build it first, in isolation, against a synthetic long model.
3. **`programReportModel` computes the programme three times.** `philosophyFor()` is called at `routes/philosophy.js:197`, again inside `programmeModel()` at `:112`, and a third time inside `fitFor()` at `:217`. Each call re-runs the roster query, the coach query, the squad query and the whole of `programmePhilosophy()`. At ~15 ms that is tolerable today; v2 adds pages that want more derived quantities, and the temptation will be to add a fourth call. Refactor to compute once and pass down **before** adding derivations, not after.
4. **Scope-count semantics on page 1.** "Freshmen measured" and "freshmen on the roster" are different numbers — `freshmanPoints()` excludes rows failing `minutesAreMissing()`, while `profile.seasons[].intake` counts them. Publishing the wrong one on the contents page would understate coverage on the most prominent page in the report, and it is precisely the class of error the whole module exists to prevent.
5. **Two guards that look alike and are not.** `positionSeasonGrid()` guards cells with `MIN_MEASURED_SHARE` (a *readability* test); `vacancyObservations()` guards with `MIN_POSITION_MINUTES` (a *volume* test). Pages 4, 10 and 13 draw from both. Conflating them in a caption would misstate why a cell is empty.
6. **Terminology drift.** The model fields are `newcomer*` and the rendered word must be "experienced arrival". Without a forbidden-substring test this will regress within two commits.
7. **Cross-session collision.** This worktree is isolated, but `shared/` files are shared with `feature/eligibility-based-matching`, which is actively changing `shared/matching/pool.js` and has already committed an `eligibility_end_year` semantics change. Any v2 change to `shared/freshmanMinutes.js` or `shared/philosophy.js` will need a rebase against that branch.

### 7.2 Calculations needed before any PDF work

In dependency order:

1. `shared/evidenceStrength.js` — pure, testable, no rendering. Everything on pages 2–3 depends on it.
2. `ladderByRank()` returning `contributions: [{season, minutes}]` — additive, one function, one test file.
3. The section registry and its `applies()` predicates — this is what makes the dynamic-page rule and the contents page possible at all.
4. Model derivations, computed once in `programReportModel`: positional eligibility split, projected minutes on expiring positional players, whole-squad depth, progression-by-band, athlete-position filters, mean vacated share, flattened vacancy rows, field-coverage counts.
5. `buildPoolBenchmarks` retaining dial quantiles (and, optionally, the origin split), plus a generalised percentile helper.
6. The five module classifiers.
7. The `programReportModel` single-computation refactor — before 4, if it is going to happen at all.

None of these touch drawing code, and all are unit-testable without rendering a PDF. That separation is already the module's design (`programmeModel` is deliberately split from the drawing "so the numbers can be asserted without rendering a PDF"), and v2 should hold it.

### 7.3 Chart primitives to add

Priority order: `kit.table` (blocks five pages) → `kit.moduleCard` + `kit.strengthChip` (block page 2) → `charts.eligibilityTimeline` (blocks three pages) → `charts.ladderRow` → `kit.contents` → `charts.tenureStrip`.

Extensions: a marker on `charts.columns`, real legends on `charts.paired`, exercise `charts.columns({stacked: true})`.

### 7.4 Changes I recommend to the proposed structure

1. **Merge pages 13 and 14, or reorder them.** As specified, page 13 (athlete position history) and page 14 (current competition) split evidence about one position across two pages, while page 3 already summarises both. Recommend page 13 = historical positional evidence, page 14 = current positional squad, which is the natural historical/current seam — but that is what the brief says, so the real recommendation is narrower: **compute the eligibility split once** and render it on 3, 14 and 15 from a single derivation, rather than three times.

2. **Pages 9 and 10 should be adjacent and share one preamble.** They answer the same question at two resolutions. One methodology note covering `MIN_POSITION_MINUTES`, the three-way partition and the counts-not-rates rule should sit at the top of page 9 and not be repeated on page 10.

3. **Page 16's pool comparison needs the pool to actually compute it.** v1 states the 37%/27% origin finding as prose from prior research. Either compute it in `buildPoolBenchmarks` (Status C, cheap) or mark it in the report as prior research with its date. Leaving a hardcoded statistic beside computed ones is the failure mode this codebase has documented repeatedly — a figure that looks measured and is not.

4. **Do not add a "returning took the opening" count** (page 10). The three outcomes are not mutually exclusive, so the arithmetic `openings − freshmanTookIt − newcomerTookIt` is invalid. Report the returning *minutes share* from `positionHistory().dials` instead, and say plainly that one opening can be filled by more than one route. If a genuine count is wanted, add `returningStarters` to `vacancyObservations` — but that is a change to the analytics core and should be its own commit with its own test.

5. **Page 2's Squad Turnover module needs a denominator that does not currently exist.** "Heavy/moderate/light" turnover requires expiring projected minutes as a share of *total* squad projected minutes, and nothing sums the latter. Trivial to add, but it must be added — classifying on an absolute minute count would make large squads look like high-turnover ones.

6. **Retire the two dead renderers in the same series of commits.** `renderProgrammePdf` and `renderPlayerProgrammePdf` (`philosophyPdf.js:434`, `:450`) and `playerProgrammeModel` (`routes/philosophy.js:153`) have no callers. Leaving them means v2 changes to the shared sections silently alter dead code paths, and any test touching them tests nothing. Remove them in a separate commit from the v2 work so the diff stays readable.

7. **Add the forbidden-phrase test before writing any prose.** Rules 7 and the "available minutes" wording ruling are both enforceable as a substring assertion over the rendered text. Writing that test first makes the two most important constraints in this document mechanical rather than remembered.

---

## 8. Phase 2 amendments

Recorded as the analytics layer was built. Each entry changes something stated earlier in this document; the original text is left in place so the reasoning is traceable.

### 8.1 Projected minutes do not exist for first-years, and the denominator had to change

**Affects:** pages 2 (Squad Turnover), 3, 11, 15, and every use of `projected_minutes`.

`projected_minutes` is carried forward from a player's prior season, so a true first-year cannot have one. On the 2026 rosters it is populated for **0.7%** of players labelled `Fr.` and for **65–81%** of every returning class.

Two consequences, both of which broke the first implementation of the turnover denominator:

| Coverage measured against | Mean | Programmes clearing `MIN_MEASURED_SHARE` | Programmes at full coverage |
|---|---|---|---|
| The whole roster | 50.6% | 1,237 of 1,910 (64.8%) | 0 |
| Players who could carry a projection | 70.4% | 1,558 of 1,888 (82.5%) | 193 |

1. Measuring coverage against the whole roster refuses roughly a third of the pool for a gap that is by design, and no programme anywhere reaches full coverage — a distribution that should itself have been the tell.
2. More seriously, a whole-roster denominator silently omits every first-year's projected contribution, so any share taken against it **overstates turnover** by whatever the incoming class would have played.

`squadProjectedMinutes()` therefore measures coverage against `projectable` rows (non-first-years) and reports `coverageOfRoster` alongside for transparency. Its `total` is the **returning squad's** projected load, and it carries `describes: 'players with a prior season on file'` so the phrasing cannot be lost on the way to a page.

**Wording rule extended.** The existing ban on "available minutes" now also covers calling this denominator "the squad's minutes". `expiringShare()` returns `ofDescribes` for the renderer to use.

### 8.2 No turnover thresholds yet

Page 2's Squad Turnover module returns `classification: 'unclear'` for now. A defensible threshold needs the pool distribution of `expiringShare`, which is not computed — `buildPoolBenchmarks` has no turnover pass. Classifying on an absolute minute count would make large squads look like high-turnover ones, and classifying on an un-benchmarked share would be an invented threshold. The raw measure and its coverage are exposed; the banding waits for a pool pass.

### 8.3 The 15 ms figure in `philosophyQueries.js` is wrong by an order of magnitude

The module header states "One programme is ~15 ms end to end". Measured against a copy of the working database across the twelve largest men's programmes, `philosophyFor()` is **1.3 ms** and a complete `programReportModel()` is **2.6 ms**. The pool build is accurate at ~1.55 s.

This matters for v2 planning: the per-request budget is far larger than the comment implies, so derivations may be computed eagerly in the model rather than deferred. The comment should be corrected when that file is next touched.

### 8.4 Ladder contributions are additive, and verified as such

`ladderByRank()` now returns `contributions: [{season, minutes, name, weight}]`. Verified against the working database over 1,138 programmes and 13,558 rungs, weighted and unweighted: no change to any `median`, `low`, `high`, `band`, `agreement`, `comparable`, `weighted` or `seasonsWithThisMany`.

`weight` is `null` on an unweighted ladder rather than `1`, because "not weighted" and "weighted at full" are different facts and a renderer given `1` for both could not tell which ladder it held.

### 8.5 Evidence strength returns three levels plus a sufficiency flag

The Phase 1 draft proposed four levels including `insufficient`. The implementation uses three — `strong` / `moderate` / `limited` — with a separate `sufficient: boolean`, because the two axes are genuinely independent: a programme can have a complete four-season record that describes the *previous* coach, which is `limited` in relevance while being entirely sufficient in volume. Collapsing those into one scale would have lost the distinction that `new-coach-no-record` exists to make.

`reasons` carries stable slug codes with their numbers, never sentences. Wording belongs to the surface rendering it — the PDF and the tab say different things about the same finding.

---

## 9. Phase 2 refinement pass

### 9.1 Classification vocabulary is benchmark-relative, not judgemental

**Replaces:** the `high` / `moderate` / `low` bands proposed for page 2.

The calculation establishes where a programme sits among the other programmes in its sport. It does not establish whether the programme is good at anything, so the words no longer say that:

| Value | Means |
|---|---|
| `above-benchmark` | above the pool's 75th percentile |
| `typical` | inside the interquartile range |
| `below-benchmark` | below the pool's 25th percentile |
| `mixed` | the seasons behind the figure disagree too much for any single position to describe them |
| `unclear` | we looked and the data cannot support a call |
| `unavailable` | there was nothing to look at |

The band boundaries moved with the words. The first implementation split on the median and p75 and never used p25, which put half the pool in the bottom band and made `typical` mean "third quartile" — a word doing the opposite of its job. It is now a genuine interquartile split.

A page can now say *"Freshman opportunity — above programme benchmark"*, which is a report, where *"Freshman opportunity — High"* was a claim. These strings are the machine-readable contract; a renderer maps them to its own wording exactly as `VERDICT_LABEL` already does for `classifyProgramme`.

### 9.2 The origin benchmark is measured

**Replaces:** §Page 16's dependency on v1's prose, and the "optional Status-C" framing in §4.

`buildPoolBenchmarks` now derives `byOrigin: { overall, byDivision }` inside the pass that was already reading every row. The build grows by roughly a sixth and remains once per process. Definitions come from `freshmanPoints` itself, so the pool and the programme halves cannot diverge: same true-freshman rule, same exclusion of a first-year already on the previous roster, same refusal of a row whose minutes were never published.

Measured shares of first-years playing a starter's season:

| | Men's domestic | Men's international | Women's domestic | Women's international |
|---|---|---|---|---|
| **Overall** | 21.3% (n=18,532) | 36.2% (n=5,417) | 30.5% (n=26,263) | 39.8% (n=2,169) |
| **NCAA D1** | 20.3% | 39.9% | 28.4% | 38.2% |
| **NCAA D2** | 15.0% | 35.5% | 27.7% | 42.6% |
| **NCAA D3** | 25.0% | 28.6% | 33.7% | **25.8%** |
| **NAIA** | refused — one season inside the window | | refused | |

The v1 prose said "37% against 27%, and the effect disappears entirely at Division III". The international figure holds (36.2%); the domestic one was six points out. "Disappears at D-III" holds for the men's game (25.0 against 28.6) and is wrong for the women's, where it **reverses**: domestic first-years reach a starter's season more often than international ones.

Consequences for page 16: the comparison uses the programme's **own division** wherever that division is readable, falling back to the pool as a whole and refusing entirely when neither group clears `MIN_COHORT_PLAYERS` / `MIN_COHORT_SEASONS`. Divisions are never ranked against one another. No difference, ratio or effect size is computed — two shares beside their sample sizes describe who played; "40% more likely" invites a reading of why.

### 9.3 A squad-turnover pool distribution is not defensible

**Confirms:** §8.2, with the measurement behind it.

| Denominator coverage | Programmes | Mean expiring share |
|---|---|---|
| 0.50–0.70 | 328 | 0.456 |
| 0.70–0.85 | 454 | 0.431 |
| 0.85–0.95 | 399 | 0.402 |
| 0.95–1.00 | 313 | 0.388 |

Three reasons, any one of which is disqualifying:

1. **The share moves with data completeness.** r = −0.147 across the window and −0.215 before entry. A percentile over these would rank programmes partly by how complete their projections are.
2. **The missing programmes are not missing at random.** 18% have no readable denominator, and they are exactly the thin-coverage programmes whose shares would be most inflated — so the pool would be built from a biased subset of the thing it is meant to describe.
3. **The before-entry measure is degenerate for later entrants.** Under the five-year model a 2026 senior is eligible through 2027, so for a 2027 entrant only graduate students qualify: the median share across the pool is exactly 0.

`squadTurnover.classification` stays `'unclear'` with `classificationReason: 'pool-distribution-not-defensible'`, and carries `classificationEvidence` so the refusal cannot be quietly reversed later without confronting the measurement.

### 9.4 Eligibility has a third meaningful group

**Amends:** pages 3, 14 and 15.

Because a 2026 senior is eligible through 2027, "eligibility ends before entry" catches only graduate students for a 2027 entrant — 1,103 rows of 57,807. Reporting only that would tell most athletes nobody is leaving while a quarter of the squad plays its final season beside them.

`currentPlayersInFinalSeasonAtEntry` names the group whose last eligible season *is* the entry season. It is a subset of those eligible at entry, not a fourth disjoint bucket. Pages 3 and 15 should lead with it.

Turnover is likewise reported only against **bounded** horizons. An "across the whole window" share returns the denominator back — it read 100% at every programme in the pool — so it has been removed in favour of `expiringByYear`, `expiringBeforeEntry` and `expiringThroughEntrySeason`.

### 9.5 Field names renamed for accuracy

Renamed before any renderer depends on them:

| Was | Now | Why |
|---|---|---|
| `positionDepthNow` | `currentPositionPlayers` | "depth" reads as a coach's depth chart |
| `positionDepthAtEntry` | `currentPlayersEligibleAtEntry` | read as a predicted roster |
| `knownExpirationsBeforeEntry` | `currentPlayersEligibilityEndsBeforeEntry` | says what the record shows |
| `knownPlayersStillEligibleAtEntry` | *(removed — duplicated the above)* | two names for one array |
| `eligibilityUnknownAtEntry` | `currentPlayersEligibilityUnknown` | consistency |
| `projectedMinutesAssociatedWithExpiringPlayers` | `currentProjectedMinutesOfPlayersEndingBeforeEntry` | leads with "current" |
| `projectedMinutesAssociatedWithPlayersStillEligible` | `currentProjectedMinutesOfPlayersEligibleAtEntry` | ditto |
| `positionReplacementBehaviour` | `positionOpeningOutcomes` | past-tense outcomes, not a projection |
| `expiringAcrossWindow` | `expiringByYear` + `expiringThroughEntrySeason` | the old measure was definitionally ~100% |

A test walks the entire model and fails on any field name matching `available|likely|will|predicted|forecast|chance|odds`, on any minute figure named as open/expected/available, and on any athlete roster group not prefixed `current`. `openings` is explicitly allowed: it is a past-tense count of places that actually came free.

### 9.6 A `nameKey` property worth knowing

`nameKey` strips digits, so `Player 1` and `Player 2` share a key. Real rosters do not name people that way, but fixtures do — and a numbered fixture reads as one first-year returning for four years rather than four separate intakes, which silently weakened two test files before it was caught. Pinned by a regression test.

---

## 10. Phase 3 — the front decision layer, as built

Pages 1–3 are rendered; pages 4+ remain the v1 evidence pages, unchanged.

### 10.1 Page numbering

One render pass. Each section calls `at(id)` as it begins, recording `doc.bufferedPageRange().count` — the number of pages that exist, which while writing forward is also the 1-based index of the page being written. Page one is reserved with an immediate `addPage()` and drawn last via `switchToPage(0)`, the mechanism `footer()` already relies on. `footer()` then runs over the finished range.

The contents page draws in **absolute coordinates only**. Anything consulting the flow cursor — `k.room()` in particular — would call `addPage()` while writing to page one and append a blank page to a finished document.

Rows are listed in **ascending page order**, not registry order. The two diverge the moment a v1 section renders outside registry order (`eligibility-outlook` renders inside Part One but is declared after Part Two's sections), and a contents page whose numbers do not ascend is worse than none. Sections with no recorded page are not listed at all, so the contents never advertises a section that has not been built yet.

### 10.2 The five Page 2 modules

| Module | Headline | Badge |
|---|---|---|
| Freshman opportunity | ladder rank-1 median, bar with pool median as marker | classification |
| Experienced arrival reliance | newcomer dial %, bar with programme-pool median as marker | classification |
| Replacement behaviour | dominant route, three-way stacked minutes split | route, not a rank |
| Coach context | current coach, verdict note | relevance, not quality |
| **Current squad outlook** | next meaningful expiry year + minutes attached | **none** |

Classification chips are drawn identically regardless of value. A colour scale would rank programmes by hue, which is exactly what the benchmark vocabulary exists to avoid; only `unclear` and `unavailable` are muted.

The squad-outlook headline is the earliest year carrying **at least 10%** of the readable projected load, not merely the earliest non-zero year — one programme's next year held 50 minutes of 4,894, which is true and a headline about nothing.

### 10.3 Page 3 and the eligibility groups

Leads with `currentPlayersInFinalSeasonAtEntry`. The three-band timeline shows **before you arrive** / **your entry season** / **beyond entry**, with players carrying no eligibility year counted in none of the three and stated separately. Every group name begins `current`; the note about unknowable future recruits is unconditional.

No new model field was required — `currentProjectedMinutesOfPlayersInFinalSeasonAtEntry` was added during the §9.4 refinement.

### 10.4 Known issue in the v1 evidence pages

`facetOrigin` still prints the prose Phase 2 disproved: *"an international first-year is about 40% more likely to play a starter's season than a domestic one — 37% against 27%"*. The measured pool gives **36.2% against 21.3%**, and the claim that the effect "disappears entirely at Division III" holds for the men's game but **reverses** in the women's. The model now carries the measured figures; the v1 page does not read them. This is the first thing Phase 4 should fix.

The Phase 3 wording tests are therefore split: the minutes rules apply to the whole document, the prediction rules to pages 1–3 only, with the reason recorded in the test.

---

## 11. Phase 4 — the programme evidence layer, as built

### 11.1 Page structure

| Page (programme / athlete report) | Section | Question |
|---|---|---|
| 1 | Contents | — |
| 2 | Programme at a glance | interpretation |
| — / 3 | Athlete opportunity at a glance | interpretation |
| 3 / 4 | The first-year intake | How many arrive, how many play? |
| 4 / 5 | The first-year ladder | How deep into a class does real playing time go? |
| 5 / 6 | After the first season | What happens in year two? |
| 6 / 7 | Experienced arrivals | How often are non-first-years added, and how much do they play? |
| 7 / 8 | Who the arrivals are | What kind of player, and who has arrived now? |
| 8 / 9 | Replacing minutes | Where do the following season's minutes go? |
| 9 / 10 | Position by position | Does that depend on the position? |
| 10 / 11 | Current squad outlook | When does the load reach the end of its eligibility? |
| 11 / 12 | The current squad in full | Who is on the roster, and how established? |
| — / 13–14 | Athlete facets (still v1) | Phase 5 |
| 12 / 15 | Methodology | Phase 5 redesign |

Programme reports run **12 pages**, athlete reports **15**, and a sparse programme collapses to **8**. Pages are gated on the section registry, so a page is never opened before its emptiness is discovered.

### 11.2 The origin fix

`facetOrigin` no longer contains a percentage. It reads `summary.athlete.originContext`, prefers the programme's own division, and states the reason when no comparison can be made. The replaced sentence was wrong in two ways: 37%/27% against a measured 36.2%/21.3%, and "disappears entirely at Division III" holds only for the men's game.

### 11.3 Terminology

Every reader-facing "transfer" describing a historical arrival is now "experienced arrival", including `k.stacked`'s legend, which had read *stayed / freshmen / transfers* since v1. The word survives only where it names one of several things a roster absence could mean, and where `prior_programme` records an actual origin. Internal `newcomer*` fields are unchanged — renaming them would be API churn for no analytical gain.

### 11.4 New primitives

| Primitive | Where | Notes |
|---|---|---|
| `kit.table` | `philosophyPdf.js` | Flow-based, repeats its header after a break, never splits a row, group headings kept with their rows, nulls render `—` |
| `charts.dotLadder` | `philosophyPdf.js` | Seasonal dots + median bar + pool interquartile band; labels stagger and drop on collision |
| `charts.eligibilityTimeline` | `philosophyPdf.js` | Position lanes × eligibility years, dot size = projected minutes, hollow where none |
| `fitText` | `philosophyPdf.js` | Moved from `reportFront.js`; one implementation for both layers |

### 11.5 Weighted ladder

Drawn only where `weightingApplied && weightedAgrees === false`. It appears as a compact **Current-coach relevance** block naming both figures and quoting the verdict's own note, never as a second ladder chart. Where weighting does not apply or changes nothing, the page says nothing about it.

### 11.6 Model gap closed

`squadDepth(squadRows)` was added to `shared/philosophy.js` and exposed as `summary.programme.squadTurnover.squad`. `depthChartAt` only ever answered for one position and returned `null` for `UNKNOWN`; pages 11 and 12 need every row, and a player missing from a squad list is one the reader assumes is not there.

---

## 12. Phase 5 — the report, complete

### 12.1 Final structure

| Layer | Pages (programme / athlete) |
|---|---|
| Navigation | 1 |
| Interpretation | 2, and 3 for an athlete |
| Programme evidence | 3–11 / 4–12 |
| Athlete evidence | — / 13–17 |
| Supporting record | dynamic |
| Methodology | final, one or two pages |

Athlete pages: **your position historically**, **when a place opens**, **who is at your position now**, **your arrival window**, **where you are arriving from**. There is no sixth summary page — page 3 already answers "what should I notice", and a recap after five evidence pages would be a second copy of it.

### 12.2 Measured page counts

| Report | Pages | Sections |
|---|---|---|
| Anderson (SC), Akron, Adams State | 16 | 14 |
| Air Force, Allegheny | 15 | 13 |
| Albertus Magnus (sparse) | **10** | 8 |
| Athlete reports | 21–22 | 19–20 |

### 12.3 Appendices, and the one deliberately absent

Built: the first-year record, the experienced-arrival record, the vacancy record. Gated — the first two need at least six rows to earn a page, since a handful of players are already individually visible as dots; the vacancy record renders wherever openings exist, because those events appear nowhere else in full.

**No current-squad appendix.** Page 12 already lists every player with position, class, projected minutes, eligibility and previous programme. The registry entry was removed rather than left to render a duplicate.

### 12.4 Methodology

Fifteen sections in two columns, opening with three callouts — **history is not forecast**, **missing is not zero**, **sample size matters**. Continuation pages carry their own heading. Thresholds are printed from the constants rather than transcribed, so the page cannot drift from the code. No percentage is hardcoded.

### 12.5 What was removed

`facetLevel` no longer renders. It placed `soccer_score` out of 100 beside a self-entered `football_ability` out of 10 and then disclaimed the comparison it had invited. The function and both fields remain.

### 12.6 A glyph class-of-bug, now guarded

Helvetica is encoded as WinAnsi, so a character outside that set prints as stray punctuation rather than failing. Three reached pages across the phases: `→` in the eligibility column (Phase 3), `→` in vacancy transitions and `≠` in the methodology callouts (Phase 5). A test now decodes every character the report draws and fails on anything outside the set.

---

## 13. Phase 6 — visual polish and production hardening

The methodology and the information architecture were frozen before this phase. Nothing here
introduces an analytical concept, a classification or a section. Everything is layout, wording,
or a correctness defect that layout work exposed.

### 13.1 The layout guard

Every visual defect found by hand in phases three to five was the same shape: something drawn
wider or lower than the box it was given. `server/lib/reportAudit.js` instruments the drawing
calls this report makes — `text`, `rect`, `roundedRect`, `circle` — and records four classes:

| Class | What it catches |
|---|---|
| `violations` | content outside the page's content box, on any of the four edges |
| `clipped` | a column HEADING that did not fit its column |
| `unencodable` | a character Helvetica's WinAnsi encoding cannot draw |
| `collisions` | text drawn on top of text already on that page |

Two accommodations, both declared rather than inferred. Page bounds are snapshotted when a page
is **created**, because `footer()` drops the bottom margin for its own write and reading it live
would move the floor out from under the check exactly where the check matters. Drawing that
belongs outside the box calls `reserved()`; "it is near the footer so it is probably the footer"
is precisely the reasoning that would let a real overflow through.

Collisions are compared as **ink**, not as boxes: a `doc.text` with a generous `width` and three
words in it occupies three words of page, and treating its whole box as occupied would flag most
of the report.

**Nine defects found by the guard, none of which four rounds of raster review had caught:**

1. A player at the maximum of the scatter's x-axis was drawn centred on the axis end, so half of
   the best first-year in the report hung off the side of the page.
2. The scatter's x-max label ran six points past the content edge.
3. pdfkit ignores `ellipsis` when it is paired with `lineBreak: false`. Thirty-nine call sites
   asked for that pairing and every one was silently getting the wrap it had explicitly asked
   not to have; a long programme name ran four hundred points off an A4 page.
4. With that made visible, the arrival window's "future recruits, transfers, injuries and
   eligibility changes are not known" was clipping to "are not kno".
5. Ten column headings were clipping — "MINUTES VACATED" to "MINUTES V…", "RETURNING SHARE" to
   "RETURNING…".
6. A wrapped heading's **first** line was never fitted. "FIRST-YEAR" in a 48-point column stayed
   whole and, being right-aligned, printed leftwards on top of the column beside it — inside the
   page, and therefore invisible to a bounds check.
7. `k.facts` advanced on the value's height, so a label that wrapped to two lines had the next
   row's label drawn four points into its second line.
8. `dotLadder` tracked one shared x-position and alternated tiers, which still let two labels on
   the same tier land two points apart. "’25" printed across "’23" three times on one page.
9. The arrival window advanced a fixed eleven points past a sentence that wrapped once the
   minutes reached four digits.

### 13.2 The typographic scale

The same level of the document was set at three different sizes depending on which module drew
it — a page title was 20pt on an evidence page, 19pt on a glance page and 13pt on the methodology
continuation — so a size change told the reader nothing.

| Level | Set as | Used for |
|---|---|---|
| 1 kicker | 8pt bold claret, tracked | which part of the report this page belongs to |
| 2 title | 19pt bold ink | what this page is |
| 3 question | 10pt grey | what it answers; the scope strip beneath is 7.5pt |
| 4 section | 9pt bold claret small caps, ruled | a titled region: a card, or a block within a page |
| 4 module | 9.5pt bold ink | a chart's own title |
| 5 body / caption / note / label | 9.5 / 8 / 8 / 6.5pt | prose, chart subtitles, footnotes, field labels |

Claret small capitals mean "a titled region begins here" wherever they appear — a card and a
section are the same level of the document, so cards are now set the same way. Ink at module size
means "this is a chart". Nothing else may use either.

`pageHead()` replaces four near-identical page openings. One of them advanced the cursor by a
fixed 24 points on top of the advance pdfkit had already made, which is where the forty-point
hole between every glance-page title and its subtitle came from.

### 13.3 College branding — measured, then decided

| Asset | Coverage | Decision |
|---|---|---|
| `primary_color` | 1,438 of 2,401 active programmes (60%) | one accent rule on the cover, gated at 2:1 against the page |
| `secondary_color` | 46% | unused |
| `nickname` | 86% | printed on the cover beside division and conference |
| `logo_url` | 69% | **not used** |
| `mascot` | 64% | unused |

Fifty of the recorded colours are a near-white, a literal white or a school yellow that prints as
a smudge — Indiana's is `#EDEBEB`. Below 2:1 the accent falls back to Thriv3 navy, so the layout
is identical whether a programme records a colour or not. Colour never touches a chart, a
classification or a number: a colour that carries meaning somewhere cannot be decoration here.

**No logo.** The stored URLs are remote Wikimedia SVGs. Fetching and rasterising one inside PDF
generation buys a network dependency and an SVG renderer for an image nobody is reading the
report for.

### 13.4 Empty-column gating

`dropWhenEmpty` on a column omits it where every rendered row is null for it and shares the freed
width among the rest. Opt-in per column, never automatic, and **emptiness only** — a column of
zeros is a measurement. The three previous-programme columns carry the flag; `prior_programme` is
recorded on current-roster rows and almost never on historical ones, so the experienced-arrival
appendix was spending a fifth of its width on dashes at every programme sampled. `note` may be a
function of the dropped keys, so the sentence explaining what a dash means there is not printed
beside a column the reader cannot see.

Class, eligibility and origin columns deliberately keep their dashes: a column with nothing in it
there is itself the finding, and the scope strip states the coverage.

### 13.5 Never a zero where the answer is "we cannot tell"

American International records no eligibility year for any of its 53 players. "Your arrival
window" therefore printed a 40pt **0** over "in their final eligible season in 2027", then BEFORE
ENTRY 0, FINAL SEASON AT ENTRY 0 and BEYOND ENTRY 0, with the reason in 6.8pt grey underneath —
the exact null-is-not-zero defect this report exists downstream of, on its most important card.
The programme-at-a-glance outlook did the same, and its refusal was sized for two columns and
drawn from column one, so it printed straight through "ELIGIBILITY ENDS".

All three places now refuse at the size the zeros were.

### 13.6 Vocabulary, checked against what is drawn

The model's own fields are `freshman` and `transfer`, correctly — which is exactly why a
source-level check would not have caught this. A test reads the PDF and asserts: never "freshman"
or "freshmen" to the reader; "experienced arrival" throughout, with "transfer" permitted only
inside the two sentences that exist to say the roster cannot tell one from any other route in;
one apostrophe in "a starter’s season"; the three temporal groups named identically wherever they
appear; "programme", never "program", outside the report's own name.

### 13.7 Names and the font

Of 132,590 distinct roster names, 876 carry a non-ASCII character and **four** carry one Helvetica
cannot encode — 0.003%. Three of those four are decomposed forms, "João" written as J-o-a-tilde-o,
where WinAnsi has the composed letter and no combining mark at all, so the tilde was dropped and
the player's name was silently misspelled. Every string is now composed to NFC before it is drawn.
That is the same string written the other way, not a transliteration: nothing is stripped and no
letter becomes a different letter.

The fourth is a Cyrillic homoglyph in one name. It is reported by the audit rather than
transliterated or substituted. **Unicode names are not a production risk at this font**; the
residual is a data defect that is now visible instead of silent.

### 13.8 Performance

Measured on a copy of the working database, medians of twelve.

| Scenario | Model | Render | Total | Size |
|---|---:|---:|---:|---:|
| Cold — pool benchmarks not yet built | 1,935 ms | 73 ms | **2,008 ms** | 54 kB |
| Typical programme | 2.1 ms | 28.5 ms | **30.6 ms** | 54 kB |
| Typical athlete report | 2.4 ms | 34.9 ms | **37.3 ms** | 71 kB |
| Sparse programme | 1.4 ms | 14.5 ms | **15.8 ms** | 26 kB |
| Largest roster (81 players) | 3.2 ms | 29.3 ms | **32.5 ms** | 54 kB |
| Largest athlete report | 3.2 ms | 42.2 ms | **45.4 ms** | 78 kB |
| Most vacancy events | 3.8 ms | 37.0 ms | **40.8 ms** | 68 kB |

The cold figure is the pool-benchmark build, once per process, cached by fingerprint thereafter —
unchanged by this phase. Warm, rendering is 92% of the work at 15–45 ms for 10 to 24 pages. No
hotspot worth attacking; nothing was optimised.

### 13.9 QA matrix

Twenty reports: the six representative programmes, three athlete reports, and eleven edge cases
chosen from the data rather than for looking good — the longest programme name, the largest
first-year intake, the largest roster, the most players at one position, the most recorded
previous programmes, zero projected-minute coverage, no eligibility years at all, the largest
vacancy history, a goalkeeper, an international athlete, and an entrant beyond the roster horizon.

| Report | Kind | Pages | Sections | Omitted | Overflow / collision | Glyph / heading | Contents | Visual |
|---|---|---:|---:|---|---|---|---|---|
| Anderson (SC) | generic | 16 | 14 | — | pass | pass | pass | pass |
| Akron | generic | 16 | 14 | — | pass | pass | pass | pass |
| Air Force | generic | 15 | 13 | arrival record | pass | pass | pass | pass |
| Allegheny | generic | 15 | 13 | arrival record | pass | pass | pass | pass |
| Adams State | generic | 16 | 14 | — | pass | pass | pass | pass |
| Albertus Magnus | generic | 10 | 8 | development, by position, outlook, squad, arrival record, vacancy record | pass | pass | pass | pass |
| Adams State + Rhys Davies | athlete | 22 | 20 | — | pass | pass | pass | pass |
| Akron + Rhys Davies | athlete | 23 | 20 | — | pass | pass | pass | pass |
| American + Shaan Anad | athlete | 22 | 19 | arrival record | pass | pass | pass | pass |
| West Virginia University Institute of Technology | generic | 13 | 10 | development, by position, arrival record, vacancy record | pass | pass | pass | pass |
| Concord | generic | 16 | 12 | by position, vacancy record | pass | pass | pass | pass |
| Mount Mercy | generic | 11 | 8 | ladder, development, by position, first-year record, arrival record, vacancy record | pass | pass | pass | pass |
| Union (KY) + Rhys Davies | athlete | 13 | 9 | ladder, development, by position, athlete glance, position history, openings, position now, arrival window, first-year record, arrival record, vacancy record | pass | pass | pass | pass |
| Baker | generic | 11 | 8 | ladder, development, by position, first-year record, arrival record, vacancy record | pass | pass | pass | pass |
| American International + Rhys Davies | athlete | 24 | 19 | outlook | pass | pass | pass | pass |
| Lake Erie | generic | 19 | 14 | — | pass | pass | pass | pass |
| Concord + QA Keeper | athlete | 21 | 17 | by position, openings, vacancy record | pass | pass | pass | pass |
| Adams State + QA Late Entrant | athlete | 23 | 20 | — | pass | pass | pass | pass |
| Akron + QA International | athlete | 23 | 20 | — | pass | pass | pass | pass |
| American International + Rhys Davies | athlete | 24 | 19 | outlook | pass | pass | pass | pass |

Omitted sections are the dynamic-page rule working: Albertus Magnus drops six, Union (KY) drops
every athlete page because nobody on its roster is recorded at the athlete's position, and Baker
and Mount Mercy drop the ladder and development pages for want of readable minutes.

### 13.10 Cleanup

`philosophyReport.js` still carried four hundred lines of the previous report's own sections,
unreachable since the evidence layer replaced them page for page and none of them exported. The
file's only export is `renderProgramReport`; it is now 128 lines. The v1 renderers themselves stay
whole in `philosophyPdf.js`, still used by `renderProgrammePdf` and `renderPlayerProgrammePdf`.

### 13.11 What is still worth knowing

- **A stored zero is treated as a measurement.** 25.6% of first-year rows carry
  `minutes_played = 0` rather than `NULL`, and at some programmes — Lake Erie, 86 of 110 —
  most of the intake does. The report reads those as "measured, did not play", which is right if
  the roster published a zero and wrong if a parser turned a blank into one. That is a data
  question upstream of this report and the analytics are frozen, so it is flagged rather than
  changed. It does not move the headline metric, which is the best first-year of a season.
- The origin comparison is across every position while the card above it is position-filtered.
  Both are now labelled with their scope, on the card and on the page.
- Three evidence pages still use roughly two-thirds of their height on a sparse programme. That is
  the dynamic-page rule preferring air to filler, not an oversight.


### 13.12 A second and third sweep

The guard's collision check was added after the first raster pass, and both it
and a closer read of the edge cases found more:

- **A previous programme they never left.** American International's roster
  records the player's own programme in the prior-programme field, so the
  position table printed "American International" as six of its own players'
  previous programme. `depthChartAt` now applies the `arrivedFromElsewhere`
  guard `squadDepth` has always applied.
- **Unknowable counts printed as zero.** The same page listed three eligibility
  counts as 0 beside "18 with no eligibility year recorded". `k.facts` now
  renders a null value as the grey em dash a null table cell has always used,
  and the page says the counts are unknown rather than zero.
- **The report repeating itself.** The stacked bar printed its three
  percentages inside its segments and the same three underneath, word for word.
- **The eligibility timeline** was drawn 26 points tall on a page with four
  hundred spare, and its per-year clusters were offset from a running counter
  rather than about the lane's centre, so a year holding one player sat at the
  top of its lane and a year holding five across the middle.
- **A continuation page with no identity.** Page fourteen of Lake Erie's report
  opened straight into SEASON / PLAYER / POSITION with nothing to say which of
  three tables it was.
- **"only 0 in 0 seasons"** for an empty cohort — accurate, and reads as a
  broken template.


---

## 14. Phase 3 — the lifecycle layer

Three additions, on a branch off this one: multi-year player development in
place of the year-one-to-year-two page, roster continuity with its own
departure composition, and observed destinations behind a gate. Nothing else
about the report's methodology or architecture changed.

### 14.1 What came across, and what did not

Eight files from `research/player-lifecycle-transfer-intelligence` (`e95013b`),
copied verbatim — the point of validating them there was that they arrive here
unchanged:

```
shared/lifecycle/lifecycle.js       Track A, a player's observed history
shared/lifecycle/development.js     Track B, trajectories with denominators
shared/lifecycle/continuity.js      Track C, returned / not observed / unreadable
shared/lifecycle/movement.js        Tracks D–G, matching, comparison, outcome
shared/lifecycle/hometown.js        the explicit location table
+ lifecycle.test.js, development.test.js, movement.test.js  (71 tests)
```

The research scripts, their 43 output files and the audit stayed on the
research branch. Nothing that reads a snapshot database belongs on an
integration branch.

Built here on top of them:

```
shared/lifecycle/readable.js        one definition of a readable minute
shared/lifecycle/pool.js            the cross-programme pass, built once per sport
shared/report/lifecycleSummary.js   the model three pages are drawn from
server/lib/lifecycleQueries.js      the database half, cached per sport
server/lib/reportLifecycle.js       the pages
```

`recruiting_arrivals` was recovered separately, onto `recover/recruiting-
arrivals` off `main`, and is not on this branch. Its builder existed only
inside the untracked half of `stash@{0}`; four files were read out of the
stash's commit object without restoring anything, and dropping the table from
a snapshot and re-running `npm run build:recruiting` reproduces it exactly —
43,162 men's and 44,287 women's rows, with a checksum over every
classification column identical to the original's. Its
`prior_confidence: NAME_MATCH` is a name match and nothing in the report may
present it as a confirmed history.

### 14.2 A minute that could not be read

The lifecycle primitives call a season measured when `minutes_played` is not
null. That is the right rule for MATCHING — a stored zero is still a row that
identifies a person — and the wrong rule for REPORTING.

Read that way, two Division III programmes whose rosters publish appearances
and a zero in the minutes column produced **"0% of first-years here reach a
starter's season"**, and the pool those programmes are compared against was
depressed by roughly a hundred more of them. `shared/lifecycle/readable.js`
applies the rule the freshman pages have always used — a zero is only a zero
when the same row says zero games — at the boundary between the two layers.

The pool moved, and the size of the move is the size of the defect:

| Reaching 600 minutes | p10 before | p10 after | median before | median after |
|---|---:|---:|---:|---:|
| by year 1 | 0% | 10% | 22% | 24% |
| by year 2 | 3% | 19% | 33% | 36% |
| by year 3 | 1% | 23% | 38% | 40% |
| ever | 16% | 22% | 36% | 38% |

The rule is applied inside `programmeDevelopment` and `programmeContinuity`
rather than at their call sites, and once over the whole pool before any
matching runs. It cannot change a match: identity is hometown, position, class
progression and graduation year, and minutes are not among them.

### 14.3 The gate

Destination movement renders only where all three hold. Each names itself, so
a test asserts on the reason rather than on an absence.

1. The division is not on `DESTINATION_SUPPRESSED_DIVISIONS` — NCAA D3, USCAA,
   NJCAA.
2. The division's pool-wide destination coverage clears 5%.
3. The programme itself has eight or more traced moves.

Measured rather than assumed, on this data:

| Division | Departures | Traced | Coverage |
|---|---:|---:|---:|
| NCAA D1 | 11,318 | 2,335 | **20.6%** |
| NCAA D2 | 13,103 | 1,252 | 9.6% |
| NAIA | 3,340 | 257 | 7.7% |
| NCAA D3 | 15,462 | 531 | 3.4% |
| USCAA | 54 | 0 | 0% |

Both gate 1 and gate 2 exist because they answer different questions: the
floor asks whether the data supports the page, the list asks whether we have
decided to publish it. On today's data the floor alone would exclude all three
named divisions.

### 14.4 Length

| Report | Before | After |
|---|---:|---:|
| Akron, generic (D1, traced) | 16 | 19 |
| Saint Mary's, generic (D1, most traced) | 16 | 19 |
| Anderson (IN), generic (D3) | 12 | 14 |
| Albertus Magnus, generic (sparse D3) | 10 | 12 |
| Cedarville, generic (D2, gate closed) | 16 | 17 |
| Akron / Shaan Anad, athlete | 23 | 27 |

**A Division I generic report is one page over the ±2 target**, and the reason
is a real tension in the brief rather than an oversight. The destinations page
has to lead with how little of the movement is visible; the named rows cannot
share that page without pushing the coverage statement down it. They are in the
supporting record instead, where every other "rows behind the charts" table
lives — which is the right home for them and costs the page. Dropping
`table-destinations` from the registry would bring every report to +2 and lose
the only place the traced moves are named.

### 14.5 What the pages do

**How players develop after they arrive** replaces "After the first season".
Four columns, one per year, each over the cohort that could have reached it —
the denominators shrink to the right and are printed. Then the individual
careers, capped at eight and chosen by a stated rule (longest observable
history first, ties by name; nothing selected for how it looks). Then time to
600 minutes, over first-years who arrived early enough to have had three
seasons with published minutes. The last row of that table is "not within their
first three seasons" and the page says outright that it is not a failure.

**Roster continuity** leads with retention against the pool, breaks it down by
what the player played the season before, and then carries the departure
composition: expected exits and early departures from the class label alone,
with the traced / unsettled / untraceable split indented beneath the early
group it divides. Eligibility years are not used, and the page says why.

**Where we can trace players next** puts coverage first at full size, states
what the page is a sample of in a callout, and only then shows the three
measures — football rating, academic rating, division — as three separate bars
that are never summed. The prior-role breakdown follows. The names are in the
supporting record.

**Players at your position we could trace** shows the athlete's own position
where the sample carries it. Where it does not, the page says so in a callout
and shows the position's own traced moves anyway, however few, rather than
reprinting the programme's list from a page the reader has already passed.

### 14.6 The words these pages may not use

"Transfer" does not appear on any lifecycle page. The rosters cannot tell a
transfer from a graduate move, a year abroad, a player who stopped, or a
spelling the join missed; what they show is a name at another programme the
following season, and that is what the pages say. There is no rate over
departures anywhere, and no code path that divides one by the other.
Satisfaction, culture and any reason for leaving are absent, as are successful
and failed. Existing tests enforce the first of these; new ones enforce the
rest.

### 14.7 What the rasterised reports showed

Eight reports were rendered, rasterised and read. The layout guard reports ink
outside a box and ink over ink; it cannot see a number that is inside its box
and means the wrong thing.

- **"0 of 42"** printed under "minutes not published here" — the same confident
  zero the percentage had just been refused for, restated as a fraction. The
  column now states the cohort alone.
- **Post-move minutes could be an unpublished zero.** `attachRoleAndOutcome`
  read raw destination rows, so "0 min" was printed beside a named player who
  may well have played. The readability rule now runs before it.
- **Three scope lines** ran past the one line `k.scope` draws and lost their
  last fact to an ellipsis.
- **Retention was drawn with `charts.paired`**, which prints two unlabelled
  figures as "50 · 56%".
- **Two columns headed "CAME BACK"**, and a header that wrapped onto the first
  row of data.
- **Every dimension chart printed its name twice**, a line apart.
- **The athlete module repeated the programme's bars and rows** when it
  broadened.

The guard was extended once, for the class of defect that let one of these
through: a chart title or subtitle is drawn with `lineBreak: false`, so
shortening one loses authored prose. `frame` now reports it. Table headings
were the only thing watched before.

### 14.8 Cost

| | Before | After |
|---|---:|---:|
| Model build, warm, per programme | 2 ms (median) | 3 ms |
| PDF render, per report | 26 ms | 32 ms |
| Cold start, both sports | 2.3 s | 5.6 s |

The lifecycle pool is built once per sport per process — 1.7 s men's, 1.6 s
women's — and rechecked against the same cheap fingerprint the philosophy
benchmarks use. It drops its 277,000 roster rows on the way out and keeps
87,000 compact movement records; holding the rows instead would be the
difference between tens of megabytes and hundreds.
