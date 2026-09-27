# Phase 6C.4 — Domain Corroboration Closure APPLIED (shared dev)

Targeted ONLY the domain-corroboration problem behind the 8 Phase-6C.3 acquired programmes that had
authoritative current coach rows with exact eligible emails but were not covered-eligible. Corrected
proven `athletics_domains` rows so eligibility derives NATURALLY through the real reconcile pipeline —
no coach/programme mutation, no manual eligibility. Shared dev only; production untouched.

## Part A — the exact 8 (frozen)
Ozarks (AR) M · Simpson College W · Huntingdon College W · Tuskegee W · Wayne State (MI) W ·
Anna Maria College W · Pacific Union College W · Saint Mary's College (IN) W. Each has verified-email
current coach rows but fails on institution/domain corroboration (see `phase6c4_domain_corroboration_target.json`).

## Parts B/C — independent domain ownership (re-proved from scratch, not from desired eligibility)
All 8 distinct athletics domains adjudicated VERIFIED to their institution via the sites' own branding +
NCAA/official cross-references. Two same-name collisions resolved definitively:
- **uofoathletics.com = University of the Ozarks (AR, 107558).** Root cause of its WRONG_INSTITUTION flag:
  a same-name dual claim — `claimed_unitids [107558,178697]`, `wrong_mappings [{Ozarks (MO),178697}]`.
  College of the Ozarks (MO, 178697) does NOT use it (MO uses `bobcats.cofo.edu`). The 178697 claim was
  spurious (name/nickname collision, `evidence_kind=OG_SITE_NAME`); 107558 was always correct. The prior
  status came from the contaminating dual claim, NOT from uofoathletics.com belonging to MO.
- simpsonathletics.com = Simpson College IA (not Simpson University CA = simpsonu.edu).
- huntingdonhawks.com = Huntingdon College AL (not Huntington University IN = huathletics.com).
- pioneersathletics.com = uniquely Pacific Union College CA (no shared "Pioneers" platform).
- goldentigersports.com/wsuathletics.com/goamcats.com already VERIFIED-correct; saintmarys.edu = institution
  MAIN domain of Saint Mary's College IN (athletics under belles.saintmarys.edu).

## Parts D/E — registry collisions + blast radius
No proposed correction creates a domain→multiple-unrelated-UNITID, duplicate VERIFIED, or alias collision.
Blast radius extends BEYOND the 8: each corrected domain also carries the sibling-sport programme's
existing coaches (same UNITID). 17 coach rows touched by classification; 12 become eligible.

## Part F/G/I — fixture, simulate, apply (`applyPhase6C4DomainRepairs.js`, one guarded transaction)
4 auto-safe corrections applied (uofoathletics.com, simpsonathletics.com, huntingdonhawks.com,
pioneersathletics.com); saintmarys.edu HELD (institution main domain). Simulation on a disposable copy
then live apply — identical results, no integrity regression. athletics_domains only; coaches/colleges
untouched; eligibility never set manually.

## Parts H/J — result (rows unchanged; eligibility derived naturally)
| metric | before | after |
|---|---|---|
| eligible coaches | 3348 | **3360 (+12)** |
| COVERED_ELIGIBLE (CORE) | 1485 | **1491 (+6)** |
| CORE covered-eligible % | 68.4% | **68.7%** |
| D3 | 81.5% | **82.3%** |
| coaches | 6413 | 6413 (domain-only) |
| athletics_domains VERIFIED | 1000 | 1004 |
| WRONG_INSTITUTION | 57 | 56 |
| INSUFFICIENT_EVIDENCE | 693 | 690 |
| source-domain conflicts / wrong-institution eligible | 0 / 0 | 0 / 0 |
| validator CRITICALs | 4 | 4 (pre-existing, unrelated) |
| duplicate identity rows / emails | 0 / 121 | 0 / 121 |
| canonical round-trip / orphans / email_confirmed_at | 0 / 1 / 0 | 0 / 1 / 0 |

**12 newly eligible, 0 newly ineligible**, all within the proven blast radius:
- uofoathletics.com → Brueckner, Sequeira (Ozarks M, target) + Dreyer, Hernandez (Univ of the Ozarks W, sibling)
- simpsonathletics.com → Reinert, Ponce (Simpson W, target) + Isaacson, Varnum (Simpson IA M, sibling)
- huntingdonhawks.com → Williams, Smith (Huntingdon W, target) + Spain, Fiorani (Huntingdon M, sibling)

**6 programmes newly covered**: 3 targets + 3 sibling programmes outside the eight (a safe, understood
over-delivery via shared UNITID). The other 5 targets did NOT flip (see Part K).

## Part K — systemic root cause (precursor to the 377 NAIA question)
Eligibility corroboration has TWO gates: (1) institution RESOLVED (needs `athletics_domains` VERIFIED),
and (2) corroborated (needs coach_seasons to have SCRAPED the source domain, OR the coach name present in
coach_seasons). Root causes of the 8:
| root cause | n | outcome |
|---|---|---|
| DOMAIN_WRONG_STATUS (fixable) — scraped domain | 3 | fixed → flipped (Ozarks M, Simpson W, Huntingdon W) |
| DOMAIN_WRONG_STATUS (fixable) — not scraped | 1 | fixed but no flip (Pacific Union) |
| ATHLETICS_DOMAIN_NOT_SCRAPED — domain already VERIFIED | 3 | blocked (Tuskegee, Wayne State MI, Anna Maria) |
| DOMAIN_MISSING (institution main domain) — not scraped | 1 | held (Saint Mary's IN) |

**The dominant residual blocker is the coach_seasons-scrape dependency (gate 2): 5 of 8 targets have a
correct/VERIFIED domain and authoritative coach evidence, yet remain ineligible solely because
coach_seasons never scraped that athletics domain (and carries no coach name for the programme).**

**Implication for the 377 NAIA ineligible-only (hypothesis only — NOT researched here):** the same
architecture very plausibly explains a MATERIAL share. NAIA programmes were bulk-acquired and are
"near-universally ineligible"; the failure is almost certainly a mix of (a) unverified/INSUFFICIENT
athletics domains, (b) VERIFIED-but-never-coach_seasons-scraped domains, and (c) inferred emails. The
(a) portion is fixable with proven domain corrections exactly as done here (Simpson/Huntingdon/Ozarks
pattern); the (b) coach_seasons-scrape dependency and (c) inferred-email portions are separate axes.
The architecture strongly suggests a shared cause, so a bounded NAIA domain-audit should be scoped before
any coach re-acquisition.

## Part L — prevention (narrow, read-only)
Added `flagUnverifiedAthleticsDomains.js` (read-only; never mutates, never auto-creates a mapping): it
reports any authoritative athletics domain used by a verified-email coach that cannot corroborate —
DOMAIN_MISSING / WRONG_INSTITUTION / INSUFFICIENT_EVIDENCE / WRONG_UNITID / ATHLETICS_DOMAIN_NOT_SCRAPED —
so an acquisition SURFACES the domain-verification gap for explicit human review instead of silently
producing ineligible rows. Run against live post-apply (source=phase6c3): simpsonathletics.com /
huntingdonhawks.com / uofoathletics.com are no longer flagged (fix confirmed); remaining flags are the
NOT_SCRAPED and Wayback-sourced cases. The existing design already blocks eligibility on WRONG_INSTITUTION
and requires explicit fixture evidence to correct a domain — left intact (not weakened).

## Part M — regression tests (42/42 across 7 files)
13 domain-repair applier guards (incl. uofoathletics.com regression, expected-old-value, unitid-collision
abort, no-coach/no-programme mutation, idempotent, rollback, /data refusal) + 4 reconcile-pipeline
integration tests (VERIFIED+scraped unlocks; WRONG blocks; INSUFFICIENT blocks; VERIFIED-not-scraped
still blocked) + 2 prevention-flag tests + existing institution/currentness/emailSeen/6C.3 suites.

## Remaining unresolved domain cases → next phase
- coach_seasons NOT scraped (correct domain, still blocked): goldentigersports.com (Tuskegee),
  wsuathletics.com (Wayne State MI), goamcats.com (Anna Maria), pioneersathletics.com (Pacific Union).
- main-domain held: saintmarys.edu (register belles.saintmarys.edu subdomain instead).
- Wayback-sourced phase6c3 rows (Pacific Union, Anna Maria) — re-fetch from live official pages when reachable.

## Recommended next phase
A bounded **NAIA domain-corroboration audit** (the 377 ineligible-only), applying this exact proven-domain
pattern to quantify how many are pure domain-registry fixes vs coach_seasons-scrape dependency vs
inferred-email — the systemic hypothesis from Part K — before any coach re-acquisition. Separately, a small
coach_seasons-scrape/refresh pass would unlock the 4 correct-domain-but-not-scraped programmes here.
