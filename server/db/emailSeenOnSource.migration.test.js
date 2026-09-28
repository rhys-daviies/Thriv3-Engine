import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';

/**
 * PHASE 4F — the email-OBSERVATION provenance columns and the distinction they
 * exist to protect.
 *
 *   email_seen_on_source_*  — the EXACT stored address was seen published on a
 *                             current authoritative page (page observation).
 *   email_confirmed_at      — the mailbox is proven to accept mail (deliverability).
 *
 * Being printed on a staff page is not proof the mailbox works, so the two axes
 * must be independent: writing one must never touch the other, and the
 * observation columns must add nothing to what makes a coach reachable.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8');

let dir; let dbPath; let db;
function fresh() {
  const d = new Database(dbPath);
  d.exec(schema);
  migrate(d);          // real migration
  migrate(d);          // idempotent — safe to run twice
  return d;
}
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4f-seen-'));
  dbPath = path.join(dir, 't.sqlite');
  db = fresh();
});
afterAll(() => { try { db.close(); } catch { /* */ } try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

const cols = () => db.prepare('PRAGMA table_info(coaches)').all();

describe('email_seen_on_source_* migration (additive, nullable, idempotent)', () => {
  it('adds both observation columns as TEXT', () => {
    const byName = new Map(cols().map((c) => [c.name, c]));
    expect(byName.has('email_seen_on_source_at')).toBe(true);
    expect(byName.has('email_seen_on_source_url')).toBe(true);
    expect(byName.get('email_seen_on_source_at').type).toBe('TEXT');
    expect(byName.get('email_seen_on_source_url').type).toBe('TEXT');
  });

  it('adds each coaches column exactly once (idempotent — no duplicates after two migrates)', () => {
    const names = cols().map((c) => c.name);
    expect(names.filter((n) => n === 'email_seen_on_source_at')).toHaveLength(1);
    expect(names.filter((n) => n === 'email_seen_on_source_url')).toHaveLength(1);
  });

  it('defaults NULL for existing/new rows (never a fabricated observation)', () => {
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, sport) VALUES ('k1','2026-01-01T00:00:00Z','A Coach','a@x.edu','X','mens-soccer')").run();
    const r = db.prepare("SELECT email_seen_on_source_at s, email_seen_on_source_url u FROM coaches WHERE id='k1'").get();
    expect(r.s).toBeNull();
    expect(r.u).toBeNull();
  });
});

describe('observation is independent of deliverability', () => {
  it('setting email_seen_on_source_* does NOT imply email_confirmed_at (seen != deliverable)', () => {
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, sport) VALUES ('k2','2026-01-01T00:00:00Z','B Coach','b@x.edu','X','mens-soccer')").run();
    db.prepare("UPDATE coaches SET email_seen_on_source_at='2026-09-26', email_seen_on_source_url='https://x.edu/coaches' WHERE id='k2'").run();
    const r = db.prepare("SELECT email_seen_on_source_at s, email_confirmed_at c FROM coaches WHERE id='k2'").get();
    expect(r.s).toBe('2026-09-26');
    expect(r.c).toBeNull(); // deliverability untouched
  });

  it('setting email_confirmed_at does NOT imply an observation (deliverable != seen on page)', () => {
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, sport) VALUES ('k3','2026-01-01T00:00:00Z','C Coach','c@x.edu','X','mens-soccer')").run();
    db.prepare("UPDATE coaches SET email_confirmed_at='2026-09-26T00:00:00Z' WHERE id='k3'").run();
    const r = db.prepare("SELECT email_seen_on_source_at s, email_confirmed_at c FROM coaches WHERE id='k3'").get();
    expect(r.c).toBe('2026-09-26T00:00:00Z');
    expect(r.s).toBeNull(); // observation untouched
  });
});
