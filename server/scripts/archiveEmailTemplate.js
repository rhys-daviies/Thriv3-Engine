#!/usr/bin/env node
/**
 * Moves one athlete's saved email template into the archive, and back.
 *
 *   npm run archive-template -- --athlete "Rhys Davies"
 *   npm run archive-template -- --athlete "Rhys Davies" --restore
 *   npm run archive-template -- --list
 *
 * WHY THIS EXISTS RATHER THAN AN UPDATE STATEMENT.
 *
 * `canComposeStructured` returns false for any athlete whose `email_template`
 * differs from the shipped default, so moving an athlete onto the structured
 * composer means clearing that column. A clear that destroys the original is
 * not a decision anybody can walk back, and the template is somebody's work.
 *
 * So the value moves to `email_template_archived` with a timestamp, one athlete
 * at a time, named explicitly. Nothing else reads the archive — it is not a
 * fallback, and an archived template sends nothing — and `--restore` puts it
 * straight back.
 *
 * Custom-template support itself is untouched: any athlete may still carry a
 * template, and this only moves the one it is told to.
 */
import 'dotenv/config';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { canComposeStructured, DEFAULT_EMAIL_TEMPLATE } from '../../src/lib/emailTemplate.js';
import { templateVariant } from '../../shared/evidence/templateVariant.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);

const select = db.prepare('SELECT * FROM players WHERE full_name = ?');

const describe = (p) => {
  console.log(`  ${p.full_name}`);
  console.log(`    email_template          : ${p.email_template ? `${p.email_template.length} chars` : '(none)'}`);
  console.log(`    email_template_archived : ${p.email_template_archived ? `${p.email_template_archived.length} chars, ${p.email_template_archived_at}` : '(none)'}`);
  console.log(`    templateVariant         : ${templateVariant(p.email_template, DEFAULT_EMAIL_TEMPLATE)}`);
  console.log(`    canComposeStructured    : ${canComposeStructured(p)}`);
};

if (has('list')) {
  for (const p of db.prepare('SELECT * FROM players ORDER BY full_name').all()) describe(p);
  process.exit(0);
}

const name = arg('athlete');
if (!name) throw new Error('--athlete "Full Name" is required');
const player = select.get(name);
if (!player) throw new Error(`no player named ${name}`);

console.log('\nBEFORE');
describe(player);

if (has('restore')) {
  if (!player.email_template_archived) throw new Error(`${name} has nothing archived`);
  db.prepare(`
    UPDATE players SET email_template = email_template_archived,
      email_template_archived = NULL, email_template_archived_at = NULL, updated_date = ?
    WHERE id = ?
  `).run(utcNow(), player.id);
  console.log('\nRESTORED — the archived template is live again.');
} else {
  if (!player.email_template?.trim()) throw new Error(`${name} has no custom template to archive`);
  // Refuses to overwrite an existing archive: two clears in a row would
  // silently discard the first template, which is the thing this exists to
  // prevent.
  if (player.email_template_archived) {
    throw new Error(`${name} already has an archived template from ${player.email_template_archived_at}`
      + ' — restore it first, or clear the archive deliberately.');
  }
  db.prepare(`
    UPDATE players SET email_template_archived = email_template,
      email_template_archived_at = ?, email_template = NULL, updated_date = ?
    WHERE id = ?
  `).run(utcNow(), utcNow(), player.id);
  console.log('\nARCHIVED — the athlete now uses the structured composer.');
}

console.log('\nAFTER');
describe(select.get(name));
console.log();
