import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { defaultDbPath, checkoutRoot } from './db/corpusIdentity.js';
import { isWorkingDatabase } from './testDbGuard.js';

/**
 * The guard is exercised against the REAL working path, because that is the
 * only path it exists for. Every refusal is checked twice: the guard must be
 * installed BEFORE the attempt (so a broken guard fails here instead of opening
 * the file), and the file's size and mtime must be unchanged after it.
 */

const WORKING = defaultDbPath;
const fingerprint = () => {
  try { const s = fs.statSync(WORKING); return `${s.size}:${s.mtimeMs}`; } catch { return 'absent'; }
};
const assertGuardInstalled = () => expect(String(Database)).toContain("refuse('open'");

let dir;
let before;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-db-guard-'));
  before = fingerprint();
});
afterEach(() => {
  expect(fingerprint()).toBe(before);
  expect(fs.existsSync(`${WORKING}-wal`) && fs.statSync(`${WORKING}-wal`).size > 0).toBe(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('isWorkingDatabase — every spelling of the working path', () => {
  it.each([
    ['the absolute path', () => WORKING],
    ['a relative path', () => path.relative(process.cwd(), WORKING)],
    ['a path through ..', () => path.join(path.dirname(WORKING), '..', 'data', path.basename(WORKING))],
    ['surrounding whitespace', () => `  ${WORKING}  `],
  ])('recognises %s', (_, p) => expect(isWorkingDatabase(p())).toBe(true));

  it('recognises another case where the filesystem ignores case', () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return;
    expect(isWorkingDatabase(WORKING.toUpperCase())).toBe(true);
  });

  it('recognises a symlink to it', () => {
    const link = path.join(dir, 'link.sqlite');
    fs.symlinkSync(WORKING, link);
    expect(isWorkingDatabase(link)).toBe(true);
  });

  // Stand-ins that do NOT exist, as the working database does not in a clean
  // checkout, CI or a worktree — where realpath cannot resolve a link to it.
  it('recognises a dangling symlink to an absent database (checked against a stand-in)', () => {
    const absent = path.join(dir, 'data', 'working.sqlite');
    fs.mkdirSync(path.dirname(absent));
    const link = path.join(dir, 'link.sqlite');
    fs.symlinkSync(absent, link);
    expect(isWorkingDatabase(link, absent)).toBe(true);
    expect(fs.existsSync(absent)).toBe(false);
  });

  it('resolves a relative link target against the real parent, reached through a symlinked directory', () => {
    // real/sub/l1 -> ../data/working.sqlite means real/data/working.sqlite,
    // even when reached as linkdir/l1 with linkdir -> real/sub.
    const absent = path.join(dir, 'real', 'data', 'working.sqlite');
    fs.mkdirSync(path.dirname(absent), { recursive: true });
    fs.mkdirSync(path.join(dir, 'real', 'sub'));
    fs.symlinkSync('../data/working.sqlite', path.join(dir, 'real', 'sub', 'l1'));
    fs.symlinkSync(path.join(dir, 'real', 'sub'), path.join(dir, 'linkdir'));
    expect(isWorkingDatabase(path.join(dir, 'linkdir', 'l1'), absent)).toBe(true);
  });

  it('recognises a hard link to it (checked against a stand-in, not the real file)', () => {
    const standIn = path.join(dir, 'working.sqlite');
    fs.writeFileSync(standIn, 'x');
    const hard = path.join(dir, 'hard.sqlite');
    fs.linkSync(standIn, hard);
    expect(isWorkingDatabase(hard, standIn)).toBe(true);
  });

  it.each([
    [':memory:'], [''], ['   '], [`${WORKING}.snapshot-x`], [path.join(os.tmpdir(), 'x.sqlite')],
  ])('leaves %j alone', (p) => expect(isWorkingDatabase(p)).toBe(false));

  it('leaves a Buffer (a serialized in-memory database) alone', () => {
    expect(isWorkingDatabase(Buffer.from(''))).toBe(false);
  });
});

describe('in a test worker', () => {
  it.each([
    ['writable', undefined],
    ['read-only', { readonly: true, fileMustExist: true }],
  ])('refuses to open the working database %s', (_, options) => {
    assertGuardInstalled();
    expect(() => new Database(WORKING, options)).toThrow(expect.objectContaining({ code: 'WORKING_DB_IN_TEST' }));
  });

  it('refuses it through a relative path and through a symlink', () => {
    assertGuardInstalled();
    const link = path.join(dir, 'link.sqlite');
    fs.symlinkSync(WORKING, link);
    expect(() => new Database(path.relative(process.cwd(), WORKING))).toThrow(/working database/);
    expect(() => new Database(link)).toThrow(/working database/);
  });

  it('refuses a backup INTO the working database', () => {
    assertGuardInstalled();
    const db = new Database(':memory:');
    expect(() => db.backup(WORKING)).toThrow(expect.objectContaining({ code: 'WORKING_DB_IN_TEST' }));
    db.close();
  });

  it('still opens everything else', () => {
    const file = path.join(dir, 'ok.sqlite');
    const db = new Database(file);
    db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1)');
    expect(db.prepare('SELECT x FROM t').get().x).toBe(1);
    expect(db).toBeInstanceOf(Database);
    db.close();
    expect(new Database(':memory:').prepare('SELECT 1 v').get().v).toBe(1);
  });
});

describe('in a child process', () => {
  /** A real script file, so client.js's own `node -e` refusal is not what answers. */
  const bootClient = (env) => {
    const script = path.join(dir, 'boot.mjs');
    fs.writeFileSync(script, `await import(${JSON.stringify(pathToFileURL(path.join(checkoutRoot, 'server/db/client.js')).href)});\n`
      + "console.log('OPENED');\n");
    return spawnSync(process.execPath, [script], { cwd: checkoutRoot, env, encoding: 'utf8' });
  };

  it('inherits the guard through NODE_OPTIONS', () => {
    expect(process.env.NODE_OPTIONS).toContain('testDbGuard.js');
  });

  it('refuses when RECRUITMATCH_DB is missing and client.js falls back to the working database', () => {
    expect(process.env.NODE_OPTIONS).toContain('testDbGuard.js');
    const env = { ...process.env };
    delete env.RECRUITMATCH_DB;
    const r = bootClient(env);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('OPENED');
    expect(r.stderr).toContain('WORKING_DB_IN_TEST');
  });

  it('refuses when RECRUITMATCH_DB names the working database', () => {
    expect(process.env.NODE_OPTIONS).toContain('testDbGuard.js');
    const r = bootClient({ ...process.env, RECRUITMATCH_DB: path.relative(checkoutRoot, WORKING) });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('WORKING_DB_IN_TEST');
  });

  it('boots normally against anything else', () => {
    const r = bootClient({ ...process.env, RECRUITMATCH_DB: path.join(dir, 'child.sqlite') });
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('OPENED');
  });

  it('is not installed outside the test run', () => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import D from 'better-sqlite3'; console.log(String(D).includes('refuse') ? 'GUARDED' : 'PLAIN')"],
    { cwd: checkoutRoot, env, encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('PLAIN');
  });
});
