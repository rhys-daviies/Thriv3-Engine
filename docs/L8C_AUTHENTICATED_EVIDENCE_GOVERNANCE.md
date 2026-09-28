# L8C — Authenticated Evidence governance, activated

L7ZK wrote the rule: a human decision that changes what Evidence believes
carries an authenticated operator. L7ZI built the record, L7ZL built the
materialisation guard, and the route shipped with its write path **built and
shut**, because the application had no sign-in to attribute anything to. Phase
13K arrived with main and L8B put them in one tree.

This stage proves the chain actually joins up. **It decides none of the 13
unreviewed historical seasons, and writes no canonical disposition.**

Branch off merged main `619c03a`.

---

## The production path

```
POST /api/roster-season-trust/disposition
  server/index.js:151   attachOperator        session cookie -> req.operator
  server/index.js:152   requireSameOrigin     /api, state-changing methods
  server/index.js:153   authRouter            login/logout/me — the only open /api
  server/index.js:189   requireOperator       everything below needs a session
  server/index.js:599   rosterSeasonTrustRouter
    routes/rosterSeasonTrust.js  operatorFromRequest  -> req.operator.id
    lib/seasonTrustReview.js     recordDisposition    -> the only writer
      roster_season_trust
        shared/roster/seasonTrust.js  trustedRosterPredicate  -> Evidence reads
        lib/recruitingMaterialisation.js  effectiveInputDigest -> FRESH/STALE
        lib/recruitingPatterns.js         assertServable       -> refuses STALE
```

The router mounts at line 599, `requireOperator` at 189, so every request that
reaches the handler is a signed-in person.

## One writer, and it is the only one

Two statements in the repository write `roster_season_trust`:

| statement | writes |
| --- | --- |
| `seasonTrustReview.js:88` `UPDATE` | the human half — **the canonical disposition writer** |
| `recordSeasonTrust.js:220` `INSERT` | diagnosis columns only |

The INSERT names no disposition column, and says why: *"a future edit to this
file cannot set a disposition by accident — it would have to add the column,
which is a visible act rather than a typo."*

Searching every `SET` of the human column names across the tree finds two more
files, and both are **different tables**: `outboundBudget.js` sets
`outbound_send_attempt.disposition`, and `programmeMessages.js` sets
`programme_messages.reviewed_by_operator_id`. There are **no triggers** on
`roster_season_trust`. **Disposition writers: one.**

## Identity

`operatorFromRequest` reads `req.operator.id` and nothing else — it never
consults the body or a header, "because an identity a caller can set is not an
identity". Both refusal modes are proven, on all eleven field names tried:

- **Server-owned fields** — `reviewed_by_operator_id`, `reviewed_at`,
  `diagnosis`, `diagnosis_evidence`, `diagnosed_at`, `previous_disposition`,
  `previous_reviewed_at` — are **400, naming the field**. Not ignored: a client
  that believed it set a reviewer and got a 200 would have been told something
  false, which for this field is the governance rule quietly failing.
- **Unknown identity-shaped fields** — `reviewer`, `operator_id`,
  `operator_email`, `reviewed_by` — are **400 as unknown fields**.

In every case the stored disposition stays null.

**Client can choose the reviewer: NO.**

## The write contract

| case | result |
| --- | --- |
| authenticated RETAIN | **200**, row carries the server's operator id and the server clock |
| no session | **401** |
| invalid session cookie | **401** |
| expired session | **401** — expiry is enforced against the row, not the cookie |
| valid session, foreign `Origin` | **403** `origin_rejected` |
| spoofed reviewer (11 field names) | **400** |
| stale `expected_disposition` | **409** "has moved since it was read" |
| disposition outside the vocabulary | **400** |
| disposition with no evidence | **400** |

Nothing is written in any refusal case.

## Only a human EXCLUDE acts

The three layers stay separate, and a human decision never rewrites the
machine's finding — `diagnosis`, `diagnosis_evidence` and `diagnosed_at` are
byte-identical before and after a disposition.

| | Evidence reads | materialisation |
| --- | --- | --- |
| diagnosis only, no disposition | **visible** | FRESH |
| `RETAIN` | **visible** | FRESH |
| `EXCLUDE_FROM_EVIDENCE` | **removed** | **STALE** |

On EXCLUDE, measured on throwaway data:

1. the row carries the authenticated reviewer and the server timestamp
2. the excluded programme-season disappears from Evidence reads; the untouched
   sibling programme is unaffected
3. `effectiveInputDigest` moves — it reads roster rows through
   `trustedRosterPredicate`, so an exclusion changes the recruiting input
4. `materialisationState` becomes **STALE**
5. `loadProgrammePatterns` **throws `StaleMaterialisationError`** rather than
   returning an empty result that would read as "this programme has no
   recruiting history"
6. Manifest V7 moves, because the data behind it did

## Controlled rebuild, and the way back

Stamping the new digest returns the sport to **FRESH** with
`generation + 1`, `expected === actual`. The exclusion **survives** the rebuild
— it is not what a rebuild undoes — and Evidence becomes servable again.

The way back is **RETAIN against the recorded EXCLUDE**, which is the existing
contract; no new disposition was invented for it. Optimistic concurrency means
the caller states `expected_disposition: 'EXCLUDE_FROM_EVIDENCE'`. The season
returns to Evidence, `previous_disposition` records what it was, the input
digest moves back, the materialisation is **STALE again until rebuilt**, and a
rebuild restores FRESH. The cycle closes in both directions.

## Auditability — no schema change

The stored row already answers every question, so nothing was added:

| question | column |
| --- | --- |
| what was reviewed | `season`, `college_name`, `sport` |
| what was decided | `disposition` |
| who decided | `reviewed_by_operator_id` → a real `operator_users` row, not free text |
| when | `reviewed_at`, server clock |
| why | `disposition_evidence` |
| what next | `next_action` |
| what it was before | `previous_disposition`, `previous_reviewed_at` |

## Roster-gap review identity — the boundary closed

`rosterGaps.js` shipped writing `operatorId: null` and explained that the
application had no authentication, so a placeholder "would make the column lie
in a way that is worse than its being empty". **That premise is now false**, and
the route reads `req.operator.id` like its sibling.

- new review by a signed-in operator → the id is stored
- reviewer supplied in the body → **400, unknown field**, nothing written
- no operator on the request → still null, never invented (unreachable in
  production, since `requireOperator` mounts above this router)

**Legacy rows are untouched.** Canonical holds 7 roster-gap reviews, all with a
null reviewer, and they stay that way: a null there is a fact about those
records, and backfilling would invent exactly the attribution the original
comment refused to invent.

## The read model

`unreviewed`, `retained` and `excluded` are three distinguishable states, and
the wire never conflates them:

| state | `attribution` | `review_state` | `excluded_from_evidence` |
| --- | --- | --- | --- |
| nobody has decided | `NOT_REVIEWED` | `PENDING_REVIEW` | false |
| decided to keep | `ATTRIBUTED` | `DISPOSITIONED` | false |
| decided to exclude | `ATTRIBUTED` | `DISPOSITIONED` | **true** |
| decided before attribution existed | `LEGACY_UNATTRIBUTED` | `DISPOSITIONED` | — |

`LEGACY_UNATTRIBUTED` is what canonical's two grandfathered RETAIN rows report:
a fact about the record rather than a gap in it.

## Canonical immunity

| | before | after |
| --- | --- | --- |
| trust | 15 / 2 RETAIN / 13 NULL / 0 EXCLUDE | **unchanged** |
| rows with a reviewer | 0 | **0** |
| `programme_status` (P6) | 6 rows | **unchanged** |
| `recruiting_arrivals` | 88,879, generation 1 | **unchanged** |
| arrivals freshness | FRESH both sports | **FRESH** |
| NCAA | 1,755 / 1,732 / 16 / 98.7% | **unchanged** |
| `roster_players` columns | 33 | **33** |
| roster-gap reviews | 7, none attributed | **unchanged** |

**No canonical human disposition occurred. The 13 remain unreviewed.**

The three externally-added `projected_games_*` columns were **not modified**,
and they cannot affect arrivals freshness: `ROSTER_INPUT` is a fixed ten-column
list and they are not in it. Live V7 is still expected to differ from the
pinned corpus for the reason L8B-4 recorded, and behavioural acceptance is
taken on the pinned corpus precisely so that difference cannot reach it.

## Email intelligence

Untouched. On the pinned acceptance corpus `8bb808b66db9ee3b`, all six outputs
**PASS with no repins**, `EMAIL_BODY 54a05ec90e8937fd` and
`COACH_COMPOSITION 5e6fb62e12c3a022` exactly the approved post-L8B baselines.
Closure **10 registered = 10 executed**.

## Tests

Focused: 254 passed across auth, session, trust, governance, roster-gap review,
operator routes and materialisation. **Full suite 326 files, 8,285 tests, 0
failed.** Build clean. No transient failures in this run.

## What is not done

**L8D** — the operator review UI, and resolving the 13 unreviewed historical
seasons. No UI was built here: L8C changed no frontend file, because the
mechanism is provable without one.

NAIA and NJCAA/JUCO expansion remain **PAUSED**. After M is complete the
roadmap stops for Rhys to choose the next product priority.
