import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * PHASE 1G-PRE — coach attribution after a WRONG_INSTITUTION host is corrected, through the REAL
 * reconcile pipeline. The import filed some coaches under a look-alike school ("Trinity (TX)")
 * while their own staff page and mail domain are another school's (Trinity CT's bantamsports.com,
 * @trincoll.edu). While that host was WRONG_INSTITUTION nobody on it could be proven. Once it is
 * corrected, eligibility must follow the host's true owner — never the look-alike label, never
 * the wrong stored owner of a host that stays WRONG_INSTITUTION — and a coach proven stale stays
 * out. Institutions and hosts are invented.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REC = 'server/scripts/reconcileCoaches.js';
const LABEL = 701; const OWNER = 702; const STORED_WRONG = 703; const CLAIMANT = 704;
let dir; let dbPath;

function build({ ownerHostStatus }) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE colleges (name TEXT, sport TEXT, unitid INTEGER, state TEXT, division TEXT);
    CREATE TABLE athletics_domains (domain TEXT, unitid INTEGER, status TEXT);
    CREATE TABLE institution_aliases (alias_key TEXT, unitid INTEGER, alias_type TEXT);
    CREATE TABLE coaches (id TEXT, full_name TEXT, email TEXT, school TEXT, sport TEXT, position_title TEXT, email_status TEXT, email_source_url TEXT, currentness_status TEXT);
    CREATE TABLE coach_seasons (school TEXT, sport TEXT, season INTEGER, coach_name TEXT, source_url TEXT);
  `);
  const col = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?)');
  col.run('Trinity (TX)', 'mens-soccer', LABEL, 'TX', 'NCAA D3');
  col.run('Trinity (CT)', 'mens-soccer', OWNER, 'CT', 'NCAA D3');
  col.run('Saint Lookalike', 'mens-soccer', STORED_WRONG, 'CA', 'NCAA D1');
  col.run('St. Claimant (TX)', 'mens-soccer', CLAIMANT, 'TX', 'NCAA D1');
  const dom = db.prepare('INSERT INTO athletics_domains VALUES (?,?,?)');
  dom.run('bantams.example', OWNER, ownerHostStatus);           // the host being corrected
  dom.run('trinitytx.example', LABEL, 'VERIFIED');              // the look-alike's own host
  dom.run('rattlers.example', STORED_WRONG, 'WRONG_INSTITUTION'); // a host that STAYS wrong (stored owner is wrong)
  const coach = db.prepare('INSERT INTO coaches VALUES (?,?,?,?,?,?,?,?,?)');
  const OWN_PAGE = 'https://bantams.example/sports/mens-soccer/coaches';
  coach.run('farwell', 'Austin Farwell', 'austin.farwell@trincoll.example', 'Trinity (TX)', 'mens-soccer', 'Assistant Coach', 'verified', OWN_PAGE, null);
  coach.run('shanahan', 'Jess Shanahan', 'jess@trincoll.example', 'Trinity (TX)', 'mens-soccer', 'Head Coach', 'verified', OWN_PAGE, null);
  coach.run('sitkowski', 'Carli Sitkowski', 'carli@trincoll.example', 'Trinity (TX)', 'mens-soccer', 'Associate Head Coach', 'verified', OWN_PAGE, null);
  coach.run('pilarski', 'Devan Pilarski', 'devan@trincoll.example', 'Trinity (TX)', 'mens-soccer', 'Assistant Coach', 'verified', OWN_PAGE, 'PROVEN_STALE');
  coach.run('ndlovu', 'Methembe Ndlovu', 'methembe@trincoll.example', 'Trinity (CT)', 'mens-soccer', 'Head Coach', 'verified', OWN_PAGE, 'CURRENT');
  coach.run('texan', 'Terry Texan', 'terry@trinitytx.example', 'Trinity (TX)', 'mens-soccer', 'Head Coach', 'verified', 'https://trinitytx.example/sports/mens-soccer/coaches', 'CURRENT');
  coach.run('rattler', 'Rita Rattler', 'rita@claimant.example', 'Saint Lookalike', 'mens-soccer', 'Head Coach', 'verified', 'https://rattlers.example/sports/mens-soccer/coaches', null);
  const cs = db.prepare('INSERT INTO coach_seasons VALUES (?,?,2026,NULL,?)');
  cs.run('Trinity (CT)', 'mens-soccer', 'https://bantams.example/sports/mens-soccer/roster');
  cs.run('Trinity (TX)', 'mens-soccer', 'https://trinitytx.example/sports/mens-soccer/roster');
  cs.run('Saint Lookalike', 'mens-soccer', 'https://rattlers.example/sports/mens-soccer/roster');
  db.close();
}
function reconcile() {
  execFileSync('node', [REC, '--db', dbPath, '--csv', path.join(dir, 'out.csv')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RECRUITMATCH_DB: ':memory:' } });
  const D = new Database(dbPath, { readonly: true });
  const rows = Object.fromEntries(D.prepare('SELECT coach_id, outreach_eligibility e, canonical_unitid u FROM coaches_reconciled').all().map((r) => [r.coach_id, r]));
  const n = D.prepare('SELECT COUNT(*) n, COUNT(DISTINCT coach_id) d FROM coaches_reconciled').get();
  D.close(); return { rows, n };
}
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1gpre-')); dbPath = path.join(dir, 't.sqlite'); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('Phase 1G-PRE coach attribution through the reconcile pipeline', () => {
  it('before the correction nobody published on the WRONG_INSTITUTION host is eligible', () => {
    build({ ownerHostStatus: 'WRONG_INSTITUTION' });
    const { rows } = reconcile();
    for (const id of ['farwell', 'shanahan', 'sitkowski', 'pilarski', 'ndlovu']) expect(rows[id].e, id).toBe('NO');
  });
  it('1. a coach filed under a look-alike school becomes eligible ONLY at the host\'s true owner', () => {
    build({ ownerHostStatus: 'VERIFIED' });
    const { rows } = reconcile();
    expect(rows.farwell).toMatchObject({ e: 'YES', u: OWNER });
    expect(rows.farwell.u).not.toBe(LABEL);
  });
  it('2. several re-homed coaches land at the owner once each: no duplicated identity', () => {
    build({ ownerHostStatus: 'VERIFIED' });
    const { rows, n } = reconcile();
    expect(rows.shanahan).toMatchObject({ e: 'YES', u: OWNER });
    expect(rows.sitkowski).toMatchObject({ e: 'YES', u: OWNER });
    expect(n.n).toBe(n.d);                       // one reconciled row per coach
  });
  it('3. a coach proven stale stays out after the correction (the Pilarski shape)', () => {
    build({ ownerHostStatus: 'VERIFIED' });
    expect(reconcile().rows.pilarski.e).toBe('NO');
  });
  it('4. the owner\'s own correctly-filed coach is attributed to the owner (the Ndlovu shape)', () => {
    build({ ownerHostStatus: 'VERIFIED' });
    expect(reconcile().rows.ndlovu).toMatchObject({ e: 'YES', u: OWNER });
  });
  it('5. the look-alike school keeps its own coach and gains nobody from the corrected host', () => {
    build({ ownerHostStatus: 'VERIFIED' });
    const { rows } = reconcile();
    expect(rows.texan).toMatchObject({ e: 'YES', u: LABEL });
    const atLabel = Object.values(rows).filter((r) => r.e === 'YES' && r.u === LABEL).map((r) => r.coach_id);
    expect(atLabel).toEqual(['texan']);
  });
  it('6. a host that stays WRONG_INSTITUTION (its stored owner is wrong) makes nobody eligible at the wrong school', () => {
    build({ ownerHostStatus: 'VERIFIED' });
    const { rows } = reconcile();
    expect(rows.rattler.e).toBe('NO');
    expect(Object.values(rows).some((r) => r.e === 'YES' && r.u === STORED_WRONG)).toBe(false);
  });
});
