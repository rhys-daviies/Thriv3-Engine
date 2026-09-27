#!/usr/bin/env node
/**
 * PHASE 3D — add the five externally-verified women's-soccer programme rows
 * (Phase 3C) and reassign the nine held coaches onto them.
 *
 *   node server/scripts/applyWomensProgrammes.js --db <path> \
 *       --fixture docs/validation/integrity-audit/phase3d_programme_fixture.json        # dry-run
 *   ... --apply                                                                          # write
 *
 * Each programme's institution-level fields are COPIED at apply time from that
 * UNITID's existing men's-soccer row (so they cannot drift from the fixture);
 * division/conference/active come from the externally-verified fixture; every
 * sport-specific metric is left NULL (never fabricated). Then the nine held
 * coaches are reassigned by institution filing only (coaches.school).
 *
 * ONE TRANSACTION, all-or-nothing. Idempotent: an already-present women's row or
 * an already-reassigned coach is detected and skipped. Refuses /data. Touches
 * ONLY the five new colleges rows and the nine coaches.school values — no men's
 * row, no aliases, no roster, no coach_seasons, no other coach.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db <target>.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing to target the production /data volume.'); process.exit(2); }
const fixture = JSON.parse(fs.readFileSync(path.resolve(arg('fixture')), 'utf8'));
assertUnredacted(fixture, path.resolve(arg('fixture')));

const db = new Database(dbArg, { fileMustExist: true });
const cols = db.prepare('PRAGMA table_info(colleges)').all().map((c) => c.name);
const menRow = db.prepare('SELECT * FROM colleges WHERE unitid = ? AND sport = ?');
const womenRow = db.prepare("SELECT id FROM colleges WHERE unitid = ? AND sport = 'womens-soccer'");
const coachById = db.prepare('SELECT full_name, school, sport FROM coaches WHERE id = ?');
const insertCol = db.prepare(`INSERT INTO colleges (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`);
const updCoach = db.prepare('UPDATE coaches SET school = @target WHERE id = @id AND school = @current AND sport = @sport');

const COPY = ['name', 'location', 'city', 'state', 'latitude', 'longitude', 'control', 'academic_rating', 'academic_rating_source', 'net_price', 'tuition_in_state', 'tuition_out_state', 'sat_avg', 'admit_rate', 'notable_majors', 'nickname', 'nickname_plural', 'mascot', 'primary_color', 'secondary_color', 'logo_url', 'identity_source'];
// sport-specific fields deliberately left NULL (never fabricated)
const NULL_FIELDS = ['rating', 'soccer_score', 'national_ranking', 'recent_win_pct', 'prior_win_pct', 'conference_champion_2025', 'conference_champion_name', 'conference_champion_source', 'conference_champion_notes', 'postseason_2025_round', 'website_domain', 'matching_data_source'];

const problems = [];
const progPlan = []; let progAlready = 0;
for (const p of fixture.programmes) {
  const men = menRow.get(p.unitid, p.copy_from_sport || 'mens-soccer');
  if (!men) { problems.push(`programme ${p.name}: no ${p.copy_from_sport} row for ${p.unitid}`); continue; }
  if (womenRow.get(p.unitid)) { progAlready++; continue; } // idempotent
  if (!p.conference || !p.division) { problems.push(`programme ${p.name}: missing conference/division`); continue; }
  progPlan.push({ p, men });
}
const coachPlan = []; let coachAlready = 0;
for (const c of fixture.coaches) {
  const cur = coachById.get(c.coach_id);
  if (!cur) { problems.push(`coach ${c.name}: ABSENT`); continue; }
  if (cur.school === c.target_school && cur.sport === c.sport) { coachAlready++; continue; } // idempotent
  if (cur.school !== c.current_school) { problems.push(`coach ${c.name}: school "${cur.school}" != expected "${c.current_school}"`); continue; }
  if (cur.sport !== c.sport) { problems.push(`coach ${c.name}: sport drift`); continue; }
  coachPlan.push(c);
}

console.log(`programmes: ${fixture.programmes.length} fixture | ${progPlan.length} to insert | ${progAlready} already present`);
console.log(`coaches:    ${fixture.coaches.length} fixture | ${coachPlan.length} to reassign | ${coachAlready} already reassigned`);
problems.forEach((x) => console.log('  BLOCKED:', x));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log(`\nDRY RUN — would insert ${progPlan.length} programmes, reassign ${coachPlan.length} coaches.`); db.close(); process.exit(0); }

let inserted = 0; let reassigned = 0;
try {
  db.exec('BEGIN');
  const now = new Date().toISOString();
  for (const { p, men } of progPlan) {
    const row = {}; for (const c of cols) row[c] = null;
    for (const c of COPY) row[c] = men[c];
    for (const c of NULL_FIELDS) row[c] = null;
    row.id = crypto.randomUUID();
    row.created_date = now; row.updated_date = now;
    row.sport = 'womens-soccer'; row.unitid = p.unitid;
    row.division = p.division; row.conference = p.conference; row.active = p.active ?? 1;
    row.identity_notes = 'women\'s-soccer programme added Phase 3D; institution fields copied from men\'s row; division/conference externally verified (Phase 3C).';
    insertCol.run(row);
    inserted += 1;
  }
  for (const c of coachPlan) {
    const r = updCoach.run({ id: c.coach_id, target: c.target_school, current: c.current_school, sport: c.sport });
    if (r.changes !== 1) throw new Error(`coach ${c.name}: expected 1 changed, got ${r.changes}`);
    reassigned += 1;
  }
  db.exec('COMMIT');
  console.log(`\nAPPLIED — inserted ${inserted} programmes, reassigned ${reassigned} coaches, in one transaction.`);
} catch (e) {
  try { db.exec('ROLLBACK'); } catch { /* nothing */ }
  console.error('\nROLLED BACK ENTIRE REPAIR:', e.message);
  db.close(); process.exit(1);
}
db.close();
