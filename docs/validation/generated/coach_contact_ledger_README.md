# Coaching-contact integrity ledger — Phase 2 (READ-ONLY audit output)

One row per `coaches` record (6,347), classifying each as KEEP / REASSIGN / WITHHOLD /
REVIEW against UNITID/domain evidence, with `coach_seasons` used as a corroboration guard.

Generated 2026-09-25 by a read-only analysis over an **immutable snapshot** of a local
(non-production) copy of `server/data/recruitmatch.sqlite`. **No production data, code, or
config was modified.** This is analysis output only — nothing here has been applied.

## What is committed here, and what is not

**`coach_contact_ledger.csv` is NOT in this repository, deliberately** — same reason as
`coaches_reconciled`: 6,347 real names and working addresses, in a public repository.
Committed instead: `coach_contact_ledger_redacted.csv` (every row, keyed by `coach_id`)
and `coach_contact_ledger_manifest.json` (column policy, source SHA-256, distributions).
Dropped: `coach_name`, `email`, `title`, `source_url`, and the unused `evidence` free text.
See `server/scripts/redactGeneratedLedgers.js` for the policy and how to regenerate.

Columns (redacted copy): coach_id, sport, current_school, current_school_unitid,
source_domain, email_domain, resolved_unitid, resolved_school, resolution_method,
resolution_confidence, classification, reason, email_status, state, division,
coach_seasons_at_current, coach_seasons_at_resolved.

Classification summary (all sports): KEEP 4,920 (77.5%) · REASSIGN 149 (2.3%) ·
WITHHOLD 877 (13.8%) · REVIEW 401 (6.3%).

Caveats: `athletics_domains` has confirmed errors (e.g. redstormsports.com→Fisher,
stmarytx.edu→CA) and gaps (INSUFFICIENT_EVIDENCE) that inflate WITHHOLD and can misdirect
REASSIGN; only the 30 REASSIGN rows corroborated by `coach_seasons` at the target are safe
to auto-apply. See the Phase-2 report for full method and limitations.

**`stmarytx.edu` is still uncorrected** and is recorded as an open, unadjudicated
domain-ownership question in `athletics_domains_repairs_phase3b_SUPERSEDED.json`. It was
never externally verified in Phase 2C/2D or 6C.4, so it has not been repaired here.
