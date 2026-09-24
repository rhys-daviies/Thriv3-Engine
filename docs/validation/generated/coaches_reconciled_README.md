# coaches_reconciled — Phase 3B reconstructed coaching dataset (NON-PRODUCTION)

`coaches_reconciled.csv` — one row per legacy `coaches` record (6,347), re-resolved
through the repaired resolver + corrected registry, with explicit status fields.
The original `coaches` table is the untouched baseline (sha256 2a1781d1…, unchanged).

Built by `server/scripts/reconcileCoaches.js` against a non-production reconstruction
copy. Registry repaired first by `server/scripts/repairAthleticsDomains.js`
(188 evidence-backed, coach_seasons-corroborated). Nothing was applied to production.

Fields: coach_id, coach_name, email, title, sport, legacy_school, legacy_unitid,
canonical_unitid, canonical_school, source_url, source_domain, email_domain,
classification (KEEP/REASSIGN/WITHHOLD/REVIEW), institution_resolution_status
(RESOLVED/REVIEW/WITHHOLD), coach_identity_status (VERIFIED/UNVERIFIED),
email_verification_status (verified/inferred/generic/unknown), outreach_eligibility
(YES/NO), ineligible_reason, resolution_method, evidence, reassigned, canonicalized.

Eligibility is registry-corruption-immune: YES requires institution RESOLVED, a
verified per-person email, and INDEPENDENT coach_seasons corroboration (identity or
a coach_seasons-scraped source domain). Integrity gates G1–G5 pass (0 failures);
0 eligible coaches at a wrong institution.
