# Phase 6C.1 — coach_seasons Recovery APPLIED (shared dev)

Promoted proven-current `coach_seasons` identities into new `coaches` rows for the 84 CORE
COACH_SEASONS_ONLY programmes, using authoritative current evidence and exact published personal
emails. Shared dev only (never `/data`). No inferred/generic emails; `email_confirmed_at` stays NULL.
No duplicate persons inserted.

## Population (Part A/B)
84 CORE COACH_SEASONS_ONLY programmes (D3 68, D2 14, D1 2). All 84 = **CS_CURRENT** (a 2025/2026 named
coach_seasons identity). 41 had a covered sibling-sport row under the same UNITID.

## Research (Parts C/D) — all 84, programme-page-first
Reconcile vs coach_seasons: **MATCH_CURRENT 74 · NO_EMAIL_PUBLISHED 5 · PARTIAL_MATCH 2 · FULL_REPLACEMENT 2 · PROGRAMME_STATUS_ISSUE 1.** coach_seasons proved a strong identity clue (74/84 matched current web evidence); 4 programmes had staff changes (current replacement discovered), 1 defect (CUNY York head-coach vacancy).

## Duplicate check (Part E)
Every proposed email was checked against the whole coaches table. **28 programmes' current coach already exists in `coaches` but mis-filed under the wrong school** (e.g. `[withheld]@redacted.invalid` under "Bethany (KS)", `[withheld]@redacted.invalid` under "Utah") — which is *why* they showed as coach_seasons-only. These are recoveries (reassign), NOT inserts; held (`auto_apply_safe=false`) for a careful dedicated pass to avoid duplicate persons. 1 dual-role (Beloit) also held (name-drift ambiguity).

## Outcomes (Part G, sum = 84)
| outcome | count |
|---|---|
| PROMOTION_READY | 45 |
| EXISTING_RECORD_RECOVERY (held) | 29 |
| CURRENT_STAFF_NO_EMAIL | 9 |
| PROGRAMME_DEFECT (CUNY York vacancy) | 1 |

## Applied (Part L) — one guarded transaction (`applyPhase6C1Promotions.js`)
**49 new coaches inserted** across **45 programmes**. Each: canonical UNITID + active programme, sport matched, exact personal email published on an official current page, `email_status=verified`, `currentness_status=CURRENT` + evidence, `email_seen_on_source_*` populated, `email_confirmed_at` NULL. Guards: `/data` refusal, expected-absence, duplicate-person/email prevention (email already at another institution → blocked), one transaction, integrity check, rollback, idempotent. **0 recoveries applied** (all held).

## Before → after (measured, live shared dev)
| metric | before | after |
|---|---|---|
| coaches | 6339 | 6388 (+49) |
| eligible coaches | 3281 | 3327 (+46) |
| COVERED_ELIGIBLE | 1424 | **1466 (+42)** |
| COVERED_INELIGIBLE_ONLY | 623 | 626 |
| COACH_SEASONS_ONLY | 84 | **39 (−45)** |
| NO_COACH_DATA | 268 | 268 |
| CORE covered-eligible % | 65.6% | **67.6%** |
| D3 coverage | 74.6% | 79.8% |
| D2 coverage | 85.7% | 86.6% |
| duplicate emails / identity rows | 118 / 0 | 118 / 0 |
| source-domain conflicts | 0 | 0 |
| wrong-institution eligible | 0 | 0 |
| canonical round-trip | 0 | 0 |
| orphan coaches | 1 | 1 (pre-existing) |
| email_confirmed_at | 0 | 0 |
| DB integrity | ok | ok |

45 programmes left COACH_SEASONS_ONLY: 42 became COVERED_ELIGIBLE, 3 got a valid record but are not corroborated-eligible (COVERED_INELIGIBLE_ONLY). 46 new eligible coaches (some programmes gained two).

## Provenance (Part N): 49/49 pass — canonical unitid exists, programme active, sport matched, exact email currently published, currentness + email-observation evidence present, `email_confirmed_at` NULL, no inferred/generic provenance.

Fingerprints: coach `8b63822e…` (changed by the 49 inserts), colleges `b6f66ea8…` (unchanged). See `phase6c1_integrity_snapshot.json`.

## Unresolved 84-remainder (39) → Phase 6C.2 scope
- **29 EXISTING_RECORD_RECOVERY** — mis-filed existing records to reassign (biggest lever; needs a careful reassignment pass with expected-old-value guards).
- **9 CURRENT_STAFF_NO_EMAIL** — current staff proven, no personal email published (D1/no-publish pattern).
- **1 PROGRAMME_DEFECT** — CUNY York women's head-coach vacancy (national search underway).
