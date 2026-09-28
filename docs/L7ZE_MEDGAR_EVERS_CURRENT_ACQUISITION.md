# L7ZE — CUNY Medgar Evers College, 2026 current acquisition

One programme. Eleven players. **The first live acquisition since L7Z, and the
production proof that prospective provenance is captured rather than
reconstructed: 11 of 11 rows round-tripped exactly, zero nulls.**

Coverage 1,731 → **1,732** of 1,748 (99.0% → **99.1%**). Residual
`WOULD_RESOLVE_NOW` 1 → **0**.

Starting SHA `5538220` (L7ZC).

---

## Structural derivation — the target was not taken from the brief

The brief names Medgar Evers. The target was derived without it, because a
cohort selected from a name in a document is a hand-picked cohort wearing a
number.

1. `server/scripts/rosterGapQueue.js --json` → the 17 NCAA programmes with no
   2026 roster, straight from `roster_players` and `colleges`.
2. Those 17 keys → `diagnose_cohort.py` (`L7U/ladder-walk-evaluate/v2`), which
   asks the production gate's own question of every rung of every ladder.

```
17 diagnosed  (L7U/ladder-walk-evaluate/v2)
     7  PAGE_PRIOR_SEASON      digest 2222ebc2c3d4e466
     5  TURNOVER_REFUSED       digest f30707b66167d2c1
     2  PARSE_ZERO             digest 19e4f9e63f61c61c
     2  SITE_UNREACHABLE       digest ffcf612e911b4103
     1  WOULD_RESOLVE_NOW      digest 6174b84251206727
```

**Exactly one `WOULD_RESOLVE_NOW`**, and it resolved to
`CUNY Medgar Evers College || womens-soccer`, NCAA D3. Identity, sport and
gender all came out of the walk, not the prompt.

### Reconciliation with the L7Y residual

The brief's L7Y residual sums to 14; this cohort is 17. The difference is
exactly the three never-rostered programmes, which the gap queue includes in
*current-season* gaps and L7Y's historical-only figure did not. Restricting
this classification to the 14 historical-only keys reproduces L7Y **exactly**:

| class | L7Y | L7ZE over the same 14 |
|---|---|---|
| WOULD_RESOLVE_NOW | 1 | **1** |
| TURNOVER_REFUSED | 5 | **5** |
| PAGE_PRIOR_SEASON | 5 | **5** |
| PARSE_ZERO / ZERO_PLAYERS | 2 | **2** |
| SITE_UNREACHABLE / SITE_UNAVAILABLE | 1 | **1** |

Nothing in the residual has moved since L7Y except the one programme this stage
acquires.

---

## Source verification

The programme's page changed externally. Durable state still carried the
refusal from the last attempt:

```
page season is not 2026 (title="2025 Women's Soccer Roster - Medgar Evers College Athletics")
```

The same URL now serves:

| | |
|---|---|
| URL | `https://mecathletics.com/sports/womens-soccer/roster/2026` |
| HTTP | **200**, 438,337 bytes |
| title | `2026 Women's Soccer Roster - Medgar Evers College Athletics` |
| `lib.season_ok(title)` | **strictly `True`** |
| `lib.sport_contradicted(title, 'womens-soccer')` | **`None`** — not contradicted |
| institution | named in the page's own title |
| gender | carried by sport identity; no separate axis |
| cache | `fetched_at` **2026-09-18T21:38:34Z**, age **7,546 s**, TTL 21,600 s → **FRESH** |

Not a bio page, not a mixed roster, not another institution, not a prior or
future season. The cache entry is 2.1 hours old against a six-hour TTL, so it is
fresh under the L7U contract — serving it is the contract working, not a
shortcut, and it is not the stale L7Y evidence the brief warned against.
Forcing a refetch would have *deviated* from the semantics the hardened pipeline
uses for a real acquisition.

---

## Source authority

Nothing was loosened, and nothing needed an exception.

The candidate is not a new source. It is `Method: year-swap (direct)` applied to
the programme's **own known-good 2025 roster URL** on the **same host**:

```
Roster URL 2025 (known good)  https://mecathletics.com/sports/womens-soccer/roster/2025
Roster URL 2026 (candidate)   https://mecathletics.com/sports/womens-soccer/roster/2026
candidateState                EXISTING_CANDIDATE
rung                          ordinal 0 — the first rung of the ladder
```

### The registry says the host is not identity-verified, and that is correct

```
athletics_domains: mecathletics.com
  status INSUFFICIENT_EVIDENCE   confidence NONE   unitid NULL
  classifyRow(STRICT)    -> INSUFFICIENT_IDENTITY
  classifyRow(DISCOVERY) -> INSUFFICIENT_IDENTITY
```

These are two different gates and both were honoured:

- **Acquisition** authority is the programme's own prior host plus the
  structural year-swap rung. Satisfied.
- **Provenance-link** authority (H12/H16, `domainAuthority`) decides whether
  Evidence may show a clickable `sourceUrl`. `mecathletics.com` is not TRUSTED,
  so this programme's Evidence correctly carries **no provenance link**.

Not loosening the second to reward the first is the point. The roster is
acquired; the link is withheld; both are right.

---

## Acquisition

Run scope was one key. `plan.py` before anything was written:

```
TO ATTEMPT             1
excluded by scope      105  (left eligible for a future run)
attempt set by division x sport:   1  NCAA D3  womens-soccer
```

`./run_season_current.sh 2026 2025 --keys <1 key>` — no manual URL, no parser
override, no forced refresh, no code change.

```
[direct] complete: 1 processed   {'ok': 1}
2060 done, 0 remaining
```

L7S containment visible at every absorb: **44, 22 and 25 out-of-scope records
refused** against a scope of one key. The later stages had nothing to do.

`verify_gate.py` re-measured all 2,035 done rosters against the gate in force
now and **demoted 0**; the eight kept at 85–92% are the same eight the L7Q
graduation-year rule has admitted since it was written. Worth stating because
this pass walks *all* durable state, not the run scope — it is the one step in
the runner that could have touched another programme, and it did not.

| | |
|---|---|
| parser | `sidearm-html` |
| players | **11** |
| confidence | **High** |
| overlap with 2025 | **18%** (2 of 11), far below the 0.85 gate |
| note | `direct read of official 2026 roster page; 2025 name overlap 18%` |

11 is what the page says. It was not forced to match the brief's estimate.

---

## Provenance capture (L7Z, first live proof)

Captured at acceptance, **before** any write, from the objects `run.build`
produced:

| field | value | where it came from |
|---|---|---|
| `Source Roster URL` | `https://mecathletics.com/sports/womens-soccer/roster/2026` | the accepted URL |
| `Source Page Season` | `2026` | set only because `lib.season_ok(title)` is strictly `True` |
| `Source Fetched At` | `2026-09-18T21:38:34Z` | `lib.fetched_at()`, the cache sidecar |
| `Source Parser` | `sidearm-html` | the parser that actually read the page |

Nothing was reconstructed afterwards. The acquisition-time values were written
to disk before the import ran and compared against the database afterwards.

---

## Sheet

`ncaa_d3_womens_soccer_2026_rosters.csv` — 11,296 → **11,307** rows.

Nine of the ten 2026 sheets are **byte-identical**; `write_out.py` only
regenerates a file whose contents changed.

### The header widened, and that is L7Z arriving in the file

The sheet was still **pre-L7Z: 16 columns**. `write_out.HDR` has carried 19
since L7Z, and this is the first regeneration of this file since. So the
rewrite appended `Source Page Season`, `Source Fetched At`, `Source Parser`.

Measured rather than asserted — all 11,296 pre-existing rows matched on
`(School, Player Name)` and compared field by field:

```
fields differing across common identities:  (none)
```

Not one original value moved. The pre-existing rows gained three **empty**
cells:

```
target (11)   populated(season, fetched, parser) -> {(True, True, True): 11}
other 11,296  populated(season, fetched, parser) -> {(False, False, False): 11296}
```

Unknown stayed unknown. That is the L7Z contract — no backfill, no guess — doing
its job on its first contact with a legacy file.

### Row validation — 9 of 9

| check | result |
|---|---|
| school is the target | PASS |
| credible player name | PASS |
| `Source Roster URL` == accepted URL | PASS |
| `Source Page Season` == 2026 | PASS |
| `Source Fetched At` is ISO-8601 Z | PASS |
| `Source Parser` == `sidearm-html` | PASS |
| position present on every row | PASS |
| no duplicate names | PASS |
| no fabricated minutes (season unplayed) | PASS |

Positions normalise to the four-value vocabulary (Goalkeeper, Defender,
Midfielder, Forward). The graduation-year convention (`Fr.`→2031, `Jr.`→2029,
`Sr.`→2028) was checked against the other 11,296 rows of the same sheet and
**matches it exactly** — the locked rule was applied, not re-derived.

---

## Scoped import

```
CUNY Medgar Evers College||womens-soccer||2026
```

One entry. `--scope` names a file, so broad mode was unreachable. Dry run first:

```
DRY RUN — season 2026, 1 scope entry
  matched 1, missing 0, ambiguous 0
  CUNY Medgar Evers College||womens-soccer||2026   NCAA D3   11    0    11     0     0       0     0
  totals   sheet rows 11   db rows 0   +11 ~0 -0 =0
  nothing was written.
```

Then once, atomically:

```
SCOPED IMPORT — season 2026, 1 scope entry
  APPLIED  0 row(s) deleted, 11 inserted, one transaction
```

| | planned | actual |
|---|---|---|
| sheet rows | 11 | **11** |
| db rows before | 0 | **0** |
| inserts | 11 | **11** |
| updates | 0 | **0** |
| deletes | 0 | **0** |
| unchanged | 0 | **0** |

**Actual equals plan.** No second import, no manual SQL.

---

## Containment

Deep-equality against the pre-import `VACUUM INTO` snapshot, every
programme-season keyed on `(college_name, sport, season)` and digested over
every column except `id` and `created_date`:

```
programme-seasons  before 9310   after 9311
ADDED   1: CUNY Medgar Evers College||womens-soccer||2026
CHANGED 0
REMOVED 0
deep-equal programme-seasons: 9310 of 9310
```

| slice | keys | moved |
|---|---|---|
| 2026, other than the target | 2,059 | **0** |
| 2025 | 2,122 | **0** |
| pre-2025 | 5,129 | **0** |
| men's soccer, all seasons | 3,966 | **0** |

Filesystem containment is the same shape:

| artifact | before | after | changed |
|---|---|---|---|
| durable state entries | 2,138 | 2,138 | **1** — the target, `failed` → `done` |
| `_targets.csv` rows | 2,165 | 2,165 | **1** — the target, Status and Notes |

---

## Provenance round trip

Read back from the database and compared against the acquisition-time values
captured before the write:

```
source_roster_url    ["https://mecathletics.com/sports/womens-soccer/roster/2026"]
source_page_season   ["2026"]
source_fetched_at    ["2026-09-18T21:38:34Z"]
source_parser        ["sidearm-html"]
nulls: {"source_roster_url":0,"source_page_season":0,"source_fetched_at":0,"source_parser":0}

EXACT round trip: 11 of 11
```

**Nothing null, nothing reconstructed, nothing altered.** This is the production
proof L7Z was built for, and it took a real acquisition to get it — L7Z could
only test the transport, not the journey.

---

## Coverage

| | before | after |
|---|---|---|
| active NCAA programme identities | 1,748 | **1,748** |
| current 2026 rostered | 1,731 | **1,732** |
| current missing | 17 | **16** |
| historical-only | 14 | **13** |
| never-fetched / unresolved | 3 | **3** |
| coverage | 99.0% | **99.1%** |
| registry duplicates | 7 | 7 |
| reconciles | yes | **yes** (1,732 + 7 + 16 = 1,755) |

---

## Residual diagnostic

```
16 diagnosed  (L7U/ladder-walk-evaluate/v2)
     7  PAGE_PRIOR_SEASON      digest 2222ebc2c3d4e466
     5  TURNOVER_REFUSED       digest f30707b66167d2c1
     2  PARSE_ZERO             digest 19e4f9e63f61c61c
     2  SITE_UNREACHABLE       digest ffcf612e911b4103
```

**`WOULD_RESOLVE_NOW`: 0.** Medgar Evers is gone from the residual gaps, and
the other four class digests are **byte-identical** to the pre-acquisition run
— so nothing else in the residual shifted while this one was acquired.

Remaining identities, none of them acquired:

| class | programmes |
|---|---|
| PAGE_PRIOR_SEASON (7) | Bryn Athyn (M), Bryn Athyn College of the New Church (W), CUNY York College (W), Eastern New Mexico (M), Montevallo (W), SCAD (M), San Francisco State (M) |
| TURNOVER_REFUSED (5) | Arkansas (W), Frostburg State (M), Miami (FL) (W), Vanderbilt (W), Virginia (W) |
| PARSE_ZERO (2) | Bradley (M), George Mason (M) |
| SITE_UNREACHABLE (2) | New Jersey City University (W), University of Valley Forge (W) |

---

## Manifest

Predicted before measuring: `roster_players` moves, `roster_measurements`
moves, `roster_freshness` moves for a newly current programme, everything else
holds.

| component | rows | verdict |
|---|---|---|
| `players` | 4 | unchanged |
| `colleges` | 2,404 | unchanged |
| `roster_players` | 281,148 → **281,159** | **MOVED** |
| `coaches` | 6,347 | unchanged |
| `athletics_domains` | 2,723 | unchanged |
| `programme_status` | 6 | unchanged |
| `roster_freshness` | 2,059 → **2,060** | **MOVED** |
| `roster_measurements` | 281,148 → **281,159** | **MOVED** |

Manifest V4 `3854e1ec19d88c23` → **`7d256f519c130dd6`**. Repinned: **YES**, and
every moved component is one that owns the eleven new rows. Exactly three, and
exactly the three predicted.

---

## Evidence impact

One pair, and it is the acquired programme:
`QA Fixture (women's soccer) | CUNY Medgar Evers College`.

| | |
|---|---|
| canonical pairs affected | **1** of 4,742 |
| claim kinds gained | `INTERNATIONAL_ROSTER`, `POSITION_GROUP_SIZE` |
| claim kinds lost | none |
| generic → personalised | **0** |
| personalised → generic | **0** |
| operator `evidenceCount` | 6 → **8** |
| `ROSTER_OPPORTUNITY` | 0 → **1** |
| `RECRUITMENT_PATHWAY` | 1 → **2** |
| programme freshness | `UNKNOWN` (*"no scrape date on these roster rows"*) → **`CURRENT`**, `ageDays 0` |

Both new kinds are `NOT_LICENSED` for outreach, which is why an eight-claim
programme still writes the same email as a six-claim one.

The freshness transition is the real product change: this programme's Evidence
had been reasoning about a squad nobody could date, and now it is current.

Corpus totals did not move — 1,778 personalised, 2,964 generic, 2,865 rendered
sentences, 221 held claims, RELATIONSHIP_FIRST 536, PLAYER_FIRST 4,206 — and
the rendered/recorded invariant reports no contradictions.

---

## Email QA — not required

| | |
|---|---|
| EMAIL_BODY | `4aac6a70ab6fab9c` → `4aac6a70ab6fab9c` — **byte-identical** |
| COACH_COMPOSITION | `279d05a0d284f577` → `279d05a0d284f577` — **byte-identical** |
| emails changed | **0** |
| GOOD / ACCEPTABLE / WEAK / BAD | 0 / 0 / 0 / **0** |

No coach-facing byte moved, so there was nothing to review. Both new claim
kinds are outreach-denied, and the permission table is what made a new roster
invisible to the email — measured, not assumed.

---

## Pool benchmark — 0 movement

2026 is excluded from `PROGRAMME_POOL_BENCHMARK`'s 2022–2025 window, so
acquiring a 2026 roster must move nothing. Verified against the values L7ZA
locked and L7ZC reported:

| | before | after |
|---|---|---|
| men's `programmes` / rank-1 `n` | 920 / 770 | **920 / 770** |
| men's rank-1 p25 / median / p75 | 901 / 1118 / 1289 | **901 / 1118 / 1289** |
| women's `programmes` / rank-1 `n` | 1,202 / 1,045 | **1,202 / 1,045** |
| women's rank-1 p25 / median / p75 | 998 / 1200 / 1375 | **998 / 1200 / 1375** |

Every rank, every dial, both sports: identical.

---

## Baselines

| surface | before | after | moved |
|---|---|---|---|
| OUTBOUND_DECISION | `16f5e4cdfb4af7f8` | `584ee4030bac43af` | yes |
| COACH_COMPOSITION | `279d05a0d284f577` | `279d05a0d284f577` | **no** |
| EMAIL_BODY | `4aac6a70ab6fab9c` | `4aac6a70ab6fab9c` | **no** |
| OPERATOR_WIRE | `acd24a40f554bcc7` | `fe7cc83f81db23d1` | yes |
| LOG_PAYLOAD | `5c92cdb5f022b03e` | `6927bca2da9d7ecf` | yes |
| OPERATOR_EVIDENCE | `eb1dda78195fca4f` | `51f95645e24c2bb3` | yes |

Attribution: each of the four moved surfaces differs on **exactly one line of
4,742**, and it is the same line on all four — the Medgar Evers pair. Every
changed JSON path is that programme's new claims, its new operator sections or
its freshness transition. No unrelated pair moved on any surface.

Repinned: **YES**, four surfaces. P6 unchanged; no policy, permission,
threshold or copy was touched.

---

## Programme status and reviews

| table | before | after |
|---|---|---|
| `programme_status` | 6 rows `4e84caabfc568577` | **identical** |
| `roster_gap_reviews` | 7 rows `0ff82ba6889a11df` | **identical** |
| `colleges` | 2,404 rows `b558769138b04ee3` | **identical** |
| `athletics_domains` | 2,723 rows `3a3d9871d7b3cc88` | **identical** |

No review was created. The existing workflow records one when an operator
dispositions a gap, and a successful acquisition is not a disposition — the
programme simply leaves the queue. Nothing was written by hand to mark the
success.

---

## Unexpected findings

**Nine of the ten 2026 sheets are still pre-L7Z (16 columns).** `write_out.py`
only regenerates a file whose contents changed, so the three provenance columns
reach a sheet the first time one of its programmes is re-acquired. The sheets
are therefore inconsistent in shape until every division sees an acquisition.
Nothing is wrong with the data — the importer reads missing columns as absent,
not empty-string — but a reader comparing two sheets will find different
headers. Deliberately not fixed here: regenerating nine files for no data
reason would have put 60,000 unrelated rows into this stage's diff.

**`verify_gate.py` walks all durable state, not the run scope.** It is the only
step in the hardened runner that could move a programme outside the cohort. It
demoted 0 here and it was checked read-only *before* the run rather than trusted
— but the asymmetry is worth recording: every other stage is scoped and this one
is global by design.

**The domain registry and the acquisition pipeline disagree about this host,
and both are right.** `mecathletics.com` is `INSUFFICIENT_EVIDENCE` /
`INSUFFICIENT_IDENTITY`, so Evidence will show no provenance link — while the
acquisition proceeded on the programme's own prior host. Two gates, two
questions, neither loosened for the other.

**`OUTBOUND_DECISION` moved while `COACH_COMPOSITION` and `EMAIL_BODY` did
not.** The decision surface records dispositions for every kind the selector
saw, including the ones it refused, so two new outreach-denied kinds move it
without changing a word any coach reads. That split is the permission model
being legible rather than a surface behaving oddly.
