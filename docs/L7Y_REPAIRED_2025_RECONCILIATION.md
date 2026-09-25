# L7Y — the six repaired 2025 squads, reconciled

L7W repaired six programmes' 2025 rosters from season-specific sources and
deliberately left them on disk; L7X made the importer addressable. L7Y spends
that capability once.

**197 rows deleted, 161 inserted, one transaction, six programme-seasons.** Of
9,310 programme-seasons in the database, **six changed and 9,304 are
byte-identical.** No 2026 row moved. No email changed.

---

## Containment

Started at `3be3c4e`, nothing intervening, tree clean. `programme_status` 6,
`roster_gap_reviews` 7, `roster_players` 281,184, coverage 1,748 / 1,731 / 17 /
14 / 3 = 99.0%, manifest `dcfcf4dcb0947b52` under V3, six baselines PASS, P6.
Hashed before: content digests over `roster_players`, `athletics_domains`,
`colleges`, `programme_status` and `roster_gap_reviews`; the manifest's
`roster_freshness` fingerprint; `_targets.csv`; `state2026.json`; six stage
files; all twenty roster sheets. The complete 281,184-row table was captured so
containment could be proved by deep equality rather than by counts.

## Re-deriving the six

Not from the names. The test is L7X's: run the importer's **own** diff over
every programme-season the 2025 sheets hold, and keep those where the sheet and
`roster_players` disagree. L7W rewrote exactly the repaired sheets and did not
import them, so that disagreement *is* the repair — and the derivation shares
one implementation with the import it plans.

```
programme-seasons in the 2025 sheets   2,122
missing / ambiguous                    0 / 0
sheet disagrees with roster_players    6
all season 2025                        true
six-key digest                         1915d8f16003f65f
```

## Dry run, against L7X

Identical in every cell — **zero drift**.

| programme-season | div | sheet | db | +ins | ~upd | −del | =same | prov |
|---|---|---|---|---|---|---|---|---|
| `Boston University\|\|womens-soccer\|\|2025` | D1 | 28 | 34 | 0 | 28 | 6 | 0 | 28 |
| `Drexel\|\|womens-soccer\|\|2025` | D1 | 25 | 31 | 1 | 24 | 7 | 0 | 24 |
| `Iowa\|\|womens-soccer\|\|2025` | D1 | 30 | 28 | 13 | 17 | 11 | 0 | 17 |
| `Murray State\|\|womens-soccer\|\|2025` | D1 | 26 | 36 | 2 | 24 | 12 | 0 | 24 |
| `New Mexico\|\|womens-soccer\|\|2025` | D1 | 27 | 29 | 6 | 21 | 8 | 0 | 21 |
| `Oklahoma State\|\|womens-soccer\|\|2025` | D1 | 25 | 39 | 0 | 25 | 14 | 0 | 22 |
| **totals** | | **161** | **197** | **22** | **139** | **58** | **0** | **136** |

## Source validation — and a correction to my own first check

Every one of the six was put back through **`reference_quality.accept()`**,
L7W's actual contract, against the live page:

| programme | reference | page title | clauses |
|---|---|---|---|
| Boston University W | `goterriers.com/.../roster/2025` | 2025 Women's Soccer Roster | PASS |
| Drexel W | `drexeldragons.com/.../roster/2025` | 2025 Women's Soccer Roster | PASS |
| Murray State W | `goracers.com/.../roster/2025` | 2025 Women's Soccer Roster | PASS |
| Oklahoma State W | `okstate.com/.../roster/2025` | 2025 Cowgirl Soccer Roster | PASS |
| Iowa W | capture `20250908070127` of `hawkeyesports.com/sports/wsoc/roster` | Women's Soccer 2025-26 | PASS |
| New Mexico W | capture `20250910191227` of `golobos.com/sports/wsoc/roster` | Women's Soccer 2025-26 | PASS |

My first pass flagged Iowa and New Mexico as failures, and **that check was
wrong.** It required the URL to be season-pinned — but `season_pinned` is a
*diagnostic* L7W uses to classify stored references, not one of its eight
acceptance clauses. Clause 4 asks whether the **page** names the season, and
both archived captures are titled "2025-26". Reading the two archived
references out of a repair whose whole point was that an archive capture can be
trustworthy would have been precisely backwards. The contract, called directly,
passes all six.

Four pages were stale-refetched (the six-hour TTL had expired) and still serve
their 2025 squads; the two captures came from the immutable cache.

## Scope and execution

```
Boston University||womens-soccer||2025      Murray State||womens-soccer||2025
Drexel||womens-soccer||2025                 New Mexico||womens-soccer||2025
Iowa||womens-soccer||2025                   Oklahoma State||womens-soccer||2025
```

6 entries, all season 2025, no 2026, no wildcards, no other programme. Scoped
mode — `--scope` names the file, so broad mode was never reachable.

`VACUUM INTO` snapshot first: integrity ok, 281,184 rows both sides.

One invocation, no `--dry-run`, no manual SQL, no sheet edits, no code change:

```
APPLIED  197 row(s) deleted, 161 inserted, one transaction
```

## Row movement — planned against actual

| | planned | actual |
|---|---|---|
| rows before / after in scope | 197 / 161 | **197 / 161** |
| inserted | 22 | **22** |
| updated | 139 | **139** |
| deleted | 58 | **58** |
| unchanged | 0 | **0** |

**Actual == planned, cell for cell.** Total table 281,184 → 281,148.

Transaction: 6 attempted, 6 committed, no rollback, no partial commit.

## Containment

```
changed programme-season keys          6
out-of-scope changed keys              0
changed_keys ⊆ scope                   true
programme-seasons compared outside     9,304
deep-equality failures                 0
```

**2026 immunity**, per programme, on complete row sets:

| programme | 2026 rows before/after | +ins | ~upd | −del | source changes | content changes |
|---|---|---|---|---|---|---|
| Boston University | 26 / 26 | 0 | 0 | 0 | 0 | 0 |
| Drexel | 24 / 24 | 0 | 0 | 0 | 0 | 0 |
| Iowa | 28 / 28 | 0 | 0 | 0 | 0 | 0 |
| Murray State | 26 / 26 | 0 | 0 | 0 | 0 | 0 |
| New Mexico | 29 / 29 | 0 | 0 | 0 | 0 | 0 |
| Oklahoma State | 29 / 29 | 0 | 0 | 0 | 0 | 0 |

And everything else: other 2025 programme-seasons **0**, 2024-and-earlier
**0** (the database holds 2022–2026), any other 2026 programme-season **0**,
non-NCAA **0**, men's programmes **0**.

## Source reconciliation

Every one of the six collapses from an assembled reference to a single
season-specific one, with **no old-reference row remaining**:

| programme | old DB sources | new DB source |
|---|---|---|
| Boston University W | 16 distinct (14 bio, 1 bare, 1 empty) | `goterriers.com/.../roster/2025` |
| Drexel W | 15 distinct (13 bio, 1 bare, 1 empty) | `drexeldragons.com/.../roster/2025` |
| Murray State W | 22 distinct (21 bio, 1 bare) | `goracers.com/.../roster/2025` |
| Oklahoma State W | 10 distinct (8 bio, 1 bare) | `okstate.com/.../roster/2025` |
| Iowa W | 1 bare/current | archived capture, page names 2025-26 |
| New Mexico W | 1 bare/current | archived capture, page names 2025-26 |

## Post-import agreement

The same structural diff, re-run across all 2,122 programme-seasons:

```
sheet disagrees with roster_players    0
```

The six discrepancies are gone and no unrelated drift appeared.

## Coverage — unchanged, as required

1,748 / 1,731 / 17 / 14 / 3 = **99.0%**. `historicallyRostered` 1,745,
`reconciles` true, `programme_status` 6, `roster_gap_reviews` 7.

## Diagnostic — one count moved, and not because of this stage

```
 5  TURNOVER_REFUSED     f30707b66167d2c1   (unchanged)
 5  PAGE_PRIOR_SEASON    10f87c5b0d493473   (was 6, e0950f6677785802)
 2  PARSE_ZERO           19e4f9e63f61c61c   (unchanged)
 1  SITE_UNREACHABLE     2869d299087060e6   (unchanged)
 1  WOULD_RESOLVE_NOW    6174b84251206727   (was 0)
```

**CUNY Medgar Evers College W** moved from `PAGE_PRIOR_SEASON` to
`WOULD_RESOLVE_NOW`. The cause is the live web, not this import:

* the **same URL** `mecathletics.com/sports/womens-soccer/roster/2026` was
  titled *"2025 Women's Soccer Roster"* with 9 players during L7W and is titled
  *"2026 Women's Soccer Roster"* with 11 players now — the college published its
  roster between the two runs;
* the diagnostic **never reads `roster_players`**. Its 2025 reference is
  `state.names25()`, which reads the CSV sheets, and the only database string
  anywhere in its import chain is `lib.py`'s HTTP cache directory. L7Y changed
  `roster_players` and nothing else;
* the cache reported 33 stale refetches — the six-hour TTL had expired since
  L7W, so every page was re-read.

Not acquired. It joins the residual cohort for a later stage.

## Evidence — 864 pairs moved, all attributable

The corpus is unchanged in every aggregate: 4,742 pairs, 1,778 personalised,
2,865 rendered sentences, 221 held claims. **0 pairs changed personalisation
and 0 changed claim kinds.**

Four of the six baseline surfaces are **byte-identical**:

| surface | pairs moved |
|---|---|
| OUTBOUND_DECISION | **0** |
| COACH_COMPOSITION | **0** |
| EMAIL_BODY | **0** |
| OPERATOR_WIRE | **0** |
| LOG_PAYLOAD | 864 |
| OPERATOR_EVIDENCE | 864 |

Only the women's-soccer athlete moved — 864 of her 1,235 pairs. The three men's
athletes: **0 of 1,169 each**, which is what it should be, since all six
repaired programmes are women's soccer.

The 864 split cleanly by cause:

| cause | pairs |
|---|---|
| the shared pool block only | **859** |
| one of the six repaired programmes, own development data | **4** |
| a band that turned on the pool shift | **1** |

`PROGRAMME_POOL_BENCHMARK` carries `source: 'roster_players:pool-benchmarks'` —
cross-programme percentiles over a pool of 1,045 women's programmes. Changing
six programmes' 2025 rows nudged two of them:

```
pool.p25                  997  ->  998
poolDials.newcomer.p75   14.7  -> 14.6
```

`n`, `median` and `rank` did not move. Every women's pair carries that block,
which is the whole of the 859.

**Two comparison bands changed**, both explained exactly:

* **Drexel** `at-or-below-p25 → p25-to-median` — its own `programmeMedian`
  moved 745 → 1069 because its 2025 roster changed. One of the six; the
  intended consequence of the repair.
* **Saint Mary's** `p25-to-median → at-or-below-p25` — its median is
  **unchanged at 998**; the pool's p25 moved 997 → 998 and the test is
  `median <= pool.p25`, so a programme sitting exactly on the boundary crossed
  it. A one-unit boundary effect, internal to operator surfaces.

## Email safety

**Zero.** `EMAIL_BODY` and `COACH_COMPOSITION` moved for no pair, and
re-rendering every body confirms **0 differ**. There are no emails to classify:
GOOD 0, ACCEPTABLE 0, WEAK 0, BAD 0 — because none changed. No copy policy was
touched and P6 is unchanged.

## Manifest and baselines

Predicted before measuring: `roster_players` must move; `roster_freshness` must
**not**, because it is derived as one `MAX(updated_date)` per
`(college_name, sport)` over the *current* season and this import wrote only
2025; everything else unchanged.

| table | before | after | |
|---|---|---|---|
| roster_players | 281,184 | 281,148 | **CHANGED** |
| roster_freshness (2026) | 2,059 | 2,059 | unchanged |
| players, colleges, coaches, athletics_domains, programme_status | | | unchanged |

Every prediction held. The 2025 freshness aggregate did move, and it is **not**
part of the manifest — recorded as an observation, not a movement.

Manifest `dcfcf4dcb0947b52` → **`4955986edd3bc976`**. Repinned after
attribution: only `LOG_PAYLOAD` and `OPERATOR_EVIDENCE` moved, and the four
coach-facing digests were re-pinned to the identical values they already held.

## Live-data immunity

Only `roster_players` changed. Byte-identical: all twenty roster sheets,
`_targets.csv`, `state2026.json`, all six stage files, `programme_status`,
`roster_gap_reviews`, `athletics_domains`, `colleges`, and the 2026
`roster_freshness` fingerprint.

`importRosterSheets.js`, its tests and `shared/roster/` are **unchanged against
`3be3c4e`** — no scoping, transaction, dry-run, delete or provenance logic was
touched.

## Remaining provenance debt

Carried forward unchanged: **641 of 2,123** accepted 2025 rosters fail L7W's
historical-reference contract, concentrated in D1 at 65.7%. Not repaired here.
The prospective hardening item remains valid and unimplemented: `run.build()`
already has the page's declared season, the cache's `fetched_at` and the parser
in hand, and persisting them as `Source Page Season`, `Source Fetched At` and
`Source Parser` is what would stop the pattern recurring.
