# Separating AI development access from human approval authority (DI-07)

**What this answers:** how Thriv3 can make sure that AI agents, which write most of the code, can never approve a data correction or the code that authorises one, when there is one human maintainer (`rhys-daviies`).

**Status:** design plus a settings checklist. Nothing here has been configured. Every item in §6 needs a person. The code side, what the repository enforces by itself, is listed in §7.

## 1. The situation today (read-only `gh api` checks, 2026-10-10)

| Fact | Evidence |
|---|---|
| The repository is public and user-owned (`rhys-daviies/Thriv3-Engine`). | `GET /repos/...` gives `visibility: public`, `owner.type: User` |
| `main` has no branch protection and no rulesets. | `GET .../branches/main/protection` returns 404; `GET .../rulesets` returns `[]` |
| The only collaborator is `rhys-daviies`, with the role `admin`. | `GET .../collaborators` |
| The token agents use **is** `rhys-daviies`. It is an OAuth token (`gho_`) with the scopes `repo`, `workflow`, `read:org` and `gist`. | `gh api user`; `gh auth status` |
| GitHub Actions can run any action, SHA pinning is not required, the default workflow token is read-only, and Actions may not approve PRs. | `GET .../actions/permissions`, `.../actions/permissions/workflow` |
| The `correction-security` check runs as the GitHub Actions app, id **15368**. | `GET .../commits/b66253a/check-runs` |
| There is one environment, with no protection rules. | `GET .../environments` |

**Consequence:** an agent can do anything the maintainer can do, including:
- pushing to `main`;
- editing the reviewer registry or the pinned attestation roots;
- editing the workflow that is meant to check them;
- creating or deleting rulesets.

The trust root then compares against what the agent pushed, and passes.

## 2. Why the obvious fix does not work, and what does

GitHub never counts a pull request author's own approval: an author cannot approve their own PR. Required reviews, code-owner reviews and "approval of the most recent push by someone other than the pusher" all need **an approving account that is not the author or the last pusher**.

If agents and the human share one account, every PR is authored by the human's identity. So either:
- the rules block every merge; or
- the human configures a bypass, and the bypass is then available to the agents as well.

There is no setting that separates two actors who hold one identity.

**The fix is to give agents their own identity and keep the human identity out of their reach:**

| Identity | Held by | Repository role | Can |
|---|---|---|---|
| `rhys-daviies` (human) | the maintainer only. Hardware-key 2FA. **Never** logged in (`gh`, git credential helper, browser profile, keychain) on any machine or account an agent can drive. | admin (owner) | approve PRs as code owner, edit rulesets, merge |
| `thriv3-agent` (machine account), **or** a GitHub App (see below) | agents | **Write** collaborator (not Maintain, not Admin) | push branches and open PRs; cannot approve its own PRs, edit settings, or push to `main` |

GitHub's terms allow one free machine account per person. A **GitHub App** is the alternative: an installation token scoped to this repository, whose PRs are authored by `thriv3-agent[bot]`. An App can never be a code owner or an approver, which is the property we want. Choose either. The App avoids a second password and 2FA to manage. The machine account works with plain `gh`/git.

**Agent token: exact permissions.** Use a fine-grained PAT owned by `thriv3-agent`, with resource owner `rhys-daviies` and repository access *only* `rhys-daviies/Thriv3-Engine`. If you use an App, give its installation the same permissions.

| Permission | Level | Why |
|---|---|---|
| Metadata | Read | required |
| Contents | Read and write | push feature branches (a ruleset stops pushes to `main`) |
| Pull requests | Read and write | open PRs and comment |
| Actions | Read | read CI results |
| Checks | Read | `gh pr checks` |
| Commit statuses | **Read** (never write) | with write it could post a fake `correction-security` status. The ruleset also pins the check to app 15368. |
| Workflows | **No access** | it cannot push changes to `.github/workflows`, so it cannot rewrite the check it must pass (DI-06 INFO-5) |
| Administration | **No access** | it cannot change rulesets, collaborators, environments or Actions settings |
| Environments, Secrets, Variables, Deployments, Pages, Webhooks | **No access** | |

Set a 90-day expiry. Store the token only on agent hosts.

**Where the hardware key fits:**
- The reviewer's FIDO authenticator holds the only private key that can sign SHARED_DEV or PRODUCTION approvals (touch plus PIN, attested).
- It is plugged in only when the human signs, on a machine where `rhys-daviies` (not the agent) is the user.
- It is never on a host or account agents control. An agent therefore cannot produce an approval signature at all. It can only propose an approval body for the human to sign.
- It **cannot** stop a compromised verifier from accepting a forgery (§5). That is why the identity separation above and the independent verification below are needed as well.

**Human-authored changes:** with one human, a PR the human authors has no second approver. Two ways to handle it:
- have the agent account push the human's commits and open the PR, so the human is a reviewer, not the author or last pusher; or
- add a second human reviewer account later.

Do **not** add a bypass for the human. A bypass on the human account is exactly the hole an agent with stolen human credentials would use.

## 3. Ruleset on `main`: exact settings

Settings → Rules → Rulesets → **New branch ruleset**:

| Setting | Value |
|---|---|
| Name | `main-protection` |
| Enforcement status | **Active** |
| Bypass list | **empty**: no roles, no teams, no apps, no deploy keys. Repository admins are then bound too. |
| Target branches | **Include default branch** (`main`) |
| Restrict creations | off |
| Restrict updates | **off**: with an empty bypass list it would block merges as well. Direct pushes are blocked by "Require a pull request" below. |
| Restrict deletions | **on** |
| Require linear history | optional (on is fine) |
| Require signed commits | optional |
| Require a pull request before merging | **on** |
| → Required approvals | **1** |
| → Dismiss stale pull request approvals when new commits are pushed | **on** |
| → Require review from Code Owners | **on** |
| → Require approval of the most recent reviewable push | **on** |
| → Require conversation resolution before merging | **on** |
| → Allowed merge methods | merge, squash (either) |
| Require status checks to pass | **on** |
| → Require branches to be up to date before merging | **on** |
| → Status checks | `correction-security`, **source: GitHub Actions** (integration id **15368**), so no other app or status can satisfy it |
| Block force pushes | **on** |
| Require code scanning results | off (not configured) |

**The same ruleset as a REST payload.** This is for reference only. A person applies it, for example via `gh api -X POST repos/rhys-daviies/Thriv3-Engine/rulesets --input ruleset.json`.

```json
{
  "name": "main-protection", "target": "branch", "enforcement": "active", "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 1, "dismiss_stale_reviews_on_push": true,
      "require_code_owner_review": true, "require_last_push_approval": true, "required_review_thread_resolution": true } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": true,
      "required_status_checks": [ { "context": "correction-security", "integration_id": 15368 } ] } }
  ]
}
```

**Two more protections:**
- Add a second ruleset, or extend this one, for `refs/heads/release/*` if a release branch ever feeds production. Render reads `render.yaml` from the release branch (see the Render/main reconciliation note).
- Only admins can edit rulesets. That is why the admin identity must be human-only.

## 4. CODEOWNERS

`.github/CODEOWNERS` (updated in this PR) owns:
- `.github/`, CODEOWNERS itself, all of `shared/`, `server/db/` and `server/lib/`;
- the three correction scripts in the closure;
- `package.json`, `package-lock.json` and `vitest.config.js`;
- the two correction docs.

This covers every directory that the trust root's import closure reaches today (66 modules), so the closure cannot grow into an unowned file.

**The owner must be the human account.** With agents moved to `thriv3-agent`, the `@rhys-daviies` entries become meaningful: an agent-authored PR needs `rhys-daviies` to approve it. If a second human reviewer is added, list both.

## 5. Independent verification: the mitigation for same-account code

**The trust root runs inside the process that writes.** Code that already runs as that account can patch the verifier, or skip it and write the SQLite file directly. No in-process check survives that. Two layers address it, in order of cost.

**(a) Detection: `correction-ledger-verify`.** Design only; not built in this PR.
- Every committed correction stores its signed envelope, body hash, target and manifest in `correction_ledger`.
- A GitHub Actions job (`workflow_dispatch`, plus a schedule) on a GitHub-hosted runner checks out **`main`**. It runs `verifyApproval(envelope, { at: committed_at })` for each ledger row of an exported ledger. The export is a JSON file the operator uploads as a workflow input or commits to a `ledger-exports/` path. The job fails on any row whose approval does not verify, or whose signer was not enrolled at that commit.
- This runs on a machine and with code the agents do not control. It turns a silent forgery into a red check within one export cycle.

**(b) Prevention: a GitHub Environment as the approval gate.** Optional, for PRODUCTION.
1. Create the environment `correction-approval`:
   - required reviewers: `rhys-daviies`;
   - **Prevent self-review** on;
   - deployment branches: `main` only;
   - no secrets.
2. A `workflow_dispatch` workflow bound to that environment takes an approval envelope and target identity. It waits for the human's approval in the GitHub UI, which uses the human's 2FA, not the agent's token. It then verifies the envelope with `main`'s code and emits a build-provenance attestation (`actions/attest`, Sigstore-signed with GitHub's OIDC identity), with this subject: `sha256(body_hash || target.identity || trusted_commit)`.
3. The production correction path then additionally requires that attestation, verified offline against the pinned Sigstore root, workflow path and `main` ref.
4. A patched local verifier still cannot mint one.

What remains after (b): a process that skips the whole engine and writes the database file directly. Only host separation addresses that: run PRODUCTION corrections inside the production service, on infrastructure agents cannot reach.

## 6. Settings that require HUMAN action (none of these can be done by code or agents)

**Identity:**
1. [ ] Create the machine account `thriv3-agent` (with its own email, and 2FA held by the human), **or** create a GitHub App `thriv3-agent` and install it on this repository only.
2. [ ] Invite `thriv3-agent` as a **Write** collaborator (machine-account route).
3. [ ] Create the fine-grained PAT (or App permissions) exactly as in §2's table: no Workflows, no Administration, Commit statuses read-only, 90-day expiry.
4. [ ] On every machine and account agents use, run `gh auth logout -u rhys-daviies` and remove `rhys-daviies` credentials from the git credential helper and the keychain. Then `gh auth login` with the agent token. Confirm with `gh api user` → `thriv3-agent`.
5. [ ] Revoke the existing `gho_` OAuth token used by agents: Settings → Applications → Authorized OAuth Apps → GitHub CLI → Revoke, or `gh auth refresh` on the human machine.
6. [ ] Make sure `rhys-daviies` has hardware-key 2FA, and remove SMS fallback where possible.

**Repository settings:**

7. [ ] Create the ruleset `main-protection` exactly as in §3. The bypass list must be empty.
8. [ ] Actions → General → enable **Require actions to be pinned to a full-length commit SHA** (`sha_pinning_required`, currently false). Keep "Allow GitHub Actions to create and approve pull requests" **off** (currently off).
9. [ ] Actions → General → Fork pull request workflows: require approval for all outside collaborators (the repository is public).
10. [ ] Confirm CODEOWNERS lists only human accounts. Add a second human reviewer when one exists.

**Optional, for PRODUCTION:**

11. [ ] Create the environment `correction-approval` (§5b): required reviewer `rhys-daviies`, Prevent self-review, branch `main` only.
12. [ ] Approve building the §5 `correction-ledger-verify` job and the environment-gated verifier as follow-up work.

**Trust anchors (unchanged from DI-04):**

13. [ ] Pin a vendor FIDO root in `shared/fidoAttestationRoots.json`, after verifying its fingerprint out of band, in a PR approved under the ruleset. This comes only **after** items 1–7.
14. [ ] Enrol the reviewer's attested key (`-O verify-required -O application=ssh:thriv3-reviewer`) after `correctionApproval.js enrolment` prints `ENROLLABLE` on the real device.

## 7. What the code enforces by itself (no settings needed)

- Approvals are signatures, not names. One raw key is one person, and PRODUCTION needs two distinct keys.
- SHARED_DEV and PRODUCTION approvals need an attested hardware key, signing with touch and PIN. There is none until a root is pinned and a key enrolled, so the system fails closed today.
- Degenerate keys and signatures are refused. Malformed attestations are refused without a crash. Attestation chains are strictly validated.
- **Trust root:**
  - the correction code (its whole import closure), its data, `package.json`, `package-lock.json` and the loaded package versions must equal `main` as fetched now, by URL, in a hermetic git process;
  - it is enforced when a grant is issued, re-checked by every writer, and applied to hold-release proofs;
  - preloaded or inspected processes are refused.
- The CI job `correction-security` fails rather than skips if openssl is missing, and its actions are pinned to commit SHAs.

**What the code cannot do:** decide who is allowed to change `main`. Only §6 does that.
