#!/usr/bin/env node
/**
 * Imports the head-coach-by-season CSV into `coach_seasons`.
 *
 * The CSV is produced outside this repo by
 * ~/Documents/Thriv3/_roster_pipeline/coaches_run.py, which resolves each
 * programme's coach from that season's own year-addressed roster page — a
 * live page for a past season, so High confidence — and falls back to a
 * Wayback snapshot windowed to the season when no dated URL exists.
 *
 * Dry run by default, and the dry run is the useful half: it reports coverage
 * per season, how many programmes changed coach, and every reason a row did
 * not resolve, before anything is written.
 *
 *   node server/scripts/importCoachTenure.js
 *   node server/scripts/importCoachTenure.js --apply
 *   node server/scripts/importCoachTenure.js --file /path/to/coach_by_season.csv
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '../db/client.js';
import { parseCsvToObjects } from '../lib/csv.js';
import { utcNow } from '../lib/time.js';
import { matchSchoolName } from '../lib/schoolMatch.js';
import { tenureFor } from '../../shared/coachTenure.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const FILE = arg('file', path.join(os.homedir(), 'Documents/Thriv3/Coach Tenure/coach_by_season.csv'));

/**
 * Copies the database before writing, the way loadMatchingInputs and
 * promoteCoaches do. This replaces every row in the table, and a bad CSV
 * would otherwise be unrecoverable.
 */
function backup() {
  const src = db.name;
  if (!src || src === ':memory:') return null;
  const dest = `${src}.pre-coach-tenure-${utcNow().replace(/[:.]/g, '')}`;
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.prepare('VACUUM INTO ?').run(dest);
  return dest;
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`\nNo CSV at ${FILE}\nRun coaches_run.py first.\n`);
    process.exit(1);
  }
  const rows = parseCsvToObjects(fs.readFileSync(FILE, 'utf8'));
  if (!rows.length) { console.error('CSV is empty'); process.exit(1); }

  // Match against the college names the app actually holds, per sport.
  // matchSchoolName returns null rather than guessing, which is the whole
  // reason it is used here instead of the Levenshtein variant in
  // coachingImport.js — that one strips parentheticals and has silently
  // merged Union (KY), (TN) and (NY) onto one another.
  const known = {};
  for (const sport of ['mens-soccer', 'womens-soccer']) {
    known[sport] = db.prepare('SELECT name FROM colleges WHERE sport = ? AND active = 1')
      .all(sport).map((r) => r.name);
  }

  const bySeason = {};
  const reasons = {};
  const byProgramme = new Map();
  let unmatched = 0;
  const prepared = [];

  for (const r of rows) {
    const sport = (r.sport || '').trim();
    const season = Number(r.season);
    if (!sport || !Number.isFinite(season)) continue;

    const matched = matchSchoolName(r.school, known[sport] || []) || null;
    if (!matched) { unmatched += 1; continue; }

    const name = (r.coach_name || '').trim();
    bySeason[season] = bySeason[season] || { total: 0, named: 0 };
    bySeason[season].total += 1;
    if (name) bySeason[season].named += 1;
    else reasons[r.reason || 'unstated'] = (reasons[r.reason || 'unstated'] || 0) + 1;

    const key = `${matched}||${sport}`;
    if (!byProgramme.has(key)) byProgramme.set(key, []);
    byProgramme.get(key).push({ season, coach_name: name });

    prepared.push({
      school: matched, sport, season,
      division: (r.division || '').trim() || null,
      coach_name: name || null,
      coach_title: (r.coach_title || '').trim() || null,
      method: (r.method || '').trim() || null,
      confidence: (r.confidence || '').trim() || null,
      source_url: (r.source_url || '').trim() || null,
      reason: (r.reason || '').trim() || null,
    });
  }

  // ---- report ----
  console.log(`\n${FILE}`);
  console.log(`${rows.length} rows read, ${prepared.length} matched to a known programme`
    + (unmatched ? `, ${unmatched} unmatched school-sport rows skipped` : ''));

  console.log('\ncoverage by season');
  for (const season of Object.keys(bySeason).sort()) {
    const { total, named } = bySeason[season];
    console.log(`  ${season}  ${String(named).padStart(4)}/${total}  ${Math.round(100 * named / total)}%`);
  }

  const verdicts = { continuous: 0, changed: 0, vacantSomewhere: 0, tooThin: 0 };
  for (const rowsFor of byProgramme.values()) {
    const t = tenureFor(rowsFor);
    if (!t || !t.current) { verdicts.tooThin += 1; continue; }
    if (t.gaps.length) verdicts.vacantSomewhere += 1;
    if (t.changes.length) verdicts.changed += 1;
    else if (t.continuous) verdicts.continuous += 1;
  }
  console.log(`\n${byProgramme.size} programmes`);
  console.log(`  one coach throughout        ${verdicts.continuous}`);
  console.log(`  changed coach in the window ${verdicts.changed}`);
  console.log(`  a season with no coach      ${verdicts.vacantSomewhere}`);
  console.log(`  too thin to read            ${verdicts.tooThin}`);

  if (Object.keys(reasons).length) {
    console.log('\nwhy a season carries no name');
    for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${why.padEnd(28)} ${n}`);
    }
  }

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.\n');
    return;
  }

  const saved = backup();
  if (saved) console.log(`\nbacked up to ${saved}`);

  const at = utcNow();
  const write = db.transaction((list) => {
    db.prepare('DELETE FROM coach_seasons').run();
    const ins = db.prepare(`
      INSERT INTO coach_seasons
        (school, sport, season, division, coach_name, coach_title, method, confidence,
         source_url, reason, imported_at)
      VALUES
        (@school, @sport, @season, @division, @coach_name, @coach_title, @method, @confidence,
         @source_url, @reason, @imported_at)
      ON CONFLICT(school, sport, season) DO UPDATE SET
        division = excluded.division, coach_name = excluded.coach_name,
        coach_title = excluded.coach_title, method = excluded.method,
        confidence = excluded.confidence, source_url = excluded.source_url,
        reason = excluded.reason, imported_at = excluded.imported_at
    `);
    for (const row of list) ins.run({ ...row, imported_at: at });
  });
  write(prepared);
  console.log(`\n${db.prepare('SELECT COUNT(*) n FROM coach_seasons').get().n} rows in coach_seasons.\n`);
}

main();
