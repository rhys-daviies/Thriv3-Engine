import { createEntity } from './base.js';
import db from '../client.js';
import { representativeError, publicRepresentative } from '../../../shared/representative.js';

/**
 * The consultants a coach can be pointed to — Phase 2. See the table comment in
 * schema.sql and shared/representative.js.
 */
const columns = ['full_name', 'email', 'phone', 'title', 'organisation', 'active'];
const base = createEntity('representatives', columns);

const fail = (message) => Object.assign(new Error(message), { status: 400 });

/** Trimmed, and the email lower-cased so one person cannot be entered twice by capitalisation. */
function normalise(data) {
  const out = { ...data };
  for (const k of ['full_name', 'email', 'phone', 'title', 'organisation']) {
    if (typeof out[k] === 'string') out[k] = out[k].trim() || null;
  }
  if (typeof out.email === 'string') out.email = out.email.toLowerCase();
  if ('active' in out) out.active = out.active === false || out.active === 0 || out.active === '0' ? 0 : 1;
  return out;
}

function checkUnique(email, exceptId = null) {
  if (!email) return;
  const clash = db.prepare('SELECT id FROM representatives WHERE email = ? AND id IS NOT ?').get(email, exceptId);
  if (clash) throw fail(`A representative with the email ${email} already exists.`);
}

export const Representative = {
  ...base,

  create(data) {
    const clean = normalise(data ?? {});
    const err = representativeError(clean);
    if (err) throw fail(err);
    checkUnique(clean.email);
    return base.create({ active: 1, ...clean });
  },

  update(id, data) {
    const existing = base.get(id);
    if (!existing) throw fail('No such representative.');
    const clean = normalise(data ?? {});
    const err = representativeError(clean, existing);
    if (err) throw fail(err);
    if ('email' in clean) checkUnique(clean.email, id);
    return base.update(id, clean);
  },

  /**
   * NEVER DELETED. Athletes name a representative and sent emails were signed
   * by one; removing the row would leave both pointing at nothing. Deactivate.
   */
  delete() {
    throw Object.assign(new Error('Representatives are deactivated, not deleted: set active to false.'), { status: 409 });
  },
  deleteWhere() {
    throw Object.assign(new Error('Representatives are deactivated, not deleted.'), { status: 409 });
  },
};

const BY_ID = db.prepare('SELECT * FROM representatives WHERE id = ?');

/** The representative an athlete row names, as a coach may see it, or null. */
export function representativeFor(athlete) {
  const id = athlete?.representative_id;
  if (!id) return null;
  return publicRepresentative(BY_ID.get(id));
}

/** The athlete row with `representative` attached. Does not mutate its argument. */
export function withRepresentative(athlete) {
  if (!athlete) return athlete;
  return { ...athlete, representative: representativeFor(athlete) };
}

/**
 * Whether a write may name this representative: it must exist, and a retired
 * one may stay on an athlete who already has them but cannot be newly assigned.
 */
export function representativeAssignmentError(nextId, currentId = null) {
  if (nextId === null || nextId === undefined || nextId === '') return null;
  const row = BY_ID.get(nextId);
  if (!row) return `representative_id "${nextId}" is not a representative on file`;
  if (!row.active && nextId !== currentId) return `${row.full_name} is no longer active and cannot be newly assigned`;
  return null;
}
