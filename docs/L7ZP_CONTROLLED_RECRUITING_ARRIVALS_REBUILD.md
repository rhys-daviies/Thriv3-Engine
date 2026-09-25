# L7ZP — controlled recruiting_arrivals rebuild

The legacy materialisation was built on 2026-08-29 and never rebuilt. L7ZL gave
it a freshness contract but deliberately left production `LEGACY_UNVERIFIED`
rather than stamping a build it could not vouch for. This stage replaces it,
under the governance the intervening stages put in place.

This was an **authorised canonical product-data mutation** — the first in this
roadmap — and it is the one thing here that is not reversible by `git revert`.

**Result: rebuilt, FRESH, exactly reproducing the pre-approved disposable
result. Six baselines repinned. No other product data moved.**

---

## Before

| | |
| --- | --- |
| corpus | `app/server/data/recruitmatch.sqlite`, **CANONICAL_SHARED** |
| freshness | **LEGACY_UNVERIFIED**, both sports, 0 build records |
| arrivals rows | 87,449 — M 43,162 / W 44,287 |
| arrivals semantic digest | `ae18cb6fc7a1c7dc` |
| roster / trust / programme_status | `3a83be9932c4c50d` / `80279ea51e330ff6` / `2271489bb81e747a` |
| Manifest V5 | `a433a7c149fe1628` |
| six baselines | all PASS |

A WAL-safe `VACUUM INTO` snapshot was taken as the authoritative BEFORE corpus.

---

## Re-measured drift

Built on a disposable copy, canonical untouched:

| | |
| --- | --- |
| legacy rows | 87,449 |
| fresh rows | 88,879 |
| added | **1,488** |
| removed | **58** |
| changed | **24,978** |
| net | **+1,430** |
| programmes affected | 2,035 |

The net figure matches L7ZL exactly (M +772 / W +716 / −58). **The 24,978
changed rows are new** — L7ZL only measured net drift and never saw them.

### What actually changed in those 24,978 rows

| column | rows |
| --- | --- |
| `roster_row_id` | **24,978** |
| `class_label_raw` | 42 |
| `entry_type` | 14 |
| `prior_programme` / `prior_confidence` / `prior_candidates` | 7 each |
| `canonical_position` | 6 |

**Only 49 rows carry any non-provenance change.** The other 24,929 differ solely
in `roster_row_id`, a pointer to the roster row a claim came from. It is loaded
into the pattern object at `recruitingPatterns.js:34` and read by nothing
downstream, so its churn is behaviourally inert — it moved because roster rows
were re-imported and took new surrogate ids.

A count of "24,978 changed rows" would have been true and badly misleading.

### Distribution

| | |
| --- | --- |
| sport | M 13,529 / W 12,995 |
| division | D3 8,059 · D1 6,968 · D2 6,603 · NAIA 4,888 · USCAA 6 |
| association | NCAA 21,630 · NAIA 4,888 · USCAA 6 |
| added by season | 2026: 1,479 · 2025: 9 |
| removed by season | 2025: 58 |
| changed by season | 2026: 24,933 · 2025: 45 |

### Attribution

| cause | rows | confidence |
| --- | --- | --- |
| roster row re-import (`roster_row_id` only, inert) | 24,929 | **ATTRIBUTED** |
| 2026 current-season roster acquisition after the legacy build | 1,479 added | **ATTRIBUTED** |
| historical roster corrections in 2025 | 9 added, 58 removed, 45 changed | **MULTI_CAUSAL** |
| class label / position / prior-programme corrections | 49 | **MULTI_CAUSAL** |
| trust predicate | **0** | ATTRIBUTED — there are no exclusions |
| builder code change | 0 | the only L7ZL builder change was adding the predicate, which removes nothing today |

---

## Builder input contract

- **0 EXCLUDE dispositions.** The trust predicate keeps **281,159 of 281,159**
  roster rows and removes **0 of 9,311** programme-seasons. The rebuild removes
  nothing because of a human exclusion.
- `buildPriorIndex` builds `season → nameKey → Set(college_name)` across **all**
  rows, so prior-programme attribution is cross-programme. A targeted repair of
  the affected programmes would produce different answers for others.
  **Rebuild scope is therefore the whole sport, both sports — intentionally.**

---

## Determinism and atomicity

Second rebuild on an unchanged input: **identical semantic digest**
`f264fef351d8d01a`, 0 added / 0 removed / 0 changed. FRESH on two consecutive
checks, generation 1, stored fingerprint equal to the measured effective input.

Two failure points, both on a disposable copy of the real corpus:

| injected failure | result |
| --- | --- |
| crash after the clear, before any replacement | rolled back — 43,934 rows preserved, state still `FRESH gen2` |
| crash **after** `recordBuild`, before commit | rolled back — inside the transaction rows read 1 and the fingerprint read `BOGUS_WOULD_BE_FALSELY_FRESH`; after rollback, 43,934 rows and `8f97ac4e6746ac99` |

**A false FRESH is not reachable.**

---

## Pre-production Evidence review

Ran the full 4,742-pair corpus on the BEFORE snapshot and on the disposable
rebuild:

| surface | pairs changed |
| --- | --- |
| OUTBOUND_DECISION | 10 |
| **COACH_COMPOSITION** | **2** |
| **EMAIL_BODY** | **2** |
| OPERATOR_WIRE | 204 |
| LOG_PAYLOAD | 205 |
| OPERATOR_EVIDENCE | 204 |

Claim-level:

- **2 pairs** changed their SELECTED set, both gaining `ARRIVAL_SAME_REGION_POSITION`
- nothing lost licensing; **zero disposition transitions**
- kinds added: `POSITION_INTAKE_HISTORY` ×4, `ARRIVAL_SAME_REGION_POSITION` ×4;
  removed: `POSITION_INTAKE_HISTORY` ×2

### Coach-facing review — both changed emails

Both are Husson, both gain the same hook:

> "I saw the programme has taken one defender from Australia in 2026 — the same
> part of the world."

Verified against the roster rather than trusted:

- `Lochie Boustead`, DEFENSE, Australia, region OCEANIA, FRESHMAN, `DIRECT`
  confidence, `EXACT` identity.
- Husson's 2026 defender arrivals by region: OCEANIA **1**, Europe 4, Asia 1,
  Latin America 1. "One defender from Australia" is exactly right.
- Both athletes are New Zealand defenders — same position, same region.
- The RELEVANCE sentence correctly rewrites from *"I was having a look through
  your program and noticed"* to *"I also noticed"*, so the hook does not collide
  with the opener. Structure moves `PLAYER_FIRST` → `RELATIONSHIP_FIRST`, which
  is the designed behaviour when a hook exists.

| classification | count |
| --- | --- |
| GOOD | **2** |
| ACCEPTABLE | 0 |
| WEAK | 0 |
| **BAD** | **0** |

The legacy state had **0** arrivals for Husson 2026 despite 31 roster rows on
file, so these two emails were missing a true, already-licensed hook.

### Matching

No module under `shared/matching`, `matchingBacktest` or `backtestMatching`
reads `recruiting_arrivals` or the recruiting patterns. **The numeric matching
score cannot move.** Only Evidence surfaces changed.

### Operator review — the legacy data was asserting false zeros

```
Shaan Anad | Albertus Magnus   POSITION_INTAKE_HISTORY
  BEFORE  count=14  intakes=3  byIntake { … "2025->2026": 0 }
  AFTER   count=16  intakes=4  byIntake { … "2025->2026": 2 }
```

The operator was being told a programme took **zero** players at a position in
the 2026 intake when it took two. That is the harm L7ZL predicted, now measured.
All 204 operator changes are `RECRUITMENT_PATHWAY` intake facts of this shape.

---

## Production gate

| # | criterion | |
| --- | --- | --- |
| 1 | corpus unmoved since the opening token | ✓ |
| 2 | disposable rebuild deterministic | ✓ |
| 3 | trust predicate correct | ✓ 0 removed |
| 4 | failure atomicity proven | ✓ both points |
| 5 | before/after movement understood | ✓ |
| 6 | no BAD coach-facing output | ✓ 2 GOOD |
| 7 | no unexpected matching-score movement | ✓ score independent |
| 8 | P6 unchanged | ✓ |
| 9 | no unrelated product-data mutation predicted | ✓ builder writes arrivals + build metadata only |

**PASS.**

```bash
node server/scripts/buildRecruitingHistory.js --canonical
```

`--canonical` is the L7ZO acknowledgement, required because the corpus is
`CANONICAL_SHARED`. 13 seconds.

---

## After

| | |
| --- | --- |
| freshness | **FRESH**, both sports, both consecutive checks, generation 1 |
| stored fingerprint | M `8f97ac4e6746ac99` · W `d9a71bdb7a15c3c8` |
| current input fingerprint | identical to stored |
| builder version | `L7ZL/arrivals/v1` |
| arrivals rows | 88,879 |
| arrivals semantic digest | `f264fef351d8d01a` — **exactly the validated disposable result**, 0 differences |

Containment:

| table | before | after |
| --- | --- | --- |
| `roster_players` | `3a83be9932c4c50d` | `3a83be9932c4c50d` |
| `roster_season_trust` | `80279ea51e330ff6` | `80279ea51e330ff6` |
| `programme_status` | `2271489bb81e747a` | `2271489bb81e747a` |
| `recruiting_arrivals` | `1cff960c09a9693c` | `2d694ab74f831491` — intended |
| `recruiting_arrivals_build` | 0 rows | 2 rows — intended |

Trust unchanged: 15 / 2 RETAIN / 13 NULL / **0 EXCLUDE**. Coverage unchanged:
1,761 active NCAA, 1,732 current-rostered (98.4%), 13 historical-only, 16
never-fetched.

---

## Manifest — a real blind spot, named but not closed here

Manifest V5 is `a433a7c149fe1628` **before and after**, because it does not
contain `recruiting_arrivals`:

```
players, colleges, roster_players, roster_season_trust, coaches,
athletics_domains, programme_status, roster_freshness, roster_measurements
```

So every product baseline moved while the dataset digest read **UNCHANGED** —
which in the L7ZM governance model is the signature of a *code regression*. That
is a genuine blind spot and it is worth stating plainly rather than burying.

It is **not** closed here, deliberately. `recruiting_arrivals` is derived, and
the L7ZL fingerprint already covers its true inputs — including `coach_seasons`,
which the manifest itself does not carry. While the materialisation is FRESH the
table is a pure function of inputs the fingerprint does see, and a divergence
fails closed. Moving to V6 invalidates comparison with every pin taken under V5
and deserves its own decision, not a side effect of a rebuild.

**No manifest definition change. No manifest repin.**

---

## Baseline movement and repin

| baseline | old → new |
| --- | --- |
| OUTBOUND_DECISION | `e1bb8f2f4032c63b` → `cf1e79680f56a228` |
| COACH_COMPOSITION | `279d05a0d284f577` → `5e6fb62e12c3a022` |
| EMAIL_BODY | `4aac6a70ab6fab9c` → `54a05ec90e8937fd` |
| OPERATOR_WIRE | `daf48688908e2cc8` → `8d502959c8730700` |
| LOG_PAYLOAD | `009192626440119e` → `37544f2608cd1b14` |
| OPERATOR_EVIDENCE | `72cbb26eb24896e1` → `7ca0e350298cd34f` |

Before repinning, the six digests were computed on the **pre-production review
corpus** and found identical to canonical's — so what was reviewed is exactly
what was pinned.

**Report pins did not move** (19/19 pass): those three slices are unaffected by
the arrivals change. Nothing was repinned that did not move.

Post-repin: all six PASS on canonical **and** on a freshly taken snapshot.

---

## Trust-boundary consequence

`exclusionBlockedReason` returns **null** for both sports now that the
materialisation is FRESH. The L7ZK materialisation-consistency blocker on
`EXCLUDE_FROM_EVIDENCE` is **CLOSED**.

An unauthenticated exclusion is still refused:

> a disposition requires an authenticated operator; none was supplied by the
> server context.

**Authentication is now the only remaining blocker on writing an exclusion.**
None was implemented, none was enabled, and no disposition was written.

The lifecycle remains proven by fixture: FRESH → roster change → STALE; STALE →
rebuild → FRESH; a diagnosis does not stale; a RETAIN does not stale; an EXCLUDE
stales; clearing one stales again.
