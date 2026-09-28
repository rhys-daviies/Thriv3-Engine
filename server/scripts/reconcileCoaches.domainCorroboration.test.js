import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 6C.4 — domain corroboration behaviour through the REAL reconcile pipeline.
 * Proves eligibility derives naturally from athletics_domains evidence + coach_seasons
 * corroboration (never set manually):
 *   1. VERIFIED domain that coach_seasons scraped -> coach becomes eligible
 *   2. WRONG_INSTITUTION domain -> blocked
 *   3. INSUFFICIENT_EVIDENCE domain -> blocked
 *   4. VERIFIED domain NOT scraped by coach_seasons -> still blocked (the coach_seasons dependency)
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REC = 'server/scripts/reconcileCoaches.js';
let dir; let dbPath;

// build a minimal DB: one programme, one verified-email coach whose source_url is on the
// athletics domain; optionally a coach_seasons row that "scraped" that domain.
function build({ status, unitid, scraped }) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (name TEXT, sport TEXT, unitid INTEGER, state TEXT, division TEXT);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT);
    CREATE TABLE institution_aliases (alias_key TEXT, unitid INTEGER, alias_type TEXT);
    CREATE TABLE coaches (id TEXT, full_name TEXT, email TEXT, school TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, currentness_status TEXT);
    CREATE TABLE coach_seasons (school TEXT, sport TEXT, season INTEGER, coach_name TEXT, source_url TEXT);
  `);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?)').run('Test U', 'womens-soccer', 700, 'IA', 'NCAA D3');
  if (status) db.prepare('INSERT INTO athletics_domains VALUES (?,?,?)').run('testathletics.com', unitid, status);
  db.prepare("INSERT INTO coaches VALUES ('k1','Amy Coach','amy@testu.edu','Test U','womens-soccer','Head Coach','verified','https://testathletics.com/wsoc/coaches','CURRENT')").run();
  // coach_seasons roster row with a null coach_name (mirrors the real gap programmes)
  if (scraped) db.prepare("INSERT INTO coach_seasons VALUES ('Test U','womens-soccer',2026,NULL,'https://testathletics.com/wsoc/roster')").run();
  db.close();
}
function eligibility() {
  execFileSync('node', [REC, '--db', dbPath, '--csv', path.join(dir, 'out.csv')], { cwd: ROOT, encoding: 'utf8' });
  const D = new Database(dbPath, { readonly: true });
  const r = D.prepare("SELECT outreach_eligibility e, institution_resolution_status i FROM coaches_reconciled WHERE coach_id='k1'").get();
  D.close(); return r;
}
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6c4rec-')); dbPath = path.join(dir, 't.sqlite'); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 6C.4 domain corroboration via reconcile pipeline', () => {
  it('1. a VERIFIED domain that coach_seasons scraped unlocks eligibility naturally', () => {
    build({ status: 'VERIFIED', unitid: 700, scraped: true });
    expect(eligibility().e).toBe('YES');
  });
  it('2. a WRONG_INSTITUTION domain blocks eligibility', () => {
    build({ status: 'WRONG_INSTITUTION', unitid: 700, scraped: true });
    expect(eligibility().e).toBe('NO');
  });
  it('3. an INSUFFICIENT_EVIDENCE domain blocks eligibility', () => {
    build({ status: 'INSUFFICIENT_EVIDENCE', unitid: null, scraped: true });
    expect(eligibility().e).toBe('NO');
  });
  it('4. a VERIFIED domain NOT scraped by coach_seasons is still blocked (coach_seasons dependency)', () => {
    build({ status: 'VERIFIED', unitid: 700, scraped: false });
    expect(eligibility().e).toBe('NO');
  });
});
