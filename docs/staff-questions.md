# What to verify with the staff

Phase 13H. One new athlete-facing surface, written down before it was built.

The page answers **"what should I verify directly with the staff before making
a decision?"** It does not answer "what should I do?", and nothing on it is a
recommendation, a forecast or a score.

Everything below is decided by `shared/report/staffQuestions.js`. The renderer
draws what the module returns and writes no wording of its own.

## The contract

Every question is an object:

```
{
  category,       // one of the twelve declared candidates
  family,         // the real-world conversation it belongs to
  question,       // the one sentence a reader asks out loud
  reason,         // why Thriv3 surfaced it — an existing stated fact, verbatim
  sourceFact,     // the same fact, as the field it came from
  sourceSection,  // the section id whose page carries it
  evidence,       // none | limited | moderate | strong | record
  priority,       // A | B | C | D
}
```

`question` and `reason` come from a controlled template per category. There is
no free text anywhere in the pipeline and no wording is composed at draw time.

## The generation rule

**A question exists only where the report already states the fact that caused
it.** Not "the data implies", not "a recruiter would ask" — the report prints
the sentence, and the question cites it.

Nothing may be generated from generic recruiting advice, prestige, coach
reputation, intuition, inferred roster plans, predicted transfers, predicted
playing time, or assumptions about scholarships, academics or tactics. If the
report cannot point at the fact, there is no question.

This is enforced structurally rather than by review: every class A and B
candidate is gated on **an athlete finding the decision layer actually
selected**, so its evidence is a sentence already ranked and printed on a page
the question references. No candidate introduces a threshold, and the module
reads no database and computes no figure.

## Two source classes

**A — evidence limitations.** What the record cannot establish. The roster is
held only through the current squad season while the athlete enters a later
one; the current coach owns part of the measured history; the programme's own
origin sample was refused; the opening sample is too small to read as a rate.

**B — material current or historical structure.** Only where the athlete report
has already surfaced it as material. Players at the position eligible beyond
the entry year; players in a final eligible season at entry; players added at
the position for the coming season; a measured reliance on experienced
arrivals; a repeated route after an observed opening; the first-year record at
the position.

Not every fact deserves a question, and most do not.

## The twelve candidates

Declaration order is the final tiebreak, so two candidates equal on class and
evidence always resolve the same way.

| candidate | family | class | gate |
|---|---|---|---|
| `position-group-beyond-entry` | position-group | A / C | current roster at the position; A where the group eligible beyond entry is at least the number a typical season sees reach a starter's season |
| `position-final-season-at-entry` | position-group | A / C | at least one player in a final eligible season at entry; A on the same comparison |
| `known-arrivals-at-position` | position-group | C | the coming season's roster added at least one player at the position |
| `roster-coverage` | position-group | C | the entry year is beyond the roster horizon |
| `experienced-arrival-reliance` | replacement | B | the `position-arrival-reliance` finding was selected |
| `position-opening-route` | replacement | B | the `position-opening-history` finding was selected |
| `first-year-introduction` | introduction | B | the `position-first-year-record` finding was selected **and** the entry type is first-time |
| `coach-attribution` | attribution | B / C | coach prominence is PROMINENT (B), VISIBLE or a refusal (C) |
| `competitive-structure` | attribution | C | the `competitive-structure` finding was selected — a division change inside the measured window |
| `origin-cohort` | origin | C | the athlete arrives from outside the United States **and** the programme's own origin evidence was refused |
| `traced-destinations` | evidence | D | the `traced-position-movement` finding was selected |
| `position-sample` | evidence | D | openings observed but the pattern is not readable as a rate |

An unresolved current coach is class C, never higher: an absence is not a
finding, and 13C settled that a coach who could not be established must not
outrank measured intelligence.

Missing conference or division rows do not generate anything. A gap in an
administrative field is not a question for a coach, and Rochester's missing
2023 structural row is the fixture that holds it.

Poor destination tracing stays an evidence limitation. `traced-destinations` is
class D and class D is only admitted while the page is nearly empty, so in
practice it is never selected.

## Evidence: a gate, then a ceiling, never a bonus

The same table as both decision layers.

| evidence | ceiling |
|---|---|
| record | A |
| strong | A |
| moderate | B |
| limited | C |
| none | refused |

The priority is `worse(materiality, ceiling)`. A materially interesting
question resting on a thin sample cannot outrank a moderately interesting one
resting on a strong record.

## Deduplication

Several facts often point at **one real-world conversation**. Seventeen players
recorded at the position, thirteen of them eligible beyond entry, projected
minutes attached to three of those — that is one question about the future
position group, not three.

So candidates are grouped into six families and **at most one question is taken
from each family**. The winner is the highest-priority eligible member, then
declaration order. Nothing is lost: the winner's reason carries its own fact
and, where a second member of the family was also eligible, that member's fact
too — capped at two, so the reason stays a line or two.

## Selection

- All eligible class A and B questions.
- Class C to a ceiling of **five**.
- Class D only while fewer than **two** have been chosen.

No minimum. A sparse programme may produce one question and a completely
readable one may produce none. Nothing is padded to fill a sheet, and where
more than five qualify the priority decides rather than a second page.

## Wording

Questions begin with **how**, **what** or **which**. Never *why*: "why" carries
a cause and an accusation, and this page has no view on either.

A question must not imply that Thriv3 believes the answer is good or bad. It
opens an unknown; it does not preload a conclusion. So not "will these thirteen
defenders stop me playing" but "how does the staff expect the defender group to
be structured around 2027".

One sentence, specific, neutral, easy to ask out loud. Where a question is
generated from a ranked finding it must **open the unknown rather than restate
the finding** — the finding says thirteen of seventeen are eligible beyond
2027; the question asks how the staff expects the group to be structured.

The historical fact stays in the reason and the plan stays in the question, and
the two are never blurred: what happened is not what is planned. No question
says a route will repeat, and no question converts eligibility, projections or
historical minutes into minutes for the reader.

"Experienced arrivals" is the approved term. Never "transfers", because the
underlying category identifies players with college seasons behind them rather
than a transfer route. Origin is the broad group the analysis uses — outside or
within the United States — never an individual nationality.

## The reason line

Every question carries one short line saying why it is here, and that line is
an existing analytical fact with nothing added. It is not an interpretation of
the fact and never a second opinion about it.

## The source reference

Each question names the section whose page carries its fact, drawn as a quiet
reference — `Based on: Your position, and the timing around your arrival ·
p.4`. Section titles, never internal ids, and the page number is deferred and
filled in once the document is complete.

## Where the page sits

Last in the pathway act: after the athlete's own analysis and origin page,
before the frozen Programme Intelligence act. It is decision support, not
evidence, so it does not belong in the evidence act.

```
What Thriv3 sees for you
What Thriv3 sees about the programme
… your pathway …
What to verify with the staff
Programme Intelligence
The evidence behind it
```

## Zero questions

The section is **omitted**. No empty page, and no line saying there is nothing
to verify — the absence of the page is not a statement that the programme is
safe, ideal or fully known, and printing one would make it into one.

## What this phase may not do

Compute anything. Read the database from a renderer. Add a threshold. Change a
model, a finding, a ranking, a page order or a programme page. The only
structural change permitted is the insertion of this one section at the
position above.
