# Correction reviewer security (DI-04, hardened DI-07)

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
| Trust root | `trustRoot.js`, `importClosure.js` | Before a SHARED_DEV or PRODUCTION approval is granted, and again before every write, the correction code and data must equal `main` as freshly fetched from `https://github.com/rhys-daviies/Thriv3-Engine.git`. What is compared: the registries and data files in `PROTECTED_FILES`; the whole static import closure of the correction entry points (66 modules today, computed at check time, so a new import is covered automatically); `package.json` and `package-lock.json`. The npm packages the closure loads must be installed at the lock's versions, with no shadowing `node_modules` nearer the code. A process started with preloaded code (`--import`, `--require`, `--loader`) or an inspector is refused. Each of these refuses: local edits, unpushed commits, a forged local `origin/main`, a repointed remote, `url.insteadOf`, `git replace`, forged or alternate object stores, `GIT_*` environment variables, hooks and fsmonitor (DI-06 MINOR-1), and an unreachable GitHub. |
| Fetch hygiene | `trustRoot.fetchTrustedTree` | `main` is fetched by explicit URL into a brand-new temporary bare repository. The fetch uses a git binary from a fixed system path and an environment built from nothing: `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_NO_REPLACE_OBJECTS=1` plus `--no-replace-objects`, `GIT_TERMINAL_PROMPT=0`, and no proxy or TLS variables. Local files are hashed as git blobs in-process and compared with the fetched tree. The checkout's `.git` is never read. |
| Trust root at grant issuance | `verifyApproval`, `grantProblems` | `verifyApproval` issues no SHARED_DEV or PRODUCTION grant unless the trust root passes, and the grant records the trusted commit. Every writer that accepts a grant re-checks the working copy against that commit immediately before writing: `applyDomainOwnershipInTransaction`, `recordLedger`, and the composite run and revert. Hold-release proofs re-verify stored approvals under the trust root too (DI-06 MINOR-3). |
| Degenerate keys and signatures | `sshSignature.js` | Ed25519 public keys are refused if their encoding is non-canonical (`y >= p`, or `x = 0` with the sign bit set), if they are not on the curve, or if they are any of the 8 small-order points. This applies at registry load and at verification. Signatures are refused if `S >= L` or if R is a small-order or non-canonical point (DI-06 MINOR-4). |
| Bounded attestation parsing | `fidoAttestation.js` | Attestations are capped at 16 KiB. No CBOR length may exceed the bytes remaining. Nesting and item counts are bounded. Indefinite lengths, tags, floats and duplicate map keys are refused, and the attestation, its CBOR authData and the authData itself must be consumed exactly. A malformed attestation is a problem string, never a crash (DI-06 MINOR-5). |
| Attestation chains | `fidoAttestation.chainProblems` | The attestation certificate may chain through at most 3 intermediates, supplied in the key's `attestation_chain` (PEM, nearest the leaf first), to a pinned anchor. Every link is verified: signature, issuer and subject names, CA:TRUE, pathLen and keyCertSign on every CA, the leaf not a CA, and no repeats. Every certificate, the pinned anchor included, must be in date (DI-06 MINOR-6). |
| Attestation semantics | `fidoAttestation.js` | The key's application must be `ssh:thriv3-reviewer`, and the attestation's authenticator data must carry the user-present and user-verified flags (DI-06 INFO-1). |
| Existing protections | DI-03 | Approval binding (to the database, fixtures, evidence, holds and sendability), activation holds, the ledger, database identity, governed revert and single use are all unchanged. |

**What ships:**
- no reviewer key is enrolled for a runtime scope;
- no attestation root is pinned;
- no hold release is shipped.

So **no SHARED_DEV or PRODUCTION correction can be approved** until the steps below are completed.

## 2. What a person must configure on GitHub (code cannot do this)

The trust root makes "the file on GitHub `main`" the authority. Only GitHub configuration makes that authority mean "a human reviewed it". Until it is set, the trust root defends against local and working-copy tampering, but not against a direct push to `main`.

**The configuration in the DI-04 version of this section cannot be achieved with one account (DI-06 MAJOR-1).** GitHub never lets a pull request's author satisfy a required review or a code-owner review with their own approval. Today agents author pull requests as `rhys-daviies`, the sole maintainer and code owner, using an admin-scoped token. So "require code-owner review" plus "no bypass" would block every merge. The old fallback, "code-owner review plus required checks", could never be satisfied. And "approval of the most recent push by someone other than the pusher" needs a second identity.

The design that works is in **`docs/CORRECTION_GOVERNANCE_SEPARATION.md`**:
- agents move to their own machine account (or a GitHub App) with no admin, no bypass and no workflow-write permission;
- `rhys-daviies` becomes a human-only identity, never logged in where agents run;
- a ruleset on `main` with an empty bypass list requires a pull request, code-owner review, approval of the last push, and the `correction-security` check from GitHub Actions (integration id 15368).

That document also holds the exact checklist of settings a person must change.

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
   node server/scripts/correctionApproval.js enrolment ~/.ssh/thriv3_reviewer_sk.pub enrol-attestation.bin enrol-challenge.bin [--chain vendor-intermediates.pem]
   ```

   If the vendor issues attestation certificates through intermediate CAs, pass them with `--chain`: a PEM file holding the intermediates, nearest the attestation certificate first, taken from the vendor's published metadata. They are untrusted input. Each link is verified up to the pinned anchor, and they are stored in the key's `attestation_chain`. Pin the vendor's **root**, not an intermediate, unless the vendor publishes no root.

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

`trust-check` must print `TRUSTED` before any SHARED_DEV or PRODUCTION run. Run it with a plain `node`: a `NODE_OPTIONS` that preloads code (`--import`, `--require`) is refused.

## 5. Residual risks

- **Same-account code can subvert the verifier.**
  - **Corrected in DI-07.** The DI-04 text claimed the hardware key "survives" same-account code. It does not.
  - Anything that runs as the account performing the correction can do any of these: replace `crypto.verify`, edit the trust-root module before it runs, run its own verifier, or write the database file directly with sqlite.
  - The hardware key prevents one thing only: forging a signature that an **honest** verifier accepts.
  - The trust root and the import closure catch tampering with the *checkout*. They cannot catch a process that never runs them.
- **The true mitigations:**
  1. Run the correction on a host or account that agents cannot reach, for example the production service itself or an operator machine where the reviewer's authenticator lives.
  2. Have the approval verified **independently** of the machine that writes. Every committed ledger row stores the signed envelope, so a separate process can re-verify it after the fact with trusted `main` code: the `correction-ledger-verify` job designed in `docs/CORRECTION_GOVERNANCE_SEPARATION.md` §5. That is detection, not prevention.
  3. For prevention, a correction can be required to present a GitHub-issued verification attestation (same §5).
- **`node_modules` file integrity is not checked.**
  - The trust root pins the installed **versions** of the packages the correction code loads (`better-sqlite3`, `fastest-levenshtein` and their runtime dependencies) against the protected lock file, and refuses a shadowing `node_modules`.
  - It does not hash their files. `better-sqlite3` is a native build that differs per platform and Node version, so there is no single value to pin.
  - Someone who can edit `node_modules` in place can run code in the correction process. That is the same capability as the same-account case above, and the mitigations are the same.
  - `npm ci` from the protected lock (registry integrity hashes) is the supply-chain control at install time.
- **Production needs the network.** The trust root fetches `main` from GitHub inside the process that corrects. A production service without outbound HTTPS to github.com refuses every correction (fail closed). It no longer needs a `.git` directory.
- **The closure is static.** Code loaded by `import()` of a non-literal, `require`/`createRequire`, or a `#subpath` import refuses the check rather than being followed. Data files read at run time are protected only if they are listed in `PROTECTED_FILES`.
- **Replay after a restore.** Single use is recorded per database. A database restored to a pre-correction backup accepts the same approval again within its validity window (at most 14 days). Keep approvals short-lived and record restores.
- **The pinned roots are the trust anchor for hardware.** A wrongly pinned root (for example an attacker's CA) would admit software keys. That is why pinning is a reviewed, out-of-band-verified change.
- **Synthetic attestation only.** Real-device attestation, including the user-verified flag at key creation and any vendor intermediates, has not been exercised. The first real enrolment must be checked with `correctionApproval.js enrolment` before its PR.
