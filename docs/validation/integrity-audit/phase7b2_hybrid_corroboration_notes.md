# Phase 7B.2 — Strict Hybrid Corroboration APPLIED (shared dev)

Implements and proves the alternative eligibility-corroboration path established in 7B.1, so authoritative
current NAIA coach evidence can satisfy G6 without `coach_seasons` (which is effectively NCAA-only) — **without
weakening the existing coach_seasons paths and without changing any NCAA behaviour.**

## Part 0 — checkpoint
Pushed `e849ec3` (fast-forward); local == remote, 0/0. Branch history matches the PR #49 PII purge; no orphaned
unredacted commit reintroduced.

## Part A — 56-email reconciliation (terminology corrected)
The 7B.1 "10.7% verified-email defect" is an **ASSOCIATION**-defect rate, not an **ADDRESS**-defect rate.
56 = 50 exact-current-valid + 0 changed + 0 no-longer-published + **4 departed-person** + **2 wrong-sport** + 0
wrong-institution + 0 unverifiable. **ADDRESS_DEFECT = 0; ASSOCIATION_DEFECT = 6.** The stored verified
addresses were all real; the defect is an invalid coach-row context. Corrected in `phase7b1_pilot_notes.md`.
This is why the architecture catches these via the **contradiction gate** (departed→stale, wrong-sport→
currentness-only-for-correct-programme), not via the email checks.

## Parts B/D/E/F/G/H — the strict path
`reconcileCoaches.js` now returns an explicit, auditable `corroboration_method`:
`COACH_SEASONS_IDENTITY` · `COACH_SEASONS_SOURCE_DOMAIN` (both preserved exactly) · `STRICT_AUTHORITATIVE_CURRENT`.
The strict method passes ONLY when every condition holds: resolver RESOLVED; classification KEEP; canonical
UNITID == programme UNITID; programme active; sport-scoped programme exists; `currentness_status='CURRENT'` with
an authoritative currentness source; source domain VERIFIED/VERIFIED_ALIAS (not held) mapped to the same UNITID;
`email_seen_on_source_at` and `email_seen_on_source_url` present; `email_status='verified'`; real per-person
address (generic/inferred excluded); NOT PROVEN_STALE. Positive evidence never overrides a contradiction.
`email_confirmed_at` is untouched (deliverability-only). Reuses the existing domain/institution authority infra
and the held-domain register.

## Part C — activation scope
Implemented **generically** (division-agnostic capability), activated **conservatively NAIA-only** by default via
`STRICT_CORROB_SCOPE` (`OFF` = pre-7B.2 behaviour, `ALL`, or a comma list). Rationale: the evidence concept is not
NAIA-specific, but NCAA is already fully coach_seasons-corroborated and widening has a large blast radius, so
NAIA-only keeps NCAA byte-identical while unlocking the population that structurally lacked coach_seasons.

## Parts I/J/K — pilot, NCAA non-regression, blast radius (simulated OFF vs NAIA on disposable copies)
- Global eligible **3360 → 3413 (+53)**; every new row is NAIA and `STRICT_AUTHORITATIVE_CURRENT`; 0 newly ineligible.
- **NCAA eligible 3357 → 3357 (0 added, 0 removed)** — zero regression; coach_seasons corroboration byte/logically
  unchanged for NCAA.
- Pilot programmes covered **0 → 28 of 30** (blocked: Williams Baptist W and Sterling M — both correctly held).
- **No legacy NAIA row lacking CURRENT/email_seen unlocked** — the ~1000 legacy NAIA rows remain blocked; only the
  53 pilot-evidenced rows pass.
- Other divisions: 0 change.

## Part N — activation
Eligibility is **not persisted** in the shared-dev DB (reconcile refuses that path and derives on temp copies), so
activation is the committed reconcile code with default NAIA scope — **no DB row mutation**, no manual eligibility.
No coach/domain/programme factual records changed in 7B.2.

## Part O — measurement (activated)
NAIA eligible **2 → 30**; NAIA COVERED_ELIGIBLE **2 → 30**, INELIGIBLE_ONLY 378 → 350, NO_COACH_DATA 4, coverage
**0.5% → 7.8%**. NCAA delta 0. Integrity: source-domain conflicts 0, wrong-institution eligible 0, wrong-sport
eligible 0, stale eligible 0, duplicate identity 0, canonical round-trip 0, validator CRITICAL 0.

## Part P — explainability ledger
NAIA: STRICT 53 + coach_seasons-source-domain 3. NCAA D1: source-domain 1246 + identity 77. D2: 729 + 82.
D3: 1136 + 87. **NCAA is 0 strict (100% coach_seasons).** Strict-path evidence completeness: **53/53 (100%)** have
CURRENT + currentness source + email_seen timestamp + URL + verified email.

## Part Q — readiness for the remaining 205
All required conditions met: 0 wrong-institution / wrong-sport / stale eligible; 0 NCAA regression; every strict
row has complete currentness/email-observation/domain evidence; privacy gates pass; deterministic explainability.
**7B.3 is declared ready — but the 205 are NOT processed here.**

## Part M — tests (71 relevant pass)
`reconcileCoaches.strictHybrid.test.js` (27 through the real pipeline: legacy identity + source-domain still pass;
strict passes with all conditions; VERIFIED_ALIAS passes; and one-condition-removed negatives for unresolved
institution, UNITID mismatch, inactive programme, wrong sport, UNKNOWN currentness, PROVEN_STALE, missing
currentness source, untrusted/AMBIGUOUS/WRONG_INSTITUTION domain, missing email_seen ts/url, inferred/generic/
malformed email; scope: non-NAIA cannot use the NAIA path, NCAA coach_seasons still works, legacy NAIA stays
blocked, OFF disables, ALL enables, deterministic rerun) + `strictNaiaCorroboration.test.js` (14) + existing
currentness/emailSeen/institution/redaction/privacy suites.

## Recommended next phase (7B.3)
Roll out the per-programme authoritative-revalidation pipeline to the remaining 205 TIER-1 NAIA programmes
(browser fallback for CloudFront/403 sites), applying only factual repairs with fresh email_seen/currentness; each
repaired row then becomes eligible via the now-live STRICT_AUTHORITATIVE_CURRENT path. Keep scope NAIA-only until a
separate decision widens it; never bulk-promote legacy emails; never relax the strict conditions.
