# Coach Intelligence — feasibility audit

**Phase 11A. Research only.** Branch `research/coach-intelligence`, from
`main @ 3897145`. No production analytics, no report change, no scores.

Scripts: `../phase11-audit/` (outside the repository, read-only, staging
database). Every figure below is reproducible from them.

---

## The one-paragraph answer

Coach data is far better than expected in one direction and far worse in
another. **Coach identity is essentially solved**: 2,286 coaches, one genuine
unresolvable name conflict in the whole table. **Coach attribution is the
product opportunity**: 27% of programmes have zero or one completed season
under their current coach, and the report currently says nothing about it.
**Coach fingerprinting across programmes is dead**: 22 coaches of 2,286 have
enough data, and even for those, behaviour under one coach at two programmes
differs about as much as two unrelated programmes do.

Build the attribution. Reject the fingerprint.

---

## 1. `coach_seasons` — what is actually there

```sql
CREATE TABLE coach_seasons (
  school TEXT NOT NULL, sport TEXT NOT NULL, season INTEGER NOT NULL,
  division TEXT, coach_name TEXT, coach_title TEXT,
  method TEXT, confidence TEXT, source_url TEXT, reason TEXT,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (school, sport, season)
)
```

The primary key answers three audit questions structurally: **one coach row per
programme-season, by construction.** Duplicate programme-season-head-coach rows
are impossible; two coaches in one season cannot be represented; there is no
coach id, so identity is by name alone.

| | |
|---|---:|
| Rows | 8,595 |
| Named | 7,755 (90.2%) |
| Unnamed | 840 (9.8%) |
| Programmes (school + sport) | 1,719 |
| Distinct coach names | 2,292 |
| Seasons | 2022–2026 |

**By sport:** men's 3,625 rows / 3,283 named / 725 programmes / 954 names;
women's 4,970 / 4,472 / 994 / 1,369.

**Named share by season** is flat — 87.8% to 92.0% across all ten
sport-seasons. There is no year that is materially worse than the others.

**By division — and this is the coverage boundary that matters:**

| Division | Men's rows / named | Women's rows / named |
|---|---:|---:|
| NCAA D1 | 1,070 / 1,008 | 1,745 / 1,561 |
| NCAA D2 | 1,005 / 921 | 1,270 / 1,204 |
| NCAA D3 | 1,550 / 1,354 | 1,955 / 1,707 |
| **NAIA** | **0** | **0** |
| **NJCAA** | **0** | **0** |
| **USCAA** | **0** | **0** |

**685 of 2,404 colleges have no coach row at all**: 228 NJCAA men's, 197 NAIA
women's, 194 NAIA men's, 21 USCAA, and 45 NCAA stragglers. Within the report
universe — programmes with 2022–25 roster history — **403 of 2,122 have no coach
row**, and 401 of those are NAIA or USCAA.

**Why a name is missing** (840 rows): no head coach found 509, vacant-or-TBA
130, no usable page 128, sport not on page 44, fetch 404 17, URL not
season-addressed 7, other 5. Every gap carries its reason, which is what makes
the gaps usable rather than invisible.

**Method and confidence:** 8,325 roster-live, 128 none, 142 Wayback. 7,639
High, 116 Medium, 840 null (the unnamed rows).

### Current coach, 2026

| Division | Sport | Programmes | Named 2026 coach |
|---|---|---:|---:|
| NCAA D1 | men's / women's | 213 / 349 | 204 / 327 |
| NCAA D2 | men's / women's | 205 / 260 | 184 / 238 |
| NCAA D3 | men's / women's | 318 / 418 | 269 / 347 |
| NAIA | men's / women's | 194 / 198 | 0 / 1 |
| NJCAA / USCAA | | 228 / 21 | 0 / 0 |

**1,570 of 2,404 programmes (65.3%)** have a named 2026 coach. Restricted to
programmes with measurable roster history: **1,570 of 2,122 (74.0%)**.
Restricted to NCAA D1–D3, where the data exists at all: **1,569 of 1,720
(91.2%)**.

### Titles

97.2% of named rows carry a head-coaching title. 89 rows across 79 programmes
say *interim*; 13 rows across 4 programmes say *co-head*; 25 say *associate
head*. **47 rows (0.61%) across 22 programmes name no head-coaching role at
all** — "Head Strength and Conditioning Coach", "Director of Soccer
Operations", "Head Coaching History" (a page label, not a person). A dual title
like "Head Coach/Assistant Athletic Director" is a head coach and is not
counted here.

---

## 2. Coach identity — solved, with four named exceptions

Name normalisation barely does anything, which is the finding: **2,292 exact
spellings collapse to 2,289 normalised names.** Three collisions in the entire
table (`Juan Mascaro` / `Juan Mascaro Jr.`, `CONNOR KEENAN`, `T.J. Perez`).
There is no punctuation problem, no initials problem, no suffix problem, and one
name that is not two words (`JR DeRose`).

**Institution identity has to be resolved before coach identity can be.** The
first pass found 26 "impossible" names — one person at two schools in one
season. Most were not people at all: the same institution is spelled **short in
the men's file and long in the women's** (`Albright` men's D3 / `Albright
College` women's D3; `Hendrix` / `Hendrix College`; `Anderson (IN)` /
`Anderson University (IN)`). One coach holding both posts looked like two
people at two schools.

With institutions resolved:

| Tier | Names | Share |
|---|---:|---:|
| `EXACT_ONE_INSTITUTION` | 2,113 | 92.4% |
| `LIKELY_SAME_CONTIGUOUS` — a move, seasons abut | 104 | 4.5% |
| `LIKELY_SAME_WITH_GAP` | 34 | 1.5% |
| `EXACT_ONE_INSTITUTION_BOTH_SPORTS` | 16 | 0.7% |
| `LIKELY_SAME_BOUNDARY_OVERLAP` | 14 | 0.6% |
| `UNRESOLVED_TRUE_CONFLICT` | 5 | 0.2% |

**157 names appear at more than one institution; 152 of them resolve.**

`LIKELY_SAME_BOUNDARY_OVERLAP` is a source artefact, not a person: one shared
season at the join, because the old programme's roster page still listed the
coach in the season they left. `Ruben Resendes: Franklin Pierce 2022 | Bryant
2022–2026`. Fourteen cases, all the same shape.

The five true conflicts, inspected individually:

| Name | What it actually is |
|---|---|
| David Nolan — Claremont McKenna / Harvey Mudd / Scripps | **one team.** The CMS consortium fields a joint side |
| Miranda Armstrong — Pitzer / Pomona | **one team.** Same consortium arrangement |
| Pepe Fernandez — Maryville College / Maryville (TN) | **one institution**, two spellings the key missed |
| Girish Thakar — Westminster (PA) / Westminster College (PA) | **one institution**, same miss |
| Chris Brown — San Francisco men's 2022–26 **and** South Florida women's 2024–26 | **two different people** |

So the honest count is **one genuine unresolvable identity conflict in 2,286
coaches.** Proposed tiers are supported by evidence, and the two remaining
weaknesses are both institution-side, not coach-side: parenthetical qualifiers
and consortium teams.

**Garbage values:** 7 rows carry a page label instead of a name — "Phone
Number" ×4, "Business Management" ×3, "Emergency Management". Plus 5 all-caps
spellings that are real names. 17 rows total flagged by any heuristic (0.22%).

---

## 3. Observed career histories

Reconstructable directly: coach → programme → title → first observed season →
last observed season. **Never** "hired" or "left".

**2,286 coaches.** Programmes per coach: 2,113 at one, 164 at two, 9 at three
or more. Institutions per coach: 2,130 at one, 148 at two, 8 at three or more.

Coach-seasons on file (including 2026): 447 with one, 340 with two, 307 with
three, 307 with four, 864 with five, 21 with six or more.

**86 coaches have a gap inside a single stint — and every gap examined is an
unresolved season, not an absence.** Appalachian State women's: Aimee Haywood
2022, 2023, 2024, *(no usable page)* 2025, 2026. Canisius women's: Ryan Louis
2022–24, *(no head coach found)* 2025, 2026. This is decisive for wording: a
gap means *not observed*, never *left and returned*.

The observation window is five seasons. Nothing before 2022 or after 2026 is
knowable from this table, so no tenure length can be stated — only "observed at
this programme from 2024", and "4+ seasons" where a coach is present in every
season on file.

---

## 4. Current-coach representativeness — the product finding

Base: **1,449 programmes** with a named 2026 coach and at least one readable
measured season. (Excluded: 552 with no 2026 coach — 401 of them NAIA/USCAA;
121 with a 2026 coach and no readable season.)

| Seasons under the current coach | Programmes | Share |
|---|---:|---:|
| 4 (all measured seasons) | 708 | 48.9% |
| 3 | 181 | 12.5% |
| 2 | 169 | 11.7% |
| 1 | 202 | 13.9% |
| 0 | 189 | 13.0% |

Expressed as a proportion of each programme's own measured history: **all
measured seasons 765 (52.8%)**, 3 of 4 167, 2 of 4 148, 1 of 4 163, 0 of
measured 189, and 17 programmes on shorter windows.

By division and sport, seasons under the current coach (0 / 1 / 2 / 3 / 4):

| | n | 0 | 1 | 2 | 3 | 4 |
|---|---:|---:|---:|---:|---:|---:|
| D1 men's | 203 | 27 | 23 | 21 | 22 | 110 |
| D1 women's | 327 | 49 | 55 | 41 | 41 | 141 |
| D2 men's | 178 | 23 | 22 | 18 | 19 | 96 |
| D2 women's | 218 | 39 | 32 | 25 | 27 | 95 |
| D3 men's | 227 | 15 | 28 | 30 | 37 | 117 |
| D3 women's | 295 | 36 | 41 | 34 | 35 | 149 |

Women's programmes turn over more: 31.8% (D1) and 32.6% (D2) have zero or one
season under the current coach, against 24.6% and 25.3% on the men's side. D3
men's is the most stable at 18.9%.

Statements this supports today, verbatim and factual:

- *"All four seasons in this report are under the current coach."* — 708 programmes
- *"Only one of the four measured seasons is under the current coach."* — 202
- *"The current coach has no completed season in the historical window."* — 189

---

## 5. Coach-change timelines

Structural states over the 1,720 NCAA D1–D3 programmes with roster history:

| State | Programmes | Share |
|---|---:|---:|
| `SAME_COACH_ALL_HISTORY` | 804 | 46.7% |
| `COACH_CHANGE_WITHIN_WINDOW` | 306 | 17.8% |
| `COACH_RECORD_INCOMPLETE` | 300 | 17.4% |
| `CURRENT_COACH_ONE_SEASON` | 131 | 7.6% |
| `CURRENT_COACH_NO_MEASURED_SEASON` | 115 | 6.7% |
| `MULTIPLE_CHANGES` | 64 | 3.7% |

Across the full 2,122-programme universe the incomplete bucket rises to 33.1%,
because NAIA and USCAA have no coach data at all.

### Against the existing coach verdict

The existing `classifyProgramme` verdict and the observed timeline agree on
every large cell:

| Existing verdict | Observed state | n |
|---|---|---:|
| steady | SAME_COACH_ALL_HISTORY | 384 |
| policy-shift-same-coach | SAME_COACH_ALL_HISTORY | 218 |
| erratic-same-coach | SAME_COACH_ALL_HISTORY | 122 |
| change-too-recent | CURRENT_COACH_ONE_SEASON | 97 |
| regime-change | COACH_CHANGE_WITHIN_WINDOW | 96 |
| continuity-through-change | COACH_CHANGE_WITHIN_WINDOW | 95 |
| new-coach-no-record | COACH_CHANGE_WITHIN_WINDOW | 88 |
| new-coach-no-record | CURRENT_COACH_NO_MEASURED_SEASON | 70 |

**Where the existing verdict is already enough:** the 804 same-coach programmes
(a verdict of steady / policy-shift / erratic says everything an era view would),
and the 236 `new-coach-no-record` programmes, where the verdict already tells
the reader the current coach has no measured record.

**Where richer coach history adds new information:** the *count*. The verdict
says whether the window is coherent; it never says how much of it is the
current coach's. 741 of 1,449 programmes (51.1%) have a current coach who does
not cover the whole window, and the report currently states that nowhere.

**Where the existing verdict may weight old regimes too heavily:** **78
programmes (5.1%)** carry a full-window verdict (steady / policy-shift /
erratic / structural-through-changes) while the current coach covers fewer than
all measured seasons — 32 of them just one season. California Baptist reads
*steady* on four seasons of which one is the current coach's; Mercyhurst, Saint
Joseph's and Chowan are the same shape. These are not wrong — the programme was
steady — but a family reads the verdict as a description of what they are
joining.

---

## 6. Coach fingerprint — reject

The question: when the same coach appears at two programmes, is there enough
data to compare the behaviour observed under them?

**156 coaches are observed at two or more institutions.** Filtering to what the
report can actually read:

| Requirement | Coaches |
|---|---:|
| ≥2 institutions | 156 |
| ≥2 programmes with ≥1 readable season each | 94 |
| **≥2 programmes with ≥2 readable seasons each** | **25** |
| ≥4 readable seasons in total | 79 |
| ≥6 readable seasons in total | 3 |
| ≥8 readable seasons in total | 1 |

Of those 25, three are the artefacts named in §2 (one consortium team, one
institution twice, two different people). **22 usable coaches of 2,286 —
0.96%** — and nearly every one is a 2-seasons-against-2-seasons split, the
minimum the gates permit.

The structural reason is the window, not the data quality: five seasons, of
which 2026 carries no minutes. A coach who moves mid-window can split four
readable seasons 2+2 at best. **62 cross-programme coaches fail outright, and
49 of those are observed at the new programme only on the 2026 roster** — Alex
Greco (Adams State 2022–25, Saint Leo 2026), Tim Mason (Babson 2022–25, Bentley
2026). There is nothing yet to compare.

### Does behaviour travel with the coach?

22 same-coach programme pairs, against 182 pairs of unrelated programmes in the
same division and sport. Median absolute gap:

| Metric | Same coach | Random pair | Ratio |
|---|---:|---:|---:|
| Top-11 minute share | 2.3 pp | 4.0 pp | **0.58** |
| Players over 600 minutes | 1.0 | 1.0 | 1.00 |
| First-year minute share | 6.7 pp | 6.4 pp | 1.04 |
| First-year roster share | 4.3 pp | 5.0 pp | 0.86 |
| Roster size | 3.0 | 3.5 | 0.86 |

A ratio near 1.00 means the same coach at two programmes differs about as much
as two unrelated programmes do. **Four of five metrics show nothing.** Minute
concentration is the single dimension with a hint of signal — and it is a hint,
over 22 pairs of 2-season medians spanning divisions and pools.

Sarah McClellan is the case that looks like a fingerprint (Roberts Wesleyan
77.8% / 30.8% first-year minutes, Kenyon 77.7% / 30.9% — almost identical) and
TJ Perez is the case that refutes it (Minot State 84.0%, Chapman 69.0%). With
22 pairs both are anecdotes.

**Verdict: reject.** Revisit only when the observation window reaches seven or
eight seasons, and then re-run this exact comparison before building anything.

---

## 7. Coach-scoped analytics — what would survive

If each analytic were recomputed over the current coach's seasons only, over
the 1,449 in-scope programmes:

| Analytic | Min seasons | Would answer | Share |
|---|---:|---:|---:|
| First-year ladder | 1 | 1,260 | 87.0% |
| First-year intake | 1 | 1,260 | 87.0% |
| Experienced arrivals | 2 | 1,058 | 73.0% |
| Replacement behaviour | 2 | 1,058 | 73.0% |
| Squad utilisation | 2 | 1,058 | 73.0% |
| Roster experience profile | 2 | 1,058 | 73.0% |
| Roster continuity | 2 | 1,058 | 73.0% |
| Position intake | 2 | 1,058 | 73.0% |
| Position utilisation | 2 | 1,058 | 73.0% |
| Observed destinations | 2 | 1,058 | 73.0% |
| Multi-year development | 3 | 889 | 61.4% |

**The denominator problem is the whole story.** A coach-scoped view is a
**no-op for 765 programmes (52.8%)** — the current coach already covers every
measured season, so the figure is identical to the one already printed. It adds
information for the **495 split programmes (34.2%)**, and that is exactly where
it has fewest seasons: 36.0% of them have one season, 30.3% two, 33.7% three.

So the analytic that would most often *change* is the one that would most often
be a single season — which the baseline already refuses to quote as a
programme median (`MIN_SEASONS_TO_QUOTE = 2`, and every model refuses banding
on a single season).

**One-season output is not useful as a median.** It is useful as a *named
season*: "in 2025, the one completed season under this coach, 14 players
reached 600 minutes" is a fact with its denominator attached. That is the only
defensible one-season form.

**The full-history value must stay alongside.** Removing it would delete valid
evidence about the programme a family is joining, and the baseline's own rule —
never solve complexity by deleting valid evidence — applies directly.

### Before / after a coach change

**148 of 1,449 programmes (10.2%)** have at least two readable seasons on both
sides of a change: D1 men's 15, D1 women's 32, D2 men's 17, D2 women's 24, D3
men's 26, D3 women's 34. Oregon State, NC State, New Hampshire, Green Bay,
Marquette, Fairleigh Dickinson, Drexel and Fairfield are all clean 2-and-2
splits.

Describable. **Not attributable** — a 2-against-2 comparison cannot separate a
coaching change from a graduating class, and saying otherwise is the causal
claim this product does not make.

---

## 8. The weighted ladder — replace the concept

`weightsFromVerdict` builds recency weights when the verdict is
`vacancy-in-window`, `change-too-recent` or `regime-change`, and
`ladderByRank` recomputes the ladder with them. Both `reportEvidence.js:193`
and `reportFront.js:514` then gate on `weightingApplied && weightedAgrees ===
false`.

Measured across 1,720 NCAA programmes:

- a weighted ladder is **computed for 517 (30.1%)**
- the weighted top rung lands in a **different band for 19 (1.1%)**
- so **only 19 programmes ever see it** — Syracuse (full 384 *rotation* vs
  weighted-from-2024 689 *impact*), San Jose State, Lindenwood, Old Dominion,
  UC San Diego and fourteen others

Meanwhile **236 programmes (13.7%) carry `new-coach-no-record`**, where no
weighting can help because the current coach has no measured season to weight
towards.

**Recommendation: keep the weighted ladder untouched for now, and plan to
replace the concept rather than tune it.** A reader is better served by two
labelled facts — *full programme history* and *seasons under the current
coach*, each with its own denominator — than by a single ladder recomputed with
weights the page then has to explain. Recency weighting answers "how much
should I discount 2022?" with an arbitrary curve. Coach scoping answers it with
a date. The 19 programmes it currently reaches are not the argument for keeping
it.

---

## 9. The recent-coach cases

**391 of 1,449 programmes (27.0%)** have zero or one completed measured season
under their current coach. Of the 189 zero-season cases:

- **144 (76.2%)** have a named predecessor for every measured season
- **87** have a *single* named predecessor across them — the cleanest statable
  case: Hofstra (4 seasons under Richard Nuttall, now Stephen Roche), Furman,
  South Florida, Penn State, Campbell, Boston College
- 38 are partly named, partly unresolved
- **7 have no named coach for any measured season** — Michigan men's, Saint
  Michael's, Eckerd, McMurry, Stanford women's, Youngstown State women's. Here
  only a caution is available, not a statement

**18 programmes list an *interim* head coach for 2026** — Boston College,
Binghamton, Colorado School of Mines, Macalester and fourteen others. An interim
is not a regime, and calling one "the current coach" without saying so would
mislead.

What the report can defensibly say today, in all of these cases: the programme
record stands unchanged and every figure remains a fact about the programme.
**Only the attribution changes.** The addition is one line of context, not a
recomputation — which is also why it is cheap and safe.

---

## 10. External coach data

Ranked by what would materially improve the product, factual history first.
Marketing biography is deliberately last.

**HIGH VALUE / HIGH RELIABILITY**

| Field | Why it matters |
|---|---|
| **Appointment date** | Turns "observed from 2024" into "appointed in December 2023". Fixes the single biggest limitation of the current data — a five-season window that cannot see a tenure's start |
| **Previous programmes and dates** | Extends career history beyond 2022 and would move Coach Fingerprint from 22 usable coaches towards a viable sample. The highest-leverage field by a distance |
| **Previous roles (head vs assistant)** | An assistant's seasons are not a head coach's record, and the current table cannot tell them apart before 2022 |
| **Current role confirmation** | Resolves the 18 interim cases and the 47 wrong-person rows |

**MEDIUM VALUE**

| Field | Why |
|---|---|
| Career record (W-L-D) | Factual and checkable, but a result, not roster behaviour — it answers a different question than this product asks |
| Conference championships, NCAA tournament appearances | Same: verifiable, and about outcomes rather than pathways |
| College playing background | Occasionally relevant to a family; rarely decision-relevant |

**LOW VALUE / SUBJECTIVE**

Professional playing background, coaching philosophy quotes, staff-page
biography prose, anything describing style or culture. **Explicitly excluded:
Reddit, social media and forum sentiment** — not a source of coach
intelligence at any point.

Sources to investigate later, in order of expected reliability: official
university athletics staff pages (already the source of `coach_seasons`, so the
crawler exists), archived athletics releases via Wayback (already used for 142
rows), conference websites, NCAA records. The appointment-date field is most
often in a hiring release, not on a staff page.

---

## 11. The six family questions

| # | Question | Verdict |
|---|---|---|
| 1 | Is the historical report representative of the current coach? | **Feasible now.** 1,449 programmes can state a count; 91.2% of NCAA programmes have a named 2026 coach |
| 2 | How long has this coach been observable at this programme? | **Feasible now**, in observation language only. "Observed here since 2024", "in every season on file". Never a tenure length |
| 3 | What roster behaviour has been observed under this coach? | **Feasible now, with disclosure.** 73.0% of programmes reach two seasons; a no-op for 52.8%; single-season cases must be stated as a named season, never a median |
| 4 | Has the same coach shown similar behaviour at previous programmes? | **Not defensible.** 22 coaches of 2,286, and no measurable repeated structure on four of five metrics |
| 5 | Did roster behaviour materially change after the coach changed? | **Feasible but narrow, and describable only.** 148 programmes (10.2%). "Materially" and "after" both invite causation the data cannot support |
| 6 | Is this a new coach where historical data should be read cautiously? | **Feasible now.** 391 programmes (27.0%), of which 144 can name the predecessor |

---

## 12. Future modules

| Module | Verdict | Basis |
|---|---|---|
| **CURRENT COACH CONTEXT** — "3 of the 4 seasons in this report were under Coach X" | **BUILD** | Every one of the 1,449 in-scope programmes can state this, including the 189 zeroes. No new analytics, no new gate, one line of context. The highest-value, lowest-risk item in this audit |
| **COACH ERA** — a season-by-season timeline | **BUILD** | A direct table read. 91.2% of NCAA programmes with roster history have a named 2026 coach and 95.4% have at least one named measured season. Unresolved seasons must print as unresolved, never inferred from the seasons either side |
| **UNDER THE CURRENT COACH** — selected metrics recomputed | **RESEARCH** | Technically sound and computationally cheap, but a no-op for 52.8% and thinnest exactly where it matters. Needs a coach-era benchmark to be comparable at all. Open question for 11B: is a 2-season coach-scoped figure beside a 4-season pool defensible? |
| **COACH ACROSS PROGRAMMES** | **REJECT** | 0.96% coverage; within-coach variation indistinguishable from between-programme variation. Revisit at 7–8 seasons of history |
| **BEFORE / AFTER COACH CHANGE** | **RESEARCH** | 10.2% coverage with both sides readable. The description is available; the attribution is not, and the module's name implies the attribution |

---

## 13. Performance and architecture

Measured on 1,763 NCAA programmes:

| Operation | Cost |
|---|---:|
| Load every NCAA programme's rows | 3,107 ms |
| Apply the readability rules to all of them | 525 ms |
| Two coach-era seasons of one programme, utilisation | **0.06 ms per report** |
| Every NCAA programme-season, utilisation (7,052) | **106 ms** |

**A coach-scoped figure for one programme is free at request time.** The rows
are already loaded by the existing model build and the era is a filter over
them; no new query, no new pool.

**A coach-scoped benchmark is also cheap — and this was the surprise.** A
coach-era pool is one extra pass over rows the pool build already holds in
memory: on the order of 100–300 ms added to a pool build that costs 2.1 s
today. It does not need precomputing or caching beyond the per-sport cache that
already exists.

The expensive thing would be a per-coach pool across programmes — which §6
rejects on sample grounds anyway.

---

## 14. Data-quality limitations

| # | Issue | Quantified | Blocks what |
|---|---|---|---|
| 1 | No coach data below NCAA D3 | 685 of 2,404 colleges; 403 of 2,122 in the report universe (380 NAIA, 21 USCAA) | Any coach module for NAIA/NJCAA/USCAA. Must degrade silently, as the sparse-report paths already do |
| 2 | Missing current coach | 151 of 1,720 NCAA programmes (8.8%) have no named 2026 coach | Current-coach context for those programmes |
| 3 | Unnamed measured seasons | 840 rows (9.8%); 300 NCAA programmes are `COACH_RECORD_INCOMPLETE` | An era timeline must print "not resolved", never interpolate |
| 4 | Gaps inside a stint | 86 coaches; every one examined is an unresolved season | Wording. A gap is *not observed*, never *left and returned* |
| 5 | Ambiguous identity | 1 genuine conflict in 2,286 names; 4 further cases are institution or consortium artefacts | Nothing, at this rate — but cross-programme work must carry the tier |
| 6 | Institution spelled two ways | Same school short in the men's file, long in the women's; 2 of the 5 "conflicts" | An institution key is a prerequisite for any cross-programme coach work |
| 7 | Consortium teams | 2 cases (CMS, Pitzer-Pomona) where several colleges field one side | Would double-count a coach's programmes |
| 8 | Wrong person captured | 47 rows (0.61%) across 22 programmes name no head-coaching role | Small, but a named wrong coach is worse than an unnamed season. Filter on title before use |
| 9 | Interim coaches | 89 rows / 79 programmes; **18 are the 2026 coach** | Calling an interim "the current coach" without saying so |
| 10 | Co-head coaches | 13 rows / 4 programmes | The schema cannot represent two coaches in a season (primary key) |
| 11 | Coach-season without a roster season | 39 programme-seasons 2022–25 | A minor join gap; the era timeline should read from coach rows, not roster rows |
| 12 | Five-season window | Structural | No tenure length, no pre-2022 career, and the binding constraint on Coach Fingerprint |

Two things that are **not** problems, contrary to expectation: programme-name
joins (0 of 1,719 coach_seasons programmes fail to join to `colleges` or to
2022–25 roster rows) and name normalisation (3 collisions in 2,292 spellings).

---

## 15. Non-claims

Coach Intelligence must never imply that the coach caused a player's
development, forced a transfer, prefers a nationality, will recruit over the
athlete; nor state future playing time, coach quality, coach honesty, or
personality and culture read from roster data.

The vocabulary is the guard, and it is narrower than the Programme Intelligence
vocabulary because attribution is easier to imply than measurement:

| Say | Never |
|---|---|
| observed at · on file from · first season in this dataset | hired in · left in · joined · departed |
| behaviour observed under this coach | coaching style · the coach prefers · the coach develops |
| the seasons under this coach · 3 of 4 measured seasons | this coach's record · under this regime |
| not resolved for 2025 | no coach in 2025 · vacant in 2025 |
| the roster changed after the change of coach | the coach changed the roster |

---

> **Phase 11B is built.** The attribution model recommended below now exists as
> `shared/coachAttribution.js`, with its production contract in
> [`coach-attribution.md`](coach-attribution.md). The distributions in §4 and §5
> of this document are reproduced there from the production model, with every
> difference accounted for by role and name filtering this research pass did not
> apply. Nothing in the report reads it yet.

## 16. Recommendation for Phase 11B

**Build the two attribution modules and nothing else.**

1. **Coach attribution in the model** — for every programme, the seasons the
   report measures, the current coach, how many of those seasons are theirs,
   the season-by-season coach with unresolved seasons marked, and the
   predecessor where a single one can be named. Read-only over
   `coach_seasons`; no analytic recomputed; no report change yet.
2. **Validate it the way the baseline validates everything else** — the
   distributions in §4 and §5 as assertions, the identity tiers as assertions,
   and the wording rules in §15 as forbidden-phrase tests.
3. **Then, and separately, decide the report treatment** for the 27% of
   programmes whose current coach has zero or one measured season. That is a
   product-design phase, not an analytics phase, and it should not begin until
   the attribution model is frozen.

Explicitly **not** in 11B: coach-scoped recomputation of any analytic, any
cross-programme coach comparison, any external data collection, and any change
to the weighted ladder or the existing coach verdict.
