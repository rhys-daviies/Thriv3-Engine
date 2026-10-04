# A11.2 — Recommendation card information hierarchy

**Verdict: `A11_2_UI_READY`.** Presentation only. No scoring, evidence,
explanation generation, persistence, schema, migration, ranking, programme
context or status semantics was changed.

`shared/matching/` is byte-identical to `origin/main` (tree `756c8108`), and
`server/db/schema.sql` and `server/db/migrate.js` have an empty diff.

---

## Why this phase exists

A11.1 shipped and the first real production recommendation was generated and
inspected. The intelligence behind it was right. The card was not: the facts a
consultant checks first sat below the prose, the three long layer explanations
were permanently expanded and repeated what the summary had already said, and
the default view carried sentences like *"0.5276 against a median of 0.5635"*.

Everything below is a change to what is shown and in what order. Nothing
changes what is true.

---

## 1. The card, in order

| | |
|---|---|
| **A. Header** | rank, school, division, band, relationship/outreach chips, Pursuit |
| **B. Three primary scores** | Coach recruitability · Financial viability · Athlete opportunity — as before |
| **C. Quick programme snapshot** | Program Strength · Academic Rating · Conference · Net price, then projected departures `GK 0 · DEF 1 · MID 2 · FWD 0` and `View players` |
| **D. Why this school ranks here** | three leading reasons plus any financial caveat, in plain language |
| **E. `View detailed reasoning` ▾** | **collapsed by default** — the full three-layer evidence in the engine's own words |

`H1` asserts B → C → D in document order, by `compareDocumentPosition` rather
than by string index, so it cannot pass on a coincidence of wording.

### Conference and net price were kept

§1C names three things. Conference and net price shipped in A11, are factual,
and are what a consultant reaches for next. Deleting information to tidy a
layout is not a presentation refinement, so they stay on the same row.

---

## 2. Plain language — `src/lib/plainReasons.js`

A second **wording** of the same reason, not a second opinion.

```
KEYED BY CODE, NEVER BY SCORE
  Every entry is selected by the reason's own `code` and reads the same
  `evidence` object `render.js` reads. Nothing looks at Pursuit, a layer
  value, or a rank. Writing prose from a number is the reverse-engineering
  A11 was told not to do.

A BANDED CLAIM IS BANDED FROM THE EVIDENCE
  The brief offers "the competitive level is very close to the athlete's
  stated target" as the wording to aim for. That is true at a three-point gap
  and FALSE at a thirty-point one. The engine's number carried the magnitude;
  drop it and the adverb has to. `LEVEL_PREFERENCE_BELOW` reads
  `levelGapBelow` and says "very close to" (<= 0.05), "a little below"
  (<= 0.15) or "below". `B2` asserts a 34-point gap never reads as "very
  close" — the failure that would matter.

UNCERTAINTY SURVIVES
  "Assessed", "estimated", "detected", "suggests" are load-bearing and kept.
  A plain sentence that reads more confidently than the engine's is a defect.

SILENCE IS NOT AN OPTION
  A code with no plain wording falls through to the engine's sentence
  unchanged. No reason is ever dropped for lacking a paraphrase.
```

Nine codes have a plain wording: the two `PLAYING_SHARE_*`, the three
`ATHLETIC_*_REACH`, `LEVEL_PREFERENCE_BELOW`, `LEVEL_ANCHOR_APPLIED` and the
two `ABSOLUTE_PRIORITY_*`. Everything else is already plain and is printed
exactly as the engine wrote it.

### The numbers did not go anywhere

The summary uses the plain register; **detailed reasoning renders the engine's
exact sentence, figures and all**. `P1` asserts no raw decimal in the default
view; `P3` asserts `0.5276` and `0.5635` are present once the disclosure is
open. Same finding, two levels of detail — which is why showing both expanded
at once was the thing §6 objected to.

### Financial caveats are hoisted, not ranked

`AID_KNOWN_NONE` and `INTERNATIONAL_COST_UNDERSTATED` are `context` polarity
and sit fourth or lower. A D3 scholarship limitation is not a footnote to a
family budgeting four years of fees, so `summaryView` appends every financial
caveat after the leading three rather than letting ordering bury it. `P4`
asserts both appear **in the default view**, not merely somewhere on the page.

---

## 3. Projected departures

Unchanged semantics, new shape. One wrapping line with §3's labels:

```
GK 0 · DEF 1 (1 starting) · MID 2 (0 starting) · FWD 0
```

`openings` is every place eligibility vacates; `(n starting)` is the subset
that were starting places, and only that subset is scored.

**Unknown is still never zero.** Each position carries a state from the server
and the component renders the state: `MEASURED` prints the count including a
real zero; `NO_ROSTER`, `NO_ELIGIBILITY_RULE` and `INSUFFICIENT_EVIDENCE` print
`Not established` and a note that says the gap is Thriv3's, not the
programme's. §3 permits an em dash where layout demands one; the words were
kept, because a dash in a row of numbers is read as a zero by exactly the
person this protects. `V3` asserts an unknown cell contains no digit at all.

### View players

A nested disclosure, closed by default, names grouped by position, each marked
`started` or `starting role not established`. **No control at all when no
identities are available** — `V2` asserts the button is absent, not disabled,
because a disabled control invites a click that can never work and reads as a
product fault rather than a gap in the evidence.

---

## 4. Detailed reasoning

One `Disclosure`, closed by default, label inverting to `Hide detailed
reasoning`. It is a real `<button type="button">` carrying `aria-expanded` and
`aria-controls`, and `D5` asserts the id it names is the body that appeared.

`D4` asserts opening it issues **no further fetch** — the explanation is
already in memory from the card expansion.

Nothing was deleted: `D3` walks all three layers and asserts each still
answers from its own reasons.

---

## 5. Tests

| file | tests | covers |
|---|---|---|
| `src/components/matchmaking/cardHierarchy.test.js` | 22 | §1, §3, §4, §6, §7, §8, §9 |
| `src/lib/plainReasons.test.js` | 15 | §2 — banding, caveats, fallthrough |
| `src/components/matchmaking/matchExplanationUi.test.js` | 27 | A11, with `X2` updated |

### The production example, without the athlete

`cardHierarchy.test.js` reproduces the observed card exactly: Pursuit 77 over
65 / 100 / 83, partial evidence, NCAA D3, already a Specific School and already
written to, with athletic alignment, cost inside the contribution, one
defensive opening, an international recruiting record, the D3
athletic-scholarship limitation and a positive academic reading. The numbers
and reason codes are the production shape; the institution, the players and the
athlete are invented. **No athlete identity is encoded.** `scan:committed-pii`
is clean.

### One updated assertion, and it is not a regression

`X2` asserted the three layer sections were present on a freshly expanded card.
They are now behind the disclosure §1E asks for, so `X2` opens it first and
additionally asserts the collapsed default. Substance unchanged.

### Mutation testing

Seven mutations, every one caught:

| mutation | caught by |
|---|---|
| drop the financial-caveat hoist | `P4`, `S1`, `S3` |
| `nearness()` always returns "very close to" | `B2` |
| detailed reasoning open by default | `D1`, `P1` + 4 more |
| snapshot moved below the explanation | `H1` |
| `View players` always rendered | `V2` |
| unknown departures render the bare number | `V3`, `G3`, `G4`, `G5` |
| restore the bad `strength` fixture value | `P3b` |

---

## 6. What the browser found that the tests did not

Verified at 375, 768 and desktop against a throwaway Vite entry rendering the
card alone — no API server, no database, no authentication. The harness was
deleted afterwards and is not in this branch.

**Two real defects, both found by looking:**

1. **`Top 70% in NCAA…`** — the snapshot value carried `truncate`, and at 375px
   it clipped the division. A percentile without the division it is relative to
   is the national `/10` problem in a new costume, which is the whole reason
   A11.1 replaced it. `truncate` is now opt-in and only Conference takes it.
   Pinned by `W3`.

2. **`measured undefined`** — a fixture carried `strength: 'RECENT'`, which is
   not one of the renderer's `SEASONS` keys, and every assertion still passed
   because each looked for something that *was* there. Fixtures corrected to
   `LIMITED`, and `P3b` now asserts no rendered sentence contains `undefined`,
   `NaN` or `[object Object]`. Verified to fail when the bad value is restored.

At 375px the snapshot is two columns and the departures row wraps; from `sm`
both are four across. No horizontal scroll at any width, and no console errors.

### And one the import boundary found

`plainReasons.test.js` first imported `shared/matching/v2/explain/render.js`
directly, to compare the plain wording against the engine's. `src/` may reach
V2 only through `src/lib/matchmakingV2View.js`, and the boundary guard failed
the run. The allowlist was NOT widened: the test now takes `reasonSentence`
through the approved doorway, which is also the better assertion — it compares
the plain wording against the sentence the app would actually show, rather than
one the test reached past the boundary to fetch.

---

## 7. Regression

| gate | result |
|---|---|
| freeze guard + import boundary | **17/17** |
| `shared/matching/` diff vs main | **empty** — tree `756c8108` |
| `schema.sql` / `migrate.js` diff | **empty** |
| A11.2 suites | 22 + 15 |
| A11 suite | 27 |
| A10 Specific Schools | 32 |
| server boot | 1 |
| `scan:committed-pii` | clean |

Full suite: **10,767 passing · 3 known failing · 198 skipped**. The three are
the long-standing `campaignSnapshot` ×1 and `rosterTargetUniverse` ×2,
confirmed by running those two files alone and getting exactly three. **0 new.**
+37 over the 10,730 baseline is exactly this phase's new tests.

---

## 8. Remaining

Neither is a blocker.

1. **The summary runs to five statements on this card, not three.** §1D asks
   for roughly one to three; §2 requires financial caveats to survive. Those
   pull against each other, and the resolution is three ranked reasons plus the
   caveats — five here, three on a programme with no caveats. Reducing it
   further means dropping a caveat, which is a product decision, not a layout
   one.

2. **The renderer prints `measured undefined` for an unrecognised `strength`.**
   Found through a bad fixture, not a bad scorer, and fixing it would mean
   editing explanation generation, which this phase is forbidden to touch. The
   UI guard (`P3b`) catches it at the surface. Worth a line in a future engine
   phase.

**Not merged. Not deployed. No production run regenerated. 7B untouched. V2 not
tuned.**
