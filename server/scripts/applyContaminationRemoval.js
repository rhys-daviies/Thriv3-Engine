/**
 * A7.42: remove the confirmed cross-sport contaminated roster rows.
 *
 *   node server/scripts/applyContaminationRemoval.js            # dry run
 *   node server/scripts/applyContaminationRemoval.js --apply
 *
 * GUARDED, TRANSACTIONAL, IDEMPOTENT, FIXTURE-AUTHORISED, DELETE-ONLY.
 *
 * -- WHY THESE ROWS ARE DELETED RATHER THAN CORRECTED ----------------------
 *
 * A7.41 found 72 rows filed as women's soccer that are not women's soccer
 * players. The 2026 acquisition requested `/roster/season/2026`, the site
 * resolved that as an internal season ID rather than a calendar year, and
 * served a different team entirely: Grand Canyon returned a cross-country
 * roster, Kansas State a 2016 men's track and field roster. Three independent
 * page-level signals say so - the page title, the canonical URL and the Nuxt
 * payload's own displayTitle - and all three were available before a single
 * player was read.
 *
 * THE WHOLE ROW IS FALSE, not one field. Nulling `position` would leave a
 * known-wrong athlete attached to a women's soccer programme; flagging them
 * would leave known-false rows inside the active dataset for something to
 * consume later; reassigning them would require establishing a data model for
 * a sport Thriv3 does not carry. Known-false active data leaves the dataset.
 *
 * -- WHAT REPLACES THEM: NOTHING, DELIBERATELY ----------------------------
 *
 * Both programmes have a working correct URL (drop the `/season/2026`
 * segment), recorded in the A7.42 report as CORRECT_SOURCE_ESTABLISHED. It is
 * NOT acquired here: the acquisition path still cannot prove sport identity
 * before extraction, so re-acquiring now would risk repeating the defect.
 * Grand Canyon and Kansas State become a recorded roster gap, and MISSING
 * EVIDENCE IS PREFERABLE TO KNOWN-FALSE EVIDENCE.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'docs/validation/a742/A7.42-contamination-fixture.json');
const APPLY = process.argv.includes('--apply');

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const { changes, nameDigest, membershipFingerprint, summary } = fixture;

/** A7.40/A7.42 privacy approach: the row is identified by id; the digest is a tamper check. */
const digest = (v) => crypto.createHash('sha256')
  .update(`${nameDigest.salt}|${String(v)}`).digest('hex').slice(0, 16);

const fail = (msg) => { console.error(`\nBLOCKED: ${msg}`); process.exit(2); };

// ---------------------------------------------------------------- G1, G2
if (changes.length !== 72) fail(`fixture holds ${changes.length} rows, not the frozen 72`);
const byProgramme = changes.reduce((m, c) => { m[`${c.programme}|${c.sport}`] = (m[`${c.programme}|${c.sport}`] || 0) + 1; return m; }, {});
for (const s of summary) {
  const n = byProgramme[`${s.programme}|${s.sport}`] ?? 0;
  if (n !== s.expected) fail(`${s.programme} holds ${n} fixture rows, expected ${s.expected}`);
}
// ---------------------------------------------------------------- G7 membership integrity
const recomputed = crypto.createHash('sha256').update(JSON.stringify(changes.map((c) => c.id).sort())).digest('hex');
if (recomputed !== membershipFingerprint) fail('fixture membership fingerprint does not match its own rows - the fixture has been edited');

/**
 * Every row is re-verified against the live database BEFORE the transaction
 * opens. The delete predicate is the fixture's row ids and nothing else - never
 * a programme-name match, which would take any row that happened to share a
 * name.
 */
const refusals = [];
const ready = [];
for (const c of changes) {
  const row = db.prepare('SELECT id, player_name, position, class_year_label, college_name, sport, season FROM roster_players WHERE id = ?').get(c.id);
  if (!row) continue; // already removed - idempotent, not a failure
  if (row.college_name !== c.programme || row.sport !== c.sport) { refusals.push([c.id, 'programme or sport changed since the fixture was frozen']); continue; }
  if (row.season !== c.season) { refusals.push([c.id, `season is ${row.season}, not ${c.season}`]); continue; }
  if (digest(row.player_name) !== c.playerNameDigest) { refusals.push([c.id, 'player name changed since the fixture was frozen']); continue; }
  if (digest([row.id, row.player_name, row.position, row.class_year_label].join('\u0001')) !== c.rowFingerprint) {
    refusals.push([c.id, 'row content changed since the fixture was frozen']); continue;
  }
  ready.push(c);
}

console.log(`fixture ${changes.length} | present and verified ${ready.length} | already absent ${changes.length - ready.length - refusals.length} | refused ${refusals.length}`);
for (const [id, why] of refusals.slice(0, 20)) console.log(`  refused ${id}: ${why}`);
if (refusals.length) fail('every fixture row must verify against live data. Re-freeze the set.');

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to delete.'); process.exit(0); }
if (ready.length === 0) { console.log('nothing to do - already applied.'); process.exit(0); }

// ---------------------------------------------------------------- G10 + apply
const del = db.prepare('DELETE FROM roster_players WHERE id = ?');
const run = db.transaction((rows) => {
  let n = 0;
  for (const c of rows) n += del.run(c.id).changes;
  /**
   * G10. The count is checked INSIDE the transaction, so a mismatch throws and
   * better-sqlite3 rolls the whole thing back rather than leaving a partial
   * deletion behind.
   */
  if (n !== rows.length) throw new Error(`expected to delete ${rows.length} rows, deleted ${n} - rolled back`);
  return n;
});
const deleted = run(ready);
console.log(`applied: ${deleted} row(s) deleted in one transaction (0 updates, 0 inserts)`);
