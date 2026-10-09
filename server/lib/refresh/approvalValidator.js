/**
 * ONE STRICT APPROVAL VALIDATOR — Phase DI-03D. Used by the composite correction writer for its own
 * approval and for every approval record a stage fixture carries, and by hold releases.
 *
 * An approval is valid only if ALL hold:
 *   - reviewer_id names a reviewer in shared/correctionReviewers.json, and approved_by is exactly that
 *     reviewer's name (no free-text reviewer: a stand-in cannot be typed in);
 *   - the reviewer's scope covers the target (DISPOSABLE_ONLY reviewers can never authorise a
 *     correction of a runtime database);
 *   - no placeholder marker anywhere in approved_by / basis (NOT APPROVED, pending, stand-in, TBD ...);
 *   - approved_at is a real date not in the future; expires_at is after it, at most MAX_APPROVAL_DAYS
 *     later, and not yet passed.
 * Binding to fixtures, coach-ID sets and sendability is checked by the caller (compositeCorrection).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REVIEWERS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/correctionReviewers.json');
export const MAX_APPROVAL_DAYS = 14;
export const PLACEHOLDER = /not\s+approved|pending|stand[\s-]?in|placeholder|\btbd\b|\btbc\b|to\s+be\s+(supplied|confirmed|replaced|named)|unsigned|awaiting|reviewer\s+name|\bxxx\b|<[^>]*>/i;
export const TARGET = Object.freeze({ RUNTIME: 'RUNTIME', DISPOSABLE: 'DISPOSABLE' });

let memo = null;
/** The reviewer allow-list. Unreadable or malformed -> empty (nobody may approve: fail closed). */
export function loadReviewers(file = REVIEWERS_PATH) {
  if (memo && memo.file === file) return memo.list;
  let list = [];
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j?.kind === 'CORRECTION_REVIEWERS' && Array.isArray(j.reviewers)) {
      list = j.reviewers.filter((r) => r?.reviewer_id && r?.name && ['ANY', 'DISPOSABLE_ONLY'].includes(r.scope) && !PLACEHOLDER.test(r.name));
    }
  } catch { list = []; }
  memo = { file, list };
  return list;
}

const date = (s) => { const d = new Date(String(s ?? '')); return /^\d{4}-\d{2}-\d{2}/.test(String(s ?? '')) && !Number.isNaN(d.getTime()) ? d : null; };

/**
 * Problems with one approval record ([] = valid). `target`: TARGET.RUNTIME or TARGET.DISPOSABLE.
 * The reviewer list is always shared/correctionReviewers.json — there is no override.
 */
export function approvalProblems(ap, { target, now = new Date(), label = 'approval' } = {}) {
  const reviewers = loadReviewers();
  const p = [];
  if (!ap || typeof ap !== 'object') return [`${label}: missing`];
  if (!Object.values(TARGET).includes(target)) return [`${label}: unknown correction target ${target}`];
  const rv = reviewers.find((r) => r.reviewer_id === ap.reviewer_id);
  if (!ap.reviewer_id || !rv) p.push(`${label}: reviewer_id ${ap.reviewer_id ?? '(missing)'} is not an authorised reviewer (shared/correctionReviewers.json)`);
  else {
    if (ap.approved_by !== rv.name) p.push(`${label}: approved_by "${ap.approved_by ?? ''}" is not the name of reviewer ${rv.reviewer_id}`);
    if (target === TARGET.RUNTIME && rv.scope !== 'ANY') p.push(`${label}: reviewer ${rv.reviewer_id} may authorise disposable copies only, not a runtime database`);
  }
  for (const k of ['approved_by', 'basis']) if (!String(ap[k] ?? '').trim()) p.push(`${label}: ${k} is required`); else if (PLACEHOLDER.test(String(ap[k]))) p.push(`${label}: ${k} carries a placeholder marker ("${String(ap[k]).match(PLACEHOLDER)[0]}")`);
  const at = date(ap.approved_at); const exp = date(ap.expires_at); const n = now instanceof Date ? now : new Date(now);
  if (!at) p.push(`${label}: approved_at must be an ISO date`);
  else if (at.getTime() > n.getTime() + 60_000) p.push(`${label}: approved_at is in the future`);
  if (!exp) p.push(`${label}: expires_at must be an ISO date`);
  else if (at) {
    if (exp.getTime() <= at.getTime()) p.push(`${label}: expires_at is not after approved_at`);
    if (exp.getTime() - at.getTime() > MAX_APPROVAL_DAYS * 86_400_000) p.push(`${label}: approval window exceeds ${MAX_APPROVAL_DAYS} days`);
    if (n.getTime() > exp.getTime()) p.push(`${label}: approval expired at ${ap.expires_at}`);
  }
  return p;
}
