# Phase 7B.1 — NAIA Authoritative Revalidation Pilot APPLIED (shared dev)

A bounded, deterministic 30-programme pilot from the 235 TIER-1 NAIA programmes, to measure legacy
coach/email/domain quality authoritatively BEFORE any full-population pass. Shared dev only; production
untouched. **No global G6 eligibility change; no coach_seasons rows fabricated.** Real coach identities live
only in untracked `server/data/generated/audit-fixtures/`; committed fixtures are redacted and the appliers
refuse redacted input (`assertUnredacted`).

## Part 0 — checkpoint
The branch was force-pushed by the PR #49 PII purge; local == remote == the current tip (0/0). The Phase-7A
audit is already on origin in redacted form. Nothing to push for Part 0; the original unredacted 7A commit is
intentionally not reintroduced.

## Parts A/B — population and pilot
TIER-1 recomputed from live post-6C.4 = **235** (matches 7A under current code, incl. the stmarytx.edu hold).
Pilot = **30**, deterministic + stratified: VERIFIED-strict 17 / VERIFIED_ALIAS 13; men 15 / women 15;
multi-coach 21 / single 9; collision-risk 11; email_seen present 1. Same-name/duplicate-name families were
deliberately included (137476 St. Thomas FL, 105899 Arizona Christian, 107141 John Brown, 123457 Simpson
University CA, 104586 ERAU Prescott). Selection recorded (redacted) in `phase7b1_pilot_selection.json`.

## Parts C/E/F — authoritative research (5 parallel agents, official sources only)
All 30 = **ACTIVE_CONFIRMED**. All 5 shared-unitid name collisions resolved to a single institution each —
**0 IDENTITY_DEFECT** (a real integrity reassurance: the same-name families are correctly one institution).

**Legacy quality (pilot measurements — NOT extrapolated to the 235):**
| person outcome | n |
|---|---|
| current, same role | 50 |
| current, role changed | 1 |
| current, email now unpublished | 15 |
| departed | 4 |
| wrong sport | 2 |
| wrong institution | 0 |
| held (site blocked, browser recheck) | 1 (Williams Baptist W) |
| **stored coaches researched** | **72** |

- **Person defect rate = 8.3% (6/72)** — 4 departed + 2 wrong-sport.
- **Legacy VERIFIED email defect rate = 10.7% (6/56)** — the other 50/56 (89%) were the exact address literally
  published on the official page today.
  - **[Corrected terminology, Phase 7B.2 Part A]** All 6 are **ASSOCIATION_DEFECTs, not ADDRESS_DEFECTs**. The
    stored addresses themselves are all real and valid; the defect is that the coach *row* is not valid for the
    programme now. Mutually-exclusive reconciliation of the 56: exact-current-valid-association **50** +
    current-email-changed **0** + no-longer-published **0** + **departed-person association 4** +
    **wrong-sport association 2** + wrong-institution association **0** + unverifiable **0**. So
    **ADDRESS_DEFECT = 0 / ASSOCIATION_DEFECT = 6**. Architecturally this matters: association defects are caught
    by the strict path's *contradiction gate* (departed → PROVEN_STALE; wrong-sport → currentness only set for
    the correct programme+sport), not by the email checks.
- **Legacy INFERRED emails: 15 of 16 are unpublished/unconfirmable** — inferred addresses are pattern-shaped and
  almost never appear on the official source.
- **Consumer-domain "verified" emails were a false alarm**: the three sampled (a gemcorp.com and two yahoo
  addresses) are all GENUINELY published on official athletics pages — faithful, not junk.
- **Domain defect rate = 0% (0/19)** — every pilot athletics domain is already VERIFIED/VERIFIED_ALIAS-correct
  (expected: TIER-1 is defined by a verified-but-not-scraped domain).

## Critical finding — a defect in prior Phase 6C.3 work
**Pacific Union College WOMEN**: the three women's rows Phase 6C.3 inserted were WRONG — two are the **men's**
staff (WRONG_SPORT) and one had departed. 6C.3 had sourced them from a Jan-2026 Wayback mirror that
mis-attributed the men's staff to the women's team. The pilot's "research current staff from scratch, do not
just confirm the stored coach" design caught it. Repaired: the two wrong-sport women's rows and the departed
one are suspended (PROVEN_STALE) and the real current women's head coach was inserted. The PUC **men's** record
was correct. This is the single most important justification for the pilot-before-scale methodology.

## Parts I/J — safe corroboration model + Path A vs Path C
`server/lib/strictNaiaCorroboration.js` implements the strict 9-condition Phase-4–6 evidence path (canonical
unitid + active + sport + CURRENT + VERIFIED domain to same unitid [VERIFIED_ALIAS only with independent
proof] + exact published personal email + email_seen + currentness evidence + no contradiction). ANALYSIS
ONLY — the live gate is unchanged.
- **Under the live gate**, pilot coverage did not change (NAIA remains uncorroborated by coach_seasons — by design).
- **Under the strict-hybrid path**, after the factual repairs: **53 pilot coaches corroborate → 28 of 30
  programmes** (the 2 not covered have no directly-observed published email: Williams Baptist W held, plus one
  email-unpublished head).
- **Path A (extend coach_seasons) vs Path C (hybrid strict evidence): same safe eligible set** for the pilot.
  Both rest on the same authoritative current-coach evidence; the binding constraint is a published personal
  email, which both route through. Path A would also corroborate the ~15 email-unpublished current coaches, but
  they still fail the email gate — so eligibility is identical. Path C reaches it with stronger per-row
  provenance and without fabricating coach_seasons rows.

## Parts K/N — fixtures and applied factual repairs (`applyPhase7B1CoachRepairs.js`, one guarded txn)
- K1 current-coach inserts: **3** · K2 email corrections: **0** (none needed) · K3 stale: **6** · K4 domain: **0**
  · K5 corroboration evidence (email_seen + currentness): **50**.
- Applied to shared dev: inserts 3, stale 6, evidence 50. Guards: `/data` refusal, `assertUnredacted`,
  verified-only email, expected-old-value, duplicate-person/email prevention, one transaction, rollback,
  idempotent, `email_confirmed_at` never touched.

## Part O — post-apply (live)
coaches 6413→**6416**; eligible under live gate **3360→3360 (0 change, intended)**; proven_stale +6; email_seen
+53; `email_confirmed_at` 0; duplicate identity rows 0; duplicate emails 121 (unchanged); orphans 1;
source-domain conflicts 0; wrong-institution eligible 0; canonical round-trip 0; validator CRITICAL 0. No
integrity regression. Coaches that remain ineligible do so ONLY because G6 has no NAIA-compatible corroboration
representation — left ineligible deliberately; that architecture decision is Phase 7B.2.

## Part M — pilot safety gate (measurements, not thresholds)
Person defect 8.3%, legacy-verified email defect 10.7%, domain defect 0%. **Regardless of rate, legacy evidence
was never auto-promoted**: every applied change rests on a fresh authoritative observation (email_seen +
currentness), and every insert/stale/evidence row traces to an official-page URL. The measured rates support
using legacy identities and emails **only as research seeds / provisional values**, confirmed row-by-row — not
as authority.

## Part P — safe methodology for the remaining 205 TIER-1 (no counts extrapolated as truth)
- **Safe to automate**: the guarded applier pattern (insert/stale/evidence with expected-old guards) and the
  redacted-artifact + untracked-raw workflow.
- **Must be externally revalidated per programme**: current coach identity, current published email
  (email_seen), currentness — because ~8% person and ~11% verified-email defect means a meaningful minority is
  wrong, and the failures are not detectable from the DB alone (the PUC wrong-sport case looked clean).
- **Legacy fields → search hints only**: stored name/email seed the search; never promoted without a fresh
  official-page observation.
- **Expected repair categories**: mostly ADD_EVIDENCE (confirm+observe), plus a minority of departures,
  wrong-sport/mis-attributions, and inserts of new current staff. Verified-email corrections were 0 in the
  pilot but will occur at scale (cf. 7A Bryan).
- **Browser/manual fallback IS required**: several official athletics sites are CloudFront/403-blocked to
  automated fetch (Williams Baptist, Sterling, PUC, and others), so a full pass needs a browser-capable path
  for a subset; snippet/index-only reads must not be asserted as email_seen.

## Part Q — regression tests (green)
`applyPhase7B1CoachRepairs.test.js` (13: redacted-fixture refusal, ADD_EVIDENCE-needs-source, email-correction-
needs-evidence + expected-old, MARK_STALE, replacement no-dup, wrong-institution/sport refusal, inferred/generic
refusal, idempotent, rollback, `/data`) + `strictNaiaCorroboration.test.js` (14: the 9 conditions incl.
VERIFIED_ALIAS-needs-proof, domain-unitid-mismatch, currentness/email_seen required, inferred/generic prohibited)
+ existing institution/redaction suites.

## Recommended Phase 7B.2
Adopt **Option C (hybrid)**: allow G6 to be satisfied EITHER by coach_seasons OR by the strict 9-condition
authoritative-evidence path (`strictNaiaCorroboration`), gated behind the same guards proven here. Then process
the remaining 205 TIER-1 with the per-programme authoritative-revalidation pipeline (browser fallback for
blocked sites), applying only factual repairs with fresh email_seen/currentness. Do not weaken G6 to trust a
VERIFIED domain alone, and do not bulk-promote legacy emails.
