# Phase 6A — Missing Coach Coverage Audit (READ-ONLY)

Recomputed from the post-Phase-5B shared-dev DB. No mutation. Two fixtures built, **neither applied**.
Live coach fingerprint unchanged: `a8bc52f764a42c2ded9730522e6ee645f8cfe3fc15bef73012447ebfdd71a86a`.

## Programme universe (`colleges`)
2409 rows · 2406 active · 3 inactive · men 1169 / women 1240. By division: NCAA D1 562, D2 465, D3 741,
NAIA 392, NJCAA 228, USCAA 21. UNITID present 2396 / absent 13. Duplicate `(unitid,sport)` 20. Inactive rows carrying coach/season data: 3.

## Coverage (active programmes, mutually exclusive)
| class | count |
|---|---|
| COVERED_ELIGIBLE | 1424 |
| COVERED_INELIGIBLE_ONLY | 623 |
| COACH_SEASONS_ONLY | 84 |
| LEGACY_ONLY | 0 (no legacy `coaching_staff` table exists; history lives in `coach_seasons`) |
| NO_COACH_DATA | 275 |

## CORE vs NJCAA
- **CORE** (D1/D2/D3/NAIA/USCAA): 2178 active, 1424 covered-eligible = **65.4%**. Missing/unusable 754 (622 ineligible-only + 84 coach_seasons-only + 48 true-no-data).
- **NJCAA**: 228 active, **0** covered-eligible, 227 no-data + 1 ineligible-only — effectively no acquisition coverage (reported separately, not fixed here).

## CORE true-gap (C4 = 48) externally verified
ACTIVE_CONFIRMED 32 · IDENTITY_JOIN_DEFECT 6 · WRONG_DIVISION_OR_ASSOCIATION 3 · DISCONTINUED 7 · 0 suspended/duplicate/unknown.
Of the 32 active gaps, **15 publish an exact personal email** (→ acquisition fixture), 17 do not (mostly CloudFront-blocked PSU branch campuses or no published contact).

Discontinued (7): Iowa Wesleyan M, Univ. of Valley Forge W (both closed), Concordia MI M (dropped all athletics),
Siena Heights M (closed 2026), Southwest Minnesota State M (no men's program), "Ozarks (MO)"/College of the Ozarks M (no men's soccer — phantom row), New Jersey City M (merged into Kean; men's soccer eliminated).
Identity-join defects (6): Miami (FL) W (D1 — 0 rows for unitid 135726), Milligan W, Huntingdon W, Penn State Mont Alto W, Shaw W, Pacific Union College W.
Wrong division/association (3): Bethesda M (→NCCAA), Ozarks (AR) M (→NCAA D3/SCAC), Barclay M (→NCCAA).

## Fixtures (NOT applied)
- `phase6a_missing_coach_acquisition_fixture.json` — 34 proposed coaches across 15 ACTIVE_CONFIRMED programmes with published exact personal email. No inferred emails.
- `phase6a_programme_repair_fixture.json` — 38 structural defects: 7 discontinued, 3 wrong-division, 6 identity-join, 2 missing-unitid, 20 duplicate-(unitid,sport).
- `phase6a_C2_coach_seasons_recovery.json` — 84 LEGACY_PROMOTION_GAP recovery candidates (coach_seasons carries a current name but no email; email must be researched in 6B).

## Systemic root causes (Part L)
| cause | magnitude |
|---|---|
| NJCAA association never ingested | 228 programmes |
| USCAA association never ingested | 21 programmes |
| NAIA acquired but near-universally ineligible (source-authority/inferred-email) | 377 ineligible-only |
| coach_seasons never promoted to `coaches` | 84 |
| true CORE acquisition gap (mostly ingestion/join failures + new programmes) | 48 (7 discontinued, 6 join defects, 3 wrong-division, 32 real active gaps) |
| programmes without UNITID | 13 |
| duplicate `(unitid,sport)` rows | 20 |

C1 ineligible-only reason buckets (programme-level, overlapping): source-authority-failure 358, inferred-email 241,
unresolved-institution 188, missing-per-person-email 92, proven-stale 14, email-unknown 7.
