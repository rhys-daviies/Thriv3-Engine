# Phase 7B.3 — TIER-1 NAIA Authoritative Revalidation APPLIED (shared dev)

Rolls the per-programme authoritative-revalidation pipeline proven in 7B.1/7B.2 across **all 205
remaining TIER-1 NAIA programmes** (frozen 235 − 30 pilot). Shared dev only; production untouched.
Legacy coach/email records were **search hints only** — nothing promoted without a fresh official-page
observation. No G6 change; `STRICT_CORROB_SCOPE=NAIA` throughout; NCAA byte-identical.

## Part 0 — checkpoint
Pushed `9142faa` (fast-forward); local == remote, 0/0.

## Parts A/B — frozen population + deterministic batches
Recomputed remaining TIER-1 from live post-7B.2 = **exactly 205** (0 already eligible; reconciles 235−30).
Deterministic sha256(unitid|sport) shuffle into fixed slices **A–E = 40, F = 5**, risk-balanced across
gender / VERIFIED vs VERIFIED_ALIAS / single-vs-multi / collision-risk / inferred-mix / conference — hard
cases not clustered in the final batch. Raw untracked; redacted committed
(`phase7b3_tier1_population.redacted.json`, `phase7b3_batch_manifest.redacted.json`).

## Parts C–H — research + factual repairs (official sources only, zero fabrication)
Each programme researched from the **programme**, not the stored coach: official current staff page →
authoritative domain → exact published personal email → currentness → observation. Browser fallback for
CloudFront/403/JS-only sites; institution-directory fallback where the athletics site was blocked.
Snippet/index-only never asserted as `email_seen`; generic inboxes and inferred addresses never promoted.

**Access:** LIVE_AUTHORITATIVE_READ 176 · BROWSER_FALLBACK_READ 13 · OFFICIAL_DIRECTORY_FALLBACK 5 · **BLOCKED 11**.
**Factual repairs applied:** ADD_EVIDENCE **406** · CORRECT_EMAIL **3** · MARK_STALE **51** (departed 42,
wrong-institution 6, wrong-sport 3) · INSERT_CURRENT **35** · HOLD **187**.

Integrity catches worth naming (all correctly suspended/held, none promoted): cross-institution
contamination (Southwestern **TX** vs KS; Carroll **WI** vs MT; Bethany **WV** vs KS; Columbia College **SC**
vs MO; Indiana U **East** vs Northwest; a Graceland generic inbox filed under Cumberland); a Jordan/Justin
Keegan identity conflation at Corban; a malformed official mailto at New College; Bethel-TN inferred rows on
the wrong `bethel.edu` domain. Dual-role shared-staff coaches (e.g. Nelson, Ottawa, Bethany-KS, Tabor) were
handled explicitly — inserted under `EXISTING_DUAL_ROLE` where the applier could express it, else skipped
(coverage unaffected). One domain defect (Bethany-KS `bethanyswedes.com` athletics vs `bethanylb.edu` email)
recorded `NEEDS_DOMAIN_REPAIR` and **held** for a dedicated domain-repair pass — never silently remapped.

## Parts I–N — guarded application, per-batch simulate→gate→apply→snapshot
`applyPhase7B3CoachRepairs.js` (same guard model as the 7B.1 pilot: `/data` refusal, `assertUnredacted`,
verified-only email, expected-old-value, canonical active unitid not held, duplicate-person/email prevention,
one transaction, integrity_check, rollback, idempotent, `email_confirmed_at` never touched; provenance tag
`phase7b3_naia_tier1`). Each batch was simulated on a disposable copy, passed all **12 Part-K gates**, then
applied to shared dev with a pre-batch snapshot; eligibility derives naturally from the live reconcile.

| batch | inserts | email | stale | evidence | NAIA covered after |
|---|---|---|---|---|---|
| A | 7 | 0 | 9 | 82 | 69 |
| B | 4 | 1 | 17 | 75 | 107 |
| C | 7 | 0 | 4 | 77 | 143 |
| D | 5 | 1 | 10 | 78 | 179 |
| E | 9 | 1 | 11 | 84 | 217 |
| F | 0 | 0 | 0 | 10 | 222 |

Every batch: NCAA eligible-membership delta **0** (hash-frozen vs the pre-7B.3 baseline), other-division delta
0, 0 wrong-institution / wrong-sport / stale eligible, 0 source-domain conflicts, 0 untouched-legacy row newly
eligible, every new strict row evidence-complete, DB integrity ok, privacy gate green.

## Parts O/P — rollout outcome
- NAIA eligible coaches **56 → 494**; strict-path coaches **53 → 491**.
- NAIA COVERED_ELIGIBLE **30 → 222** of 384 active (**7.8% → 57.8%**); COVERED_INELIGIBLE_ONLY 152; NO_COACH_DATA 10.
- **192 of the 205** Tier-1 programmes newly covered; **13 remain uncovered, all explained**: 11 blocked
  official sites (Huntington M, Baker M/W, Midland M/W, Rochester Christian M, Defiance M, Oakland City M/W,
  OPSU M, Waldorf W) + 2 conservative gate-holds (Corban M identity conflation; Bethel-TN W domain not
  registered to the UNITID). **No unexplained residual.**
- Verified-legacy email quality: exact-current-valid **406**; changed addresses (ADDRESS_DEFECT) **3**;
  departed/wrong-association (ASSOCIATION_DEFECT) **51**. Address defects stay separate from association defects.

## Part Q — remaining NAIA tiers (recomputed, frozen; NOT processed)
Tier-2 DOMAIN_VERIFICATION **128** · Tier-3 EMAIL_RESEARCH **4** · Tier-4 CURRENTNESS **0** · Tier-5/6/7
MULTI-AXIS **5**. Unchanged by 7B.3 — no domain mappings were altered, so no Tier-2 programme migrated on
shared-domain evidence.

## Part R — NCAA non-regression (final)
NCAA eligible membership **3356 → 3356**, hash `6d2df77f…` identical before/after; 0 added, 0 removed.
Other non-NAIA divisions: 1 → 1, hash identical. **Exact zero delta.**

## Parts S/T — privacy + regression
Raw identities/emails untracked (`server/data/generated/**` gitignored); committed artifacts redacted
(`coach-<id>@redacted.invalid` / `[withheld]@domain`, URLs/domains kept); appliers reject redacted fixtures;
committed-evidence privacy test green; no PII introduced to git history. Regression suite (70 tests):
7B.3 applier (13, incl. dual-role insert + provenance tag + same-email-different-institution block), 7B.1
applier (13), strict-hybrid reconcile (27), strict-corroboration lib, committed-evidence privacy.

## Part U — closure snapshot
`phase7b3_naia_tier1_closure_snapshot.json` (population, batch outcomes, factual-repair counts, coverage
before/after, residual reasons, remaining tiers, NCAA hashes, integrity invariants, fingerprints).

## Recommended next phase
**7B.4 — held-item recovery + domain repair**: browser rechecks of the 11 blocked official sites; the
`NEEDS_DOMAIN_REPAIR` register (Bethany-KS and any others) via a dedicated, expected-old-guarded domain-repair
applier; the Corban Keegan identity fix. Then **Tier-2 (128)** domain-verification. Keep `STRICT_CORROB_SCOPE=NAIA`.
