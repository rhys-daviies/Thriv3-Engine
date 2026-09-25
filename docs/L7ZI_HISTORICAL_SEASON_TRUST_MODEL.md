# L7ZI — historical season trust model

**A third option between keep and delete, applied to nothing.**

`roster_players` says these rows exist. It cannot say whether the season they
are stored under is the season the source established — and L7ZG found two
probable duplicate captures with no repair source and thirteen seasons with no
surviving evidence of their identity at all, every one of which must stay on
file for audit, inspection, provenance and future repair.

Keep and delete were the only two options. That is why every stage so far has
correctly chosen keep, and why nothing has been fixed.

**Zero real programme-seasons received a disposition.** Production holds zero
trust rows. No roster row, sheet, state file, review or status moved. All six
behavioural baselines are byte-identical.

Starting SHA `41d828d` (L7ZH).

---

## Ownership grain — programme-season

Decided from data, not preference.

| | |
|---|---|
| multi-source programme-seasons | **142**, all 2025 |
| collapse to ONE origin roster page once archive wrappers and per-player segments are removed | **120** |
| genuinely more than one distinct origin page | 22 |
| whose sources name **more than one season** | **3** |

The worst case — Seattle men's 2025, 29 "sources" — is **29 per-player bio
URLs for 29 players**, one each. That is per-row provenance, which L7Z already
records in `roster_players.source_*` and which answers a different question:
*where did this row come from*, not *which season was the page*.

Season identity is a statement about the season. Two sources within one
programme-season cannot meaningfully disagree about which season it is — and
the 3 that name different seasons are the Clemson URL-record defects L7ZG
found, a provenance-record problem rather than a trust-grain one.

**Grain: programme-season.** `(season, college_name, sport)`. Keyed as
`roster_players` keys itself, because a second spelling of the same column is
how a join silently matches nobody.

---

## Consumer trace

Every roster read that reaches Evidence, found from `ROSTER_COLUMNS` outward
and verified against the code rather than against a previous list.

| owner | statement | window |
|---|---|---|
| `philosophyQueries.selectRoster` → `programmeRows()` | per programme | **historical 2022–2025** |
| `philosophyQueries.selectSquad` → `squadRows()` | per programme | current 2026 |
| `philosophyQueries.buildPoolBenchmarks` | per sport, all programmes | **historical 2022–2025** |
| `recruitingPatterns.loadSeasonsBySport` | seasons on file, per sport | all |
| `recruitingPatterns.loadProgrammePatterns` | seasons on file, per programme | all |

`programmeInputs` in `evidenceQueries.js` is the single entry point that
assembles all of them into one ctx. Kinds reached, measured by the synthetic
exclusion rather than inferred: the philosophy family
(`FRESHMAN_MINUTES_LADDER`, `ATHLETE_COHORT_LADDER`,
`PROGRAMME_DEVELOPMENT_PATTERN`, `PROGRAMME_POOL_BENCHMARK`,
`POSITION_INTAKE_HISTORY`, `POSITION_GROUP_SIZE`, `POSITION_GROUP_SCARCITY`,
`RETURNING_POSITION_DEPTH`, `ELIGIBILITY_CLIFF`, the graduation kinds,
`INTERNATIONAL_ROSTER`, `INTERNATIONAL_SHARE`) and the arrival kinds through
`recruiting`.

**One seam, reported:** `recruiting_arrivals` is a **materialised** table built
by `buildRecruitingHistory.js`. Excluding a season at read time removes it from
the season-presence queries but does not remove arrivals already derived from
it. Any real disposition must be followed by a rebuild of that table.

---

## The state model

### Two halves, and they must not be one field

A machine diagnosis is a measurement. An operator disposition is a decision.
L7K learned this for roster gaps — raw attempt state, machine diagnosis and
operator review are three layers there precisely because collapsing them let a
heuristic read as a decision. Here the argument is sharper: **an audit
heuristic that silently removed a season from Evidence would change product
intelligence on a suspicion nobody signed.**

L7ZG's own classifier proves the point. Its first draft convicted five
programme-seasons, three of them wrongly, and was corrected only because a
human read it. Had diagnosis equalled exclusion, Clemson would have left
Evidence before anyone noticed.

### Diagnosis — machine, never acts

| state | meaning |
|---|---|
| `SEASON_IDENTITY_UNPROVEN` | nothing surviving establishes which season the page was |
| `PROBABLE_DUPLICATE_CAPTURE` | the squad resembles a neighbour AND no season evidence survives |
| `DEFINITE_MISMATCH` | surviving evidence names another season and the rows corroborate it |

L7ZG's `VERIFIED_DISTINCT` and `HIGH_OVERLAP_BUT_PLAUSIBLE` are **absent on
purpose**: they say a season looks fine, which is what absence already says,
and storing 4,980 rows to repeat the default would make this table a copy of
the roster.

### Disposition — human, the only half that acts

| state | meaning |
|---|---|
| `RETAIN` | recorded and reviewed; Evidence continues to read it |
| `EXCLUDE_FROM_EVIDENCE` | Evidence must not read this programme-season |

**Two states, and more were refused deliberately.** These cover every case the
roadmap has produced: a diagnosed season kept on the record (ENMU/SFSU), a
confirmed bad season removed, and a repaired season restored by clearing the
exclusion. "Retry discovery" and "repair available" are **next actions**, not
trust states — a season is not in a different relationship with Evidence
because someone intends to re-fetch it — so they live in `next_action` as free
text, exactly as `roster_gap_reviews` keeps them.

### Absence means no override

A programme-season with no row behaves exactly as it did before the table
existed. **No implicit TRUSTED and no implicit UNPROVEN**: making either honest
would mean backfilling 6,844 programme-seasons with an assertion nobody
measured — the same defect this table exists to record.

**Backfill required: NO. Real rows inserted: 0.**

---

## Storage options

| option | verdict |
|---|---|
| **A** columns on `roster_players` | **Rejected.** One decision duplicated across 20–40 player rows; a disposition becomes an UPDATE over a 281,159-row table; and it puts an operator decision in a table the importer rewrites wholesale. |
| **B** programme-season trust table | **Chosen.** One row per decision, normalised, additive, zero backfill, its own manifest component, and a natural home for reviewer and evidence fields. |
| **C** programme-season-**source** table | **Rejected.** The data says trust is not source-scoped: 120 of 142 multi-source cases are one page, and per-row source provenance already exists from L7Z. The key stays extensible if that ever changes. |
| **D** extend `roster_gap_reviews` | **Rejected.** That table is about *acquisition gaps* — a programme missing a current roster, keyed `(season, school, sport)` with a disposition vocabulary about retrying. Overloading it would conflate "we could not get 2026" with "we do not trust 2024", and its `disposition` column would mean two different things. |

---

## Schema

Additive, idempotent, in `server/db/schema.sql` beside `roster_gap_reviews`
whose idiom it follows.

```sql
CREATE TABLE IF NOT EXISTS roster_season_trust (
  season TEXT NOT NULL,
  college_name TEXT NOT NULL,
  sport TEXT NOT NULL,

  -- machine half: a measurement, never acts on its own
  diagnosis TEXT,
  diagnosis_evidence TEXT,
  diagnosed_at TEXT,

  -- human half: the only half that can remove a season from Evidence
  disposition TEXT,
  disposition_evidence TEXT,
  reviewed_at TEXT,
  reviewed_by_operator_id TEXT,

  next_action TEXT,

  previous_disposition TEXT,
  previous_reviewed_at TEXT,

  PRIMARY KEY (season, college_name, sport)
);
```

No CHECK constraints on the vocabularies, for the reason `roster_gap_reviews`
gives: `validateTrustRecord` in `shared/roster/seasonTrust.js` can say **why** a
value is refused where a constraint can only fail. It refuses an unknown state,
a record asserting nothing, and — the rule that matters — **a disposition with
no evidence or no reviewed_at**, because an exclusion nobody can audit later is
worse than no mechanism at all.

---

## The filter

One predicate, written once in `shared/roster/seasonTrust.js` and appended by
every roster read that feeds Evidence:

```sql
NOT EXISTS (
  SELECT 1 FROM roster_season_trust t
   WHERE t.college_name = roster_players.college_name
     AND t.sport        = roster_players.sport
     AND t.season       = roster_players.season
     AND t.disposition  = 'EXCLUDE_FROM_EVIDENCE'
)
```

Applied at **five statements across two files** — the three in
`philosophyQueries.js` and the two in `recruitingPatterns.js`. Seven kinds each
remembering to filter is seven places for the eighth to forget, and the failure
would be silent: a claim built from an excluded season is indistinguishable
from a correct one.

`NOT EXISTS` rather than a `LEFT JOIN` so the shape of the result set cannot
change — a roster read must return rows or no rows, never duplicated ones.

It reads `disposition` and never `diagnosis`, and a test asserts that on the
predicate's own text, because a filter that quietly started keying on the
machine half would make a suspicion act on Evidence.

**Not season-restricted.** The mechanism is all-season capable and nothing in
the schema says historical; that a current season is never excluded is a
disposition policy, not a structural guarantee. A test proves excluding a
historical season leaves the 2026 squad untouched.

---

## Fixture behaviour

23 tests on a seeded in-memory fixture (`vitest.config.js` points every file at
a throwaway database, which is the right arrangement for a file whose subject
is removing data from Evidence). Every write is inside a rolled-back
transaction, and the last test asserts zero rows remain.

| scenario | result |
|---|---|
| no trust row | snapshot **byte-identical** to before the table existed |
| `PROBABLE_DUPLICATE_CAPTURE`, no disposition | **unchanged**, including the pool |
| every diagnosis in turn, no disposition | **unchanged**, all three |
| `RETAIN` | **identical to absence** |
| `EXCLUDE_FROM_EVIDENCE` | target season gone; row count down by exactly its size |
| same programme, other seasons | **untouched** |
| neighbouring programme | **byte-identical** |
| opposite sport, same school name | **byte-identical**, ladder and dials |
| current 2026 squad | **untouched** |
| exclude → repair → `RETAIN` | snapshot **returns to the original**, not merely to the right shape |

### Pool movement — expected, and bounded

Excluding a contributing season moves the pool, because the pool is a relative
statistic over the programmes that contributed. In the fixture:

| | |
|---|---|
| readable position-seasons | 36 → **28** |
| rank-1 `n` | **unchanged** — no programme left the pool |
| rank-1 p25 | 900 → **800** — a contributor's median changed |
| opposite sport | **unchanged** |

---

## Manifest — V4 → **V5**

A new behavioural component was added, so the **definition** changed and the
version had to move. This is the first component added *before* the gap could
be demonstrated rather than after: a single row in `roster_season_trust` would
change what every roster-derived kind computes while all four roster components
reported UNCHANGED, because they fingerprint `roster_players` and an exclusion
changes nothing in it.

**The version moved although production holds zero rows.** That is the point of
versioning the definition rather than the data — a V4 digest was taken over a
table list that could not see this input.

| | |
|---|---|
| before | V4 `7d256f519c130dd6` |
| after | V5 **`322995fd7be5a673`** |
| component added | `roster_season_trust`, 0 rows, `4f53cda18c2baa0c` |
| other eight components | **unchanged** |

| fixture | manifest |
|---|---|
| diagnosis only | **MOVES** |
| `RETAIN` | **MOVES**, and to a *different* digest than `EXCLUDE` |
| `EXCLUDE_FROM_EVIDENCE` | **MOVES** |
| exclusion cleared | **returns to the original** |

**Blind spot: NO.**

A deliberate distinction worth stating: a diagnosis does not change **Evidence**
but it does change the **dataset**. The manifest's job is to say whether the
data underneath a product hash is the same data, and a row appearing in a
behavioural table is a change to it. Reporting UNCHANGED beside a new record
would be the manifest lying about something it can see.

---

## Real-corpus immunity

With zero dispositions, all 4,742 canonical pairs measured:

| | |
|---|---|
| Evidence digest | `fe69597ed4becf14`, **unchanged** |
| canonical pairs changed | **0 of 4,742** |
| OUTBOUND_DECISION / COACH_COMPOSITION / EMAIL_BODY | **byte-identical** |
| OPERATOR_WIRE / LOG_PAYLOAD / OPERATOR_EVIDENCE | **byte-identical** |
| pool, both sports | **unchanged** |

The baseline pin diff is **manifest-only**: version, the new component, the
manifest digest. Every behavioural line reads `X -> X`.

---

## ENMU / SFSU simulation *(rolled back)*

### Diagnosis only — `PROBABLE_DUPLICATE_CAPTURE`, no disposition

| | |
|---|---|
| Evidence digest | **UNCHANGED** |
| canonical pairs changed | **0 of 4,742** |
| pool, both sports | **UNCHANGED** |
| manifest | MOVED (a dataset row appeared) |

**This is the result that matters most.** The operator decision recorded in
L7ZG — keep both, flagged — is now expressible, and recording it changes
nothing about what the product says.

### Explicit exclusion — what it *would* cost

| | |
|---|---|
| canonical pairs changed | **3 of 4,742** — all San Francisco State |
| claim kinds | the philosophy family for that programme |
| men's pool rank-1 median | **1118 → 1119** |
| men's rank-1 `n` | unchanged at 770 |
| women's pool | **unchanged** |
| EMAIL_BODY / COACH_COMPOSITION | no pair's composition moved |

The median shift reproduces L7ZG's independent prediction exactly.

## The thirteen unproven — one representative *(rolled back)*

Virginia W 2025, chosen as the NCAA, Evidence-exposed case.

| | |
|---|---|
| `SEASON_IDENTITY_UNPROVEN`, no disposition | Evidence **UNCHANGED**, 0 pairs |
| explicit exclusion | **1 pair** changed; women's rank-1 `n` **1045 → 1044** |
| men's pool | unchanged |

`n` dropping by one means Virginia leaves the pool entirely — it had a single
readable season — which is exactly the kind of consequence an operator should
see before deciding, and exactly why this stage measures rather than acts.

**Production trust rows after every simulation: 0.**

---

## Future operator surface

Documented only; no UI was built and none is needed yet. A review screen would
need, per row:

`programme` · `sport` · `season` · `diagnosis` · `diagnosis_evidence` ·
`diagnosed_at` · `disposition` · `disposition_evidence` · `reviewed_at` ·
`reviewed_by_operator_id` · `next_action` · `previous_disposition` ·
`previous_reviewed_at`

Every one already exists as a column, so the surface is a read model over this
table joined to a row count from `roster_players` — no additive API path was
required and none was added.

---

## Remaining decisions

1. **Eastern New Mexico M 2025 and San Francisco State M 2025** — the mechanism
   can now record "retained but flagged". The decision is the operator's, and
   the cost of the alternative is measured above.
2. **The thirteen `LEGACY_SEASON_IDENTITY_UNPROVEN` seasons**, two of them NCAA
   and Evidence-exposed.
3. **The wider 447-row cohort**, most of it a legitimate first acquisition.
4. **`recruiting_arrivals` must be rebuilt** after any real disposition.
5. **`verify_gate`'s scope and evaluator seams**, carried since L7ZG.
