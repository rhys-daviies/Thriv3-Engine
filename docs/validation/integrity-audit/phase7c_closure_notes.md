# Phase 7C — NAIA Tail Reconciliation + Final Remediation APPLIED (shared dev)

Resolved the accounting inconsistency FIRST, then remediated the actionable tail. Shared dev only
(`server/data/recruitmatch.sqlite`); production untouched. `STRICT_CORROB_SCOPE=NAIA` unchanged; NCAA
byte-identical. No federal UNITID was fabricated.

## Part 0 — checkpoint
Pushed `7855a66` (fast-forward; local==remote; 14 ahead / 0 behind main; privacy clean; tracked-clean).

## Parts A–C — canonical distinct-programme ledger + denominator reconciliation
- **384** active NAIA DB rows → **383 distinct logical programmes** (1 true duplicate row: Calumet
  150172|mens-soccer appears twice). 5 null-UNITID programmes.
- **Authoritative coverage metric** = covered distinct logical programmes / all distinct active logical
  programmes = **354/383 (92.43%) pre**, **364/383 (95.04%) post**.
- **Prior number spread resolved**: 354 = correct distinct-programme count; 356 = a distinct-key
  intersection variant; **359 = a row-level count that double-counted the Calumet duplicate row and
  collapsed the 5 null-UNITID programmes into 2 keys**. The canonical ledger is now the single source of truth.
- **Tier-3 "5 vs 4"**: `email_research_queue` has 4 distinct keys; the phantom 5th was the Calumet
  150172|mens-soccer **duplicate row** bucketing twice. Tier-3 = 4 distinct programmes / 5 rows.
- **The "~9 other/baseline"** were programmes that lost eligibility under strict reconcile (not a queue):
  Georgetown KY M, Dallas Christian M, Milligan M+W, Columbia SC W, St. Francis IL W (148584), IU East M,
  Johnson U M, Graceland M.
- **Christendom College is USCAA, not NAIA** — never in the denominator; the "×3" was 3 coach rows.

## Parts D–E — programme identity defects + identity-model decision
Established from NCES/IPEDS (see snapshot `identity_adjudications`):
- **IU Columbus** — no own federal UNITID (reported under IU Indianapolis 151111, which is also our NCAA
  D1 IU Indy). `15111102` is an NCES Global Locator campus code, **not** an IPEDS UNITID — never written.
- **St. Francis (IL)** — 148584 = USF Joliet (real NAIA, gofightingsaints.com); **148575 = a Peoria
  nursing college with no athletics**. The 148575 men's soccer row is erroneous → Part O row cleanup.
- **Benedictine-Mesa, Park-Gilbert** — branch campuses fielding real NAIA soccer, no own UNITID.
- **Stanton University** — active NAIA (Cal Pac) W soccer, not Title IV → no IPEDS UNITID at all.
- **Milligan 486901** — valid IPEDS id (not an identity defect).

**Decision (Part E):** DEFER the additive identity model; document the 7 branch/non-Title-IV programmes
as `IDENTITY_NOT_REPRESENTABLE_SAFELY` residuals. Recommended model: nullable `federal_unitid` +
internal `athletics_entity_id` + `parent_unitid` + `campus_label` + provenance, coverage keying on
`athletics_entity_id`. Not implemented here (broad migration; preserves federal-UNITID semantics).

## Parts F–L — actionable tail research + guarded apply
Research channel: `curl -L` from the sandbox reaches Sidearm/PrestoSports coach pages (200) though
WebFetch 403s them; emails captured from the live official coaches page or `/information/directory`.
**Applied (all-or-nothing, expected-old guarded):**
- **1 domain repair** (7B.5D applier, one-to-one): `cbcmustangs.com` INSUFFICIENT→VERIFIED 106713.
- **Coach repairs** (new `applyPhase7CCoachRepairs.js`, `source=phase7c_naia_tail`): INSERT_CURRENT 5
  (Graceland, Dallas Christian, Concordia NE, Sterling, Calumet — current head coaches), CORRECT_EMAIL 5
  (Central Baptist M+W, Columbia SC W, IU East M, Georgetown KY M — re-observed CURRENT + email_seen),
  MARK_STALE 2 (departed predecessors), REASSIGN 3 (Hunter→Columbia SC, Andrews→IU East, Jones→Georgetown
  KY: mis-filed legacy schools corrected so `cls==KEEP` lets STRICT_AUTHORITATIVE_CURRENT fire).
- **SF-IL W not repaired**: the 148575/148584 split pulls the women's coaches back to 148575 regardless of
  reassignment; requires college-row surgery → deferred to Part O, held as an identity residual.

## Parts K/M — safety gates + coverage
Simulated on a disposable copy; **all 12 Part-K gates PASS** (source-domain conflicts 0, wrong-institution
0, wrong-sport 0, stale-eligible 0, duplicate-identity no regression, canonical round-trip 0, NCAA hash
unchanged, other-division unchanged, no untouched-NAIA unlocked, strict evidence complete, privacy, DB
integrity). Applied to shared dev; re-measured post-apply identical. **Coverage 354→364 (+10) = 95.04%.**

## Parts N/O — residual standard + row cleanup queue
**19 documented residuals**: IDENTITY_NOT_REPRESENTABLE_SAFELY 8 (IU Columbus M/W, Park-Gilbert M/W,
Benedictine-Mesa M/W, Stanton W, St. Francis IL W), CURRENT_NO_ELIGIBLE_EMAIL 8 (Milligan M/W, SCAD M/W,
UHSP M, WAU W, Tougaloo M, Johnson M), AUTHORITATIVE_SOURCE_BLOCKED 3 (Oakland City M/W, Jarvis W).
Row-level cleanup queue (structural, later phase): Calumet duplicate row; SF-IL 148575/148584 unification;
SCAD cross-division duplicate (do not touch NCAA); IU Columbus wrong-federal-id; 5 null-UNITID branch rows;
75 name-drift unitids.

## Parts P/Q — evidence quality + NCAA isolation
Strict path **770→780**; all 780 have CURRENT + email_seen + verified email + currentness source +
resolved UNITID (**100%**). NCAA membership hash `6d2df77f…` **unchanged** (delta 0); other-division hash
unchanged (delta 0); global eligible 4130→4140.

## Parts R/S/T — prevention, tests, snapshot
Prevention synthesis recorded in the snapshot (same-name contamination, stale staff, association defects,
inferred emails, shared-platform source issues, branch-campus identity, blocked sites, no published email).
New `applyPhase7CCoachRepairs.test.js` (14) + full suite; broad failures proven pre-existing vs the
pre-7C backup. committed-PII + committed-evidence privacy green; raw fixtures untracked.
Snapshot `phase7c_naia_tail_reconciliation_snapshot.json`. `domain_fp e6f768e2…`, `coach_fp 7ff6c2b6…`,
`ncaa_membership_hash 6d2df77f…` (unchanged).

## Recommendation (Part U final report item 53–54)
NAIA coach-contact data integrity is **substantially closed at 95.04%** distinct-programme coverage with
every one of the 383 programmes explicitly disposed (364 covered + 19 defensible residuals). Not yet
"fully closed": the 8 identity residuals await the additive identity model, the 3 source-blocked await the
residential Chrome channel, and the 8 no-email are valid holds. Next: (7D) a college-identity + additive
identity-model phase to clear the row cleanup queue and the 8 identity residuals; then the first
cross-division integrity phase (NJCAA/USCAA) under the same guard model.
