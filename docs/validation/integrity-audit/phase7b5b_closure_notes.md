# Phase 7B.5B — NAIA Tier-2 Safe Domain Repair APPLIED (shared dev)

Applies the **62 independently-verified one-to-one athletics-domain repairs** frozen in 7B.5A
(**61 AUTO_SAFE_CORRECTION + 1 SAFE_ALIAS_ADDITION**) to the shared-dev registry. **Domain repair
only** — no coach/evidence/currentness/email_seen change; `STRICT_CORROB_SCOPE=NAIA` untouched; NCAA
byte-identical. Production untouched. The 109-programme fresh coach/evidence research is deferred to
**7B.5C**.

## Part A — 7B.5A preserved first
`b6e7b03` verified to contain only 7B.5A audit work; committed-PII scan + committed-evidence privacy
green; pushed fast-forward (non-force) `8be4d1e..b6e7b03`; local == remote; **11 ahead / 0 behind
`origin/main`**. Preserved remote SHA = `b6e7b03`.

## Part B — frozen repair set
Loaded the 7B.5A classification: **AUTO_SAFE_CORRECTION 61 + SAFE_ALIAS_ADDITION 1 = 62** approved.
Explicitly **excluded** HOLD_COLLISION 7 + NO_REPAIR_NEEDED 1 (= the 8 held distinct domains). Every
one of the 62 preregistered old-state preconditions re-verified against the **live** registry —
**zero drift**. Old-status mix: INSUFFICIENT_EVIDENCE 55, WRONG_INSTITUTION 3 (status-only fix, same
UNITID), UNREACHABLE 2, ABSENT 2 (inserts). Frozen fixture hash
`3429466bda413229007ae566fe9be8c89e959b900a0b8a3d1c463ac1935d8a37`.

## Part C — guarded applier (`applyPhase7B5BDomainRepairs.js`)
Bounded, dedicated applier: refuses `/data`, refuses production volume (>100), requires `--apply` +
exact `--fixture-hash`, refuses any HELD domain, expected-old status + expected-old unitid guards,
one-to-one ownership guard (never overwrites a domain mapped to a different UNITID), idempotent NOOP,
one transaction, `integrity_check`, rollback on any failed precondition, and post-commit postcondition
verification of every repair. **The INSERT populates every `athletics_domains` NOT NULL column**
(`status, claimed_keys, claimed_unitids, verification_method, confidence, checked_at`) — the schema is
not weakened (this fixes the deficiency in the 7B.4A DOMAIN_REPAIR insert, which was never exercised
because 7B.4A applied 0 domain repairs). Ownership is recorded as `verification_method =
PHASE7B5A_INDEPENDENT_ONE_TO_ONE` / `confidence = HIGH` — **not** page self-identification. Tests
(13) pass.

## Part D — applied to shared dev
Dry-run then apply against `server/data/recruitmatch.sqlite` only: **UPDATE 60 · INSERT 2 · NOOP 0 ·
REJECT 0** (= 62 logical repairs). `integrity ok`. Immediate re-run is idempotent (**NOOP 62**). No
coach/evidence/currentness/email_seen touched.

## Part E — domain state verified
Row count **2723 → 2725**; `domain_fp` **498eb15f… → 4d3ce59c…** (changed, as intended). Status dist:
INSUFFICIENT_EVIDENCE 690→635, UNREACHABLE 229→227, WRONG_INSTITUTION 56→53, VERIFIED 1004→1065,
VERIFIED_ALIAS 727→728, AMBIGUOUS 17. **All 62** now match their frozen proposed `(status, unitid)`;
**0** duplicate domain rows; **0** mismatches. Held domains confirmed **not** trusted:
`johnsonroyals.com` / `sfuathletics.com` / `iuccrimsonpride.com` → INSUFFICIENT_EVIDENCE/null,
`prestosports.com` → ABSENT, `lsugoldeneagles.com` → WRONG_INSTITUTION (unchanged), `lsuagenerals.com`
/ `gounionbulldogs.com` → INSUFFICIENT_EVIDENCE/null. Exactly 62 rows carry the 7B.5B tag; **0** of
them held.

## Part F — eligibility non-effect (preregistered invariant, held exactly)
Real reconcile (`STRICT_CORROB_SCOPE=NAIA`) pre-backup vs post-live: **eligible 3876 → 3876 (0)**;
**NAIA covered 234 → 234**; **Tier-2 newly covered 0**; **strict-path gained 0**; **outside-target
changes 0**; **NCAA membership delta 0** (hash `6d2df77f…` identical, matches the 7B.3 baseline). Every
division count byte-identical (NCAA D1 1327, D2 807, D3 1222, NAIA 519, USCAA 1). Confirms the 7B.5A
finding: **a domain repair alone unlocks nothing** — the strict evidence gate holds.

## Part G — Tier-2 residual (post-repair, clean input for 7B.5C)
Each of the 128 classified once: **NEEDS_FRESH_EVIDENCE 109** (former DOMAIN_REPAIR_PLUS_EVIDENCE — now
with a verified domain, still needing `email_seen` + CURRENT), COLLISION_HOLD 11, SHARED_DOMAIN_HOLD 3
(`prestosports.com` schools), INSUFFICIENT_HOLD 3, NON_DOMAIN_BLOCKER 2, OTHER 0. The 109
NEEDS_FRESH_EVIDENCE targets are prepared with **institutional identifiers + authoritative source
targets only** (`phase7b5b_needs_fresh_evidence.redacted.json`) — no coach PII, no research performed.

## Part H — prevention gap (design only, NOT implemented)
1. **Read-side ownership-review flag** — surface any coach with a verified personal email whose
   source/athletics domain is INSUFFICIENT/UNREACHABLE/MISSING, so the gap is visible at ingest (a
   read-side view over `coaches ⋈ athletics_domains`; no schema change).
2. **Wayback-source detection** — flag an `email_source_url` that is a `web.archive.org` capture
   (unwrap to the embedded real host); archival sources can locate a page but never establish
   CURRENT/`email_seen`.
3. **Shared-CDN/source-host detection** — flag shared-platform source hosts (`prestosports.com`,
   `sidearmsports.com`, `*.wixsite.com`, `*.squarespace.com`) so they are never auto-promoted to one
   UNITID.
4. **Page self-identification stays insufficient for auto-promotion** — a page naming a school does
   not prove one-to-one ownership; promotion needs independent institution↔athletics corroboration
   (this is what correctly withheld johnsonroyals/sfuathletics/iuccrimsonpride).
5. **Same-name collision protection stays authoritative** — when >1 UNITID can credibly claim a host
   (LSU = La Sierra vs Louisiana State; Union families; Saint Francis IL/IN/PA), the host is HELD for
   manual adjudication, never auto-mapped.

## Part I/J — privacy, safety, tests
Committed-PII scan + committed-evidence privacy green; committed artifacts carry only institutional
domains/UNITIDs/URLs. Production untouched; no `/data` mutation; the applier is fully guarded;
`STRICT_CORROB_SCOPE` remains exactly `NAIA`; no NCAA/NJCAA/USCAA behavioural change. Full suite: see
snapshot; zero unexplained new failures (7B.5B applier +13).

## Recommended next phase — 7B.5C
Process the **109 NEEDS_FRESH_EVIDENCE** programmes through the per-programme authoritative pipeline
(fresh current-staff + `email_seen`, exactly as Tier-1 in 7B.3) so eligibility derives via the strict
path. Then manually adjudicate the **11 COLLISION_HOLD + 3 SHARED_DOMAIN_HOLD + 3 INSUFFICIENT_HOLD**
(start with the 3 genuine wrong-mappings). Keep `STRICT_CORROB_SCOPE=NAIA`; never auto-promote a domain
any other UNITID can credibly claim.
