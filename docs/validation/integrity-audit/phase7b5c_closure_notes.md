# Phase 7B.5C — NAIA Tier-2 Fresh Authoritative Evidence Recovery APPLIED (shared dev)

Processed the **109 NEEDS_FRESH_EVIDENCE** Tier-2 programmes frozen by 7B.5B with fresh per-programme
authoritative research (current official staff → exact published email → CURRENT + email_seen), in three
deterministic gated batches (A=40, B=40, C=29). Shared dev only; production untouched.
**No `athletics_domains` mutation** (`domain_fp 4d3ce59c…` unchanged), `STRICT_CORROB_SCOPE=NAIA`
unchanged, NCAA byte-identical. Legacy rows were search hints only; nothing was promoted without a fresh
authoritative observation.

## Part 0/A — preflight + frozen 109
Local == remote `7ba1a5b`; 12 ahead / 0 behind main; tracked-clean; privacy clean. Recomputed the
Tier-2 residual live: **109 NEEDS_FRESH_EVIDENCE**, membership **identical** to
`phase7b5b_needs_fresh_evidence.redacted.json` (added 0, removed 0, changed-blocker 0). `domain_fp`
still `4d3ce59c…` (shared dev untouched since 7B.5B).

## Part B — deterministic balanced batches
A=40, B=40, C=29 (109). Balanced across gender (M50/W59), VERIFIED vs VERIFIED_ALIAS (107/2),
collision-risk (7/9/3, not deferred to C), single/multi-coach, conference, legacy status.

## Parts C–I — research + source reality
Every programme independently confirmed **ACTIVE_CONFIRMED** (109/109). **Environmental finding:** the
datacenter/built-in-browser IP is hard-blocked (CloudFront 403 / Cloudflare challenge) on ~70% of NAIA
athletics hosts (Sidearm, PrestoSports). With the operator's approval the phase **pivoted to the
operator's residential Chrome** (BROWSER_FALLBACK_READ) for the blocked hosts; official `.edu`
directories were the fallback where even that failed. Source accessibility: LIVE_AUTHORITATIVE_READ 49,
BROWSER_FALLBACK_READ 51, OFFICIAL_DIRECTORY_FALLBACK 9. No inferred/generated/third-party emails;
Wayback = HISTORICAL_ONLY; index snippets = INDEX_ONLY (never populate email_seen).

## Part N — quality metrics (kept SEPARATE)
Stored coaches researched **308**. Person: CURRENT_SAME_ROLE 262, CURRENT_ROLE_CHANGED 6, DEPARTED 29,
WRONG_INSTITUTION 5, UNKNOWN 6. Email: EXACT_CURRENT 205, UNPUBLISHED 65, UNVERIFIABLE 29, CHANGED 4,
WRONG_PERSON 5. **ADDRESS_DEFECT_RATE = 9/308 = 2.9%**; **ASSOCIATION_DEFECT_RATE = 34/308 = 11%**.

## Parts K/L/M — simulation, apply, post-batch gates
Each batch simulated on a disposable copy; **all 12 Part-K gates PASS** every batch (source-domain
conflicts 0, wrong-institution 0, wrong-sport 0, stale-eligible 0, duplicate-identity no regression,
canonical round-trip 0, NCAA hash unchanged, other-division unchanged, no untouched-NAIA newly unlocked,
strict evidence complete, privacy, DB integrity). Applied to shared dev (guarded applier
`applyPhase7B5CCoachRepairs.js`, `--targets` outside-guard, expected-old guards, `/data` refusal,
transaction, integrity_check, idempotent). **Applied totals: INSERT 27 · CORRECT_EMAIL 4 · MARK_STALE 33
· ADD_EVIDENCE 201 · CORRECT_NAME 0 · REASSIGN 0.** Snapshots `phase7b5c_batch_{A,B,C}_snapshot.json`.

## Part O — coverage closure (109)
**COVERED_AUTHORITATIVE 106** + documented residual **3**: CURRENT_NO_ELIGIBLE_EMAIL 1 (UHSP men's — no
men's-soccer coach email published), DOMAIN_REOPEN 2 (TAMU-Texarkana W, Mount Mary W — current athletics
platform is an unverified PrestoSports host; held for a domain phase). No unexplained residual.

## Part P — entire Tier-2 (128) post-state
Covered **106**; residual from the 109 = **3**; **held 19 unchanged** (COLLISION_HOLD 11,
SHARED_DOMAIN_HOLD 3, INSUFFICIENT_HOLD 3, NON_DOMAIN_BLOCKER 2). **No held programme was covered as a
side-effect.** (A dual-role GK coach — Mauricio Nunez, William Penn men's+women's — was inserted for the
processed women's programme only, matched by UNITID not school-string, so the "William Penn" vs "William
Penn University" name variance did not misfile it.)

## Part Q — global NAIA measurement
Active NAIA programmes **384**. Eligible coaches **519 → 750**. Covered programmes **234 → 340**
(**60.9% → 88.5%**). Strict-path coaches **516 → 747**. Remaining uncovered NAIA by queue: Tier-2 held 19
+ Tier-2 residual 3, plus the pre-existing non-Tier-2 uncovered (COVERED_INELIGIBLE_ONLY / NO_COACH_DATA
+ Tier-3/5/7 — untouched this phase).

## Part R — NCAA / non-NAIA non-regression
NCAA eligible membership hash `6d2df77f…` **identical** before/after (delta 0), matches the pre-7B.3
baseline. Other non-NAIA division hash identical (delta 0). Global eligible 3876 → 4107.

## Part S — prevention observations (quantified; NOT implemented)
1. **IP-blocked sources** — ~70% of NAIA athletics hosts (Sidearm/PrestoSports) 403/challenge datacenter
   IPs; a durable pipeline needs a non-datacenter fetch path or an explicit BLOCKED residual policy.
2. **Stale staff** — 29 DEPARTED, 6 role-changed among 308 researched.
3. **Same-name contamination** — 5 legacy rows filed under a wrong same-name school (USF Indiana used
   Joliet-IL `stfrancis.edu`; correct host `sf.edu`).
4. **Changed / wrong-person emails** — 4 CHANGED, 5 WRONG_PERSON.
5. **Inferred-email gap** — 65 legacy addresses were inferred and simply not published officially →
   confirms inferred emails must never be promoted.
6. **Source-host changes** — main-`.edu` subdomains / new branded hosts; 2 DOMAIN_REOPEN for a domain phase.
7. **Programme lifecycle** — Siena Heights University announced closure end of 2025-26 (active this year).

## Parts T/J — tests + privacy
New applier `applyPhase7B5CCoachRepairs.test.js` (13) + 7B.5B applier (13) + strict-hybrid / domain /
currentness / email-seen / institution-integrity / committed-privacy suites: **117 pass**. Broad suite:
14 pre-existing failures only (operations 7, k3cRemediation 3, rosterGapQueue 2, reacquisitionCohort 1,
verifiedDomainBackfill 1, generalisation setup) — **proven identical against the pre-7B.5C checkpoint**;
zero new failures. committed-PII scan + committed-evidence privacy green. Raw research fixtures untracked.

## Part U — fingerprints
`domain_fp 4d3ce59c…` (unchanged — no domain mutation), `coach_fp b0719ae0…`, `college_fp` recorded;
`ncaa_membership_hash 6d2df77f…` (unchanged). Snapshot
`phase7b5c_naia_tier2_fresh_evidence_closure_snapshot.json`.

## Recommended next NAIA phase
**7B.5D — Tier-2 hold adjudication + domain-reopen**: manually adjudicate the 11 COLLISION_HOLD (start
with the 3 wrong-mappings + USF-IL/IN and Union/LSU families), 3 SHARED_DOMAIN_HOLD (prestosports),
3 INSUFFICIENT_HOLD, 2 NON_DOMAIN_BLOCKER, and register the 2 DOMAIN_REOPEN athletics hosts via the
guarded 7B.5B domain-repair path; then re-run fresh evidence for any unlocked. Keep
`STRICT_CORROB_SCOPE=NAIA`.
