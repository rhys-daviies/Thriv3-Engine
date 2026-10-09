# Correction reviewer security (DI-04)

This guide covers who may authorise a correction to the shared-development or production database, and how that authority is protected.

It also separates two kinds of protection:

- **In code:** what the code enforces now.
- **Manual configuration:** what a person must configure on GitHub. Until they do, nothing enforces it.

## 1. What the code enforces

| Control | Where | Effect |
|---|---|---|
| Signed approvals | `approvalValidator.js`, `sshSignature.js` | An approval is a set of OpenSSH signatures over the canonical approval body. A typed reviewer name proves nothing. |
| One key is one person | `loadReviewers` | Keys are compared by the raw Ed25519 public key, in any encoding. The same key under two reviewer ids refuses the whole registry. Two signatures by one key count once. Production needs two distinct keys. |
| Hardware keys for runtime scopes | `loadReviewers`, `fidoAttestation.js` | A reviewer may hold SHARED_DEV or PRODUCTION scope only if every key they hold is an `sk-ssh-ed25519` key with a FIDO attestation. That attestation must be issued by a vendor root pinned in `shared/fidoAttestationRoots.json` and must certify exactly that key. Otherwise the reviewer keeps DISPOSABLE scope only. |
| Touch and PIN on every runtime approval | `verifySshSignature(requireHardware)` | Approval signatures for SHARED_DEV or PRODUCTION must carry both the user-presence flag (touch) and the user-verification flag (PIN or biometric). |
| Rehearsal key denied | `REHEARSAL_KEY_LINE` | The public-seed rehearsal key in any runtime scope refuses the registry. |
| Trust root | `trustRoot.js` | Before a SHARED_DEV or PRODUCTION correction or revert runs, every protected file must equal `main` as freshly fetched from `github.com/rhys-daviies/Thriv3-Engine`. Each of these refuses: local edits, unpushed commits, a forged local `origin/main`, a repointed remote, and an unreachable GitHub. |
| Existing protections | DI-03 | Approval binding (to the database, fixtures, evidence, holds and sendability), activation holds, the ledger, database identity, governed revert and single use are all unchanged. |

**What ships:**
- no reviewer key is enrolled for a runtime scope;
- no attestation root is pinned;
- no hold release is shipped.

So **no SHARED_DEV or PRODUCTION correction can be approved** until the steps below are completed.

## 2. What a person must configure on GitHub (code cannot do this)

Settings → Branches → add a rule for `main`, or a ruleset targeting the default branch:

1. **Require a pull request before merging**, with at least **1 approving review**.
2. **Require review from Code Owners** (`.github/CODEOWNERS`).
3. **Dismiss stale approvals** when new commits are pushed.
4. **Require approval of the most recent push by someone other than the pusher.** This is what stops an author, or an agent using the author's token, from approving their own change.
5. **Require status checks to pass:** `correction-security` (`.github/workflows/correction-security.yml`). Require branches to be up to date.
6. **Do not allow bypassing the above settings**, including for administrators. Give no bypass to apps or automation.
7. Block **force pushes** and **deletions** of `main`.
8. Restrict who can push to `main`. Agents should use tokens that cannot merge or administer the repository.

**Why this matters:** the trust root makes "the file on GitHub `main`" the authority, and only these settings make that authority mean "a human reviewed it". Until they are set, the trust root defends against local and working-copy tampering, but not against a direct push to `main`.

**A practical limit:** "someone other than the pusher" needs a second human with write access. With only one maintainer, the strongest available setting is code-owner review plus required checks plus no bypass. The hardware key (section 3) is then the control that a compromised account or agent cannot defeat.

## 3. Enrolling a reviewer key (when authorised)

On the reviewer's own machine, with the authenticator plugged in:

1. Create a random enrolment challenge:

   ```bash
   head -c 32 /dev/urandom > enrol-challenge.bin
   ```

2. Create the key. It requires touch and PIN on every signature, and writes the authenticator's attestation:

   ```bash
   ssh-keygen -t ed25519-sk -O verify-required -O application=ssh:thriv3-reviewer -O challenge=enrol-challenge.bin -O write-attestation=enrol-attestation.bin -f ~/.ssh/thriv3_reviewer_sk
   ```

3. Check the key against the pinned roots. This must print `ENROLLABLE`:

   ```bash
   node server/scripts/correctionApproval.js enrolment ~/.ssh/thriv3_reviewer_sk.pub enrol-attestation.bin enrol-challenge.bin
   ```

4. Open a PR that adds the printed entry to `shared/correctionReviewers.json`, with the attested key, under the reviewer and the scopes they should hold. It is reviewed under the branch-protection rules above.

**Pinning a vendor root comes first,** and is itself a reviewed PR to `shared/fidoAttestationRoots.json`:
- download the vendor's FIDO attestation root from the vendor's own site;
- compare its SHA-256 fingerprint against the value the vendor publishes, through a second channel;
- record who verified it and when.

**Never let an agent fetch or pin a trust root.**

**The first enrolment must also be validated against the real device.** `fidoAttestation.js` has only been exercised against synthetic attestations. If `enrolment` reports a format mismatch with a real authenticator, stop and fix the verifier before enrolling.

## 4. Signing an approval

```bash
node server/scripts/correctionApproval.js body approval.json > body.txt
```

```bash
ssh-keygen -Y sign -n thriv3-correction-approval@v1 -f ~/.ssh/thriv3_reviewer_sk body.txt
```

The second command needs a touch and a PIN.

```bash
node server/scripts/correctionApproval.js attach approval.json <reviewer_id> body.txt.sig
```

```bash
node server/scripts/correctionApproval.js trust-check
```

`trust-check` must print `TRUSTED` before any SHARED_DEV or PRODUCTION run.

## 5. Residual risks

- **Same-account code.** Anything running as the reviewer's own account can rewrite the code that performs these checks. The protection that survives this is the hardware key: no file edit can produce a touch-and-PIN signature from an attested authenticator. Keep the authenticator unplugged when not signing.
- **Replay after a restore.** Single use is recorded per database. A database restored to a pre-correction backup accepts the same approval again within its validity window (at most 14 days). Keep approvals short-lived and record restores.
- **The pinned roots are the trust anchor for hardware.** A wrongly pinned root (for example an attacker's CA) would admit software keys, which is why pinning is a reviewed, out-of-band-verified change.
