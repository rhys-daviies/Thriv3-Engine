# Phase 7E — Safe Refresh Architecture + NAIA Freeze (shared dev)

Phase 7E makes the integrity work permanent. Every future refresh of programmes, rosters,
coaches, emails, domains and divisions now runs through DISCOVER → NORMALIZE → RESOLVE ENTITY →
RESOLVE PROGRAMME → VERIFY SOURCE OWNERSHIP → COMPARE → CLASSIFY → STAGE → VALIDATE → REVIEW →
PROMOTE. The only canonical writer is `integrity:promote`. The structural cleanup was applied,
NAIA is formally frozen, and the NJCAA/USCAA baselines are recorded.

Production was not touched, `STRICT_CORROB_SCOPE=NAIA` is unchanged, and there was no merge or
deploy. The operator document is `docs/data-integrity-annual-refresh.md`.

## Part 0 — checkpoint

`2faa4a2` was pushed fast-forward to `feature/coach-corroboration-7b`. Local equals remote, the
branch is 0 behind main, privacy is clean and the tracked tree is clean.

## Part A / V — structural cleanup (applied; two reviewed fixtures; manifests kept)

- **Shawnee State (user-approved)**
  - Membership periods: NAIA Mid-South 2022; NAIA River States 2023–2025; NCAA D2 PROVISIONAL
    (Mountain East) from 2026 with `postseason_eligible` 0 and a review due in 2028.
  - Evidence (two tier-B sources): the MEC announcement of 2026-02-11, and the ssubears.com 2026
    schedules, which list MEC matches.
  - The NAIA rows are superseded and inactive, linked to the NCAA D2 rows. The 2 women's staff
    were re-homed to the NCAA D2 row, and the men's conference was corrected GMAC → MEC.
  - No history was rewritten.
- **SCAD (user-approved)**
  - The NCAA D3 men's row was a phantom: all 93 of its roster rows come from
    `savannah.scadathletics.com`. It is now inactive and linked to the NAIA programme; its
    history stays on the row.
- **East Central (OK) NJCAA row**
  - Identified as East Central Community College, Decatur MS (UNITID 175643; 2025 record 8-7-1
    matches). New entity AE-U175643.
  - `ecccathletics.com` and `eccc.edu` were verified through the ownership chain, and the alias
    was repaired in fixture 2.
- **Penn State Brandywine:** `colleges.unitid` NULL → 214731 (NCES).
- **Central Penn men's:** NJCAA/EPAC → USCAA / Eastern States (official 2025-26 pages).
  `centralpennknights.com` and `centralpenn.edu` verified.
- **Same-programme duplicates** (Calumet + 6 NCAA women's pairs): now `programme_row_links`
  (SAME_PROGRAMME_ALT_NAME), i.e. data rather than an allowlist. Only STLCC remains in the
  exceptions file.
- **Seeding:** 2,383 SEED membership periods (current state at cut-over), plus 18 entity-tied
  aliases for UNITIDs that parent campuses.
- **Simulation:** passed 12/12 gates, plus no roster or record moved and only the fixture's
  coaches moved. Live equals simulated.

**Queued:**
- STLCC physical consolidation (and its missing women's programme).
- East Central display name, nickname and logo.
- Lincoln Trail / George C. Wallace federal identity.
- Physical consolidation of the linked spellings (importers match exact names).
- The Stanton men's programme.

## Part B — ingestion audit

36 path entries were audited (`phase7e_ingestion_audit.redacted.json`):
- 21 CLI entries covering 23 scripts are now CLOSED_GUARDED.
- 8 HTTP routes are CLOSED_ROUTE.
- 1 class of legacy appliers.
- 3 SAFE_UNCHANGED.
- 3 RESIDUAL_OPEN: the send-path coach insert (never eligible); the runtime legacy coach read
  unless `THRIV3_USE_RECONCILED_COACHES` is set; external projected_games columns.

Proven harms include:
- `loadMatchingInputs` would revert Saint Francis (IL) to the Peoria nursing college's UNITID.
- `verifyAthleticsDomains` and `importInstitutionAliases` DELETE their whole tables.
- `promoteCoaches` would re-insert repaired coach rows.
- `cleanInactiveSchools` would delete an active NAIA row.
- `buildGraduatingDatabase` writes mock coaches.

## Parts C–S — the architecture (`server/lib/refresh/`)

- **Identity hierarchy:** entity id → host (host-level first) → entity-tied alias → UNITID
  (parent-only when campuses hang off it) → parent + exact name → exact programme name (name
  only) → review. Fuzzy matching yields candidates only, and a disagreement between steps is a
  contradiction.
- **Source authority:** A, B, C and D tiers are computed from where a page actually lives.
  Tier D never promotes, a division needs A or two independent B sources, and a federal UNITID
  comes only from NCES.
- **Staging:** `refresh_batches` and `refresh_observations`, with deterministic ids and a batch
  hash.
- **Classification:** nine classes. A disappearance is an investigation, never a deletion.
- **Temporal model:** `programme_membership_periods`, `programme_row_links` and
  `season_freezes`. `colleges.division` and `colleges.conference` point at the open period
  (validator H10).
- **Roster, coach, programme and domain workflows:** see the operator document.
- **Destructive-action policy:** deletions are forbidden, and protected actions need named
  proof plus review.
- **Promotion gate:** 12 gates evaluated on a simulated copy. The apply is one guarded,
  idempotent transaction with a manifest revert, and the live re-measure must equal the
  simulation or the promotion is auto-reverted.
- **Monitor:** `integrity:monitor`.
- **Freshness:** competitive-cycle windows.
- **Validator:** gained H9 (row links), H10 (periods) and H11 (aliases follow a UNITID
  correction).
- **Reconciler:** never eligible at an inactive programme. This is inert on the pre-7E data
  (the same 4,158 eligible ids).

## Parts P / T / Y — regression fixtures, historical simulation, tests

- **Regression world:** 20 fixtures in `regressionWorld.js`, covering every listed defect.
- **Historical simulation** (a hypothetical 2027 refresh on a copy of shared dev):
  - 65 observations and 54 ops promoted.
  - Promoted: safe facts, plus the reviewed transition, discontinuation, email change and
    departure.
  - Held back and never written: contradictions, the branch-campus page on the parent host,
    ambiguous institutions, old roster pages and frozen-season writes.
  - The inferred address was never stored; frozen seasons and prior-season rosters were
    unchanged.
  - The simulation found two real defects, both fixed: the dual-team address rule, and the
    stale East Central alias (now H11).
- **Tests:**
  - 66 new tests pass, and 332 tests across related suites pass.
  - Broad run: 19 failures are new relative to the checkpoint, and 0 are unexplained. 4 were
    fixed, 4 are timing-only, 8 fail at the checkpoint too, 1 fails in both runs, and 2 are
    pinned live counts moved by the approved SCAD/Shawnee changes.

## Part W — NAIA freeze

| Measure | Value |
|---|---|
| Logical programmes | 381 |
| Covered authoritative | 370 (97.11%) |
| Valid residuals | 11 (8 no-email, 3 blocked source) |
| Explained | 100% |
| Eligible coaches | 798 |
| Strict path | 798 |
| Strict evidence completeness | 100% |
| Seasons frozen | 2022–2025 |
| Freeze file | `shared/naiaIntegrityFreeze.json` |

The monitor fails HARD if NAIA changes without a guarded promotion.

## Part X — starting baselines

- **NJCAA:** 223 logical programmes, men's only. 2 entities are UNRESOLVED_FEDERAL and STLCC is
  documented. 22 entities have a trusted host. All 223 memberships are SEED. There are 0
  rosters, 0 coaches and 0 coach_seasons.
- **USCAA:** 22 programmes (12 men's, 10 women's). Christendom is non-Title-IV. 1 entity has a
  verified host (Central Penn). Rosters exist mostly for 2025 (21 programmes). There are 0
  coaches.
