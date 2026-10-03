import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../db/client.js';
import { seedPool } from './seedTestPool.js';
import fs from 'node:fs';
import path from 'node:path';
import { programmeContext, DEPARTURE_STATE, percentileWithin, topPercentFrom } from './programmeContext.js';
import { qualityPercentiles } from '../../../shared/matching/pool.js';
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
    /** No score means no place in its division's distribution. */
    expect(p.programStrength).toBe(null);
    expect(p.academicRating).toBe(null);
    expect(p.programStrength).not.toBe(0);
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

  it('R3. soccer_score is NEVER reported as a national score out of 10', () => {
    /**
     * REVERSED BY A11.1 §1, AND THE REVERSAL IS THE POINT.
     *
     * A11 reported `soccer_score / 10` as "Program Rating", which is what V1
     * has always shown. A11 then measured the scale and found division
     * dominates it — D1 55–100 against D3 25–58 — so the strongest D3
     * programme in the country reads as weaker than the weakest D1 one.
     * A11.1 ruled that out for this surface. What is reported instead is the
     * programme's percentile WITHIN ITS OWN DIVISION, which names the
     * division so the reader knows what it is relative to.
     */
    pool();
    const name = db.prepare('SELECT name FROM colleges WHERE sport = ? LIMIT 1').pluck().get(SPORT);
    db.prepare('UPDATE colleges SET soccer_score = 74 WHERE sport = ? AND name = ?').run(SPORT, name);
    const p = programmeContext(db, { sport: SPORT, names: [name], entryYear: ENTRY }).programmes[0];

    expect(p.programRating, 'the national /10 is gone').toBeUndefined();
    expect(p.programStrength?.division, 'and the division is named').toBeTruthy();
    expect(p.programStrength?.topPercent).toBeGreaterThanOrEqual(1);
    expect(p.programStrength?.topPercent).toBeLessThanOrEqual(100);
  });
});

describe('A11.1 §7. women\'s soccer cannot be given a false zero', () => {
  it('W1. the module does not read `graduating_seniors` AT ALL', () => {
    /**
     * THE STRUCTURAL GUARANTEE, ASSERTED STRUCTURALLY.
     *
     * `graduating_seniors` holds 1,113 women's-soccer rows and EVERY ONE has
     * a NULL total, no names and no position data. Any surface that reads it
     * for a women's athlete gets nothing back and, unless it is very careful,
     * renders that nothing as "0 graduating players" — a confident, false
     * statement about every women's programme in the corpus.
     *
     * A11 avoids that by construction rather than by care: it reads the
     * roster/eligibility evidence instead, which is populated for both
     * sports. This test fails if anybody reconnects the old table.
     */
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/lib/v2/programmeContext.js'), 'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'the false-zero source stays disconnected').not.toContain('graduating_seniors');
  });

  it('W2. a women\'s programme with no roster says NO_ROSTER, not zero', () => {
    const out = programmeContext(db, {
      sport: 'womens-soccer',
      names: ['A Women\'s Programme With No Roster'],
      entryYear: ENTRY,
    });
    const p = out.programmes[0];
    for (const pos of ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD']) {
      expect(p.departures[pos].state, pos).toBe(DEPARTURE_STATE.NO_ROSTER);
    }
    /**
     * The counts are zero in the payload — they have to be some number — and
     * the STATE is what stops the UI printing them. `GraduatingPlayers`
     * renders "Not established" for every state but MEASURED, asserted there.
     */
    expect(p.departures.MIDFIELD.state).not.toBe(DEPARTURE_STATE.MEASURED);
  });
});

describe('A11.1 §1. programme strength is division-relative', () => {
  it('S1. percentileWithin agrees exactly with V1\'s qualityPercentiles', () => {
    /**
     * ONE RULE, TWO COPIES, AND A PROOF THEY AGREE.
     *
     * V1's version lives in `shared/matching/pool.js`, which imports
     * `score.js`, `weights.js` and `couplings.js` — all three forbidden to the
     * V2 graph by the import boundary. Importing it into the serving path to
     * borrow ten lines of arithmetic would drag V1's scorer in with it. This
     * test may import it freely, because a test is not the serving path.
     */
    const rows = [
      { id: 'a', soccer_score: 10 }, { id: 'b', soccer_score: 30 },
      { id: 'c', soccer_score: 30 }, { id: 'd', soccer_score: 55 },
      { id: 'e', soccer_score: 80 }, { id: 'f', soccer_score: null },
    ];
    const mine = percentileWithin(rows, (r) => r.soccer_score, (r) => r.id);
    const theirs = qualityPercentiles(rows);
    for (const r of rows) {
      expect(mine.get(r.id), `${r.id}`).toBe(theirs.get(r.id));
    }
    /** Ties share the LOWER rank — b and c, both 30. */
    expect(mine.get('b')).toBe(mine.get('c'));
  });

  it('S2. fewer than two scored rows is not a distribution', () => {
    const one = percentileWithin([{ id: 'a', soccer_score: 50 }], (r) => r.soccer_score, (r) => r.id);
    expect(one.get('a')).toBe(null);
  });

  it('S3. "Top N%" is floored at 1 — nothing is Top 0%', () => {
    expect(topPercentFrom(1)).toBe(1);
    expect(topPercentFrom(0.85)).toBe(15);
    expect(topPercentFrom(0)).toBe(100);
    expect(topPercentFrom(null)).toBe(null);
  });

  it('S4. a programme is ranked against its OWN division, not the nation', () => {
    pool();
    const rows = db.prepare(
      'SELECT name, division, soccer_score FROM colleges WHERE sport = ? AND soccer_score IS NOT NULL',
    ).all(SPORT);
    const byDivision = new Map();
    for (const r of rows) {
      if (!byDivision.has(r.division)) byDivision.set(r.division, []);
      byDivision.get(r.division).push(r);
    }
    /** A division with at least two scored programmes, so a percentile exists. */
    const [division, cohort] = [...byDivision].find(([, c]) => c.length >= 2) ?? [];
    if (!division) return;

    const weakest = [...cohort].sort((a, b) => a.soccer_score - b.soccer_score)[0];
    const strongest = [...cohort].sort((a, b) => b.soccer_score - a.soccer_score)[0];

    const out = programmeContext(db, {
      sport: SPORT, names: [weakest.name, strongest.name], entryYear: ENTRY,
    });
    const got = new Map(out.programmes.map((p) => [p.collegeName, p.programStrength]));

    expect(got.get(strongest.name).division).toBe(division);
    expect(got.get(strongest.name).topPercent)
      .toBeLessThan(got.get(weakest.name).topPercent);
    /** The strongest in ITS division is top-1%, whatever division that is. */
    expect(got.get(strongest.name).topPercent).toBe(1);
  });
});
