#!/usr/bin/env node
/**
 * Brings every athlete's saved email template up to the evidence engine.
 *
 * Each athlete carries their own copy of the template, taken from the default
 * the day they were created. Those copies predate `{{evidence_paragraph}}`, so
 * until this runs the engine selects evidence, the composer shows it, and the
 * coach receives the old sentence instead.
 *
 * Dry run by default, and the dry run is the useful half: it prints a diff of
 * exactly what would change per athlete before anything is written.
 *
 *   npm run migrate:templates                 # show what would change
 *   npm run migrate:templates -- --apply      # write it
 *   npm run migrate:templates -- --verify     # check every template, change nothing
 *
 * Idempotent: a template already carrying the token is skipped, so re-running
 * after a partial or interrupted run is safe.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { migrateTemplate, MIGRATION_STATUS, EVIDENCE_TOKEN } from '../../shared/templateMigration.js';
import { DEFAULT_EMAIL_TEMPLATE } from '../../src/lib/emailTemplate.js';
import { utcNow } from '../lib/time.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const VERIFY = argv.includes('--verify');

const DB_PATH = process.env.RECRUITMATCH_DB
  || path.resolve(process.cwd(), 'server/data/recruitmatch.sqlite');

/**
 * A copy of the database beside itself before anything is written.
 *
 * These are the operator's own words. A migration that got the block boundary
 * wrong would be unrecoverable without this, and the file is a few megabytes.
 */
function backup() {
  if (!fs.existsSync(DB_PATH)) return null;
  const stamp = utcNow().replace(/[:.]/g, '-');
  const dest = `${DB_PATH}.pre-template-migration-${stamp}`;
  fs.copyFileSync(DB_PATH, dest);
  return dest;
}

/** The changed region only — a full 1,300-character template is unreadable. */
function showChange(before, after) {
  const b = before.split('\n');
  const a = after.split('\n');
  let start = 0;
  while (start < b.length && start < a.length && b[start] === a[start]) start += 1;
  let endB = b.length - 1;
  let endA = a.length - 1;
  while (endB > start && endA > start && b[endB] === a[endA]) { endB -= 1; endA -= 1; }

  console.log('      --- was ---');
  for (const line of b.slice(start, endB + 1)) console.log(`      - ${line}`);
  console.log('      --- now ---');
  for (const line of a.slice(start, endA + 1)) console.log(`      + ${line}`);
}

function main() {
  const players = db.prepare(
    'SELECT id, full_name, sport, email_template FROM players ORDER BY full_name',
  ).all();

  if (!players.length) {
    console.log('\nNo athletes on file.\n');
    return;
  }

  console.log(`\n${VERIFY ? 'Verifying' : 'Migrating'} ${players.length} athlete template(s)`);
  console.log(`database: ${DB_PATH}\n`);

  const counts = {};
  const manual = [];
  const toWrite = [];

  for (const p of players) {
    const result = migrateTemplate(p.email_template);
    counts[result.status] = (counts[result.status] || 0) + 1;

    const label = `  ${p.full_name.padEnd(22)} ${String(p.sport || '').padEnd(14)}`;
    switch (result.status) {
      case MIGRATION_STATUS.ALREADY:
        console.log(`${label} already has ${EVIDENCE_TOKEN}`);
        break;
      case MIGRATION_STATUS.EMPTY:
        // Not a gap: an athlete with no saved template renders the default,
        // and the default already carries the token.
        console.log(`${label} no saved template — uses the default, which is already migrated`);
        break;
      case MIGRATION_STATUS.MANUAL:
        console.log(`${label} !! ${result.reason}`);
        manual.push(p);
        break;
      case MIGRATION_STATUS.MIGRATED:
        console.log(`${label} would gain ${EVIDENCE_TOKEN}`);
        if (!VERIFY) showChange(p.email_template, result.template);
        toWrite.push({ player: p, template: result.template });
        break;
      default:
        break;
    }
  }

  // Said out loud because it is the one thing a reader should check: a
  // migrated template that no longer matches the default is a template the
  // operator had customised, which is exactly what we set out to preserve.
  const customised = toWrite.filter(({ template }) => template !== DEFAULT_EMAIL_TEMPLATE);
  console.log(`\n  ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  if (toWrite.length) {
    console.log(`  ${toWrite.length - customised.length} of ${toWrite.length} land exactly on the current default; `
      + `${customised.length} keep their own wording as the {{else}} fallback.`);
  }
  if (manual.length) {
    console.log(`\n  ${manual.length} template(s) could NOT be migrated automatically:`);
    for (const p of manual) console.log(`    ${p.full_name} (${p.id})`);
    console.log(`  Add ${EVIDENCE_TOKEN} to these by hand where the programme sentence belongs.`);
    console.log('  Until then those athletes send the un-personalised template.');
  }

  if (VERIFY) {
    const bad = counts[MIGRATION_STATUS.MIGRATED] || 0;
    console.log(`\n${bad || manual.length ? `${bad + manual.length} template(s) are NOT evidence-ready.` : 'Every template is evidence-ready.'}\n`);
    process.exit(bad + manual.length ? 1 : 0);
  }

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.\n');
    return;
  }
  if (!toWrite.length) {
    console.log('\nnothing to write.\n');
    return;
  }

  const saved = backup();
  if (saved) console.log(`\nbacked up to ${path.basename(saved)}`);

  const update = db.prepare('UPDATE players SET email_template = ?, updated_date = ? WHERE id = ?');
  const run = db.transaction((rows) => {
    for (const { player, template } of rows) update.run(template, utcNow(), player.id);
  });
  run(toWrite);

  console.log(`updated ${toWrite.length} template(s).\n`);
}

main();
