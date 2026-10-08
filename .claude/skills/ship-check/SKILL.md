---
name: ship-check
description: Pre-PR verification for a Thriv3 branch — targeted tests, full suite through the CI gate, build, PII scan, review — then opens or updates the PR with an honest body. Use when a change is ready to ship.
---

# /ship-check — verify, then open or update the PR

Run in order. Stop on the first real failure and fix it. Never skip a step
silently: if a step can't run, say so in the report and the PR body.

1. **Scope:** `git diff main...HEAD --stat`. Confirm the diff matches the
   outcome brief and contains no `server/data/`, secrets or PII.
2. **Tier check:** re-classify the diff against `CLAUDE.md` §3. If it is now T2
   and has no approved plan, stop and ask.
3. **Tests through the gate:** use `test-runner` to run the full suite with the
   JSON reporter and `node tools/ci/testGate.mjs <json>`. Any new failure,
   suite-level failure or unexpected skip blocks the PR. Never add to
   `tools/ci/test-baseline.json` `knownFailures` to get past it; that needs
   the user's explicit approval and an expiry date.
4. **Data-dependent suites:** if the change affects data behaviour, run the
   affected suites in the `app` checkout too, where the private DB exists.
   CI skips them. Say which ran.
5. **Build and scans:** `npm run build`, then `npm run scan:committed-pii`.
6. **Review:** for T2, or a T1 change touching shared paths, run `reviewer`
   (and `integrity-auditor` for data). Fix confirmed findings.
7. **PR:** push the branch and open or update the PR against `main`. The body
   gives: risk tier, outcome, success-check evidence, test-gate summary, what
   was skipped and why, and any T3 actions the user still has to approve.
   Never merge.
