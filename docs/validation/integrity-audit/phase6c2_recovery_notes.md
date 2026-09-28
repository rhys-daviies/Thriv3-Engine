# Phase 6C.2 — Existing Coach Recovery APPLIED (shared dev)

Identity-integrity repair of the 29 EXISTING_RECORD_RECOVERY programmes from 6C.1: coaches whose
existing `coaches` row was **mis-filed under the wrong same-name institution**. Independently re-adjudicated,
simulated, and applied only deterministic-safe reassignments. Shared dev only (never `/data`). No new coach
rows, no deletions — existing rows reassigned to their correct canonical programme. `email_confirmed_at` NULL.

## Adjudication (Parts B/D — 29, re-researched from scratch)
| case | count |
|---|---|
| WRONG_FILED_INSTITUTION (all NEVER_CORRECT) | 25 |
| SOURCE_ERROR (consortium — stored record already correct) | 3 |
| LEGITIMATE_DUAL_ROLE | 1 |
| MOVED / STALE_AT_BOTH / SAME_NAME_DIFFERENT_PERSON / WRONG_SPORT / UNKNOWN | 0 |

Historical semantic: **NEVER_CORRECT 25** (always mis-filed by a same-name importer collision; the person was never at the stored school), NA 4. The email domain was decisive in every case (e.g. `@bethanywv.edu` ⇒ Bethany WV not Bethany KS; `@uah.edu` ⇒ Alabama Huntsville not "Utah"; `@stmarytx.edu` ⇒ St. Mary's TX not Saint Mary's MN/CA).

## Held (4 — not applied)
- **David Nolan → Scripps** and **David Nolan → Harvey Mudd** — SOURCE_ERROR: the stored "Claremont-Mudd-Scripps" is the correct consortium team identity (Athenas, `@cms.claremont.edu`); the individual member college is not the team. No single unitid maps to the team.
- **Miranda Armstrong → Pitzer** — SOURCE_ERROR: stored "Pomona-Pitzer" (Sagehens) is the correct consortium team; Pitzer College does not field it.
- **Brandon Wachholz (Beloit)** — LEGITIMATE_DUAL_ROLE: coaches men's (existing row, correct) and women's (added Dec 2025); needs a NEW women's record (insert), not a reassignment — deferred (also blocked by the Beloit name-drift duplicate).

## Applied (Part K — one guarded transaction, `applyPhase6C2Recovery.js`)
**25 mis-filed rows reassigned** to their canonical programme (school/sport/division corrected, authoritative currentness + `email_seen_on_source_*` evidence refreshed, email unchanged). Guards: `/data` refusal, expected-old-value (school+sport+email), target must exist+active and NOT be a held campus-collision/IU-Columbus/null-unitid unitid, collision prevention (no duplicate at target), one transaction, integrity check, rollback, idempotent. 0 reassignments left a coach at the wrong school; 0 target collisions.

## Net coverage (Part J — real improvement, not record-shuffling)
TARGET programmes gained COVERED_ELIGIBLE **16** − SOURCE programmes lost **0** = **net +16**. The mis-filed rows were not providing eligible coverage at their wrong school (wrong email domain → uncorroborated), so no source coverage was lost; the coaches are now eligible at their **email-domain-proven true institution**.

## Before → after (measured, live)
| metric | before | after |
|---|---|---|
| coaches | 6388 | 6388 (reassign, no inserts) |
| eligible coaches | 3327 | 3343 (+16) |
| COVERED_ELIGIBLE | 1466 | **1482 (+16)** |
| COACH_SEASONS_ONLY | 39 | **16 (−23)** |
| COVERED_INELIGIBLE_ONLY | 626 | 632 |
| NO_COACH_DATA | 268 | 269 (+1 source fallout) |
| CORE covered-eligible % | 67.6% | **68.3%** |
| D1 / D2 / D3 | 84.2 / 86.6 / 79.8 | 84.3 / 87.4 / 81.2 |
| duplicate emails / identity rows | 118 / 0 | 118 / 0 |
| source-domain conflicts | 0 | 0 |
| wrong-institution eligible | 0 | **0** |
| canonical round-trip | 0 | 0 |
| orphan coaches | 1 | 1 (pre-existing) |
| email_confirmed_at | 0 | 0 |
| DB integrity | ok | ok |

## Provenance (Part M): 25/25 pass — current institution/programme/sport authoritative, exact email currently published, currentness + email-observation evidence stored, `email_confirmed_at` NULL, 0 left at old school.

## Source-programme follow-up (Part H): 3
Three source programmes were mis-file-only and now show no coach after the correction (e.g. the "Bethany (KS)" men's row was actually the Bethany WV coach). Captured in `phase6c2_source_programme_followup.json` — real current-staff acquisition required there (NOT this phase; these were never truly covered).

Fingerprints: coach `6d87d8eb…` (changed by the 25 reassignments), colleges unchanged. See `phase6c2_integrity_snapshot.json`.

## Remaining coach_seasons-only (16) → 6C.3 / 6D scope
9 CURRENT_STAFF_NO_EMAIL + 1 PROGRAMME_DEFECT (CUNY York vacancy) + 4 held (3 consortium + Wachholz dual-role) + 2 residual. Plus the 40 true CORE acquisition gaps remain a separate later scope.
