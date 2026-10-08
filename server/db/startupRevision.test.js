/**
 * A BOOT THAT CHANGES NO DATA MUST NOT MOVE `corpus_revision`.
 *
 * The revision is the cheap "could the V2 corpus have changed?" signal
 * (corpusIdentity.js): triggers bump it on every INSERT/UPDATE/DELETE row of
 * colleges, roster_players and recruiting_arrivals. A startup migration that
 * rewrites rows with the values they already hold still fires those triggers,
 * and every boot then looked like a 28-row corpus write. Found 2026-10-09 on a
 * copy of the dev corpus: 1072173 -> 1072201 -> 1072229 with nothing changed.
 *
 * The other half is asserted too: a boot that DOES change corpus data still
 * moves the revision.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';
import { workingCorpusCopy } from '../testCorpus.js';

const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const boot = (db) => { db.exec(SCHEMA); migrate(db); };
const revision = (db) => db.prepare('SELECT revision FROM corpus_revision WHERE id = 1').pluck().get();
const NOTE = 'Placed by placeBucketB.js; conference and academic_rating are placeholders pending review.';

function fresh() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  boot(db);
  const add = db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, academic_rating, identity_notes)
    VALUES (?, 'x', 'x', ?, 'mens-soccer', ?, ?, ?)`);
  // Two documented placeholders, and ordinary rated / modal rows beside them.
  add.run('p1', 'Placeholder One', 'NAIA', 6.0, NOTE);
  add.run('p2', 'Placeholder Two', 'NCAA D2', 6.0, NOTE);
  add.run('r1', 'Rated', 'NCAA D2', 7.1, null);
  add.run('m1', 'Modal', 'NCAA D2', 2.7, null);
  add.run('m2', 'Modal Two', 'NCAA D2', 2.7, null);
  return db;
}

describe('startup and corpus_revision', () => {
  it('labels the documented placeholders on the boot that first sees them', () => {
    const db = fresh();
    const before = revision(db);
    migrate(db);
    expect(db.prepare("SELECT id FROM colleges WHERE academic_rating_source = 'placeholder' ORDER BY id").pluck().all()).toEqual(['p1', 'p2']);
    expect(revision(db)).toBeGreaterThan(before);
  });

  it('a second boot over unchanged data leaves the revision exactly where it was', () => {
    const db = fresh();
    migrate(db);
    const settled = revision(db);
    boot(db);
    boot(db);
    expect(revision(db)).toBe(settled);
  });

  it('a row that newly declares itself a placeholder is still relabelled, and that moves the revision', () => {
    const db = fresh();
    migrate(db);
    db.prepare("UPDATE colleges SET identity_notes = ?, academic_rating_source = 'rated' WHERE id = 'r1'").run(NOTE);
    const before = revision(db);
    boot(db);
    expect(db.prepare("SELECT academic_rating_source FROM colleges WHERE id = 'r1'").pluck().get()).toBe('placeholder');
    expect(revision(db)).toBe(before + 1);
  });

  /**
   * The whole boot, against the real corpus: whatever any startup step does,
   * a second boot must not move the revision. Runs where the suite has a
   * scratch clone of the working database; skipped where there is none.
   */
  const corpus = workingCorpusCopy('startup-revision');
  it.skipIf(!corpus)('a repeat boot of the real corpus does not move the revision', () => {
    const db = new Database(corpus);
    db.pragma('foreign_keys = ON');
    boot(db);
    const settled = revision(db);
    boot(db);
    expect(revision(db)).toBe(settled);
    db.close();
  });
});
