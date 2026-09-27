/**
 * PR #49 PRE-MERGE SAFETY CLOSURE — what "CRITICAL" is allowed to mean.
 *
 * Before this, every one of the four domain-ownership disagreements on the
 * shared dev database counted as a CRITICAL failure, so the validator for the
 * whole institution-identity architecture could never exit 0 — including for
 * `pct.edu` and `wvu.edu`, where Phase 2C proved the EXISTING stamp right and
 * the claim wrong. A guardrail that is permanently red is a guardrail nobody
 * reads.
 *
 * These tests pin the narrow relief and, more importantly, its limits. Relief
 * is earned from the evidence artifact, never from a list in the code, and the
 * last three cases are the ones that matter: an artifact entry cannot be used
 * to silence a row it no longer describes, cannot be conjured without evidence,
 * and cannot reach a domain it does not name.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

const REPO = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(REPO, 'server/scripts/validateInstitutionIntegrity.js');
let root; let DB; let GT;

/** Alpha=100, Beta=200, Gamma=300. The domain is stamped `stamped` and claims `claimed`. */
function build({ stamped, claimed = [100] }) {
  const db = new Database(DB);
  db.exec(`CREATE TABLE colleges (name TEXT, sport TEXT, unitid INTEGER, state TEXT, division TEXT);
           CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT, claimed_unitids TEXT);
           CREATE TABLE institution_aliases (alias_key TEXT, unitid INTEGER, alias_type TEXT);
           CREATE TABLE coaches (id TEXT, full_name TEXT, school TEXT, sport TEXT, email_source_url TEXT);`);
  db.prepare("INSERT INTO colleges VALUES ('Alpha State','mens-soccer',100,'AL','NCAA D1')").run();
  db.prepare("INSERT INTO colleges VALUES ('Beta College','mens-soccer',200,'BAL','NCAA D3')").run();
  db.prepare("INSERT INTO colleges VALUES ('Gamma Tech','mens-soccer',300,'GA','NCAA D2')").run();
  db.prepare('INSERT INTO athletics_domains VALUES (?,?,?,?)')
    .run('alphasports.com', stamped, 'VERIFIED', JSON.stringify(claimed));
  db.prepare("INSERT INTO coaches VALUES ('c1','Pat Coach','Alpha State','mens-soccer',NULL)").run();
  db.close();
}

const groundTruth = (rows) => fs.writeFileSync(GT, JSON.stringify(rows));

const run = () => {
  try { return { code: 0, out: execFileSync('node', [SCRIPT, '--db', DB, '--ground-truth', GT], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-adj-'));
  DB = path.join(root, 'x.sqlite');
  GT = path.join(root, 'gt.json');
  groundTruth([]);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('an externally adjudicated disagreement is not an undetected defect', () => {
  it('CLOSES a row where the DB matches the external verdict — the pct.edu shape', () => {
    // Stamped Beta, claims Alpha, and Phase 2C proved Beta correct.
    build({ stamped: 200, claimed: [100] });
    groundTruth([{
      domain: 'alphasports.com', existing_unitid: 200, verified_unitid: 200,
      verdict: 'EXISTING_MAPPING_CORRECT', evidence: ['https://example.test/proof'],
    }]);
    const { code, out } = run();
    expect(out).toContain('CLOSED: alphasports.com');
    expect(out).toContain('UNADJUDICATED: 0');
    expect(code).toBe(0);
  });

  it('HOLDS an adjudicated row that was deliberately not applied, and keeps it visible', () => {
    // Verdict says Alpha; the DB still carries the pre-adjudication Beta stamp on purpose.
    build({ stamped: 200, claimed: [100] });
    groundTruth([{
      domain: 'alphasports.com', existing_unitid: 200, verified_unitid: 100,
      verdict: 'CLAIMED_MAPPING_CORRECT', evidence: ['https://example.test/proof'],
    }]);
    const { code, out } = run();
    expect(out).toContain('HELD:   alphasports.com');
    // Held is a NAMED warning, not silence.
    expect(out).toContain('domain ownership adjudicated but HELD — alphasports.com');
    expect(code).toBe(0);
  });
});

describe('the anti-suppression clause', () => {
  it('REFUSES relief when the stamp has moved to a value the adjudication never ruled on', () => {
    // Phase 2C looked at 200 -> 100. The stamp is now Gamma, which it never saw.
    build({ stamped: 300, claimed: [100] });
    groundTruth([{
      domain: 'alphasports.com', existing_unitid: 200, verified_unitid: 100,
      verdict: 'CLAIMED_MAPPING_CORRECT', evidence: ['https://example.test/proof'],
    }]);
    const { code, out } = run();
    expect(out).toContain('the stamp has since moved');
    expect(out).toContain('UNADJUDICATED: 1');
    expect(code).toBe(1);
  });

  it('REFUSES relief to a verdict with no evidence behind it', () => {
    build({ stamped: 200, claimed: [100] });
    groundTruth([{
      domain: 'alphasports.com', existing_unitid: 200, verified_unitid: 200,
      verdict: 'EXISTING_MAPPING_CORRECT', evidence: [],
    }]);
    const { code, out } = run();
    expect(out).toContain('VERIFY-OWNERSHIP: alphasports.com');
    expect(code).toBe(1);
  });

  it('REFUSES relief to a domain the artifact does not name', () => {
    build({ stamped: 200, claimed: [100] });
    groundTruth([{
      domain: 'somewhereelse.com', existing_unitid: 200, verified_unitid: 200,
      verdict: 'EXISTING_MAPPING_CORRECT', evidence: ['https://example.test/proof'],
    }]);
    const { code } = run();
    expect(code).toBe(1);
  });

  it('fails closed when the artifact is missing or malformed', () => {
    build({ stamped: 200, claimed: [100] });
    fs.writeFileSync(GT, 'not json at all');
    const { code, out } = run();
    expect(out).toContain('UNADJUDICATED: 1');
    expect(code).toBe(1);
  });
});
