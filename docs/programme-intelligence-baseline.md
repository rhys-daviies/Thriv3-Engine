# Programme Intelligence — the internal-data baseline

**Status:** frozen 2026-08-31 on `feature/report-v2-lifecycle`.
**Scope of this document:** what the system is, what it may and may not claim,
where the numbers come from, and what is known to be missing.

If you are new to this feature, read this file first. The page-by-page
engineering spec is [`program-intelligence-report-v2.md`](program-intelligence-report-v2.md)
— that file records how each page was built and why; this one records what the
system *is* and the contract it keeps.

---

## 1. What Programme Intelligence is

A recruiting family asks one question in many forms: *what has actually
happened to players like me at this programme?* Every college athletics site
answers with a highlight reel. Nobody answers with the record.

Programme Intelligence is that record. It reads five seasons of published
rosters — 276,745 player-seasons across 2,404 school-sports — and produces one
PDF per programme, optionally narrowed to one athlete, that says what the
programme has done: who it recruited, who played, how far the minutes reached,
who stayed, and where the ones who left turned up.

It is a **track record to weigh, not a prediction**. That sentence is on page
one of every report at full size, and the whole codebase is built to keep it
true. The recruiting season being decided has not been played; nothing in the
document says what an arriving player would get.

Two rules run through every module:

1. **A figure that could not be read is never counted as none.** A blank is not
   a zero. A player whose minutes were never published is left out of a chart
   rather than drawn at zero, counted separately, and the gap is stated on the
   page. Charts handed no data *and no stated reason* throw rather than draw an
   empty axis, because an empty axis reads as a confident zero.
2. **A small sample is shown as a count, never as a rate.** A share of three
   reads more confidently than it deserves to.

### Entry points

| | |
|---|---|
| `GET /api/philosophy/:collegeId/report.pdf` | the programme report |
| `GET /api/philosophy/:collegeId/report.pdf?playerId=…` | the athlete report |
| `programReportModel({ collegeId, playerId })` | the structured model, in `server/routes/philosophy.js` |
| `renderProgramReport(model, { audit })` | the document, in `server/lib/philosophyReport.js` |

Everything is computed at request time from the roster tables. There is no
report cache, no materialised metric table, and **no write**: report generation
is strictly read-only (see §10).

---

## 2. The three-act report

An athlete report answers the questions a family asks first, then widens.

**ACT I — UNDERSTANDING YOUR PATHWAY.** The athlete's own position and entry
year. Who is at the position now; the arrival window; when a starter last left
the position; what the position has looked like here (intake against minute
reach); the position's first-year history; where the athlete is arriving from.
It opens with `THE PATHWAY THRIV3 SEES` — the one place in the document where
several analyses are read together, capped at six sentences, every number in it
printed on a page of its own.

**ACT II — UNDERSTANDING THE PROGRAMME.** The squad as a whole. First-year
intake and ladder; multi-year development; how the squad's minutes were spread
and which years of study carried them; experienced arrivals; replacement
behaviour; position-by-position behaviour; eligibility outlook; continuity;
observed destinations; and `Where the evidence runs out`.

**ACT III — THE EVIDENCE BEHIND IT.** Named players, actual seasons, actual
minutes, observed openings and observed destinations, then methodology.

A programme report has no pathway to open with and runs Acts II and III behind
a single at-a-glance page.

**The document is dynamic.** `shared/report/sections.js` decides which sections
exist *before anything is drawn*, from the model alone — so a section with
nothing to say is omitted from the document and from the contents rather than
drawn empty. Page numbers are written back onto the plan as the document is
laid out and the contents is filled in at the end (pdfkit `bufferPages`). Real
reports run **9 to 30 pages**.

Three conditional layouts exist, all gated on measured room rather than on a
guess:

- the **origin page** sits in Act I where the programme has its own record by
  origin, and moves to Act III where the page is mostly division context;
- **experienced arrivals** flows beneath the squad page where its whole finding
  is one box (nothing arrived, or no season is comparable);
- a **pathway page whose synthesis is one sentence** sets out what the record
  can and cannot be read for, in titles, pointing at the page that explains
  each refusal in full.

---

## 3. The data window

| Season | Role |
|---|---:|
| 2022 · 2023 · 2024 · 2025 | **completed performance history** — minutes, games, starts |
| 2026 | **current known roster only** — who is on campus, eligibility, projected minutes, named arrivals |

`MEASURED_SEASONS = ['2022','2023','2024','2025']`. 2026 is never averaged into
a historical figure, never contributes to a median, and never appears in a
distribution of minutes. Where it appears on a page it is labelled *"so far"*
and the page says it is a roster published before the season is played.

Recruiting cycles are the one place the two meet, and they are kept apart by a
rule: `HISTORICAL_CYCLES = ['2023','2024','2025']` are completed cycles;
`CURRENT_CYCLE = '2026'` is what is known so far and is drawn as a separate
column.

Row counts by season: 2022 · 50,559 | 2023 · 51,104 | 2024 · 52,539 | 2025 ·
64,736 | 2026 · 57,807.

---

## 4. The modules

### Foundation — is this data readable at all?

| Module | What it decides |
|---|---|
| `shared/classYear.js` | `readClassYear` — the **single** reader for the class-year column. Handles `Fr.` `Fy.` `F.Y.` `RS-Fr.` `Jr./Jr.` `Sr.-TR` and a printed graduation year; a redshirt sits with the class above for eligibility but is still labelled by their own class |
| `shared/lifecycle/lifecycle.js` | `classRank` (delegates to `readClassYear`), `playerKeyOf`, `buildLifecycles` — one record per person per programme, with `firstSeason` and `entryType` |
| `shared/performanceSource.js` | source-level readability: a programme-season with ≥10 players where every stored minute is a zero was **never published**, and every row in it is blanked to null rather than believed |
| `shared/lifecycle/readable.js` | `readableRows` — composes the row-level rule (no published games ⇒ no minute figure) with the source-level rule, in that order |
| `shared/lifecycle/movement.js` | `MATCH_STATUS` — how confidently a departing player was found on another roster the next season. Refuses to merge two players sharing a common name at three or more programmes |
| `shared/lifecycle/hometown.js` | hometown canonicalisation, used to corroborate a movement match |

### Analytics

| Module | Answers |
|---|---|
| `shared/freshmanMinutes.js` | what a first-year has played here — as a **ladder** (best, second-best, …), never a mean, because first-year minutes are bimodal nearly everywhere |
| `shared/lifecycle/development.js` | what a first-year here went on to play, year by year, each year counted only over players who have been here that long |
| `shared/lifecycle/continuity.js` | who could return and did; who left early by their class label |
| `shared/lifecycle/pressure.js` | how often this programme has added a player at one position, by recruiting cycle, split first-time-college against experienced arrival |
| `shared/lifecycle/utilisation.js` | how widely the squad's published minutes were spread — top-11/14/18 minute share, and how many players reached 600 minutes |
| `shared/lifecycle/experience.js` | which years of study made up the roster, and which took the minutes. Composition and load are gated **separately**, each with its own reason |
| `shared/lifecycle/positionUtilisation.js` | how far the minutes at one position reached — players reaching 600 minutes, and players holding three-quarters of the minutes |
| `shared/lifecycle/pool.js` | the benchmark pool: every programme in the sport, keyed `division → …` with an all-divisions fallback |
| `shared/evidenceStrength.js` | how strong the history behind an interpretation is, in seasons and players |

### Report model

`shared/report/summary.js`, `lifecycleSummary.js`, `pressure.js`, `squad.js`,
`positionUtilisation.js` turn analytics into page-facing figures;
`sections.js` decides the document's shape; `narrative.js` writes the sentences.
**The narrative computes nothing** — if a sentence needs a number, that number
is already printed on the page it sits on.

### Renderer

`server/lib/philosophyPdf.js` holds the kit and eleven chart primitives.
`philosophyReport.js` holds the running order and draws nothing itself. One
page module per act: `reportFront`, `reportAthlete`, `reportPosition`,
`reportEvidence`, `reportSquadUsage`, `reportLifecycle`, `reportLimits`,
`reportAppendix`. `reportAudit.js` is the layout guard — it records every
violation, clip, collision and unencodable glyph as the document is written.

---

## 5. The thresholds

Every one of these is a published constant with a comment saying how it was
chosen. None of them is a taste judgement.

**Performance**

| Constant | Value | Meaning |
|---|---:|---|
| `STARTER_MINUTES` | 600 | a starter's season. One consistent measure across every programme — not a claim that a player started every match |
| `MIN_MEASURED_SHARE` | 0.5 | a season is only read where at least half the squad carries a minutes figure |
| `MIN_SQUAD` | 10 | …and the squad has at least ten players |
| `MIN_SOURCE_ROSTER` | 10 | the roster size above which an all-zero season is ruled unpublished rather than believed |
| `MIN_POSITION_MINUTES` | 1,500 | minutes played at a position, on **both** sides of a comparison, before replacement can be read |

**Recruiting intake**

| Constant | Value |
|---|---:|
| `HISTORICAL_CYCLES` | 2023, 2024, 2025 |
| `CURRENT_CYCLE` | 2026 (current-known only) |
| `MIN_ROSTER_FOR_CYCLE` | 10 |
| `MIN_CYCLES_TO_QUOTE` | 2 |

**Squad utilisation**

| Constant | Value |
|---|---:|
| `MEASURED_SEASONS` | 2022–2025 |
| `MIN_SQUAD_FOR_SHARE` | 12 |
| `MIN_SEASONS_TO_QUOTE` | 2 |
| `ROTATION_MINUTES` | 200 (carried, not client-facing) |

**Position utilisation** — six gates, all of which must pass

| Constant | Value |
|---|---:|
| `SUPPORTED_POSITIONS` | DEFENSE, MIDFIELD, FORWARD |
| `MIN_PLAYERS_USED` | 5 at the position in the season |
| `MAX_UNKNOWN_MINUTE_SHARE` | 0.10 of the squad's minutes at an unknown position |
| `CUMULATIVE_TARGET` | 0.75 |
| `MIN_SEASONS_TO_QUOTE` | 2 readable seasons for a programme median |
| squad floor | `MIN_SQUAD_FOR_SHARE` = 12 |

**Movement and destinations**

| Constant | Value | Meaning |
|---|---:|---|
| `MIN_OBSERVED_DESTINATIONS` | 8 | before a destination pattern is described |
| `DIVISION_COVERAGE_FLOOR` | 0.05 | a division whose departures trace below this rate is not reported at all |
| `DESTINATION_SUPPRESSED_DIVISIONS` | D3, USCAA, NJCAA | too few departures trace to describe anything |
| `MIN_POSITION_DESTINATIONS` | 5 | before position movement leads rather than supports |
| `COMMON_NAME_PROGRAMMES` | 3 | a name at three or more programmes is not matched on the name alone |

---

## 6. What this system does not claim

These are enforced by tests and by `npm run verify:baseline`, not by
convention.

- **No forecast.** Not *will*, not *should*, not *likely*. The recruiting
  season has not been played.
- **No probability.** Nothing is expressed as a chance of anything.
- **No fit score, no opportunity score, no pathway score.** Independent
  measures are placed next to each other and never combined arithmetically.
  Position intake and position minute reach are the clearest case: measured at
  r = 0.05 to 0.13, so a single number made of both would say less than the two
  say separately.
- **No causality.** A programme below the pool on a measure is below the pool
  on that measure; why is not in roster data.
- **No verdict on a programme.** Not good, bad, safe, risky, crowded, open.
- **No categorical band where the data refuses one.** Three models refuse
  banding, each for its own measured reason, and each carries that reason on the
  model: recruiting intake (quartiles collapse; 54% of programmes flip on one
  player), squad utilisation (a programme varies more between its own seasons —
  8.8 points — than the pool's middle half is wide — 5.5), position utilisation
  (quartiles 1.5 players apart; 32–48% flip on leave-one-season-out while the
  numbers barely move).
- **No "available minutes".** A current player's projected minutes belong to
  that player for the coming season. They are not an opportunity, and they do
  not pass to anyone when that player leaves.
- **No labelled move.** What the rosters show is a name at another programme
  the following season — not a transfer, not a success, not a failure.
- **No redshirt analysis.** Ruled out of scope in Phase 6 and never built.
- **No goalkeeper minute distribution.** A methodological exclusion, not a
  data gap — see §7.

---

## 7. Known limitations

Every one of these is disclosed on the page where it matters. None of them
blocks merge; each names the phase that would address it.

### 1. Hometown canonicalisation under-matches
`canonicalHometown` fails to match some hometown pairs that are the same place
written differently, across 224 `MATCH_B` movement records. **Impact:** a
movement match that could have been corroborated by hometown is instead carried
at lower confidence. **Client-facing:** no — confidence tiers are internal;
the page states observed-versus-untraceable counts, which are unaffected.
**Mitigation:** a name match at a single programme still resolves; the report
never asserts a move it cannot see. **Future phase:** movement-confidence pass.

### 2. Performance-ratio diagnostic outliers
68 men's and 95 women's *readable* programme-seasons publish team minutes that
do not reconcile with `990 × matches` at the ±15% tolerance — against 97.4% and
97.3% of readable seasons that do. Separately, 165 of 3,085 men's (5.3%) and
179 of 4,166 women's (4.3%) programme-seasons are ruled unpublished at source
and blanked. Verify with `npm run audit:performance`. **Impact:** those 163
seasons' minute totals are internally consistent but disagree with the fixture
count.
**Client-facing:** yes, and deliberately — the squad page names those seasons
and tells the reader to read them with that in mind. **Mitigation:** the
invariant is a **diagnostic, not a gate** — a decision taken in Phase 6A,
because gating on it would delete seasons whose relative distribution is sound.
**Future phase:** source-level minute reconciliation.

### 3. Unresolved destinations
Trace rates differ sharply by division. Akron traces 19 of 60 departures (32%).
**Impact:** the destination pages describe a traced subset, never all
departures. **Client-facing:** yes — every destination figure carries its own
coverage next to it, at full size, and the page says an untraced player is a
limit of the data and not a finding about where they went. **Mitigation:**
`MIN_OBSERVED_DESTINATIONS` and `DIVISION_COVERAGE_FLOOR`. **Future phase:**
movement-confidence pass.

### 4. D3, USCAA and NJCAA destinations withheld
Too few departures in those divisions trace to another roster for a sample to
describe anything, so destination reporting is refused for them outright.
**Impact:** a third of the pool has no destinations page. **Client-facing:**
yes — stated as a refusal with its reason on `Where the evidence runs out`.
**Mitigation:** the refusal is explicit and says what it does not mean.
**Future phase:** roster coverage below D2.

### 5. NAIA historical depth
Acquisition reaches one season for many NAIA programmes. **Impact:** the squad
page and the position page read a single season. **Client-facing:** yes — every
such page says *"One season is one season, and this is not a programme
record."* **Mitigation:** single-season semantics are a distinct code path with
their own wording, not a median of one. **Future phase:** NAIA backfill.

### 6. Goalkeeper position utilisation excluded
The median programme uses two goalkeepers and one of them reaches a starter's
season, so there is no distribution of minutes to describe; **zero of 920
men's programme cells are quotable**. **Impact:** the position page's minute
half is absent for goalkeepers. **Client-facing:** yes, in one quiet line that
explains the method — it must never read as missing data, and a test asserts
the words *insufficient*, *too little data* and *no data* do not appear.
**Mitigation:** the intake half renders in full, and the pages either side read
the goalkeeping position directly. **Future phase:** none. This is correct.

### 7. Forward positions often have two-season histories
30–40% of forward position-groups clear the readability gates in all four
seasons; the rest are read from two or three. **Impact:** a two-season median
sits beside a four-season pool — the weakest comparison in the report.
**Client-facing:** yes — the scope line and a note beside the comparison both
state the basis. **Mitigation:** `MIN_SEASONS_TO_QUOTE` = 2 refuses one season
outright. **Future phase:** source-level minute reconciliation would widen it.

### 8. Coach weighting is not applied across every analysis
Coach tenure is detected and the freshman ladder can be reweighted by it. The
lifecycle analyses — development, continuity, utilisation, position
utilisation — are computed over the whole window regardless of a coaching
change. **Impact:** at a programme that changed coach mid-window, some figures
describe two regimes. **Client-facing:** partly — the coach page states the
change and the methodology says older seasons may describe a different
approach; individual lifecycle figures do not restate it. **Mitigation:** the
change is always disclosed somewhere in the document. **Future phase:** coach
intelligence.

### 9. Upstream roster inflation
Some programmes publish a roster page much larger than their playing squad —
Lake Erie names 62 players and 28 have minutes. **Impact:** any measure with a
roster-size denominator is distorted. **Client-facing:** no — this is precisely
why `rosterAppearanceShare` is carried on the model **flagged unreliable and
never drawn**, and why minute concentration is the primary measure. **Future
phase:** roster-page normalisation.

### 10. Pool build cost
The first request in a process pays for both benchmark pools: 2.1s (men) /
2.3s (women) for the lifecycle pool, plus ~1.3s each for the philosophy
benchmarks. Cached per sport per process thereafter. **Impact:** a cold first
report takes ~3.5s; every later one takes ~50ms. **Client-facing:** no.
**Mitigation:** in-process cache with an explicit invalidation hook.
**Future phase:** persist the pool if concurrency demands it.

---

## 8. The QA baseline

Reproduce all of it from a clean tree.

| Check | Command | Result at freeze |
|---|---|---|
| Unit suite | `npm test` | **1,535 passing, 66 files, 0 failing, 0 skipped**, ~14s |
| Baseline invariants | `npm run verify:baseline` | **57 passed, 0 failed** |
| Analytical snapshot | `npm run snapshot:pi -- --check` | **4 programmes, 4 athlete positions, 0 differences** |
| 20 required reports | `phase6-audit/p9b-required.mjs` | **0 layout defects**, 422 pages, all rasterise, all page numbers present |
| 90-report sweep | `phase6-audit/p9b-broad.mjs` | **0 errors, 0 layout defects**, 13.0s |
| Source-readability audit | `npm run audit:performance` | 165/3,085 men's and 179/4,166 women's programme-seasons unpublished at source; 97.4%/97.3% of readable seasons reconcile |
| Page-count range | | 9–30 pages |

Performance, measured on this machine:

| | |
|---|---:|
| First request in a fresh process (both pools + programme queries) | ~3.4–3.7s |
| Lifecycle pool alone | 2.1s men / 2.3s women |
| Philosophy benchmark pool alone | ~1.3s per sport |
| Warm model build | 7–9 ms |
| PDF render, 20-page programme report | 75–140 ms |
| Warm model + render, athlete report | ~50–100 ms |
| 20 reports end to end | ~14s |
| 90 reports end to end | ~13s |

The layout guard (`reportAudit.js`) is what makes "0 layout defects"
meaningful: it records overflow past the page box, text clipped by
`fitText`, colliding blocks and glyphs outside WinAnsi, as the document is
written. A raster pass on top of it catches what geometry cannot — a chart
subtitle silently truncated to one line, a range printed as "4 to 4", a bar
drawn at zero length for a figure that was never measured. Both are required;
neither is sufficient.

---

## 9. Deliberately deferred

Everything below is **external data or product work** and was ruled out of the
internal-data baseline on purpose. None of it is blocked by this branch.

- **Coach intelligence** — tenure exists as data; a coach-era view across every
  lifecycle analysis does not.
- **Competitive trajectory** — where a programme is heading in its conference
  and division.
- **Academics and financials** — College Scorecard ratings exist as a matching
  input; there is no academic or cost page.
- **Professional pathway** — what happened to players after college.
- **Proprietary scholarship data.**
- **Verified athlete experience data** — anything a roster cannot show:
  coaching style, culture, treatment. The report is deliberately silent on all
  of it rather than inferring it.
- **Redshirt analysis** — out of scope since Phase 6 and not merely unbuilt.

---

## 10. Database safety

Report generation is **read-only**. There is no `INSERT`, `UPDATE`, `DELETE`,
`CREATE` or `ALTER` in any module on the report path — routes, model builders,
analytics, pools or renderers — and no migration is required to merge this
feature (`server/db/schema.sql` and `migrate.js` are untouched).

Tests never touch the working database: `vitest.config.js` sets
`RECRUITMATCH_DB=':memory:'` for every worker, and each test file gets its own.

The QA scripts that need an athlete fixture live **outside the repository**, in
`../phase6-audit/`, and insert and delete their fixtures inside a `try/finally`.
The two tracked scripts added for this baseline —
`snapshotProgrammeIntelligence.js` and `verifyBaselineInvariants.js` — write no
fixture at all: the programme model already carries every position's intake and
utilisation, so they read those instead.

---

## 11. Merge-readiness checklist

There is no GitHub Actions workflow in this repository, so nothing gates `main`
automatically. This is the gate. Run it from a clean working tree, in order;
every line must pass before a Programme Intelligence change is merged.

| # | Gate | Command | Must show |
|---|---|---|---|
| 1 | Working tree clean | `git status --porcelain` | no output |
| 2 | Unit suite | `npm test` | 66 files, 0 failing, 0 skipped |
| 3 | CLI scripts load | (inside `npm test`) | `server/scripts/scripts.test.js` green — catches an import that only Vitest can resolve |
| 4 | Baseline invariants | `npm run verify:baseline` | `0 failed` |
| 5 | Analytical snapshot | `npm run snapshot:pi -- --check` | `0 differences`, or a deliberate re-baseline with the field-by-field diff in the commit message |
| 6 | 20 required reports | `node ../phase6-audit/p9b-required.mjs` | `defects=0` on every row, page counts unchanged |
| 7 | Raster pass | rasterise every page of the 20 | every page renders; no clipping, collision, false zero bar or degenerate range |
| 8 | Broad sweep | `node ../phase6-audit/p9b-broad.mjs` | `errors 0; layout defects 0` |
| 9 | Read-only | grep the report path for `INSERT|UPDATE|DELETE|CREATE|ALTER` | no match |
| 10 | No migration | `git diff main -- server/db/` | no output |
| 11 | Fixtures cleared | `SELECT COUNT(*) FROM players` | the real count, no `t-*` or `s-*` rows |
| 12 | No secrets, no artefacts | `git diff --name-only main...HEAD` | no `.pdf`, `.sqlite`, `.csv`, `.env`; no absolute local paths in production files |

Gates 4 and 5 are the ones that did not exist before this baseline, and they
are the two that catch the failure mode the unit suite cannot: a figure on a
client page quietly changing because a pool percentile moved.

Note the QA scripts in gates 6–8 live **outside** the repository, in
`../phase6-audit/`. That is deliberate — they insert athlete fixtures and are
exploratory tooling, not production code — and it is also why they cannot be a
CI check as things stand. Porting the required-report sweep into the repository
as a tracked integration test is the obvious next step if `main` ever gains CI.

---

## 12. Where to look when something changes

| Symptom | Look at |
|---|---|
| A figure moved and no test failed | `npm run snapshot:pi -- --check` names the field |
| The report makes a claim it should not | `npm run verify:baseline` — 57 assertions on real data and rendered text |
| A page overflows, clips or collides | `reportAudit.js`, then rasterise the page |
| A page is missing | `shared/report/sections.js` — its `applies` predicate |
| A page is in the wrong act | `sections.js` `layerOf`, and the matching branch in `philosophyReport.js` |
| A refusal reads as a zero | the `*_UNREADABLE` tables in `shared/lifecycle/` |
| A number is right but the sentence is wrong | `shared/report/narrative.js`, which may compute nothing |
