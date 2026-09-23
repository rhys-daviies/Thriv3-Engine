# L8B-1 — Manifest V7 and the baseline corpus contract

Audit, design and proof. No merge, no canonical write, no repin.

**Decision: V7-A — every column of the ten tables the six outputs actually read —
combined with a pinned immutable acceptance snapshot. It is a strict superset of
both V3 and V6, it closes a blind spot neither had, and the pinned corpus makes
its one cost structurally impossible.**

---

## Two corrections before the design

**The union is ten tables, not eleven.** My L8B estimate counted
`roster_freshness` and `roster_measurements`, which are *projections of
`roster_players`*, not tables. Under every-column hashing both are subsumed.

**V6 has a live blind spot.** Measured, not argued:

| mutation | V6 manifest | six baselines |
| --- | --- | --- |
| **`recruiting_arrivals_build.input_digest`** | **UNCHANGED** | **ALL SIX MOVED** |

Tampering with the freshness fingerprint collapses every behavioural output to
the refused state — `assertServable` gates every recruiting claim on it — while
V6 reports the dataset unchanged. That is exactly the invariant L7ZQ exists to
enforce, violated by the table L7ZQ did not include.

I excluded `recruiting_arrivals_build` as "operational metadata" because of what
it looked like. Main's principle names the error precisely:

> *"a hand-picked projection is a guess, and a guess that is wrong in the
> omitting direction is silent."*

Third instance of the same mistake in this roadmap, and the first where the
measurement caught it inside the same stage.

---

## The two contracts, read as code

### main V3 — `9a18d78`

```js
export function tableFingerprint(table) {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name).sort();
  const rows = db.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}"`).all();
  const rowDigests = rows.map((row) => digest(canonical(columns.map((c) => row[c]))));
  rowDigests.sort();
  return { table, rows: rows.length, columns: columns.length, digest: digest(canonical(rowDigests)) };
}
```

Columns sorted by name, so physical order is not data. Each row hashed alone and
the hashes sorted, so the digest is a property of the **set** of rows — no
`ORDER BY` to get right, and a VACUUM or a new query plan cannot move it. Missing
table recorded, not thrown. Tables: **7** — `players, colleges, roster_players,
coaches, athletics_domains, recruiting_arrivals, coach_seasons`.
`roster_freshness` is retained as a *diagnostic*.

### Evidence V6 — `9e8af0e`

Eleven named components, hand-picked semantic columns, deliberately excluding
`roster_row_id`, `region` and `built_at`. Tables: **9** — V3's seven plus
`roster_season_trust` and `programme_status`.

| | |
| --- | --- |
| intersection | 7 (all of V3) |
| V3-only | **0** |
| V6-only | `roster_season_trust`, `programme_status` |
| union | **9** |

---

## Dependency closure — measured, not assumed

Instrumented `buildBaselines` twice. The first pass hooked `prepare` and
reported 13 tables; that **over-counts**, because modules prepare statements at
import whether or not they run. Hooking *execution* gives the real closure:

| table | statement executions |
| --- | --- |
| `roster_players` | 18,980 |
| **`roster_season_trust`** | 18,973 |
| `coach_seasons` | 8,738 |
| `colleges` | 4,748 |
| `recruiting_arrivals` | 4,743 |
| **`recruiting_arrivals_build`** | **4,742** |
| `players` | 2 |
| `athletics_domains` | 2 |
| `coaches` | 1 |
| `programme_status` | 1 |

**Closure = 10 tables.** `outreach`, `outreach_send` and `outreach_evidence`
appear only in the prepare pass — prepared, never executed — and are correctly
outside product identity for the six outputs.

The union of V3 and V6 was **missing `recruiting_arrivals_build`**, which runs
once per pair through `assertServable`. So the V7 table set is not a design
choice; it is a measurement.

---

## Mutation matrix

Controlled 202MB corpus, throwaway copies, canonical never touched.

| mutation | V6 | **V7-A** | six baselines | verdict |
| --- | --- | --- | --- | --- |
| trust → EXCLUDE | moved | **moved** | **all six moved** | both correct |
| trust diagnosis only | moved | moved | unchanged | correct, one-directional |
| `programme_status` | moved | moved | unchanged | correct |
| `arrivals_build.input_digest` | **UNCHANGED** | **moved** | **all six moved** | **V6 fails, V7 passes** |
| `arrivals_build.built_at` / `generation` | unchanged | moved | unchanged | churn |
| `recruiting_arrivals.roster_row_id` | unchanged | moved | unchanged | churn |
| `roster_players.updated_date` | unchanged | moved | unchanged | churn |
| new nullable column | unchanged | **moved** | — | schema evolution, desirable |

V7-A is deterministic across repeated runs (verified) and its digest on the
controlled corpus is `5758dbec5d3afc04`, covering 30 columns of `roster_players`
where V6 covered 21.

**Trust belongs in product identity: YES**, proven on throwaway data — an
EXCLUDE moves all six outputs with `roster_players` untouched.

**Derived state needs direct identity: YES.** L7ZQ's finding stands and is now
extended: source freshness cannot prove derived contents intact, *and* the
freshness record itself is behavioural.

---

## The cost, and why the pinned corpus removes it

V7-A moves on three mutations where behaviour does not: `updated_date`,
`roster_row_id`, `built_at`. On a **live** corpus that is real noise — a
re-scrape or a rebuild moves the manifest and teaches people to repin without
reading, which is the failure V6's projections were designed to avoid.

On a **pinned immutable corpus** it cannot happen, because nothing writes to it.
The churn is a property of the corpus, not of the contract.

That is why the two questions must be answered together: every-column hashing is
only safe *with* a pinned acceptance corpus, and a pinned corpus makes
every-column hashing free.

| option | verdict |
| --- | --- |
| **V7-A** every column of the closure | **CHOSEN**, with a pinned corpus |
| V7-B behavioural projection | reject — it is the method that just failed, twice |
| V7-C two digests | rejected as unnecessary: the behavioural digest would still be a projection, and the pinned corpus already separates data movement from code movement |
| V7-D other | none found |

---

## Decisions

1. **Manifest model** — V7-A, every column, main's `tableFingerprint` verbatim.
2. **Table set — exactly ten**: `players`, `colleges`, `roster_players`,
   `roster_season_trust`, `coaches`, `athletics_domains`, `programme_status`,
   `coach_seasons`, `recruiting_arrivals`, `recruiting_arrivals_build`.
   `roster_freshness` survives as a diagnostic line, as V3 already keeps it.
3. **Column policy** — every column, names from `PRAGMA table_info` sorted;
   row digests sorted; no exclusions, no classification.
4. **Pinned snapshot — YES.**
5. **Snapshot identity** — its own V7-A digest, recorded in the repository;
   never filename or path.
6. **Acceptance baseline source** — the pinned snapshot.
7. **Live baseline role** — retained, as *product-state observability*: "what is
   the product doing on today's data", never as code acceptance.
8. **UNCOMPARABLE** — if the corpus digest does not match the pin, the report
   says UNCOMPARABLE, not PASS or FAIL. This is L7ZM's measurement guard and it
   already exists.
9. **Update procedure** — regenerating the acceptance corpus is a product-data
   event: new snapshot via the existing `VACUUM INTO` helper, new digest
   recorded, baselines re-derived with attribution. Never a casual refresh.
10. **L8B-2 gate** — the merge may land once V7-A is implemented and the pinned
    corpus exists, because only then do the acceptance numbers mean anything.

**Storage**: the corpus is ~202MB and must **not** be committed. It is a
generated artefact produced by `server/lib/dbSnapshot.js` — which already does
WAL-safe `VACUUM INTO`, proven in L7ZM — with only its digest versioned. Reuse,
do not build.

**Failure modes, all fail closed**: wrong or refreshed snapshot → digest
mismatch → UNCOMPARABLE; missing snapshot → refuse rather than fall back to
live; live DB used for acceptance → the corpus-identity line already names
`CANONICAL_SHARED` (L7ZO); schema drift → the `columns` count moves with the
digest; a new dependency table → **not** caught automatically, so the closure
instrumentation should be kept as a test.

---

## Consequence for L8B-2

| pin | movement | kind |
| --- | --- | --- |
| manifest version | V6 → **V7** | definition change; UNCOMPARABLE by design |
| manifest digest | new, over ten tables | **version-format repin**, not behavioural |
| six baselines | **must be re-derived on the pinned corpus** | behavioural repin, attribution required |
| report pins | likely to move with the corpus | attribute, then repin |

No behavioural movement can be claimed until the merge and the pinned corpus
exist together — which is exactly why L8B stopped, and why running the
4,742-pair diff now would have produced numbers this decision invalidates.

---

## Canonical immunity

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `2d694ab74f831491` | `2d694ab74f831491` |
| arrivals freshness | FRESH | FRESH |
| Manifest V6 | `cc28ee6accdb84ed` | `cc28ee6accdb84ed` |

Every mutation ran against throwaway copies of a snapshot. `origin/main` is
still `9a18d78`; the pin did not move during the stage.
