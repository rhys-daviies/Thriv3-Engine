# Matchmaking V2 — merge to main

The record of the merge itself. It does not restate A7–A9.7B and does not
supersede them; each phase report under `docs/validation/` stands as written.

| | |
|---|---|
| merged | 2026-10-04 09:03 NZDT (`2026-10-03T20:03:57Z`) |
| feature branch | `feature/matchmaking-v2` |
| feature HEAD | `51bf08da59231de59bd5fc9d2fca63b3a1237a85` |
| accepted verdict | `A9_7B_MERGE_READY` (A9.7B) |
| pre-merge main | `225ca29854caac7d3df17a92213e0bbe5ee559a8` |
| merge commit | `7004f3e16e448a6dca0e422abd7cd9a9b20e46b7` |
| method | `--no-ff`, 178 commits preserved |
| conflicts | none — possible only because `main` was a strict ancestor |

## The validated branch was not changed by the merge

`main` was an ancestor of the feature HEAD, so the merge had nothing to
reconcile. Verified rather than assumed: the merge commit's tree is
`79479c71ecfc7a2fdf4dbe8f314110401a1310b2`, **the same tree object** as
`51bf08d`, and `git diff 7004f3e 51bf08d` is empty.

`--no-ff` was chosen over a fast-forward so the merge is an explicit, revertable
point in main's history. It was not squashed: collapsing 178 validated commits
would discard the evidence each phase was accepted on.

## Identity

Unchanged before and after the merge, and unchanged by the migration:

| | |
|---|---|
| SUPPORTED corpus | `adf924962496cfa1fad1eefd97333edc09994c210d8c072e9e14d3d90e2d240c` (2,146 · 62,159 · 88,682) |
| UNSUPPORTED corpus | `9817fdaf70dd855cfe525041c6a8566cc7f9f9d2c7c0fb1b06af593c52bdeca7` (481 · 4,868 · 77) |
| A8.3 acceptance artifact | `579c3b8a9b039029cbde002bf89340198055c22758534ed8150aafffdeea47c3` (26,053 cells) |
| freeze guard | **11/11**, before and after |

Against the A9.0 freeze engine HEAD `449dd0c`, `shared/matching/` differs by
three **added** files and nothing else: `v2/freeze.js`, `v2/freeze.test.js` and
`v2/importGraph.test.js` — the freeze record and its two guards, 254
insertions, 0 deletions. No scoring file was modified.

No telemetry table is an engine input. `shared/matching/` contains no reference
to `recruiting_observations`, `matchmaking_selections`, `outreach_sends` or
`tracking_events`, and imports none of the telemetry modules.

## Tests

Full suite, pre-merge and post-merge: **10,618 passing · 3 failing · 198
skipped** — the same totals, the same three failures recorded since A9.5, and
**0 new**:

- `campaignSnapshot` — "permits several drafts from the same analysis" ×1
- `rosterTargetUniverse` ×2

Bounded V2 gate set post-merge — freeze guard, import boundary, every
`shared/matching/v2/` and `server/lib/v2/` suite, corpus identity, the
observations route, the version switch and the V2 hook: **79 files, 1,550
passing, 0 failing.**

`scan:committed-pii`: 1,659 tracked files, none found. `snapshot:pi --check`:
0 differences. `snapshot:matching --check`: the known 370-field V1 corpus
drift, **byte-identical before and after the merge** — it is corpus growth
against a pinned V1 baseline, not a V2 effect.

### Two post-merge artifacts, both environmental

The post-merge suite was run three times. The third run reproduced the
pre-merge baseline exactly and is the figure quoted above. The first two each
showed one extra deviation, recorded here so a later reader does not mistake
either for a regression. Neither is a code defect and neither is in the merged
tree, which is the same tree object as the validated feature HEAD:

1. `server/scripts/operations.test.js` failed at file level in a brand-new
   worktree that had no `server/data/recruitmatch.sqlite` at all. Its own guard
   prints SKIPPED, but a helper still opens the file. With the file present it
   skips its 16 tests cleanly, as everywhere else.
2. `shared/matching/v2/importGraph.test.js` failed in one run of three with `ENOENT` on
   `shared/evidence/kinds.__mutation-18274-3.js` — a temporary file written and
   deleted by `shared/evidence/outreachPermission.test.js` running in parallel.
   A directory-scan/read race in the test harness. Re-run alone: 6/6 passing,
   and no such file persists on disk.

## Migration

Verified against a WAL-consistent `VACUUM INTO` copy of the live development
database. **The live database was not mutated.**

| | |
|---|---|
| tables | 53 → 55 |
| added | `corpus_revision` (1 row, the counter), `recruiting_observations` (0 rows) |
| removed | none |
| existing tables with changed row counts | **0** |
| `integrity_check` | ok |
| `foreign_key_check` | 0 violations |
| repeat migration | succeeds, no further change |
| corpus identity after migration | unchanged (both digests above) |

V1 pointers intact: 4 players, 3 carrying a `recommendations` path. 96
`outreach` rows intact. `matchmaking_runs` and `matchmaking_selections` exist
and are empty, which is correct — V2 has never run against production data.

## V1 rollback

V1 is not deleted and is not behind a build. `src/lib/matchmakingVersion.js`:

```
?matching=v1              →  V1   (per request, immediate, not sticky)
VITE_MATCHMAKING_ENGINE   →  used only when no query parameter is present
(neither)                 →  V2   (the default)
```

A query parameter overrides a build pinned the other way **in both
directions**, and an unrecognised value falls through to V2 rather than
rendering nothing. The switch lives in `MatchingTabSwitch.jsx`, one level
above `MatchingTab`, so the V1 component and its suites are byte-identical to
what they were before A9.3.

Server side, V1 campaign creation is a different handler:
`POST /players/:playerId/campaigns` (V1) and
`POST /players/:playerId/campaigns/from-matchmaking` (V2), and the V1 one does
not reference the V2 service.

## What merging does NOT do

Merging makes the infrastructure available. It starts no rollout. No athlete
was regenerated, no historical recommendation replaced, no campaign created,
no email sent, no provenance backfilled, no historical reply classified and no
player record changed.

## Known limitations carried into main

- The campaign → contact-attempt → programme-message → execution-claim
  pipeline **has never run**: 0 campaigns, 0 operator_users, 0
  connected_mailboxes. A9.7 wired both paths; the automated one is still
  unexercised against production data.
- `migrate()` rewrites 28 `colleges` rows on every boot regardless of need,
  costing one corpus-cache invalidation per process start. Pre-existing,
  harmless (the cache is empty at that point), made visible by A9.7B.
- The 370-field `snapshot:matching` drift is a stale V1 baseline against a
  grown corpus. Pre-existing and unrelated to V2.
- The three known test failures above.

## Next step

**Controlled real-athlete rollout** — not started here, and deliberately not
begun in the merge task. Deployment is a separate decision: Render's Blueprint
still reads `render.yaml` from `release/internal-operator-hosting`, so pushing
`main` does not deploy anything.
