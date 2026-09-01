# Competitive History — production contract

**Phase 12B.** The truth layer for what each programme actually recorded, season
by season. Not rendered into any report yet.

Boundary set by [the Phase 12A feasibility audit](competitive-intelligence-feasibility.md).
Everything that audit rejected — fixtures, goals, conference standing,
postseason depth, schedule strength, opponent-level results — is still rejected,
and two firewalls in the test suite keep it that way.

## 1. Source

| | |
|---|---|
| path | `~/Documents/Thriv3/Soccer Records/soccer_records.csv` and `soccer_records_women.csv` |
| columns required | `name`, and `{2022..2025}_{W,L,D}` |
| sport mapping | `soccer_records.csv` → `mens-soccer`; `soccer_records_women.csv` → `womens-soccer` |
| identity | `csv.name` must equal `colleges.name` for that sport, exactly |
| season | the calendar year the autumn season was played in |
| loader | `server/scripts/importProgrammeSeasons.js`, dry run by default |
| never written to | the CSVs are read-only to this repository |

The same file feeds `soccer_score_v6.py` and `loadMatchingInputs.js`. Phase 12A
checked 32 of its programme-seasons against the schools' own published records
and all 32 agreed, which is what makes this a truth layer rather than an
estimate.

**Not loaded, deliberately:** the `{year}_ps` postseason column, the
`conference` column, and `conf_tier`. See §8.

**The loader fails closed.** A missing file, an empty file or a renamed column
throws before a row is read, because a renamed column would otherwise load as a
table of absent seasons and look exactly like a coverage collapse.

**Identity is exact or it is a gap.** `matchSchoolName` exists and is
deliberately not used: it is built for reconciling a source that spells schools
differently, and this source does not. Six source rows do not resolve and are
reported rather than guessed at — five schools absent from `colleges`, and
Penn State Brandywine, which the CSV carries as "Pennsylvania State
University-Penn State Brandywine". Fixing that one belongs in the source file,
not in a matcher.

## 2. The table

`programme_seasons`, keyed on `(college_id, season)`. `colleges.id` already
encodes the sport, so the pair cannot drift; every other table here keys a
programme by name, and that has cost this codebase real coverage before.

Four CHECK constraints carry the invariants the loader would otherwise have to
be trusted for: counts non-negative, `matches_played = wins + draws + losses`,
at least one match, and `confidence` from a closed set.

## 3. W / D / L semantics

A season is loaded only where all three counts are present integers. Two of
three is not two thirds of a season — it is a season whose record we cannot
state — so it is reported as malformed and dropped.

**The record string is W-L-D**, because that is what every source publishes:
Mercyhurst's own header reads 19-1-1 on 19W/1D/1L, Messiah's 20-0-2 on
20W/2D/0L, Grand Valley State's 16-2-5 on 16W/5D/2L. `recordString` is written
once, in `shared/competitiveHistory.js`, after being written twice for about an
hour and getting the second one wrong.

## 4. Confidence, measured rather than asserted

Every season is cross-checked against `roster_players`: no player appears in
more matches than their team played.

| value | meaning | rows |
|---|---|--:|
| `ROSTER_CONSISTENT` | no player on that roster exceeded the match count | 6,628 |
| `UNCHECKED` | no roster appearances on file to check against | 2,028 |
| `ROSTER_CONTRADICTED` | a player logged **more** appearances than the record allows | 29 |

A contradicted row is stored, not deleted — evidence of a disagreement between
two internal sources is worth keeping — and **the model refuses to read it**,
counting it as an unreadable season with the reason attached. Neither source is
assumed right.

## 5. The canonical rate

**NCAA winning percentage, `(W + D/2) / matches`.**

It is the number the schools publish themselves. Phase 12A pulled the official
figure off three schools' own schedule exports and it reproduces exactly —
.929, .955, .804 — so a family checking our number against their programme's
website finds the same number. No other candidate offers that.

The two rejected candidates:

- **Simple win percentage** treats a draw as a loss, and draws are **17.9%** of
  every match in this dataset. It scores Albany men's 5-11-1 in 2023 and 5-6-6
  in 2025 identically at .294, five losses apart.
- **League points per game**, `(3W + D) / 3M` — what `soccer_score` uses
  internally — weights a draw at a third of a win. That is right for a table
  awarding three points and is not what anyone publishes about a college season.

`pointsRate` is carried alongside on every season, because the existing rating
is built on it. **The choice is material, not cosmetic:** the two rates pick a
different highest season at **6.8%** of programmes and order the four seasons
differently at **19.9%**. Akron men's is one — 2023 (9-2-7) is the highest under
winning percentage, 2025 (13-5-3) under points rate.

Neither is a quality score. Neither sees who was played.

## 6. Missing seasons, and the window

| readable seasons | `window` | behaviour |
|--:|---|---|
| 4 | `COMPLETE` | full history |
| 3 or 2 | `PARTIAL` | usable, and every figure states its own denominator |
| 1 | `SINGLE_SEASON` | the season as a fact; no range, no comparison |
| 0 | `UNAVAILABLE` | no summary at all, rather than an empty one |

Never interpolated, never zeroed. A missing season is absent from `seasons` and
listed in `missingSeasons`; a refused one is listed in `unreadableSeasons` with
its reason. The two are kept apart because "we have nothing" and "we have
something we do not believe" are different facts.

`describes` carries the seasons actually read, beside every aggregate, so a
three-season total cannot be read as four.

## 7. Consistency, and the two extremes

Median, lowest, highest and the distance between the outer two. **No variance
and no standard deviation:** over four observations it is a number with two
significant figures of noise whose only real use downstream would be to
threshold it into "consistent" and "volatile", which is the classification this
phase exists to avoid. A test asserts the model publishes no such field.

`highestObservedSeason` and `lowestObservedSeason`, **never "best" or "worst"**.
The wording is load-bearing: a .750 season against a soft schedule and a .750
season in the strongest conference in the division are the same number here, and
nothing in this database can separate them, because no fixture or opponent
exists in it. "Highest observed" is a claim about our measurement; "best" is a
claim about the sport.

## 8. The benchmark

Percentile of a season's rate within **sport × division × season**. Season- and
division-specific, both as refusals: comparing a 2022 rate against a 2025 pool
ranks a programme against a year it did not play, and comparing across divisions
is what the existing rating's editorial band does and this module will not.

Pool sizes run 165–379 for every NCAA and NAIA sport-division-season. **The floor
is 30**, which refuses USCAA — its pools hold 6 to 11 programmes and their middle
half is twice as wide as everyone else's. The floor sits in a genuine gap in the
data: the next pool above 11 holds 104, so any threshold in that range gives the
same answer.

A refused pool returns `available: false` with the count and a reason, never a
midpoint.

**The phrasing is about the rate, never the programme.** "The 2025 results rate
sat in the upper quarter" is a claim about where one number fell in a list of
numbers. "The programme was in the upper quarter" is a claim about standing
among peers, and a season's rate is partly a property of who was scheduled. The
pool is also close to self-referential — every match inside a division has a
winner and a loser, so the median sits at almost exactly .500 in all 40 pools.

## 9. Coach attribution

Consumed exactly as `shared/coachAttribution.js` returns it. Not modified, not
re-derived, and **never a filter**: the history stays the programme's whole
readable record, and the attribution sits beside it as a count.

`currentCoachCompetitiveSeasonCount` of `competitiveSeasonCount`, the seasons
themselves, the record across them, and `unattributedSeasons` for the ones the
attribution could not place. Null where no attribution was handed in, which is
402 programmes — every NAIA and USCAA one has no coach record at all.

Safe: *"3 of the 4 measured competitive seasons were under Lori Walker-Hock;
across those seasons the programme recorded 34-20-8."* Not safe, and not
generated: any sentence in which the coach is the subject of a verb that acts on
the programme.

## 10. Structural change

**No historical conference or division membership exists anywhere**, and this
phase does not invent any. `programme_seasons` stores neither. A programme that
changed division inside the window — Mercyhurst moved D2 to D1 — is benchmarked
in all four seasons against its **current** division, which is a known limitation
and is stated here rather than hidden behind a gate. Raw W-L-D history is not
withheld for it: the record is the record whoever it was played against.

## 11. Non-claims

- results predict future results
- the current coach caused any improvement or decline
- a programme is better because of its W-L-D
- conferences are equal in strength
- divisions are equal in strength
- a season's rate measures the quality of the opposition faced
- a percentile is a ranking of programmes rather than of one season's rate
- postseason absence means anything at all — no postseason data is loaded

No overall competitive score. No GOOD / BAD / ELITE / WEAK. No
IMPROVING / DECLINING / RISING / FALLING: `FORBIDDEN` in
`shared/report/competitiveFacts.js` is a checkable list, swept over every
sentence the module can emit for a rising, falling, flat, three-, two- and
one-season history.

## 12. The two firewalls

Asserted at source level as well as behaviourally, because a behavioural test
only proves the path it exercised.

**Rating firewall.** No module in this layer may name `soccer_score`,
`national_ranking`, `rating`, `recent_win_pct` or `prior_win_pct`. All five are
built from these same four seasons, so consuming them would feed the record back
into itself. `competitiveQueries.js` is asserted to read only
`programme_seasons` and the division on `colleges`.

**Postseason firewall.** No module may name a postseason, champion, tournament
or bracket column, and the table has no column that could carry one — asserted
against `PRAGMA table_info` so a future migration adding one fails the test.
