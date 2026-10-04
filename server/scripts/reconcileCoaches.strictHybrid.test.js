import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 7B.2 — strict hybrid corroboration through the REAL reconcile pipeline.
 * Preserves the coach_seasons paths exactly; adds STRICT_AUTHORITATIVE_CURRENT gated
 * to an activation scope (default NAIA). Every listed Part-M case is exercised here.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REC = 'server/scripts/reconcileCoaches.js';
let dir; let dbPath;

function build({ division = 'NAIA', active = 1, domainStatus = 'VERIFIED', domainUnitid = 700, progUnitid = 700,
  email = 'coach@naiau.edu', emailStatus = 'verified', currentness = 'CURRENT', currentnessSrc = 'https://naiau.com/x',
  seenAt = '2026-09-28', seenUrl = 'https://naiau.com/x', sourceUrl = 'https://naiau.com/coaches',
  coachSport = 'mens-soccer', progSport = 'mens-soccer', csName = null, csSourceUrl = null } = {}) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (name TEXT, sport TEXT, unitid INTEGER, state TEXT, division TEXT, active INTEGER);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT);
    CREATE TABLE institution_aliases (alias_key TEXT, unitid INTEGER, alias_type TEXT);
    CREATE TABLE coach_seasons (school TEXT, sport TEXT, season INTEGER, coach_name TEXT, source_url TEXT);
    CREATE TABLE coaches (id TEXT, full_name TEXT, email TEXT, school TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, currentness_status TEXT, currentness_source_url TEXT, email_seen_on_source_at TEXT, email_seen_on_source_url TEXT);
  `);
  db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?,?)').run('NAIA U', progSport, progUnitid, 'IA', division, active);
  if (domainStatus) db.prepare('INSERT INTO athletics_domains VALUES (?,?,?)').run('naiau.com', domainUnitid, domainStatus);
  if (csName) db.prepare('INSERT INTO coach_seasons VALUES (?,?,?,?,?)').run('NAIA U', coachSport, 2026, csName, csSourceUrl || 'https://x/roster');
  if (csSourceUrl && !csName) db.prepare('INSERT INTO coach_seasons VALUES (?,?,?,?,?)').run('NAIA U', coachSport, 2026, 'Someone Else', csSourceUrl);
  db.prepare('INSERT INTO coaches VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('k1', 'Amy Coach', email, 'NAIA U', coachSport, 'Head Coach', emailStatus, sourceUrl, currentness, currentnessSrc, seenAt, seenUrl);
  db.close();
}
function reconcile(scope = 'NAIA') {
  execFileSync('node', [REC, '--db', dbPath, '--csv', path.join(dir, 'o.csv')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STRICT_CORROB_SCOPE: scope } });
  const D = new Database(dbPath, { readonly: true });
  const r = D.prepare("SELECT outreach_eligibility e, corroboration_method m FROM coaches_reconciled WHERE coach_id='k1'").get();
  D.close(); return r;
}
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7b2-')); dbPath = path.join(dir, 't.sqlite'); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 7B.2 strict hybrid corroboration (real pipeline)', () => {
  // ---- positive ----
  it('1. legacy coach_seasons identity still passes', () => { build({ csName: 'Amy Coach', domainStatus: null, currentness: null, seenAt: null, seenUrl: null }); const r = reconcile(); expect(r.e).toBe('YES'); expect(r.m).toBe('COACH_SEASONS_IDENTITY'); });
  it('2. legacy coach_seasons source-domain still passes', () => { build({ csSourceUrl: 'https://naiau.com/roster', currentness: null, seenAt: null, seenUrl: null }); const r = reconcile(); expect(r.e).toBe('YES'); expect(r.m).toBe('COACH_SEASONS_SOURCE_DOMAIN'); });
  it('3. strict authoritative passes with every condition (NAIA)', () => { build(); const r = reconcile(); expect(r.e).toBe('YES'); expect(r.m).toBe('STRICT_AUTHORITATIVE_CURRENT'); });
  it('4. independently proven VERIFIED_ALIAS passes', () => { build({ domainStatus: 'VERIFIED_ALIAS' }); const r = reconcile(); expect(r.e).toBe('YES'); expect(r.m).toBe('STRICT_AUTHORITATIVE_CURRENT'); });
  // ---- negative: remove one condition ----
  it('5. unresolved institution fails', () => { build({ domainStatus: null, email: 'coach@unknown.tld' }); expect(reconcile().e).toBe('NO'); });
  it('6/13. UNITID / wrong-domain mismatch fails', () => { build({ domainUnitid: 701 }); expect(reconcile().e).toBe('NO'); });
  it('7. inactive programme fails', () => { build({ active: 0 }); expect(reconcile().e).toBe('NO'); });
  it('8/22. wrong sport (no matching programme) fails', () => { build({ coachSport: 'womens-soccer', progSport: 'mens-soccer' }); expect(reconcile().e).toBe('NO'); });
  it('9. UNKNOWN currentness fails', () => { build({ currentness: 'UNKNOWN' }); expect(reconcile().e).toBe('NO'); });
  it('10/23. PROVEN_STALE / departed fails', () => { build({ currentness: 'PROVEN_STALE' }); expect(reconcile().e).toBe('NO'); });
  it('11. missing currentness source fails', () => { build({ currentnessSrc: null }); expect(reconcile().e).toBe('NO'); });
  it('12. untrusted (INSUFFICIENT) domain fails', () => { build({ domainStatus: 'INSUFFICIENT_EVIDENCE', domainUnitid: null, email: 'coach@unknown.tld' }); expect(reconcile().e).toBe('NO'); });
  it('14. missing email_seen timestamp fails', () => { build({ seenAt: null }); expect(reconcile().e).toBe('NO'); });
  it('15. missing email_seen URL fails', () => { build({ seenUrl: null }); expect(reconcile().e).toBe('NO'); });
  it('17. inferred email fails', () => { build({ emailStatus: 'inferred' }); expect(reconcile().e).toBe('NO'); });
  it('18. generic email fails', () => { build({ emailStatus: 'generic' }); expect(reconcile().e).toBe('NO'); });
  it('19. malformed email fails', () => { build({ email: 'notanemail' }); expect(reconcile().e).toBe('NO'); });
  it('20. unresolved identity ambiguity (AMBIGUOUS domain) fails', () => { build({ domainStatus: 'AMBIGUOUS', domainUnitid: null, email: 'coach@unknown.tld' }); expect(reconcile().e).toBe('NO'); });
  it('21. contradictory institution (WRONG_INSTITUTION domain) fails', () => { build({ domainStatus: 'WRONG_INSTITUTION', email: 'coach@unknown.tld' }); expect(reconcile().e).toBe('NO'); });
  // ---- scope / regression ----
  it('24/25. non-NAIA cannot use the NAIA-scoped strict path', () => { build({ division: 'NCAA D1' }); expect(reconcile('NAIA').e).toBe('NO'); });
  it('24b. NCAA coach_seasons corroboration still works under NAIA scope', () => { build({ division: 'NCAA D1', csName: 'Amy Coach', domainStatus: null, currentness: null, seenAt: null, seenUrl: null }); expect(reconcile('NAIA').e).toBe('YES'); });
  it('26. untouched legacy NAIA row (no CURRENT/email_seen) remains blocked', () => { build({ currentness: 'UNKNOWN', seenAt: null, seenUrl: null, currentnessSrc: null }); expect(reconcile().e).toBe('NO'); });
  it('27. pilot-repaired NAIA row passes (= case 3)', () => { build(); expect(reconcile().e).toBe('YES'); });
  it('28. stale NAIA row remains blocked even with full other evidence', () => { build({ currentness: 'PROVEN_STALE' }); expect(reconcile().e).toBe('NO'); });
  it('OFF disables the strict path entirely', () => { build(); expect(reconcile('OFF').e).toBe('NO'); });
  it('ALL enables strict for NCAA too', () => { build({ division: 'NCAA D1' }); expect(reconcile('ALL').e).toBe('YES'); });
  it('30. deterministic/idempotent: same result on rerun', () => { build(); const a = reconcile(); const b = reconcile(); expect(a).toEqual(b); expect(a.e).toBe('YES'); });
});
