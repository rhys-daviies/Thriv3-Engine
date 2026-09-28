# Phase 7B.5D — NAIA Tier-2 Hold Adjudication + Closure APPLIED (shared dev)

Individually adjudicated the **22 remaining Tier-2 residual rows** (19 distinct programmes; Christendom W
appears ×3 and Park-Gilbert M ×2 as null-unitid duplicate rows). Shared dev only; production untouched.
`STRICT_CORROB_SCOPE=NAIA` unchanged; NCAA byte-identical. Every domain host's true ownership was
established from institution-site→athletics-link + host self-identification + IPEDS — never from a name.

## Part 0/A — checkpoint + frozen 22
Pushed `4131bf9` (fast-forward; local==remote; 13 ahead / 0 behind main; privacy clean; tracked-clean).
Recomputed the original 128 Tier-2: residual **22 rows** (COLLISION 11, SHARED 3, INSUFFICIENT 3,
NON_DOMAIN 2, DOMAIN_REOPEN 2, CURRENT_NO_ELIGIBLE_EMAIL 1) — reconciles. Case ledger frozen with
per-domain claim graphs.

## Part C — 11 COLLISION_HOLD (claim graphs built for each)
**ONE_TO_ONE_CORRECTION_PROVEN 7**, **DISTINCT_DOMAINS_RESOLVED 4**, LEGITIMATE_SHARED 0,
STALE_HISTORICAL 0, UNRESOLVED 0.
- `gounionbulldogs.com`→157863 (Union Commonwealth = Union KY, one school; M+W), `lsugoldeneagles.com`→117627
  (La Sierra; "Sierra"→123341 was a FALSE claim, rejected), `lsuagenerals.com`→159382 (LSU-Alexandria; M+W),
  `johnsonroyals.com`→220473 (Johnson U TN; W) — one-to-one confirmed.
- `sfuathletics.com` proved to serve **Saint Francis PA (215743)**, NOT SF-IL (148575); SF-IL's true host
  is `gofightingsaints.com`. `johnsonroyals.com` proved Johnson's, so **Judson (146339)**'s legacy coach
  row was a contamination — Judson's own `judsoneagles.com`/`judsonu.edu` already VERIFIED.
- `iuccrimsonpride.com` genuinely serves **Indiana University Columbus** (true IPEDS **15111102**), but our
  colleges table staples the IU-Columbus programme to unitid **151111 (IU Indy)** → **IDENTITY DEFECT**;
  15111102 is absent from colleges, so no safe mapping → held PROGRAMME_DEFECT (both M+W).

## Part D — 3 SHARED_DOMAIN_HOLD → **SPECIFIC_HOST_SAFE 3**
`prestosports.com` (shared root, never mapped to one UNITID) replaced by institution-specific verified
hosts: Defiance→`defianceathletics.com`, Florida College→`wearefc.com`, Viterbo→`viterboathletics.com`.
The coaches' `email_source_url` had pointed at the shared tenant (`defiance.prestosports.com`) or a Wayback
URL; repointed to the institution host so strict corroboration resolves.

## Part E — 3 INSUFFICIENT_HOLD (Christendom W ×3 rows, 1 programme)
Host `christendomathletics.com` confirmed, but Christendom declines Title IV → **no IPEDS UNITID**, and only
a generic women's-soccer team inbox (`wsoccer@` on the institution domain) is published →
**CURRENT_GENERIC_ONLY** (held; no personal institutional email, never inferred).

## Part F — 2 DOMAIN_REOPEN → both COVERABLE
Prior blocks were datacenter-tool artifacts; `tamuteagles.com` (TAMU-Texarkana 224545) and
`mtmaryathletics.com` (Mount Mary 239390) load fine in real Chrome, are institution-specific and safely
representable. tamuteagles.com upgraded INSUFFICIENT→VERIFIED; mtmaryathletics.com already VERIFIED.

## Part G — 2 NON_DOMAIN_BLOCKER (Park-Gilbert M ×2 rows, 1 programme)
Park University Gilbert is a **branch campus with no distinct IPEDS UNITID** (its host
`gilbert.parkathletics.com` is a tenant of Park University 178721, whose `parkathletics.com` serves the
Parkville MO team). Blocker = missing distinct identity → **PROGRAMME_DEFECT** (held).

## Part H — 1 CURRENT_NO_ELIGIBLE_EMAIL
UHSP men's (179265): rechecked; men's-soccer coaches page unpublished and the staff directory omits men's
soccer. **CURRENT_NO_ELIGIBLE_EMAIL** (held; valid integrity outcome).

## Parts I/J — repairs
**Domain repairs (7)** via guarded `applyPhase7B5DDomainRepairs.js` (fixture `f810fa78…`; shared-root
refusal; collision_class∈{one-to-one, distinct}; expected-old + one-to-one guards; NOT NULL insert):
`gofightingsaints.com`→148575, `gounionbulldogs.com`→157863, `johnsonroyals.com`→220473,
`lsuagenerals.com`→159382, `lsugoldeneagles.com`→117627 (WRONG_INSTITUTION→VERIFIED), `tamuteagles.com`→224545,
INSERT `viterboathletics.com`→240107. **0 alias additions.** Domain repair alone unlocked 0 (confirmed).
sfuathletics.com→215743 (SF-PA, out of NAIA scope) left INSUFFICIENT/untrusted — preserved, not erased.
**Coach/evidence repairs** via `applyPhase7B5CCoachRepairs.js`: INSERT_CURRENT 3, CORRECT_EMAIL 4,
MARK_STALE 5, ADD_EVIDENCE 19, REASSIGN 3, CORRECT_NAME 0. The 3 SF-IL coaches (Dillard/Mireles/Rueger)
were mis-filed under "University of Saint Francis (IN)" (stfrancis.edu = Joliet IL) → **REASSIGNED** to
Saint Francis (IL) 148575 (never-correct filing), then evidenced.

## Parts K/L/M — simulation + safety gates
Each fixture set simulated on a disposable copy; **all 12 safety gates PASS** (source-domain conflicts 0,
wrong-institution 0, wrong-sport 0, stale-eligible 0, canonical round-trip 0, duplicate-identity no
regression, NCAA hash unchanged, other-division unchanged, no shared root assigned to one UNITID, strict
evidence complete, privacy, DB integrity). Blast radius: all effects inside the 22; NCAA exact membership
unchanged.

## Part N — applied
Domain repairs → coach/evidence repairs → reconcile. Idempotency verified. No manual eligibility.

## Part O — Tier-2 exit gate (all 128 classified)
**COVERED_AUTHORITATIVE 120** · PROGRAMME_DEFECT 4 (IU Columbus M+W wrong-unitid; Park-Gilbert M ×2 rows)
· CURRENT_NO_ELIGIBLE_EMAIL 4 (Christendom W ×3 rows; UHSP M). **0 unexplained — Tier-2 integrity-closed.**

## Part P — NAIA universe
Active NAIA programmes **384** (380 distinct; 4 duplicate college rows). Eligible coaches **519 → 773**;
covered programmes **234 → 354** (lineage) / 356 distinct-key (**92.2% / 93.5%**); strict-path **516 → 770**.
Remaining uncovered by queue (reconciles to active): Tier-1 3, Tier-2 3, Tier-3 5, Tier-5/6/7 5,
other/baseline ~9.

## Part Q — next tail (Phase 7C input; NOT processed)
Tier-3 `email_research_queue` (4) and Tier-5/6/7 `identity_review_queue` (5) recomputed live — all still
uncovered. Frozen as the Phase 7C input.

## Part R — shared-platform architecture finding
Every 7B.5D shared case also had an institution-specific VERIFIED host, so the registrable-domain model
did not need weakening. **Recommendation: keep option A (host-only registry)**; adopt option C
(per-programme institution→athletics-link evidence) only if a future division (NJCAA/USCAA) has schools
whose ONLY host is a shared-platform tenant. Do not implement here.

## Part S — prevention findings
same-name collision (6 domains); stale registry claims (false Sierra flag, iuindyjags WRONG_INSTITUTION);
shared-platform + Wayback source URLs blocking corroboration; missing alias / new host (gofightingsaints,
viterboathletics); identity defects (IU Columbus wrong UNITID, Park-Gilbert branch has none); no-email
(UHSP, Christendom generic). Detail in the snapshot for a later prevention phase.

## Parts T/U — tests + snapshot
New `applyPhase7B5DDomainRepairs.test.js` (10) + all prior integrity/collision/shared-guard suites:
**158 pass**. Broad suite: 14 pre-existing failures only, **proven identical vs the pre-7B.5D checkpoint**;
zero new failures. committed-PII + committed-evidence privacy green; raw fixtures untracked. Snapshot
`phase7b5d_naia_tier2_hold_closure_snapshot.json`. `domain_fp 4d3ce59c… → 0fc6c91a…` (7 repairs),
`coach_fp 000f75b2…`, `ncaa_membership_hash 6d2df77f…` (unchanged).

## Recommended Phase 7C
Process the recomputed tail — Tier-3 (4, `email_research_queue`) + Tier-5/6/7 (5, `identity_review_queue`)
+ the ~9 other/baseline uncovered — plus a **college-identity reconciliation** for the two Tier-2
PROGRAMME_DEFECTs (register IU Columbus UNITID 15111102 and decide Park-Gilbert's identity), then re-run
fresh evidence. Keep `STRICT_CORROB_SCOPE=NAIA`; do not start NJCAA/USCAA without a new decision.
