#!/usr/bin/env node
/**
 * DI-03F — operator tools for authenticated corrections. Never writes to a runtime database.
 *
 *   copy <src.sqlite> <dest.sqlite>          make a DISPOSABLE copy (source opened read-only; dest must be a
 *                                            new file outside any runtime location) and mark it
 *   classify <db.sqlite>                     how the engine classifies a database (PRODUCTION / SHARED_DEV /
 *                                            DISPOSABLE / UNKNOWN) and why
 *   body <envelope.json>                     print the exact bytes reviewers sign (canonical JSON of .body)
 *   attach <envelope.json> <reviewer_id> <file.sig>
 *                                            add a reviewer's signature (made with
 *                                            `ssh-keygen -Y sign -n thriv3-correction-approval@v1 -f <key> body.txt`)
 *   verify <envelope.json> --db <db.sqlite> --kind COMPOSITE_CORRECTION_APPROVAL|COMPOSITE_REVERT_APPROVAL [--activation-holds <f>]
 *                                            verify signatures, reviewers and target binding for that database
 *   enrolment <key.pub> <attestation file> <challenge file>
 *                                            (DI-04) check a NEW reviewer key before its enrolment PR: hardware (sk) key,
 *                                            attestation issued by a pinned root, certifying exactly this key; prints the
 *                                            registry entry to paste. Reads only the three files; writes nothing.
 *   trust-check                              (DI-04) compare every protected file with the protected branch fetched now —
 *                                            what a SHARED_DEV / PRODUCTION correction will require
 *
 * Signing flow:  node correctionApproval.js body approval.json > body.txt
 *                ssh-keygen -Y sign -n thriv3-correction-approval@v1 -f ~/.ssh/<reviewer key> body.txt
 *                node correctionApproval.js attach approval.json <reviewer_id> body.txt.sig
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { bodyBytes, verifyApproval, APPROVAL_NAMESPACE } from '../lib/refresh/approvalValidator.js';
import { createDisposableCopy, classifyDatabase, correctionTarget } from '../lib/refresh/correctionTarget.js';
import { attestationProblems } from '../lib/refresh/fidoAttestation.js';
import { parsePublicKey, fingerprint, keyIdentity } from '../lib/refresh/sshSignature.js';
import { protectedFileProblems, REPO_ROOT } from '../lib/refresh/trustRoot.js';

const [cmd, a1, a2, a3] = process.argv.slice(2);
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const fail = (m, c = 2) => { console.error(m); process.exit(c); };
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));

if (cmd === 'copy') {
  if (!a1 || !a2) fail('copy <src> <dest>');
  const r = createDisposableCopy(Database, a1, a2);
  console.log(`DISPOSABLE copy ${r.dest} (marker ${r.marker_id}) of ${a1}`);
} else if (cmd === 'classify') {
  const db = new Database(a1 || fail('classify <db>'), { readonly: true, fileMustExist: true });
  const c = classifyDatabase(db); db.close();
  console.log(`${c.class}${c.identity ? ` ${c.identity}` : ''}\n  ${c.why.join('\n  ')}`);
} else if (cmd === 'body') {
  process.stdout.write(bodyBytes(readJson(a1 || fail('body <envelope>')).body));
} else if (cmd === 'attach') {
  if (!a1 || !a2 || !a3) fail('attach <envelope> <reviewer_id> <file.sig>');
  const env = readJson(a1);
  env.signatures = [...(env.signatures || []).filter((s) => s.reviewer_id !== a2), { reviewer_id: a2, signature: fs.readFileSync(a3, 'utf8') }];
  fs.writeFileSync(path.resolve(a1), JSON.stringify(env, null, 2));
  console.log(`attached ${a2}'s signature (namespace ${APPROVAL_NAMESPACE}) — ${env.signatures.length} signature(s)`);
} else if (cmd === 'verify') {
  const env = readJson(a1 || fail('verify <envelope> --db <db> --kind <kind>'));
  const db = new Database(arg('db') || fail('--db'), { readonly: true, fileMustExist: true });
  try {
    const t = correctionTarget(db, { activationHoldsFile: arg('activation-holds') });
    const { problems, grant } = verifyApproval(env, { kind: arg('kind') || fail('--kind'), target: { class: t.class, identity: t.identity } });
    if (problems.length) { console.error(`NOT VALID for ${t.class} ${t.identity}:\n  - ${problems.join('\n  - ')}`); process.exitCode = 1; }
    else console.log(`VALID for ${t.class} ${t.identity}: ${grant.approval_id}, signed by ${grant.signers.map((s) => `${s.reviewer_id} (${s.fingerprint})`).join(', ')}; holds ${t.holdsSha256.slice(0, 12)} (approval pins ${String(grant.body.sendability?.activation_holds_sha256).slice(0, 12)})`);
  } finally { db.close(); }
} else if (cmd === 'enrolment') {
  if (!a1 || !a2 || !a3) fail('enrolment <key.pub> <attestation file> <challenge file>');
  const line = fs.readFileSync(a1, 'utf8').trim(); const key = parsePublicKey(line);
  const entry = { key: line, attestation: fs.readFileSync(a2).toString('base64'), challenge: fs.readFileSync(a3).toString('base64') };
  const p = attestationProblems(key, entry);
  if (p.length) { console.error(`NOT ENROLLABLE (${fingerprint(key.blob)}):\n  - ${p.join('\n  - ')}`); process.exitCode = 1; }
  else console.log(`ENROLLABLE: ${fingerprint(key.blob)} (${keyIdentity(key)}), application ${key.application}. Registry key entry:\n${JSON.stringify(entry, null, 2)}`);
} else if (cmd === 'trust-check') {
  const r = protectedFileProblems({ repoRoot: REPO_ROOT });
  if (r.problems.length) { console.error(`NOT TRUSTED (protected main ${r.trusted_commit?.slice(0, 12) ?? '?'}):\n  - ${r.problems.join('\n  - ')}`); process.exitCode = 1; }
  else console.log(`TRUSTED: every protected file equals main ${r.trusted_commit.slice(0, 12)} as fetched now`);
} else fail('usage: correctionApproval.js copy|classify|body|attach|verify|enrolment|trust-check ... (see the header)');
