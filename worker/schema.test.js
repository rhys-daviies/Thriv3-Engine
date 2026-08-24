import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * The edge schema, exercised against a real SQLite engine.
 *
 * D1 is SQLite, and these guards are pure SQL, so the interesting behaviour
 * is testable offline. Worth doing: the edge is the one piece of state with
 * no other coverage, and it is the piece that was silently emptied.
 */
const SCHEMA = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');

let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO outreach_tokens (token, revoked, updated_at) VALUES ('tok-1', 0, '2026-08-24')").run();
  db.prepare(`
    INSERT INTO tracking_events (token, session_id, event_type, created_at)
    VALUES ('tok-1', 'sess-1', 'visit_qualified', '2026-08-24')
  `).run();
});

const unlock = (window) => db
  .prepare("UPDATE edge_guard SET deletes_unlocked_until = datetime('now', ?) WHERE id = 1")
  .run(window);

describe('the edge is append-only', () => {
  it('refuses to update an event', () => {
    expect(() => db.prepare("UPDATE tracking_events SET coverage_pct = 99").run())
      .toThrow(/append-only/);
  });
});

describe('deletes are locked by default', () => {
  it('refuses to delete an event', () => {
    expect(() => db.prepare("DELETE FROM tracking_events WHERE token = 'tok-1'").run())
      .toThrow(/locked/);
    expect(db.prepare('SELECT count(*) AS n FROM tracking_events').get().n).toBe(1);
  });

  it('refuses to delete a token', () => {
    expect(() => db.prepare("DELETE FROM outreach_tokens WHERE token = 'tok-1'").run())
      .toThrow(/locked/);
    expect(db.prepare('SELECT count(*) AS n FROM outreach_tokens').get().n).toBe(1);
  });

  // The 2026-08-20 wipe. An unqualified DELETE is the shape that did the
  // damage, and it has to fail as hard as a targeted one.
  it('refuses to empty a table wholesale', () => {
    expect(() => db.prepare('DELETE FROM tracking_events').run()).toThrow(/locked/);
    expect(() => db.prepare('DELETE FROM outreach_tokens').run()).toThrow(/locked/);
  });

  it('leaves inserts alone — collection must never be blocked', () => {
    db.prepare(`
      INSERT INTO tracking_events (token, session_id, event_type, created_at)
      VALUES ('tok-1', 'sess-2', 'visit', '2026-08-24')
    `).run();
    expect(db.prepare('SELECT count(*) AS n FROM tracking_events').get().n).toBe(2);
  });

  it('leaves the token upsert alone — revocation must still work', () => {
    db.prepare(`
      INSERT INTO outreach_tokens (token, revoked, updated_at) VALUES ('tok-1', 1, '2026-08-25')
      ON CONFLICT(token) DO UPDATE SET revoked = excluded.revoked, updated_at = excluded.updated_at
    `).run();
    expect(db.prepare("SELECT revoked FROM outreach_tokens WHERE token = 'tok-1'").get().revoked).toBe(1);
  });
});

describe('deliberate maintenance is still possible', () => {
  it('allows deletes while the window is open', () => {
    unlock('+10 minutes');
    db.prepare("DELETE FROM tracking_events WHERE token = 'tok-1'").run();
    db.prepare("DELETE FROM outreach_tokens WHERE token = 'tok-1'").run();
    expect(db.prepare('SELECT count(*) AS n FROM tracking_events').get().n).toBe(0);
  });

  // Forgetting to re-lock must not leave the door open indefinitely.
  it('re-locks itself once the window has passed', () => {
    unlock('-1 minute');
    expect(() => db.prepare("DELETE FROM tracking_events WHERE token = 'tok-1'").run())
      .toThrow(/locked/);
  });

  it('re-locks when the window is cleared', () => {
    unlock('+10 minutes');
    db.prepare('UPDATE edge_guard SET deletes_unlocked_until = NULL WHERE id = 1').run();
    expect(() => db.prepare("DELETE FROM tracking_events WHERE token = 'tok-1'").run())
      .toThrow(/locked/);
  });
});

describe('the guard row itself', () => {
  it('cannot be duplicated into a second, permanently-unlocked row', () => {
    expect(() => db.prepare("INSERT INTO edge_guard (id, deletes_unlocked_until) VALUES (2, datetime('now', '+1 year'))").run())
      .toThrow();
  });

  it('is re-runnable — applying the schema twice does not reset the window', () => {
    unlock('+10 minutes');
    const before = db.prepare('SELECT deletes_unlocked_until AS u FROM edge_guard WHERE id = 1').get().u;
    db.exec(SCHEMA);
    expect(db.prepare('SELECT deletes_unlocked_until AS u FROM edge_guard WHERE id = 1').get().u).toBe(before);
  });
});
