import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 4B — the currentness gate. A PROVEN_STALE coach must fail outreach
 * CLOSED; UNKNOWN (the default) and CURRENT must not be disqualified by this
 * axis. Drives the real reconcileCoaches.js against a minimal on-disk DB.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let dir; let dbPath;

function build() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (name TEXT, sport TEXT, unitid INTEGER, state TEXT, division TEXT);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT);
    CREATE TABLE institution_aliases (alias_key TEXT, unitid INTEGER, alias_type TEXT);
    CREATE TABLE coach_seasons (school TEXT, sport TEXT, season INTEGER, coach_name TEXT, source_url TEXT);
    CREATE TABLE coaches (id TEXT, full_name TEXT, email TEXT, school TEXT, sport TEXT,
      position_title TEXT, email_status TEXT, email_source_url TEXT, currentness_status TEXT);
    CREATE TABLE conference_members_official (unitid INTEGER);
  `);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?)').run('Testville', 'mens-soccer', 999001, 'NY', 'NCAA D3');
  db.prepare('INSERT INTO athletics_domains VALUES (?,?,?)').run('testville.com', 999001, 'VERIFIED');
  db.prepare('INSERT INTO coach_seasons VALUES (?,?,?,?,?)').run('Testville', 'mens-soccer', 2026, 'Jane Doe', 'https://testville.com/roster/2026');
  db.prepare('INSERT INTO coaches VALUES (?,?,?,?,?,?,?,?,?)').run(
    'c1', 'Jane Doe', 'jane@testville.com', 'Testville', 'mens-soccer', 'Assistant', 'verified', 'https://testville.com/coaches', null);
  db.close();
}
function eligibilityOf(currentness) {
  const db = new Database(dbPath);
  db.prepare('UPDATE coaches SET currentness_status=? WHERE id=?').run(currentness, 'c1');
  db.close();
  execFileSync('node', ['server/scripts/reconcileCoaches.js', '--db', dbPath, '--csv', path.join(dir, 'out.csv')], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  const d = new Database(dbPath, { readonly: true });
  const row = d.prepare("SELECT outreach_eligibility, ineligible_reason FROM coaches_reconciled WHERE coach_id='c1'").get();
  d.close();
  return row;
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'currentness-')); dbPath = path.join(dir, 'test.sqlite'); build(); });
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('currentness fails outreach closed only for PROVEN_STALE', () => {
  it('UNKNOWN (null) coach is eligible — the default never disqualifies', () => {
    expect(eligibilityOf(null).outreach_eligibility).toBe('YES');
  });
  it('CURRENT coach is eligible', () => {
    expect(eligibilityOf('CURRENT').outreach_eligibility).toBe('YES');
  });
  it('PROVEN_STALE coach is NOT eligible, with the currentness reason', () => {
    const r = eligibilityOf('PROVEN_STALE');
    expect(r.outreach_eligibility).toBe('NO');
    expect(r.ineligible_reason).toMatch(/PROVEN_STALE/);
  });
});
