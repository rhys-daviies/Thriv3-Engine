/**
 * The client's READ-ONLY MODE (RECRUITMATCH_DB_READONLY=1): no start-up write of
 * any kind reaches the file. Each case runs in a child process, because this
 * process has already imported the client against its test database.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { migratedDbFile } from '../testMigratedDb.js';

let dir;
const p = (n) => path.join(dir, n);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** Import the client in a fresh process and report what it did. */
function importClient(env, script = '') {
  const code = `
    const c = await import(${JSON.stringify(path.resolve('server/db/client.js'))});
    const db = c.default;
    const out = { readOnly: c.readOnly, connReadonly: db.readonly, queryOnly: db.pragma('query_only', { simple: true }),
      tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").pluck().all() };
    try { db.prepare("CREATE TABLE IF NOT EXISTS t_write_probe (x)").run(); out.write = 'ALLOWED'; } catch (e) { out.write = e.code || e.message; }
    ${script}
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').pop()) : null, err: r.stderr };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-ro-'));
  // An UNMIGRATED database: if schema.sql or migrate() ran, tables would appear.
  const d = new Database(p('copy.sqlite'));
  d.exec("CREATE TABLE coaches (id TEXT PRIMARY KEY, email TEXT); INSERT INTO coaches VALUES ('c1', 'a@b.example');");
  d.close();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('read-only mode', () => {
  it('runs no schema.sql and no migrate(): an unmigrated file stays unmigrated, byte for byte', () => {
    const before = sha(p('copy.sqlite'));
    const r = importClient({ RECRUITMATCH_DB: p('copy.sqlite'), RECRUITMATCH_DB_READONLY: '1' });
    expect(r.status, r.err).toBe(0);
    expect(r.out.tables).toEqual(['coaches']);
    expect(sha(p('copy.sqlite'))).toBe(before);
    expect(fs.existsSync(p('copy.sqlite-wal'))).toBe(false);   // no journal-mode switch to WAL
  });

  it('the connection is read-only at the SQLite level and query_only, so any write is refused', () => {
    const r = importClient({ RECRUITMATCH_DB: p('copy.sqlite'), RECRUITMATCH_DB_READONLY: '1' });
    expect(r.out).toMatchObject({ readOnly: true, connReadonly: true, queryOnly: 1 });
    expect(r.out.write).not.toBe('ALLOWED');
  });

  it('a module that writes at import time is refused, not obeyed', () => {
    const r = importClient({ RECRUITMATCH_DB: p('copy.sqlite'), RECRUITMATCH_DB_READONLY: '1' },
      "try { db.exec('INSERT INTO coaches VALUES (\\'c2\\', \\'x@y.example\\')'); out.importWrite = 'ALLOWED'; } catch (e) { out.importWrite = 'REFUSED'; }");
    expect(r.out.importWrite).toBe('REFUSED');
    expect(new Database(p('copy.sqlite'), { readonly: true }).prepare('SELECT COUNT(*) n FROM coaches').get().n).toBe(1);
  });

  it('needs an explicit file: it will not apply to an unset path or to :memory:', () => {
    expect(importClient({ RECRUITMATCH_DB: ':memory:', RECRUITMATCH_DB_READONLY: '1' }).status).not.toBe(0);
    expect(importClient({ RECRUITMATCH_DB: '', RECRUITMATCH_DB_READONLY: '1' }).status).not.toBe(0);
  });

  it('will not create a missing file', () => {
    const r = importClient({ RECRUITMATCH_DB: p('absent.sqlite'), RECRUITMATCH_DB_READONLY: '1' });
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(p('absent.sqlite'))).toBe(false);
  });

  /*
   * DI-08 changed the other half of this contract: without the flag a FILE is no longer created or
   * migrated on import either (server/db/explicitMigrations.test.js covers that in full). What stays
   * true is that the flag is what makes the connection read-only: an initialised file opened without
   * it is read-write.
   */
  it('without the flag a missing file is refused, not created; an initialised one opens read-write', () => {
    const missing = importClient({ RECRUITMATCH_DB: p('fresh.sqlite'), RECRUITMATCH_DB_READONLY: '' });
    expect(missing.status).not.toBe(0);
    expect(fs.existsSync(p('fresh.sqlite'))).toBe(false);

    const r = importClient({ RECRUITMATCH_DB: migratedDbFile(p('fresh.sqlite')), RECRUITMATCH_DB_READONLY: '' });
    expect(r.status, r.err).toBe(0);
    expect(r.out.readOnly).toBe(false);
    expect(r.out.tables.length).toBeGreaterThan(20);
    expect(r.out.write).toBe('ALLOWED');
  });
});
