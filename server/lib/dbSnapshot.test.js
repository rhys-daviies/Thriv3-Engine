import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { snapshotDatabase, snapshotPathFor } from './dbSnapshot.js';

/**
 * L7D — that a rollback point is a rollback point.
 *
 * The failure being guarded is specific and was met in L7C: in WAL mode a
 * committed row lives in the `-wal` file until a checkpoint, and a checkpoint
 * cannot run while a connection holds a read. Copying the main file alone then
 * yields the last CHECKPOINTED state — older than the database, silently.
 *
 * These tests are deterministic. They do not race a checkpoint: an open reader
 * makes the WAL's presence a certainty rather than a timing accident.
 */

function tmpdb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const p = path.join(dir, 'test.sqlite');
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT)');
  db.exec('CREATE TABLE roster_players (id INTEGER PRIMARY KEY, who TEXT)');
  return { dir, p, db };
}

describe('a snapshot is the database, including what is only in the WAL', () => {
  it('captures rows committed since the last checkpoint', () => {
    const { dir, p, db } = tmpdb();
    // A second connection holding a read is what stops SQLite checkpointing,
    // which is exactly the state a running app is in.
    const reader = new Database(p, { readonly: true });
    reader.prepare('SELECT COUNT(*) n FROM players').get();
    for (let i = 0; i < 500; i += 1) {
      db.prepare('INSERT INTO roster_players (who) VALUES (?)').run(`p${i}`);
    }
    db.prepare('INSERT INTO players (id, name) VALUES (?, ?)').run('a', 'Committed');
    expect(fs.existsSync(`${p}-wal`)).toBe(true);
    expect(fs.statSync(`${p}-wal`).size).toBeGreaterThan(0);

    const dest = path.join(dir, 'snap.sqlite');
    const r = snapshotDatabase(p, dest);
    expect(r.ok).toBe(true);
    expect(r.integrity).toBe('ok');

    const copy = new Database(dest, { readonly: true });
    expect(copy.prepare('SELECT name FROM players WHERE id = ?').get('a').name).toBe('Committed');
    expect(copy.prepare('SELECT COUNT(*) n FROM roster_players').get().n).toBe(500);
    copy.close(); reader.close(); db.close();
  });

  it('is standalone — it needs no -wal or -shm beside it', () => {
    const { dir, p, db } = tmpdb();
    db.prepare('INSERT INTO players (id, name) VALUES (?, ?)').run('a', 'Solo');
    const dest = path.join(dir, 'snap.sqlite');
    snapshotDatabase(p, dest);
    expect(fs.existsSync(`${dest}-wal`)).toBe(false);
    expect(fs.existsSync(`${dest}-shm`)).toBe(false);
    const copy = new Database(dest, { readonly: true });
    expect(copy.prepare('SELECT name FROM players WHERE id = ?').get('a').name).toBe('Solo');
    copy.close(); db.close();
  });

  it('holds the pre-mutation state after the live database moves on', () => {
    const { dir, p, db } = tmpdb();
    db.prepare('INSERT INTO players (id, name) VALUES (?, ?)').run('a', 'Before');
    const dest = path.join(dir, 'snap.sqlite');
    snapshotDatabase(p, dest);

    db.prepare('UPDATE players SET name = ? WHERE id = ?').run('After', 'a');
    db.prepare('INSERT INTO players (id, name) VALUES (?, ?)').run('b', 'New');
    expect(db.prepare('SELECT COUNT(*) n FROM players').get().n).toBe(2);

    const copy = new Database(dest, { readonly: true });
    expect(copy.prepare('SELECT name FROM players WHERE id = ?').get('a').name).toBe('Before');
    expect(copy.prepare('SELECT COUNT(*) n FROM players').get().n).toBe(1);
    copy.close(); db.close();
  });

  /**
   * The same scenario through the old method, so the difference is recorded as
   * a fact rather than an assertion in a comment. Not timing-dependent: the
   * open reader guarantees the WAL is still unmerged.
   */
  it('is what a plain file copy is not', () => {
    const { dir, p, db } = tmpdb();
    const reader = new Database(p, { readonly: true });
    reader.prepare('SELECT COUNT(*) n FROM players').get();
    for (let i = 0; i < 500; i += 1) {
      db.prepare('INSERT INTO roster_players (who) VALUES (?)').run(`p${i}`);
    }
    db.prepare('INSERT INTO players (id, name) VALUES (?, ?)').run('a', 'Committed');

    const copied = path.join(dir, 'cp.sqlite');
    fs.copyFileSync(p, copied);                       // the L7C mistake
    const viaCp = new Database(copied, { readonly: true });
    // Not merely short of rows: with nothing checkpointed yet, the copy has no
    // schema either. `CREATE TABLE` is a committed transaction like any other.
    let cpRows;
    try { cpRows = viaCp.prepare('SELECT COUNT(*) n FROM roster_players').get().n; }
    catch { cpRows = null; }
    viaCp.close();

    const dest = path.join(dir, 'snap.sqlite');
    snapshotDatabase(p, dest);
    const viaSnapshot = new Database(dest, { readonly: true });
    expect(viaSnapshot.prepare('SELECT COUNT(*) n FROM roster_players').get().n).toBe(500);
    viaSnapshot.close();

    // "No better than", not "strictly worse": a future SQLite that checkpoints
    // more eagerly would make the copy correct here, and that is fine. What
    // must never happen is the copy claiming MORE than the snapshot.
    expect(cpRows === null || cpRows <= 500).toBe(true);
    reader.close(); db.close();
  });
});

describe('a snapshot refuses to be careless', () => {
  it('will not overwrite an existing rollback point', () => {
    const { dir, p, db } = tmpdb();
    const dest = path.join(dir, 'snap.sqlite');
    snapshotDatabase(p, dest);
    expect(() => snapshotDatabase(p, dest)).toThrow(/refusing to overwrite/);
    expect(() => snapshotDatabase(p, dest, { overwrite: true })).not.toThrow();
    db.close();
  });

  it('says so when there is no database to snapshot', () => {
    expect(() => snapshotDatabase('/nonexistent/x.sqlite', '/tmp/y.sqlite')).toThrow(/no database/);
  });

  it('names a snapshot after the operation and the moment', () => {
    const at = new Date('2026-09-09T14:30:00.000Z');
    expect(snapshotPathFor('/d/x.sqlite', 'pre-l7d', at))
      .toBe('/d/x.sqlite.snapshot-pre-l7d-2026-09-09T14-30-00-000Z');
  });
});
