# Coaching-contact integrity ledger — Phase 2 (READ-ONLY audit output)

`coach_contact_ledger.csv` — one row per `coaches` record (6,347), classifying each as
KEEP / REASSIGN / WITHHOLD / REVIEW against UNITID/domain evidence, with `coach_seasons`
used as a corroboration guard.

Generated 2026-09-25 by a read-only analysis over an **immutable snapshot** of a local
(non-production) copy of `server/data/recruitmatch.sqlite`. **No production data, code, or
config was modified.** This is analysis output only — nothing here has been applied.

Columns: coach_id, coach_name, email, title, sport, current_school, current_school_unitid,
source_url, source_domain, email_domain, resolved_unitid, resolved_school, resolution_method,
resolution_confidence, classification, reason, email_status, state, division,
coach_seasons_at_current, coach_seasons_at_resolved, evidence.

Classification summary (all sports): KEEP 4,920 (77.5%) · REASSIGN 149 (2.3%) ·
WITHHOLD 877 (13.8%) · REVIEW 401 (6.3%).

Caveats: `athletics_domains` has confirmed errors (e.g. redstormsports.com→Fisher,
stmarytx.edu→CA) and gaps (INSUFFICIENT_EVIDENCE) that inflate WITHHOLD and can misdirect
REASSIGN; only the 30 REASSIGN rows corroborated by `coach_seasons` at the target are
safe to auto-apply. See the Phase-2 report for full method and limitations.
