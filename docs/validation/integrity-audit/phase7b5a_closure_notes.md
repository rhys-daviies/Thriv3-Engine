# Phase 7B.5A — NAIA Tier-2 Domain Ground-Truth Audit (READ-ONLY)

Establishes authoritative athletics-domain ownership for all 128 Tier-2 NAIA programmes and freezes
the exact set of domain repairs that are independently safe. **No live domain mutation; no factual
data change.** `STRICT_CORROB_SCOPE=NAIA` untouched. `domain_fp` unchanged (`498eb15f…`), proving the
shared-dev `athletics_domains` table was not modified.

## Part 0 — checkpoint
Pushed `8be4d1e` to `origin/feature/coach-corroboration-7b` (fast-forward, non-force); local == remote;
10 ahead / 0 behind `origin/main`; privacy/history clean.

## Parts A/B/C — population, taxonomy, distinct domains
Recomputed live post-7B.4A Tier-2 = **128** (reconciles; 0 already eligible). **70 distinct domains**
(the 54 "multi-programme" domains are overwhelmingly a school's men's + women's programmes sharing one
host; only 2 domains carry >1 UNITID). Failure taxonomy: DOMAIN_INSUFFICIENT **86**, SOURCE_DOMAIN_STALE
**18** (best evidence was a Wayback capture — the real host is embedded in the archived URL),
DOMAIN_WRONG_STATUS **8**, SOURCE_USES_MAIN_DOMAIN **8**, DOMAIN_WRONG_UNITID **2**, SHARED_PLATFORM **2**,
OTHER **3**, DOMAIN_MISSING **1**.

## Parts D/E/F — independent verification, collision, current-host
Every distinct domain was verified independently (institution site→athletics link, athletics
branding/footer, staff page, conference/NAIA listing, redirects; NCES/IPEDS for identity) — not by
starting from the desired UNITID. Ownership: **VERIFIED_ONE_TO_ONE 58**, VERIFIED_ALIAS_ONE_TO_ONE ~4,
VERIFIED_SHARED 1 (`prestosports.com`), WRONG_CURRENT_MAPPING 3 (`johnsonroyals.com`→Johnson-TN not
Judson; `sfuathletics.com`→Saint Francis **PA** not the claimed IL school; `iuccrimsonpride.com`→IU
Columbus not the claimed IU-Indianapolis UNITID). Several registry `WRONG_INSTITUTION` flags proved to
be **false positives** (`godordt.com`, `ltuathletics.com`, `lsugoldeneagles.com`/La Sierra own their
domains). Same-name families audited (Bethany, Columbia, Saint/St. Mary, Saint Francis IL/IN/PA, Union,
Bellevue NE/WA, Clarke/Clark, Mount Mary/Mercy/Marty, Indiana campuses, Texas A&M branches, LSU
abbreviation = La Sierra vs Louisiana State). Current-host: 5 are institution main `.edu` hosts, not the
athletics host (`doane.edu`→doaneathletics.com, `seu.edu`→seufire.com, `tamut.edu`→tamuteagles.com,
`umdearborn.edu`→athletics.umdearborn.edu, `usao.edu`→usaoathletics.com); `prestosports.com` schools have
migrated to their own branded hosts (their stored source URLs are stale).

## Parts G/H — classification + blast radius
Distinct-domain repair classification: **AUTO_SAFE_CORRECTION 61**, **SAFE_ALIAS_ADDITION 1**,
HOLD_COLLISION 7 (incl. the 3 wrong mappings + `prestosports.com` shared + LSU/Union abbreviation
ambiguities held for manual confirmation), NO_REPAIR_NEEDED 1 (`parkathletics.com` already verified).
Full blast radius of the 62 safe repairs: **241 coach rows across 114 programmes** (some outside the 128
Tier-2 queue — computed before simulation). One cross-reference flagged: `georgetowncollegeathletics.com`
(Georgetown College KY) is also cited by an NCAA-D1-filed coach row (Georgetown **University** DC
contamination) — a coach-level issue, not a domain-repair blocker.

## Parts J/K — simulation (disposable DB) + outside-target blast radius
Applied only the 62 AUTO_SAFE + SAFE_ALIAS repairs on a disposable copy, then ran the real reconcile
(`STRICT_CORROB_SCOPE=NAIA`). **Eligible coaches 3876 → 3876 (0 new); NAIA covered 234 → 234; NCAA
membership delta 0; 0 newly-eligible anywhere.** This is the correct, expected result and the headline
finding: **a domain repair alone unlocks nothing**, because all 128 Tier-2 best-coaches have
`email_seen=false` and `currentness≠CURRENT`. The strict gate holds exactly.

## Part L — residual blocker classification (each of 128 once)
**DOMAIN_REPAIR_PLUS_EVIDENCE 109** (domain is safely fixable, but the programme still needs fresh
currentness + email_seen — i.e. per-programme authoritative research, exactly as Tier-1 got in 7B.3),
COLLISION_HOLD 14, INSUFFICIENT_HOLD 3, BLOCKER_NOT_DOMAIN 2. No DOMAIN_REPAIR_ONLY (none had the other
strict evidence already).

## Part M — systemic root causes
importer found the host + a candidate UNITID but never promoted it (unitid null, status
INSUFFICIENT_EVIDENCE, confidence NONE, verification_method PAGE_SELF_IDENTIFICATION): **61**; alias not
modelled: ~4; same-name contamination protection correctly withholding: 7; source used the main `.edu`
rather than the athletics host: 8; source taken from a Wayback capture (stale host): 18; shared-platform
source after the school migrated: `prestosports.com`; registry already correct (blocker elsewhere): 1.

## Part N — prevention review (read-only)
The importer never re-attempted domain promotion once independent one-to-one evidence existed, and did
not model the main-`.edu`-vs-athletics-host split, Wayback staleness, or shared-CDN hosts. **Narrow gap:**
ingestion does not flag a verified-personal-email coach whose source/athletics domain is
INSUFFICIENT/MISSING for a follow-up ownership check, nor record Wayback/shared-CDN source hosts.
**Proposal (not implemented here):** a read-side flag surfacing verified-email coaches with a
non-verified source domain, plus a Wayback/shared-CDN source detector. The same-name contamination
protection that correctly withheld `johnsonroyals`/`sfuathletics`/`iuccrimsonpride` must remain — never
auto-promote on page self-identification alone.

## Part O — frozen candidate queues for 7B.5B
In the snapshot `candidate_queues`: AUTO_SAFE_CORRECTION (61 domains, with proposed status/unitid +
expected-old guards), SAFE_ALIAS_ADDITION (1), HOLD_COLLISION (7), HOLD_INSUFFICIENT/HOLD_STALE/HOLD_SHARED,
NO_REPAIR_NEEDED (1). This is the frozen input to 7B.5B.

## Parts P/Q — privacy + snapshot
No coach PII in committed artifacts (domains/UNITIDs/URLs are institutional). Committed-PII scan +
committed-evidence privacy gates green. Snapshot `phase7b5a_naia_tier2_domain_audit_snapshot.json`;
proposed-repair fixture (raw untracked + redacted committed); `domain_fp 498eb15f…` (unchanged);
`ncaa_membership_hash` matches the pre-7B.3 baseline.

## Recommended 7B.5B apply scope
Apply the **62 AUTO_SAFE_CORRECTION + SAFE_ALIAS_ADDITION** domain repairs via a guarded DOMAIN_REPAIR
applier (one-to-one guard, expected-old status/unitid; the applier's INSERT must populate the
`athletics_domains` NOT NULL columns — `claimed_keys`, `claimed_unitids`, `verification_method`,
`confidence`, `checked_at`). Then run the **109 DOMAIN_REPAIR_PLUS_EVIDENCE** programmes through the
per-programme authoritative pipeline (fresh currentness + email_seen, like 7B.3) so eligibility derives
via the strict path. Keep the 7 collision + 3 insufficient holds for manual adjudication (start with the
3 genuine wrong-mappings + the IU-campus / Saint-Francis-IL / Johnson-vs-Judson coach-source
contaminations). Keep `STRICT_CORROB_SCOPE=NAIA`; never auto-promote a domain that any other UNITID can
credibly claim.
