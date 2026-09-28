/**
 * FEATURE-FLAGGED RECONCILED READ PATH — Phase 3C.
 *
 * Proves the three things the migration depends on:
 *   - flag OFF serves the legacy `coaches` rows, exactly as before;
 *   - flag ON serves only outreach_eligibility='YES', keyed on CANONICAL
 *     school, so a reassigned coach appears under their TRUE school and never
 *     under the wrong legacy one (the zero-wrong-institution invariant);
 *   - flag ON with the table not yet applied falls back to legacy rather than
 *     blanking outreach.
 *
 * Runs in a subprocess with RECRUITMATCH_DB pointed at a throwaway file, the
 * way the app is actually started, so the module's prepared statements bind to
 * the seeded database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

const REPO = path.resolve(import.meta.dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-pc-'));
const WITH = path.join(root, 'with-reconciled.sqlite');
const WITHOUT = path.join(root, 'no-reconciled.sqlite');

const DRIVER = path.join(root, 'driver.mjs');
fs.writeFileSync(DRIVER, `
import { programmeCoaches } from '${path.join(REPO, 'server/routes/programmeCoaches.js').replace(/\\\\/g, '/')}';
const [name, sport] = process.argv.slice(2);
process.stdout.write(JSON.stringify(programmeCoaches({ collegeName: name, sport })));
`);

/** Runs the read path for (name, sport) with a given flag value; returns the rows. */
const read = (db, name, sport, flag) => JSON.parse(execFileSync('node', [DRIVER, name, sport], {
  cwd: REPO,
  encoding: 'utf8',
  env: { ...process.env, RECRUITMATCH_DB: db, THRIV3_USE_RECONCILED_COACHES: flag ?? '' },
}));

/** Build the schema via the app's own client, then seed. */
function build(dbPath, withReconciled) {
  execFileSync('node', ['-e', "import('./server/db/client.js').then(() => process.exit(0))"], {
    cwd: REPO, env: { ...process.env, RECRUITMATCH_DB: dbPath },
  });
  const db = new Database(dbPath);
  const coach = db.prepare(`INSERT INTO coaches
    (id, created_at, full_name, email, school, sport, position_title, email_status)
    VALUES (@id, '2026-01-01', @name, @email, @school, @sport, @title, 'verified')`);
  // A: legitimately at Eureka. B: legacy school is WRONG (was filed at "Wrong (TX)"),
  // canonical is "Real State". C: at Eureka but withheld (ineligible).
  coach.run({ id: 'A', name: 'Ann Keep', email: 'ann@eureka.edu', school: 'Eureka', sport: 'womens-soccer', title: 'Head Coach' });
  coach.run({ id: 'B', name: 'Bob Reassign', email: 'bob@realstate.edu', school: 'Wrong (TX)', sport: 'womens-soccer', title: 'Head Coach' });
  coach.run({ id: 'C', name: 'Cara Withheld', email: 'cara@eureka.edu', school: 'Eureka', sport: 'womens-soccer', title: 'Assistant' });

  if (withReconciled) {
    db.exec(`CREATE TABLE coaches_reconciled (
      coach_id TEXT, coach_name TEXT, email TEXT, title TEXT, sport TEXT,
      legacy_school TEXT, legacy_unitid INTEGER, canonical_unitid INTEGER, canonical_school TEXT,
      source_url TEXT, source_domain TEXT, email_domain TEXT,
      classification TEXT, institution_resolution_status TEXT, coach_identity_status TEXT,
      email_verification_status TEXT, outreach_eligibility TEXT, ineligible_reason TEXT,
      resolution_method TEXT, evidence TEXT, reassigned INTEGER, canonicalized INTEGER)`);
    const r = db.prepare(`INSERT INTO coaches_reconciled
      (coach_id, coach_name, email, title, sport, canonical_school, canonical_unitid,
       email_verification_status, outreach_eligibility)
      VALUES (@id, @name, @email, @title, @sport, @school, @unitid, 'verified', @elig)`);
    r.run({ id: 'A', name: 'Ann Keep', email: 'ann@eureka.edu', title: 'Head Coach', sport: 'womens-soccer', school: 'Eureka', unitid: 111, elig: 'YES' });
    r.run({ id: 'B', name: 'Bob Reassign', email: 'bob@realstate.edu', title: 'Head Coach', sport: 'womens-soccer', school: 'Real State', unitid: 222, elig: 'YES' });
    r.run({ id: 'C', name: 'Cara Withheld', email: 'cara@eureka.edu', title: 'Assistant', sport: 'womens-soccer', school: 'Eureka', unitid: 111, elig: 'NO' });
  }
  db.close();
}

beforeAll(() => { build(WITH, true); build(WITHOUT, false); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('programmeCoaches reconciled read path', () => {
  it('flag OFF serves legacy coaches by school', () => {
    const rows = read(WITH, 'Eureka', 'womens-soccer', '');
    expect(rows.map((r) => r.coach_id).sort()).toEqual(['A', 'C']); // both legacy Eureka rows
  });

  it('flag ON serves only eligible=YES at the canonical school', () => {
    const rows = read(WITH, 'Eureka', 'womens-soccer', '1');
    expect(rows.map((r) => r.coach_id)).toEqual(['A']); // C is withheld; B is not canonically Eureka
  });

  it('flag ON shows a reassigned coach under their TRUE school', () => {
    const rows = read(WITH, 'Real State', 'womens-soccer', '1');
    expect(rows.map((r) => r.coach_id)).toEqual(['B']);
  });

  it('flag ON never shows a coach under their WRONG legacy school (zero wrong-institution)', () => {
    const rows = read(WITH, 'Wrong (TX)', 'womens-soccer', '1');
    expect(rows).toEqual([]);
  });

  it('flag ON but table absent falls back to legacy rather than blanking', () => {
    const rows = read(WITHOUT, 'Eureka', 'womens-soccer', '1');
    expect(rows.map((r) => r.coach_id).sort()).toEqual(['A', 'C']);
  });
});
