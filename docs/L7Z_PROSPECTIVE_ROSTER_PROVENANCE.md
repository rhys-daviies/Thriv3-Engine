# L7Z — write down what the page said, at the moment it said it

L7W spent a whole stage answering one question — *was this really a 2025 page?* —
for rows that had been filed under `season=2025` with nothing to show for it. It
had to re-fetch the live web and the Wayback index to find out, and for **641 of
2,123** programmes the answer was unknowable.

The facts were all in hand when each page was accepted, and were discarded one
frame later. L7Z writes them down.

**No roster row changed. Coverage, manifest and all six baselines are
unchanged.** Three nullable columns were added, **0 rows were backfilled**, and
every one of the 2,122 historical 2025 programme-seasons remains honestly
unknown.

---

## Containment

Started at `8363900`, nothing intervening, tree clean. `roster_players` 281,148,
`programme_status` 6, `roster_gap_reviews` 7, coverage 1,748 / 1,731 / 17 / 14 /
3 = 99.0%, manifest `4955986edd3bc976` under V3, six baselines PASS, P6. Hashed
before: content digests over five tables, the 2026 `roster_freshness`
fingerprint, the schema, `_targets.csv`, `state2026.json`, six stage files and
all twenty roster sheets. **No acquisition was run.**

## The trace — where each fact exists, and where it died

| step | facts present | fate |
|---|---|---|
| `lib.fetch(url)` | url, status, body, cache state, **sidecar `fetched_at`** | returns `(status, text)` — **fetch time discarded** |
| `lib.parse_any(html)` | **parser**, **title**, records | returned to the caller |
| `lib.season_ok(title)` | True / False / None | consumed by the gate, not retained |
| `run.evaluate(...)` | accept/refuse + prose note | note survives as prose |
| **`run.build(recs, r, url, conf, note)`** | url, conf, note | **parser and title were never passed in** |
| stage record (`variants.work`) | url, **parser**, **title**, n, candidate | held in durable state |
| `write_out.py` | 16-column rows | **stage-level parser/title not written to the sheet** |
| roster sheet | Source Roster URL, Data Confidence, Notes | the only provenance that crossed |
| `importRosterSheets.js` | the 16 columns | transported faithfully |
| `roster_players` | `source_roster_url`, `notes` | what L7W had to work with |

Two details make the shape of the loss precise. The durable state record
**already holds `parser` and `title`** — `write_out.py` even prints the parser
into `_targets.csv`'s Notes as prose — but neither reaches the rows, so both die
at the sheet boundary. And `fetched_at` never leaves `lib.fetch` at all, though
the cache sidecar has stored it since L7U.

`Notes` looked like it might carry the title. It does not: it holds decision
prose — *"direct read of official 2026 roster page; 2025 name overlap 40%"*.

## Facts versus conclusions

Persisted, because they were **observed**:

| field | what it is |
|---|---|
| `source_roster_url` | already existed — the page that produced the rows |
| `source_page_season` | the season **the page** established |
| `source_fetched_at` | when the body was fetched |
| `source_parser` | the reader that accepted it |

Rejected, because they are **conclusions that must stay recomputable**:
`is_trustworthy`, `reference_quality`, `is_current`, `confidence`,
`season_match`, `historical_reference_class`.

L7W's contract is the authority on trust, and it has already been wrong once and
corrected — clause 8 moved from counting class dialects to counting pages. A
stored verdict would have frozen the wrong version into the data; a stored
*fact* lets the contract be re-run and be wrong again safely. Freezing a
judgement is how you get a number nobody can re-derive and nobody dares change.

## `source_page_season` semantics

**What the page established, via `lib.season_ok` — the same authority that let
the roster through.** `str(SEASON)` when `season_ok(title) is True`; **empty
otherwise**, including when the page named a different year or no year at all.

It is never the requested season and never the database season. Copying either
is the exact inference this column exists to make unnecessary, and a test
asserts that the same untitled page yields empty under three different requested
seasons.

**Normalised only, no raw-label column.** `season_ok` already reads `2026`,
`2026-27`, `2025-26` and `25-26` and normalises to the Fall year deterministically,
and the span's first year is the Fall — the rule L7W had to establish. A second
column holding the raw string would have one consumer: a human curious about
academic-year labelling. That is a real question but not one anyone has asked,
and the smallest coherent model wins.

**The honest negative matters most.** A live current-season page is usually
titled just "Roster" and is accepted on turnover rather than on a title. For
those rows the column is empty, which says *the page established no season* —
information, not a gap.

## `source_fetched_at` semantics

**When the body was fetched**, ISO-8601 UTC, read from the cache sidecar.

The sidecar turns out to be the whole answer for both cases that matter. A fresh
hit serves a body written earlier and its sidecar still carries that earlier
time; a refetch rewrites body and sidecar together. So `lib.fetched_at(url)`
asks the same question in both, and **no caller threads a timestamp down from
`fetch`** — no signature changed anywhere.

A body with no sidecar returns `None`. Unknown stays unknown; in particular the
clock of the process *reading* the cache is never the answer.

**Capture time is a different fact and already has a home.** For a Wayback
source the capture timestamp is inside the URL —
`/web/20250908070127id_/…` — which *is* the source's identity. `source_fetched_at`
answers when Thriv3 read that copy. One field each, no conflation, and a test
pins both on the same archived row.

## `source_parser` semantics

The identifier `parse_any` returned for the reader that actually accepted the
page: `sidearm-html`, `table`, `nuxt`, `nuxt-roster`, `roster-card`,
`presto-card`, `list`. A stable, already-existing vocabulary — the same strings
`write_out.py` has been printing into `_targets.csv` all along.

Transported, never inferred. Parsing is not re-run, and the provider is not
consulted: a Sidearm-shaped URL serving a plain table records `table`.

## Ownership — and why not a provenance table

These are programme-season-source facts, not player facts, so a table keyed
`(college_name, sport, season)` is the textbook answer. **The data says
otherwise.**

```
distinct source_roster_url per programme-season, today
  1 source    8,928 programme-seasons
  2+ sources    382   — every one of them in 2025, worst case 29
by season:  2022 ✓  2023 ✓  2024 ✓  2026 ✓ all single-source
```

A programme-season-keyed table **cannot represent the corpus that exists**: it
would have to collapse 29 distinct sources into one for the worst 2025
programme, which is fabrication of exactly the kind Phase 9 forbids. Per-row
columns represent the legacy reality faithfully — each row keeps the source it
actually came from — while being constant across a programme-season for anything
the current path acquires (2026: **0** multi-source programme-seasons).

The denormalisation objection is weaker than it looks: `source_roster_url` is
**already** a per-row column, so this adds three siblings to an existing per-row
provenance model rather than inventing a new kind of debt. And the practical
costs of a second table are real — a new delete path inside the scoped
importer's transaction, an extension of L7X's `changed_keys ⊆ R` proof to a
second table, a new manifest decision, a new Evidence access path — for a
normalisation the data does not currently support.

**Decision: three nullable columns on `roster_players`.** Cardinality: one
accepted roster has one source, one fetch and one parser; the column is per-row
because the table already models provenance per row and legacy rows genuinely
differ.

## Schema and migration

Additive, through the existing `ROSTER_PLAYER_COLUMNS` mechanism in
`server/db/migrate.js`, idempotent on every boot:

```
source_page_season  TEXT    source_fetched_at  TEXT    source_parser  TEXT
```

**No backfill of any kind.** After migration: 281,148 rows, **0** with a known
page season, fetch time or parser. Every pre-existing column is byte-identical to
its L7Y-approved value across all 281,148 rows.

## Legacy behaviour

A sheet written before these columns exists has no such keys, so they arrive
`undefined` and store NULL. `csv.DictWriter`'s `restval` means durable state
records written before this change still write, with the three columns empty.

**Absence is not evidence.** A NULL means *not recorded* — never *recorded as
none*, and never a reason to treat a programme as untrustworthy. L7W's contract
remains the authority on trust, and this stage tightens no policy retroactively.

## Capture and transport

L7X proposed `run.build()` and that is right, with one refinement: **two of the
three facts already existed one frame up.** `variants.work` holds `parser` and
`title` at the moment it calls `build`; only `fetched_at` had to be recovered,
and the cache key does that without a signature change.

```
lib.fetch → cache sidecar ─┐
lib.parse_any → parser, title ─┤
                              ├→ run.build(..., parser=, title=) → row columns
lib.season_ok(title) ─────────┘      → write_out HDR (+3, appended)
                                     → roster sheet
                                     → importRosterSheets (transport only)
                                     → roster_players
```

Wired at the four current-path acceptance sites — `variants.py`, `selector.py`,
`browse.py` and `run.try_url`. The other five `run.build` callers (backfill and
one-off tools) pass nothing and therefore record nothing, which is correct: a
caller that does not know a fact must not invent one. The parameters default to
unknown precisely so that is the easy path.

The columns were **appended** to the sheet header rather than inserted: readers
key on names either way, but a sheet diff stays legible when the existing
sixteen keep their positions.

## Round trip

A synthetic accepted roster travels sheet → import → `roster_players` with every
value identical. The adversarial case is the important one: a sheet whose page
season disagrees with the season being imported, whose parser does not match its
URL's shape, and whose fetch time is years old. All three arrive exactly as
written — a value that *looks* wrong is still the observed fact, and correcting
it would be inventing.

**26 tests**, network-free and against a throwaway database: page-season
semantics including the honest negative and the three-requested-seasons check,
cache fresh-hit / refetch / miss / no-sidecar, parser transport, Wayback
capture-versus-fetch, legacy sheet and legacy row compatibility, and the scoped
importer transporting provenance **only inside its scope** with cross-season,
cross-gender and cross-institution rows deep-equal.

## Reacquisition

**Canonical provenance describes the latest accepted roster.** A scoped import
replaces a programme-season's rows wholesale, so the provenance travels with
them and the previous acquisition's facts are gone. That is the minimum coherent
semantic: the table answers *where did the roster I am holding come from*, which
is the question every consumer actually asks.

Acquisition history — every accepted fetch over time — is a different model with
its own table and its own retention question. Future work, deliberately not
built here.

## Legacy debt, unchanged

**641 of 2,123** accepted 2025 rosters still fail L7W's trustworthy-reference
contract; all 2,122 2025 programme-seasons carry NULL provenance. Nothing was
repaired and nothing was fabricated. The debt is exactly where L7Y left it.

What changed is the future: a roster acquired from now on answers all four of
L7W's questions from the database alone — what page produced this, what season
that page established, when the body was fetched, which parser accepted it —
without re-fetching the web and without consulting the season column.

## Carried technical debt

**`PROGRAMME_POOL_BENCHMARK` makes local roster maintenance global.** L7Y proved
it: six repaired programme-seasons moved internal Evidence payloads for 864
pairs, because the benchmark computes cross-programme percentiles
(`source: 'roster_players:pool-benchmarks'`) over a pool of 1,045 women's
programmes. `pool.p25` shifted 997 → 998 and one unrelated programme's
comparison band turned on it.

No coach-facing surface moved, and **nothing here changes that behaviour**. It is
recorded so the next stage that touches rosters at scale expects it: any roster
change has corpus-wide reach in the operator and log surfaces.

## Future work

* acquisition **history** rather than latest-state provenance, if auditing ever
  needs it;
* a raw page-season label, if academic-year labelling becomes a question worth
  asking;
* targeted retrospective provenance for the 641, only where historical season
  identity becomes decision-critical — L7W's model, not a sweep.
