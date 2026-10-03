import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../db/client.js';
import { seedPool } from './seedTestPool.js';
import { programmeContext, DEPARTURE_STATE } from './programmeContext.js';
import { clearContextCache } from './matchmakingService.js';

/**
 * A11 §5, §6 — PROGRAMME CONTEXT, AND THE DIFFERENCE BETWEEN ZERO AND SILENCE.
 *
 * ===========================================================================
 * THE ASSERTION THAT MATTERS MOST IS THAT A COUNT AND A GAP NEVER LOOK ALIKE.
 *
 * Every other property here is ordinary. This one is not: a programme with no
 * roster on file and a programme with nobody leaving both arrive at the UI
 * carrying the number 0, and only the STATE tells them apart. If that ever
 * stops being true, a family is told "no places are opening" when the truth
 * is "we have not looked".
 * ===========================================================================
 */

const SPORT = 'mens-soccer';
const ENTRY = 2027;

/**
 * ONE POOL FOR THE FILE. `seedPool` inserts the colleges, and
 * `UNIQUE (name, sport)` means it can only do that once — so it runs here and
 * each test clears the CONTEXT CACHE instead, which is what actually has to be
 * invalidated when a test edits a college row.
 */
beforeAll(() => {
  clearContextCache();
  seedPool(SPORT);
});

function pool() {
  clearContextCache();
}

describe('A11 §6. departures are stated, never guessed', () => {
  it('P1. requires the athlete\'s entry year — there is no silent default', () => {
    expect(() => programmeContext(db, { sport: SPORT, names: ['X'] }))
      .toThrow(/entry year/i);
  });

  it('P2. an empty name list is an empty answer, not a whole-universe read', () => {
    expect(programmeContext(db, { sport: SPORT, names: [], entryYear: ENTRY }))
      .toEqual({ programmes: [] });
  });

  it('P3. a programme with no roster reports NO_ROSTER, not zero departures', () => {
    pool();
    const out = programmeContext(db, {
      sport: SPORT, names: ['A Programme With No Roster At All'], entryYear: ENTRY,
    });
    const p = out.programmes[0];
    expect(p.rosterOnFile).toBe(false);
    for (const pos of ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD']) {
      expect(p.departures[pos].state, pos).toBe(DEPARTURE_STATE.NO_ROSTER);
    }
  });

  it('P4. every position carries a state, and only MEASURED licenses a number', () => {
    pool();
    const names = db.prepare(
      'SELECT DISTINCT college_name FROM roster_players WHERE sport = ? LIMIT 5',
    ).pluck().all(SPORT);
    if (!names.length) return;

    const out = programmeContext(db, { sport: SPORT, names, entryYear: ENTRY });
    for (const p of out.programmes) {
      for (const [pos, cell] of Object.entries(p.departures)) {
        expect(Object.values(DEPARTURE_STATE), `${p.collegeName}/${pos}`).toContain(cell.state);
        expect(Number.isInteger(cell.openings)).toBe(true);
        expect(Number.isInteger(cell.vacatedStarters)).toBe(true);
        /** The scored term can never exceed the places that opened. */
        expect(cell.vacatedStarters, `${p.collegeName}/${pos}`).toBeLessThanOrEqual(cell.openings);
      }
    }
  });

  it('P5. the names agree with the counts, because both use one predicate', () => {
    pool();
    const names = db.prepare(
      'SELECT DISTINCT college_name FROM roster_players WHERE sport = ? LIMIT 8',
    ).pluck().all(SPORT);
    if (!names.length) return;

    const out = programmeContext(db, {
      sport: SPORT, names, entryYear: ENTRY, withNames: true,
    });
    for (const p of out.programmes) {
      if (!p.departingPlayers) continue;
      for (const [pos, cell] of Object.entries(p.departures)) {
        if (cell.state !== DEPARTURE_STATE.MEASURED) continue;
        /**
         * THE DISAGREEMENT THIS CATCHES. The counts come from the engine's
         * `positionEvidence`; the names are resolved here from the same
         * class-year and eligibility pair. When those two drifted, the card
         * showed "2 opening" above an empty list.
         */
        expect(
          (p.departingPlayers[pos] ?? []).length,
          `${p.collegeName}/${pos}: ${cell.openings} counted`,
        ).toBe(cell.openings);
      }
    }
  });
});

describe('A11 §5. ratings are reported only where they were established', () => {
  it('R1. an absent rating is null — never zero', () => {
    pool();
    db.prepare(`UPDATE colleges SET soccer_score = NULL, academic_rating = NULL
                 WHERE sport = ? AND name = (SELECT name FROM colleges WHERE sport = ? LIMIT 1)`)
      .run(SPORT, SPORT);
    const name = db.prepare('SELECT name FROM colleges WHERE sport = ? LIMIT 1').pluck().get(SPORT);
    const p = programmeContext(db, { sport: SPORT, names: [name], entryYear: ENTRY }).programmes[0];
    expect(p.programRating).toBe(null);
    expect(p.academicRating).toBe(null);
    expect(p.programRating).not.toBe(0);
  });

  it('R2. a placeholder academic rating is NOT reported as a rating', () => {
    pool();
    const name = db.prepare('SELECT name FROM colleges WHERE sport = ? LIMIT 1').pluck().get(SPORT);
    db.prepare(`UPDATE colleges SET academic_rating = 3.1, academic_rating_source = 'placeholder'
                 WHERE sport = ? AND name = ?`).run(SPORT, name);
    const p = programmeContext(db, { sport: SPORT, names: [name], entryYear: ENTRY }).programmes[0];
    /**
     * The number exists in the column. It is not a measurement of the
     * institution, and printing "3.1/10" would present our own placeholder as
     * one. `academic_rating_source` is what tells the two apart.
     */
    expect(p.academicRating).toBe(null);
  });

  it('R3. soccer_score is reported over 10, the way V1 has always shown it', () => {
    pool();
    const name = db.prepare('SELECT name FROM colleges WHERE sport = ? LIMIT 1').pluck().get(SPORT);
    db.prepare('UPDATE colleges SET soccer_score = 74 WHERE sport = ? AND name = ?').run(SPORT, name);
    const p = programmeContext(db, { sport: SPORT, names: [name], entryYear: ENTRY }).programmes[0];
    expect(p.programRating).toBe(7.4);
  });
});
