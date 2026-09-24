# Phase 3C — Production Migration Procedure (DO NOT EXECUTE YET)

Applies the Phase-3B reconstruction to production `/data/recruitmatch.sqlite` on
Render. Every write is transactional; every step has an abort/rollback. Nothing
here runs until this plan is reviewed and explicitly approved.

## Preconditions / assumptions to re-verify against production
- Local reconstruction was built from a snapshot at git `af9a21d` (Phase 3A) →
  Phase 3B commit. Baseline `coaches` sha256 `2a1781d148e94f60a93b9ffd…`, 6347 rows.
- Reconstruction is provably safe: integrity gates G1–G5 = 0; canonical
  round-trip 0 cross-institution; 0 eligible coaches at a wrong institution.

## Procedure
1. **Confirm production version.** `git rev-parse HEAD` on the deployed release;
   confirm it contains this branch's resolver + scripts (or plan a deploy of the
   code first, separate from data).
2. **Inspect `/data/recruitmatch.sqlite`** (read-only): row counts for coaches,
   coach_seasons, colleges, athletics_domains, institution_aliases.
3. **Compare production vs local assumptions.** counts + a coaches sha256 over
   `(id,full_name,email,school,sport)`. Record deltas. Collaborators have been
   writing the local DB, so production is expected to differ — quantify it.
4. **Off-volume backup.** Copy `/data/recruitmatch.sqlite` (+ `-wal`,`-shm`) to
   off-volume storage; also `VACUUM INTO` a consistent single-file snapshot.
5. **Verify backup.** Open the backup read-only; confirm counts/hash match the
   source; keep the path for rollback.
6. **Read-only audit against production.** Run `validateInstitutionIntegrity`
   and a production copy of `reconcileCoaches` (writing coaches_reconciled to a
   THROWAWAY copy, never production) to regenerate the ledger from live data.
7. **ABORT GATE — material drift.** If production coaches/domains differ enough
   that the reconstruction's decisions no longer hold (e.g. new schools, changed
   source URLs), STOP: rebuild the reconstruction from the production snapshot
   and re-review before proceeding. Do not apply a stale reconstruction.
8. **Apply registry repair** — `repairAthleticsDomains.js --db /data/... --apply`
   inside a transaction (188 evidence-backed corrections/recoveries). Idempotent.
9. **Apply coach reconciliation** — write `coaches_reconciled` on production
   (a NEW table; `coaches` stays as the rollback baseline). Do NOT drop/replace
   `coaches` in this step.
10. **Apply outreach-eligibility gate** — the read path (`programmeCoaches`)
    switches to serving only rows where `coaches_reconciled.outreach_eligibility='YES'`
    (code change, feature-flagged), OR outreach filters on it. `coaches` remains
    for provenance/rollback.
11. **Run `validate:institution-integrity`** against production — must exit 0.
12. **Run `validateReconciledCoaches`** against production — gates G1–G5 must be 0.
13. **Smoke-test API/UI** — `/colleges/:id/coaches` for a sample; confirm shape.
14. **Verify Texas** — women's soccer shows only UT staff; Concordia coaches
    are under Concordia University-Texas (or withheld), none eligible under Texas.
15. **Verify Saint Mary's** — CA shows no MD/TX/MN coaches as eligible.
16. **Verify representative unaffected schools** (Clemson/Stanford/etc.) — coach
    counts unchanged and still eligible (no over-suppression regression).
17. **Only then restore/allow outreach.** Un-pause sending.
18. **Rollback** — if any gate/step fails: restore the off-volume backup (stop
    service, swap file, restart) OR, since `coaches` is untouched, revert the
    read path to `coaches` and drop `coaches_reconciled`. All data writes were
    additive + transactional, so rollback is a file restore or a flag flip.

## Notes / carve-outs
- **NAIA outreach stays withheld** until `coach_seasons` (or an equivalent
  independent per-school source) is extended to NAIA — the corroboration signal
  that keeps eligibility registry-corruption-immune does not yet cover NAIA.
- **REVIEW (202) and uncorroborated REASSIGN/KEEP (690)** remain not-eligible;
  they are a human-review queue, not a blocker for shipping the eligible set.
- Further `athletics_domains` errors were identified beyond the 188 applied
  (e.g. all "Columbia" domains → 190150; various email-domain mis-maps). These
  are quarantined by the eligibility gate (coach_seasons corroboration) and
  should be corrected registry-side in a follow-up, with the same evidence bar.
