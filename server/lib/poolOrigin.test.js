/**
 * The origin benchmark as the pool build actually produces it.
 *
 * The unit tests cover the statistics; this covers the wiring — that divisions
 * are separated, that a division too thin to read is refused rather than
 * folded into its neighbours, and that the whole thing comes out of the pass
 * that was already reading every row.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import { buildPoolBenchmarks, invalidatePoolBenchmarks } from './philosophyQueries.js';

/**
 * Distinct names made of letters only.
 *
 * `nameKey` strips digits, so "Player 1" and "Player 2" are the same person to
 * the season join — and a fixture numbered that way reads as one first-year
 * returning for four years rather than four separate intakes.
 */
function letters(i) {
  let s = '';
  let x = i;
  do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return s.replace(/^./, (c) => c.toUpperCase());
}

const now = new Date().toISOString();
const insert = db.prepare(`INSERT INTO roster_players
  (id, created_date, updated_date, college_name, sport, division, season, player_name,
   class_year_label, position, minutes_played, games_played, games_started, nationality, country)
  VALUES (?,?,?,?,'mens-soccer',?,?,?,?,?,?,?,?,?,?)`);

let n = 0;
function addFreshman({ school, division, season, minutes, international, unpublished = false }) {
  insert.run(`p${n += 1}`, now, now, school, division, season, `Player ${letters(n)}`, 'Fr.', 'DEFENSE',
    unpublished ? 0 : minutes, unpublished ? 14 : 18, 10,
    international ? 'Brazil' : 'USA', international ? 'Brazil' : null);
}

/**
 * A division with a deliberate contrast: internationals reach a starter's
 * season, domestics mostly do not.
 */
function addDivision(division, { schools = 4, perSeason = 3 } = {}) {
  for (let s = 0; s < schools; s += 1) {
    for (const season of ['2022', '2023', '2024', '2025']) {
      for (let i = 0; i < perSeason; i += 1) {
        addFreshman({ school: `${division} School ${s}`, division, season, minutes: 100, international: false });
        addFreshman({ school: `${division} School ${s}`, division, season, minutes: 900, international: true });
      }
      // A squad big enough that the season is readable.
      for (let i = 0; i < 8; i += 1) {
        insert.run(`f${n += 1}`, now, now, `${division} School ${s}`, division, season,
          `Older ${letters(n)}`, 'Jr.', 'MIDFIELD', 800, 18, 12, 'USA', null);
      }
    }
  }
}

beforeEach(() => {
  db.exec('DELETE FROM roster_players;');
  invalidatePoolBenchmarks();
  n = 0;
});

describe('pool origin benchmarks', () => {
  it('reports both origins overall with their sample sizes', () => {
    addDivision('NCAA D1');
    const b = buildPoolBenchmarks('mens-soccer');
    expect(b.sufficient).toBe(true);
    const o = b.byOrigin.overall;
    expect(o.domestic.players).toBe(48);
    expect(o.international.players).toBe(48);
    expect(o.domestic.impactShare).toBe(0);
    expect(o.international.impactShare).toBe(1);
    expect(o.comparable).toBe(true);
  });

  // Divisions are reported on their own terms and never ranked against each
  // other: the relationship this contextualises runs one way at D1 and D2 and
  // reverses at D3 in the women's game.
  it('separates divisions rather than pooling them', () => {
    addDivision('NCAA D1');
    addDivision('NCAA D3', { schools: 3 });
    const b = buildPoolBenchmarks('mens-soccer');
    expect(Object.keys(b.byOrigin.byDivision).sort()).toEqual(['NCAA D1', 'NCAA D3']);
    expect(b.byOrigin.byDivision['NCAA D1'].domestic.players).toBe(48);
    expect(b.byOrigin.byDivision['NCAA D3'].domestic.players).toBe(36);
    // The overall figure is the sum, not one of the divisions.
    expect(b.byOrigin.overall.domestic.players).toBe(84);
  });

  it('refuses a division too thin to read without touching the others', () => {
    addDivision('NCAA D1');
    // One school, one season, two players: below both cohort minimums.
    addFreshman({ school: 'Tiny', division: 'USCAA', season: '2025', minutes: 500, international: false });
    addFreshman({ school: 'Tiny', division: 'USCAA', season: '2025', minutes: 500, international: true });
    const b = buildPoolBenchmarks('mens-soccer');
    const tiny = b.byOrigin.byDivision.USCAA;
    expect(tiny.comparable).toBe(false);
    expect(tiny.domestic.impactShare).toBeNull();
    expect(b.byOrigin.byDivision['NCAA D1'].comparable).toBe(true);
  });

  // A freshman whose minutes were never published is counted as unseen, never
  // as a freshman who did not play.
  it('counts unpublished minutes rather than reading them as zero', () => {
    addDivision('NCAA D1');
    for (let i = 0; i < 5; i += 1) {
      addFreshman({ school: 'NCAA D1 School 0', division: 'NCAA D1', season: '2025', minutes: 0, international: true, unpublished: true });
    }
    const o = buildPoolBenchmarks('mens-soccer').byOrigin.overall;
    expect(o.international.withoutPublishedMinutes).toBe(5);
    // They are absent from the denominator, so the share is unmoved.
    expect(o.international.players).toBe(48);
    expect(o.international.impactShare).toBe(1);
  });

  it('says nothing about origin where the sport has no rows at all', () => {
    const b = buildPoolBenchmarks('womens-soccer');
    expect(b.sufficient).toBe(false);
    expect(b.byOrigin).toBeNull();
  });

  it('reports programmes and seasons behind each group', () => {
    addDivision('NCAA D1');
    const o = buildPoolBenchmarks('mens-soccer').byOrigin.overall;
    expect(o.domestic.programmes).toBe(4);
    expect(o.domestic.seasons).toBe(4);
    expect(o.domestic.seasonsRepresented).toEqual(['2022', '2023', '2024', '2025']);
  });
});
