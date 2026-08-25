import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';
import { normalizeDivision } from '../../shared/divisions.js';

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

  // Normalised on the way in, or this table drifts back to holding both
  // `NCAA D1` and `NCAA Division I` the moment somebody sends to a coach who
  // is not in it yet — which is exactly how it came to hold both.
  const canonical = division ? normalizeDivision(division) : null;

  const row = {
    id: randomUUID(),
    created_at: utcNow(),
    full_name: full_name ?? null,
    email: address,
    school: school ?? null,
    division: canonical === 'Other' ? division : canonical,
    sport: sport ?? null,
    position_title: position_title ?? null,
    // Created on the fly by a send rather than promoted from the contact
    // sheets, so nothing is known about where the address came from. Left
    // 'unknown' rather than defaulted to something reassuring.
    email_status: 'unknown',
    source: 'send',
  };
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title,
                         email_status, source)
    VALUES (@id, @created_at, @full_name, @email, @school, @division, @sport, @position_title,
            @email_status, @source)
  `).run(row);
  return row;
}

export function getCoach(id) {
  return db.prepare('SELECT * FROM coaches WHERE id = ?').get(id) || null;
}
