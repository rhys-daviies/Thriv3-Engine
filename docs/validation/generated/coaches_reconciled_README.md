# coaches_reconciled — Phase 3B reconstructed coaching dataset (NON-PRODUCTION)

One row per legacy `coaches` record (6,347), re-resolved through the repaired resolver +
corrected registry, with explicit status fields. The original `coaches` table is the
untouched baseline (sha256 2a1781d1…, unchanged).

## What is committed here, and what is not

**`coaches_reconciled.csv` is NOT in this repository, deliberately.** It carries the name
and working email address of 6,347 real people; this repository is public. What is
committed instead:

| file | holds |
|---|---|
| `coaches_reconciled_redacted.csv` | every row, keyed by `coach_id`, decision and provenance columns only |
| `coaches_reconciled_manifest.json` | column policy, the source file's SHA-256, and the distribution of every decision column |

Dropped: `coach_name`, `email`, `title`, `source_url` (staff-bio paths spell coach names —
`source_domain` is kept instead). `coach_id` resolves to the person only inside the
database. `evidence` is retained only after being tested against the name and address of
every row in the file; a value that quotes anybody is redacted rather than published.

Regenerate locally (writes to the untracked `server/data/generated/`):

```
node server/scripts/reconcileCoaches.js --db <non-production db>
node server/scripts/redactGeneratedLedgers.js --in server/data/generated
```

`--check` re-derives both files and exits non-zero if the committed copies differ. It needs
the local source, so it is a pre-commit check rather than a CI one; what CI holds is
`server/scripts/redactGeneratedLedgers.test.js`, which asserts that nothing committed under
`docs/validation/generated/` contains an email address at all.

## Provenance

Built by `server/scripts/reconcileCoaches.js` against a non-production reconstruction copy.

**The registry state it was built on is SUPERSEDED.** It was produced after a 188-row
`athletics_domains` repair whose decisions rested on Thriv3's own `coach_seasons` scrape.
Phases 2C/2D and 6C.4 replaced that standard with external verification; see
`athletics_domains_repairs_phase3b_SUPERSEDED.json`, where 183 of the 188 are recorded as
superseded, contradicted or unadjudicated. The two scripts that could execute that fixture
were removed in the PR #49 pre-merge safety closure. **Nothing was ever applied to
production.**

Fields (redacted copy): coach_id, sport, legacy_school, legacy_unitid, canonical_unitid,
canonical_school, source_domain, email_domain, classification (KEEP/REASSIGN/WITHHOLD/REVIEW),
institution_resolution_status (RESOLVED/REVIEW/WITHHOLD), coach_identity_status
(VERIFIED/UNVERIFIED), email_verification_status (verified/inferred/generic/unknown),
outreach_eligibility (YES/NO), ineligible_reason, resolution_method, evidence, reassigned,
canonicalized.

Eligibility is registry-corruption-immune: YES requires institution RESOLVED, a verified
per-person email, and INDEPENDENT coach_seasons corroboration (identity or a
coach_seasons-scraped source domain). Integrity gates G1–G5 pass (0 failures); 0 eligible
coaches at a wrong institution.
