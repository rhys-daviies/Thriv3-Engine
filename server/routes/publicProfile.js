import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { OUTPUT_DIR } from '../export/exportProfiles.js';
import { renderRevokedPage } from '../../shared/revokedPage.js';

const SLUG = /^[A-Za-z0-9]{1,32}$/;

const findAthleteBySlug = db.prepare('SELECT id, archived_at FROM players WHERE public_slug = ?');
const findLiveOutreach = db.prepare(`
  SELECT id FROM outreach
  WHERE token = ? AND athlete_id = ? AND revoked_at IS NULL
`);

/**
 * Serves a generated athlete page, gated on the link still being live.
 *
 * Without this the page was a plain static file: deactivating an athlete
 * revoked their tokens and stopped event collection, but every link already
 * in a coach's inbox kept rendering the profile. Withdrawal from
 * representation has to actually take the material down.
 *
 * Every refusal answers 200 with the same neutral page, so the response
 * cannot be used to tell an unknown slug from a revoked one.
 */
export function publicProfileHandler(req, res) {
  const slug = String(req.params.slug || '').replace(/\.html$/i, '');
  const neutral = () => res.status(200).type('html').send(renderRevokedPage());

  if (!SLUG.test(slug)) return neutral();

  const athlete = findAthleteBySlug.get(slug);
  if (!athlete || athlete.archived_at) return neutral();

  // A link with no ?ref= at all still renders — the slug is itself a bearer
  // credential — but a token that is present and does not resolve for this
  // athlete means a revoked or tampered link.
  const ref = req.query.ref;
  if (ref !== undefined && !findLiveOutreach.get(String(ref), athlete.id)) return neutral();

  const file = path.join(OUTPUT_DIR, 'p', `${slug}.html`);
  if (!fs.existsSync(file)) return neutral();

  return res.status(200).type('html').send(fs.readFileSync(file, 'utf-8'));
}
