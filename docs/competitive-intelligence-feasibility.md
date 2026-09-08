# Competitive Programme Intelligence — feasibility audit

**Phase 12A. Research only.** Nothing here is wired to the report, no production
analytics changed, no scores created. Base: `main` @ `2555ff7`.

The question: can Thriv3 describe what competitive environment an athlete is
entering, without turning noisy results into an unsupported good/bad score?

The short answer is that **the boundary runs straight through the middle of the
idea**. Season-level results are already in hand and are accurate. Match-level
results are collectable and reconstruct the official record exactly. Conference
standing is collectable with effort. Opponent strength for a *past* season is
not available and cannot be faked from the rating we hold. Postseason history
is D1-only before 2025 and the field we do hold is wrong more often than it is
right.

---

## 1. What already exists

### There is no fixture data anywhere
No table, column, file or script in this repository holds a match, a fixture, a
schedule or a goal. `colleges` has no opponent concept. The word "opponent"
appears nowhere in the schema. Every match-level ambition in this phase is
external collection from zero.

### The season records file is the real asset
`~/Documents/Thriv3/Soccer Records/soccer_records.csv` (1,160 rows) and
`soccer_records_women.csv` (1,224 rows) hold, per programme:

`school_id, name, division, conference, conf_tier, {2022..2025}_{W,L,D}, {2022..2025}_ps`

It is **outside the database** and reaches it only in collapsed form. Coverage
against the report universe — the 2,122 programme-sports that have roster rows,
which is what the report actually renders for:

| | programmes | joined | 4 seasons | ≥3 seasons |
|---|--:|--:|--:|--:|
| men NCAA D1 | 213 | 100% | 100% | 100% |
| men NCAA D2 | 201 | 100% | 98.0% | 99.0% |
| men NCAA D3 | 311 | 100% | 96.8% | 98.4% |
| men NAIA | 184 | 97.8% | 89.7% | 92.9% |
| women NCAA D1 | 349 | 100% | 94.3% | 99.4% |
| women NCAA D2 | 254 | 100% | 92.1% | 98.0% |
| women NCAA D3 | 392 | 99.7% | 86.7% | 92.6% |
| women NAIA | 197 | 100% | 71.1% | 88.8% |
| **total** | **2,122** | **99.8%** | **91.1%** | **96.2%** |

Five programmes have no record row at all. The join is `colleges.name ==
records.name`, exact — the same spine `loadMatchingInputs.js` already uses.

### What is in the database
| field | populated | what it actually is |
|---|--:|---|
| `soccer_score` | 2,305 / 2,404 | 0–100 rating, **one number per programme**, built from all four seasons at once |
| `national_ranking` | 2,208 | a rank of `soccer_score`, 1–1,220. Not a poll. |
| `recent_win_pct` | 2,234 | league-points rate over **2024+2025 collapsed** |
| `prior_win_pct` | 2,199 | league-points rate over **2022+2023 collapsed** |
| `conference` | 2,376 | current, sport-specific |
| `division` | 2,404 | current |
| `conference_champion_2025` | 195 | 2025 only |
| `postseason_2025_round` | 400 | 2025 only, 7 round values |
| `rating` | **0** | column exists, entirely empty |
| `website_domain` | **0** | column exists, entirely empty |

Three distinct things that must never be mixed: a **current snapshot**
(`soccer_score`, `national_ranking`, conference, division), a **collapsed
two-season half** (`recent_win_pct` / `prior_win_pct`), and **per-season
history** (the CSVs only). Nothing is match-level.

---

## 2. The rating, and why it cannot carry opponent strength

`tools/soccer/soccer_score_v6.py` is the whole methodology and it is honest
about itself. `soccer_score` is:

- league points per game, `(3W + D) / 3G`, over **2022–2025 weighted 40/60/75/100**
- shrunk toward the division mean by 10 pseudo-games
- placed inside a per-division **band that the file itself calls "an EDITORIAL
  judgement, not a fitted quantity"**
- multiplied by a conference-tier dial, also editorial

Three consequences, and the third is fatal for the advanced layer:

1. **It is not seasonal.** One number covering 2022–2025.
2. **Its conference tier is computed from the wrong conference for D1 men.** The
   CSV's `conference` is the school's all-sports conference; 160 programmes
   disagree with the sport-specific value in `colleges` beyond abbreviation, and
   Akron men's is carried as Big East when the soccer programme played the MAC
   in the seasons scored.
3. **Using it as an opponent's 2022 strength leaks 2023–2025 into 2022, and is
   circular.** The opponent's score is built from the opponent's results; a
   programme's record against "strong" opponents would then be a restatement of
   results already counted, weighted by seasons that had not happened.

**Historical reconstruction is partly possible and partly not.** The record
component can be recomputed per season from the CSV. The division band and the
conference tier cannot — both are current-only, and division changes inside the
window (Mercyhurst moved D2→D1) would be applied backwards.

---

## 3. What external collection actually returns

Probed read-only: 13 programmes × 4 seasons across D1/D2/D3/NAIA, men and
women, plus four conference sites. No crawler built.

**Two routes, on the same vendor, with opposite strengths.**

`sidearm-nuxt` (newer Sidearm) — the schedule page embeds a
`<script id="__NUXT_DATA__">` payload with, per fixture: `date`, `opponent`,
`location_indicator` (H/A/N), `neutral_hometeam`, **`conference` boolean**,
`result.status` (W/L/T), `result.team_score`, `result.opponent_score`,
`result.postscore_info` (OT), and **`tournament.title`** — "NCAA Tournament -
Second Round", "Big East Conference Tournament Semifinals". No official-record
header.

`sidearm-txt` (legacy Sidearm) — the SPA shell carries no data, but links
`/services/schedule_txt.ashx?schedule={id}`, a plain-text export whose header is
**the official overall record, the official conference record, and home / away /
neutral splits**, followed by every fixture with score. No per-fixture
conference flag. Line endings are `\n\r`, which will break a naive parser.

`presto` — Albertus Magnus only; scores in HTML, no structured payload, and
three of its four seasons were not reachable at any pattern tried.

Result: **44 of 52 programme-seasons reconstructed.** Failures were pattern
discovery (Ohio State 2023–25, California 2025, Akron women 2024), not blocking.

### Records reconcile exactly
| check | result |
|---|---|
| official record == fixture-derived record | **32 / 32** |
| official record == internal CSV | **32 / 32** |
| fixture-derived == internal CSV | 40 / 43 |

The three exceptions are California 2022–24, and they are the important ones:
Cal's feed carries **preseason exhibitions with no marker at all** (three August
wins before the official opener). Exhibitions appear as `(EXHIBITION)`, `(EX)`,
`(Exh.)`, or **nothing**. A collector that trusts the feed inflates the record.

Goals for and against fall out of the same rows for every fixture. Goal
difference, goals per match and goals conceded per match are all derivable.

### Postseason: the field we hold is wrong
`{year}_ps` covers **D1 only** for 2022–24 (48 men's / 64 women's rows per
season — one bracket). D2, D3 and NAIA have one or two rows per season. 2025 is
empty in the CSV; the database's `postseason_2025_round` covers 2025 broadly
instead.

Checked against the schools' own schedules:

| | internal `_ps` | what the site shows | |
|---|---|---|---|
| Akron m 2022 | `r16` | one NCAA match — **Second Round**, lost | **wrong** |
| Akron m 2023 | *(empty)* | conference quarterfinal only | correct |
| Akron m 2024 | `r32` | First Round W, Second Round L | correct |
| Akron m 2025 | `r16` | Second Round W, Third Round W, **Elite Eight L** | **wrong** |

Two of three non-empty values are wrong. The cause is visible in the round
names: NCAA D1 men use First/Second/Third Round and Elite Eight, not "round of
16", and the taxonomy was mapped by hand.

### Conference standing
Sidearm conference sites serve historical standings at
`standings.aspx?standings={id}`, where the id comes from the current page's
`<option>` list — **`?year=2022` is silently ignored and returns the current
season**, which is exactly the shape of error that would publish this season's
table as 2022's. The correct call returns final conference record, overall
record, points, home/away/neutral, conference size, and finish position encoded
as a `^N` seed suffix. Verified on GLVC men's 2022: 13 teams, 8 seeded.

Four conference sites probed: three Sidearm, one Presto. Coverage across ~253
conferences is unknown.

### Opponent identity
868 opponent strings from the sample, 382 distinct, resolved against `colleges`
with exact matching and two normalisation steps and **no fuzzy matching**:

| | fixtures | |
|---|--:|--:|
| EXACT | 500 | 57.6% |
| NORMALISED (case/accents/`St.`) | 12 | 1.4% |
| STRIPPED (`University`, `College`, `of`, `at`) | 182 | 21.0% |
| **AMBIGUOUS** | **0** | **0%** |
| UNMATCHED | 144 | 16.6% |
| parser noise | 15 | 1.7% |
| exhibition rows | 15 | 1.7% |

**82.8% of real fixtures resolve with zero false positives.**

The remaining 17% must not be closed with similarity matching, and the
experiment shows why. Substring containment produces a *unique* and *confident*
answer that is wrong:

| feed says | containment picks | truth |
|---|---|---|
| Indiana Tech | **Indiana** | NAIA vs D1 — different institutions |
| York College of Pennsylvania | **Penn** | D3 vs D1 |
| University of Pittsburgh at Johnstown | **Pittsburgh** | D2 vs D1 |
| University of Mary Washington | **Washington** | D3 vs D1 |
| California University of Pennsylvania | **California** | D2 vs D1 |
| Florida International | **Iona** | unrelated |

The genuinely ambiguous remainder (Anderson, Bethel, Concordia, Saint Francis,
Miami, Minnesota State) needs the location field both feeds already carry, plus
a curated alias table for ~15 abbreviations (UNOH, FDU, UM-Dearborn, Parkside).
A handful are simply absent from our universe — Limestone discontinued its
programme inside the window.

---

## 4. Coach attribution over a competitive window

Running the existing `coachAttribution` against the CSV's readable seasons,
across the report universe:

| | programmes | current coach known | seasons under current coach | 0 of them | 1 of them | all of them |
|---|--:|--:|--:|--:|--:|--:|
| NCAA D1–D3, both sexes | 1,720 | 86–95% | 58–70% | 211 | 200 | 801 |
| NAIA + USCAA | 402 | **0–1%** | — | — | — | — |
| **total** | **2,122** | **73%** | **52%** | **211** | **200** | **801** |

Only **52% of competitive seasons in the universe are attributable to the coach
on file now**, and 402 programmes have no coach record at all. Any
coach-and-results pairing must state that denominator, not assume it.

---

## 5. Scale

Sampled fixtures per programme-season: mean 20.2, median 21, max 25.

2,122 programmes × 4 seasons × ~19 matches ≈ **161,000 fixture rows** —
25 MB typed, ~46 MB carrying `opponent_raw` and a source URL per row, plus
~19 MB of indexes. The programme-season summary is 8,488 rows, under 3 MB.
Trivial beside `roster_players` at 276,745 rows in a 200 MB database.

---

## 6. What this must never claim

- that results predict future results
- that the current coach caused any improvement or decline
- that a programme is better because of its W-D-L
- that conferences are equal in strength
- that a national ranking is ground truth
- that a current opponent rating represents that opponent's strength in a past season
- that missing a postseason means a weak programme
- that conference finish alone measures programme quality
- that schedule strength alone measures programme quality
- any single overall competitive score, any GOOD/BAD, any RISING/FALLING label
