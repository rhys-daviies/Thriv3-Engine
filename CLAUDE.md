# Thriv3 Engine — development operating policy

This file loads into every session, so it stays short. Detail lives in the
files it points to. It adds a way of working; it relaxes none of the data,
send or security rules below.

## 1. MVP priority

**Current priority: the operator-run pilot for NCAA D1–D3 men's and women's
soccer.** Work that moves that pilot toward go-live comes first.

This is a development priority, not a product limit. The NAIA, NJCAA, USCAA
and multi-sport infrastructure stays: never delete, narrow or "simplify away"
code, data or tests for those just because they are outside the pilot. Work on
them is fine when it is approved or needed to keep shared paths correct.

`ROADMAP.md` is the canonical go-live tracker and is large. Grep for the
section you need instead of reading it whole. Tick it when work lands.

## 2. Outcome-driven features

Every feature starts with an outcome brief (`/feature`): the operator or
athlete outcome, a success check someone can run, acceptance tests, the risk
tier (§3) and why it serves the pilot. No brief, no code. **Done means the
success check passes**, not that code exists.

## 3. Risk tiers and approval gates

| Tier | Covers | Gate |
|---|---|---|
| **T0** | Reading, analysis, docs, tests, tooling, local branches and commits | None |
| **T1** | App, UI and server changes with tests. Includes **routine matching UI, wording and explanation changes** that do not change a decision | Workstream approved once. Then push branches, open PRs and update them without asking again |
| **T2** | **Eligibility**, **scoring or matching weights**, anything that changes **which programmes an athlete is matched to or who gets contacted**, send/outreach paths, schema/migrations, auth/credentials/PII, the integrity and refresh pipeline | Plan approved before code. `integrity-auditor` or `reviewer` (Opus) runs before the PR. Matching changes carry a `npm run backtest` comparison |
| **T3** | Merging any PR · production deploys (Render, wrangler, `npm run publish`, `edge:schema`) · **any write to the live or shared database** (`integrity:promote`, `integrity:freeze`, `integrity:protected-correct`, migrations against `server/data`) · **sending real email** · **coach activation** · **releasing holds** · secrets · consequential GitHub configuration (branch protection, Actions secrets, repo settings) | Explicit yes from the user **for that specific action**, every time. Approval never carries over |

If a change spans tiers, the highest tier applies. If you are unsure, treat it
as the higher tier and say why.

## 4. Data integrity and security rules (non-negotiable)

- `integrity:promote` is the only canonical writer. Legacy importers refuse on
  the managed DB, and that refusal stays.
- No test may open `server/data/recruitmatch.sqlite` (`server/testDbGuard.js`).
  Measurement runs on a copy. If the working tree is dirty, measure from a
  `git archive` of the commit.
- Validate against literal sources (the page or registry), never against the
  conversion being tested.
- Guards belong in code and queries, not in remembered cautions. A rule that
  matters gets a test.
- The send floor, suppressions, holds and activation gates are never weakened
  to make a test or a feature pass.
- The repo is **public**. No PII, credentials or live data in commits
  (`npm run scan:committed-pii`).

## 5. Model routing

The main session runs **Opus 5.5** (`claude-opus-5-5`), which the user picks in
the model menu. A session cannot change its own model. **Ask the user before
proposing a main-session model change.**

| Model | ID | Used for |
|---|---|---|
| Haiku 5.5 | `claude-haiku-5-5` | `scout` (search), `test-runner` (run and summarise tests) |
| Sonnet 5.5 | `claude-sonnet-5-5` | `implementer` and any subagent without a `model` (the `CLAUDE_CODE_SUBAGENT_MODEL` default) |
| Opus 5.5 | `claude-opus-5-5` | Main session, `reviewer`, `integrity-auditor` |
| Fable 5.1 | `claude-fable-5-1` | `architect` only: genuinely hard architecture or reasoning |

**Fable escalation.** Recommend it when it is warranted: a design with
several interacting constraints, a decision about eligibility or matching
theory, or a root cause still open after a serious Opus attempt. Never use it
for routine implementation. **Ask before running unusually expensive Fable
work**, such as more than one `architect` run on a problem, or Fable reading
large parts of the codebase.

## 6. Token and credit efficiency

- Delegate broad searches to `scout` and test runs to `test-runner`. Only
  their conclusions come back into the main context.
- While iterating, run targeted `npx vitest run <file>`. Run the full suite
  once, at `/ship-check`.
- Grep `ROADMAP.md`, `docs/` and large files; do not read them whole. Do not
  re-read a file you just edited.
- Effort: **medium** by default, **high** for T2 work, **max** only when asked.
- Keep reports short: results, evidence and the decisions needed. Don't
  narrate.

## 7. Testing and CI

- Every behaviour change ships with a test. A bug fix ships with the test that
  would have caught it.
- CI (`.github/workflows/ci.yml`) runs on every PR. The gate is
  `tools/ci/testGate.mjs`, configured by `tools/ci/test-baseline.json`:
  - **Critical safety suites** (listed in that file) must load, run and pass.
    They can never appear in the baseline.
  - A suite that fails to load or fails in `beforeAll` fails CI. Vitest shows
    those as skipped tests, so the gate counts them separately.
  - A **skipped** test fails CI unless it is listed as an expected clean-checkout
    skip (because the private DB is absent).
  - Known failures are listed by exact name, each with an owner and an
    **expiry date**. An expired entry fails CI, and so does an entry whose test
    now passes. The list can only shrink. A new failure is never
    "pre-existing".
  - Tests must leave the checkout unchanged. CI fails on any new file,
    including ignored ones.
- Suites that need the private DB skip in CI and in worktrees. Gate them with
  `describeWithCorpus(...)` from `server/testCorpus.js`, never
  `cond ? describe : describe.skip`. `describe.skip` still runs its body
  during collection. **A skip is not a pass.** Run those suites locally in the
  `app` checkout before claiming data behaviour is verified.

## 8. Parallel workstreams

- Up to **three** at once. Each gets its own worktree, branch and PR, and they
  must not edit the same files.
- Only the `app` checkout owns the live database. At most one workstream does
  database-touching work at a time, and its writes are still T3.
- `implementer` runs in an isolated worktree. Review its diff before it goes
  into a PR.

## 9. Delivering work

Branch from `main` (never commit to `main`) → implement → `/ship-check` → PR.
The PR body states the risk tier, the outcome and how it was verified, and
names anything that was skipped. Never merge or deploy without the T3 yes.
