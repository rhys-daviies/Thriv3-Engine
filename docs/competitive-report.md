# Competitive Intelligence on the page — Phase 12F

*How Competitive Intelligence V1 is rendered in the Program Intelligence PDF:
the two pages, the vocabulary they are allowed, what they refuse to draw, and
the measurements behind the layout. The DATA contract is in
[competitive-v1-freeze.md](competitive-v1-freeze.md); this is the PRESENTATION
contract that sits on top of it.*

## 1. Two pages, because there are two questions

| Page | Question | Answers with |
| --- | --- | --- |
| **Competitive history** | *How has this programme competed across the seasons we can measure?* | the W-L-D record for each readable season, the winning percentage it produced, where that rate sat among the programmes measured in the same division and year, the aggregate across the seasons read, and how many of those seasons belong to the current coaching era |
| **Competitive environment** | *Where were these results produced?* | the division and the conference each of those seasons was played in, the seasons in which either changed, and the record inside the conference where the conference published one |

They are not one page. A record and the competition it was recorded in are
different facts, and collapsing them is how `8-7-2` comes to mean the same thing
at Mercyhurst in 2022 and in 2024 — two seasons, two divisions, two conferences,
one string.

Both sit at the end of **Act II, the programme evidence**, after the roster
opportunity material and before the supporting record. On an athlete report they
land in the same act ("Understanding the programme"), unchanged: nothing on
either page is athlete-specific, because a competitive fit score and a "this
level is right for you" are exactly what V1 refuses to imply.

## 2. What the renderer may read

`model.competitive`, which is `competitivePackageFor(collegeId)`, and nothing
else. No query, no SQL, no `colleges.division`, no `soccer_score`, no second
opinion about a season the package refused. `server/lib/reportCompetitive.js`
imports no query module, and a baseline invariant asserts it.

The pages draw only the fields the frozen contract marks `RENDER` or
`RENDER_WITH_COVERAGE_GATE`, and every gated figure carries its own denominator:

- a **conference record** is never drawn without the conference named beside it,
  and the table is grouped by conference so two conferences cannot be read as one
  competition;
- a **benchmark** is never drawn without the size of the pool it was taken from;
- an **aggregate** is never drawn without the seasons it covers.

`INTERNAL_ONLY` never reaches the page: the renderer does not read `.internal`
at all, so the conference table row, the seed and the conference size are
structurally unreachable from it.

## 3. The benchmark vocabulary is three words wide

`UPPER QUARTER`, `MIDDLE HALF`, `LOWER QUARTER`, derived from the package's
percentile in the renderer:

```
percentile > 0.75  ->  UPPER QUARTER
percentile < 0.25  ->  LOWER QUARTER
otherwise          ->  MIDDLE HALF
```

**The boundary belongs to the middle half on purpose.** It is the least
consequential of the three, so a rate sitting exactly on a quartile is reported
as the non-statement rather than as the claim.

The percentile itself is never printed. It is a real number and a false
precision: every match inside a division has a winner and a loser, so the median
rate is .500 close to by construction, and a rate is partly a property of who a
programme scheduled. A quarter-of-the-distribution statement survives that; a
decimal does not.

Every sentence is about a **rate**, never about a programme. "The 2025 rate sat
in the lower quarter" is a statement about a number a reader can check. "The
programme is in the lower quarter" is a statement about the programme, and this
pool cannot support it.

Rates are printed in the leading-dot form the NCAA and the schools themselves
publish — `.658`, not `65.8%` — so a family checking our figure against their own
programme's website finds the same characters.

## 4. What the pages will not draw

No score, no grade, no star rating, no traffic light, no gauge. No arrow and no
direction glyph; no green-to-red ramp. A sequence of four seasons drawn in year
order is chronology, and the moment a line is run through it the page has claimed
a trajectory that four seasons cannot support — so the season figure is
**discrete rows, no connecting line**.

Every division block in the structural timeline is drawn in the same ink at the
same weight and opacity, whether it says `NCAA D1` or `NAIA`. A palette that
makes one division darker than another has ranked the divisions on a page that is
not allowed to.

A division change is presented as **two seasons and two divisions**, with the
caveat that a programme changes division after investment, after a conference
reorganising, after a merger and after an enrolment decision, and that nothing
collected here can tell those apart. A change is marked in the timeline as a
claret **seam** between two blocks — and only between two blocks that are both
established, because a change out of an unknown season is not a change we
observed.

The coach block answers one question — how much of the history the reader is
looking at belongs to the current coaching era — as a count, its denominator and
the seasons by year. There is no before-and-after split, no per-coach rate and no
comparison with a predecessor: the reader will read any difference placed side by
side as the coach's effect, and four seasons cannot separate a coach from a
recruiting class, a conference move, a schedule or chance.

## 5. Missing is not zero, and an absence never reads as a bad season

- A season with **no benchmark** still shows its own rate, with `NO BENCHMARK`
  and the reason beside it (`division not established`, `too few measured`).
- A season with **no conference on file** gets a labelled, dashed block saying
  `not established`, never a blank one.
- A **year in the window with no season at all** gets its own column labelled
  `no season read`, and it breaks every span that crosses it. UC Merced men's
  has 2022, 2024 and 2025; drawn as three columns the conference block over the
  first two read "2022–2024", a membership across a season this data does not
  establish.
- A season the conference **published no record for** appears in the table with
  an em dash and a note saying what a dash is — not omitted, which would make it
  look like a season that was not played.

Refusals are grouped by kind rather than repeated per season: a group of one
prints the package's own frozen sentence verbatim, a group of more prints the
same sentence with its seasons listed. Albany men's carries eight refusals that
are two sentences said four times each. A baseline invariant asserts that the
grouped text still names every season the refusals name.

## 6. When a page is not drawn

| State | Programmes | What is drawn |
| --- | --- | --- |
| no readable season | 27 | neither page |
| a record, no membership and no division | 229 | history only; the structural absences are stated in that page's own aside |
| anything else | 1,847 | both pages |

The environment page is refused where it would be a title and four refusals.
`competitiveEnvironmentIsWorthAPage` is declared once, in
`shared/report/sections.js` beside the other two document-shape questions, and
read by both the registry and the history page — a section listed in the contents
and never printed, or an absence stated on neither page, is what two answers to
that question produce. A baseline invariant checks the two agree across the whole
universe.

## 7. Measured

Every programme, both pages, drawn under the layout guard:

| | history | environment |
| --- | --- | --- |
| pages drawn | 2,125 | 1,847 |
| overflow / collision / clipping / undrawable characters | 0 | 0 |
| spilling to a second page | 0 | 0 |
| tightest clearance of the flow floor | 27pt (UCLA men's and 5 others) | 12pt (Jamestown women's) |
| most space left | 208pt (Wiley University) | 391pt (Walla Walla women's) |

The flow floor is 24 points above the boundary the overflow guard enforces, so a
page sitting on it is still inside the box. Nine programmes — one per state, each
the tightest measurement of its state — are asserted in
`npm run verify:baseline` so the clearance cannot quietly go negative.

Whole reports, stratified by sport × division × coverage state: **506 programme
reports and 36 athlete reports, 0 layout defects.** Page counts:

```
  6 pages  21      15 pages  82      20 pages  80
  7 pages   7      16 pages  64      21 pages  33
  8 pages   9      17 pages  14      22 pages  39
 10 pages   7      18 pages  16      23 pages  12
 11 pages   9      19 pages  87      24 pages   2
 12–14     23
```

Mean pages: 17.9 where both competitive pages are drawn, 16.7 where only the
history page is, 7.2 where neither is. Measured directly over 120 programmes, the
delta is exactly **one page per section added, with no knock-on repagination**.

## 8. The analytical snapshot

`npm run snapshot:pi -- --check` drifted by **24 fields, every one of them a
`programmes.*.sections.N` entry**: two sections inserted in Act II, the sections
after them shifted down two slots, two new trailing slots. Zero fields outside
the section list changed — no verdict, no dial, no count, no ladder, no
benchmark, no coach reading. The snapshot carries no page numbers by design, so
page movement is not in it; that is held by the report QA sweep above.

## 9. Deliberately not built here

Everything the freeze defers stays deferred: conference finish, postseason depth,
schedule strength, opponent strength, goals for and against. No new metric, no
change to any Competitive Intelligence method, no new collection.

## 10. Every sentence names the set of seasons it counted — Phase 12G

Three sets of seasons meet on these two pages and they are not always the same
set: the seasons with a readable win/draw/loss record, the seasons with a
conference, and the seasons with a division. University of Rochester women's has
four, three and three.

12F printed *"Every season on file was played in NCAA Division III"* from the
third set beside a table of the first. Not false, and read — reasonably — as a
claim about all four seasons. 12G corrected the wording without touching the
condition that produces the fact:

| Before | After |
| --- | --- |
| Every season on file was played in NCAA Division III. | All 3 seasons with an established division were played in NCAA Division III. |
| …across 3 seasons on file (2022, 2024 and 2025). | …across the 3 seasons whose conference is on file (2022, 2024 and 2025). |
| The division played in is not established for 4 of the 4 seasons on file. | The division played in is not established for any of the 4 seasons whose conference is on file. |
| These seasons were not all played in the same division (NAIA and NCAA D2)… | The seasons read were not all played in the same division (NAIA and NCAA D2)… |

The count rather than the season list in the stable-division sentence, because
the conference sentence directly above it already prints the seasons and
"(2022, 2024 and 2025)" twice in adjacent bullets is repetition, not clarity. Two
counts get words: `Both` at two, `any` at none.

**The rule is now a machine check, not a remembered caution.** A baseline
invariant sweeps every sentence the two pages author — 19,573 of them across
2,152 programmes — and fails any sentence that quantifies a set of seasons
(`every`, `each`, `all N seasons`) without naming which set, in the same
sentence. 3,304 sentences quantify a set; all 3,304 name it. A second invariant
refuses `throughout`, `across all` and `entire window` outright, since none of
them can carry a denominator.

## 11. Programmes with no readable competitive season — the decision

**Decision: keep the current behaviour.** The 27 programmes with no readable
season get neither Competitive page and no Competitive absence statement.

The alternative was tested rather than argued. All 27 already carry a *Where the
evidence runs out* page (each has three or four refusals, well past the
two-refusal consolidation gate), and across the whole universe **no programme's
consolidation gate would flip** if a competitive entry were added — so the
architectural objection to putting the sentence there does not apply. Measured:

| | result |
| --- | --- |
| a compact heading-plus-paragraph block on that page | 26 of 27 reports unchanged |
| Warner Pacific men's (four existing refusals) | 14 → **15** pages |
| what the 15th page would contain | the closing aside alone, 113pt of ink and 650pt of white |

That page has about 13 points of slack. Every informative form of the sentence —
with a heading, without one, folded into the intro paragraph, cut to a single
line — overflows it, and the overflow produces a near-blank page. A room-measured
gate would render the statement for 26 programmes and silently drop it for the
27th, which makes the presence of an absence statement depend on page fullness.

So the sentence is not added. The justification is not only the page count: a
section that is *not in the document* is not an unexplained gap the way a chart
with no data is. The contents page lists what the report contains, this report
already omits twenty other sections at sparse programmes, and nothing on any page
of those 27 reports asserts or implies anything about competitive history. The
"every absence states its reason" rule governs absences *inside* a page, and it
is kept everywhere it applies.

Reversing this is one block in `evidenceLimitsPage` and one accepted page at one
programme, if the trade is ever judged worth it.

## 12. Also corrected in the final QA pass

Four things the visual review found that the automated sweep could not:

- **A legend for ink that was never drawn.** The season figure printed "pale band
  and light mark are the middle half and median of that season's division" at
  Kansas State women's, whose four seasons carry no established division and
  therefore no band. The key is now built from what the figure actually carries.
- **A 427-point block saying "NCAA D3".** Anderson (IN) men's has one readable
  season, and dividing the timeline grid by one gave a full-width band that reads
  as a rendering fault. A column is capped at 150 points, so a short window
  occupies a short axis.
- **A span-and-seam explanation on a page with one column.** The timeline
  subtitle, and the "same set of programmes" reading sentence, both described
  comparisons a single-season page does not have. At one season the page states
  the season, its division and its conference, and nothing about spans.
- **"Of the 4 seasons that could be compared, 4 sat in the upper quarter."** One
  band doing the work of a distribution. Where every season landed in the same
  quarter the sentence says so once: "All 4 seasons that could be compared sat in
  the upper quarter…".

Re-measured after all of them: the whole-universe page sweep, the 506-programme
and 36-athlete report sweep, the page-count distribution and the tightest
clearances are **identical to Phase 12F**. The analytical snapshot shows **zero**
differences.

## 13. Observed and deliberately left alone

`conferenceSize` is `INTERNAL_ONLY` in the frozen field contract, and the frozen
`conferenceRecordFact` sentence prints it ("one of 8 programmes in it that
season" at Grand Valley State women's 2022, where the GLIAC had more than eight
women's members). Those sentences are **not rendered** — the environment page
builds its table from `historicalConference`, `conferenceRecord` and
`conferenceMatches`, so the figure never reaches a reader. It is a data question
for a later phase, not a presentation one, and 12G collected no data.
