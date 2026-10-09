/**
 * AUTHENTICATED CORRECTION APPROVALS — Phase DI-03F (replaces the DI-03D typed-name validator).
 *
 * DI-03E MAJOR-2: an approval that NAMES a reviewer proves nothing — anyone can type "rhys-davies".
 * An approval is now a SIGNED ENVELOPE:
 *
 *   { kind: 'SIGNED_CORRECTION_APPROVAL', version: 1,
 *     body: { kind, approval_id, target: { class, identity }, ...what is approved..., basis, approved_at, expires_at },
 *     signatures: [ { reviewer_id, signature: '-----BEGIN SSH SIGNATURE-----...' }, ... ] }
 *
 * Each signature is an OpenSSH signature (namespace APPROVAL_NAMESPACE) over the CANONICAL JSON of the
 * body (sorted keys, no whitespace — `node server/scripts/correctionApproval.js body <envelope>` prints
 * the exact bytes), made with a key enrolled for that reviewer in shared/correctionReviewers.json. The
 * reviewer's identity is the key, not the name. Enrolling a key is a reviewed change to that file.
 *
 * An approval is valid only if ALL hold:
 *   - the body is the kind the caller expects and names the EXACT target environment it is used on
 *     (class + identity from correctionTarget.js) — an approval for a disposable copy can never
 *     authorise the shared or production database, nor one copy another;
 *   - every signature verifies, by a reviewer whose scopes include the target class; at least the
 *     policy's number of DISTINCT KEYS signed (PRODUCTION needs two — independent sign-off). A key enrolled
 *     under two reviewer ids refuses the whole registry, and two signatures by one key count once (DI-03H);
 *   - no placeholder marker in any free text (normalised: NFKC, zero-width removed, confusables folded);
 *   - approved_at is a real date not in the future; expires_at is after it, at most MAX_APPROVAL_DAYS
 *     later, and not yet passed (or, for `at` — historical verification of a committed correction —
 *     the approval was valid at that instant).
 *
 * A successful verification returns a GRANT: a frozen object registered in a module-private WeakSet.
 * Writers that change data (domainOwnershipCorrection) refuse to run without a live grant whose target
 * is the database they are writing, so a direct library call cannot skip authentication.
 *
 * The reviewer registry is always the committed shared/correctionReviewers.json — there is no override.
 *
 * DI-04: SHARED_DEV / PRODUCTION approvals need ATTESTED HARDWARE keys signing with touch AND PIN/biometric
 * (loadReviewers + fidoAttestation.js + verifySshSignature requireHardware); keys are one person per RAW key;
 * the rehearsal key can never hold a runtime scope.
 *
 * DI-07 (DI-06 MINOR-3): the TRUST ROOT (trustRoot.js) is enforced HERE, not only by the composite engine. For
 * a SHARED_DEV or PRODUCTION target verifyApproval issues no grant unless the correction code and data equal
 * the protected branch as fetched now; the grant records that commit (`trusted_commit`), and every writer
 * that accepts a grant calls grantProblems(), which re-checks the working copy against that commit
 * immediately before writing. A grant obtained any other way does not exist (module-private WeakSet).
 * See docs/CORRECTION_REVIEWER_SECURITY.md.
 */
import crypto from 'node:crypto';
import { verifySshSignature, parsePublicKey, fingerprint, keyIdentity } from './sshSignature.js';
import { attestationProblems } from './fidoAttestation.js';
import { readReviewerRegistry, REVIEWERS_PATH } from './reviewerRegistry.js';
import { trustedRuntimeState, recheckTrustedCommit } from './trustRoot.js';

export { REVIEWERS_PATH };
export const APPROVAL_NAMESPACE = 'thriv3-correction-approval@v1';
export const ENVELOPE_KIND = 'SIGNED_CORRECTION_APPROVAL';
export const MAX_APPROVAL_DAYS = 14;
export const ENV = Object.freeze({ PRODUCTION: 'PRODUCTION', SHARED_DEV: 'SHARED_DEV', DISPOSABLE: 'DISPOSABLE' });
export const APPROVAL_KINDS = Object.freeze({ COMPOSITE: 'COMPOSITE_CORRECTION_APPROVAL', REVERT: 'COMPOSITE_REVERT_APPROVAL' });
/** Floors the registry may raise but never lower. */
const MIN_SIGNERS_FLOOR = Object.freeze({ PRODUCTION: 2, SHARED_DEV: 1, DISPOSABLE: 1 });

// ---- canonical bytes ------------------------------------------------------------------------------
/** Canonical JSON: object keys sorted at every depth, no whitespace. */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}
export const bodyBytes = (body) => Buffer.from(canonicalJson(body), 'utf8');
export const bodyHash = (body) => crypto.createHash('sha256').update(bodyBytes(body)).digest('hex');

// ---- placeholder text -----------------------------------------------------------------------------
const CONFUSABLE = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'ο': 'o', 'Ο': 'O', 'α': 'a', 'ε': 'e' };
/** Fold text to a plain skeleton so look-alikes and invisible characters cannot hide a marker. */
export const skeleton = (s) => String(s ?? '').normalize('NFKC').replace(/[­᠎​-‏⁠-⁤﻿]/g, '')
  .replace(/[Ͱ-ϿЀ-ӿ]/g, (c) => CONFUSABLE[c] ?? c).normalize('NFD').replace(/[̀-ͯ]/g, '');
export const PLACEHOLDER = /not[\s_-]*approved|\bunapproved\b|pending|stand[\s_-]?in|placeholder|\btbd\b|\btbc\b|\btodo\b|\bfixme\b|to[\s_-]+be[\s_-]+(supplied|confirmed|replaced|named)|unsigned|awaiting|reviewer[\s_-]+name|\bxxx\b|lorem\s+ipsum|<[^>]*>/i;
export const placeholderIn = (s) => { const m = skeleton(s).match(PLACEHOLDER); return m ? m[0] : null; };

// ---- registry -------------------------------------------------------------------------------------
/**
 * The rehearsal reviewer's key (public seed, correctionTestKit.js). It is hard-denied any SHARED_DEV or
 * PRODUCTION scope in code, whatever the registry says (DI-04: DI-03G R1-9).
 */
export const REHEARSAL_KEY_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHqqEPrC4MtXOGy903Nt+YZkpw6G9RXQ9tC9HJ0J/AHw';
const RUNTIME_SCOPES = Object.freeze([ENV.SHARED_DEV, ENV.PRODUCTION]);

/**
 * The committed reviewer registry (version 3). Unreadable / malformed -> nobody may approve (fail closed).
 *
 * ONE KEY IS ONE PERSON (DI-03H MAJOR-B, DI-04 N1). Keys are compared by their RAW Ed25519 public key
 * (sshSignature.keyIdentity), so the same key enrolled as ssh-ed25519 and as an sk-ssh-ed25519 wrapper,
 * or under two application strings, is the same key. Any key under two reviewer ids, a duplicate id, or
 * the rehearsal key in a runtime scope refuses the WHOLE registry (`problem`).
 *
 * RUNTIME SCOPES NEED AN ATTESTED HARDWARE KEY (DI-04, DI-03G MAJOR-C). A reviewer may hold SHARED_DEV or
 * PRODUCTION scope only if EVERY key enrolled for them is an sk-ssh-ed25519 key entered as
 *   { "key": "<public key line>", "attestation": "<base64 ssh-sk-attest-v01>", "challenge": "<base64>",
 *     "attestation_chain": ["<PEM intermediate nearest the leaf>", ...] (optional, DI-07) }
 * whose attestation chains to a pinned vendor root (fidoAttestation.js). A reviewer that fails
 * keeps only DISPOSABLE scope, and `enrolment[reviewer_id]` says why.
 */
export function loadReviewers() {
  try {
    const j = readReviewerRegistry();
    if (j?.kind !== 'CORRECTION_REVIEWERS' || j.version !== 3 || !Array.isArray(j.reviewers)) return { reviewers: [], policy: {}, enrolment: {}, problem: 'reviewer registry unreadable or not version 3' };
    const rehearsal = keyIdentity(parsePublicKey(REHEARSAL_KEY_LINE));
    const enrolment = {}; const reviewers = []; const owner = new Map(); const ids = new Set();
    for (const r of j.reviewers) {
      if (!r?.reviewer_id || !r?.name || !Array.isArray(r.scopes) || !Array.isArray(r.keys) || placeholderIn(r.name)) continue;
      if (ids.has(r.reviewer_id)) return { reviewers: [], policy: {}, enrolment: {}, problem: `reviewer id ${r.reviewer_id} is enrolled more than once — registry refused` };
      ids.add(r.reviewer_id);
      let scopes = r.scopes.filter((x) => Object.values(ENV).includes(x));
      const keys = []; const why = [];
      for (const k of r.keys) {
        const line = typeof k === 'string' ? k : k?.key;
        let parsed; try { parsed = parsePublicKey(line); } catch (e) { why.push(`unparseable key: ${e.message}`); continue; }
        const id = keyIdentity(parsed);
        if (owner.has(id)) return { reviewers: [], policy: {}, enrolment: {}, problem: `key ${fingerprint(parsed.blob)} (raw key ${id.slice(8, 24)}…) is enrolled under both ${owner.get(id)} and ${r.reviewer_id} — one key is one person; registry refused` };
        owner.set(id, r.reviewer_id);
        if (id === rehearsal && scopes.some((x) => RUNTIME_SCOPES.includes(x))) return { reviewers: [], policy: {}, enrolment: {}, problem: `the public-seed rehearsal key is enrolled for ${r.reviewer_id} with a runtime scope — it may only ever authorise DISPOSABLE databases; registry refused` };
        if (scopes.some((x) => RUNTIME_SCOPES.includes(x))) why.push(...attestationProblems(parsed, { attestation: k?.attestation, challenge: k?.challenge, attestation_chain: k?.attestation_chain ?? null }).map((x) => `${fingerprint(parsed.blob)}: ${x}`));
        keys.push(line);
      }
      if (why.length && scopes.some((x) => RUNTIME_SCOPES.includes(x))) { enrolment[r.reviewer_id] = why; scopes = scopes.filter((x) => !RUNTIME_SCOPES.includes(x)); }
      reviewers.push({ reviewer_id: r.reviewer_id, name: r.name, scopes, keys });
    }
    return { reviewers, policy: j.policy || {}, enrolment };
  } catch (e) { return { reviewers: [], policy: {}, enrolment: {}, problem: `reviewer registry unreadable (${e.message})` }; }
}
export function minSigners(cls, policy = loadReviewers().policy) {
  const set = Number(policy?.min_distinct_signers?.[cls]);
  return Math.max(MIN_SIGNERS_FLOOR[cls] ?? 2, Number.isInteger(set) ? set : 0);
}

// ---- time -----------------------------------------------------------------------------------------
/** A real instant or a throw (an invalid `now` would otherwise switch every expiry check off). */
export function asInstant(v, what = 'now') {
  const d = v instanceof Date ? v : new Date(v ?? NaN);
  if (Number.isNaN(d.getTime())) throw new Error(`${what} is not a valid date (${String(v)}) — refusing rather than skipping time checks`);
  return d;
}
const isoDate = (s) => { const d = new Date(String(s ?? '')); return /^\d{4}-\d{2}-\d{2}/.test(String(s ?? '')) && !Number.isNaN(d.getTime()) ? d : null; };

// ---- grants ---------------------------------------------------------------------------------------
const GRANTS = new WeakSet();
/** Is `g` a grant issued by verifyApproval in this process (not a look-alike object)? */
export const isGrant = (g) => !!g && GRANTS.has(g);
/** How long a read-only, historical verification (`at`) may reuse a trusted tree fetched earlier. */
export const HISTORICAL_TRUST_MAX_AGE_MS = 5 * 60_000;

/**
 * Problems using `grant` to write `target` NOW ([] = usable). Every writer that accepts a grant calls this
 * (DI-07, MINOR-3): the grant must be live, for exactly this database, and — for SHARED_DEV / PRODUCTION —
 * issued under the trust root, whose files are re-checked against the grant's trusted commit here.
 */
export function grantProblems(grant, target = null) {
  if (!isGrant(grant)) return ['no authenticated approval grant (verifyApproval) — refused'];
  if (target && (target.class !== grant.target.class || target.identity !== grant.target.identity)) return [`the approval grant is for ${grant.target.class} ${grant.target.identity}; this database is ${target.class} ${target.identity ?? '(unidentified)'} — refused`];
  if (!RUNTIME_SCOPES.includes(grant.target.class)) return [];
  if (!grant.trusted_commit) return ['the approval grant was not issued under the trust root — refused'];
  return recheckTrustedCommit(grant.trusted_commit);
}

/** Free-text fields of a body that must not carry placeholders. */
function freeText(body) {
  const out = [['basis', body?.basis]];
  for (const r of Array.isArray(body?.contradiction_resolutions) ? body.contradiction_resolutions : []) out.push([`contradiction_resolutions ${r?.host}`, r?.reason]);
  return out;
}

/**
 * Verify a signed approval envelope. -> { problems[], grant|null }.
 *   kind     the body kind the caller requires
 *   target   { class, identity } of the database it will be used on (correctionTarget)
 *   now      the instant of use (current approvals) — must be a valid date
 *   at       verify as of this past instant instead (a committed correction's ledger record)
 */
export function verifyApproval(envelope, { kind, target, now = new Date(), at = null } = {}) {
  const p = [];
  const when = asInstant(at ?? now, at ? 'at' : 'now');
  if (!envelope || typeof envelope !== 'object') return { problems: ['approval: missing'], grant: null };
  if (envelope.kind !== ENVELOPE_KIND || envelope.version !== 1) p.push(`approval must be a ${ENVELOPE_KIND} v1 envelope (an unsigned or typed approval is not accepted)`);
  const body = envelope.body;
  if (!body || typeof body !== 'object') return { problems: [...p, 'approval: body missing'], grant: null };
  if (body.kind !== kind) p.push(`approval body kind ${body.kind} is not ${kind}`);
  if (!body.approval_id || typeof body.approval_id !== 'string') p.push('approval_id is required');
  if (!target || !Object.values(ENV).includes(target.class) || !target.identity) p.push('the target environment is unknown — refusing');
  else if (body.target?.class !== target.class || body.target?.identity !== target.identity) {
    p.push(`approval is for ${body.target?.class ?? '?'} ${body.target?.identity ?? '?'}, not this database (${target.class} ${target.identity})`);
  }
  for (const [k, v] of freeText(body)) {
    if (!String(v ?? '').trim()) p.push(`${k} is required`);
    else { const m = placeholderIn(v); if (m) p.push(`${k} carries a placeholder marker ("${m}")`); }
  }
  const atD = isoDate(body.approved_at); const exp = isoDate(body.expires_at);
  if (!atD) p.push('approved_at must be an ISO date');
  else if (atD.getTime() > when.getTime() + 60_000) p.push(`approved_at ${body.approved_at} is after ${at ? 'the commit' : 'now'}`);
  if (!exp) p.push('expires_at must be an ISO date');
  else if (atD) {
    if (exp.getTime() <= atD.getTime()) p.push('expires_at is not after approved_at');
    if (exp.getTime() - atD.getTime() > MAX_APPROVAL_DAYS * 86_400_000) p.push(`approval window exceeds ${MAX_APPROVAL_DAYS} days`);
    if (when.getTime() > exp.getTime()) p.push(`approval expired at ${body.expires_at}`);
  }
  // signatures
  const { reviewers, policy, enrolment, problem: registryProblem } = loadReviewers();
  if (registryProblem) p.push(`reviewer registry: ${registryProblem}`);
  const sigs = Array.isArray(envelope.signatures) ? envelope.signatures : [];
  const message = bodyBytes(body);
  const signers = []; const seen = new Set(); const keysUsed = new Map();
  if (!sigs.length) p.push('approval carries no signature');
  for (const s of sigs) {
    const rv = reviewers.find((r) => r.reviewer_id === s?.reviewer_id);
    if (!rv) { p.push(`signature by ${s?.reviewer_id ?? '(unnamed)'}: not an enrolled reviewer`); continue; }
    if (seen.has(rv.reviewer_id)) { p.push(`reviewer ${rv.reviewer_id} signed more than once`); continue; }
    seen.add(rv.reviewer_id);
    if (!rv.keys.length) { p.push(`reviewer ${rv.reviewer_id} has no enrolled signing key`); continue; }
    if (target?.class && !rv.scopes.includes(target.class)) { p.push(`reviewer ${rv.reviewer_id} may not authorise a ${target.class} database (scopes: ${rv.scopes.join(', ') || 'none'})${enrolment?.[rv.reviewer_id] ? ` — enrolment refused: ${enrolment[rv.reviewer_id].join('; ')}` : ''}`); continue; }
    // DI-04: a SHARED_DEV / PRODUCTION approval needs a hardware-key signature with touch AND PIN/biometric
    const v = verifySshSignature(message, s.signature, { namespace: APPROVAL_NAMESPACE, allowedKeys: rv.keys, requireHardware: RUNTIME_SCOPES.includes(target?.class) });
    if (!v.ok) { p.push(...v.problems.map((x) => `signature by ${rv.reviewer_id}: ${x}`)); continue; }
    // DI-03H (MAJOR-B): independence is counted by KEY, never by reviewer id
    if (keysUsed.has(v.key.identity)) { p.push(`signature by ${rv.reviewer_id} uses the same key (${v.key.fingerprint}) as ${keysUsed.get(v.key.identity)} — one key counts once`); continue; }
    keysUsed.set(v.key.identity, rv.reviewer_id);
    signers.push({ reviewer_id: rv.reviewer_id, name: rv.name, fingerprint: v.key.fingerprint, key_identity: v.key.identity, hardware: v.key.type === 'sk-ssh-ed25519@openssh.com' });
  }
  if (target?.class) {
    const need = minSigners(target.class, policy);
    const distinctKeys = new Set(signers.map((x) => x.key_identity)).size;
    if (distinctKeys < need) p.push(`${target.class} needs ${need} distinct authenticated reviewer key(s); ${distinctKeys} verified`);
  }
  // DI-07 (MINOR-3): no grant for a runtime database unless the code and data that decided it are the protected branch's
  let trusted_commit = null;
  if (RUNTIME_SCOPES.includes(target?.class)) {
    const tr = trustedRuntimeState(target.class, { maxAgeMs: at ? HISTORICAL_TRUST_MAX_AGE_MS : 0 });
    p.push(...tr.problems);
    trusted_commit = tr.trusted_commit;
    if (!trusted_commit && !tr.problems.length) p.push('trust root: no trusted commit established — refused');
  }
  if (p.length) return { problems: p, grant: null };
  const grant = Object.freeze({ kind: body.kind, approval_id: body.approval_id, body: deepFreeze(structuredClone(body)), body_hash: bodyHash(body), target: Object.freeze({ ...target }), signers: Object.freeze(signers.map((x) => Object.freeze(x))), trusted_commit });
  GRANTS.add(grant);
  return { problems: [], grant };
}

function deepFreeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }
