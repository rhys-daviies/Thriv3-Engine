#!/usr/bin/env node
/**
 * Moves athletes carrying a COPY of the shipped default onto the structured
 * composer.
 *
 *   npm run migrate-composition            what would move
 *   npm run migrate-composition -- --apply move it
 *
 * WHY THESE ROWS EXIST. The athlete form seeded `email_template` with a full
 * copy of `DEFAULT_EMAIL_TEMPLATE`, so every athlete created through the UI
 * carried a template nobody wrote. `canComposeStructured` then had to guess
 * intent by comparing that copy to the current constant — and when J4 edited
 * the constant, two athletes' copies stopped matching and 2,338 emails moved
 * onto the fallback composer silently.
 *
 * The form no longer seeds, and the authority is now presence rather than
 * content. This clears the copies that are already on file.
 *
 * NOTHING IS DESTROYED. The text moves to `email_template_archived` with a
 * timestamp, which is the same column `npm run archive-template -- --restore`
 * reads, so any row here is one command from being put back.
 *
 * CONSERVATIVE BY CONSTRUCTION. Only a byte-identical copy of the current
 * default moves. A template differing by so much as a space is operator work
 * whose intent we cannot prove, and it is listed for a person rather than
 * migrated — see `--list`.
 *
 * Idempotent: a cleared row has no template to match, so a second run moves
 * nothing.
 */
import 'dotenv/config';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { DEFAULT_EMAIL_TEMPLATE } from '../../src/lib/emailTemplate.js';

const APPLY = process.argv.includes('--apply');

/** What each saved template is, decided on evidence and never on a hunch. */
export function classifyTemplates(rows = []) {
  const out = { structured: [], defaultCopy: [], custom: [] };
  for (const p of rows) {
    const t = String(p.email_template ?? '');
    if (!t.trim()) out.structured.push(p);
    else if (t === DEFAULT_EMAIL_TEMPLATE) out.defaultCopy.push(p);
    else out.custom.push(p);
  }
  return out;
}

export function migrateCompositionAuthority({ apply = false } = {}) {
  const rows = db.prepare('SELECT id, full_name, email_template FROM players ORDER BY full_name').all();
  const c = classifyTemplates(rows);
  if (apply && c.defaultCopy.length) {
    const move = db.prepare(`
      UPDATE players SET email_template = NULL,
        email_template_archived = @text, email_template_archived_at = @at, updated_date = @at
      WHERE id = @id AND email_template IS NOT NULL
    `);
    db.transaction(() => {
      for (const p of c.defaultCopy) move.run({ id: p.id, text: p.email_template, at: utcNow() });
    })();
  }
  return {
    alreadyStructured: c.structured.map((p) => p.full_name),
    movedToStructured: c.defaultCopy.map((p) => p.full_name),
    keptCustom: c.custom.map((p) => p.full_name),
    applied: apply,
  };
}

function main() {
  const r = migrateCompositionAuthority({ apply: APPLY });
  console.log('\nCOMPOSITION AUTHORITY\n');
  console.log(`  already structured (no saved template) : ${r.alreadyStructured.length}`);
  for (const n of r.alreadyStructured) console.log(`      ${n}`);
  console.log(`  copies of the default ${APPLY ? '(MOVED)' : '(would move)'}      : ${r.movedToStructured.length}`);
  for (const n of r.movedToStructured) console.log(`      ${n}`);
  console.log(`  genuine custom templates (untouched)   : ${r.keptCustom.length}`);
  for (const n of r.keptCustom) console.log(`      ${n}   <- review by hand; intent cannot be proved`);
  console.log(APPLY
    ? '\n  Archived, not deleted. `npm run archive-template -- --restore` puts one back.\n'
    : '\n  Nothing changed. Re-run with --apply.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
