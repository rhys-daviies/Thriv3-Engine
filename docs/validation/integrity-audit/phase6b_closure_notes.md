# Phase 6B — Programme Universe Integrity APPLIED (shared dev)

Independently re-proved each structural defect from the Phase-6A repair fixture, simulated on a disposable
copy, and applied only deterministic safe repairs to `server/data/recruitmatch.sqlite` (never production `/data`).
No coach acquisition. No row deleted (discontinued/duplicate rows retired via `active=0`, history preserved).
Coach data untouched — coach fingerprint `a8bc52f7…` unchanged.

## Re-proof outcomes
- **Discontinued (7 → 6 applied):** Concordia-MI (dropped athletics), Ozarks-MO/College of the Ozarks (no men's soccer), Iowa Wesleyan (closed 2023), Southwest Minnesota State (women's only), Siena Heights (closing 2025-26), New Jersey City (merged→Kean, D3 men's soccer terminated). **University of Valley Forge W was a FALSE POSITIVE** (live 2025 roster) — excluded.
- **Merger treatment (NJCU/Kean):** men's soccer eliminated; NJCU history preserved AS-IS under unitid 185129, marked terminated; NOT folded into Kean (separate institution, own unitid). active=0.
- **Wrong-division (3 applied):** Bethesda NAIA→NCCAA, Ozarks-AR NAIA→NCAA D3 (SCAC), Barclay NAIA→NCCAA. Historical seasons unchanged.
- **Null-UNITID (2):** Iowa Wesleyan → active=0 (closed; no unitid invented). **Christendom** has NO IPEDS UNITID (refuses Title IV) → left NULL truthfully (not a defect).
- **20 duplicate `(unitid,sport)`:** 8 CANONICAL_NAME_DRIFT + 4 TRUE_DUPLICATE + 2 SPORT_IDENTITY_ERROR + 6 CAMPUS_OR_ENTITY_COLLISION.
- **6 "identity-join defects":** NONE are real join defects — Miami-FL/Milligan/Mont Alto have no coach data at all; Huntingdon/Shaw/Pacific Union have only their men's rows. All 6 are **Phase-6C acquisition gaps**. J5 empty.

## Applied (one guarded transaction, `applyPhase6BProgrammeRepairs.js`, `/data`-refusing, idempotent, expected-old-value guards)
- 6 programme status → `active=0` (discontinued/closed/merged).
- 3 division corrections.
- 1 empty-stub duplicate retired (`William Rainey Harper`, 0 references; canonical `Harper`).
Total: **10 colleges-row updates.** No deletes; coaches/coach_seasons/roster untouched.

## Held (documented, not applied)
- **J3 IU Columbus** (151111→15111102, correct identity) — HELD: stamping it introduced 2 canonical round-trip failures because the resolver registry (aliases/domains) still maps IU Columbus to 151111. Needs a resolver-registry update first.
- **11 split-data duplicate merges** — same programme under two spellings with data split across both rows; migration needs season/roster conflict resolution → held with a full migration map.
- **6 campus-collision groups** — legitimately distinct campuses sharing one merged IPEDS UNITID → never merge; validator now recognises them as an exception (Part H prevention).

## Root-cause prevention (Part H)
`validateInstitutionIntegrity.js`: the duplicate-UNITID check now recognises 5 known legitimate multi-campus UNITIDs (231165 Vermont State, 498562 Commonwealth PA, 498571 PennWest, 179308 St. Louis CC, 195544 St. Joseph's NY) as an exception, so they stop flagging while a genuinely new shared UNITID still warns.

## Before → after (measured, live shared dev)
| metric | before | after |
|---|---|---|
| colleges total | 2409 | 2409 (no deletions) |
| active | 2406 | 2399 |
| inactive | 3 | 10 |
| CORE active | 2178 | 2170 |
| NJCAA active | 228 | 227 |
| duplicate (unitid,sport) | 20 | 20 (J3 held; 6 recognised as legit exception) |
| null UNITID | 13 | 13 |
| coaches | 6339 | 6339 |
| eligible coaches | 3281 | 3281 |
| coach_seasons | 8595 | 8595 |
| roster rows | 281159 | 281159 |
| COVERED_ELIGIBLE | 1424 | 1424 |
| NO_COACH_DATA | 275 | 268 |
| CORE covered-eligible % | 65.4% | 65.6% |
| source-domain conflicts | 0 | 0 |
| wrong-institution eligible | 0 | 0 |
| canonical round-trip | 0 | 0 |
| DB integrity | ok | ok |

Orphans after apply: coaches 1 (pre-existing), coach_seasons 0, roster 0, programme_seasons 0 — none introduced.

## Phase-6C starting population
- **CORE true acquisition gaps remaining: 40** (was 48; −6 retired, −2 moved to NCCAA). = 32 active-confirmed + 6 ex-"join defects" (now acquisition) + Valley Forge + Ozarks-AR.
- **CORE coach_seasons-only: 84** (unchanged — the biggest single 6C lever).
- No programme became covered without adding a coach (J5 empty), as expected.

Fingerprints: colleges `b6f66ea8…`, coach `a8bc52f7…` (unchanged). See `phase6b_programme_integrity_snapshot.json`.
