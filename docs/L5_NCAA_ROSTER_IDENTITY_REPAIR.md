# L5 — NCAA roster identity repair

**Nothing was repaired, because there was nothing to repair.** L4's Tier-1
cohort of 12 "identity-blocked" programmes does not survive a corrected test:
eleven of the twelve were an artefact of L4's own method, and the twelfth is
NAIA and therefore out of current scope.

Audit and correction only. No code, data, alias, Evidence kind, permission or
policy changed; all six baselines byte-identical, corpus unmoved at
1,755 / 2,987, full suite 3,611 passing.

---

## NCAA-first product strategy

Thriv3's programme universe is ultimately intended to cover NCAA D1/D2/D3,
NAIA, NJCAA/JUCO and eventually every legitimate US college programme in the
sport. **NAIA and NJCAA are deferred expansion targets, not rejected ones.**

The current target is NCAA D1/D2/D3 done well. Coverage is therefore reported
per association from here on: a missing NJCAA roster must not make NCAA
completeness look worse, and future expansion must not lower the NCAA bar.

## The correction

L4 asked "does this zero-roster programme appear in the 2025 source sheets?" by
pooling **all eight sheets** into one set of 1,509 school names and testing
membership. That is sport-blind. A women's programme whose name appears in the
**men's** sheet counted as present, and was classified `IDENTITY_BLOCKED`.

Re-tested against each programme's **own** sheet — the one matching its sport
*and* division:

| programme | division | own-gender sheet | present? |
|---|---|---|---|
| Jarvis Christian University | NAIA womens | `naia_womens_soccer` | **YES** |
| Mississippi College | NCAA D2 womens | `ncaa_d2_womens_soccer` | NO |
| Northwood | NCAA D2 womens | `ncaa_d2_womens_soccer` | NO |
| Southwest Minnesota State | NCAA D2 mens | `ncaa_d2_mens_soccer` | NO |
| Montana State Billings | NCAA D2 mens | `ncaa_d2_mens_soccer` | NO |
| Pace | NCAA D2 mens | `ncaa_d2_mens_soccer` | NO |
| Cal Lutheran | NCAA D3 womens | `ncaa_d3_womens_soccer` | NO |
| Claremont-Mudd-Scripps | NCAA D3 womens | `ncaa_d3_womens_soccer` | NO |
| Elms | NCAA D3 womens | `ncaa_d3_womens_soccer` | NO |
| FDU-Florham | NCAA D3 womens | `ncaa_d3_womens_soccer` | NO |
| Lasell | NCAA D3 womens | `ncaa_d3_womens_soccer` | NO |
| Pomona-Pitzer | NCAA D3 womens | `ncaa_d3_womens_soccer` | NO |

Every NCAA entry matched only in the opposite gender's sheet. These schools
field a team in one gender and are absent from the source for the other — which
is `SOURCE_MISSING`, not an alias failure. **Eleven were misclassified.**

The single genuine identity failure, Jarvis Christian University, is NAIA and is
**deferred**, not repaired.

**L5 NCAA implementation set: 0 programmes.** The count was not forced to 12,
and the honest number is zero.

## NCAA-first coverage scorecard

Unchanged by L5, since nothing was implemented — these are both the before and
the after.

| division | sport | programmes | active | with roster | without | coverage |
|---|---|---:|---:|---:|---:|---:|
| **NCAA D1** | mens | 213 | 213 | 213 | 0 | **100.0%** |
| **NCAA D1** | womens | 349 | 349 | 349 | 0 | **100.0%** |
| **NCAA D2** | mens | 205 | 203 | 201 | 4 | 98.0% |
| **NCAA D2** | womens | 260 | 260 | 254 | 6 | 97.7% |
| **NCAA D3** | mens | 318 | 318 | 311 | 7 | 97.8% |
| **NCAA D3** | womens | 418 | 418 | 392 | 26 | 93.8% |
| **NCAA total** | | **1,763** | 1,761 | **1,720** | **43** | **97.6%** |

Deferred expansion, reported separately and deliberately excluded from the NCAA
figure:

| association | programmes | with roster | coverage |
|---|---:|---:|---:|
| NAIA | 392 | 381 | 97.2% |
| USCAA | 21 | 21 | 100.0% |
| **NJCAA** | **228** | **0** | **0.0%** |

## Remaining NCAA gaps — all 43

| division | bucket | count |
|---|---|---:|
| NCAA D1 | — | **0** |
| NCAA D2 | SOURCE_MISSING | 8 |
| NCAA D2 | INACTIVE (`active = 0`) | 2 |
| NCAA D3 | SOURCE_MISSING | 33 |
| **any** | **IDENTITY_BLOCKED** | **0** |
| any | SOURCE_UNUSABLE / PIPELINE_FAILURE / UNKNOWN | 0 observed |

By gender: D2 mens 4, D2 womens 6, D3 mens 7, D3 womens 26. **The gap skews
women's D3** — 26 of 43.

Corroborated independently by sheet size against registry size:

| sheet | schools in sheet | registry | delta |
|---|---:|---:|---:|
| `ncaa_d3_womens_soccer` | 394 | 418 | **24** |
| `ncaa_d3_mens_soccer` | 310 | 318 | 8 |
| `ncaa_d2_womens_soccer` | 254 | 260 | 6 |
| `ncaa_d2_mens_soccer` | 201 | 205 | 4 |
| `ncaa_d1_womens_soccer` | 349 | 349 | 0 |
| `ncaa_d1_mens_soccer` | 214 | 213 | −1 |

The deltas match the gaps. The sheets are simply short — the schools were never
acquired, not lost in mapping. (D1 men's −1 is a name in the sheet with no
registry row; noted, not chased.)

## NCAA quality metrics

| division | programmes | with `unitid` | with `athletics_domain` | roster provenance |
|---|---:|---:|---:|---:|
| NCAA D1 | 562 | 562 (100%) | 304 (**54%**) | 99.5% |
| NCAA D2 | 465 | 462 (99.4%) | 225 (**48%**) | 99.7% |
| NCAA D3 | 736 | 735 (99.9%) | 653 (89%) | 99.8% |

**Identity is essentially complete** — which is why there were no identity
failures to find. **Provenance on rows we hold is excellent.** The weak
dimension is `athletics_domains`, and unexpectedly it is worst at **D1 (54%)
and D2 (48%)**, not D3. That gates the operator's citable source links (H16),
not Evidence generation, so it is a surface-quality gap rather than a
truthfulness one — but it is the largest NCAA number in this audit.

## Future expansion backlog

Recorded, not solved. Thriv3 intends to support these ecosystems once NCAA
meets the bar below.

| association | programmes | roster coverage | source situation | identity situation |
|---|---:|---:|---|---|
| **NAIA** | 392 | 97.2% (11 missing) | sheets exist for both genders; men's sheet is 10 short | good — **1 genuine alias failure** (Jarvis Christian University, womens), ready when NAIA opens |
| **NJCAA / JUCO** | 228 | 0.0% | **no sheet exists for the tier** | unitid 226/228 good; `athletics_domains` only 26/228 (11%) |
| **USCAA** | 21 | 100.0% | covered | `athletics_domains` 0/21 |

## Proposed NCAA completion bar

When the next engineering dollar should go to NAIA/JUCO rather than NCAA
cleanup. Thresholds are set against measured reality, not at 100% where public
sources cannot support it.

| criterion | now | proposed bar | met? |
|---|---|---|---|
| roster coverage, each of D1/D2/D3 | 100 / 97.9 / 95.5% | **≥ 97% per division** | D3 **no** (95.5%) |
| men's/women's parity within a division | D3 97.8 vs 93.8 | **≤ 3pp gap** | D3 **no** (4.0pp) |
| programme identity (`unitid`) | 100 / 99.4 / 99.9% | **≥ 99%** | **yes** |
| roster provenance (`source_roster_url`) | 99.5–99.8% | **≥ 99%** | **yes** |
| `athletics_domains` coverage | 54 / 48 / 89% | **≥ 75% per division** | D1, D2 **no** |
| identity-blocked programmes | 0 | **0** | **yes** |
| unresolved import rows | 0 observed | **0** | **yes** |
| baseline/test stability | 6/6 green, 3,611 passing | **green** | **yes** |

**Four of eight met.** The two that block are D3 women's roster coverage and
D1/D2 athletics-domain coverage.

## Next-stage recommendation — **B, NCAA_SOURCE_ACQUISITION**

Identity is not the problem: zero blockers, `unitid` at 99%+. The pipeline is
not the problem: no ingestion failures, provenance at 99.5%+. Coverage is good
but not finished, and every remaining gap is a source that was never acquired.

**Scope:** the 41 active `SOURCE_MISSING` NCAA programmes — D3 women's 26, D3
men's 7, D2 women's 6, D2 men's 4 — via the existing sheet route, not a new
mechanism. The 2 inactive programmes are correctly empty and need nothing.

**Run alongside, and possibly ahead of it:** `athletics_domains` for D1 and D2.
It is the largest measured NCAA gap, it already has an owner in H16, and at 48%
it does more to make NCAA "excellent" than 41 rosters do.

**Not E.** NCAA is close, and its identity and provenance are genuinely strong,
but two of eight bar criteria fail. Expansion should wait.
