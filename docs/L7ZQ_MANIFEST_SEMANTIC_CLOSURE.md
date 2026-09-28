# L7ZQ — manifest semantic closure

L7ZP rebuilt `recruiting_arrivals`, moved all six behavioural baselines, and
left the dataset digest exactly where it was. That breaks the one promise the
manifest makes:

> If data capable of changing a behavioural baseline changes, dataset identity
> must change with it.

This stage finds out why, and closes it. **Two independent holes, both
demonstrated by mutating one field against a fixture rather than argued from
the code.**

---

## Manifest V5, as it actually was

Nine components, **all source tables**:

| component | columns | purpose |
| --- | --- | --- |
| `players` | id, full_name, sport, nationality, position, intended_major, recruiting_class_year | the athlete |
| `colleges` | name, sport, unitid, division, conference | programme identity |
| `roster_players` | college_name, sport, season, player_name | squad identity |
| `roster_season_trust` | the whole decision record | L7ZI — whether a season is read at all |
| `coaches` | school, sport, full_name, position_title | coach directory |
| `athletics_domains` | domain, unitid, status, role, confidence | identity resolution |
| `programme_status` | school, sport, status, reason, active bounds | L7P — eligible destinations |
| `roster_freshness` | MAX(updated_date) per programme-sport, current season only | K3A |
| `roster_measurements` | 17 behavioural roster fields | L7ZB |

**Semantic boundary: source identity.** No derived table appeared anywhere in it.

---

## Why V5 missed L7ZP

Classification: **MULTIPLE**.

### 1. DERIVED_STATE_NOT_IDENTIFIED — `recruiting_arrivals`

Measured on a fixture with source inputs held identical:

```
DELETE FROM recruiting_arrivals WHERE arrival_season='2026'
  V5 digest   a433a7c149fe1628   UNCHANGED
  baselines   all six moved
```

### 2. SOURCE_INPUT_MISSING — `coach_seasons`

A second hole, found beside the first and **not** part of the L7ZP story.
`philosophyQueries` reads `coach_seasons` straight into Evidence, `programmePhilosophy`
computes coach tenure from it, and `recruitingPatterns` uses it for arrival
attribution. V5 carried `coaches`, which is a **different table**.

```
UPDATE coach_seasons SET coach_name = 'ZZ Mutated Coach' …   (2,900 rows)
  V5 digest   a433a7c149fe1628   UNCHANGED
  baselines   all six moved
```

---

## The finding that decided the architecture

Deleting a season of `recruiting_arrivals` leaves the L7ZL materialisation
state reporting **FRESH**:

| mutation | materialisation state |
| --- | --- |
| `coach_seasons` changed | M: **STALE** |
| roster player names changed | M: **STALE** |
| **arrivals rows deleted** | M: **FRESH** |

L7ZL's fingerprint covers what the table was built **from**. It never covers
what the table now **contains**. A materialisation truncated or edited after a
successful build satisfies freshness completely and is still wrong.

That is the whole argument against **Option D**. Freshness asks *"does this
derived state match its semantic inputs?"*; the manifest asks *"what data will
the product actually read?"* A build stamp cannot answer the second.

---

## Source identity vs product-data identity

L7ZP is the concrete test case: **identical source inputs, different
`recruiting_arrivals`, different behavioural output**. Under SOURCE_IDENTITY
those two states are the same dataset, and the baseline report is then obliged
to call a real product difference a code regression — which is exactly what it
did.

**Verdict: PRODUCT_DATA_IDENTITY.** The manifest answers what the product
reads, because that is the question baseline governance needs answered. Source
identity is a weaker claim that L7ZP proved insufficient.

---

## Options

| | verdict |
| --- | --- |
| **A** — source inputs only (add `coach_seasons` etc.) | **insufficient alone** — closes hole 2, leaves hole 1 entirely |
| **B** — derived materialisations only | **insufficient alone** — closes hole 1, leaves `coach_seasons` invisible |
| **C** — source inputs **and** derived behavioural content | **CHOSEN** — each half has its own proof |
| **D** — source inputs + stored build fingerprint | **rejected on evidence** — the truncation test reports FRESH, so D cannot see it |
| **E** — narrower design | none found that covers both holes |

---

## Manifest V6

Eleven components: the nine from V5, plus

```
coach_seasons        school, sport, season, coach_name, coach_title, reason
recruiting_arrivals  21 semantic fields, taken from `toArrival`
```

### Semantic columns, and what is deliberately excluded

`coach_seasons` excludes `method`, `confidence`, `source_url`, `division`,
`imported_at` — acquisition provenance that reaches no claim. A re-scrape that
changes only how a coach name was found must stay quiet.

`recruiting_arrivals` is hashed from the field list in `toArrival`, the one
function that turns a stored row into what the aggregations see. Four columns
are out:

| excluded | why |
| --- | --- |
| `roster_row_id` | loaded into the pattern object and consumed by nothing. L7ZP measured **24,929 rows differing only here** after a roster re-import issued new surrogate ids |
| `region` | `toArrival` states in its own comment that it does not read the stored column, because `patterns.js` recomputes region from country. A cache is not identity |
| `built_at` | operational. Rebuilds are deterministic, so this would be pure churn |
| `id` | surrogate |

Lines are serialised and **sorted**, as `rosterMeasurementFingerprint` does, so
row order and index choice cannot move the digest.

V6 contains no filesystem path, worktree identity, timestamp, generation
counter, WAL state or cache metadata.

---

## Mutation matrix

One field mutated, code held fixed, manifest and all six baselines measured.

| dependency | baselines moved | V5 | V6 | |
| --- | --- | --- | --- | --- |
| `coach_seasons.coach_name` | yes | **UNCHANGED** | moved | **violation → closed** |
| `recruiting_arrivals` deleted | yes | **UNCHANGED** | moved | **violation → closed** |
| `roster_players.player_name` | yes | moved | moved | ok |
| `roster_players.minutes_played` | yes | moved | moved | ok |
| `players.intended_major` | yes | moved | moved | ok |
| `colleges.division` | no | moved | moved | ok (one-directional) |
| `programme_status.status` | no | moved | moved | ok (one-directional) |
| `recruiting_arrivals.roster_row_id` | no | unchanged | **unchanged** | correct — inert |
| `recruiting_arrivals.region` | no | unchanged | **unchanged** | correct — inert |

**Violations before: 2. Violations after: 0.**

The converse is deliberately not asserted. The manifest may move for a
governance reason no sampled surface reflects — L7ZI moved it for a table
holding zero rows.

### Derived-table sweep

`recruiting_arrivals` was the only derived table on the six-baseline path.
Deleting each of the others entirely moved **no baseline**:

`engagement_rollup`, `graduating_seniors`, `programme_seasons`,
`programme_conference_seasons`, `conference_seasons`,
`conference_members_official`, `institution_aliases`, `outreach`.

---

## Acceptance proof

The V5 reconstruction used throughout is V6's components minus the two L7ZQ
added. It reproduces the real pin exactly on the canonical corpus:

```
V5-reconstruction   a433a7c149fe1628
known V5 pin        a433a7c149fe1628      faithful: true
```

So every "V5 could not see this" above is a measurement, not a claim. Thirteen
tests in `manifestSemanticClosure.test.js` hold the line, including a
column-by-column guard over all 21 arrival semantic fields so a future edit
cannot quietly drop one.

**Controls proven:** identical data at two different paths (canonical and a
stage snapshot) gives the same digest `cc28ee6accdb84ed`; identical data with
no code change gives the same digest; a deterministic rebuild does not move it.

---

## Current V6

| component | rows | digest |
| --- | --- | --- |
| players | 4 | `67a40ceb30ddaa7a` |
| colleges | 2,404 | `cdcbe3c7c693c81b` |
| roster_players | 281,159 | `927b5fa9290cb654` |
| roster_season_trust | 15 | `5391be738f856a22` |
| coaches | 6,347 | `35c83c5c8fd75c4d` |
| athletics_domains | 2,723 | `63d001e57c271239` |
| programme_status | 6 | `0a1132f6cdaa853e` |
| **coach_seasons** | 8,595 | **`9ff4a87d253ed713`** NEW |
| roster_freshness | 2,060 | `3d70ff0168dc6842` |
| roster_measurements | 281,159 | `2009f8afa02c1fb2` |
| **recruiting_arrivals** | 88,879 | **`cf05efc2ff02f00b`** NEW |

**V5 `a433a7c149fe1628` → V6 `cc28ee6accdb84ed`.** The nine carried-over
components are byte-identical; only the two new ones distinguish the dataset.

---

## Repin

| | |
| --- | --- |
| **Manifest repin** | **YES** — V5 `a433a7c149fe1628` → V6 `cc28ee6accdb84ed` |
| **Behavioural repin** | **NO** |

All six behavioural digests rewrote to themselves. They read UNCOMPARABLE
before the repin solely because of the version boundary — the report says so in
its own words, refusing to call a cross-definition comparison a FAIL. After the
repin all six PASS on canonical.

V5 is not edited in place. The old digest stays a historical record of a
question that was asked over a smaller table list.

---

## Canonical immunity

| | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` semantic | `f264fef351d8d01a` | `f264fef351d8d01a` |
| freshness | FRESH | FRESH |
| trust | 15 / 2 RETAIN / 13 NULL / 0 EXCLUDE | unchanged |

No product data was written. This stage changed the manifest definition, tests,
docs and identity metadata only.

---

## Remaining blind spots

- **The invariant is verified by sampling, not proved.** The matrix covers every
  dependency *class* found, not every column of every table. A new behavioural
  input added later will not announce itself; the mutation matrix is the place
  to extend when one is.
- **A future derived table would reopen hole 1.** V6 names `recruiting_arrivals`
  explicitly, so the next materialisation on an Evidence path has to be added
  deliberately.
- Tables with no Evidence-path consumer today (`graduating_seniors`,
  `programme_seasons`, the conference tables) are outside V6 on purpose. If one
  gains a consumer, it becomes a behavioural input and belongs in the manifest.
