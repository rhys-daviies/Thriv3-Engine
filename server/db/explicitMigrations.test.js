/**
 * DI-08 — MIGRATIONS ARE EXPLICIT, AUTHORISED, BACKED UP, AUDITED, AND NEVER AN IMPORT'S SIDE EFFECT.
 *
 * The incident this guards (DI-08/P1/HOLDS.md): a measurement script imported
 * lib/recipientSelection.js, which imports db/client.js, and the live dev database silently gained
 * Phase 2/3's table and columns. Every case that opens a database file does so in a CHILD process
 * against a temp file, because importing the client is exactly the act under test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  migrateDatabase, schemaState, schemaFingerprint, migrationRecords, serverMayStart, MIGRATIONS_TABLE, MigrationRefused,
} from './migrations.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CLIENT = path.join(ROOT, 'server/db/client.js');
const RECIPIENT_SELECTION = path.join(ROOT, 'server/lib/recipientSelection.js');
const MIGRATE_CLI = path.join(ROOT, 'server/scripts/migrateDb.js');
const SERVER = path.join(ROOT, 'server/index.js');
const EMPTY = crypto.createHash('sha256').update('').digest('hex');

let dir;
const p = (n) => path.join(dir, n);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const quiet = { log: () => {} };

/** Every table's rows, hashed in rowid order — the audit table excluded. */
function contentHashes(file) {
  const db = new Database(file, { readonly: true });
  try {
    const out = {};
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> ? ORDER BY name").pluck().all(MIGRATIONS_TABLE)) {
      const h = crypto.createHash('sha256');
      for (const r of db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).raw().iterate()) h.update(JSON.stringify(r)).update('\n');
      out[t] = h.digest('hex');
    }
    return out;
  } finally { db.close(); }
}
const fingerprintOf = (file) => { const db = new Database(file, { readonly: true }); try { return schemaFingerprint(db).fingerprint; } finally { db.close(); } };
const stateOf = (file) => { const db = new Database(file, { readonly: true }); try { return schemaState(db); } finally { db.close(); } };
const tables = (file) => { const db = new Database(file, { readonly: true }); try { return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all(); } finally { db.close(); } };
const columns = (file, t) => { const db = new Database(file, { readonly: true }); try { return db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); } finally { db.close(); } };
const players = (file) => { const db = new Database(file, { readonly: true }); try { return db.prepare('SELECT * FROM players ORDER BY id').all(); } finally { db.close(); } };

/** A database the code's authorised migration created and recorded: CURRENT. Two athletes in it. */
function currentDb(file) {
  migrateDatabase({ dbPath: file, create: true, approve: EMPTY, operator: 'test', ...quiet });
  const db = new Database(file);
  const ins = db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, email, guardian_email, public_slug)
    VALUES (?, 'x', 'x', ?, 'Defender', 'mens-soccer', ?, 'g@example.com', ?)`);
  ins.run('p1', 'Athlete One', 'a1@example.com', 'slug-1');
  ins.run('p2', 'Athlete Two', 'a2@example.com', 'slug-2');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  return file;
}

/** The incident's shape: a pre-DI-08 database (no record) missing the representatives table and a players column. */
function behindDb(file) {
  currentDb(file);
  const db = new Database(file);
  db.exec(`DROP TABLE ${MIGRATIONS_TABLE}; DROP TABLE representatives; ALTER TABLE players DROP COLUMN preferred_states;`);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  return file;
}

/** A pre-DI-08 database that needs nothing: the schema is current, there is just no record. */
function unrecordedDb(file) {
  currentDb(file);
  const db = new Database(file);
  db.exec(`DROP TABLE ${MIGRATIONS_TABLE}`);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  return file;
}

/** Import modules in a fresh process, the way a measurement script does. */
function importIn(env, modules = [CLIENT], body = '') {
  const code = `
    try {
      for (const m of ${JSON.stringify(modules)}) await import(m);
      const db = (await import(${JSON.stringify(CLIENT)})).default;
      const out = { players: db.prepare('SELECT COUNT(*) n FROM players').get().n };
      ${body}
      console.log(JSON.stringify(out));
    } catch (e) { console.error(e.message); process.exit(3); }`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, ...env }, cwd: ROOT, timeout: 60_000 });
  return { status: r.status, out: r.status === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null, err: r.stderr };
}

const cli = (...args) => spawnSync(process.execPath, [MIGRATE_CLI, ...args], { encoding: 'utf8', env: process.env, cwd: ROOT, timeout: 120_000 });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-di08-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('(a) importing against a database that is BEHIND refuses, and writes nothing', () => {
  it('lib/recipientSelection.js — the incident import — refuses; the file is byte-identical', () => {
    const f = behindDb(p('behind.sqlite'));
    const before = sha(f);
    const r = importIn({ RECRUITMATCH_DB: f }, [RECIPIENT_SELECTION]);
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/schema is behind this code/);
    expect(r.err).toMatch(/npm run db:migrate -- --db/);
    expect(r.err).toMatch(/\+ table representatives/);
    expect(sha(f)).toBe(before);
    expect(tables(f)).not.toContain('representatives');
    expect(columns(f, 'players')).not.toContain('preferred_states');
  });

  it('db/client.js directly — refuses the same way', () => {
    const f = behindDb(p('behind.sqlite'));
    const before = sha(f);
    const r = importIn({ RECRUITMATCH_DB: f });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/SCHEMA|schema is behind/);
    expect(sha(f)).toBe(before);
  });

  it('a missing file is refused and NOT created', () => {
    const r = importIn({ RECRUITMATCH_DB: p('absent.sqlite') });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/--create/);
    expect(fs.existsSync(p('absent.sqlite'))).toBe(false);
  });
});

describe('(b) importing against an UP-TO-DATE database opens it and writes nothing', () => {
  it.each([['CURRENT (recorded)', currentDb], ['UNRECORDED (pre-DI-08, nothing pending)', unrecordedDb]])('%s', (_, make) => {
    const f = make(p('db.sqlite'));
    const before = sha(f);
    const mtime = fs.statSync(f).mtimeMs;
    const r = importIn({ RECRUITMATCH_DB: f }, [RECIPIENT_SELECTION]);
    expect(r.status, r.err).toBe(0);
    expect(r.out.players).toBe(2);
    expect(sha(f)).toBe(before);
    expect(fs.statSync(f).mtimeMs).toBe(mtime);
  });

  it('scripts may still WRITE ROWS (integrity:promote, apply* tools) — only the schema is off limits', () => {
    const f = currentDb(p('db.sqlite'));
    const fp = fingerprintOf(f);
    const r = importIn({ RECRUITMATCH_DB: f }, [CLIENT],
      "db.prepare(\"UPDATE players SET full_name = 'Renamed' WHERE id = 'p1'\").run(); out.wrote = true;");
    expect(r.status, r.err).toBe(0);
    expect(players(f)[0].full_name).toBe('Renamed');
    expect(fingerprintOf(f)).toBe(fp);
  });
});

describe('(c) the server never migrates implicitly', () => {
  const boot = (env) => spawnSync(process.execPath, [SERVER], { encoding: 'utf8', env: { ...process.env, PORT: '0', ...env }, cwd: ROOT, timeout: 60_000 });

  it('refuses to start on pending migrations, naming the command; the file is unchanged', () => {
    const f = behindDb(p('behind.sqlite'));
    const before = sha(f);
    const r = boot({ RECRUITMATCH_DB: f });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Refusing to start the server on/);
    expect(r.stderr).toMatch(/npm run db:migrate -- --db/);
    expect(sha(f)).toBe(before);
  });

  it('refuses an UNRECORDED database too: a rehearsal cannot see a pending data backfill', () => {
    const f = unrecordedDb(p('db.sqlite'));
    const before = sha(f);
    const r = boot({ RECRUITMATCH_DB: f });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no authorised migration has recorded this code version/);
    expect(r.stderr).toMatch(/--adopt/);
    expect(sha(f)).toBe(before);
  });

  it('a mismatched THRIV3_MIGRATION_APPROVAL refuses, and changes nothing', () => {
    const f = behindDb(p('behind.sqlite'));
    const before = sha(f);
    const r = boot({ RECRUITMATCH_DB: f, THRIV3_MIGRATION_APPROVAL: 'ab'.repeat(32) });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/approval does not match/);
    expect(sha(f)).toBe(before);
  });

  it('THRIV3_MIGRATION_APPROVAL is ignored by anything that is not the server entry point', () => {
    const f = behindDb(p('behind.sqlite'));
    const before = sha(f);
    const r = importIn({ RECRUITMATCH_DB: f, THRIV3_MIGRATION_APPROVAL: stateOf(f).fingerprint });
    expect(r.status).not.toBe(0);
    expect(sha(f)).toBe(before);
  });

  it('with the exact approval, the server runs the authorised migration (backup + audit row) before it starts', async () => {
    const f = behindDb(p('behind.sqlite'));
    const fp = stateOf(f).fingerprint;
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: '0', RECRUITMATCH_DB: f, THRIV3_MIGRATION_APPROVAL: fp, THRIV3_OPERATOR: 'render-deploy' }, cwd: ROOT });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 45_000);
      const poll = setInterval(() => { if (/MIGRATE recorded/.test(out)) { clearTimeout(t); clearInterval(poll); setTimeout(resolve, 500); } }, 100);
      child.on('exit', () => { clearTimeout(t); clearInterval(poll); resolve(); });
    });
    child.kill('SIGKILL');
    await new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.on('exit', r)));
    expect(out).toMatch(/\[db:migrate\] MIGRATE recorded/);
    const s = stateOf(f);
    expect(s.state).toBe('CURRENT');
    expect(s.latest).toMatchObject({ kind: 'MIGRATE', operator: 'render-deploy', schema_before: fp });
    expect(fs.existsSync(s.latest.backup_path)).toBe(true);
  }, 90_000);
});

describe('(d) db:migrate is explicit and authorised', () => {
  it('refuses without --db: there is no default database', () => {
    const r = cli();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--db <path>/);
  });

  it('without --approve it prints the plan and the fingerprint, and changes nothing', () => {
    const f = behindDb(p('behind.sqlite'));
    const before = sha(f);
    const r = cli('--db', f);
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/state\s+PENDING/);
    expect(r.stdout).toMatch(/\+ table representatives/);
    expect(fs.readdirSync(dir).filter((n) => !/-(wal|shm)$/.test(n))).toEqual(['behind.sqlite']);   // no backup: nothing ran
    expect(r.stdout).toContain(`--approve ${stateOf(f).fingerprint}`);
    expect(sha(f)).toBe(before);
  });

  it('a wrong or too-short approval is refused', () => {
    const f = behindDb(p('behind.sqlite'));
    const before = sha(f);
    expect(cli('--db', f, '--approve', 'ab'.repeat(32)).status).toBe(2);
    expect(cli('--db', f, '--approve', stateOf(f).fingerprint.slice(0, 8)).status).toBe(2);
    expect(sha(f)).toBe(before);
  });

  it('with approval: byte-exact backup, schema advanced, audit row, every existing row unchanged', () => {
    const f = behindDb(p('behind.sqlite'));
    const before = sha(f);
    const fpBefore = fingerprintOf(f);
    const rowsBefore = contentHashes(f);
    const playersBefore = players(f);
    const expectedAfter = stateOf(f).expectedAfter;

    const r = cli('--db', f, '--approve', fpBefore, '--operator', 'rhys');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/ROLLBACK/);

    const s = stateOf(f);
    expect(s.state).toBe('CURRENT');
    expect(s.fingerprint).toBe(expectedAfter);              // the rehearsal predicted the real result exactly
    expect(tables(f)).toContain('representatives');
    expect(columns(f, 'players')).toContain('preferred_states');

    const [rec] = migrationRecords(new Database(f, { readonly: true }));
    expect(rec).toMatchObject({
      kind: 'MIGRATE', operator: 'rhys', schema_before: fpBefore, schema_after: expectedAfter,
      integrity_check: 'ok', code_manifest: s.code.manifest,
    });
    expect(JSON.parse(rec.changes)).toEqual(expect.arrayContaining(['+ table representatives', '~ table players']));
    expect(rec.started_at).toBeTruthy();
    expect(rec.finished_at).toBeTruthy();

    // The backup is the database exactly as it was.
    expect(sha(rec.backup_path)).toBe(before);
    expect(rec.backup_sha256).toBe(before);

    // Existing rows: identical apart from the new NULL column.
    const after = contentHashes(f);
    for (const [t, h] of Object.entries(rowsBefore)) if (t !== 'players') expect(after[t], t).toBe(h);
    const playersAfter = players(f);
    expect(playersAfter).toHaveLength(2);
    playersBefore.forEach((row, i) => { for (const [k, v] of Object.entries(row)) expect(playersAfter[i][k], k).toEqual(v); });
    expect(playersAfter.every((x) => x.preferred_states === null)).toBe(true);

    // And now the incident import simply works.
    expect(importIn({ RECRUITMATCH_DB: f }, [RECIPIENT_SELECTION]).status).toBe(0);
    // Running again is a no-op that needs no approval.
    const again = cli('--db', f);
    expect(again.status).toBe(0);
  });

  it('refuses while another process holds the database', async () => {
    const f = behindDb(p('behind.sqlite'));
    const holder = spawn(process.execPath, ['-e', `
      const D = require('better-sqlite3'); const db = new D(${JSON.stringify(f)});
      db.prepare('SELECT COUNT(*) FROM players').get(); console.log('HOLDING'); setTimeout(() => {}, 30000);`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: ':memory:' } });
    await new Promise((r) => holder.stdout.on('data', (d) => /HOLDING/.test(d) && r()));
    try {
      expect(() => migrateDatabase({ dbPath: f, approve: stateOf(f).fingerprint, ...quiet })).toThrow(/another process has it open/);
    } finally { holder.kill('SIGKILL'); }
    expect(stateOf(f).state).toBe('PENDING');
  });

  it('--create initialises a new file only with the empty-database approval', () => {
    expect(cli('--db', p('new.sqlite'), '--create').status).toBe(2);
    expect(fs.existsSync(p('new.sqlite'))).toBe(false);
    const r = cli('--db', p('new.sqlite'), '--create', '--approve', EMPTY);
    expect(r.status, r.stderr).toBe(0);
    expect(stateOf(p('new.sqlite'))).toMatchObject({ state: 'CURRENT', latest: { kind: 'CREATE', backup_path: null } });
  });
});

describe('(e) a failing migration step rolls the transactional part back', () => {
  it('a duplicate public_slug makes the unique index fail AFTER schema.sql and an ADD COLUMN ran: all of it is undone', () => {
    const f = behindDb(p('behind.sqlite'));
    const db = new Database(f);
    db.exec("DROP INDEX idx_players_public_slug; UPDATE players SET public_slug = 'same';");
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    const fp = fingerprintOf(f);
    const rows = contentHashes(f);
    const before = sha(f);

    let err;
    try { migrateDatabase({ dbPath: f, approve: fp, ...quiet }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(MigrationRefused);
    expect(err.message).toMatch(/MIGRATION FAILED \(TRANSACTIONAL\)/);
    expect(err.message).toMatch(/UNIQUE/);
    expect(err.message).toMatch(/The transaction rolled back: the database is unchanged/);
    expect(err.message).toMatch(/ROLLBACK/);

    expect(fingerprintOf(f)).toBe(fp);                         // no representatives, no preferred_states
    expect(tables(f)).not.toContain('representatives');
    expect(tables(f)).not.toContain(MIGRATIONS_TABLE);         // a failed run records nothing in the database
    expect(columns(f, 'players')).not.toContain('preferred_states');
    expect(contentHashes(f)).toEqual(rows);
    expect(sha(err.backup.path)).toBe(before);                 // and the backup was taken first
  });
});

describe('(f) READ-ONLY mode never writes', () => {
  it.each([['behind', behindDb], ['current', currentDb]])('a %s copy: byte-identical, writes refused, no schema work', (_, make) => {
    const f = make(p('copy.sqlite'));
    const before = sha(f);
    const r = importIn({ RECRUITMATCH_DB: f, RECRUITMATCH_DB_READONLY: '1' }, [CLIENT],
      "try { db.exec('CREATE TABLE probe (x)'); out.write = 'ALLOWED'; } catch { out.write = 'REFUSED'; }");
    expect(r.status, r.err).toBe(0);
    expect(r.out.write).toBe('REFUSED');
    expect(sha(f)).toBe(before);
  });
});

describe('(g) :memory: still migrates on import — the test suite\'s private database', () => {
  it('the client in this very process has the full schema, and no audit table', async () => {
    expect(process.env.RECRUITMATCH_DB).toBe(':memory:');
    const db = (await import('./client.js')).default;
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();
    expect(names).toEqual(expect.arrayContaining(['players', 'representatives', 'programme_contacts']));
    expect(db.prepare('PRAGMA table_info(players)').all().map((c) => c.name)).toContain('preferred_states');
    expect(names).not.toContain(MIGRATIONS_TABLE);
  });
});

describe('(h) adopting a database that is already migrated records it and changes nothing else', () => {
  it('ADOPT: one audit row; schema and every row untouched; the server may then start', () => {
    const f = unrecordedDb(p('db.sqlite'));
    const fp = fingerprintOf(f);
    const rows = contentHashes(f);
    expect(stateOf(f).state).toBe('UNRECORDED');

    const r = cli('--db', f, '--adopt', '--approve', fp);
    expect(r.status, r.stderr).toBe(0);
    expect(fingerprintOf(f)).toBe(fp);
    expect(contentHashes(f)).toEqual(rows);
    const s = stateOf(f);
    expect(s.state).toBe('CURRENT');
    expect(s.latest).toMatchObject({ kind: 'ADOPT', schema_before: fp, schema_after: fp, rows_written: 0, changes: '[]' });
    expect(serverMayStart(s)).toBe(true);
  });

  it('refuses to adopt a database with pending migrations', () => {
    const f = behindDb(p('behind.sqlite'));
    const before = sha(f);
    const r = cli('--db', f, '--adopt', '--approve', fingerprintOf(f));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Refusing to adopt/);
    expect(sha(f)).toBe(before);
  });
});

describe('a code rollback to a version this database has already been migrated by still boots', () => {
  it('UNRECORDED + this code in the recorded history → the server may start; never recorded → it may not', () => {
    const f = currentDb(p('db.sqlite'));
    const db = new Database(f);
    // A later deploy (different code) migrated it and recorded itself; nothing schema-level changed.
    const rec = db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE}`).get();
    db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (${Object.keys(rec).filter((k) => k !== 'id').join(', ')})
      SELECT ${Object.keys(rec).filter((k) => k !== 'id').map((k) => (k === 'code_manifest' ? "'later-code'" : k)).join(', ')} FROM ${MIGRATIONS_TABLE}`).run();
    db.close();
    const rolledBack = stateOf(f);
    expect(rolledBack).toMatchObject({ state: 'UNRECORDED', knownCode: true });
    expect(serverMayStart(rolledBack)).toBe(true);

    const g = unrecordedDb(p('never.sqlite'));
    expect(serverMayStart(stateOf(g))).toBe(false);
  });
});
