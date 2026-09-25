# Athletics-domain identity integrity — audit trail (Phases 2A–2D)

This directory records how a set of 28 `athletics_domains` rows whose stored
UNITID disagreed with their own `claimed_unitids` were investigated and, for the
subset that external evidence proved wrong, corrected. **The earlier hypotheses
are kept deliberately.** The Phase-2A failure is the reason external verification
is now required; rewriting it to look correct would erase that lesson.

## Phase 2A — initial hypothesis (WRONG, retained as evidence)
Hypothesis: a VERIFIED domain whose `unitid` is not in its single `claimed_unitids`
is mis-pointed, and the claim is the truth — so `unitid := the sole claimed value`
is a deterministic repair (27 domains; `rutgers.edu` excluded as ambiguous).
- Artifact: `phase2a_domain_corrections.json` — **superseded/annotated**; each row
  now carries its Phase-2C verdict. It is no longer a correction set.

## Phase 2B — apply attempt, then full revert (the disproof)
The 27 were applied to the shared dev DB, then a regression signal (a coach going
YES→NO) exposed that at least `pct.edu` was wrongly changed: `pct.edu` **is**
Pennsylvania College of Technology (366252, the original stamp); a stray "Penn
College" claim pointed at UPenn. **All 27 were reverted**; the shared DB was
restored exactly (0 differing rows). Lesson: `claimed_unitids` is not authoritative.

## Phase 2C — external ground truth (28/28)
Each domain was verified against external evidence — the site's own
self-identification + NCES/IPEDS — never Thriv3's own mapping. Classification:
- **A — existing mapping correct (2):** `pct.edu`, `wvu.edu` (Phase 2A would have
  wrongly changed both). The bad *claim* is the upstream fault.
- **B — correction proven (24):** remap `unitid` → externally-verified UNITID.
- **C — multi-institution (1):** `rutgers.edu` (system domain).
- **D — ambiguous (1):** `floridasports.com` (parked/for-sale, no owner).
- Artifacts: `phase2c_ground_truth.json` (28 rows + evidence URLs),
  `phase2c_category_b_corrections.json` (24), `phase2c_coach_institution_changes.json`.

## Phase 2D — approved apply (23) + recurrence prevention
Approved a conservative subset: **the 24 Category-B minus `njcu.edu`** = **23**,
applied to the shared dev DB (`server/data/recruitmatch.sqlite`, **not** production
`/data`), domain-registry-only, transactional/all-or-nothing/idempotent, coaches
untouched (fingerprint `723c2bc4…` unchanged).
- Artifact: `phase2d_approved_corrections.json` (the 23).
- **Held cases and reasons:**
  - `njcu.edu` — Kean–NJCU merger completed 2026-07-01; 185129 is right for the
    historical dataset but the post-merger operating institution is a policy call.
  - `pct.edu`, `wvu.edu` — existing mapping externally proven correct; do not change.
  - `rutgers.edu` — multi-institution/system domain; the registry can't do 1:1.
  - `floridasports.com` — parked domain owned by no institution; unmap decision is human.
- **Recurrence fixed at source:**
  - `tools/soccer/verification/known_domains.json`: removed the ambiguous
    "Penn College" alias (the correct "Pennsylvania College of Technology" key
    now claims `pct.edu`); moved `wvu.edu`/`mail.wvu.edu` off "WVU Institute of
    Technology" onto "West Virginia", and gave WVU Tech its real domains.
  - `server/scripts/verifyAthleticsDomains.js`: a page self-identification may
    only VERIFY an institution a claim agrees with; a host that matches no claim
    is AMBIGUOUS (verify externally), never a silent cross-institution VERIFIED.
    Replayed against all seven failure signatures in
    `server/scripts/verifyAthleticsDomains.replay.test.js`.
  - `server/scripts/validateInstitutionIntegrity.js`: the UNITID-vs-claim check
    now reads "VERIFY-OWNERSHIP" (detection), not "replace UNITID with claim".

## Downstream effect worth recording
Correcting the shared dev registry changed `athleticsDomainAuthority.test.js`:
six domains it asserted were quarantined as INSTITUTION_MISMATCH now resolve
correctly, so that test was updated to assert the corrected mappings rather than
the contamination. (Phase 3B updated four L7 fixtures in total —
`athleticsDomainAuthority`, `rosterSourceAudit` ×2, `operations` — to assert the
cleared state.)

## Phase 3A — coach source-domain conflict ground truth (127)
After the domain repairs, 127 coaches remained whose authoritative source/email
domain disagreed with their filed institution. All 127 were researched (45
distinct domains externally verified). Every filed institution was wrong: a
same/near-name institution collision at acquisition (e.g. `@dom.edu`/dustars.com
coaches filed under Dominican (CA) are Dominican University IL). Artifacts:
`phase3a_coach_conflicts.json` (127 records + evidence).
- 121 WRONG_INSTITUTION, 6 DUPLICATE_IDENTITY.
- Repair sets: 112 SAFE_COACH_REASSIGN, 6 DUPLICATE_RESOLVE, 9 HUMAN_REVIEW
  (true institution's women's-soccer programme absent from the college set).

## Phase 3B — applied the 118 approved coach filing repairs
Applied to the shared dev DB (`server/data/recruitmatch.sqlite`, **not** `/data`)
in one transaction: 112 `coaches.school` reassignments (institution filing only —
name/email/source/sport/role untouched) + 6 redundant duplicate deletions (their
correct copy already existed; no downstream references, no evidence merge needed).
- Result: coaches 6347 → 6341; source conflicts 127 → 9; outreach-safe 3418 → 3412
  (−6 = the deleted duplicates); 0 eligible coaches at a wrong institution.
- Fixtures: `phase3b_reassign_fixture.json` (112), `phase3b_duplicate_fixture.json`
  (6), `phase3b_human_review_held.json` (9, untouched).
- Applier: `server/scripts/applyCoachInstitutionRepairs.js` (guarded, transactional).
- **Acquisition root cause fixed:** `server/lib/coachingImport.js` gained a
  corroboration rule (`resolveCoachInstitution` + `buildInstitutionIndex`) wired
  into `coachingImportApply`/`coachingImportPreview`: strong source/email domain
  evidence outranks the fuzzy name match and, when it contradicts the name,
  returns `REVIEW_INSTITUTION_CONFLICT` instead of filing wrongly. Generic
  (gmail/outlook) and shared/ambiguous domains never force an assignment.
  Proven by `coachingImport.corroboration.test.js` (real collision families) and
  a full-route replay on a disposable dataset (0 wrong filings recreated).
- The 9 HUMAN_REVIEW are held pending a decision to seed the missing
  women's-soccer programmes; no programmes were invented.

## Phase 3C — verified the five missing women's-soccer programmes (read-only)
All five (Keene State 183062, Rhode Island College 217420, Southern Maine 161554,
Emmanuel MA 165671, New England College 182980) externally verified as active
NCAA D3 women's-soccer programmes for 2026-27, genuinely absent from `colleges`
(not a naming/join defect; Emmanuel GA 139630 is a distinct institution).
Simulation: coach conflicts 9→0, no spurious eligibility, 0 new duplicates.
Women's conference verified independently: LEC for Keene/RIC/USM, **GNAC** for
Emmanuel MA + NEC (their men's rows carry CCC — flagged, not changed). Evidence:
`phase3c_proposed_womens_programmes.json` (per-field provenance).

## Phase 3D — applied the five women's-soccer programmes + reassigned nine coaches
Applied to the shared dev DB (not `/data`) in one transaction via
`server/scripts/applyWomensProgrammes.js` (guarded, idempotent): 5 women's-soccer
`colleges` rows (institution fields copied from the men's row; division `NCAA D3`
+ externally-verified conference; every sport-specific metric left NULL) + 9
`coaches.school` reassignments. Result: colleges 2404→2409, coach source-domain
conflicts 9→0, KEEP 5108→5117, REASSIGN 107→98, outreach-safe 3412→3412 (no
spurious eligibility), 0 wrong-institution eligible, 0 new duplicate/round-trip.
No men's row, alias, roster or coach_seasons touched. Fixture:
`phase3d_programme_fixture.json`. Two bounded follow-ups recorded (not repaired)
in `phase3d_followup_queue.json`: (A) verify Emmanuel MA + NEC **men's** CCC vs
women's GNAC; (B) women's Little East/GNAC conference completeness (peers NULL).
