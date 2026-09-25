/**
 * Permanent regression check — Phase 2B safety assertion.
 *
 * No outreach-eligible coach may have authoritative institution evidence (a
 * VERIFIED source domain) resolving to an institution DIFFERENT from the
 * coach's reconciled canonical institution. This is gate G1 of
 * validateReconciledCoaches; proven here to FAIL on a mismatch and PASS when
 * the evidence agrees.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

const REPO = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(REPO, 'server/scripts/validateReconciledCoaches.js');
let root; let DB;

/** Build a reconciled DB with one eligible coach; `domainUnitid` sets whether G1 trips. */
function build({ domainUnitid }) {
  const db = new Database(DB);
  db.exec(`CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT);
           CREATE TABLE coach_seasons (school TEXT, sport TEXT, season INTEGER, coach_name TEXT, source_url TEXT);
           CREATE TABLE coaches_reconciled (
             coach_id TEXT, coach_name TEXT, email TEXT, sport TEXT,
             canonical_unitid INTEGER, canonical_school TEXT, source_url TEXT,
             institution_resolution_status TEXT, email_verification_status TEXT, outreach_eligibility TEXT);`);
  // authoritative evidence: alphasports.com is VERIFIED; its UNITID is the variable under test
  db.prepare('INSERT INTO athletics_domains VALUES (?,?,?)').run('alphasports.com', domainUnitid, 'VERIFIED');
  // coach_seasons corroboration so G4 passes (identity present at the canonical school)
  db.prepare("INSERT INTO coach_seasons VALUES ('Alpha State','mens-soccer',2025,'Pat Coach','https://alphasports.com/roster')").run();
  // one eligible coach, canonical = Alpha State (100), citing the VERIFIED domain
  db.prepare(`INSERT INTO coaches_reconciled VALUES
    ('c1','Pat Coach','pat@alpha.edu','mens-soccer',100,'Alpha State','https://alphasports.com/staff','RESOLVED','verified','YES')`).run();
  db.close();
}

const run = () => {
  try { return { code: 0, out: execFileSync('node', [SCRIPT, '--db', DB], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-g1-')); DB = path.join(root, 'r.sqlite'); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('validateReconciledCoaches — G1 authoritative-evidence assertion', () => {
  it('FAILS when an eligible coach\'s VERIFIED source domain resolves to a different institution', () => {
    build({ domainUnitid: 999 }); // domain says 999, coach canonical is 100
    const { code, out } = run();
    expect(out).toContain('G1');
    expect(code).toBe(1);
  });

  it('PASSES when the VERIFIED source domain agrees with the canonical institution', () => {
    build({ domainUnitid: 100 });
    const { code, out } = run();
    expect(out).toContain('CRITICAL gate failures: 0');
    expect(code).toBe(0);
  });
});
