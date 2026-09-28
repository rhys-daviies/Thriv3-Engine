# L7P — when a programme is fielded, and what "covered" means

**Six approved decisions recorded. Two coverage metrics separated.**
NCAA active for 2026 **1,755**; with a 2026 roster **1,607 (91.6%)**; missing
**141**, of which **138 are one season behind** and **3 have never been fetched**.
`colleges.active` untouched. No roster acquired. All six behavioural baselines
byte-identical.

---

## 1. The schema, and what was actually wrong with it

L7O expected `colleges.active` to be unusable because it looked
institution-level. It is not, and re-proved here: `colleges` is keyed
`(name, sport)` under `UNIQUE INDEX idx_colleges_name_sport` — 2,404 rows, 2,404
distinct pairs — and the precedent is live:

| name | sport | unitid | active |
|---|---|---:|---:|
| Montana State Billings | mens-soccer | 180179 | **0** |
| Montana State Billings | womens-soccer | 180179 | **1** |

Switching a men's programme off has never been able to touch the women's one.
**Granularity was never the problem. Time was.**

`active` is one boolean with no season, reason or source. Wisconsin-Oshkosh's
men's side is not fielded in 2026 and *is* fielded from 2027; `active = 0`
records that as gone forever. Anna Maria genuinely played through Fall 2025 and
closed after; a boolean cannot say "not any more" without erasing "used to".

## 2. `programme_status`

Sparse, additive, and it never touches `colleges`.

```
programme_status
  school, sport                PRIMARY KEY — the programme key already in use
  status                       NOT_ACTIVE | FUTURE
  reason                       INSTITUTION_CLOSED | NOT_SPONSORED
                               | IDENTITY_TRANSITION | LAUNCHING
  active_from_season           inclusive, nullable
  active_to_season             inclusive, nullable
  evidence, source_url         NOT NULL — a decision nobody can audit is one
                               nobody should trust
  recorded_at, recorded_by_operator_id
```

**There is no ACTIVE value and there will not be one.** Writing 1,755 rows to
say "as before" would make the table's size meaningless and turn every read into
a join that can silently lose programmes. **Absence means active.**

**UNKNOWN gets no row either.** Bryn Athyn is genuinely undecided, and a record
saying "undecided" is indistinguishable in effect from no record while implying a
decision was made. Absence of proof is not proof, so an undecided programme stays
counted.

`recorded_by_operator_id` is **not** a foreign key: `operator_users` is created
by the auth path rather than by `schema.sql`, so a `REFERENCES` clause makes a
database built from the schema alone unable to accept a row — found in L7K, and
avoided here.

### `activeForSeason(status, season)`

One owner, `shared/roster/programmeStatus.js`, with the server half in
`server/lib/programmeStatus.js`. No consumer re-implements it.

| | |
|---|---|
| no row | **true** — the default is unchanged behaviour |
| `NOT_ACTIVE`, `activeTo = T` | true for `season ≤ T`, false after |
| `NOT_ACTIVE`, `activeTo = null` | **false in every season** — never fielded |
| `FUTURE`, `activeFrom = F` | false before `F`, true from `F` onward |

`colleges.active = 0` still wins outright. Both gates must agree.

**History is answered by the same function**, so asking about 2024 gives 2024's
answer and not today's. That is what makes a `NOT_ACTIVE` row safe: Anna Maria
was fielded in 2024 and is not in 2026, and both remain true.

**A bug this design nearly shipped with:** `Number(null)` is `0` and `0` is
finite, so a plain `Number.isFinite` guard read a missing bound as the year zero
— a `FUTURE` with no start season looked like one that started long ago. Caught
by its own test; null and absent are now checked before coercion.

## 3. Seasons, and the Anna Maria decision

A season is **the year its autumn begins**: `span(2026)` is `2026-27`, and a
roster fetched in Fall 2025 is `season = '2025'`. That is the unit the pipeline
already speaks and it avoids arguing about the day a season starts.

Anna Maria is the case that makes this matter, and the brief was right to warn
against reaching for 2025 by reflex. Derived rather than assumed:

- The college "ceased academic operations at the end of the **Spring 2026**
  semester" — the end of the **2025-26 academic year**.
- Under the model above, that academic year **is season 2025**.
- Soccer is played in the autumn, so its final competitive season was **Fall
  2025**.
- Therefore `active_to_season = 2025`, and the 2026 season — which begins after
  the college closed — is excluded.

The institution existed during part of calendar 2026 and its soccer programme did
not play a 2026 season. **Both statements are true, and the model keeps them
apart** rather than picking a year that makes filtering convenient.

## 4. The six records

| programme | status | reason | bound |
|---|---|---|---|
| Anna Maria · M | `NOT_ACTIVE` | `INSTITUTION_CLOSED` | through **2025** |
| Anna Maria College · W | `NOT_ACTIVE` | `INSTITUTION_CLOSED` | through **2025** |
| New Jersey City · M | `NOT_ACTIVE` | `IDENTITY_TRANSITION` | through **2025** |
| Wisconsin-La Crosse · M | `NOT_ACTIVE` | `NOT_SPONSORED` | **never fielded** |
| Southwest Minnesota State · M | `NOT_ACTIVE` | `NOT_SPONSORED` | **never fielded** |
| Wisconsin-Oshkosh · M | `FUTURE` | `LAUNCHING` | **from 2027** |

Each carries the first-party sentence and URL from L7O. Keys were derived from
the registry — all six matched exactly one row, no fuzzy matching.

**Not written:** New Jersey City University · W, Bryn Athyn · M, Bryn Athyn · W.
All three remain conservatively counted in the 2026 universe.

The write path is one narrow library call. **There is no mutation route and no
UI write surface** — a generic endpoint would make it easy to remove a programme
from the universe by accident.

## 5. Two coverage metrics, named apart

Until L7P this system asked one coverage question, and it was the wrong one.
`withRoster` counted `roster_players WHERE college_name = ? AND sport = ?` **with
no season filter**, so a programme last fetched in 2024 counted as covered for
2026. That is how "NCAA coverage 1,745" came to read as a 2026 number.

**CURRENT-SEASON COVERAGE** — does this programme have a roster *for the season
being asked about*? The completeness metric. Read from `roster_players.season`
and from nothing else: not a scrape timestamp, not the newest row, not the
programme's status, not whether a website exists.

**HISTORICAL COVERAGE** — does it have a usable roster in the dataset at all?
The old measurement, kept because knowing a programme from 2025 is genuinely
useful. It is simply not the same claim.

### The 2026 numbers

```
  1,761   NCAA registry rows
 −    6   recorded not fielded in 2026 (five NOT_ACTIVE, one FUTURE)
 ───────
  1,755   active for 2026
```

| | n | |
|---|---:|---|
| with a **2026** roster | **1,607** | **91.6% current-season coverage** |
| registry duplicates | 7 | twin holds the roster; a registry job |
| missing a 2026 roster | **141** | |
| — of those, known from 2025 | **138** | historical-only |
| — of those, never fetched | **3** | the unresolved cases |
| with a roster in **any** season | 1,745 | 99.4% — **not a 2026 number** |

Reconciles: **1,607 + 7 + 141 = 1,755**.

## 6. The historical-only cohort

All 138 are **exactly one season behind** — every one has a 2025 roster and none
is older — and all 138 are `EXISTING_CANDIDATE`, meaning they already hold a
known-good URL.

| by division | by gender |
|---|---|
| D1 18 · D2 10 · **D3 110** | M 58 · W 80 |

**This is the real remaining NCAA completeness work**, and it is tractable: a
2026 re-acquisition run over programmes that already have sources, not a
discovery problem.

## 7. Consumer wiring

| consumer | wired | note |
|---|---|---|
| `rosterTargetUniverse` | **yes**, via `season` | omitting it preserves the old behaviour exactly |
| roster gap queue | **yes** | now current-season aware |
| `rosterCandidatePlan` sole-slug rule | **yes** | "fields one soccer programme" is a fact about a season |
| `draftOutreach` | **yes** | live destination selection |
| `outreachQA` | **yes** | mirrors the live send path |
| `evidenceReport` | **yes** | live operator report |
| `backtestMatching` | **deliberately not** | |
| `matchingBacktest` | **deliberately not** | |
| operator College DB | **yes**, read-only | a 2026 column |

**Why the two backtests are excluded.** They measure the model against *real
placements from 2024 and 2025*. Filtering them by today's status would rewrite
the universe those arrivals actually chose from — the "status rewrites history"
error this design exists to avoid. They stay on `colleges.active` alone.

**The sole-slug rule needed the season for a real reason.** Wisconsin-Oshkosh
fields only women's soccer in 2026 and both from 2027, so the bare `soccer` slug
is unambiguous for it this year and ambiguous next. Generating it in 2027 could
return the wrong programme's roster — precisely the risk the slug was excluded
for.

**Operator UI:** one read-only column showing "Active", "Not active · through
2025" or "From 2027", with the evidence on hover, fed by
`GET /api/programme-status`. No status-management UI was built.

## 8. Canonical corpus: deliberately unchanged

`canonicalCorpus()` selects every `colleges` row for the sport and filters
neither `active` nor status. **That stays true, and it is correct.**

The Evidence corpus and the behavioural baselines are a *historical* record of
what the engine says about a programme. A programme that stops being a current
destination has not stopped having evidence, and silently shrinking the corpus
would move six behavioural hashes for a reason that has nothing to do with the
engine's behaviour.

**The distinction, stated:** the *current programme universe* decides who may be
recruited to this season; the *historical Evidence corpus* records what is known.
They are different populations and only one of them has a clock.

Measured: **all six behavioural digests are byte-identical** to L7N's.

## 9. Manifest: V2 → V3

`programme_status` is now in the dataset fingerprint, and the version is bumped.

L7O found that `colleges.active` is absent from the `colleges` fingerprint, which
was harmless while it was a dormant flag nothing read. `programme_status` is not
dormant: it decides which programmes are eligible destinations, so live matching
and outreach change when it changes. **A behavioural hash that moved while the
dataset line read UNCHANGED is exactly the misdiagnosis the manifest exists to
prevent** — K3A's finding, one version later.

Bumping the version is what keeps that honest: a V2 pin and a V2 digest taken
over a different table list would both claim to be V2 and mean different things.
The report now reads `DEFINITION_CHANGED (manifest V3)` against a V2 pin.

`194fcf38877e6686` (V2) → **`449e965af3cbaaa6` (V3)**. Repinned after confirming
the prediction: the definition moved and **not one behavioural surface did**.

## 10. Accounting kept intact

The seven duplicate registry rows are still excluded by the same reconciliation
logic, still all women's, and **none overlaps the six status records or the three
unresolved cases**. Not repaired here.

## 11. Known debt, carried forward

- **`Mississippi Christian` is not a real institution.** unitid 176053, Clinton
  MS, rosters served from `gochoctaws.com` — Mississippi College's own site.
  **194 real roster rows filed under a fictitious name.** Untouched by L7P.
- **The advisory readiness verifier still assumes `/sports/`**, so it would
  refuse the Trinity page the pipeline acquired in L7N. Untouched.
- **The three unresolved cases** — NJCU W's identity, Bryn Athyn M and W —
  remain unreviewed and conservatively counted.

## 12. Remaining NCAA work

**The 138.** They are one season behind, they already hold sources, and they are
now visible for the first time as what they are rather than hidden inside a
99.4% figure. Closing them is a re-acquisition run, not a discovery stage.

After that, three identity questions and a registry-integrity job stand between
this and a complete 2026 NCAA foundation.
