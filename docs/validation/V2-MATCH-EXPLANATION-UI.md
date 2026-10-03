# A11 — Match explanation and outreach intelligence

| | |
|---|---|
| branch | `feature/v2-match-explanation-ui` |
| from | `41205ae` (main) |
| freeze guard | **17/17** |
| `shared/matching/` | **byte-identical to main** — tree `756c8108266d3e0e389c4fd461852be0fec04a23` |
| schema | one additive nullable column: `matchmaking_programme_results.explanation` |
| A11.1 | product decisions applied — see §13 |
| verdict | `A11_MERGE_READY` |

---

## 1. Source inventory (§2)

Traced before any UI was written. Several answers were not what the brief assumed.

### A. V2 programme result

Persisted per programme in `matchmaking_programme_results`: `status`, `rank`,
`pursuit`, `pursuit_grade`, and for each of the three layers a `value`,
`grade`, `coverage` and a `reason` **that is only populated when the layer
could not be scored**.

**The gap this exposed.** A scoreable layer persists a number and no reason, so
*why* a layer read as it did could not be recovered from storage at all. The
basis objects the scorers produce — the geographic spread, the cost comparison,
the openings — never reached the table. §9 said to stop and name the missing
explainability data rather than reverse-engineer a story from the score; this
is it, and §7 below is what was done about it.

### B. Programme strength — a genuine rating, with a caveat

| | |
|---|---|
| column | `colleges.soccer_score`, 0–100, **2,284 of 2,627** populated |
| `colleges.rating` | **0 of 2,627 populated** — the column exists and is entirely empty |
| V1 presentation | `program_quality_rating = soccer_score / 10`, shown as "Program Rating X/10" since long before V2 |

**It is a national ladder, and division dominates it.** Measured:

| division | range | mean |
|---|---|---|
| NCAA D1 | 55–100 | 73.9 |
| NCAA D2 | 38–74 | 55.2 |
| NAIA | 32–66 | 49.1 |
| NCAA D3 | 25–58 | 41.3 |
| NJCAA | 15–45 | 31.1 |

The best D3 programme (58) scores below the weakest D1 (55). So "Program Rating
4.1/10" on a good D3 school is mostly saying "is D3".

**The codebase already knows this.** `shared/matching/criteria.js` says so in
`programQuality()`: it deliberately scores a *percentile within the divisions
the athlete selected* "so a D3 athlete is not told every school is weak", and
notes that exposing `soccer_score / 10` conflated level with fit.

**A11 kept V1's label and flagged it. A11.1 ruled it out for this surface.**

**`soccer_score / 10` is NOT shown in the V2 expanded card.** What is shown is
the programme's percentile **within its own (sport, division)**:

> **Program Strength** — Top 15% in NCAA D3

| | |
|---|---|
| source | `colleges.soccer_score`, ranked within `(sport, division)` among active programmes |
| rule | `percentileWithin` in `server/lib/v2/programmeContext.js` — ties share the **lower** rank |
| provenance | the same rule as V1's `qualityPercentiles` (`shared/matching/pool.js`), which V1 applies to the athlete's selected divisions "so a D3 athlete is not told every school is weak" |
| cohort | the programme's **own** division, because the sentence names it and must be checkable |
| unavailable | `Not established` — never a fabricated band |
| from display rank | **never** — the percentile is over the stored score, not over the list |

**It is a descriptive statistic, not scoring.** It ranks an existing stored
column within an existing stored grouping, is not persisted in any run, and
feeds nothing. No weight, gate or layer value moved.

**Why the rule is copied rather than imported.** `shared/matching/pool.js`
imports `score.js`, `weights.js` and `couplings.js` — all three on the V2
import boundary's forbidden list. Importing it would pull V1's scorer into the
V2 serving graph to borrow ten lines of arithmetic. `S1` asserts the two
implementations agree exactly, ties included, so there is one behaviour and a
proof of it.

Measured on the real corpus (men's soccer, cohort = active programmes with a
score in that division):

| programme | division | shown |
|---|---|---|
| Judson University | NAIA | Top 40% of 185 |
| Lindenwood | NCAA D1 | Top 49% of 213 |
| Catawba | NCAA D2 | Top 43% of 202 |
| Millikin | NCAA D3 | Top 70% of 316 |

**Academic Rating stays `X/10`**, because the inventory proves that semantic:
`academic_rating` is a 1–9.9 institutional measure from College Scorecard and
is *not* division-dominated (D1 6.18, D3 5.94, D2 4.03).

### C. Academic strength — a genuine 0–10 rating

`colleges.academic_rating`, **2,314 of 2,627** populated, range 1–9.9, mean
4.95, and **not** division-dominated (D1 6.18, D3 5.94, D2 4.03). Sourced from
`scorecard-v1` (2,138) and `scorecard-njcaa-v1` (145).

**Two source values are not ratings** and are suppressed to `—`:
`placeholder` (27) and `no College Scorecard match for this institution` (19).
Printing those as "3.1/10" would present our own gap as a measurement of the
institution.

### D. Graduating-player evidence — two mechanisms, and only one works

| | `graduating_seniors` (V1) | `roster_players` + eligibility (V2) |
|---|---|---|
| men's soccer | 845 rows with totals | 32,004 rows, 28,567 with eligibility |
| **women's soccer** | **1,113 rows, every total NULL, zero names, zero position data** | 35,096 rows, 32,869 with eligibility |
| position breakdown | 774 rows, **none of them women's** | all |
| used by V2 | no | **yes** |

**V2's mechanism is used**, for three reasons: it is what Athlete Opportunity
actually scores, it is more precise (eligibility expiry, not class label), and
`graduating_seniors` is **completely empty for women's soccer** — a UI built on
it would have shown 1,113 women's programmes a confident `0`.

Semantics, from `server/lib/v2/rosterEvidence.js`:

- a player's **last season** is their eligibility *ceiling*, derived from the
  class label under the division's rule. A D1 senior in 2026 has a year of the
  five-year window left and is **not** an opening for 2027; a D3 senior is.
- `openings` — all places vacated (`lastSeason < entryYear`). Context.
- `vacatedStarters` — those that were **starting** places. **The only scored
  departure term.**
- `eligibleToRemain` — `lastSeason > entryYear`. Never a confirmed return.
- `lastSeason === entryYear` counts as neither: they are there *for* the entry
  year.
- `entryYear` is the **athlete's `recruiting_class_year`**, never the corpus
  season. Counting against the roster's own season asks "who left before this
  year's squad", which is approximately nobody — see §8.

### E. Specific Schools indicators

| indicator | canonical source |
|---|---|
| Requested / withdrawn | `athlete_programmes.request_state` |
| Not in Top 100 | `athlete_programmes.visibility = 'suppressed'` |
| Manual outreach only / Do not contact | `athlete_programmes.contact_stance` |
| Flagged + reason | `athlete_programmes.flagged`, `flag_reason` |
| Note | `athlete_programmes.note` |
| Sent / Sent ×N / Drafted / No contact recorded | contact intelligence → `contactStateShort()` |
| Reply recorded / Profile visit | contact intelligence → `engagementShort()` |

All of them already existed. **Nothing new was invented to populate the UI.**

## 2. Page order (§3)

```
1  GENERATED + Refresh matches                    [run-bar]
2  RANKING PREFERENCES + Edit inputs              [active-preferences]
3  [Top 100] [Full Universe] [Specific Schools]   [matchmaking-tabs]
4  tab content, including pagination              [role=tabpanel]
5  WHY SCHOOLS ARE RANKED THIS WAY                [why-ranked]
```

"Why schools are ranked this way" moved from above the tabs to below the
results. Asserted by `compareDocumentPosition`. A10's `I1` was updated — not
weakened — to the new order, and quotes the reason.

## 3. Status chips (§4, §10)

One derivation in `src/lib/programmeStatus.js`, rendered by
`ProgrammeStatusChips`, used by Top 100, Full Universe and Specific Schools.
**There is no parallel status system**; the three surfaces call one function.

- **Joined on canonical identity.** `contactIntelligenceKey(college_name, sport)`
  for contact history; the relationship map is the workspace's own. A
  display-name join would attach a women's programme's outreach history to the
  men's card of the same name — asserted by `C4`.
- **No empty chips.** A programme with no relationship and no history renders
  no element at all, which is most of a hundred-row list.
- **"Campaign may contact" is not a chip.** It is the ordinary state of all
  1,205 programmes; printing it everywhere is the badge soup §12 forbids.
- **"No contact recorded" is not a chip on a ranked list** — it is the answer
  for nearly every row, and its absence says it. It remains on Specific
  Schools rows, where the question is live.
- **Unknown is not none.** Contact chips render only once the history has
  actually loaded (`contactKnown`), never as a default.

## 4. Expanded card order (§5)

1. **Coach recruitability / Financial viability / Athlete opportunity** — the
   three layer readings, first and unchanged.
2. **Programme context** — Program Rating, Academic Rating, Conference, Net
   price. `—` where never established; **never 0**.
3. **Places opening**, by position.
4. **Why this school ranks here**, then the per-layer explanations.

## 5. Graduating players (§6)

Counts only by default, four positions, two-column at 375px and four from `sm`.
Every position carries a **state**, and the component renders the state:

| state | rendered |
|---|---|
| `MEASURED` | the number, including a real `0` |
| `NO_ROSTER` | **Not established** + "Thriv3 holds no roster for this programme" |
| `NO_ELIGIBILITY_RULE` | **Not established** + "Thriv3 holds no eligibility rule for this association" |
| `INSUFFICIENT_EVIDENCE` | **Not established** + "too few rows could be read" |

`G2` asserts an evidenced zero renders as `0` and **not** as "Not established";
`G3` asserts a no-roster programme renders "Not established" and **no digit at
all**. Both notes are statements about Thriv3, not about the programme.

"View graduating players" opens a second disclosure with names, class year, and
whether each one started — so a reader can see which of them counted toward the
scored term. `starterKnown: false` prints "starting role not established"
rather than claiming either way.

## 6. Explanation architecture (§7, §8, §9)

**The engine already had this and nothing served it.** `explainProgramme`
produces `{ reasons, layerReasons, standing, … }` from the basis objects, is
documented and tested as recomputing nothing, and was used only by the
validation pack.

So A11 **captures it with the run**:

```
POST /players/:id/matchmaking   →  computeMatchmakingV2(..., { withExplanations: true })
                                →  persistRun stores it per programme row
GET  …/matchmaking/programme    →  serves it for the one card that was opened
```

No model call at render time, no stochastic prose, no recomputation of Pursuit.

**Why captured rather than derived later.** An explanation computed today
describes today's corpus; the rank beside it came from the run's corpus. The
two are allowed to disagree and the screen would show both without saying so.

**Proof it is a read, not an input:** the same athlete scored with and without
explanations produces an **identical `resultDigest`** (`X-S1`), and every rank
and status matches position for position.

**Storage, bounded to the Top 100 by A11.1 §3.** Trimmed before writing:
`layerReasons` is dropped (the same objects as `reasons`, regrouped at read),
and `gateEffects`/`evidenceQuality` are dropped because `render.js` marks them
`CLIENT_UNSAFE`. Then explanations are persisted **only for ranked programmes
with `rank <= TOP_N`**.

| | per run |
|---|---|
| A11, all 1,205 programmes | 3.6 MB |
| **A11.1, ranked Top 100 only** | **361 KB over exactly 100 rows** |

Measured on the same corpus and athlete. `SUPPORTED_LIMITED_DATA` and
`UNSUPPORTED_ASSOCIATION` get none — a programme with no ranking has no
ranking to explain, and generating prose "for UI completeness" would be
manufacturing an explanation of a rank that does not exist.

**The bound costs prose, never standing.** The full universe is still
persisted — 1,205 result rows — and a #101 programme keeps its rank, band,
Pursuit, all three layers and its evidence state. `T8`, `T9` and `T10` assert
exactly that, and `resultDigest` is unchanged (`T7`).

**Explanations are NOT in the list payload.** `runs/current` stays at **554 KB**
and carries none; the per-programme route serves the one that was opened.

**Two different absences, two different sentences — A11.1 §2 and §4.**

| case | rendered |
|---|---|
| run predates A11 | *"Detailed explanation not available for this run. Refreshing the matches will produce one."* |
| ranked #101+, or not ranked | *"Detailed explanation is available for Top 100 recommendations."* |

The difference is actionable: a legacy run **can** be refreshed into one that
has explanations; a programme outside the bound cannot, and telling an operator
to refresh would send them to do something that cannot work. `X3` and `X3b`
assert each message appears only in its own case.

**No legacy run is backfilled, rewritten or reverse-engineered.**

### Example sentences, rendered from real codes

| layer | code | sentence |
|---|---|---|
| Recruitability | `ATHLETIC_AT_OR_ABOVE_LEVEL` | "The athlete's assessed level sits at or above this programme's, so they are within the standard it recruits at." |
| Financial | `COST_WITHIN_BUDGET` | "The estimated annual cost of $19,638 is within the family's stated maximum annual contribution of $20,000." |
| Opportunity | `POSITION_OPENING_MEASURED` | "Roster evidence shows 1 starting midfield place opening for the entry year, against 4 typically held." |

A code with no wording renders **nothing**, never its own identifier. A layer
with no reasons says it holds none.

**Prohibited claims.** `X4` asserts none of the engine's own
`FORBIDDEN_LANGUAGE` — "guaranteed", "the coach wants", "will offer", "expect a
scholarship", "odds of" — nor the A8.2 absent-major phrasings can render.
`X5` asserts no weight or formula is exposed.

## 7. Performance (§11)

| | |
|---|---|
| context read | **one request per page of 20**, never per card (`R4`) |
| explanation | fetched **only on expand** (`R5`), ~3 KB |
| `runs/current` payload | **554 KB**, unchanged |
| explanation marginal compute | warm run 30–37 ms → 37–42 ms (**+~7 ms**) |
| context, warm pool cache | **0 ms** (cached by A9.7B) |
| scoring recomputation | **none** |

Requests are capped at `TOP_N` names and a longer list is **refused** rather
than truncated, because a quiet truncation hides a caller bug.

## 8. Three real defects found while building this

Recorded because each produced plausible-looking wrong output rather than an
error:

1. **`entryYear` defaulted to the corpus season.** Departures were counted
   against the roster's own year, so every programme showed `0 openings`
   everywhere. Caught by the result looking too uniform to be true. There is
   now no default: the athlete's entry year is required or the call throws.
2. **`eligibilityCeiling` returns an object, not a number.** Comparing it to
   the entry year was always false, so the names list was empty beside a count
   saying two were leaving. Caught by that disagreement; `P5` now asserts
   counts and names match for every measured position.
3. **The roster was queried at the entry year** instead of its own season,
   which asks for a roster nobody has published. Same symptom, same test.
4. **The server could not boot at all**, and the whole suite passed anyway.
   The route imported `TOP_N` from `matchmakingService`, which imported it
   without re-exporting it; Node's ESM loader rejects that at instantiation.
   **Vitest did not catch it** — it transforms through Vite, whose interop is
   more forgiving than Node's, and several suites import that very router.
   Caught only by starting the real server for the browser check.
   `server/serverBoots.test.js` now starts the real entry point under the real
   loader, and fails if the export is removed again.

## 9. Tests (§13) and mutations (§14)

**New: 41.** `matchExplanationUi.test.js` (25), `programmeContext.test.js` (8),
`runExplanations.test.js` (7), `serverBoots.test.js` (1). Two A10 assertions updated, both quoting what
changed.

Seven mutations, each caught:

| mutation | caught by |
|---|---|
| unknown graduating count rendered as zero | 3 failures (`G3`, `G4`, `G5`) |
| a relationship chip inferred without a source | `C2` |
| status join falls back to the display name | `C4` |
| the UI mapper double-maps Pursuit | `R1` |
| an unestablished academic rating reported anyway | `R2` |
| departure names resolved by a drifting predicate | `P5` |
| explanations become an input to the digest | `X-S1` |

**Two tests were too weak and were strengthened, both found by mutation:**

- `R1` asserted `not.toMatch(/\b\d{4,}\b/)` and survived a deliberate
  double-mapping, because the card renders `Pursuit6700Partial` — letters
  either side of the digits, so `\b` can never match. It now reads the number
  and asserts it is ≤ 100.
- The academic-source suppression had no test until `R2` was written against it.

## 10. Unknown vs zero — the summary

| surface | unknown renders as | zero renders as |
|---|---|---|
| Program / Academic Rating | `—` | the number |
| Graduating counts | **Not established** + the reason | `0` |
| Status chips | no chip | no chip |
| Explanation | "none stored for this run" | — |
| Layer with no reasons | "no recorded evidence" | — |

## 11. Rollback

`?matching=v1` is untouched and asserted. The schema change is additive and
nullable, so main's code reads an A11 database and an A11 build reads a
pre-A11 database — the latter shows "no explanation stored", which is true.
Reverting the branch requires no data migration.

## 12. Production transition proof (A11.1 §5) — a merge blocker

`server/db/a11Transition.test.js`, 11 tests. It builds a genuinely **pre-A11**
database — the `explanation` column physically dropped with
`ALTER TABLE … DROP COLUMN`, which is what makes this an upgrade test rather
than a tautology — fills it with a persisted V2 run, programme results and a
Specific School, and then migrates.

| assertion | result |
|---|---|
| column absent before, present after | ✓ |
| every scoring value on the legacy run, unchanged | ✓ (field-by-field) |
| legacy run still readable | ✓ |
| legacy `resultDigest` unchanged | ✓ |
| legacy run carries **no** explanation — nothing backfilled | ✓ |
| API answers `null`, UI states it | ✓ |
| Specific Schools unchanged | ✓ |
| `integrity_check` / `foreign_key_check` | ok / 0 |
| migrate ×2 more — idempotent, still no backfill | ✓ |
| NEW run: digest identical with explanations on/off | ✓ |
| NEW run: full universe persisted (1,205 rows) | ✓ |
| NEW run: explanations for ranked Top 100 and nothing else | ✓ |
| #101+ keeps rank, band, Pursuit, layers; only prose absent | ✓ |
| older run still readable after a newer one exists | ✓ |

## 13. Server boot regression guard (A11.1 §6)

`server/serverBoots.test.js` is **permanent**. It starts the real entry point
under Node's own ESM loader with `RECRUITMATCH_DB=':memory:'` and `PORT=0`, so
it cannot reach any real database or bind a real port; it exits immediately on
success and is bounded at 60 s (90 s test timeout).

It exists because **the whole suite passed while the server could not boot**.
Vitest transforms through Vite, whose interop accepted a named import that Node
rejects at instantiation. Only starting the real server found it. Verified to
fail when the export is removed again.

## 14. Product and data decisions still required

1. ~~"Program Rating" is a national ladder.~~ **Decided in A11.1 §1** — the V2
   card shows a division-relative percentile. V1's own surfaces still show
   `Program Rating X/10`; that was out of scope here and is unchanged.
2. **Explanations exist only for runs generated from now on.** Existing runs —
   including the production one — carry none until an operator refreshes that
   athlete's matches. Regenerating production runs is a rollout action and was
   not taken.
3. ~~3.6 MB of explanation per run.~~ **Decided in A11.1 §3** — bounded to the
   ranked Top 100, measured at **361 KB**. The accepted cost: a Specific School
   ranked #101+ shows its full standing and no prose.
4. **Women's soccer has no `graduating_seniors` evidence at all.** A11 does not
   depend on it, but anything else that reads that table is silently empty for
   half the corpus.
