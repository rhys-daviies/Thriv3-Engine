# Phase 7B.4A — TIER-1 NAIA Exception Closure APPLIED (shared dev)

Closes the 13 explicit uncovered TIER-1 NAIA exceptions from 7B.3 (plus the two separately-held
pilot programmes) where authoritative evidence could now be obtained safely. Shared dev only;
production untouched. `STRICT_CORROB_SCOPE=NAIA` unchanged; NCAA byte-identical.

## Part 0 — Git reconciliation (hard gate, PROVEN SAFE)
- **Cause:** the remote feature branch had been rewritten by a separate PII-redaction rebuild
  (pr49-rebuild + privacy-wt worktrees); the app also auto-pushed a WIP checkpoint (`0353ad2`) of the
  7B.3 work; `origin/main` advanced via the PR #49 merge (`225ca29`). The complete 7B.3 commit
  (`406ba50`) diverged from both, tracking `origin/feature/coach-corroboration-7b` (ahead 1 / behind 1:
  clean `406ba50` vs the WIP `0353ad2`).
- **Method:** two normal merges — no force, no reset. Merged the tracked WIP remote (a content subset
  of `406ba50`; resolved a `batch_A_snapshot` add/add + `redacted_artifacts.txt` union to the complete
  `406ba50` superset), then merged `origin/main` (one conflict in `server/scripts/committedPiiScan.js`
  resolved to the UNION allow-list — no real address allow-listed). The committed-PII scan then flagged
  real-domain addresses in the new 7B.3 applier test; rewritten to RFC 2606 reserved domains. `406ba50`
  preserved as an ancestor throughout.
- **Result:** local HEAD `698484a`; pushed fast-forward (non-force) to `origin/feature/coach-corroboration-7b`;
  **9 ahead / 0 behind `origin/main`**; committed-PII scan + committed-evidence privacy pass; no raw
  fixtures/SQLite tracked; no unredacted PII resurrected.

## Part A — exception universe (frozen)
Recomputed live post-7B.3 Tier-1: **205 = 192 covered + 13 uncovered** (11 blocked official sites + 2
identity/domain gate-holds). Williams Baptist W and Sterling M are **separate pilot holds** (not in the
205) — Williams Baptist *M* was already eligible; no double-count.

## Parts B–F — authoritative recheck (browser-first; zero fabrication)
Every blocked site was retried with a real browser / official institution directory. Search
snippets/Wayback can locate a page but never establish `email_seen`/CURRENT unless the authoritative
page was actually read.
- **Blocked-site outcomes:** RECOVERED_AUTHORITATIVE 9 · PROGRAMME_DEFECT 2 (Oakland City M+W — the
  institution suspended all undergraduate programs for 2026-27 and signed a teach-out) · STILL_BLOCKED 0.
- **Corban M (identity):** Jordan and Justin Keegan are **distinct** current staff; the stored `corban.edu`
  address is officially head coach **Jordan** Keegan's — the stored row bound it to "Justin". Repair =
  CORRECT_NAME Justin→Jordan + evidence. Justin (GK) has no published email → held. Identities were NOT merged.
- **Bethel-TN W (identity+domain):** stored "Maggie Aird" holds head coach **Misty Aird**'s published
  `bethelu.edu` address → CORRECT_NAME + evidence. `bethelathletics.com` was already VERIFIED to UNITID
  219718 in the registry, so **no domain repair** was needed (the coverage gap was simply missing evidence).
- **Bethany-KS (domain):** already covered; both `bethanyswedes.com` and `bethanylb.edu` verified one-to-one
  to 154721, no collision with Bethany **WV** → no repair (registry already correct).
- **Williams Baptist W:** Danny Carney's email now literally on an official page → ADD_EVIDENCE (recovered).
- **Sterling M:** replacement head coach identified but the only email source is a **Wayback capture** →
  **held** (HISTORICAL_ONLY cannot establish CURRENT); Jeff Kidd stays PROVEN_STALE.

Every relevant source domain was already VERIFIED in the registry (`huathletics.com`, `defianceathletics.com`,
`bethelathletics.com`, `midlandathletics.com`, `corbanwarriors.com` alias, `opsuaggies.com`, `williamsbu.edu`,
`bakeru.edu`, `rcu.edu`, `oak.edu`), so **zero domain-registry mutations** were required.

## Parts G–I — guarded application (`applyPhase7B4ARepairs.js`)
Same guard model as 7B.1/7B.3 plus two new guarded ops: **CORRECT_NAME** (expected-old-name guard) and
**DOMAIN_REPAIR** (one-to-one guard — never overwrites a domain mapped to a different UNITID; expected-old
status). `CORRECT_EMAIL` here also promotes a confirmed-published address to `verified`. One transaction,
`/data` refusal, `assertUnredacted`, expected-old guards, integrity_check, rollback, idempotent,
`email_confirmed_at` untouched. **Applied:** INSERT_CURRENT 3 · CORRECT_EMAIL 2 · MARK_STALE 10 ·
ADD_EVIDENCE 21 · CORRECT_NAME 2 · DOMAIN_REPAIR 0 · HELD 5. Simulated first on a disposable copy — all
12 Part-K gates PASS.

## Part J — Tier-1 exit gate (all 235 classified)
**COVERED_AUTHORITATIVE 232 · PROGRAMME_DEFECT 2 (Oakland City M+W) · AUTHORITATIVE_SOURCE_BLOCKED 1
(Sterling M).** No unexplained Tier-1 residual — the exit gate is met.

## Parts K/R — NAIA universe + non-regression
- NAIA eligible coaches **494 → 519**; strict-path **491 → 516**; COVERED_ELIGIBLE **222 → 234** of 384
  active (**57.8% → 60.9%**); COVERED_INELIGIBLE_ONLY 140; NO_COACH_DATA 10.
- **NCAA eligible membership delta = 0** (hash `6d2df77f…` identical before/after); other-division delta 0.
- Integrity: 0 wrong-institution / wrong-sport / stale eligible; 0 source-domain conflicts; duplicate
  identity 1 (= baseline); canonical round-trip 0; DB integrity ok.
- Remaining NAIA tiers (recomputed, frozen, NOT processed): Tier-2 **128** · Tier-3 **4** · Tier-4 **0** ·
  Tier-5/6/7 **5** — unchanged by 7B.4A (no domains altered).

## Part L — tests / privacy / snapshot
Regression suite (94 tests): 7B.4A applier (11, incl. CORRECT_NAME identity guard + DOMAIN_REPAIR
one-to-one guard + CORRECT_EMAIL verified-promotion), 7B.3 applier (13), 7B.1 applier (13), strict-hybrid
(27), strict lib, committed-PII scan (13), committed-evidence privacy (4). Raw PII untracked; committed
artifacts redacted; `domain_fp` unchanged (`498eb15f…`), proving zero domain mutation. Closure snapshot:
`phase7b4a_naia_tier1_exception_closure_snapshot.json` (includes the Git reconciliation record).

## Recommended next phase
**7B.5 — Tier-2 (128) domain-verification**: verify/correct the source domains for the verified-personal
emails whose athletics domain is INSUFFICIENT/WRONG/MISSING, using the guarded DOMAIN_REPAIR path (one-to-one
proof, expected-old guards) proven here, then let eligibility derive via the strict path. Keep
`STRICT_CORROB_SCOPE=NAIA`. The 3 documented Tier-1 residuals (Oakland City M+W defunct; Sterling M
Wayback-only) need no further action unless the institution/site status changes.
