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
 *     policy's number of DISTINCT reviewers signed (PRODUCTION needs two — independent sign-off);
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
 */
import crypto from 'node:crypto';
import { verifySshSignature } from './sshSignature.js';
import { readReviewerRegistry, REVIEWERS_PATH } from './reviewerRegistry.js';

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
/** The committed reviewer registry. Unreadable / malformed -> nobody may approve (fail closed). */
export function loadReviewers() {
  try {
    const j = readReviewerRegistry();
    if (j?.kind !== 'CORRECTION_REVIEWERS' || j.version !== 2 || !Array.isArray(j.reviewers)) return { reviewers: [], policy: {} };
    const reviewers = j.reviewers.filter((r) => r?.reviewer_id && r?.name && Array.isArray(r.scopes) && Array.isArray(r.keys) && !placeholderIn(r.name))
      .map((r) => ({ reviewer_id: r.reviewer_id, name: r.name, scopes: r.scopes.filter((s) => Object.values(ENV).includes(s)), keys: r.keys.filter((k) => typeof k === 'string') }));
    return { reviewers, policy: j.policy || {} };
  } catch { return { reviewers: [], policy: {} }; }
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
  const { reviewers, policy } = loadReviewers();
  const sigs = Array.isArray(envelope.signatures) ? envelope.signatures : [];
  const message = bodyBytes(body);
  const signers = []; const seen = new Set();
  if (!sigs.length) p.push('approval carries no signature');
  for (const s of sigs) {
    const rv = reviewers.find((r) => r.reviewer_id === s?.reviewer_id);
    if (!rv) { p.push(`signature by ${s?.reviewer_id ?? '(unnamed)'}: not an enrolled reviewer`); continue; }
    if (seen.has(rv.reviewer_id)) { p.push(`reviewer ${rv.reviewer_id} signed more than once`); continue; }
    seen.add(rv.reviewer_id);
    if (!rv.keys.length) { p.push(`reviewer ${rv.reviewer_id} has no enrolled signing key`); continue; }
    if (target?.class && !rv.scopes.includes(target.class)) { p.push(`reviewer ${rv.reviewer_id} may not authorise a ${target.class} database (scopes: ${rv.scopes.join(', ') || 'none'})`); continue; }
    const v = verifySshSignature(message, s.signature, { namespace: APPROVAL_NAMESPACE, allowedKeys: rv.keys });
    if (!v.ok) { p.push(...v.problems.map((x) => `signature by ${rv.reviewer_id}: ${x}`)); continue; }
    signers.push({ reviewer_id: rv.reviewer_id, name: rv.name, fingerprint: v.key.fingerprint });
  }
  if (target?.class) {
    const need = minSigners(target.class, policy);
    if (signers.length < need) p.push(`${target.class} needs ${need} distinct authenticated reviewer(s); ${signers.length} verified`);
  }
  if (p.length) return { problems: p, grant: null };
  const grant = Object.freeze({ kind: body.kind, approval_id: body.approval_id, body: deepFreeze(structuredClone(body)), body_hash: bodyHash(body), target: Object.freeze({ ...target }), signers: Object.freeze(signers.map((x) => Object.freeze(x))) });
  GRANTS.add(grant);
  return { problems: [], grant };
}

function deepFreeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }
