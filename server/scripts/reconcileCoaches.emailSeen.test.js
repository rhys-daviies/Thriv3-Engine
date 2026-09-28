import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 4F — email OBSERVATION (`email_seen_on_source_*`) carries no eligibility
 * weight. It records that the exact address was printed on a current page; it is
 * not deliverability and not a currentness verdict. Reconciliation must give the
 * identical outreach decision whether or not the observation columns are set.
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
      position_title TEXT, email_status TEXT, email_source_url TEXT, currentness_status TEXT,
      email_confirmed_at TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
    CREATE TABLE conference_members_official (unitid INTEGER);
  `);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?)').run('Testville', 'mens-soccer', 999001, 'NY', 'NCAA D3');
  db.prepare('INSERT INTO athletics_domains VALUES (?,?,?)').run('testville.com', 999001, 'VERIFIED');
  db.prepare('INSERT INTO coach_seasons VALUES (?,?,?,?,?)').run('Testville', 'mens-soccer', 2026, 'Jane Doe', 'https://testville.com/roster/2026');
  db.prepare('INSERT INTO coaches (id,full_name,email,school,sport,position_title,email_status,email_source_url,currentness_status) VALUES (?,?,?,?,?,?,?,?,?)').run(
    'c1', 'Jane Doe', 'jane@testville.com', 'Testville', 'mens-soccer', 'Assistant', 'verified', 'https://testville.com/coaches', null);
  db.close();
}
function eligibility() {
  execFileSync('node', ['server/scripts/reconcileCoaches.js', '--db', dbPath, '--csv', path.join(dir, 'out.csv')], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  const d = new Database(dbPath, { readonly: true });
  const row = d.prepare("SELECT outreach_eligibility FROM coaches_reconciled WHERE coach_id='c1'").get();
  d.close();
  return row.outreach_eligibility;
}
function setSeen(at, url) {
  const d = new Database(dbPath);
  d.prepare('UPDATE coaches SET email_seen_on_source_at=?, email_seen_on_source_url=? WHERE id=?').run(at, url, 'c1');
  d.close();
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4f-seen-elig-')); dbPath = path.join(dir, 'test.sqlite'); build(); });
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('email observation does not alter outreach eligibility', () => {
  it('is identical with the observation unset and set', () => {
    const before = eligibility();            // observation NULL
    expect(before).toBe('YES');
    setSeen('2026-09-26', 'https://testville.com/coaches');
    const after = eligibility();             // observation populated
    expect(after).toBe(before);              // no change from the observation
  });
});
