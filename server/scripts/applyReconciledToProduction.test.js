/**
 * PHASE 3C PRODUCTION APPLY — the additive, transactional, guarded migration.
 *
 * Uses small fixtures via the test-only --expect/--expect-fp overrides (which
 * production never passes). Proves: it refuses without --confirm-production;
 * it aborts and writes NOTHING when the target does not match the declared
 * baseline; on a match it applies the registry repairs and copies
 * coaches_reconciled additively, leaving `coaches` untouched; and it is
 * idempotent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const REPO = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(REPO, 'server/scripts/applyReconciledToProduction.js');
const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(REPO, 'docs/validation/generated/athletics_domains_repairs_final.json'), 'utf8'));
const REPAIR = FIXTURE[0]; // one real repair to prove the registry update lands

let root; let TARGET; let SOURCE; let EXPECT; let FP;

const fingerprint = (db) => {
  const cols = ['id', 'full_name', 'email', 'school', 'sport'];
  const rows = db.prepare('SELECT id, full_name, email, school, sport FROM coaches ORDER BY id').all();
  return crypto.createHash('sha256')
    .update(rows.map((r) => cols.map((c) => (r[c] == null ? '' : String(r[c]))).join('\u001f')).join('\n'))
    .digest('hex');
};

const run = (args) => {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env } });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-apply-'));
  TARGET = path.join(root, 'prod.sqlite');
  SOURCE = path.join(root, 'recon.sqlite');

  // --- target: the app schema + a small "production" ---
  execFileSync('node', ['-e', "import('./server/db/client.js').then(() => process.exit(0))"], {
    cwd: REPO, env: { ...process.env, RECRUITMATCH_DB: TARGET },
  });
  const t = new Database(TARGET);
  const c = t.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport, email_status)
    VALUES (?, '2026-01-01', ?, ?, ?, 'womens-soccer', 'verified')`);
  c.run('A', 'Ann', 'ann@x.edu', 'X'); c.run('B', 'Bob', 'bob@y.edu', 'Y');
  t.prepare(`INSERT INTO coach_seasons (school, sport, season, imported_at)
    VALUES ('X', 'womens-soccer', 2025, '2026-01-01')`).run();
  // one athletics_domains row that the first repair should correct
  t.prepare(`INSERT INTO athletics_domains
    (domain, unitid, status, claimed_keys, claimed_unitids, verification_method, confidence, checked_at)
    VALUES (?, ?, ?, '[]', '[]', 'seed', 'CURATED', '2026-01-01')`)
    .run(REPAIR.domain, (REPAIR.new_unitid ?? 0) + 1, REPAIR.new_status === 'VERIFIED' ? 'AMBIGUOUS' : 'VERIFIED');
  EXPECT = {
    coaches: 2,
    coach_seasons: 1,
    athletics_domains: 1,
    reconciled: 3,
    eligible: 2,
  };
  FP = fingerprint(t);
  t.close();

  // --- source: a validated coaches_reconciled (3 rows, 2 eligible) ---
  const s = new Database(SOURCE);
  s.exec(`CREATE TABLE coaches_reconciled (
    coach_id TEXT, coach_name TEXT, email TEXT, title TEXT, sport TEXT,
    legacy_school TEXT, legacy_unitid INTEGER, canonical_unitid INTEGER, canonical_school TEXT,
    source_url TEXT, source_domain TEXT, email_domain TEXT,
    classification TEXT, institution_resolution_status TEXT, coach_identity_status TEXT,
    email_verification_status TEXT, outreach_eligibility TEXT, ineligible_reason TEXT,
    resolution_method TEXT, evidence TEXT, reassigned INTEGER, canonicalized INTEGER)`);
  const r = s.prepare(`INSERT INTO coaches_reconciled
    (coach_id, coach_name, email, sport, canonical_school, canonical_unitid, email_verification_status, outreach_eligibility, source_domain)
    VALUES (?, ?, ?, 'womens-soccer', ?, ?, 'verified', ?, ?)`);
  r.run('A', 'Ann', 'ann@x.edu', 'X', 111, 'YES', null);
  r.run('B', 'Bob', 'bob@y.edu', 'Y', 222, 'YES', null);
  r.run('C', 'Cara', 'cara@z.edu', 'Z', 333, 'NO', null);
  s.close();
});

afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const expectArgs = (over = {}) => [
  '--target', TARGET, '--source', SOURCE,
  '--expect', JSON.stringify({ ...EXPECT, ...over.expect }),
  '--expect-fp', over.fp ?? FP,
];
const hasReconciled = (dbPath) => {
  const db = new Database(dbPath, { readonly: true });
  const present = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coaches_reconciled'").get();
  db.close();
  return present;
};

describe('applyReconciledToProduction', () => {
  it('refuses without --confirm-production and writes nothing', () => {
    const { code } = run(expectArgs());
    expect(code).toBe(2);
    expect(hasReconciled(TARGET)).toBe(false);
  });

  it('applies additively: repairs the registry, copies coaches_reconciled, leaves coaches untouched', () => {
    const before = fingerprint(new Database(TARGET, { readonly: true }));
    const { code, out } = run([...expectArgs(), '--confirm-production']);
    expect(code, out).toBe(0);
    expect(out).toContain('APPLY COMMITTED');
    const db = new Database(TARGET, { readonly: true });
    expect(db.prepare('SELECT COUNT(*) n FROM coaches_reconciled').get().n).toBe(3);
    expect(db.prepare("SELECT COUNT(*) n FROM coaches_reconciled WHERE outreach_eligibility='YES'").get().n).toBe(2);
    // the one repair landed
    const dom = db.prepare('SELECT unitid, status FROM athletics_domains WHERE domain=?').get(REPAIR.domain);
    expect(dom.unitid).toBe(REPAIR.new_unitid);
    expect(dom.status).toBe(REPAIR.new_status);
    // coaches never rewritten
    expect(fingerprint(db)).toBe(before);
    db.close();
  });

  it('is idempotent', () => {
    run([...expectArgs(), '--confirm-production']);
    const { code, out } = run([...expectArgs(), '--confirm-production']);
    expect(code, out).toBe(0);
    const db = new Database(TARGET, { readonly: true });
    expect(db.prepare('SELECT COUNT(*) n FROM coaches_reconciled').get().n).toBe(3);
    db.close();
  });

  it('aborts with no write when the target does not match the declared baseline', () => {
    const { code } = run([...expectArgs({ expect: { coaches: 9999 } }), '--confirm-production']);
    expect(code).toBe(1);
    expect(hasReconciled(TARGET)).toBe(false); // aborted at PRE, before any write
  });

  it('aborts when the source reconciliation is not the validated size', () => {
    const { code } = run([...expectArgs({ expect: { eligible: 999 } }), '--confirm-production']);
    expect(code).toBe(1);
    expect(hasReconciled(TARGET)).toBe(false);
  });
});
