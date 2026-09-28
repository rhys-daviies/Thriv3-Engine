# Phase 7A — NAIA Eligibility Failure Audit (READ-ONLY)

Explains exactly why NAIA outreach coverage is ~0.5%. No mutation: no coach/domain/coach_seasons/rule
changes. Measured on a reconciled temp copy of post-6C.4 live shared dev. Coverage classes reconcile to
384 active NAIA (2 covered-eligible + 378 ineligible-only + 4 no-coach-data).

## Headline
NAIA's near-zero coverage is **NOT** a missing-coach or missing-email problem. It is an **architectural
corroboration gap stacked on an under-evidenced legacy email set**:
1. **coach_seasons was never built for NAIA** (1 of 376 active NAIA programmes present vs NCAA D1 562/562,
   D2 454, D3 702). The eligibility gate G6 (corroboration) can only be satisfied by coach_seasons identity
   or a coach_seasons-scraped source domain — data NAIA structurally never received.
2. **NAIA "verified" emails are bulk legacy** (798/801 from `graduating_seniors.coaching_staff`, only
   6/801 with `email_seen_on_source` evidence). Spot-validation found 1/4 verified-labeled addresses did
   not match the officially published one (Bryan College). So the "verified" label is systematically
   under-evidenced.

## Eligibility gates (Part B — from reconcileCoaches.js, see phase7a_eligibility_gate_model.json)
G1 real email · G2 not-team · G3 email_status='verified' · G4 institution RESOLVED · G5 class KEEP/REASSIGN ·
G6 corroborated (idAtCurrent OR idAtEvidence OR sourceDomainTrusted) · G7 not PROVEN_STALE. All hard.
**G6 is the NAIA killer** and is recoverable ONLY by coach_seasons evidence (or an equivalent alt path).

## Coach + programme ledgers (Parts C/D)
1061 NAIA coach rows through the model (0 mismatch vs the live pipeline → faithful). 372 uncovered
programmes classified. **Primary blockers:** DOMAIN_NOT_SCRAPED 235 · DOMAIN_INSUFFICIENT 113 ·
DOMAIN_WRONG 8 · DOMAIN_MISSING 7 · EMAIL_INFERRED 4 · INSTITUTION_IDENTITY 3 · EMAIL_UNKNOWN 2.
**All-occurrence** (overlap): DOMAIN_NOT_SCRAPED 238 · EMAIL_INFERRED 137 · COACH_SEASONS_MISSING 92 ·
INSTITUTION_IDENTITY 94 · DOMAIN_INSUFFICIENT 57. **Top combo: DOMAIN_NOT_SCRAPED alone (237)** — a single
architectural fix would unblock the plurality.

## Domain + coach_seasons audits (Parts F/G)
206 distinct source domains. **TRUSTED_NOT_SCRAPED = 517 coaches / 236 programmes** (the 6C.4 hypothesis,
now quantified at NAIA scale) vs TRUSTED_AND_SCRAPED 5/4. coach_seasons proof: NCAA-only external CSV,
NAIA 1/376 → structural exclusion.

## Email + currentness (Parts H/I)
365/384 uncovered programmes have ≥1 verified-labeled personal email; **295 have a verified, resolved,
current coach blocked ONLY by corroboration.** Currentness is not a blocker (UNKNOWN passes; 0 PROVEN_STALE).

## Recovery tiers (Part J)
TIER1 CORROBORATION_ONLY **235** · TIER2 DOMAIN_VERIFICATION **128** · TIER3 EMAIL_RESEARCH **4** ·
TIER4 CURRENTNESS 0 · TIER5 MULTI_AXIS **3** · TIER6 IDENTITY_DEFECT 0 · TIER7 NO_USABLE **2**.

## Counterfactual simulations (Part K — analysis only)
- **Sim1** (treat VERIFIED-correct domains as corroborating): **+515 coaches / +236 programmes** (135 via
  VERIFIED-strict, 101 via the riskier VERIFIED_ALIAS class).
- **Sim2** (domain fixes only, gate kept): **+3 programmes** — domain verification WITHOUT a corroboration
  path barely helps (confirms 6C.4).
- **Sim3** (alt path: VERIFIED domain + email_seen + CURRENT + unitid match): **+1 programme** — an alt path
  that demands observation/currentness evidence unlocks almost nothing because NAIA rows lack it.
- **Sim4**: inferred prohibited adds **0** — the Sim1 unlock is entirely verified-labeled emails.

## Part L — why the coach_seasons gate exists, and can newer evidence replace it?
Per the reconcileCoaches.js comment, coach_seasons is "the only registry-corruption-immune trust signal":
athletics_domains is systematically wrong for ambiguous same-names (e.g. every "Columbia" domain →
Columbia University), so a KEEP/REASSIGN is trusted for OUTREACH only when an INDEPENDENT source
(coach_seasons, scraped from each school's own site) corroborates it. It protects against **wrong
institution, same-name/importer collisions, and source contamination** (and, incidentally, over-trusting
unobserved emails). **Do the Phase 4–6 fields provide equivalent protection today? Not for NAIA:**
`email_seen_on_source` is populated on 6/1061 NAIA rows and `currentness=CURRENT` on 5 — the newer
evidence model was never populated for NAIA. So coach_seasons is currently acting as an **NCAA-only
historical proxy that structurally excludes NAIA**; the newer fields *could* provide equivalent
independent protection, but only once they are actually captured (they are not, for NAIA).

## Part M — systemic repair options (assessment; NOT chosen by coverage alone)
| option | safety | coverage potential | complexity | maintenance | contamination risk | data needed |
|---|---|---|---|---|---|---|
| **A** extend coach_seasons acquisition to NAIA | HIGH (proven anti-contamination model) | high (~236 once scraped) | med-high (build NAIA scraper) | ongoing scrape | LOW | NAIA roster/staff pages (380/384 have rosters) |
| **B** relax gate to VERIFIED-domain + canonical-unitid | MED-LOW | high (236) but 101 via risky ALIAS | LOW (code) | low | **MED-HIGH** (reintroduces same-name/alias contamination the gate exists to stop; also trusts 798 unobserved emails) | none |
| **C** hybrid: coach_seasons OR strict newer-evidence (VERIFIED-strict domain + email_seen + CURRENT + unitid) | HIGH | grows as acquisitions populate email_seen (currently ~1) | med | med | LOW | email_seen/currentness at acquisition time |
| **D** keep gate, manually research/promote NAIA | HIGHEST | high but slow | low code / high labor | very high | LOW | manual |

**Recommendation (safest scalable):** **Option A as the primary lever, evolving toward Option C** — do NOT
adopt Option B alone. Two reasons B is unsafe here: (1) it reintroduces the exact same-name/VERIFIED_ALIAS
contamination the corroboration gate was built to prevent (101 of the 236 rely on VERIFIED_ALIAS); (2) the
NAIA "verified" emails are bulk-legacy without observation evidence and ~25% wrong in the sample, so making
them eligible by relaxing corroboration would push unverified addresses into outreach. The correct fix is a
**fresh authoritative NAIA acquisition (the 6C.3 pattern)** that simultaneously (a) corroborates the
institution via the official athletics domain and (b) re-observes each email with `email_seen_on_source` —
which satisfies the existing gate honestly (Option C's strict alt path) without weakening it, and repairs
the second (email-provenance) deficit at the same time. Extending coach_seasons (A) is the mechanical
equivalent and reuses existing rosters.

## Part N — external spot validation
6 programmes across tiers: TIER1 Aquinas & Northwestern IA and TIER2 Pikeville all CORRECT (exact verified
emails published on official sites); TIER3 Calumet and TIER5 Tougaloo directionally correct (inferred/not
published; Tougaloo also a current-coach identity question). **1 false positive: Bryan (TIER2)** — coach
current but the DB "verified" email did not match the published address. **0 false negatives.** Conclusion:
tier/blocker classification is directionally accurate, but NAIA "verified" email quality is unreliable and
must be re-observed during remediation.

## Part O — Phase 7B candidate queues (phase7a_phase7b_candidate_queues.json; exact IDs)
trusted_not_scraped 235 · domain_verification 128 · email_research 4 · currentness 0 · identity_review 5.

## Recommended Phase 7B sequence
1. **NAIA authoritative acquisition (Option A/C pattern)** starting with TIER1's 235 programmes: re-fetch
   the official coaches page, capture the head/recruiting coach with `email_seen_on_source` + currentness,
   and register the athletics domain — this satisfies corroboration AND re-verifies the email in one pass.
   Do it programme-by-programme with the 6C.3/6C.4 guarded appliers; never bulk-trust the legacy emails.
2. Fold TIER2's 128 into the same acquisition (domain verified as a by-product).
3. TIER3/5/7 (~11) → targeted email/identity research.
Do NOT relax the corroboration gate as a shortcut.

## Remaining uncertainty
- The exact false-positive rate of the 798 legacy "verified" NAIA emails (sample of 4 → 1 wrong); needs
  the acquisition pass to quantify, not an estimate.
- 3 CloudFront-blocked athletics domains in the sample prevented literal-publication reads (Bryan, Calumet,
  Tougaloo) — a live browser session may be needed in 7B.
