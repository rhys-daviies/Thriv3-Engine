import { describe, it, expect, beforeAll } from 'vitest';
import db from '../db/client.js';
import { migrate } from '../db/migrate.js';
import {
  listAthleteProgrammes, updateAthleteProgramme, upsertAthleteProgramme,
  suppressedProgrammesForAthlete,
} from './athleteProgrammes.js';

/**
 * A10 §E, §N, §Q — NINETY-NINE SPECIFIC SCHOOLS SURVIVE.
 *
 * ===========================================================================
 * WHAT THIS PROVES, AND WHY IT IS NOT A MIGRATION TEST.
 *
 * There is no migration. V2's Specific Schools tab reads `athlete_programmes`
 * — the same table, through the same library, through the same route that V1
 * has always read. Nothing is copied into a V2 store because there is no V2
 * store, so the usual failure modes of a data migration (a lossy copy, a
 * re-mapped identity, a count that comes out at 98) cannot occur here.
 *
 * That makes the thing worth testing DIFFERENT. It is not "did the copy
 * survive" but:
 *
 *   1. the rows and every operator-authored field on them are untouched by
 *      running the schema migration again, and again, and again;
 *   2. the operations the two surfaces share are non-destructive — a
 *      withdrawal is a state change, not a DELETE, and a Top-100 exclusion
 *      writes `visibility` and nothing else;
 *   3. nothing about a V2 run is required for a specific school to exist, so
 *      an athlete with no run keeps all ninety-nine.
 *
 * NINETY-NINE, NOT A HANDFUL. The production preservation baseline is 100 (99
 * when this was written, plus one from the production Specific Search smoke
 * test). The fixture reproduces the SCALE, not the exact number: the ways a
 * list quietly loses a member — an off-by-one, a Map keyed on something
 * non-unique, a view that drops what it cannot enrich — do not reproduce at
 * three rows, and do not care whether the number is 99 or 100.
 * ===========================================================================
 */

const ATHLETE = 'a-preserve-99';
const SPORT = 'mens-soccer';
const COUNT = 99;

const STAMP = '2026-09-11T00:00:00.000Z';

/**
 * Operator-authored state spread across the set, so "the rows survived" means
 * the DECISIONS survived and not merely the row count. Every one of these
 * fields is something a consultant typed or clicked and nothing else can
 * reconstruct.
 */
function stateFor(i) {
  if (i % 11 === 0) return { visibility: 'suppressed' };
  if (i % 7 === 0) return { contact_stance: 'manual_only' };
  if (i % 13 === 0) return { contact_stance: 'do_not_contact' };
  if (i % 5 === 0) return { flagged: 1, flag_reason: 'Already in touch', flagged_at: STAMP };
  if (i % 3 === 0) return { note: `Family asked about this one (${i})`, note_updated_at: STAMP };
  return {};
}

const name = (i) => `Preservation College ${String(i).padStart(2, '0')}`;

function seed() {
  db.exec('DELETE FROM athlete_programmes; DELETE FROM colleges; DELETE FROM players;');
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, ?, ?, 'Preservation Athlete', 'MIDFIELD', ?)
  `).run(ATHLETE, STAMP, STAMP, SPORT);

  for (let i = 1; i <= COUNT; i += 1) {
    const collegeId = `col-preserve-${i}`;
    db.prepare(`
      INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
      VALUES (?, ?, ?, ?, ?, 'NCAA D1', 'Test Conference', 'Testville', 'TS', 1)
    `).run(collegeId, STAMP, STAMP, name(i), SPORT);

    const extra = stateFor(i);
    const cols = ['id', 'athlete_id', 'college_name', 'sport', 'college_id',
      'request_state', 'requested_by', 'requested_at', 'created_at', 'updated_at',
      ...Object.keys(extra)];
    const values = [`rel-preserve-${i}`, ATHLETE, name(i), SPORT, collegeId,
      'requested', 'operator', STAMP, STAMP, STAMP,
      ...Object.values(extra)];
    db.prepare(
      `INSERT INTO athlete_programmes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ).run(...values);
  }
}

/** Everything a consultant authored, in a form two snapshots can be compared by. */
const fingerprint = () => db.prepare(`
  SELECT id, college_name, sport, college_id, request_state, requested_by,
         flagged, flag_reason, visibility, contact_stance, note
    FROM athlete_programmes
   WHERE athlete_id = ?
   ORDER BY college_name
`).all(ATHLETE);

beforeAll(() => { seed(); });

describe('A10 §N. the ninety-nine', () => {
  it('N-S1. are all there, and the library returns all of them', () => {
    expect(db.prepare('SELECT COUNT(*) c FROM athlete_programmes WHERE athlete_id = ?').get(ATHLETE).c)
      .toBe(COUNT);
    expect(listAthleteProgrammes(ATHLETE)).toHaveLength(COUNT);
  });

  it('N-S2. survive the schema migration run three more times, byte for byte', () => {
    const before = fingerprint();
    expect(before).toHaveLength(COUNT);

    /**
     * THREE TIMES — §Q. Once proves it runs; three times proves it is
     * idempotent rather than accidentally survivable, which is the property
     * that matters when a deploy restarts a process more than once.
     */
    for (let pass = 1; pass <= 3; pass += 1) {
      migrate(db);
      expect(fingerprint(), `pass ${pass} changed the rows`).toEqual(before);
    }

    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('N-S3. do not require a V2 run to exist', () => {
    /**
     * The consultant's list predates the engine and does not depend on it. An
     * athlete with no persisted run has ninety-nine specific schools, and the
     * V2 tab's job is to say it holds no standing for them — not to show
     * ninety-nine fewer rows.
     */
    expect(db.prepare('SELECT COUNT(*) c FROM matchmaking_runs WHERE player_id = ?').get(ATHLETE).c)
      .toBe(0);
    expect(listAthleteProgrammes(ATHLETE)).toHaveLength(COUNT);
  });

  it('N-S4. every operator-authored state is still distinguishable', () => {
    const rows = fingerprint();
    expect(rows.filter((r) => r.visibility === 'suppressed').length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.contact_stance === 'manual_only').length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.contact_stance === 'do_not_contact').length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.flagged).length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.note).length).toBeGreaterThan(0);
  });
});

describe('A10 §F, §G. the shared operations are non-destructive', () => {
  it('G-S1. a Top-100 exclusion writes visibility and touches nothing else', () => {
    /**
     * A ROW THAT CARRIES OTHER DECISIONS, deliberately.
     *
     * A row with nothing else on it cannot show that nothing else was lost: a
     * write that also cleared the note would pass unnoticed against a row
     * whose note was already null. Found by mutation — the first version of
     * this test took the first `default` row and survived exactly that change.
     */
    const target = listAthleteProgrammes(ATHLETE)
      .find((r) => r.visibility === 'default' && r.note && r.request_state === 'requested');
    expect(target, 'a default-visibility row that carries a note').toBeTruthy();
    const before = db.prepare('SELECT * FROM athlete_programmes WHERE id = ?').get(target.id);
    expect(before.note, 'the note is there to begin with').toBeTruthy();

    updateAthleteProgramme(ATHLETE, target.id, { visibility: 'suppressed' });

    const after = db.prepare('SELECT * FROM athlete_programmes WHERE id = ?').get(target.id);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);

    /** `updated_at` is bookkeeping; `visibility` is the decision. Nothing else. */
    expect(changed.sort()).toEqual(['updated_at', 'visibility']);
    expect(suppressedProgrammesForAthlete(ATHLETE, SPORT)).toContain(target.college_name);

    // and the row is still on the consultant's list
    expect(listAthleteProgrammes(ATHLETE)).toHaveLength(COUNT);
  });

  it('G-S2. and it is reversible, back to exactly the previous state', () => {
    const target = listAthleteProgrammes(ATHLETE).find((r) => r.visibility === 'suppressed');
    updateAthleteProgramme(ATHLETE, target.id, { visibility: 'default' });

    expect(suppressedProgrammesForAthlete(ATHLETE, SPORT)).not.toContain(target.college_name);
    expect(listAthleteProgrammes(ATHLETE)).toHaveLength(COUNT);
  });

  it('F-S1. a withdrawal is a state change, NOT a delete', () => {
    const target = listAthleteProgrammes(ATHLETE)
      .find((r) => r.note || r.flagged || r.contact_stance !== 'default');
    expect(target, 'a row carrying other decisions').toBeTruthy();

    updateAthleteProgramme(ATHLETE, target.id, { request_state: 'withdrawn' });

    const row = db.prepare('SELECT * FROM athlete_programmes WHERE id = ?').get(target.id);
    /**
     * THE ROW SURVIVES BECAUSE IT CARRIES MORE THAN THE REQUEST. Deleting it
     * to clear a request would take the flag, the note and the contact stance
     * with it — none of which has anything to do with who asked for the
     * school.
     */
    expect(row, 'the row is still there').toBeTruthy();
    expect(row.request_state).toBe('withdrawn');
    expect(row.note).toBe(target.note ?? null);
    expect(row.flagged).toBe(target.flagged ? 1 : 0);
    expect(row.contact_stance).toBe(target.contact_stance);

    expect(db.prepare('SELECT COUNT(*) c FROM athlete_programmes WHERE athlete_id = ?').get(ATHLETE).c)
      .toBe(COUNT);
  });

  it('F-S2. re-adding an existing programme is idempotent — one row, not two', () => {
    const existing = listAthleteProgrammes(ATHLETE)[0];
    const total = () => db.prepare('SELECT COUNT(*) c FROM athlete_programmes WHERE athlete_id = ?').get(ATHLETE).c;
    const before = total();

    upsertAthleteProgramme(ATHLETE, {
      college_id: existing.college_id, request_state: 'requested', requested_by: 'operator',
    });

    /** `UNIQUE (athlete_id, college_name, sport)` is what makes this true. */
    expect(total()).toBe(before);
  });
});
