# L7T — twenty-three clean wins, and the cache that was hiding eighty-three more

Coverage **1,621 → 1,644** of 1,748 identities (92.7% → **94.0%**). Twenty-three
programmes resolved, twenty-three imported, **zero** failures, and no
engineering change to any parser, candidate, gate or authority.

Two things this stage found are worth more than the rosters:

1. **Two of the twenty-five "clean wins" were not clean.** Oklahoma State's
   accepted page is an equestrian roster and Drexel's is two seasons
   concatenated. Both pass every production gate today.
2. **`lib.fetch` has no cache TTL**, so the diagnostic that classified the
   cohort — and a "live" run — read pages cached 23 days earlier. On fresh
   pages, **83 of the remaining 101 would resolve now**, where the same
   classification on stale pages called 83 of them "still serving last season".

---

## Containment

Started at `3298dcf`, nothing intervening, tree clean. `programme_status` 6 rows,
`roster_gap_reviews` 7, `roster_players` 277,866, coverage 1,621 / 127 / 124 / 3,
manifest `e2695737104c00b4` under V3, six baselines PASS. Hashed before the run:
`_targets.csv`, `_state`, all ten roster sheets, and all six stage-result files
(70 records, 23 distinct keys).

## Deriving the cohort, not reading it

The historical-only cohort re-derives structurally to **124**, with the three
never-fetched programmes excluded by the "roster for the season before" clause.

`WOULD_RESOLVE_NOW` is now a **committed script** rather than a count in a
document: `tools/roster_pipeline/diagnose_cohort.py`, algorithm
`L7R/ladder-walk-evaluate/v1`. It walks each programme's real ladder, asks
`run.evaluate` the production question of every rung in order, and stops at the
first rung that passes. Read-only — one JSON report, no state, no sheet, no row.

It exists because a cohort selected from names in a stage document is a
hand-picked cohort wearing a number. Re-run over the 124 it reproduces L7R
exactly:

```
 83  PAGE_PRIOR_SEASON    digest 40fd3b6c8d9f2e5d
 25  WOULD_RESOLVE_NOW    digest 0ade0b1380b64322
  9  TURNOVER_REFUSED     digest 4430c27f652b7cdb
  5  THIN_PARSE           digest 8cb1de8f89dc00ec
  2  PARSE_ZERO           digest ab012786635eb76a
```

The 25 are a clean tranche: 0 overlap with the other four mechanisms, 0
never-fetched, 0 `NOT_ACTIVE`/`FUTURE`, 0 registry duplicates, 0 carrying an
operator review, 0 already holding a 2026 roster.

## Two of the twenty-five were not acquirable safely

Before running anything, two mechanical checks were defined and applied to all
twenty-five identically:

1. the accepted page's title must not name a sport other than soccer;
2. a Nuxt payload must declare at most one non-empty `players` container.

| refused | what the accepted rung actually serves |
|---|---|
| **Oklahoma State W** | `/sports/womens-soccer/roster/season/2026` → **"2026-27 Cowgirl Equestrian Roster"**: 90 athletes, no positions, **1%** name overlap with the 2025 squad |
| **Drexel W** | the same URL shape, payload declaring **two** `players` containers (24 + 24) — two seasons read as one squad, hence **50%** overlap |

In both cases the *correct* page sits one rung earlier and was refused by the
turnover gate — Oklahoma State at 90%, Drexel at 100%. So the pipeline walks
past the right page and accepts a wrong one **because** the wrong one is
unrelated: **an unrelated squad reads as total turnover.** The turnover gate
guards the high-overlap direction and nothing guards the low one.

Both are read by `parse_nuxt`, whose camelCase scan walks the whole payload
instead of anchoring on a container. The `nuxt-roster` reader added in L7R does
anchor and refuses a multi-container payload — which is exactly why Notre Dame
M and W are safe here. Correcting these two needs a parser change, which
**STOP condition 10 ("acquisition requires a code fix") places outside L7T**.

The live pass therefore ran **23, not 25**. That is a stated narrowing under the
brief's own stop condition and Phase 12's success-validation requirement, not a
selection preference: the criterion was fixed in advance, is mechanical, and was
applied to every member of the cohort. Both programmes remain in the
historical-only cohort.

## The cache with no TTL

The 25's accepted pages were all cached, and the cache was **23 days old**.
`lib.fetch` writes a body and never expires it, so:

- the diagnostic that classified the cohort read late-August pages;
- a "live" run would have replayed them.

The 91 cached copies for the 23's ladder URLs were removed before the run so the
pass actually exercised the network. It mattered: several squads had grown
since August — Augustana 28 → **46**, Wisconsin-Stevens Point 29 → **47**,
Carleton 17 → **32**, Virginia Wesleyan 13 → **30**. Without clearing it, L7T
would have imported 23 partial rosters and called them current.

Nothing about the cache was changed. It is reported as debt.

## The run

`./run_season_current.sh 2026 2025 --keys <23>` — the normal production
pipeline: no manual URL injection, no source or parser override, no hand repair,
no code change during the run.

```
TO ATTEMPT 23     other historical-only 0   other NCAA 0
                  never-fetched 0            non-NCAA 0
run_scope == the 23 keys == TO ATTEMPT
```

**23 resolved, 0 failed (100%).** 17 at the `direct` stage, 6 at `variants`.
Every one landed on its own 2025 host, on a page naming 2026, with a healthy
graduation-year consistency.

And L7S's containment became observable in production for the first time:

```
absorbed from state_variants_2026.json  {'out-of-scope': 23, 'resolved': 6}
                                        scope 23 key(s), 23 out-of-scope record(s) refused
absorbed from st_sel_2026.json          scope 23 key(s), 22 out-of-scope record(s) refused
absorbed from st_br2026_*.json          scope 23 key(s), 25 out-of-scope record(s) refused
```

L7Q's graduation-year rule also proved load-bearing: `verify_gate` kept **eight**
high-overlap rosters that the name gate alone would have demoted, seven of them
newly acquired — East Tennessee State at 92%, Holy Cross 90%, Staten Island 86%,
Ferrum, Tufts, Delaware State and Southeastern Louisiana at 85%. Without L7Q,
seven of these twenty-three would have been thrown away.

### Every success validated

Eight checks, all 23 passing all eight: official host is the 2025 host · page
names season 2026 · no other sport in the title · gender agrees with the key ·
player floor · turnover/currentness · parser accepted · no manual intervention.

*(One flag in the first pass was my own check's bug, not the data:
`'womens-soccer'.endswith('mens-soccer')` is true, so Notre Dame W was tested
with the men's rule. The same suffix trap L7S guards against with exact key
equality.)*

## Containment after the run

**State.** 31 keys have changed since before L7R. 7 are L7R's seven, 23 are
L7T's twenty-three, and the single remainder is **Bentley's `tried` 3 → 6 —
L7R's leak, unchanged by L7T**. So L7T's out-of-scope changed state keys: **0**.
Witnesses: Bentley `done`/6, SMSU `failed`/12, Trinity `done`/0, Northwood
`done`/0 — none in scope, none touched. Max `tried` across all 2,138 state keys
is 12, exactly `TRIED_MAX`. No key created.

**Stage files.** Five of six byte-identical; `state_variants_2026.json` grew
23 → 29 records (+6, all L7T keys). Every pre-existing record retained —
resumability works as designed, and the scope is what keeps it harmless.

**Roster output.** NAIA, USCAA and D2 men byte-identical. Against the pre-run
snapshot the content digest of every non-L7T 2026 row is identical, and no
closed season moved (218,938 both sides). `colleges` 2,404, inactive 3,
`programme_status` 6, `roster_gap_reviews` 7, `athletics_domains` 2,723 — all
unchanged.

**Import.** 23 programmes, **+718 rows** — exactly the sum of the 23 squads —
0 changed, 0 removed.

## Coverage

| | before | after |
|---|---|---|
| active identity denominator | 1,748 | **1,748** |
| holding a 2026 roster | 1,621 | **1,644** |
| missing a 2026 roster | 127 | **104** |
| identity-level coverage | 92.7% | **94.0%** |
| historical-only cohort | 124 | **101** |
| never-fetched | 3 | **3** |

Phase 18's all-25 projection was 1,646 / 102 / 99 / 94.2%. The result is exactly
two programmes short of it, which is the two refused.

## What the remaining 101 actually look like

Re-diagnosed **on fresh pages**, after clearing 387 stale cached copies:

| mechanism | before (stale cache) | after (fresh) |
|---|---|---|
| **WOULD_RESOLVE_NOW** | 25 → *ran* | **83** |
| PAGE_PRIOR_SEASON | 83 | **7** |
| TURNOVER_REFUSED | 9 | 8 |
| THIN_PARSE | 5 | 0 |
| PARSE_ZERO | 2 | 2 |
| SITE_UNREACHABLE | — | 1 |

**The 83-programme "publication problem" was a cache artefact.** Those sites had
published their 2026 rosters; the pipeline was looking at August. The five
`THIN_PARSE` cases resolved the same way — their pages had filled in.

### WOULD_RESOLVE_NOW (83)

D3 79 · D2 2 · D1 2. M 35 · W 48. SIDEARM 78, PRESTO 1, unrecorded 4. Shape:
`roster/<year>` 75, `<span>/roster` 5, `roster` 3. Parser: `sidearm-html` 76,
`table` 5, `nuxt` 2. **81 of 83 resolve at rung 0.** 2,595 players waiting.
Trusted host 68/83.

Two of the 83 are Oklahoma State and Drexel, which this stage refused, so the
genuinely clean next-stage cohort is **81**. Two more read over 45 players
(West Virginia Wesleyan 54, Carthage 48) and deserve the same validation before
import.

### PAGE_PRIOR_SEASON (7) — the genuine ones

All seven have a 2026 candidate; **none lacks one**. All seven serve an earlier
season at it: Medgar Evers, York, SCAD and Montevallo show 2025; Eastern New
Mexico and San Francisco State show **2024**. Boston University's best rung
serves **"2025-26 Men's Rowing Roster"** — the same wrong-sport route as
Oklahoma State, caught here only because the season gate fired first.

D1 1 · D2 3 · D3 3. M 3 · W 4.

### TURNOVER_REFUSED (8) · PARSE_ZERO (2) · SITE_UNREACHABLE (1)

The eight are the known high-overlap group, seven of them D1 women: Iowa, Murray
State, Vanderbilt, Virginia, New Mexico, Miami (FL), Arkansas and Frostburg
State. Only Frostburg is a genuine served-back page; the rest are the
reference-quality debt. `PARSE_ZERO` remains Bradley and George Mason behind
`roster.aspx`. `SITE_UNREACHABLE` is Valley Forge, whose athletics host still
does not resolve.

## Evidence and email

| | |
|---|---|
| pairs affected | **43** — exactly 10 men's programmes × 3 men's athletes + 13 women's × 1 |
| on a non-L7T programme | **0** |
| generic → personalised | **6** |
| supplemented | 0 |
| rendered sentences | 2,848 → 2,854 |
| held claims | 221, unchanged |
| email bodies changed | 6 |

Every claim verified against the rows actually imported:

| pair | claim | in the data |
|---|---|---|
| QA Fixture → East Tennessee State | one midfielder graduating 2027, Natalie Capannelli | exactly 1 |
| QA Fixture → Holy Cross | one midfielder graduating 2027, Sam Halligan | exactly 1 |
| QA Fixture → Husson University | one midfielder graduating 2027, Marila Corletto | exactly 1 |
| QA Fixture → Southeastern Louisiana | one midfielder graduating 2027, Olivia Quiroz | exactly 1 |
| Rhys Davies → Babson | one defender graduating 2027, Jackson Price | exactly 1 |
| Ryan Billings → Babson | one defender graduating 2027, Jackson Price | exactly 1 |

Each names a real player at the athlete's own position with the correct
graduation year, and each counting claim is exact.

**GOOD 6 · ACCEPTABLE 0 · WEAK 0 · BAD 0.** P6 unchanged, no copy policy touched.

## Manifest and baselines

Predicted before repinning and confirmed, including which five tables could not
move:

```
e2695737104c00b4  ->  6e68f353df74ff3d   (V3)

roster_players     278,584 rows   (+718)
roster_freshness     1,972 rows   (+23)
players, colleges, coaches, athletics_domains, programme_status   unchanged
```

All six behavioural surfaces moved, including EMAIL_BODY and COACH_COMPOSITION —
permitted here because the movement is data-driven, attributed to 43 pairs on
L7T programmes with none outside, and the six new emails pass QA. Repinned after
attribution; six PASS afterwards.

## Defects found and NOT fixed

1. **`parse_nuxt` does not anchor on a roster container**, so a multi-container
   payload reads as one squad and a wrong-sport page can be accepted.
   Oklahoma State and Drexel are the worked examples.
2. **The turnover gate has no low-overlap guard.** A page unrelated to the
   programme passes precisely because it shares no names.
3. **`lib.fetch` has no cache TTL.** A run described as live can replay a
   three-week-old page, and any diagnostic built on it inherits the staleness.
   This one mis-classified 83 programmes.
4. **A bio-page candidate leads somewhere arbitrary.** Boston University's rung
   lands on men's rowing; Oklahoma State's 404s and falls through to equestrian.

Carried forward untouched, as instructed: the George Mason / Bradley Sidearm Vue
parser and query-string source advancement; historical reference quality
(the Iowa-type mixed reference); `build_targets.py` rewriting the worklist on
import; the Trinity advisory verifier; the `verify_gate` named-demotion API;
the `verified:true` authority cleanup; the seven registry duplicates;
Mississippi Christian; the three never-fetched programmes.

## Next stage

**Acquire the 81.** They are the same kind of work L7T just did — 81 of 83 resolve
at the first rung, on their own trusted hosts, with the shipped parsers and gates
— and run-scope containment is now proven in production. Two preconditions,
both cheap:

- **give `lib.fetch` a TTL** (or a per-run bypass), because without it the next
  classification is stale before it is read;
- **apply L7T's two validation checks inside the diagnostic**, so a wrong-sport
  or multi-container read is never labelled a clean win again. Oklahoma State
  and Drexel are still in the 83 precisely because the diagnostic does not know
  these checks.

After that, the eight `TURNOVER_REFUSED` (reference quality) and the joint
Sidearm-Vue-plus-candidate stage for Bradley and George Mason.
