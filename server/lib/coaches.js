import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';

/**
 * Coaches are identified by (email, school, sport). A generic address like
 * msoccer@cornell.edu is legitimately shared across a staff, so the school and
 * sport are part of the key rather than the address alone. An email is
 * required: a coach we cannot mail cannot be sent outreach.
 */
export function findOrCreateCoach({ full_name, email, school, division, sport, position_title }) {
  const address = (email || '').trim().toLowerCase();
  if (!address || address === 'n/a') {
    throw new Error(`Coach "${full_name || 'unknown'}" has no usable email address`);
  }

  const existing = db
    .prepare('SELECT * FROM coaches WHERE email = ? AND school IS ? AND sport IS ?')
    .get(address, school ?? null, sport ?? null);
  if (existing) return existing;

  const row = {
    id: randomUUID(),
    created_at: utcNow(),
    full_name: full_name ?? null,
    email: address,
    school: school ?? null,
    division: division ?? null,
    sport: sport ?? null,
    position_title: position_title ?? null,
  };
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (@id, @created_at, @full_name, @email, @school, @division, @sport, @position_title)
  `).run(row);
  return row;
}

export function getCoach(id) {
  return db.prepare('SELECT * FROM coaches WHERE id = ?').get(id) || null;
}
