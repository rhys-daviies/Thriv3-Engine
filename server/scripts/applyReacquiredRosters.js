/**
 * A7.43: import the re-acquired Grand Canyon and Kansas State women's soccer
 * 2026 rosters.
 *
 *   node server/scripts/applyReacquiredRosters.js            # dry run
 *   node server/scripts/applyReacquiredRosters.js --apply
 *
 * GUARDED, TRANSACTIONAL, IDEMPOTENT, INSERT-ONLY.
 *
 * -- WHY THESE ROWS MAY BE TRUSTED ----------------------------------------
 *
 * A7.42 deleted 72 rows that a wrong page produced, and deliberately did not
 * replace them: the acquisition path could not prove which team a page
 * belonged to. A7.43 repaired that path - identity is now asserted BEFORE any
 * player is read - and these rows came through it. Both pages returned
 * `action: EXTRACT` with sport AGREES and season AGREES, from the canonical
 * roster URL rather than the synthesised `/season/2026` form that caused the
 * contamination.
 *
 * -- FIELD SEMANTICS ARE THE IMPORTER'S, NOT NEW ONES ---------------------
 *
 * `normalizePosition` and `readClassYear` are the same functions
 * `importRosterSheets.js` uses, and the two derived year columns follow its
 * rules exactly: derived from the class label, never from the page's own
 * "estimated graduation" column, and null where the class could not be read.
 * A missing field stays missing - A7.43 section 16 forbids filling one from a
 * prior season.
 */
import '../db/refuseProductionVolume.js'; // MUST precede db/client.js — see that file
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { normalizePosition } from '../lib/positions.js';
import { readClassYear } from '../../shared/classYear.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APPLY = process.argv.includes('--apply');
const SRC = process.env.A743_FIXTURE
  || path.join(ROOT, 'docs/validation/a743/A7.43-reacquisition-fixture.json');
const fixture = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const digest = (v) => crypto.createHash('sha256')
  .update(`${fixture.nameDigest.salt}|${String(v)}`).digest('hex').slice(0, 16);

const fail = (m) => { console.error(`\nBLOCKED: ${m}`); process.exit(2); };

/** Identity must have authorised every source in the fixture. */
for (const id of fixture.identity) {
  if (id.action !== 'EXTRACT') fail(`${id.programme} was not authorised by identity (${id.action})`);
  if (id.sportVerdict !== 'AGREES') fail(`${id.programme} sport verdict is ${id.sportVerdict}`);
  if (id.seasonVerdict !== 'AGREES') fail(`${id.programme} season verdict is ${id.seasonVerdict}`);
  if (id.duplicateNames) fail(`${id.programme} carries ${id.duplicateNames} duplicate player names`);
}

const programmes = [...new Set(fixture.rows.map((r) => `${r.college_name}|${r.sport}`))];
for (const key of programmes) {
  const [college_name, sport] = key.split('|');
  /**
   * IDEMPOTENCE AND ANTI-DUPLICATION IN ONE CHECK. The A7.42 deletion left
   * these programmes with no 2026 rows at all; if any exist now, either this
   * script already ran or something else wrote them, and in both cases it is
   * not this script's business to add more.
   */
  const existing = db.prepare('SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ? AND season = ?')
    .get(college_name, sport, '2026').n;
  if (existing) {
    console.log(`${college_name} already holds ${existing} rows for 2026 - nothing to do.`);
    process.exit(0);
  }
}

const now = new Date().toISOString();
const prepared = fixture.rows.map((r) => {
  const name = process.env.A743_NAMES === 'inline' ? r.playerName : r.playerName;
  if (!name) fail('the fixture carries no player names - run the applier against the full fixture');
  if (digest(name) !== r.playerNameDigest) fail(`name digest mismatch for a ${r.college_name} row`);
  const read = readClassYear(r.class_year_label, { season: 2026 });
  return {
    id: randomUUID(), created_date: now, updated_date: now,
    college_name: r.college_name, sport: r.sport, division: r.division, conference: r.conference,
    season: '2026', player_name: name,
    class_year_label: read.recognised ? (r.class_year_label || null) : null,
    position: normalizePosition(r.positionRaw),
    minutes_played: null, games_played: null, games_started: null,
    estimated_graduation_year: read.recognised ? (read.graduationYear ?? null) : null,
    eligibility_end_year: read.recognised ? (read.eligibilityEndYear ?? null) : null,
    hometown: r.hometown, source_roster_url: r.source_roster_url,
    source_fetched_at: now, source_parser: 'nuxt', data_confidence: 'HIGH',
    notes: 'A7.43 re-acquisition; page identity verified before extraction',
  };
});

console.log(`fixture rows ${fixture.rows.length} | prepared ${prepared.length} | programmes ${programmes.length}`);
for (const key of programmes) {
  const [c] = key.split('|');
  const rows = prepared.filter((p) => p.college_name === c);
  console.log(`  ${c}: ${rows.length} rows, ${rows.filter((r) => r.class_year_label).length} with class, ${rows.filter((r) => r.position !== 'UNKNOWN').length} with position`);
}
if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to insert.'); process.exit(0); }

const cols = Object.keys(prepared[0]);
const ins = db.prepare(`INSERT INTO roster_players (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`);
const run = db.transaction((rows) => {
  let n = 0;
  for (const r of rows) n += ins.run(r).changes;
  if (n !== rows.length) throw new Error(`expected ${rows.length} inserts, got ${n} - rolled back`);
  return n;
});
console.log(`applied: ${run(prepared)} row(s) inserted in one transaction (0 updates, 0 deletes)`);
