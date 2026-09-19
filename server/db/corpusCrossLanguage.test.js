import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotDatabase } from '../lib/dbSnapshot.js';
import { fileCorpusOr, resolveDbPath, defaultDbPath } from './corpusIdentity.js';

/**
 * L7ZO — the corpus contract has to be true in BOTH languages.
 *
 * L7ZM made the JavaScript honest about which database it was on. It did not
 * reach the nine Python tools, which between them named an absolute path on one
 * machine, built paths from the current working directory, and honoured no
 * override at all — so a stage that pointed the toolchain at a snapshot still
 * had its Python half reading, and in two cases writing, canonical.
 *
 * These tests use two DISTINGUISHABLE fixtures and assert that every reader
 * lands on the one that was selected. A fixture that is merely valid would
 * prove nothing: B carries a marker A does not, so observing B is positive
 * evidence rather than the absence of a crash.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const TOOLS = path.join(ROOT, 'tools');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'l7zo-'));

/** A corpus with one row naming itself, so "which did you read" has an answer. */
function fixture(marker) {
  const file = path.join(tmp(), `${marker}.sqlite`);
  const db = new Database(file);
  /*
   * NOT in WAL mode, deliberately. A strict `mode=ro` open — how the read-only
   * Python tools connect — cannot create the shared-memory file a WAL database
   * needs, and even `wal_checkpoint(TRUNCATE)` leaves a zero-length `-wal`
   * that is enough to make the open fail. Canonical never hits this because
   * something is always attached to it, keeping its `-shm` alive. The WAL case
   * is exercised below on a fixture of its own.
   */
  db.exec('CREATE TABLE colleges (id INTEGER PRIMARY KEY, name TEXT, soccer_score REAL)');
  db.prepare('INSERT INTO colleges (name, soccer_score) VALUES (?, ?)').run(marker, 1);
  db.close();
  return file;
}

const py = (code, env = {}) => execFileSync('python3', ['-c', code], {
  cwd: TOOLS, encoding: 'utf8', env: { ...process.env, ...env },
}).trim();

let A; let B;
beforeAll(() => { A = fixture('CORPUS_A_CANONICAL'); B = fixture('CORPUS_B_STAGE'); });

describe('L7ZO — one override, honoured in both languages', () => {
  it('python resolves RECRUITMATCH_DB, and falls back to its own checkout', () => {
    expect(py('import corpus;print(corpus.resolve_db())', { RECRUITMATCH_DB: B })).toBe(B);
    const fallback = py('import corpus;print(corpus.resolve_db())', { RECRUITMATCH_DB: '' });
    expect(fallback).toBe(path.join(ROOT, 'server/data/recruitmatch.sqlite'));
  });

  it('javascript resolves it the same way, without opening anything', () => {
    expect(resolveDbPath({ RECRUITMATCH_DB: B })).toBe(B);
    expect(resolveDbPath({})).toBe(defaultDbPath);
  });

  it('A PYTHON READER OBSERVES B, never A', () => {
    /* The whole point: selection reaches the other language end to end. */
    const read = py(
      'import corpus,sqlite3;'
      + 'db=sqlite3.connect(corpus.read_only_uri(corpus.resolve_db()),uri=True);'
      + 'print(db.execute("SELECT name FROM colleges").fetchone()[0])',
      { RECRUITMATCH_DB: B },
    );
    expect(read).toBe('CORPUS_B_STAGE');
    expect(read).not.toBe('CORPUS_A_CANONICAL');
  });

  it('a python tool run from ANY directory reads the selected corpus', () => {
    /*
     * Four tools built `file:server/data/recruitmatch.sqlite?mode=ro` from the
     * process's working directory, so the answer depended on where the operator
     * was standing. Run from /tmp, that resolved to nothing at all.
     */
    const out = execFileSync('python3', ['-c',
      'import sys;sys.path.insert(0,"' + TOOLS + '");'
      + 'import corpus,sqlite3;'
      + 'db=sqlite3.connect(corpus.read_only_uri(corpus.resolve_db()),uri=True);'
      + 'print(db.execute("SELECT name FROM colleges").fetchone()[0])'],
    { cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, RECRUITMATCH_DB: B } }).trim();
    expect(out).toBe('CORPUS_B_STAGE');
  });

  it(':memory: is not a corpus a subprocess suite can read, so it falls through', () => {
    /* vitest sets it for every file; that is a default, not a selection. */
    expect(fileCorpusOr('/fallback.sqlite', { RECRUITMATCH_DB: ':memory:' })).toBe('/fallback.sqlite');
    expect(fileCorpusOr('/fallback.sqlite', { RECRUITMATCH_DB: B })).toBe(B);
    expect(fileCorpusOr('/fallback.sqlite', {})).toBe('/fallback.sqlite');
  });
});

describe('L7ZO — the python canonical-write contract', () => {
  const guard = (extra) => py(
    'import corpus,sys\n'
    + 'try:\n'
    + '    corpus.assert_canonical_write("fix_scores.py", corpus.resolve_db(), argv=sys.argv)\n'
    + '    print("ALLOWED")\n'
    + 'except SystemExit as e:\n'
    + '    print("REFUSED" if "CANONICAL_WRITE_REFUSED" in str(e) else "OTHER")\n',
    extra,
  );

  it('REFUSES a write to a corpus outside this checkout', () => {
    expect(guard({ RECRUITMATCH_DB: B })).toBe('REFUSED');
  });

  it('allows it once the caller says so, and on a declared snapshot', () => {
    expect(py(
      'import corpus;corpus.assert_canonical_write("x", corpus.resolve_db(), argv=["--canonical"]);print("ALLOWED")',
      { RECRUITMATCH_DB: B },
    )).toBe('ALLOWED');
    expect(py(
      'import corpus;corpus.assert_canonical_write("x", corpus.resolve_db(), argv=[]);print("ALLOWED")',
      { RECRUITMATCH_DB: B, THRIV3_CORPUS: 'snapshot' },
    )).toBe('ALLOWED');
  });

  it('uses the same vocabulary as the javascript refusal', () => {
    const out = py(
      'import corpus,sys\n'
      + 'try:\n'
      + '    corpus.assert_canonical_write("fix_scores.py", corpus.resolve_db(), argv=[])\n'
      + 'except SystemExit as e:\n'
      + '    print(str(e))\n',
      { RECRUITMATCH_DB: B },
    );
    expect(out).toContain('CANONICAL_WRITE_REFUSED');
    expect(out).toContain('--canonical');
    expect(out).toContain('RECRUITMATCH_DB');
  });
});

describe('L7ZO — a snapshot is taken of the corpus that was selected', () => {
  it('snapshots B when B is selected, not the checkout default', () => {
    const dest = path.join(tmp(), 'stage.sqlite');
    snapshotDatabase(resolveDbPath({ RECRUITMATCH_DB: B }), dest, { overwrite: true });
    const db = new Database(dest, { readonly: true });
    expect(db.prepare('SELECT name FROM colleges').get().name).toBe('CORPUS_B_STAGE');
    db.close();
  });

  it('still carries rows committed to the WAL but not checkpointed', () => {
    const src = fixture('WAL_FIXTURE');
    const w = new Database(src);
    w.pragma('journal_mode = WAL');
    w.prepare('INSERT INTO colleges (name, soccer_score) VALUES (?, ?)').run('IN_WAL', 2);
    expect(fs.existsSync(`${src}-wal`)).toBe(true);
    const dest = path.join(tmp(), 'wal.sqlite');
    snapshotDatabase(src, dest, { overwrite: true });
    const db = new Database(dest, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) n FROM colleges WHERE name = 'IN_WAL'").get().n).toBe(1);
    db.close(); w.close();
  });
});
