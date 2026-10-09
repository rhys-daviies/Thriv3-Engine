/**
 * Content fingerprints (deployment readiness §2d, §3d), on throwaway databases
 * in a temp directory. No app database is opened.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  fingerprint, compareFingerprints, assertNotLiveDatabase, openCopyReadOnly, DEFAULT_MARKER,
} from './dbFingerprint.js';

let dir;
const p = (name) => path.join(dir, name);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** A small schema with the shapes that matter: declared FKs three deep, an undeclared reference, a WITHOUT ROWID child. */
function build(file, { synthetic = false } = {}) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE representatives (id TEXT PRIMARY KEY, full_name TEXT, email TEXT);
    CREATE TABLE players (id TEXT PRIMARY KEY, full_name TEXT, email TEXT, public_slug TEXT, gpa REAL, rank INTEGER, extra);
    CREATE TABLE outreach (id TEXT PRIMARY KEY, athlete_id TEXT NOT NULL REFERENCES players(id), coach_id TEXT);
    CREATE TABLE outreach_send (id TEXT PRIMARY KEY, outreach_id TEXT NOT NULL REFERENCES outreach(id), state TEXT);
    CREATE TABLE outreach_send_event (id INTEGER PRIMARY KEY, outreach_send_id TEXT NOT NULL REFERENCES outreach_send(id), type TEXT, observed_at TEXT);
    CREATE TABLE send_tags (send_id TEXT NOT NULL REFERENCES outreach_send(id), tag TEXT NOT NULL, PRIMARY KEY (send_id, tag)) WITHOUT ROWID;
    CREATE TABLE generated_reports (id TEXT PRIMARY KEY, athlete_id TEXT, status TEXT);
    CREATE TABLE suppressions (email TEXT PRIMARY KEY, reason TEXT);
  `);
  const ins = (sql, ...v) => db.prepare(sql).run(...v);
  ins("INSERT INTO players VALUES ('p1', 'Real Athlete', 'real@school.example', 'real-1', 3.5, 7, 7)");
  ins("INSERT INTO players VALUES ('p2', 'Other Athlete', 'other@school.example', 'real-2', NULL, 1, NULL)");
  ins("INSERT INTO outreach VALUES ('o1', 'p1', 'c1')");
  ins("INSERT INTO outreach_send VALUES ('s1', 'o1', 'ACCEPTED')");
  ins("INSERT INTO outreach_send_event (outreach_send_id, type, observed_at) VALUES ('s1', 'REPLY', '2026-10-01')");
  ins("INSERT INTO send_tags VALUES ('s1', 'first')");
  ins("INSERT INTO generated_reports VALUES ('g1', 'p1', 'generated')");
  ins("INSERT INTO suppressions VALUES ('optout@school.example', 'unsubscribed')");
  if (synthetic) addSynthetic(db);
  db.close();
}

/** The §3d records: one marked parent, and children that carry NO marker field of their own. */
function addSynthetic(db) {
  const ins = (sql, ...v) => db.prepare(sql).run(...v);
  ins("INSERT INTO players VALUES ('9f1c', 'Rehearsal Synthetic Athlete', 'athlete@rehearsal.example.test', 'rbsyn01', NULL, 0, NULL)");
  ins("INSERT INTO outreach VALUES ('o-x', '9f1c', 'cx')");                          // child: no marker
  ins("INSERT INTO outreach_send VALUES ('s-x', 'o-x', 'DRAFTED')");                 // grandchild: no marker
  ins("INSERT INTO outreach_send_event (outreach_send_id, type, observed_at) VALUES ('s-x', 'REPLY', '2026-10-02')"); // great-grandchild
  ins("INSERT INTO send_tags VALUES ('s-x', 'rehearsal')");                          // WITHOUT ROWID child
  ins("INSERT INTO generated_reports VALUES ('g-x', '9f1c', 'generated')");          // undeclared reference
  ins("INSERT INTO suppressions VALUES ('coach1@rehearsal.example.test', 'manual')"); // marked by its own key
}

const EXTRA = [{ table: 'generated_reports', columns: ['athlete_id'], parent: 'players', parentColumns: ['id'] }];
const fpx = (f) => fingerprint(f, { exclude: DEFAULT_MARKER, extraReferences: EXTRA });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-fp-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('same content, different bytes: the same fingerprint', () => {
  it('a byte copy and a VACUUM INTO copy match the original, though the VACUUM file differs', () => {
    build(p('a.sqlite'));
    fs.copyFileSync(p('a.sqlite'), p('copy.sqlite'));
    const src = new Database(p('a.sqlite'));
    src.prepare('DELETE FROM players WHERE id = ?').run('p2');
    src.prepare("INSERT INTO players VALUES ('p2', 'Other Athlete', 'other@school.example', 'real-2', NULL, 1, NULL)").run();
    src.exec(`VACUUM INTO '${p('vac.sqlite')}'`);
    src.close();
    expect(sha(p('vac.sqlite'))).not.toBe(sha(p('copy.sqlite')));
    const [a, b, c] = ['a', 'copy', 'vac'].map((n) => fingerprint(p(`${n}.sqlite`)));
    expect(compareFingerprints(a, b).same).toBe(true);
    expect(compareFingerprints(a, c).same).toBe(true);
  });
});

describe('meaningful row changes are detected, and named by table', () => {
  const changed = (mutate) => {
    build(p('a.sqlite')); build(p('b.sqlite'));
    const db = new Database(p('b.sqlite')); mutate(db); db.close();
    return compareFingerprints(fingerprint(p('a.sqlite')), fingerprint(p('b.sqlite')));
  };

  it.each([
    ['an edited value', (db) => db.prepare("UPDATE players SET full_name = 'Real Athlete.' WHERE id = 'p1'").run(), 'players'],
    ['an inserted row', (db) => db.prepare("INSERT INTO suppressions VALUES ('new@school.example', 'manual')").run(), 'suppressions'],
    ['a deleted row', (db) => db.prepare("DELETE FROM outreach_send_event").run(), 'outreach_send_event'],
    ['a storage-type change, 7 to \'7\' (untyped column)', (db) => db.prepare("UPDATE players SET extra = '7' WHERE id = 'p1'").run(), 'players'],
    ['an integer to a real, 7 to 7.0 (untyped column)', (db) => db.prepare("UPDATE players SET extra = 7.5 - 0.5 WHERE id = 'p1'").run(), 'players'],
    ['NULL to empty string', (db) => db.prepare("UPDATE players SET gpa = '' WHERE id = 'p2'").run(), 'players'],
    ['a state change on a send', (db) => db.prepare("UPDATE outreach_send SET state = 'CANCELLED'").run(), 'outreach_send'],
    ['a WITHOUT ROWID row', (db) => db.prepare("UPDATE send_tags SET tag = 'second'").run(), 'send_tags'],
  ])('%s', (_, mutate, table) => {
    const r = changed(mutate);
    expect(r.same).toBe(false);
    expect(r.diffs.map((d) => d.table)).toEqual([table]);
  });

  it('a session touch (operator_sessions.last_seen_at) is a change: the quiet window catches an open tab', () => {
    const r = changed((db) => {
      db.exec('CREATE TABLE operator_sessions (token_sha256 TEXT PRIMARY KEY, last_seen_at TEXT)');
    });
    expect(r.diffs).toEqual([{ table: 'operator_sessions', kind: 'ADDED' }]);
  });

  it('a schema change (an added column) is a change even with no new data', () => {
    const r = changed((db) => db.exec('ALTER TABLE players ADD COLUMN note TEXT'));
    expect(r.diffs.map((d) => d.table)).toEqual(['players']);
  });
});

describe('synthetic records are excluded with everything that hangs off them', () => {
  it('a copy with the §3d records fingerprints like one without them, table by table', () => {
    build(p('clean.sqlite'));
    build(p('syn.sqlite'), { synthetic: true });
    const clean = fpx(p('clean.sqlite')); const syn = fpx(p('syn.sqlite'));
    expect(compareFingerprints(clean, syn).same).toBe(true);
    const ex = Object.fromEntries(Object.entries(syn.tables).map(([t, v]) => [t, v.excluded]));
    expect(ex).toEqual({
      representatives: 0,
      players: 1,              // marked
      outreach: 1,             // child, no marker
      outreach_send: 1,        // grandchild, no marker
      outreach_send_event: 1,  // great-grandchild, integer key, no marker
      send_tags: 1,            // WITHOUT ROWID child
      generated_reports: 1,    // undeclared reference
      suppressions: 1,         // marked by its own address
    });
  });

  it('without the exclusion they are counted, so the difference shows', () => {
    build(p('clean.sqlite'));
    build(p('syn.sqlite'), { synthetic: true });
    const r = compareFingerprints(fingerprint(p('clean.sqlite')), fingerprint(p('syn.sqlite')));
    expect(r.diffs.map((d) => d.table).sort()).toEqual(
      ['generated_reports', 'outreach', 'outreach_send', 'outreach_send_event', 'players', 'send_tags', 'suppressions']);
  });

  it('an undeclared reference is only followed when it is listed', () => {
    build(p('syn.sqlite'), { synthetic: true });
    const fp = fingerprint(p('syn.sqlite'), { exclude: DEFAULT_MARKER, extraReferences: [] });
    expect(fp.tables.generated_reports.excluded).toBe(0);
  });

  it('a change to a REAL row is still caught while synthetic rows are excluded', () => {
    build(p('before.sqlite'), { synthetic: true });
    fs.copyFileSync(p('before.sqlite'), p('after.sqlite'));
    const db = new Database(p('after.sqlite'));
    db.prepare("UPDATE outreach_send SET state = 'CANCELLED' WHERE id = 's1'").run();          // real
    db.prepare("UPDATE outreach_send SET state = 'ACCEPTED' WHERE id = 's-x'").run();          // synthetic: ignored
    db.prepare("INSERT INTO outreach_send_event (outreach_send_id, type) VALUES ('s-x', 'OPEN')").run(); // synthetic child: ignored
    db.close();
    const r = compareFingerprints(fpx(p('before.sqlite')), fpx(p('after.sqlite')));
    expect(r.diffs.map((d) => d.table)).toEqual(['outreach_send']);
  });

  it('a synthetic write that leaks onto a real row is caught (the no-collateral check)', () => {
    build(p('before.sqlite'), { synthetic: true });
    fs.copyFileSync(p('before.sqlite'), p('after.sqlite'));
    const db = new Database(p('after.sqlite'));
    // a "rehearsal" event attached to the REAL send: no marker on it, parent is real
    db.prepare("INSERT INTO outreach_send_event (outreach_send_id, type) VALUES ('s1', 'REPLY')").run();
    db.close();
    const r = compareFingerprints(fpx(p('before.sqlite')), fpx(p('after.sqlite')));
    expect(r.diffs.map((d) => d.table)).toEqual(['outreach_send_event']);
  });

  it('real children of real parents are never excluded', () => {
    build(p('syn.sqlite'), { synthetic: true });
    const fp = fpx(p('syn.sqlite'));
    expect(fp.tables.outreach.rows).toBe(1);
    expect(fp.tables.outreach_send_event.rows).toBe(1);
    expect(fp.tables.players.rows).toBe(2);
  });
});

describe('the marker', () => {
  it('matches each §3d form, and not ordinary values that merely contain the letters', () => {
    for (const v of ['RB-SYN-COACH-1', 'rbsyn01', 'coach1@rehearsal.example.test', 'Rehearsal Synthetic Athlete']) expect(DEFAULT_MARKER.test(v), v).toBe(true);
    for (const v of ['rbsyn-01', 'Hrbsyn01', 'rehearsal@school.example', 'Synthetic turf', 'RB-SYNC', 'real-1']) expect(DEFAULT_MARKER.test(v), v).toBe(false);
  });
});

describe('read-only, on copies only', () => {
  it('reading leaves the file byte-identical, and the connection cannot write', () => {
    build(p('a.sqlite'));
    const before = sha(p('a.sqlite'));
    fingerprint(p('a.sqlite'), { exclude: DEFAULT_MARKER });
    expect(sha(p('a.sqlite'))).toBe(before);
    const db = openCopyReadOnly(p('a.sqlite'));
    expect(() => db.prepare("DELETE FROM players").run()).toThrow();
    db.close();
  });

  it('refuses the database the app is configured to use, by path or by hard link', () => {
    build(p('live.sqlite'));
    fs.linkSync(p('live.sqlite'), p('alias.sqlite'));
    const env = { RECRUITMATCH_DB: p('live.sqlite') };
    expect(() => assertNotLiveDatabase(p('live.sqlite'), { env })).toThrow(/live database/);
    expect(() => assertNotLiveDatabase(p('alias.sqlite'), { env })).toThrow(/live database/);
    expect(() => fingerprint(p('live.sqlite'), { env })).toThrow(/live database/);
    fs.copyFileSync(p('live.sqlite'), p('copy.sqlite'));
    expect(() => assertNotLiveDatabase(p('copy.sqlite'), { env })).not.toThrow();
  });

  it('refuses the working database', () => {
    build(p('working.sqlite'));
    expect(() => assertNotLiveDatabase(p('working.sqlite'), { env: {}, working: p('working.sqlite') })).toThrow(/live database/);
  });
});

describe('the command line', () => {
  const cli = (args) => {
    try { return { code: 0, out: execFileSync(process.execPath, ['server/scripts/dbFingerprint.js', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RECRUITMATCH_DB: ':memory:' } }) }; }
    catch (e) { return { code: e.status, out: String(e.stdout) }; }
  };

  it('--compare exits 0 for the same content and 1 for a change, naming the table', () => {
    build(p('a.sqlite')); build(p('b.sqlite'));
    expect(cli([p('a.sqlite'), '--out', p('a.json')]).code).toBe(0);
    expect(cli([p('b.sqlite'), '--out', p('b.json')]).code).toBe(0);
    expect(cli(['--compare', p('a.json'), p('b.json')])).toMatchObject({ code: 0 });
    const db = new Database(p('b.sqlite')); db.prepare("DELETE FROM suppressions").run(); db.close();
    cli([p('b.sqlite'), '--out', p('b.json')]);
    const r = cli(['--compare', p('a.json'), p('b.json')]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/CHANGED\s+suppressions rows 1 -> 0/);
    expect(r.out).not.toContain('optout@school.example');   // names tables, never row contents
  });
});

describe('main\'s real schema', () => {
  it('fingerprints a database built by schema.sql + migrate(), and every listed undeclared reference exists in it', async () => {
    const { migrate } = await import('../db/migrate.js');
    const { UNDECLARED_REFERENCES } = await import('./dbFingerprint.js');
    const db = new Database(p('main.sqlite'));
    db.exec(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    migrate(db);
    const cols = (t) => db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    for (const r of UNDECLARED_REFERENCES) {
      expect(cols(r.table), `${r.table}`).toEqual(expect.arrayContaining(r.columns));
      expect(cols(r.parent), `${r.parent}`).toEqual(expect.arrayContaining(r.parentColumns));
      const declared = db.prepare(`PRAGMA foreign_key_list("${r.table}")`).all().map((f) => f.from);
      expect(declared.filter((c) => r.columns.includes(c)), `${r.table}.${r.columns} is declared now`).toEqual([]);
    }
    db.close();
    const fp = fingerprint(p('main.sqlite'), { exclude: DEFAULT_MARKER });
    expect(Object.keys(fp.tables).length).toBeGreaterThanOrEqual(50);
    expect(fp.tables.suppressions).toBeTruthy();
    expect(fp.tables.outreach_send).toBeTruthy();
  });
});
