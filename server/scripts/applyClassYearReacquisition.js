/**
 * A7.40: apply the re-acquired 2026 class-year labels.
 *
 *   node server/scripts/applyClassYearReacquisition.js            # dry run
 *   node server/scripts/applyClassYearReacquisition.js --apply
 *
 * GUARDED, TRANSACTIONAL, IDEMPOTENT, and it writes ONE COLUMN.
 *
 * -- WHAT THIS REPAIRS AND WHAT IT REFUSES TO TOUCH ------------------------
 *
 * A7.39 found 752 roster rows with no class-year label, 724 of them in 30
 * programmes where every 2026 row was unlabelled. A7.40 traced it: the class
 * column is blank in the 2026 acquisition CSVs themselves, so the importer
 * stored faithfully what the extractor never captured. On these Sidearm pages
 * the roster is rendered TWICE - a list view and a card view - and only the
 * card view carries `.sidearm-roster-player-academic-year`. The extractor
 * reads the list view.
 *
 * So the labels were re-read from the SAME URL already recorded against each
 * row, from the card markup the extractor overlooked. Nothing is inferred:
 * there is no carry-forward from 2025, no graduation-year arithmetic and no
 * teammate distribution anywhere in this path. A7.39 section 5 forbids all
 * three, and the fixture carries the source name it matched for every row.
 *
 * REFUSED, DELIBERATELY:
 *   - rows whose player name does not match the page exactly (251 of them)
 *   - programmes whose current page lists a different squad from the one on
 *     file - Dominican, Hope, Montclair, Stevens, Swarthmore each hold 5-7
 *     rows against 29-49 now published. That is an INCOMPLETE ROSTER, not a
 *     missing label, and patching class onto it would dress a partial
 *     acquisition as a complete one.
 *   - every column except `class_year_label`.
 */
import '../db/refuseProductionVolume.js'; // MUST precede db/client.js — see that file
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { readClassYear } from '../../shared/classYear.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'docs/validation/a740/A7.40-classyear-fixture.json');
const APPLY = process.argv.includes('--apply');

const { changes, nameDigest } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/**
 * A7.41. The fixture stores a DIGEST of each player's name rather than the
 * name, because this repository is public and a 473-row list of named college
 * athletes is a compilation, not a roster page.
 *
 * NOTHING IS LOST. The row is identified by `id`; the name was only ever a
 * tamper check - "is this still the row the fixture was built against?" - and
 * a digest answers that identically. It is not an anonymisation guarantee
 * against someone who already holds the roster, and it is not meant to be.
 */
const digest = (name) => crypto.createHash('sha256')
  .update(`${nameDigest.salt}|${String(name)}`).digest('hex').slice(0, 16);

/** Every guard runs BEFORE the transaction opens; any failure aborts everything. */
const refusals = [];
const ready = [];
for (const c of changes) {
  const row = db.prepare('SELECT id, player_name, class_year_label, college_name, sport, season FROM roster_players WHERE id = ?').get(c.id);
  if (!row) { refusals.push([c.id, 'row no longer exists']); continue; }
  if (digest(row.player_name) !== c.playerNameDigest) { refusals.push([c.id, 'player name changed since the fixture was built']); continue; }
  if (row.college_name !== c.programme || row.sport !== c.sport) { refusals.push([c.id, 'programme or sport changed']); continue; }
  if (row.season !== '2026') { refusals.push([c.id, `season is ${row.season}, not 2026`]); continue; }
  // IDEMPOTENT: an already-correct row is a no-op, not a failure.
  if (row.class_year_label === c.to) continue;
  /**
   * NEVER OVERWRITE AN EXISTING LABEL. The fixture only ever repairs NULLs;
   * a non-null value here means something else wrote it and this script has
   * no standing to disagree with it.
   */
  if (row.class_year_label !== null) { refusals.push([c.id, `already labelled ${JSON.stringify(row.class_year_label)}`]); continue; }
  if (!readClassYear(c.to, { season: 2026 }).recognised) { refusals.push([c.id, `not a class year: ${JSON.stringify(c.to)}`]); continue; }
  ready.push(c);
}

console.log(`fixture ${changes.length} | ready ${ready.length} | refused ${refusals.length}`);
for (const [id, why] of refusals.slice(0, 20)) console.log(`  refused ${id}: ${why}`);
if (refusals.length) {
  console.error('\nABORTING: every fixture row must be applicable. Rebuild the fixture against current data.');
  process.exit(2);
}
if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to write.'); process.exit(0); }

const stmt = db.prepare('UPDATE roster_players SET class_year_label = ?, updated_date = ? WHERE id = ? AND class_year_label IS NULL');
const now = new Date().toISOString();
const run = db.transaction((rows) => {
  let n = 0;
  for (const c of rows) n += stmt.run(c.to, now, c.id).changes;
  return n;
});
const written = run(ready);
console.log(`applied: ${written} row(s) updated in one transaction`);
