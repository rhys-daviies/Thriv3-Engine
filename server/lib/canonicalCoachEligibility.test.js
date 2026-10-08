import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { corroborateFixtureCoaches } from '../testCanonicalCoaches.js';

/**
 * FRESHNESS OF THE SEND FLOOR'S TWO INPUTS — PR #64 review.
 *
 *   1. ACTIVATION HOLDS are read from the file's CURRENT CONTENT on every check; no timestamp or
 *      size is trusted, so an edit that keeps both still applies to the very next check.
 *   2. THE CANONICAL DECISION is recomputed outright at every send boundary (fresh); the selection
 *      cache is invalidated by a write on the same connection, a commit on another connection,
 *      and a change to the one external file the reconciler reads.
 */
delete process.env.THRIV3_ALLOW_LEGACY_COACHES;

// The reconciler reads docs/validation/generated/duplicate_unitid_canonical_map.json on every run.
// Tests never edit the committed file: reads of it can be overridden here instead.
const dupMap = vi.hoisted(() => ({ override: null }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal();
  const readFileSync = (file, ...rest) => (dupMap.override !== null && String(file).endsWith('duplicate_unitid_canonical_map.json') ? dupMap.override : real.readFileSync(file, ...rest));
  return { ...real, default: { ...real, readFileSync }, readFileSync };
});

const db = (await import('../db/client.js')).default;
const { coachIneligibility, recipientIneligibility } = await import('./coachEligibility.js');
const { activationHold, activationHolds, canonicalDecisions, CANONICAL_INELIGIBLE } = await import('./canonicalCoachEligibility.js');

const T = '2026-09-20T10:00:00.000Z';
const SCHOOL = 'Fresh College';
const tmpFiles = [];
const tmp = (name) => { const f = path.join(os.tmpdir(), `${name}-${randomUUID()}`); tmpFiles.push(f); return f; };
afterAll(() => { for (const f of tmpFiles) fs.rmSync(f, { force: true }); activationHolds(); });

function seedCoach(handle, id, name) {
  handle.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
    VALUES (?, ?, ?, ?, ?, 'NCAA D3', 'mens-soccer', 'Head Coach', 'verified', 'CURRENT')`).run(id, T, name, `${id}@fresh.example`, SCHOOL);
  corroborateFixtureCoaches(handle, { ids: [id] });
}
const row = (handle, id) => handle.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
const sendCheck = (handle, id) => recipientIneligibility({ email: `${id}@fresh.example`, collegeName: SCHOOL, sport: 'mens-soccer' }, { handle });
const uncorroborate = (handle, id) => handle.prepare('DELETE FROM coach_seasons WHERE school = ? AND lower(coach_name) = lower(?)').run(SCHOOL, row(handle, id).full_name);

beforeAll(() => {
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active) VALUES ('col-fresh', ?, ?, ?, 'mens-soccer', 'NCAA D3', 1)").run(T, T, SCHOOL);
});

describe('activation holds are read from the file content, not its timestamp or size', () => {
  it('a same-size edit with the original modification time restored still applies to the next check', () => {
    const f = tmp('holds.json');
    const write = (id) => fs.writeFileSync(f, JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', counts: { PENDING_SEND_TIME_VERIFICATION: 1 }, holds: [{ coach_id: id, hold: 'PENDING_SEND_TIME_VERIFICATION' }] }));
    const PINNED = 1700000000;                                   // one whole-second timestamp for both versions
    write('coach-AAAA'); fs.utimesSync(f, PINNED, PINNED);
    expect(activationHold('coach-AAAA', f)).toMatchObject({ hold: 'PENDING_SEND_TIME_VERIFICATION' });
    expect(activationHold('coach-BBBB', f)).toBeNull();
    const before = fs.statSync(f);
    write('coach-BBBB');                                         // same length: the size does not move
    fs.utimesSync(f, PINNED, PINNED);                            // and the modification time is put back
    const after = fs.statSync(f);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(activationHold('coach-BBBB', f)).toMatchObject({ hold: 'PENDING_SEND_TIME_VERIFICATION' });   // newly held: refused
    expect(activationHold('coach-AAAA', f)).toBeNull();
  });
  it('a file corrupted in place, same size and time, fails closed on the next check', () => {
    const f = tmp('holds.json');
    const good = JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', counts: { PENDING_SEND_TIME_VERIFICATION: 1 }, holds: [{ coach_id: 'coach-AAAA', hold: 'PENDING_SEND_TIME_VERIFICATION' }] });
    fs.writeFileSync(f, good); fs.utimesSync(f, 1700000000, 1700000000);
    expect(activationHold('someone', f)).toBeNull();
    fs.writeFileSync(f, good.replace('"holds":[', '"holdz":['));   // same size, now malformed
    fs.utimesSync(f, 1700000000, 1700000000);
    expect(activationHold('someone', f)).toMatchObject({ hold: 'HOLDS_FILE_UNREADABLE' });
  });
});

describe('the canonical decision observes every relevant change', () => {
  it('a write on the SAME connection: the send boundary and the selection cache both see it immediately', () => {
    seedCoach(db, 'same-conn', 'Sam Same');
    expect(coachIneligibility(row(db, 'same-conn'))).toBeNull();             // selection (cached path)
    expect(sendCheck(db, 'same-conn')).toBeNull();                            // send boundary (fresh)
    uncorroborate(db, 'same-conn');
    expect(sendCheck(db, 'same-conn')).toBe(CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE);
    expect(coachIneligibility(row(db, 'same-conn'), { fresh: true })).toBe(CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE);
    expect(coachIneligibility(row(db, 'same-conn'))).toBe(CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE);
  });

  it('a commit on ANOTHER connection: the send boundary and the selection cache both see it immediately', () => {
    // two real connections to one database file: A decides, B commits a change
    const file = tmp('fresh.sqlite');
    fs.writeFileSync(file, db.serialize());
    const A = new Database(file); const B = new Database(file);
    try {
      seedCoach(A, 'other-conn', 'Olga Other');
      expect(coachIneligibility(row(A, 'other-conn'), { handle: A })).toBeNull();
      expect(sendCheck(A, 'other-conn')).toBeNull();
      uncorroborate(B, 'other-conn');                                         // committed by B, not A
      expect(sendCheck(A, 'other-conn')).toBe(CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE);
      expect(coachIneligibility(row(A, 'other-conn'), { handle: A })).toBe(CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE);
      // and back: B restores the evidence, A sees that too
      corroborateFixtureCoaches(B, { ids: ['other-conn'] });
      expect(coachIneligibility(row(A, 'other-conn'), { handle: A })).toBeNull();
      expect(sendCheck(A, 'other-conn')).toBeNull();
    } finally { A.close(); B.close(); }
  });

  it('a change to the reconciler\'s external map invalidates the selection cache; the send boundary never caches', () => {
    seedCoach(db, 'ext-map', 'Ella External');
    const first = canonicalDecisions(db);
    expect(canonicalDecisions(db)).toBe(first);                               // cached while nothing changed
    expect(canonicalDecisions(db, { fresh: true })).not.toBe(first);          // send time: always recomputed
    const real = fs.readFileSync(path.resolve(import.meta.dirname, '../../docs/validation/generated/duplicate_unitid_canonical_map.json'), 'utf8');
    try {
      dupMap.override = JSON.stringify([...JSON.parse(real), { duplicate_name: 'Some Other Name', sport: 'mens-soccer', canonical_name: SCHOOL }]);
      const after = canonicalDecisions(db);
      expect(after).not.toBe(first);                                          // the edit invalidated the cache
      expect(canonicalDecisions(db)).toBe(after);
    } finally { dupMap.override = null; }
  });
});
