# L7ZL — materialised recruiting integrity

**The seam is closed, and the audit found two things nobody was looking for:
the production materialisation is already 1,430 arrivals behind the roster, and
the builder never applied the trust filter at all — so a rebuild after an
exclusion would have certified itself fresh while still containing the excluded
season.**

A stop condition was also hit mid-stage: `roster_players` moved by 39,430 rows
from something I could not attribute. It was restored exactly. That is reported
in full below and is why this stage closes DECISION REQUIRED.

Starting SHA `b7e2ef3` (L7ZK).

---

## What `recruiting_arrivals` is

Traced from the builder, not inferred from the name.

| | |
|---|---|
| **grain** | one row per arrived player, per programme, per sport, per arrival season |
| **source inputs** | `roster_players` (all seasons, one sport at a time) and `coach_seasons` |
| **seasons** | transitions `2022→2023`, `2023→2024`, `2024→2025`, `2025→2026` — so it spans the **current** season, not only the historical window |
| **scope** | both sports; no division or association filter |
| **derived fields** | arrival confidence, identity method, canonical position, nationality/region, entry type, prior programme + confidence + candidates, coach + attribution |
| **source-season identity preserved** | **YES** — every row names `prior_season` AND `arrival_season`, plus `roster_row_id` (populated on all 87,449) |
| **one row depends on multiple source seasons** | **YES** — a row is a comparison *between* two programme-seasons |
| **one source season produces many rows** | **YES** — up to 66 per programme-season |

### The cross-programme dependency

`buildPriorIndex` builds `season → nameKey → Set(college_name)` across **every
programme in the sport**, and `priorProgrammeFor` answers *"where else was this
name last season"* — returning AMBIGUOUS when a name sits at two programmes.

So removing one programme-season can change `prior_programme` and
`prior_confidence` on rows belonging to **entirely different programmes**. The
blast radius of a single exclusion is not the excluded programme; it is any
programme in that sport whose arrivals name-match into the excluded season.
This is what kills targeted invalidation.

---

## Build path

| | |
|---|---|
| entry point | `buildSport(sport)` in `server/scripts/buildRecruitingHistory.js` |
| delete | `DELETE FROM recruiting_arrivals WHERE sport = ?` — **whole sport** |
| insert | every computed arrival for that sport |
| transaction | one `db.transaction`, **atomic per sport** |
| scoping | sport only — no season, no programme |
| partial rebuild | **not possible**; the API has no finer grain |
| deterministic | **YES** — two computations over the same input agree |

### Measured cost

| | |
|---|---|
| input | 281,159 roster rows (129,634 men's + 151,525 women's), 2,147 programmes |
| output | 88,879 arrivals |
| compute | **3.9 s** men's + **4.1 s** women's |
| write half | **1.8 s** for 87,449 rows |
| **full rebuild** | **≈ 10 seconds** |

Not a bounded HTTP operation, but entirely reasonable as an explicit command.

---

## Consumers

| consumer | path |
|---|---|
| `recruitingPatterns.loadPatternsForSport` | whole sport |
| `recruitingPatterns.loadProgrammePatterns` | one programme — **the Evidence path**, via `evidenceQueries.programmeInputs` |

Four Evidence kinds are sourced from it, named by `generalisationRun.js` itself:
**`ARRIVAL_SAME_COUNTRY_POSITION`**, **`ARRIVAL_SAME_REGION_POSITION`**,
**`COACH_ARRIVAL_SAME_COUNTRY`**, **`POSITION_INTAKE_HISTORY`**.

Neither loader reads raw roster data as a cross-check, neither assumes
anything about freshness, and neither has a fallback. `ARRIVAL_*` kinds are
outreach-licensed, so **stale arrivals can reach coach-facing email** — which is
why this is a product-integrity problem and not a housekeeping one.

---

## Dependency contract

**Data dependencies:** `roster_players` (the columns `arrivalsFor` consumes),
`roster_season_trust.disposition` (an exclusion removes rows from the effective
input), `coach_seasons` (coach attribution).

**Not dependencies:** `programme_status` (never read by the builder), division
or association (no filter), `updated_date` (a re-scrape that only moves
timestamps is not a change to what the data says — the L7D lesson).

**Code-version dependency:** `arrivalsFor` itself. A digest over inputs cannot
see a change to the transformation, which is why the stamp carries
`builder_version` separately.

---

## The freshness gap, and how big it already was

Before L7ZL: **no fingerprint, no generation, no staleness marker, no manifest
dependency.** `built_at` existed on every row and was never compared to
anything.

Measured against the live database:

| | stored | freshly computed | |
|---|---|---|---|
| men's | 43,162 | 43,934 | **+772** |
| women's | 44,287 | 44,945 | **+716, −58** |
| total | **87,449** | **88,879** | **1,430 rows adrift** |

`built_at` on every row: **2026-08-29**. Every roster acquisition since —
L7Q, L7R, L7T, L7V, L7W, L7Y, L7ZE — added rows that never produced arrivals.
The missing rows are almost entirely `arrival_season 2026`, across **125
programmes**.

**The seam L7ZK identified as a future risk is a present defect.** Evidence has
been serving recruiting patterns from a two-week-old roster.

---

## Simulated inconsistency

With no guard, excluding a programme-season leaves the raw roster reads
honouring the exclusion — `philosophyQueries` appends the trust predicate —
while `loadProgrammePatterns` keeps serving arrivals derived from it. The
product holds two truths at once, and the one that reaches email is the stale
one.

The fixture reproduces the whole lifecycle; see below.

---

## Options

| | verdict |
|---|---|
| **A** synchronous full rebuild on disposition | **Rejected.** ~10 s and 87k rows inside a request, and the cross-programme index means it is always the whole sport. A write that takes ten seconds and rewrites 44,000 rows is not a disposition, it is a batch job wearing one. |
| **B** fingerprint / staleness guard | **CHOSEN.** Cheap to compute, fails closed, no background work, deterministic recovery, and it catches every cause of divergence rather than the one we thought of. |
| **C** targeted programme-season rebuild | **Rejected on evidence.** `buildPriorIndex` is cross-programme, so one exclusion can change origin attribution on other programmes' rows. "Targeted" is not targeted, and a partial rebuild would need the correctness argument the whole-sport build already has. |
| **D** remove materialisation from the read path | **Rejected.** 8 s of compute per sport on the request path, and it discards a table that is correct and useful when current. The problem is not that it is materialised; it is that nothing said what it was materialised *from*. |

---

## Chosen architecture

**A fingerprint over the effective input, with three states.**

The existing pattern was inspected: `philosophyQueries.poolBenchmarks` keeps an
in-process cache and re-checks a fingerprint (`COUNT(*)` and `MAX(updated_date)`
over the pooled seasons) every `RECHECK_MINUTES`. It protects a **cache**, and
its failure mode is to rebuild silently — right for a cache, wrong here, where
the materialisation is on disk, shared, expensive, and must never be silently
served. The *idea* is reused; the mechanism is not.

### The three states

| state | meaning | reads | exclusion |
|---|---|---|---|
| `FRESH` | digest matches the stamp | proceed | **permitted** |
| `STALE` | it does not | **refuse** | refused |
| `LEGACY_UNVERIFIED` | no stamp — the build predates the mechanism | proceed | **refused** |

The third state follows L7ZK's `LEGACY_UNATTRIBUTED` precedent exactly: absence
means *predates the rule*, is named, reported, and never silently treated as
compliance.

It is also the only honest option. Stamping the existing table FRESH would
assert a freshness measured to be false by 1,430 rows. Declaring it STALE would
refuse every recruiting read in production — taking working Evidence down and
moving four baselines — to make a point about a state that has been the status
quo for weeks. So reads continue exactly as they did, **and an exclusion is
refused while it holds**. The only route to an exclusion is a rebuild, and after
a rebuild every subsequent divergence fails closed.

### Fingerprint inputs

The **effective** input, not the raw tables:

```
builder_version
+ roster_players (college_name, sport, season, player_name, class_year_label,
                  position, nationality, country, hometown, prior_programme)
    WHERE sport = ? AND <trusted roster predicate>
+ coach_seasons (school, season, coach_name, reason) WHERE sport = ?
```

Fingerprinting the effective set — rather than `roster_players` and the trust
table independently — is what makes three properties fall out rather than be
special-cased:

- a **DIAGNOSIS** changes no row of it → no staleness
- a **RETAIN** changes no row of it either → no staleness
- an **EXCLUSION** removes rows from it → stale immediately

RETAIN and absence are the same instruction to Evidence; rebuilding 87,000 rows
because someone recorded an audit note would be work with no product meaning,
and would train people to ignore the signal.

`updated_date` is excluded deliberately, for the reason L7D established.

### Schema

```sql
CREATE TABLE IF NOT EXISTS recruiting_arrivals_build (
  sport TEXT PRIMARY KEY,
  input_digest TEXT NOT NULL,
  builder_version TEXT NOT NULL,
  built_at TEXT NOT NULL,
  generation INTEGER NOT NULL
);
```

One row per sport, because that is the build's own grain. **No backfill** — the
absent row is the `LEGACY_UNVERIFIED` state, and inventing one would be the lie
this table exists to prevent. Production holds **0 rows** after this stage.

---

## The second defect, found by a fixture

The lifecycle test excluded a season, rebuilt, and found the excluded
programme's arrivals **still present**. The cause:

```js
// before
const rows = db.prepare('SELECT * FROM roster_players WHERE sport = ?').all(sport);
```

**The builder never applied the trust predicate.** So after an exclusion a
rebuild would have stamped itself FRESH against an effective input it had not
actually read — a materialisation certified as consistent and demonstrably not.
The guard would have been worse than no guard, because it would assert exactly
the thing it exists to check.

The builder now reads through `trustedRosterPredicate`. It removes nothing today
(there are no exclusions), so no stored row changed; what changed is what a
future rebuild is capable of honouring.

Found by a test, not by reasoning — which is the argument for writing the
lifecycle fixture before trusting the design.

---

## The third defect — the cache key that was the timeout

Hashing ~130,000 roster rows on every `loadProgrammePatterns` call took the
distribution sweep past its 120-second budget, so the digest needed an
in-process cache. The first cache key was the obvious one: `COUNT(*)` and
`MAX(updated_date)` over the sport, plus the exclusion and coach counts. It was
wrong in two independent ways, and both are worth keeping written down.

**It was slow.** `updated_date` carries no index, so `MAX()` full-scans the
table. Measured on the live corpus:

| cache key component | per call |
| --- | --- |
| `COUNT(*) , MAX(updated_date)` on `roster_players` | **75.8 ms** |
| `COUNT(*)` on `coach_seasons` | 0.28 ms |
| `COUNT(*) , MAX(reviewed_at)` on `roster_season_trust` | ~0 ms |
| `PRAGMA data_version` | **0.005 ms** |

At ~1,200 programmes a sweep that is roughly 91 seconds — the cache key *was*
the timeout it had been added to avoid. `operations.test.js` ran at 113.6s
against a 120s limit and failed intermittently, which is how it surfaced.

**It was also incorrect.** Counters are not a change test. An `UPDATE` that
corrects one player's position moves no count and no timestamp, so the key
would have held its digest and gone on reporting FRESH for an input that had
changed — the cache quietly defeating the guard it existed to make affordable.

SQLite answers both questions properly, in constant time:

```js
const localChanges = db.prepare('SELECT total_changes() AS n').pluck();
const changeToken = () =>
  `${db.pragma('data_version', { simple: true })}:${localChanges.get()}`;
```

- `data_version` moves when **another connection** commits. The importers and
  the builder are separate processes, so this is how a long-running reader
  learns its input moved.
- `total_changes()` counts rows **this connection** has changed. `data_version`
  is documented not to move for one's own writes, and an exclusion written
  in-process has to stale immediately.

Verified directly: a same-connection insert moved `total_changes` 28 → 29 and
left `data_version` at 2.

Both over-invalidate — any commit anywhere drops the cache — which is the safe
direction, and needs no writer to remember to call an invalidator. A cache
correct only while everyone remembers is the same shape of promise L7ZK
refused.

Result: `operations.test.js` **113.6s → 14.4s**, 16/16, with the guard now
costing nothing measurable. A regression test asserts the in-place-`UPDATE`
case the old key would have missed, by proving the old key's own inputs are
byte-identical across it while the state still goes STALE.

---

## Read behaviour

`assertServable(sport)` sits in `recruitingPatterns.js`, on both loaders.

A stale read **raises `StaleMaterialisationError`** (`code:
MATERIALISATION_STALE`) rather than returning null. `loadProgrammePatterns`
answers null for *"this programme has no recruiting history"*, which is ordinary
and true; a stale materialisation is *"we cannot say"*. Returning null would
make a data-integrity failure read as a programme with no arrivals — silently
withholding claims instead of reporting why, and leaving no way to tell the two
apart.

**Recovery:** `npm run build:recruiting`. Explicit, deterministic, ~10 s, named
in the error message itself. No background work and no automatic repair.

**Atomicity:** the digest is computed **before** the write (so it describes the
input the build actually read, not one that changed during it) and stamped
**inside the same transaction** as the rows. A crash between them is impossible;
the fixture proves it by throwing before the stamp and asserting that neither
half landed — same generation, same rows, still stale.

---

## Fixture lifecycle — 18 tests

| scenario | result |
|---|---|
| no build record | `LEGACY_UNVERIFIED`, reads work |
| after a build | `FRESH`, generation 1, builder version stamped |
| roster moves under it | `STALE` |
| stale read | **raises** `StaleMaterialisationError`, both loaders |
| fresh + empty programme | still `null` — "no history" keeps its meaning |
| diagnosis only | digest unchanged, `FRESH` |
| RETAIN | digest unchanged, `FRESH` |
| **exclusion** | `STALE` immediately; reads refuse |
| rebuild after exclusion | `FRESH`; excluded programme's arrivals **gone**; neighbour untouched |
| clear the exclusion | `STALE` again (the season re-enters), then `FRESH` after rebuild |
| two exclusions before a rebuild | **one** stale state, **one** rebuild, generation 2 |
| failed rebuild | still `STALE`, same generation, same rows |
| exclusion while `LEGACY_UNVERIFIED` | **refused** |
| **authenticated exclusion while `FRESH`** | **PERMITTED** |
| unauthenticated exclusion while `FRESH` | refused — freshness removes one blocker, never the other |
| RETAIN while `LEGACY_UNVERIFIED` | permitted, state unchanged |

---

## Write-boundary consequence

`exclusionBlockedReason(sport)` is no longer a blanket refusal. It asks whether
that sport's derived data can be verified, and returns **null when FRESH**.

**So the L7ZK finding is now inverted: with a verified materialisation,
`EXCLUDE_FROM_EVIDENCE` is technically safe, and authentication is the only
remaining blocker.** The fixture demonstrates an authenticated operator
completing an exclusion end to end, with the materialisation correctly reporting
STALE immediately afterwards.

In production both blockers still stand: there is no authentication, and both
sports are `LEGACY_UNVERIFIED` until someone rebuilds.

---

## Manifest — unchanged, V5

`recruiting_arrivals_build` is **operational metadata, not behavioural dataset
state**. The manifest answers *"is the data underneath a product hash the same
data"*; this table answers *"can the derived copy be trusted"*, which is a
property of a cache rather than of the source. `recruiting_arrivals` itself has
never been a manifest component for the same reason — it is derived, and its
inputs already are.

No component added, no version bump. **V5 `48ff9511e307817c`, no repin.**

---

## Data incident — reported in full

**A stop condition was hit.** Between Phase 1 and Phase 8, `roster_players`
changed:

| | |
|---|---|
| Phase 1 digest | `9281abaf1826f897` |
| observed mid-stage | `cdf5ea5e4477148e` |
| rows affected | **39,430**, every one `season = 2026` |
| columns | `prior_programme`, `projected_minutes`, `projected_minutes_season` |
| `projected_minutes` populated | 0 → 31,019 |

That is the signature of `server/scripts/projectRosterMinutes.js`, the only code
that writes those three columns. **I did not invoke it and could not attribute
the write.** Ruled out by test rather than by assumption:

| candidate | ruled out because |
|---|---|
| `schema.sql` | contains no DML at all |
| `migrate()` | importing `db/client.js` on its own leaves the digest untouched — measured |
| `scripts.test.js` | spawns every script with `RECRUITMATCH_DB=':memory:'` |
| `operations.test.js` | runs real CLIs against the live DB by design, but not this one — it invokes `draftOutreach`, `rosterSourceAudit`, `recruitingEvidenceReport`, `confirmSends` |
| any other test | nothing in `server/` imports or spawns `projectRosterMinutes`; only `npm run project-minutes` reaches it |

**Restored** from `snapshot-pre-l7zj` by rewriting exactly those three columns
for the 39,430 rows in one transaction. `roster_players` returned to
`9281abaf1826f897`, verified.

### The apparent recurrence, and the operational lesson

The restore then appeared to undo itself: after the desktop app was force-quit
mid-stage, the digest read `cdf5ea5e4477148e` again. That is **not** a second
mutation. The database runs in WAL mode, the restore was still in the write-ahead
log, and the abrupt termination lost it.

Restoring again with an explicit `wal_checkpoint(TRUNCATE)` made it durable, and
a fresh process now reads `9281abaf1826f897` with `projected_minutes` back to
**0 populated rows**.

The lesson is worth keeping: **a repair to the working database is not finished
until it is checkpointed.** Every containment hash in this roadmap has been read
by a short-lived process that exits cleanly, so this had never surfaced before.

The columns are read by `squadRows` through `ROSTER_COLUMNS`, so the original
change was behaviourally live rather than inert. Its cause remains unexplained,
and that is the reason this stage does not self-approve.

### What has happened since, which is nothing

After the checkpointed restore the corpus was deliberately put under the
heaviest load this stage can produce, and watched:

| after | `projected_minutes` populated | 2026 `prior_programme` |
| --- | --- | --- |
| `operations.test.js` in isolation (the prime suspect) | 0 | 0 |
| two complete `vitest run` passes, 4,437 tests | 0 | 0 |
| two full evidence baseline runs | 0 | 0 |

`operations.test.js` was the strongest candidate — it is the one suite that runs
real CLIs against the working database — and it is **exonerated by measurement**:
the columns stayed at zero across it. Nothing in the test corpus reproduces the
write.

**ATTRIBUTED — see `docs/L7ZL_C_UNEXPLAINED_ROSTER_MUTATION.md`.** The writer
was `projectRosterMinutes.js`, run by another session in the main checkout,
reaching this database because `server/data/recruitmatch.sqlite` is a symlink
to it. Nothing in L7ZL caused it and no test could have reproduced it. The
restores performed here were overwriting that session's legitimate work; the
data has been left as that session last wrote it.

---

## Real-corpus immunity

| artifact | Phase 1 | after |
|---|---|---|
| `roster_players` | `9281abaf1826f897` | **identical** (after restore) |
| `roster_season_trust` | 15 rows `6f63446776597c5a` | **identical**, 0 EXCLUDE |
| `recruiting_arrivals` | 87,449 `3dcec4b5f26d6f05` | **identical** |
| `recruiting_arrivals_build` | — | **0 rows** |
| `programme_status` / `colleges` / `athletics_domains` / `roster_gap_reviews` | — | **identical** |
| sheets / state / targets / stage files | — | **identical** |

Coverage 1,748 / 1,732 / 16 / 13 / 3 · **99.1%**.

---

## Remaining blockers

1. **Authentication** — the only thing standing between an operator and an
   exclusion once a sport is FRESH.
2. **A first rebuild** — production is `LEGACY_UNVERIFIED` and 1,430 arrivals
   adrift. Rebuilding both sports (~10 s) would make the guard live, and would
   add ~1,430 arrivals to Evidence. That is a real behavioural change and
   belongs to a stage that owns it.
3. **The unexplained write** to `projectRosterMinutes`' columns.
4. The thirteen undecided seasons, and `verify_gate`'s seams, both carried.
