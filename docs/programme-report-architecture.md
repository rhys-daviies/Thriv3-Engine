# The Programme Intelligence report — narrative architecture

*Phase 13B. What the report's three layers are, what each page answers, where
the evidence boundary sits, and what was consolidated to get there.*

## 1. Three layers

| Layer | Reader question | Where |
|---|---|---|
| **Decision** | What are the most important things Thriv3 has learned about this programme? | the cover and *Programme at a glance* |
| **Programme intelligence** | how players get on the pitch · how the squad is built · where openings come from · what the programme recorded | the middle act, grouped into five questions |
| **The evidence behind it** | Show me how Thriv3 knows. | the supporting record and the methodology |

A reader may stop at the end of the programme act and understand the programme.
Everything after the boundary substantiates what came before.

## 2. Vocabulary: two things were called evidence

13A found the running kicker on primary analytical pages reading
`PROGRAMME EVIDENCE` while the appendix act was `THE EVIDENCE BEHIND IT` — the
report's own words erasing the boundary the product most needs sharp. Fourteen
pages told the reader they were already in the evidence.

| | before | after |
|---|---|---|
| primary act title | The programme | **Programme intelligence** |
| primary page kicker | PROGRAMME EVIDENCE | **PROGRAMME INTELLIGENCE** |
| evidence act | The evidence behind it | unchanged |
| the roster in full | a primary page with the primary kicker | an evidence page, set quiet |

The internal layer id is still `programme-evidence`. That is a code identifier,
not a reader-facing word, and renaming it would have moved every line of the
analytical snapshot without changing anything a reader sees.

## 3. The order, and why the competitive frame moved

Five narrative groups, declared once in `NARRATIVE_GROUPS` and used both by the
running order and by the contents page:

```
Where you would be competing   the competition these seasons were played in
Getting on the pitch           how much first-years actually play
                               how players develop after they arrive
How the squad is built         how this programme uses its squad
                               players brought in ready to play
                               who stays, and who we can follow
Where openings come from       replacing minutes
                               position by position
                               the squad you would be joining
What the programme has         how this programme has competed
  recorded
```

**The competitive environment page opens the act.** Every pool comparison in the
roster pages is scoped to a division, and at 32 programmes the division changes
inside the measured window. Read last — as it was, at page 17 of 17 — a family
had already interpreted four seasons of roster behaviour without knowing they
spanned two competitions. Mercyhurst men's played 2022–2023 in NCAA D2 and
2024–2025 in D1, and now learns that on page 3.

Its title and question changed with its position: it can no longer ask "where
were these results produced?" about results the reader has not seen. It asks what
level and which conference the measured seasons were played in.

**Competitive history stayed where the results are interpreted**, at the end of
the act, and is now read inside an environment the reader already has.

## 4. Consolidations

Three, each meeting the test that the reader was otherwise answering the same
question twice.

**The first-year intake + the first-year ladder → *How much first-years actually
play*.** They plotted the same first-years on the same 0–1,600-minute axis with
the same 600-minute marker on consecutive pages, and both closed with the same
"at least one first-year played a starter's season in N of M seasons". The ladder
leads. The intake survives as a four-row table — season, first-years, given a
minute, reached 600, share of squad minutes — which carries everything the two
column charts did in a third of the height. The per-player scatter is not
redrawn: every dot in it is a named row in the evidence act, with its origin.

**Experienced arrivals + who the arrivals are → *Players brought in ready to
play*.** Frequency, the squad-wide share, the distribution of what they played,
and the positions they arrived at. The two-population minutes chart is gone —
its content is the scope line, the by-position totals and the evidence table.

**Roster continuity + observed destinations → *Who stays, and who we can
follow*.** Both described the same departure population and both printed the same
three-way split of it. Continuity leads; destinations is a block sized to its
traceability, and where the gate is closed there is no block. At a full-data
programme the section runs to two pages, with a proper continuation header — one
narrative, not two sections.

## 5. Moves

- **The 2026 arrivals** left the historical arrivals story for the current-squad
  page. Their minutes are projected, not played, which is why the page that
  carried both halves had to warn that its own two tables were not comparable.
- **The current squad in full** left the narrative for the evidence act. Two
  pages of a 59-row lookup table were printed between the squad outlook and the
  continuity story — the two densest pages in the report, interrupting the
  argument they support. The outlook page points at it.
- **The season-by-season openings** left *Position by position* for the evidence
  act, which tabulates the same nine openings properly.

## 6. Position by position — the §M decision

**Kept as its own section, and it earns its own page at a full-data programme.**
Measured: the block is 222 points — a four-row, seven-column table plus the
definition a reader needs in order not to subtract its two "started" columns from
each other — and the replacement page above it leaves 219. So it does need the
room. Where the replacement page is shorter it flows beneath it and reads as the
second half of one opportunity story, on the same measured-room rule the arrivals
section already uses.

It is visually light on its own page. That is a candidate for the visual phase,
not a reason to delete position-specific intelligence.

## 7. One reconciled figure on the decision layer

13A found *Programme at a glance* stating the experienced-arrival share twice, as
**28%** in the summary bullet and **30.9%** in the card, with nothing to say why
they differed. Both were correct on their own denominators:

| figure | field | what it measures |
|---|---|---|
| 30.9% | `dials.newcomer` | the share of a **vacated position's** minutes |
| 28% | `shareOfMeasuredLoad` | the share of the **whole squad's** readable minutes |

The card's figure wins, for a reason rather than by preference: it is the one with
a pool behind it, so it is the only one of the two that can carry the "above the
comparable pool" clause the bullet exists to deliver. The bullet now quotes it,
with the same rendering and the same denominator named, and the squad-wide share
moved to the arrivals page where there is room to say which is which.

Where no position-season carries enough minutes to read the mix — the case in
which the card states that it cannot give a figure — the bullet falls back to the
squad-wide share, names that denominator and carries no pool clause. The
alternative was a decision layer that silently lost a finding.

**No calculation changed.** This chose which of two existing fields the decision
layer speaks with.

## 8. Repetition removed, and repetition kept

**Removed** — editorial duplication:

- the nine named openings under *Position by position*, tabulated in the evidence act
- the traced/unsettled/no-trace split, printed on both continuity and destinations
- the projected-minutes column chart, a strict subset of the table under it
- the second "3 of 4 seasons had a starter-level first-year", on two consecutive pages
- the per-player first-year scatter, fully present as named rows in evidence
- the two-population arrivals minutes chart
- the historical/current arrivals cross-reference, in both directions
- "Where those seasons were played" as a page-relative phrase — the competitive
  readings no longer say "the previous page" at all, so a future reorder cannot
  make them wrong

**Kept** — protective repetition, because a page can be read on its own:

- the 600-minute marker on every chart that uses it
- "missing is not zero" at each chart that has an absence, in that chart's own terms
- the projected-minutes contract wherever a projection is summed
- the experienced-arrival definition at first use
- the non-causal caveats on development, replacement and destinations
- "not a forecast" on the cover, the current-squad surfaces and the methodology
- the coach caveat on the decision layer and on the competitive page

## 9. The evidence boundary

After *How this programme has competed* — the last primary page. The act divider
states the contract, and the primary act no longer calls itself evidence. The
current squad in full opens the evidence act because it is the table a family
returns to.

## 10. Measured

| | Mercyhurst M | Rochester W | California M |
|---|---|---|---|
| total, before → after | 24 → **22** | 19 → **17** | 20 → **18** |
| primary | 16 → **12** | 13 → **11** | 13 → **11** |
| evidence | 7 → **9** | 5 → **5** | 6 → **6** |

Whole universe: **2,152 reports, 35,696 pages rendered, 1 problem** — a player
named `Zoё May` at UTSA women's whose name carries a character Helvetica cannot
draw. That defect is identical on `main` and predates this phase.

Stratified sweep: 506 programme reports and 36 athlete reports, **0 defects**.
Mean pages for a report carrying both competitive pages: 17.9 → **16.1**.

**Analytical regression: none.** The whole report model minus its `sections`
navigation — 854,242 bytes of JSON across five programmes — is byte-identical to
`main`. The analytical snapshot drifted by 47 fields and **every one of them is a
`programmes.*.sections.N` entry**; no analytical value moved.
