# V2 human validation — first review set

V2 has never been adopted. V1 serves every recommendation in production and is unchanged.
These packs exist so that a person can decide whether V2 behaves like a useful recruiting system
before that changes.

Generated 2026-10-02T09:01:01.478Z from `cfcc1bb`, explanations `ac09e1b`, against frozen V1 `711af51`.

## These are a new instrument, not an edit of the old one

The `-v2` packs are **retained unchanged**. They were generated 2026-09-23 from
`227b54f` against frozen V1 `480a915`, before A7.44, A7.45 and A7.48, and two
of them carry a completed human review that answers that exact instrument. A
review is an answer to the pack it was given; replacing the pack underneath it
would leave the answer pointing at nothing.

So this set gets its own name and its own provenance. Nothing here supersedes a
recorded judgement — it invites a fresh one.

| pack | `-v2` status | why |
|---|---|---|
| `A-FULLY_DECLARED_LEVEL` | **HISTORICAL_REVIEW_RETAINED** | reviewed (`pack-A-FULLY_DECLARED_LEVEL-v2.review.json`) |
| `C-ACADEMIC_FIRST` | **HISTORICAL_REVIEW_RETAINED** | reviewed (`pack-C-ACADEMIC_FIRST-v2.review.json`) |
| `C-UNDECLARED` | **HISTORICAL_REVIEW_RETAINED** | a review of this pack is in progress and is not in the repository; the `-v2` pack and that review are untouched |
| `A-FULLY_DECLARED_PLAYING` | SUPERSEDED_BY_CURRENT_PACK | no review attached |
| `G-BALANCED` | SUPERSEDED_BY_CURRENT_PACK | no review attached |
| `H-ACADEMIC_FIRST` | SUPERSEDED_BY_CURRENT_PACK | no review attached |
| `F-BALANCED` | SUPERSEDED_BY_CURRENT_PACK | no review attached |

### What changed in the engine between the two sets

* **A7.44** — unreadable positional evidence can no longer become evidence of absence; a measured zero stays distinct from an unknown.
* **A7.45 (Policy B)** — rotation alone no longer carries a rank-bearing Playing Pathway. Programmes whose positional competition cannot be established are now LIMITED_DATA rather than ranked on a historical rotation statistic.
* **A7.48** — the refusal vocabulary. Three sentences that were false are gone: a programme with no roster is no longer told its leavers could not be placed, a programme whose roster was read is no longer told none is held, and a refusal no longer promises rotation evidence it does not have.
* **V1 baseline** — moved from `480a915` to `711af51`, an input-compatibility repair audited at A7.48B. No V1 formula, constant or criterion changed; see [the freeze record](../v1-freeze.md).

Expect the numeric contents to differ from the `-v2` packs. They were measured
against a different engine, a different V1 baseline and a corpus that has since
grown; the difference is the point of regenerating them.

## How to do this

1. Open one pack. Read **View A only**. Do not scroll past the STOP divider.
2. For each programme, tick one classification and any reasons that apply. If you cannot judge, tick INSUFFICIENT INFORMATION — it is a real answer, not a soft one.
3. When View A is finished, read View B.
4. For each programme you and V2 disagree about, say which of the six categories it is.
5. Answer the thirteen questions at the end.
6. Say whether each proposed red flag is the right line.

**The order matters.** Once you have read View B for a pack, that pack can no longer produce a blind review. If you want a second reviewer, give them a clean copy.

## Suggested order

Start with **C**. It is the fixture that exposed the original V1 pathology, and it is the one where a bad answer would be most obvious. Then the **A pair** together, because the comparison between them is the review. **G** and the **H pair** can follow in a second sitting.

| pack | athlete | why | programmes to review |
|---|---|---|---|
| [`C-ACADEMIC_FIRST`](pack-C-ACADEMIC_FIRST-v3.md) | C-developmental-high-budget-strong-academics · competitive level 3, playing opportunity 3, academic strength 5 | The review the first one asked for: the athlete who says academics matter most. Lead with this. | 42 |
| [`C-UNDECLARED`](pack-C-UNDECLARED-v3.md) | C-developmental-high-budget-strong-academics · no preference declared | The same athlete under the original profile, so model change can be separated from new preference information. | 44 |
| [`A-FULLY_DECLARED_LEVEL`](pack-A-FULLY_DECLARED_LEVEL-v3.md) | A-strong-high-budget-strong-academics · competitive level 5, playing opportunity 1, academic strength 3 | A strong athlete who has answered all three questions, level-first. | 44 |
| [`A-FULLY_DECLARED_PLAYING`](pack-A-FULLY_DECLARED_PLAYING-v3.md) | A-strong-high-budget-strong-academics · competitive level 1, playing opportunity 5, academic strength 3 | The same athlete, opposite athletic goal. The pair is the review. | 42 |
| [`G-BALANCED`](pack-G-BALANCED-v3.md) | G-goalkeeper-starter-evidence · both athletic priorities 3, academics undeclared | Goalkeeper, all three declared and none dominant. | 42 |
| [`H-ACADEMIC_FIRST`](pack-H-ACADEMIC_FIRST-v3.md) | H-womens-strong-mid-budget · competitive level 3, playing opportunity 3, academic strength 5 | Women's soccer, academics first. | 44 |
| [`F-BALANCED`](pack-F-BALANCED-v3.md) | F-international · both athletic priorities 3, academics undeclared | International athlete, where recruiting market match is the international arm. | 47 |

Total: 305 programme reviews across 7 packs.

## What is deliberately not in View A

No V2 rank, no pursuit priority, no layer value, no gate, no explanation, and no V1 rank.
Programme strength and the athlete's calibrated percentile **are** shown, because "would you contact this school for this athlete" cannot be answered without knowing the school's standard. What is withheld is every model output, including the relationship between those two numbers.

The programmes are listed in an order derived from a hash of the pack id, so page order carries no information about rank.

## Archetype coverage

| archetype | covered by | source |
|---|---|---|
| elite / high-level men's athlete | V-ELITE (rating 10); A and B sit at 9 | validation fixture |
| strong men's athlete | A, B (rating 9) | frozen |
| mid-level men's athlete | E (rating 6), F (rating 7) | frozen |
| developmental men's athlete | C, D (rating 3) | frozen |
| low-budget strong athlete | B ($5k-$10k/yr at rating 9) | frozen |
| goalkeeper | G | frozen |
| international athlete | F (England, no home state) | frozen |
| domestic same-state athlete | E (Texas, public programmes in every division) | frozen |
| high-level women's athlete | H (rating 8) | frozen |
| mid-level women's athlete | V-WMID (rating 5) | validation fixture |
| prioritising highest competitive level | profile LEVEL_FIRST (5 / 1) on any athlete | profile |
| prioritising immediate playing time | profile PLAYING_FIRST (1 / 5) | profile |
| both priorities high | profile BOTH_HIGH (5 / 5) | profile |
| neither preference declared | profile UNDECLARED (null / null) - the default every frozen fixture runs under | profile |

## Running a real athlete

```bash
node server/scripts/v2ValidationPack.js --athlete=/path/to/athlete.json
```

The file holds one record in the player shape. Nothing about that athlete is written into this
repository, and the pack reports which required inputs were absent rather than filling them in.
An athlete who answered the intake preference questions keeps their own answers, and the pack is
named `AS_STATED` rather than `UNDECLARED` so the label matches the run.

## Recording the review

Fill the markdown by hand, then transcribe into the `review.rows` array of the matching `.json`,
or write a sibling file `pack-<id>.review.json` with the same row shape. Either way the review keeps the
pack's commit, calibration and pool digest with it, which is what lets the same review be replayed
against a later model.

## What happens afterwards

`agreementFor(pack, reviews)` turns a filled review into the agreement metrics. It produces no
single accuracy number, on purpose. Nothing in the model may be fitted to these labels: a disagreement
is triaged into one of six categories first, and most of them are not model defects.
