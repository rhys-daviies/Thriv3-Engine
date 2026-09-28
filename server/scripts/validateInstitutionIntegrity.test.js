/**
 * Permanent guardrail test — Phase 2A/2B.
 *
 * Proves the validator FAILS (exit 1) when a VERIFIED/VERIFIED_ALIAS domain's
 * UNITID conflicts with its own single unambiguous claimed UNITID (the
 * mis-pointed-domain defect that silently mis-attributed institutions), PASSES
 * once corrected, and treats a genuinely ambiguous multi-claim domain
 * (rutgers-style) as a warning rather than a CRITICAL.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

const REPO = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(REPO, 'server/scripts/validateInstitutionIntegrity.js');
let root; let DB;

/** A minimal, internally-consistent institution DB; `domainUnitid`/`claimed` set the case under test. */
function build({ domainUnitid, claimed }) {
  const db = new Database(DB);
  db.exec(`CREATE TABLE colleges (name TEXT, sport TEXT, unitid INTEGER, state TEXT, division TEXT);
           CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT, claimed_unitids TEXT);
           CREATE TABLE institution_aliases (alias_key TEXT, unitid INTEGER, alias_type TEXT);
           CREATE TABLE coaches (id TEXT, full_name TEXT, school TEXT, sport TEXT, email_source_url TEXT);`);
  // two distinct, cleanly-resolving institutions
  db.prepare("INSERT INTO colleges VALUES ('Alpha State','mens-soccer',100,'AL','NCAA D1')").run();
  db.prepare("INSERT INTO colleges VALUES ('Beta College','mens-soccer',200,'BAL','NCAA D3')").run();
  // domain under test (Alpha's site); a coach filed correctly so no coach-conflict noise
  db.prepare('INSERT INTO athletics_domains VALUES (?,?,?,?)')
    .run('alphasports.com', domainUnitid, 'VERIFIED', JSON.stringify(claimed));
  db.prepare("INSERT INTO coaches VALUES ('c1','Pat Coach','Alpha State','mens-soccer',NULL)").run();
  db.close();
}

const run = () => {
  try { return { code: 0, out: execFileSync('node', [SCRIPT, '--db', DB], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-vii-')); DB = path.join(root, 'x.sqlite'); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('validateInstitutionIntegrity — mis-pointed VERIFIED domain', () => {
  it('FAILS when a VERIFIED domain UNITID conflicts its single claimed UNITID', () => {
    build({ domainUnitid: 200, claimed: [100] }); // stamped Beta, claims Alpha
    const { code, out } = run();
    expect(out).toContain('VERIFY-OWNERSHIP: alphasports.com');
    expect(code).toBe(1);
  });

  it('PASSES once the UNITID matches its single claimed UNITID', () => {
    build({ domainUnitid: 100, claimed: [100] });
    const { code, out } = run();
    expect(out).toContain('disagrees with a single unambiguous claim: 0');
    expect(code).toBe(0);
  });

  it('treats an ambiguous multi-claim mismatch (rutgers-style) as a warning, not CRITICAL', () => {
    build({ domainUnitid: 100, claimed: [200, 300] }); // neither matches, but 2 claims => ambiguous
    const { code, out } = run();
    expect(out).toContain('disagrees with a single unambiguous claim: 0');
    expect(out).toContain('ambiguous multi-claim');
    expect(code).toBe(0);
  });
});
