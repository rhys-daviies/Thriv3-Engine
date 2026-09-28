# Phase 4F — Eligible-Coach Integrity Closure (APPLIED to shared dev)

Applied the proven eligible-coach currency closure to `server/data/recruitmatch.sqlite`
(shared dev — **never** the production `/data` volume). Data-integrity workstream only:
no push / merge / deploy, no recurring refresh engine, no broadening to ineligible coaches.

## What was applied

Migration (additive, idempotent — `migrate.js` `COACH_COLUMNS`):
- `email_seen_on_source_at`, `email_seen_on_source_url` — email **observation** provenance,
  distinct from `email_confirmed_at` (deliverability, untouched). Proven additive: after the
  migration alone, every count and `eligible` were unchanged.

Data transaction (`server/scripts/applyPhase4FClosure.js`, one all-or-nothing txn, `/data`-refusing,
expected-old-value guards, idempotent — a second run changes nothing):

| Part | Action | Applied | Notes |
|------|--------|--------:|-------|
| D | 89 defects → `PROVEN_STALE` | 89 | 75 stale + 12 moved + 2 wrong-sport. Identity/history preserved (**no deletions**). MOVED/WRONG_SPORT carry the move/sport evidence in the reason; the fixture has no proven-safe reassignment target, so the old association is marked non-current rather than inventing a new current record. |
| E | Deterministic email corrections | 5 | 5 of the 10 already applied in an earlier phase (idempotent no-op). Expected-old-value guarded. |
| F | NAME_CORRECTION | **0** | `Andres Mateos-Carrion → Matteos-Carrion` stays **guarded** (coach_seasons name-join risk). Never applied. |
| G | CURRENT promotions (external page evidence) | 1751 | +167 already CURRENT. Never promotes a defect, RECENT, UNKNOWN, or coach_seasons-only corroboration; never overwrites `PROVEN_STALE`. |
| H | `email_seen_on_source_*` populated | 1866 | Exact stored-address-on-current-page matches only (incl. the 10 corrected addresses). `email_confirmed_at` untouched. |

## End state (measured on live shared dev)

- coaches **6339** (no deletions), integrity `ok`
- currentness: CURRENT **1919**, PROVEN_STALE **106** (17→106), UNKNOWN(null) **4314**
- eligible **3393 → 3304** (−89); eligible PROVEN_STALE **0**
- `email_seen_on_source_*` populated **1866**; `email_confirmed_at` **0** (unchanged)
- source-domain conflicts **0**, wrong-institution-eligible **0**, canonical round-trip **0**

### Person-verdict ledger over the 3304 eligible (reconciles to 3393 with defects)
- CURRENT_CONFIRMED **3235** = 1918 externally page-stamped + 1317 coach_seasons-corroborated (deliberately not externally stamped — the Part G distinction)
- RECENT_CONFIRMED **10** · RESEARCHED_UNKNOWN **59**
- removed from eligible: 75 stale + 12 moved + 2 wrong-sport = **89**

### The 59 researched-UNKNOWN
All remain `currentness_status = NULL` — none flipped to CURRENT or PROVEN_STALE by the closure.
Documented Phase-4E reason split (analyst classification, not a stored column):
42 person-absent-not-proven-departed · 12 site-blocked · 4 conflicting-evidence · 1 no-current-staff-page.

## Distinction preserved
- **currentness** (person on staff) ≠ **email observation** (`email_seen_on_source_*`) ≠ **deliverability** (`email_confirmed_at`).
- coach_seasons corroboration is **not** promoted into external-check timestamps.
- Email observation carries **no** eligibility weight (test-enforced).

## Pre-existing, NOT introduced here
`validateInstitutionIntegrity` reports 4 domain-ownership disagreements (floridasports.com, wvu.edu,
njcu.edu, pct.edu) — byte-identical before and after Phase 4F. Registry axis, unrelated to this closure.

## Fingerprint
See `phase4f_integrity_snapshot.json` — coach fingerprint, counts, ledgers, the 59 UNKNOWN ids,
fixture/evidence hashes, migration state. This is the reference point for future integrity work.
