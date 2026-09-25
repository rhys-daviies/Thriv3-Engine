# L7ZF — PAGE_PRIOR_SEASON resolution

**Nothing was acquired, and that is the finding.** All seven programmes'
official sites state, in their own season menus, that a 2026 roster does not
exist. `A = 0`, so no acquisition ran.

No dataset moved. No roster row, sheet row, state entry, manifest component,
baseline digest or pool value changed. Coverage stays 1,732 of 1,748 (99.1%).

Starting SHA `886ee2e` (L7ZE).

---

## The structural cohort

Derived, not taken from the brief: `rosterGapQueue --json` → the 16 NCAA
programmes with no 2026 roster → `diagnose_cohort.py`
(`L7U/ladder-walk-evaluate/v2`).

```
16 diagnosed  (L7U/ladder-walk-evaluate/v2)
     7  PAGE_PRIOR_SEASON      digest 2222ebc2c3d4e466
     5  TURNOVER_REFUSED       digest f30707b66167d2c1
     2  PARSE_ZERO             digest 19e4f9e63f61c61c
     2  SITE_UNREACHABLE       digest ffcf612e911b4103
```

**7 PAGE_PRIOR_SEASON**, digest byte-identical to L7ZE's. The identities match
the seven in the brief exactly.

---

## What the ladder sees, per target

Every target is SIDEARM, every candidate came from the programme's own
known-good roster URL, and every accepted-best page is the site's current
roster refused for naming an earlier season.

| # | programme | div | best candidate | parser | n | page says | our latest |
|---|---|---|---|---|---|---|---|
| 1 | Bryn Athyn College of the New Church W | D3 | `brynathynathletics.com/sports/womens-soccer/roster/2026` | sidearm-html | 19 | **2024** | *(none)* |
| 2 | Bryn Athyn M | D3 | `brynathynathletics.com/sports/mens-soccer/roster/2026` | sidearm-html | 19 | **2024** | *(none)* |
| 3 | CUNY York College W | D3 | `yorkathletics.com/sports/womens-soccer/roster/2026` | sidearm-html | 16 | **2025** | 2025 |
| 4 | Eastern New Mexico M | D2 | `goeasternathletics.com/sports/mens-soccer/roster/2026` | sidearm-html | 32 | **2024** | "2025" |
| 5 | Montevallo W | D2 | `montevallofalcons.com/sports/womens-soccer/roster/2026` | sidearm-html | 29 | **2025-26** | 2025 |
| 6 | SCAD M | D3 | `savannah.scadathletics.com/sports/mens-soccer/roster/2026` | sidearm-html | 25 | **2025** | 2025 |
| 7 | San Francisco State M | D2 | `sfstategators.com/sports/mens-soccer/roster/2026` | sidearm-html | 30 | **2024** | "2025" |

All seven refuse identically: `page season is not 2026`, `lib.season_ok(title)`
false, `sport_contradicted` `None`, institution named in the page's own title.

### Why four rungs agreed and it meant nothing

Each ladder offered five rungs and **four of them returned the same page**:

```
rung 0  /sports/<sport>/roster/2026        -> current roster, n=19..32
rung 1  /sports/<sport>/roster/season/2026 -> ONE athlete's bio  (tennis, golf, track)
rung 2  /sports/<sport>/roster/2026-27     -> current roster, identical to rung 0
rung 3  /sports/<sport>/roster             -> current roster, identical to rung 0
rung 4  /sports/<sport>/2026-27/roster     -> HTTP 404
```

A SIDEARM site answers an **unknown season with its current roster** rather than
a 404. So rungs 0, 2 and 3 are one page reached three ways, agreeing about a
season none of them was given. Four confident readings of one page is not four
pieces of evidence, and the ladder had nothing left to try.

Rung 1 is worth naming separately: `/roster/season/2026` served a single
athlete's bio on five of the seven — a women's tennis player at Bryn Athyn, a
2010-11 men's golfer at SCAD, a 2015 baseball player at San Francisco State. The
player floor refused all of them. None was ever a candidate for "the 2026
roster has one player".

---

## Discovery

### Structural URL discovery (Phase 5)

Candidates attempted per target: **5** (the full `variants.ladder` output for
each), **35 across the cohort**. Every shape the ladder knows was tried: season
appended, academic-span appended, `season/` infix, bare current route, and the
Presto-style `/sports/<slug>/<span>/roster`. No institution-specific URL was
invented; every candidate derives from that institution's own known-good 2025
URL.

Two additional structural probes, on the two sites showing a season older than
the roster we hold:

| probe | result |
|---|---|
| `goeasternathletics.com/.../roster/2025` | 200, **titled 2024**, n=32 |
| `sfstategators.com/.../roster/2025` | 200, **titled 2024**, n=30 |

Both fall back to the same current page, confirming the platform behaviour
rather than a missing route.

### Official site discovery (Phase 6) — the season menu

The evidence that settled the stage. A SIDEARM roster page publishes its own
season navigation: one route per season the site holds. That is the site
**enumerating** what exists, in its own markup, on the page we already fetched.
No third-party source, no search engine, no inference.

| programme | seasons the site offers | max | 2026 offered? |
|---|---|---|---|
| Bryn Athyn W | 2016–2024 | **2024** | **no** |
| Bryn Athyn M | 2011–2024 | **2024** | **no** |
| CUNY York W | 2011–2025 (no 2020) | **2025** | **no** |
| Eastern New Mexico M | 2004–2024 (no 2021) | **2024** | **no** |
| Montevallo W | 2009–2025, `2025-26` | **2025-26** | **no** |
| SCAD M | 2003–2025 (no 2018) | **2025** | **no** |
| San Francisco State M | 2007–2024 | **2024** | **no** |

Both spellings of the season asked for were checked — `2026` and `2026-27` —
because a site may publish either and neither is the pipeline's to choose.
**Not one of the seven offers it.**

Montevallo deserves a note: its newest season reads `2025-26`, which is the
academic-year spelling of the **2025** season. The 2026 season would be
`2026-27`. Its page is the prior season despite looking like the newest thing
on the site.

---

## Classification

| class | count | identities |
|---|---|---|
| **A** VERIFIED_2026_READY | **0** | — |
| **B** 2026_PUBLISHED_BUT_PIPELINE_MISSES | **0** | — |
| **C** NOT_YET_PUBLISHED | **5** | CUNY York College W · Eastern New Mexico M · Montevallo W · SCAD M · San Francisco State M |
| **D** AMBIGUOUS | **0** | — |
| **E** PROGRAMME_STATUS_QUESTION | **2** | Bryn Athyn M · Bryn Athyn College of the New Church W |

### Why B is zero, stated as a measurement

B would mean the roster is published somewhere the ladder cannot reach. The
test for it is precise and the menu answers it: **is the season asked for in the
site's own enumeration while the page we get is older?** For all seven the
answer is no — the menu and the page agree. There is no route to build toward,
so no candidate-architecture change is warranted and none was made.

The fixture suite pins this distinction rather than leaving it as prose: one
test constructs a page titled 2025 whose menu **does** list 2026 and asserts
`seasonAskedPublished === true` while the page is still refused. That is the
shape none of the seven had, and it will fail the day a real B target appears.

### Why Bryn Athyn is E, and what E does not mean here

Both Bryn Athyn programmes are the only NCAA programmes we have **never
rostered in any season**, and their site's newest soccer roster is 2024. Their
soccer schedule routes also stop at 2024.

The honest qualifier, measured rather than assumed: **the freeze is site-wide,
not soccer-specific.**

| Bryn Athyn sport | newest schedule |
|---|---|
| men's soccer | 2024 |
| women's soccer | 2024 |
| men's basketball | 2024-25 |
| women's volleyball | 2024 |

Nothing on that site has been published for any sport since the 2024-25
academic year. So this is a *publishing* question at least as much as a
*sponsorship* one, and the evidence does **not** support a conclusion that
soccer was dropped. It is classified E because the actionable output is an
operator decision — a registry-active D3 programme we have never once been able
to roster, whose official site went quiet two academic years ago — and E is the
class that routes it there.

**`programme_status` was not written.** Nothing was mutated. Six rows before,
six rows after, byte-identical.

---

## No acquisition

`A = 0`, so per Phase 10 no acquisition ran. Consequently:

| phase | result |
|---|---|
| 11 pre-write provenance | n/a — nothing written |
| 12 dry run | n/a — empty cohort |
| 13 live acquisition | **not run** |
| 14 sheet validation | n/a — no sheet row created |
| 15/16 scoped import | **not run** — importer never invoked |
| 17 containment | 0 programme-season keys changed |
| 18 provenance round trip | 0 rows to check |

Nothing about this outcome was forced. Phase 8 is explicit that
PAGE_PRIOR_SEASON is not itself a defect, and five institutions simply have not
published a 2026 roster. No gate was weakened, no season inferred from the
calendar or from a URL, no 2025 roster carried forward, no schedule or bio used
as roster evidence.

---

## Unchanged, measured

| artifact | before | after |
|---|---|---|
| `roster_players` | 281,159 rows `9281abaf1826f897` | **identical** |
| `programme_status` | 6 rows `4e84caabfc568577` | **identical** |
| `colleges` | 2,404 rows `b558769138b04ee3` | **identical** |
| `athletics_domains` | 2,723 rows `3a3d9871d7b3cc88` | **identical** |
| `roster_gap_reviews` | 7 rows `0ff82ba6889a11df` | **identical** |
| sheets (30 files) | `a00a9e3052679779` | **identical** |
| state | `c65b4bcc6245a5ab` | **identical** |
| targets | `369a9f40cbd274cc` | **identical** |
| stage files | `c65b4bcc6245a5ab` | **identical** |

Coverage: **1,748 / 1,732 / 16 / 13 / 3 · 99.1%** — unchanged, before and after.

Manifest V4 **`7d256f519c130dd6`** both sides; **no repin**. All six behavioural
baselines PASS unchanged; **no repin**. P6 unchanged.

Pool benchmark unchanged, as nothing entered the 2022–2025 window:

| | before | after |
|---|---|---|
| men's `programmes` / rank-1 `n` / p25 / median / p75 | 920 / 770 / 901 / 1118 / 1289 | **identical** |
| women's `programmes` / rank-1 `n` / p25 / median / p75 | 1,202 / 1,045 / 998 / 1200 / 1375 | **identical** |

Evidence: **0 pairs affected**, 0 claim kinds changed, 0 personalisation
transitions, 0 email movement. Email QA not required — GOOD 0, ACCEPTABLE 0,
WEAK 0, BAD 0.

---

## verify_gate debt measurement

Carried forward as instructed, not redesigned.

| | |
|---|---|
| durable records inspected | **2,035** done rosters |
| with no 2025 baseline to test | 25 |
| in-scope records | **0** — no acquisition ran, so there was no run scope |
| out-of-scope records | **2,035** — every record it walked |
| demotions | **0** |
| out-of-scope mutations | **0** — run read-only, no `--apply` |
| kept by the L7Q graduation-year rule | 8, at 85–92%, the same eight as L7W onward |

The asymmetry is unchanged and worth restating: every other stage in the runner
is scoped by `state.run_scope()`; this one walks all durable state by design,
so in a stage with an empty scope it inspects 2,035 records that are all
formally out of scope. It mutated none of them, and it was run without
`--apply`, so the debt remains theoretical.

---

## What changed in the repository

Two files, neither of them an acquisition gate.

**`tools/roster_pipeline/diagnose_cohort.py`** — `seasons_offered(html)`, and
three fields recorded on PAGE_PRIOR_SEASON rows only: `seasonsOffered`,
`seasonsMaxOffered`, `seasonAskedPublished`. Read-only diagnostic enrichment,
in the same shape as the L7ZC section added to the pool audit. It selects no
candidate, changes no class, and touches no gate — it records the evidence that
distinguishes C from B, so the next reader does not have to re-derive it from
the live web.

**Digest-neutral by construction.** `diagnose_cohort.digest()` hashes the
sorted *keys* of each class, not the row bodies, so all four class digests are
byte-identical to L7ZE's — verified by re-running the enriched diagnostic over
the same cohort.

**`tools/roster_pipeline/pagePriorSeason.test.js`** — 13 network-free fixtures
covering the cases the brief names: year-swap resolving, academic-span
spelling, prior season genuinely remaining, URL saying 2026 over a page saying
2025, a two-season-stale site, the B-class pipeline miss, an absent menu,
player-bio refusal, wrong sport, an unreadable season, and the status-question
shape. Two further tests pin the rule that keeps the reader safe: a menu
listing 2026 never makes a 2025 page into a 2026 page, and running out of newer
seasons is not evidence about the current one.

---

## Unexpected findings

### Two programmes hold a 2025 roster that appears to be their 2024 squad

The most significant thing this stage found, and it is not about 2026.

Eastern New Mexico M and San Francisco State M are the two whose sites show a
season *older* than the roster we hold. Comparing our stored rosters against
the live page by player name:

| programme | live page | our 2024 vs live | our 2025 vs live |
|---|---|---|---|
| Eastern New Mexico M | 2024, n=32 | **100.0%** (32) | **100.0%** (32) |
| San Francisco State M | 2024, n=30 | **100.0%** (30) | **93.3%** (30) |

Our 2024 and our "2025" are the same squad. Both rows' `source_roster_url` is
the **bare `/roster`** — the route that serves whatever the site currently
calls now — and that route was, and still is, 2024.

The three healthy programmes in the same cohort look completely different:

| programme | our 2024 vs live | our 2025 vs live |
|---|---|---|
| CUNY York W | 37.5% | **100.0%** |
| SCAD M | 68.0% | **100.0%** |
| Montevallo W | 44.8% | 78.6% |

So this is not a measurement artefact. Two programme-seasons in the historical
window — which is `PROGRAMME_POOL_BENCHMARK`'s own 2022–2025 window — are very
likely a duplicate of the prior season.

**Deliberately not repaired here.** L7ZF is PAGE_PRIOR_SEASON discovery;
changing historical rows is stop condition 12, and repairing legacy provenance
is out of scope by standing instruction. It is recorded, and it is the
recommended next stage.

### The bare current route is how it happened

Both defective captures came from the bare `/roster`. That route is the only one
in the ladder whose meaning is *"whatever the site calls now"* — it carries no
season assertion of its own, and it is offered only in CURRENT mode. Where a
site is stale, "now" is a previous season, and the only thing standing between
that and a mislabelled row is `season_ok` reading the title. It held for all
seven targets today. Whether it held in the 2025 run for these two is the
question the next stage should answer.

### Rung 1 is a bio machine

`/roster/season/<year>` returned a single athlete's bio on five of seven sites
and 404 on one. It has never resolved a roster in this cohort. It is refused
correctly every time by the player floor, so it costs only a fetch — noted
because a rung that has never succeeded is worth measuring across the whole
catalogue rather than removing on seven programmes' evidence.

---

## Remaining decisions for the operator

1. **Bryn Athyn M and W** — registry-active NCAA D3, never rostered in any
   season, official site silent for every sport since 2024-25. Is the programme
   still sponsored, or is the site simply abandoned? `programme_status` was not
   written and should not be until someone decides.
2. **The five C targets** need nothing. They will resolve on their own when
   their institutions publish, exactly as Medgar Evers did in L7ZE — a
   re-diagnosis is the whole cost.
