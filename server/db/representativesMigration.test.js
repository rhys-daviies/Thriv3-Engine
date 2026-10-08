/**
 * Phase 2's schema change on an existing database: the representatives table
 * and players.representative_id arrive once, assign nobody, and leave every
 * existing athlete value as it was. A repeat boot changes nothing.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';

const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const boot = (db) => { db.exec(SCHEMA); migrate(db); };
const players = (db) => db.prepare('SELECT * FROM players ORDER BY id').all();

describe('the representatives migration', () => {
  it('adds the table and column once, assigns nobody, and preserves existing athletes', () => {
    const db = new Database(':memory:');
    boot(db);
    db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, email, guardian_email, public_slug)
      VALUES ('p1', 'x', 'x', 'Existing Athlete', 'Defender', 'mens-soccer', 'a@example.com', 'g@example.com', 'slug1')`).run();
    const before = players(db);

    boot(db);
    boot(db);
    const after = players(db);
    expect(after).toHaveLength(1);
    // Every column the row had is unchanged; the new one is NULL.
    for (const [k, v] of Object.entries(before[0])) expect(after[0][k], k).toEqual(v);
    expect(after[0].representative_id).toBeNull();
    expect(db.prepare('SELECT COUNT(*) FROM representatives').pluck().get()).toBe(0);
    const cols = db.prepare('PRAGMA table_info(players)').all().filter((c) => c.name === 'representative_id');
    expect(cols).toHaveLength(1);
    expect(cols[0].notnull).toBe(0);
  });
});
