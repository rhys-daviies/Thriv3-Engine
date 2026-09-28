# Phase 5B — Eligible Email Integrity APPLIED (shared dev)

Resolved the 26 person-integrity contradictions surfaced by Phase 5A email research, then applied
only proven-safe email changes and evidence promotions to `server/data/recruitmatch.sqlite`
(shared dev — **never** production `/data`). Person identity was **never** mutated through an
email-only path. Data-integrity workstream only: no push/merge/deploy, no refresh engine, no
generic-outreach-policy decision, no broadening beyond the eligible population.

## Person re-adjudication (Parts B/C/F) — 26 reopened
Re-researched all 26 from scratch against current authoritative sources:
- **19 PROVEN_STALE** (named replacement / official departure) → `currentness_status=PROVEN_STALE`, evidence stamped, history retained, eligibility fails closed.
- **4 MOVED** (Brent→Vermont, Thomsit→Gardner-Webb, Staufenberger→a high school, McTurk→CCNY admin) → old association marked non-current with destination in the reason; **no new coach record invented**.
- **3 CURRENT_CONFIRMED** — Phase-5A contradictions **overturned** (Plattsburgh/Hernandez, Colorado College/Highstead, Murray State/Andrade): each was merely missing from a JS-rendered sport page but present on the staff directory. Kept eligible. This is exactly why "mere absence ≠ stale".

23 person repairs applied (19+4). 0 wrong-sport, 0 identity-error, 0 unknown.

## Blocked-email retry (Part D) — 65
One bounded retry via alternate authoritative sources: **44 recovered** to CURRENT_OFFICIAL_EMAIL (site outages cleared), **2 NO_CURRENT_EMAIL_PUBLISHED** (Olivet), **19 still UNKNOWN** (persistent CloudFront-403 / client-rendered). **0 new person contradictions.**

## Applied (one guarded transaction, `applyPhase5BClosure.js`, idempotent, `/data`-refusing)
| Part | Action | Count |
|------|--------|------:|
| F | person repairs → PROVEN_STALE | 23 |
| G | safe personal→personal email corrections (expected-old-value guarded; email_seen set to the proving source) | 2 |
| H | email-source promotions (exact address on current page; `email_seen_on_source_*` only) | 1285 |

Safe corrections: Angelo State `merwin→[withheld]@redacted.invalid`; Ursuline `[withheld]@ursuline.edu→[withheld]@redacted.invalid` (Ursuline→Gannon merger). `email_confirmed_at` untouched (stays 0).

## End state (measured on live shared dev)
- coaches **6339** (no deletions), integrity `ok`
- currentness: CURRENT 1919, PROVEN_STALE **129** (106→129), UNKNOWN(null) 4291
- eligible **3304 → 3281** (−23); eligible PROVEN_STALE **0**
- `email_seen_on_source_*` **3153**; `email_confirmed_at` **0**
- source-domain conflicts **0**, wrong-institution-eligible **0**, canonical round-trip **0**, duplicate addresses 118 (unchanged)

### Final eligible email ledger (sums to 3281)
| CURRENT_OFFICIAL | CURRENT_CONSUMER | CURRENT_GENERIC | DIFFERENT | NO_EMAIL_PUBLISHED | STALE | UNKNOWN |
|---|---|---|---|---|---|---|
| 3140 | 13 | 0 | 9 | 27 | 0 | 92 |

**Proven current email: 3153 / 3281 = 96.1%.** UNKNOWN 92 = 19 still-blocked + 3 rescued-but-email-unverified + 2 directory-no-email + 68 (C2 recent + C3 unknown-person, out of Part-D scope).

## Held / not applied
- **9 personal→generic replacements** (`phase5b_generic_replacement_queue.json`) — CSULB×4, USC×2, Drake, LeTourneau, Chattanooga. Policy DEFERRED; the personal address is *merely no longer published* (not disproven). Not applied.

## Invariants verified
person-repaired 23/23 PROVEN_STALE with **0 email-observed** (no email-path person repair) · generic-queue 9/9 unchanged · corrections 2/2 expected-old-value matched · rescued 3/3 stay eligible · `email_confirmed_at` 0 · conflicts/wrong-inst/round-trip 0. Regression suite (87 tests) green.

Fingerprint: `a8bc52f764a42c2ded9730522e6ee645f8cfe3fc15bef73012447ebfdd71a86a` (see `phase5b_integrity_snapshot.json`).
