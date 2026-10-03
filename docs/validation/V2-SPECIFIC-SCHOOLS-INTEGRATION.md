# A10 — Specific Schools under V2, and the Analysis & Matching information architecture

| | |
|---|---|
| branch | `feature/v2-specific-schools` |
| from | `340e628` (main) |
| freeze guard | **17/17** — 11 freeze + 6 import boundary, unchanged |
| engine | **untouched.** `shared/matching/` is byte-identical to main |
| schema | **no migration.** `schema.sql` and `migrate.js` are not modified |
| production preservation baseline | **100** rows (read-only check, pre-merge) |
| verdict | `V2_SPECIFIC_SCHOOLS_READY` |

---

## 1. The finding that shaped the phase

**There is nothing to migrate.** Specific Schools has always been
`athlete_programmes` — one canonical row per `(athlete_id, college_name, sport)`
with `UNIQUE` enforcing it — and that row already carries every consultant
decision:

| column | what it holds |
|---|---|
| `request_state` | `none` / `requested` / `withdrawn` — **membership of Specific Schools** |
| `requested_by` | `athlete` / `family` / `operator` |
| `flagged`, `flag_reason` | the flag |
| `visibility` | `default` / `suppressed` — **"Remove from Top 100"** |
| `contact_stance` | `default` / `manual_only` / `do_not_contact` |
| `note`, `note_updated_at` | the operator's note |

V1 reads those rows through `useAthleteProgrammes` → `GET /api/players/:id/programmes`.
**So does V2.** Both tabs are views over one row, which is what §E asked to
prefer and is strictly stronger than a migration: there is no second store, so
there is no copy to go stale, no identity to re-map, and no count that can come
out at 98.

### What the production inventory actually showed

Read-only, from a WAL-consistent `VACUUM INTO` copy. **The local development
database contains no Specific Schools and no V2 run at all:**

| table | rows |
|---|---|
| `athlete_programmes` | **0** |
| `matchmaking_runs`, `matchmaking_programme_results`, `matchmaking_selections` | **0** |
| `outreach` / `outreach_send` | 96 / 41 |
| `players` | 4 (3 carrying a V1 `recommendations` path) |

The records and the first production run live in the Render `/data` volume,
which is not readable from the development environment. **This was stated
rather than worked around**: the preservation claim does not rest on having
counted them, it rests on the architecture — V2 reads the same rows V1 reads.

### The production count, closed (READ-ONLY)

The gap above was closed by a **read-only** check against the production
database before merge. For the preservation-baseline athlete:

| | |
|---|---|
| `athlete_programmes` rows | **100** |
| `request_state` populated | **100** |
| `visibility` populated | **100** |
| `contact_stance` populated | **100** |
| `note` populated | **0** |

**The authoritative pre-deployment preservation baseline is 100.**

#### Why 100 and not 99

The 99 recorded earlier in this document was the count observed in the UI
*before* the production Specific Search smoke test. That test exercised the
add path, which upserts one `athlete_programmes` row — so the extra record is
the smoke test's own result and is a correct outcome of the workflow, not a
duplicate and not drift. **It must not be reduced back to 99.** The `UNIQUE
(athlete_id, college_name, sport)` constraint is what makes a repeated add
idempotent, which is why the count moved by exactly one.

Three things follow, and all three are the properties this phase was built on:

- **Every row carries its operator state.** `request_state`, `visibility` and
  `contact_stance` are populated on all 100 — nothing is half-written.
- **`note` is 0 across the set, and that is the truth about it**, not a loss.
  Notes are optional and none has been written for this athlete. A migration
  would have made that number ambiguous; reading the same rows cannot.
- **The fixture scale was right.** The 99-record fixture in the test suite
  exercises the same order of magnitude as production, and the behaviours it
  pins — nothing dropped for being outside the Top 100, LIMITED_DATA,
  unsupported, or absent from the run — are exactly what a 100-row list needs.

No production data was read beyond these counts, and no production data was
written. The athlete is referred to here by role rather than by name.

## 2. V1 capability inventory (§B)

| V1 feature | storage | action | side effect | V2 requirement | status |
|---|---|---|---|---|---|
| Specific Search / add | `athlete_programmes` | `POST /players/:id/programmes` upsert | one row, idempotent | reuse unchanged | **carried** |
| Details (expand) | — | local state | **no request** | reuse | **carried** |
| Create Email Draft | `outreach`, `outreach_send` | opens `ManualOutreachDialog` | none on open | reuse unchanged | **carried** |
| Manual Outreach Only | `contact_stance` | `PATCH …/programmes/:id` | campaign skips it | reuse | **carried** |
| Allow Campaign Outreach | `contact_stance` | `PATCH` back to `default` | campaign may write | reuse | **carried** |
| Do not contact | `contact_stance` | `PATCH` | nothing may write | reuse | **carried** |
| Remove from Top 100 | `visibility` | `PATCH` | excluded from campaign targets (`campaigns.js:947`) | reuse — see §4 | **carried** |
| Remove (withdraw) | `request_state` | `PATCH` to `withdrawn` | **no delete** | reuse | **carried** |
| Flag / reason | `flagged` | `PATCH` | surfaced on the row | reuse | **carried** |
| Note | `note` | `PATCH` | surfaced on the row | reuse | **carried** |
| Draft confirm / discard | `outreach_send` | `POST …/confirm-sent` / `/discard` | state change | reuse | **carried** |
| Contact intelligence | derived | one athlete-level read | none | reuse | **carried** |
| V1 rank beside a row | the V1 analysis JSON | array position | none | **replaced** by the persisted V2 rank | **changed, deliberately** |

The last row is the one intentional divergence. Under V2 a row's rank is the
persisted run's rank, not a position in V1's `recommendations` array — two
engines' answers for one school, shown side by side, is the point at which a
consultant stops trusting both.

## 3. V2 enrichment (§D)

Each row is enriched from the run **already on screen**. `src/lib/matchmakingStandings.js`
indexes `run.programmes` by `(college_name, sport)` and answers with the run's
own object: rank, band, pursuit, the three layers, grades, coverage, evidence
state. It computes nothing and calls nothing.

**Identity is exact.** A near-miss (`lindenwood`, `Lindenwood University`,
trailing space) is reported as a miss, not resolved — a fuzzy match turns a real
identity defect into a confident wrong answer attached to someone else's rank,
which is the Belmont Abbey / Belmont failure recorded in `server/lib/schoolMatch.js`.

**A miss is surfaced, never dropped** (§N). `UNMATCHED` is a real answer, and it
renders the existing "in the registry but not part of this athlete's evaluated
universe" panel. Three different facts arrive there — outside the pool, a sport
mismatch, a drifted stored name — and none of them removes the row.

### The bug this caught

`useMatchmakingV2` stores `runView(payload)`, so the panel's programmes are
**already mapped**. `MatchmakingProgrammeStanding` maps again for its other
caller (Specific Search, which passes raw API output). Applying `programmeView`
twice renders a pursuit of 90 as **"9000"** and reports three measured layers as
**"Not established"** — neither throws, both look like data. Found in the
browser against a seeded run, not by the first version of the tests here, which
asserted only rank, band and status, all of which survive it. Fixed with an
explicit `viewed` prop and pinned by `N5b`, which fails if the fix is reverted.

## 4. "Remove from Top 100" (§G)

The separation §G asks for **already existed** and is reused unchanged:

- **Model rank** lives in `matchmaking_programme_results` and is immutable.
- **Operational outreach set** is `visibility`, read by `campaigns.js:947`.

Setting it writes `visibility` **and nothing else** — asserted field-by-field
against the whole row, not by spot-check. It is reversible. The run still says
`#1`; the programme is still on the consultant's list, badged `Not in Top 100`.
No route under `/matchmaking` is called.

## 5. Information architecture (§I, §J, §K, §L, §M)

```
1  GENERATED + Refresh matches          MatchmakingRunBar      [run-bar]
   (a refusal or failure reports here, under the control that caused it)
2  RANKING PREFERENCES + Edit inputs    MatchmakingPreferences [active-preferences]
3  WHY SCHOOLS ARE RANKED THIS WAY      MatchmakingWhyRanked   [why-ranked]
4  [Top 100] [Full Universe] [Specific Schools 99]             [matchmaking-tabs]
5  selected tab content                                        [role=tabpanel]
---
   Selections overview — BELOW the list, no longer above it
```

Asserted by `compareDocumentPosition`, not by child index: what is fixed is the
reading order, not a DOM shape.

**Three things were moved out of that sequence:**

1. **The floating Specific Search button** → into the Specific Schools tab (§H),
   which is where the list it adds to lives.
2. **`SelectionsOverviewPanel`** → below the tabs. Its empty state —
   *"No programme has been selected for outreach yet"* — sat between the run and
   the ranking, so the first thing the page said about a 1,205-school analysis
   was that nothing had been chosen from it. It still renders; it is true and
   useful after the list rather than instead of it.
3. **The link to V1** (*"Requested schools & outreach (previous engine)"*) →
   removed. See §9.

**Why schools are ranked this way** names the three layers using the frozen
`LAYER_LABEL` vocabulary and restates both non-ranked states using the frozen
`STATUS_PRESENTATION` text, including each one's `note` — the clause that stops
"unranked" being read as "unsuitable". It prints **no weight and no formula**;
`L1` fails on any of `0.5`, `0.2`, `0.3`, `50%`, `20%`, `30%` or the word
"weight", because a weight on a page reads as a setting, and changing one is a
frozen-file change needing a named justification class.

## 6. Performance (§S)

Measured in the browser against a seeded run (122 programmes, 99 specific
schools), after the first mount:

| | time | API calls |
|---|---|---|
| Top 100 | **3.1 / 4.7 ms** | **0** |
| Full Universe | **13.8 ms** | **0** |
| Specific Schools (99 rows) | **35.1 / 33.4 ms** | **0** |
| Specific Search — registry lookup | 209 ms | 1 |
| Specific Search — standing | **12.5 ms**, 0.6 KB | 1 |

**Per-programme standing requests for 99 rows: zero.** No batch endpoint was
needed, so none was built. The only cost of opening the tab is the two bounded
athlete-level reads V1 also makes — contact intelligence and pending drafts,
~9–11 ms each. The run is fetched **once** per mount and shared by all three
tabs; switching tabs issues no request at all, which is also the proof that
**no tab switch recomputes anything**.

## 7. Migration (§Q)

**This phase changes no schema.** `git diff --name-only` touches neither
`schema.sql` nor `migrate.js`. Run anyway, against a WAL-consistent copy of the
development database, **three times**:

| | |
|---|---|
| tables | 53 → 55 |
| added | `corpus_revision` (1), `recruiting_observations` (0) — **both from the A9.6/A9.7B merge, not from A10** |
| removed | none |
| existing tables with changed row counts | **0** |
| `integrity_check` | ok |
| `foreign_key_check` | **0** violations |
| V1 `recommendations` pointers | 3, unchanged |
| `outreach` | 96, unchanged |
| runs / selections | 0 → 0 |

`N-S2` runs `migrate()` three more times against a seeded 99-row database and
compares every operator-authored field, not just the count.

**No production data was mutated.** Everything above ran on copies.

## 8. Tests

**New: 52.** `matchmakingSpecificSchools.test.js` (32), `matchmakingStandings.test.js` (12),
`specificSchoolsPreservation.test.js` (8). One pre-existing test updated (§9).

Covering, per §T: page ordering · three tabs · tab switching recomputes nothing ·
99 records preserved · identities preserved · Specific Search add · duplicate-add
idempotency · Details · Create Email Draft creates no draft or send · Manual
Outreach Only · Allow Campaign Outreach · operational Top-100 exclusion · model
rank immutable · removal is not a delete · reversal · LIMITED_DATA · unsupported ·
not-in-run surfaced · stale run · no run · the banned absent-major wording ·
no weights · V1 rollback · migration idempotency · no send on any path.

### Mutation testing

Five mutations, each failing exactly the guard written for it:

| mutation | caught by |
|---|---|
| identity becomes case-insensitive | `N3` (1 failure) |
| denominator becomes the array length | `D2`, `D3` (2) |
| a miss returns `null` instead of `UNMATCHED` | 5 failures |
| the tab drops rows the run cannot enrich | 4 failures in the 99-record suite |
| a Top-100 exclusion also clears the note | `G-S1` |

**The fifth initially survived**, because `G-S1` picked the first
`default`-visibility row and that row had no note — clearing a null note changes
nothing. The test now requires a row that carries one. That is the mutation
exercise doing its job: the weakness was in the test, not the code.

The double-view fix is pinned the same way — reverting it fails `N5b`.

## 9. One product decision taken, and why

**The V2 screen no longer links to V1.** The link read *"Requested schools &
outreach (previous engine)"* and `T7b` asserted it, both for a reason stated in
their own comments: the relationship work — flag, note, contact stance,
withdraw, manual outreach — lived **only** on the V1 tab. A10 moved all of it
onto the V2 Specific Schools tab, so the link became a second route to work
already on the page, and §H allows a duplicate entry point only with a
demonstrated workflow reason. It also sat above "Generated", which §I does not
allow.

`T7b` was **updated, not deleted**, and quotes the premise that changed. What it
guarded was never "a button exists" but "V1 is reachable" — and `?matching=v1`
is unchanged.

**If the reviewer disagrees, this is one line to restore.**

## 10. Rollback (§P) and what remains

`?matching=v1` → V1, per request, not sticky. `VITE_MATCHMAKING_ENGINE=v1` →
V1 for a build. A query parameter overrides a pinned build in both directions;
an unrecognised value falls through to V2. The V1 component and its suites are
byte-identical to before A9.3. `P1` mounts V1 against the same 99-record
fixture and counts the same 99 rows.

**Remaining, for rollout rather than review:**

- ~~The production count has not been confirmed.~~ **Closed before merge** —
  read-only production check records **100** rows with `request_state`,
  `visibility` and `contact_stance` populated on all of them. See §1.
- The automated campaign pipeline has still never run in production (0
  campaigns, 0 operator_users, 0 connected mailboxes) — unchanged by A10.
- Responsive and accessibility checks were run against a seeded 99-school
  athlete at 375 / 768 / desktop: no horizontal scroll at any width, long names
  truncate, tab strip wraps, `role="tablist"` with labelled tabs,
  `aria-controls`/`aria-labelledby` wired, keyboard focus and activation work,
  and the count is separated in the accessible name (`"Specific Schools, 99"`).

## 11. Privacy

No PII in any fixture: institutions, invented staff, "Test Athlete" and
"Demo Athlete". No athlete, guardian or coach data is committed.
`scan:committed-pii` is clean. The seeded demo database used for the browser
checks lives in the session scratch directory and is not in the repository.
