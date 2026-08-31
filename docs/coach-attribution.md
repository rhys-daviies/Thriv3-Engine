# Coach attribution — the production contract

**Phase 11B.** `shared/coachAttribution.js`, frozen.
Research findings behind it: [`coach-intelligence-feasibility.md`](coach-intelligence-feasibility.md).
Nothing in the report reads this module yet.

---

## 1. What attribution means

The report describes four seasons of a programme's record. It has never said
whose record they are. This module answers exactly one question:

> Which observable coaching context does each measured season belong to, and
> how much of the measured window belongs to the coach a recruit would join?

Nothing more. It is a **pure function of two inputs** — the programme's
`coach_seasons` rows, and the list of seasons the report actually measured:

```js
import { coachAttribution } from '../shared/coachAttribution.js';

const model = coachAttribution({
  coachRows,                                   // this programme's coach_seasons rows
  measuredSeasons: ['2022', '2024', '2025'],   // what the REPORT measured
});
```

It never reads `roster_players`. **The denominator is handed in**, which is the
whole design decision: the attribution and the report cannot disagree about
which seasons are being described, and a second definition of "readable" cannot
come into existence here.

## 2. What attribution does not mean

It does not say the coach **caused** any of the behaviour the report measures.
It does not say one coach is better than another. It does not say anything
observed will continue. It does not say what any analytic becomes when
restricted to one coach's seasons — that is a different question and this
module deliberately cannot answer it, because it never touches a roster row.

It also says nothing about **employment order**. `predecessor.name` is the coach
named on file for the earlier measured seasons. It is not a claim that they held
the post before the current coach, that one followed the other, or that anybody
was appointed or departed on any date. The five-season window cannot see a
tenure's start or end.

## 3. Vocabulary

| Say | Never |
|---|---|
| current coach · coach on file | hired · appointed · left · departed |
| observed under · season attributed to | replaced · succeeded · took over · stepped down |
| measured season · earlier named coach | the coach prefers · develops · caused |
| unresolved coach record | no coach that season · vacant that season |

Two tests hold this: one over every string the module can emit, one over the
module's own source. The forbidden words appear in this repository only inside
the test that rejects them.

## 4. The current coach

The **usable head coach attached to season 2026** — never a measured season.
`currentCoach` is null with an explicit `currentCoachReason` where it cannot be
resolved. Six reasons, in the order they are tested:

| Reason | Meaning |
|---|---|
| `NO_ROW` | no coach row on file for 2026 |
| `NO_NAME` | a row exists, no name could be read |
| `VACANT` | the post was recorded as vacant or to be announced |
| `NOT_A_NAME` | the value in the coach column is not a person's name |
| `ASSOCIATE_HEAD` | the title names an associate head coach |
| `NOT_A_HEAD_COACH` | the title names a role other than head coach of this team |

`VACANT` and `NO_NAME` are kept apart on purpose, using the `reason` column the
scraper already writes: *the page said there is nobody* and *we could not read
the page* are opposite claims, and reporting the second as the first invents a
vacancy.

## 5. Role filtering

A row is usable only where the name can be a person's name and the title names
a head coach **of this team**.

**Names.** Six label families found by enumerating every named row: `Phone
Number`, `Business Management`, `Emergency Management`, `National
Championships`, `Prospective Athletes`, `All News`, `Head Coaches`. Plus
structural insurance that currently fires on nothing — a name must have at
least two tokens and no digit, `@` or URL — so a future import cannot quietly
attribute four seasons to "2024 Roster".

**Titles.** Phrase by phrase, not one pattern over the whole string, because a
staff title is usually several jobs. `namesTeamHeadCoach` finds every
head-coaching phrase and accepts the title if any one of them is this team's:
not preceded by a junior rank, and not naming another function or another team.

Validated by enumerating **all 221 distinct titles** in the table and reading
every rejection. That pass is what found the endowed chairs at Brown ("Friends
of Brown Men's Soccer Head Coaching Chair" is the head coach), the interim
written in the middle ("Head Interim Women's Soccer Coach"), the coach of two
sports ("Head Women's Lacrosse/Soccer Coach"), and three rows whose title is a
news headline and whose name is "All News".

Result: **201 titles accepted (7,679 rows), 20 rejected (76 rows)**, plus 27
rows rejected on the name. **7,665 of 7,755 named rows are usable.**

The 20 rejected titles are: associate head coach (5 variants, 26 rows),
strength and conditioning (6 variants, 17 rows), Director of Soccer and
Director of Soccer Operations (14 rows), assistant coach with a second head
role (5 rows), page labels (13 rows), Head Peak Performance Coach (1).

**Why this does not delegate to `classifyRole` in `coachRoles.js`.** That
function answers "who should receive recruiting mail", and for that purpose a
Director of Soccer is a fine recipient and reading "Head Strength and
Conditioning Coach" as a head coach costs nothing. Here both are wrong:
attributing a programme's four seasons to its strength coach would be a false
statement about a named person. Marist men's is the case — the strength coach
was captured for all five seasons, so an unfiltered model said "4 of 4 seasons
under the current coach" about someone who never coached the team.

## 6. Identity

Uses `sameCoach` from `coachTenure.js`, unchanged: surname plus first initial,
after normalising accents, punctuation, case and a surname-first spelling.
Deliberately no fuzzier — merging two different coaches would erase the change
this module exists to find.

**No cross-programme identity work, and none is needed.** The model is handed
one programme's rows and only ever asks *does the named coach in measured
season S match the usable current coach at this programme?* It has no
cross-programme surface at all, which is what protects the one genuine identity
conflict in the table: `sameCoach` would say the San Francisco men's Chris Brown
and the South Florida women's Chris Brown are one person, and the model cannot
make that mistake because it never compares two programmes.

The same architecture makes institution canonicalisation unnecessary here.
"Albright" men's and "Albright College" women's are one college; they are two
independent models, and both are correct.

## 7. Season attribution

For each measured season, one of three values, and **never interpolated**:

| Value | When |
|---|---|
| `CURRENT_COACH` | the season's usable coach matches the usable current coach |
| `PREVIOUS_COACH` | a different usable head coach is on file |
| `UNRESOLVED` | no usable coach can be determined for that season |

```
2022 Coach A        -> PREVIOUS_COACH
2023 Coach A        -> PREVIOUS_COACH
2024 (unresolved)   -> UNRESOLVED        <- never filled in from either side
2025 Coach B        -> CURRENT_COACH
2026 Coach B           (the current season; never measured)
```

The same name either side of a gap is **two observations, not one**. Ohio State
men's reads `CURRENT, CURRENT, UNRESOLVED, CURRENT` — three of four, not four
of four.

## 8. The denominator

**Readable measured programme-history seasons**, handed in by the caller. Where
2023 is unreadable, the model reports *2 of 3*, never *2 of 4*.

Calendar context is retained separately: `measuredSeasons[]` lists exactly the
seasons handed in, each with its season string, so a caller can always see
which calendar years the denominator covers. The current season is stripped
from the measured list if a caller passes it.

`currentCoachShare` is `currentCoachMeasuredSeasons / historicalMeasuredSeasons`,
or null where there is no denominator. **Descriptive only** — there is no
threshold and no label. A test asserts the model contains no
representativeness category anywhere in its output. The client statement is the
raw fact: *"1 of the 4 measured seasons in this report was under the current
coach."*

## 9. Timeline state

One enum **and the facts it was derived from**, because no single word covers
Ohio State men's — three measured seasons under the current coach and one never
resolved. `facts` is always present, so the label can be coarse without
anything being lost:

```js
facts: { currentCoachKnown, measured, attributed, previous, unresolved, transitions, interim, coHead }
```

`timelineStateOf(facts)` applies this priority, and the order is the design:

| # | State | Condition |
|---|---|---|
| 1 | `CURRENT_COACH_UNKNOWN` | no usable current coach |
| 2 | `CURRENT_COACH_NO_MEASURED_SEASON` | 0 measured seasons attributed |
| 3 | `SAME_COACH_ALL_HISTORY` | every measured season attributed |
| 4 | `CURRENT_COACH_ONE_SEASON` | exactly 1 attributed |
| 5 | `MULTIPLE_CHANGES` | 2 or more observed transitions |
| 6 | `COACH_CHANGE_WITHIN_WINDOW` | at least 1 attributed and 1 earlier named |
| 7 | `COACH_RECORD_INCOMPLETE` | otherwise |

**4 outranks 7 deliberately.** Mercyhurst men's has one measured season under
its current coach and two unresolved; "incomplete" is true of a different
programme and useless here, and one known season is the fact a reader needs.

## 10. The coach on file for earlier seasons

`predecessor` is `{ name, seasons }` **only where every `PREVIOUS_COACH` season
names one coach**, and null otherwise. Observational, per §2.

- Hofstra men's → `{ name: 'Richard Nuttall', seasons: ['2022','2023','2024','2025'] }`
- Michigan men's → **null**. All four measured seasons are unresolved and
  nothing may be invented.
- Drexel men's → **null**. Two earlier names, so no single one may be named —
  and the season-level timeline is retained regardless.

## 11. Interim

`currentCoach.interim` and `requiresInterimQualifier`. An interim is a property
of the coach, not of the timeline, so it is orthogonal to `timelineState` — and
`requiresInterimQualifier` exists so a renderer cannot read the state without
seeing it. **An interim is not a regime**, and a page describing a caretaker as
the programme's direction would be wrong.

18 programmes list an interim head coach for 2026; 17 of them also have a
readable measured season. Boston College men's is the shape: interim
Francesco D'Agostino for 2026, four measured seasons all on file under Bob
Thompson.

## 12. Co-head coaches

`coach_seasons` has primary key `(school, sport, season)` and therefore stores
**exactly one row per programme-season. It cannot represent a co-head
arrangement**, and this module does not pretend otherwise: it sets `facts.coHead`
and states the limitation in `evidence.reasons`. Four programmes are affected
(Butler, Pacific, Transylvania, Wheaton (MA), all women's). Solving the schema
is out of scope for 11B.

## 13. Transition counting

A transition is counted only where two measured seasons are **adjacent in the
calendar**, both resolved, and name different coaches.

| Sequence | Transitions |
|---|---:|
| `A A B B` | 1 |
| `A ? B B` | **0** — nothing observed places the change at either boundary |
| `A ? A A` | **0** |
| `A B A A` | 2 — a return is two changes, not one spell |
| `A A B B`, measured `[2022, 2024, 2025]` | **0** — the change crossed a season the report could not measure |

The consequence is deliberate under-counting, and it is why the production
figure for `MULTIPLE_CHANGES` is 11 programmes where the looser Phase 11A pass
counted 64. The looser pass treated adjacent *entries in the list* as adjacent
seasons, which counts a change across a gap. This is the direction of error the
codebase chooses every time.

## 14. Validation

Reproduced from the production model over all 2,122 programmes with roster
history. Base: **1,434 programmes** with a usable current coach and at least one
readable measured season.

| Measured seasons under the current coach | Production | Phase 11A | Δ |
|---|---:|---:|---:|
| 4 | 702 | 708 | −6 |
| 3 | 181 | 181 | 0 |
| 2 | 166 | 169 | −3 |
| 1 | 199 | 202 | −3 |
| 0 | 186 | 189 | −3 |

**Every difference is the role and name filtering, and every one is a
correction.** Of 1,570 named 2026 rows, 18 are rejected — 9 naming a role other
than head coach, 7 naming an associate head, 2 whose value is not a name — so
1,552 usable current coaches remain, and the base falls from 1,449 to 1,434
(the other 3 had no readable measured season either way). The programmes that
left are ones where an unfiltered model would have attributed a record to a
strength coach or an associate.

`timelineState`, NCAA D1–D3 (n = 1,720):

| State | n | Share |
|---|---:|---:|
| `SAME_COACH_ALL_HISTORY` | 757 | 44.0% |
| `CURRENT_COACH_NO_MEASURED_SEASON` | 304 | 17.7% |
| `COACH_CHANGE_WITHIN_WINDOW` | 207 | 12.0% |
| `CURRENT_COACH_ONE_SEASON` | 175 | 10.2% |
| `CURRENT_COACH_UNKNOWN` | 169 | 9.8% |
| `COACH_RECORD_INCOMPLETE` | 97 | 5.6% |
| `MULTIPLE_CHANGES` | 11 | 0.6% |

Other production quantities: predecessor resolvable to a single named coach at
**449** programmes (115 of the 186 zero-season cases); interim current coach
**17** in base; co-head flagged **4**; at least one unresolved measured season
**208**; zero or one measured season under the current coach **385 (26.8%)**.

## 15. Performance

| | |
|---|---:|
| One programme, 2,000 repetitions | **0.009 ms** each |
| All 1,763 NCAA programmes | **16 ms** |
| The one query a report would add | under 1 ms, 5 rows |

Against a 2,100 ms pool build and a 50–100 ms render, attribution is noise. No
precomputation, no caching, no pool. Better than the 11A estimate of 0.06 ms
because the model is arithmetic over at most five rows.

## 16. Known limitations

| # | Limitation | Scale |
|---|---|---|
| 1 | No coach data below NCAA D3 | 403 of 2,122 report-universe programmes return `CURRENT_COACH_UNKNOWN` with `NO_ROW` (380 NAIA, 21 USCAA, 2 NCAA) |
| 2 | Missing or unusable current coach in NCAA | 169 of 1,720 (9.8%) |
| 3 | Unresolved measured seasons | 208 programmes have at least one; the model marks them and never fills them in |
| 4 | Co-head cannot be represented | 4 programmes; schema limit, flagged not solved |
| 5 | Interim is a flag, not a tenure | 18 programmes for 2026; an interim's own first season is still attributed to them |
| 6 | Transitions are under-counted across gaps | by design; 11 `MULTIPLE_CHANGES` against a looser 64 |
| 7 | No tenure length, no appointment date | the window is five seasons and cannot see either end |
| 8 | A first season is attributed to the coach who ran it | `coachTenure.FIRST_SEASON_IS_INHERITED` says a first season is played with the previous coach's recruits. Attribution is about who was in charge, not whose recruits played, so it does not apply that adjustment — a consumer that needs it has the season list |
| 9 | Endowed-chair and dual titles rely on phrase matching | validated against all 221 titles present; a new title shape could need the rule extended |
