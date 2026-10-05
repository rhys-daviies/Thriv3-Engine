import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import setup, { assertRunDir, sweepAbandoned, runDirName, takeWorkingCopy, WORKING_COPY } from './testScratch.js';
import { workingCorpusCopy } from './testCorpus.js';
import { isWorkingDatabase } from './testDbGuard.js';

let root;
let kind;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-scratch-test-'));
  kind = path.join(root, 'node_modules/.tmp/thriv3-test-build');
  fs.mkdirSync(kind, { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

describe('assertRunDir — the only paths this module will delete', () => {
  it('accepts a run directory under node_modules/.tmp/<kind>', () => {
    const dir = path.join(kind, runDirName(123, 456));
    expect(assertRunDir(dir)).toBe(dir);
    expect(assertRunDir(path.join(root, 'node_modules/.tmp/thriv3-test-uploads/run-1-2'))).toBeTruthy();
  });

  it.each([
    ['the kind directory itself', () => kind],
    ['node_modules/.tmp', () => path.dirname(kind)],
    ['a non-run name', () => path.join(kind, 'p')],
    ['an unknown kind', () => path.join(root, 'node_modules/.tmp/other/run-1-2')],
    ['outside node_modules/.tmp', () => path.join(root, 'build/thriv3-test-build/run-1-2')],
    ['the working database directory', () => path.join(root, 'server/data/run-1-2')],
    ['an escape through ..', () => path.join(kind, 'run-1-2', '..', '..')],
    ['an empty path', () => ''],
    ['undefined', () => undefined],
  ])('refuses %s', (_, dir) => {
    expect(() => assertRunDir(dir())).toThrow(/Refusing/);
  });
});

describe('sweepAbandoned', () => {
  it('removes runs whose process has exited, and nothing else', () => {
    const dead = path.join(kind, runDirName(deadPid(), 1));
    const live = path.join(kind, runDirName(process.pid, 2));
    const other = path.join(kind, 'p');
    for (const d of [dead, live, other]) fs.mkdirSync(path.join(d, 'p'), { recursive: true });

    expect(sweepAbandoned(kind)).toEqual([dead]);
    expect(fs.existsSync(dead)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
  });

  it('is a no-op when the directory does not exist yet', () => {
    expect(sweepAbandoned(path.join(root, 'missing'))).toEqual([]);
  });
});

/** A stand-in "working database" with real rows — never the real one. */
const fakeWorking = (rows = 3) => {
  const file = path.join(root, 'fake-working.sqlite');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (x)');
  db.exec(`INSERT INTO t VALUES ${Array.from({ length: rows }, (_, i) => `(${i})`).join(',')}`);
  // Pad past the 1 MB floor that tells a real corpus from a bare schema.
  db.exec("CREATE TABLE pad (b); INSERT INTO pad VALUES (zeroblob(1100000))");
  db.pragma('wal_checkpoint(TRUNCATE)');
  return { file, db };
};

const envFor = (n) => ({
  THRIV3_BUILD_DIR: path.join(kind, runDirName(process.pid, n)),
  THRIV3_UPLOADS_DIR: path.join(root, 'node_modules/.tmp/thriv3-test-uploads', runDirName(process.pid, n)),
  THRIV3_TEST_DB_DIR: path.join(root, 'node_modules/.tmp/thriv3-test-db', runDirName(process.pid, n)),
});

describe('the globalSetup', () => {
  it('removes its own run directories at teardown, files and all', () => {
    const env = envFor(10);
    const { file, db } = fakeWorking();
    db.close();
    const teardown = setup({ config: { env } }, { working: file });
    fs.mkdirSync(path.join(env.THRIV3_BUILD_DIR, 'p'), { recursive: true });
    fs.writeFileSync(path.join(env.THRIV3_BUILD_DIR, 'p', 'abc.html'), 'x');
    fs.mkdirSync(env.THRIV3_UPLOADS_DIR, { recursive: true });
    expect(fs.existsSync(path.join(env.THRIV3_TEST_DB_DIR, WORKING_COPY))).toBe(true);

    teardown();
    for (const dir of Object.values(env)) expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(kind)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('refuses to start against a directory that is not a run directory', () => {
    expect(() => setup({ config: { env: { ...envFor(11), THRIV3_TEST_DB_DIR: kind } } })).toThrow(/Refusing/);
    expect(() => setup({ config: { env: { THRIV3_BUILD_DIR: kind, THRIV3_UPLOADS_DIR: kind } } })).toThrow(/Refusing/);
  });
});

describe('takeWorkingCopy', () => {
  it('copies the working database into the run, read-only, with its WAL folded in', () => {
    const { file, db } = fakeWorking(5);
    db.pragma('wal_autocheckpoint = 0');
    db.exec('INSERT INTO t VALUES (99)'); // committed, and still only in the -wal
    expect(fs.statSync(`${file}-wal`).size).toBeGreaterThan(0);
    const before = fs.readFileSync(file);

    const dir = envFor(12).THRIV3_TEST_DB_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const copy = takeWorkingCopy(dir, file);

    expect(copy).toBe(path.join(dir, WORKING_COPY));
    expect(fs.statSync(copy).mode & 0o777).toBe(0o444);
    expect(fs.existsSync(`${copy}-wal`)).toBe(false);
    const c = new Database(copy, { readonly: true });
    expect(c.prepare('SELECT COUNT(*) n FROM t').get().n).toBe(6);
    c.close();
    // The source is read, never written.
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    db.close();
  });

  it('takes nothing when there is no working database, or only a bare one', () => {
    const dir = envFor(13).THRIV3_TEST_DB_DIR;
    fs.mkdirSync(dir, { recursive: true });
    expect(takeWorkingCopy(dir, path.join(root, 'absent.sqlite'))).toBeNull();
    const bare = path.join(root, 'bare.sqlite');
    new Database(bare).exec('CREATE TABLE t (x)');
    expect(takeWorkingCopy(dir, bare)).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('workingCorpusCopy — this run', () => {
  it('hands each caller its own writable clone of the run copy, never the working database', () => {
    const runCopy = path.join(process.env.THRIV3_TEST_DB_DIR, WORKING_COPY);
    if (!fs.existsSync(runCopy)) return; // no working database on this machine
    const a = workingCorpusCopy('scratch-test');
    const b = workingCorpusCopy('scratch-test');
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(process.env.THRIV3_TEST_DB_DIR);
    expect(isWorkingDatabase(a)).toBe(false);

    const before = fs.statSync(runCopy).mtimeMs;
    const db = new Database(a);
    db.exec('CREATE TABLE phase15_probe (x)');
    db.close();
    expect(fs.statSync(runCopy).mtimeMs).toBe(before);
    const other = new Database(b, { readonly: true });
    expect(other.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'phase15_probe'").get().n).toBe(0);
    other.close();
  });
});
