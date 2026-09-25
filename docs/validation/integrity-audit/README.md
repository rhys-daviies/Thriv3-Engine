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
the contamination.
