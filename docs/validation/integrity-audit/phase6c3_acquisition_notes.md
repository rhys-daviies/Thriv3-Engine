# Phase 6C.3 — True CORE Acquisition APPLIED (shared dev)

Acquired deterministic current coach data for the bounded true-acquisition-gap population remaining
after programme-integrity repair (6A/6B), coach_seasons recovery (6C.1) and mis-filed-coach recovery
(6C.2). Shared dev only (never `/data`). No inferred/generic emails; `email_confirmed_at` stays NULL;
no programme-structure mutation; no existing-record recovery auto-applied (held for review).

## Part 0 — remote checkpoint
Pushed `fix/institution-identity-integrity` to origin (fast-forward, no force). Remote HEAD = local HEAD
`faf7915`, 0/0 in sync, verified. No merge/PR/deploy; production untouched.

## Part A — live acquisition universe (recomputed, anchor-validated)
Active CORE (D1/D2/D3/NAIA/USCAA) = 2170. COVERED_ELIGIBLE 1482 (68.3%), INELIG 631, CS_ONLY 16,
NO_COACH_DATA **41**. Reconstruction reproduced the 6C.2 whole-active scorecard exactly (ELIG 1482 /
INELIG 632 / CS_ONLY 16 / NODATA 269 over 2399 active). The 41 CORE gap split **20 non-USCAA + 21 USCAA**.
**USCAA (21) excluded** per user decision (closing STOP: "no USCAA ingestion"). **Phase-6C.3 target = 20.**
Classified: TRUE_NO_DATA 18, SOURCE_FALLOUT 1 (Trinity University TX W, from 6C.2), INELIGIBLE_EXISTING 1
(Saint Joseph's ME M — mis-filed rows).

## Parts C/D — activity + current staff (5 parallel research agents, official sources only)
| activity | n | programmes |
|---|---|---|
| ACTIVE_CONFIRMED (acquired) | 11 | Shaw W, Tuskegee W, Wayne State (MI) W, Loras W, Trinity U (TX) W, Simpson W, Ozarks (AR) M, Pacific Union W, Saint Mary's (IN) W, Huntingdon W, Anna Maria W |
| ACTIVE_CONFIRMED (staff, no eligible email) | 4 | Miami (FL) W, Milligan M, Milligan W, Trinity Washington W (roster-currency flag) |
| ACTIVE (existing-record recovery, held) | 2 | Saint Joseph's (ME) M, Indiana University East M |
| DISCONTINUED | 2 | Bryn Athyn W (all athletics cut 2025), University of Valley Forge W (institution closed Jul 2026) |
| AFFILIATION/STRUCTURAL DEFECT | 1 | Dallas Christian M (NCCAA not NAIA; 2026 roster unpopulated) |

Several inaugural 2026 programmes (Tuskegee, Wayne State MI) and several head coaches double as men's+women's
coach (dual-role). Two live sites CloudFront-blocked (Pacific Union, Anna Maria) → read via the official
page's Wayback mirror (not a third-party aggregator); Simpson/IU East 403 to WebFetch → read via browser.

## Part F — duplicate/existing-person gate (full coaches table)
- **Dual-role, inserted** (same person already coaches the men's team, added women's record): Randy McClure (Shaw),
  Hernan Granados + Kenneth Perez (Pacific Union).
- **HELD for review**: Matt Pucci (Loras — dual-role blocked by a `Loras` vs `Loras College` name-string
  inconsistency); Salma Luevano (Shaw — same person under Charleston W + name/email surname mismatch);
  Saint Joseph's (ME) 5 mis-filed `@sjcme.edu` rows + Gus Ford (departed) + Jamie Kelly (new); Indiana
  University East — Andrews & Soto filed under IU Northwest (shared `iu.edu` domain), likely moved.
  → `phase6c3_existing_record_recovery_queue.json`.

## Parts G/H — outcomes and fixture (sum = 20)
ACQUISITION_READY 11 · CURRENT_STAFF_NO_EMAIL 4 · EXISTING_RECORD_RECOVERY (held) 2 · PROGRAMME_DEFECT 3.
`phase6c3_core_acquisition_fixture.json` = **25 deterministic inserts** across the 11 ready programmes, each
with an exact published personal email, canonical active unitid, currentness + email-observation evidence.

## Parts I/K — simulate then apply (one guarded transaction, `applyPhase6C3Acquisition.js`)
Simulation on a disposable copy: no integrity regression (criticals 4→4 pre-existing, source-domain
conflicts 0→0, duplicate identity rows 0, wrong-institution-eligible 0, round-trip 0). Applied to live:
**inserted 25, integrity ok.** Guards: `/data` refusal, verified-email only (inferred/generic refused),
CURRENT currentness (UNKNOWN refused), active canonical unitid, held/ambiguous-unitid refusal,
duplicate-person/email prevention, EXISTING_DUAL_ROLE gating, one transaction, integrity check, rollback,
idempotent.

## Part J — programme-level gain (rows ≠ coverage)
| | n |
|---|---|
| target programmes | 20 |
| acquisition-ready | 11 |
| **became COVERED_ELIGIBLE** | **3** (Shaw, Loras, Trinity University) |
| got coach rows but still ineligible | 8 (domain corroboration pending) |
| existing-record recoveries held | 2 (+2 held dual-role/ambiguous) |
| current-staff no-email | 4 |
| discontinued/defect | 3 |

**Root cause of the 8 non-flips:** these programmes' athletics-site domain is either not coach_seasons-scraped
(Tuskegee, Wayne State MI, Pacific Union, Saint Mary's, Anna Maria) or not VERIFIED in `athletics_domains`
(Simpson/Huntingdon INSUFFICIENT_EVIDENCE; Ozarks' `uofoathletics.com` flagged WRONG_INSTITUTION), and
coach_seasons carries no coach *name* for them — so the conservative eligibility gate cannot corroborate the
institution. The coach data is now correct and current; eligibility is blocked on a **separate domain-corroboration
axis** (out of this phase's scope). This is why inserted rows (25) far exceed covered-eligible flips (3).

## Before → after (measured live)
| metric | before | after |
|---|---|---|
| coaches | 6388 | 6413 (+25) |
| eligible coaches | 3343 | 3348 (+5) |
| COVERED_ELIGIBLE (CORE) | 1482 | **1485 (+3)** |
| COVERED_INELIGIBLE_ONLY | 631 | 639 (+8) |
| COACH_SEASONS_ONLY | 16 | 16 |
| NO_COACH_DATA (CORE) | 41 | **30 (−11)** |
| CORE covered-eligible % | 68.3% | **68.4%** |
| D2 / D3 | 87.4 / 81.2 | 87.7 / 81.5 |
| duplicate emails / identity rows | 118 / 0 | 121 / 0 |
| wrong-institution eligible / round-trip | 0 / 0 | 0 / 0 |
| orphan coaches / email_confirmed_at | 1 / 0 | 1 / 0 |
| DB integrity | ok | ok |

## Provenance (Part M): 25/25 pass
Active canonical programme, valid unitid, correct sport, exact published email, source + email-source URL,
currentness + email-observation evidence, `email_confirmed_at` NULL, no inferred/generic provenance.

## Regression (Part N): 40/40
16 new 6C.3 applier tests (all 15 required guards + valid insert) + 8 (6C.2) + 9 (6C.1) + institution
validator + reconcile currentness + reconcile emailSeen.

## Remaining CORE backlog (closure artifact — see snapshot)
1. remaining true acquisition gaps with an acquirable email: **0** (all addressed)
2. current staff, no eligible email: 4 (Miami FL, Milligan M/W, Trinity Washington)
3. coach_seasons exceptions: 16
4. existing-record recovery held: 2 programmes + 2 dual-role/ambiguous
5. programme structural issues: 3 (Bryn Athyn, Valley Forge, Dallas Christian) + flags (Shaw division, Trinity Washington currency)
6. vacancies: 0 · 7. blocked/unknown: 0
8. **domain-corroboration pending: 8** acquired programmes (correct rows, need athletics_domains/coach_seasons corroboration to flip eligible)
9. USCAA out of scope: 21

## Recommended next phase (6C.4 / 6D)
**Domain-corroboration closure** — the highest-leverage next step: verify the 8 acquired programmes'
athletics-site domains in `athletics_domains` (and fix `uofoathletics.com` WRONG_INSTITUTION → Ozarks 107558)
so the 25 already-correct rows flip to covered-eligible (+~8 programmes, no new research). Then work the held
`phase6c3_existing_record_recovery_queue.json` (Saint Joseph's ME reassign+Kelly, IU East move, Loras/Shaw
dual-roles) and the `phase6c3_programme_defect_queue.json` retirements (Bryn Athyn, Valley Forge). USCAA and
NJCAA ingestion remain separate, explicit-go-ahead-only scopes.
