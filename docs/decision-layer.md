# The decision layer

Phase 13C. What the front of a Programme Intelligence Report says first, and
why it says that rather than something else.

## The principle

**Rank the findings. Freeze the page order.**

The pages of the report run in the 13B narrative order at every programme.
Only the decision layer is programme-specific: it chooses which of the
report's conclusions deserve the reader's first thirty seconds, and points at
the pages that carry them. A finding may point forward to page 12 while a
lower-ranked finding points back to page 4. That is intentional. Emphasis is
ranked; architecture is not.

## The two functions

| page | function |
|---|---|
| **What Thriv3 sees** | the most important programme-specific findings, ranked |
| **Programme snapshot** | the compact factual context those findings sit in |

The snapshot flows onto the findings page where there is room for it and takes
its own page where there is not. Two pages are not hard-coded; hierarchy is.

## The candidate set

Ten categories, and no others. Nothing here generates a new analytical
category, and nothing here computes a number that is not already in the model.

`competitive-environment` · `coach-context` · `freshman-opportunity` ·
`player-development` · `experienced-arrivals` · `replacement-behaviour` ·
`roster-continuity` · `current-squad` · `competitive-history` ·
`player-destinations`

Declaration order above is also the final tiebreak in the ranking, so two
findings that are equal on every other test resolve deterministically.

## Eligibility

A candidate enters the ranking only if all four hold:

1. the underlying analysis ran and produced a value;
2. its evidence contract permits a reader-facing statement;
3. the statement is analytically meaningful — a band, a structural change, a
   dominant route, or a squad fact with a denominator;
4. it is not merely an absence.

Rule 4 has exactly one exception, and it is the one the brief names: an
absence is admitted where it changes how another finding must be read. Only
coach attribution qualifies — a record that describes none of the current
coach's seasons reframes every historical finding beneath it. Every other
absence is refused with a recorded reason and, where it is orientation rather
than silence, appears in the snapshot instead.

## Materiality

Deterministic. Derived only from facts the model already established:
benchmark band, structural change, evidence level, sample completeness,
dominant-route margin, and whether a finding changes the interpretation of the
measured window. Never from prestige, ranking, brand, coach reputation, or any
judgement of the text.

| class | what qualifies |
|---|---|
| **A** | structural facts that change how the whole window must be read: a division change inside the window; the current coach in post for none or one of the measured seasons, or an interim |
| **B** | a programme-vs-pool departure — `above-benchmark` or `below-benchmark` — with adequate evidence; a replacement route departing from the pool mix by at least `STEP_POINTS` |
| **C** | a programme-specific pattern inside the normal range: a `typical` band; a dominant replacement route; a conference change with no division change; a current-squad eligibility concentration |
| **D** | context: traced destinations; the aggregate competitive record |

Materiality is not valence. A programme heavily reliant on experienced
arrivals and a programme that gives first-years unusually large roles are both
class B, because both are departures from the pool. Nothing here is scored,
ranked as good or bad, or coloured.

## Evidence

Evidence is an **admission gate first and a ceiling second**, never an
addition. It cannot promote a finding and it cannot be traded against
materiality.

```
insufficient → not eligible                     (except a class A record)
limited      → ceiling C
moderate     → ceiling B
strong       → ceiling A
record       → ceiling A   (a structural fact is a record, not a sample)

priority = the worse of (materiality, ceiling)
```

So a materially interesting finding on weak evidence lands at C-limited, and a
moderately interesting finding on strong evidence lands at C-strong. Within a
class, stronger evidence ranks first — which is exactly the interaction §G
asks for, with no invented confidence number anywhere.

## Ranking and selection

Sort by priority class, then evidence level descending, then declaration
order. Then:

- every class A and B finding is rendered;
- class C fills up to six;
- class D is rendered only while fewer than four findings have been selected;
- six is the ceiling, and there is no floor. A programme with three strong
  findings shows three. Nothing is padded, and no absence is ever admitted to
  reach a count.

## The canonical sentence

Each category exposes exactly one decision-layer statement, built in one
place:

```
{ text, metric, evidenceNote, section }
```

`text` is the finding. `metric` is the **single** headline figure — one per
concept, never two renderings of the same idea. `evidenceNote` is the sample
behind it. `section` is the page that carries the analysis.

The renderer assembles nothing. This is the direct answer to the 13A defect in
which 28% and 30.9% both appeared as the headline for experienced arrivals:
there is now one function that can answer that question, and it returns one
number.

## The programme snapshot

Orientation, not analysis. Seven lines — seasons analysed, division, conference,
current roster, projections held, competitive record on file, vacancy
observations — plus the head coach, and nothing that carries a band, a
comparison or a conclusion.

It flows under the findings where they leave room and takes its own page where
they do not. Across the whole universe it has never needed its own page:
2,260 of 2,260 reports keep both surfaces on page two. The fallback stays
because a future finding set could be longer, and a snapshot pushed onto page
three is better than a snapshot squeezed.

### Coach context, at proportional volume (§R)

| case | where it appears | shape |
|---|---|---|
| every measured season is the current coach's | snapshot | name + count |
| some but not all | snapshot | name + count + season strip |
| none, one, or an interim | **a class A finding** | the attribution sentence, plus name and strip below |
| the 2026 record could not be read | snapshot | "Not established" + one grey sentence |
| no coach record at this level | snapshot | "Not on file" + four words |

The unresolved case is the one this phase was asked to fix. It used to occupy a
quarter of the page — a chip, a 17pt headline, four fact lines — to say that a
row could not be read. It is now three grey lines, and the refusal itself is
unchanged: the strength coach at Marist men's is still named nowhere.

## What the rules produce

Measured across all 2,401 programmes.

| findings | reports | share |
|---|---|---|
| 0 | 154 | 6.4% |
| 1 | 229 | 9.5% |
| 2 | 292 | 12.2% |
| 3 | 165 | 6.9% |
| 4 | 92 | 3.8% |
| 5 | 136 | 5.7% |
| 6 | 1,333 | 55.5% |

Bimodal, because coverage is: a programme either publishes readable rosters or
it does not. The 154 with none render the refusal and nothing else, which is the
honest page.

| category | selected | share | mean rank | leads |
|---|---|---|---|---|
| roster continuity | 2,022 | 84.2% | 2.84 | 563 |
| player development | 1,572 | 65.5% | 2.36 | 387 |
| first-year opportunity | 1,465 | 61.0% | 2.90 | 414 |
| experienced arrivals | 1,446 | 60.2% | 3.65 | 123 |
| current squad | 1,254 | 52.2% | 4.95 | 2 |
| replacement behaviour | 1,210 | 50.4% | 4.48 | 13 |
| competitive record | 880 | 36.7% | 1.91 | 354 |
| whose record this is | 357 | 14.9% | 1.02 | 349 |
| competitive environment | 124 | 5.2% | 2.60 | 42 |
| where players go | 24 | 1.0% | 3.29 | 0 |

Rendered findings by class: 386 A, 3,467 B, 5,802 C, 699 D.

### Pathological behaviour, checked for

**Destinations selected too often** — no: 1.0% of reports, never above class D,
and refused 1,703 times on a closed gate.

**Coach absence dominating** — no: the unresolved case is refused 171 times and
promoted zero times; the 682 programmes with no coach record at their level say
so in four words.

**The competitive finding never surfacing** — no: it appears on 124 reports, and
every one of the 29 programmes that moved division leads with it. It is refused
as orientation at the 1,722 whose structure did not change, which is the point:
"the programme competed in the PSAC across four seasons" is context, and a
report whose headline is context has buried its own intelligence.

**The same findings almost everywhere** — partly true and deliberate. 55.5% of
reports render six, because at a well-covered programme all six of those
analyses have something to say. What differs is the sentences, the bands and the
order: continuity's mean rank is 2.84 and the current squad's 4.95. The
hierarchy holds where it matters — only 73 of the 1,333 six-finding reports are
six class C findings, and 1,773 of the 2,247 reports with any finding lead with a
class A or B.

**Sparse programmes padded with weak content** — no: nothing is padded, class D
enters only while fewer than four findings have been selected, and no absence is
ever admitted. The 0–2 finding reports are 28% of the universe and every finding
on them cleared the same gate as the ones on a Division I page.

## Duplication

Checked mechanically across all 2,401 reports, for each of the seven concepts
§X names — first-year minutes, experienced-arrival share, development
percentage, continuity percentage, competitive benchmark, coach attribution,
current eligibility. **Every one is stated on exactly one surface, on every
report.**

The coach's NAME appears twice on a report whose attribution is a finding: in
the finding, which names who the seasons belong to, and in the snapshot, which
answers "who is the head coach" where a reader looks for it. The ATTRIBUTION —
the count — appears once, and the snapshot's note is deliberately null in that
case.
