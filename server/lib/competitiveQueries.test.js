/**
 * The competitive layer against a real database, and the two firewalls.
 *
 * The firewalls are asserted at SOURCE level as well as behaviourally. A
 * behavioural test only proves the path it exercised; reading the modules and
 * finding no mention of the forbidden columns proves it for every path,
 * including the one somebody adds next month.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import {
  competitiveHistoryFor, programmeSeasonRows, buildCompetitivePools,
  competitivePools, invalidateCompetitivePools, competitivePoolStatus,
} from './competitiveQueries.js';
import { MIN_POOL } from '../../shared/competitiveHistory.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

/**
 * Every column that carries a rating, a rank or a postseason claim.
 *
 * `soccer_score` and its neighbours are built FROM these same four seasons, so
 * consuming them here would feed the record back into itself. The postseason
 * and conference-champion columns are the ones Phase 12A found wrong in two of
 * the three D1 values it could check against the schools' own schedules.
 */
const FORBIDDEN_COLUMNS = [
  'soccer_score', 'national_ranking', 'recent_win_pct', 'prior_win_pct',
  'postseason_2025_round', 'conference_champion_2025', 'conference_champion_name',
  '_ps',
];
/** `rating` on its own is a substring of academic_rating, so it is matched as a column. */
const FORBIDDEN_WORDS = [/\brating\b/, /\bconference\b/];

const MODULES = ['competitiveQueries.js', '../../shared/competitiveHistory.js',
  '../../shared/report/competitiveFacts.js'];

describe('the soccer_score firewall', () => {
  it.each(MODULES)('%s names no rating or ranking column', (file) => {
    const src = SOURCE(file);
    // Comments explain why these are excluded; code must not touch them.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const col of ['soccer_score', 'national_ranking', 'recent_win_pct', 'prior_win_pct']) {
      expect(code, `${file} references ${col}`).not.toContain(col);
    }
    for (const w of FORBIDDEN_WORDS) expect(code.match(w)?.[0] ?? null, `${file} matches ${w}`).toBeNull();
  });

  it('reads only programme_seasons and the division on colleges', () => {
    const code = SOURCE('competitiveQueries.js');
    const tables = [...code.matchAll(/FROM\s+(\w+)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual(['colleges', 'programme_seasons']);
    const cols = [...code.matchAll(/SELECT([\s\S]*?)FROM/g)].join(' ');
    expect(cols).not.toMatch(/score|rank|rating|conference|postseason/i);
  });
});

describe('the postseason firewall', () => {
  it.each(MODULES)('%s names no postseason or champion column', (file) => {
    const code = SOURCE(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const col of FORBIDDEN_COLUMNS.filter((c) => c.includes('ps') || c.includes('champion'))) {
      expect(code, `${file} references ${col}`).not.toContain(col);
    }
    expect(code).not.toMatch(/postseason|champion|tournament|bracket/i);
  });

  /**
   * The table itself is the last line of defence: no column exists for any of
   * it, so a future caller cannot select what was never loaded.
   */
  it('the table has no column that could carry one', () => {
    const cols = db.prepare('PRAGMA table_info(programme_seasons)').all().map((c) => c.name);
    expect(cols.sort()).toEqual([
      'college_id', 'confidence', 'draws', 'imported_at', 'losses', 'matches_played',
      'season', 'source', 'source_record_name', 'sport', 'wins',
    ]);
    for (const banned of ['postseason', 'conference', 'goals', 'rating', 'rank', 'champion', 'standing']) {
      expect(cols.some((c) => c.includes(banned)), banned).toBe(false);
    }
  });
});

describe('the table’s own guarantees', () => {
  const insert = (row) => db.prepare(`INSERT INTO programme_seasons
    (college_id, sport, season, wins, draws, losses, matches_played, source, source_record_name, confidence, imported_at)
    VALUES (@college_id, @sport, @season, @wins, @draws, @losses, @matches_played, @source, @source_record_name, @confidence, @imported_at)`).run(row);
  const base = {
    college_id: 'c1', sport: 'mens-soccer', season: 2022, wins: 10, draws: 3, losses: 5,
    matches_played: 18, source: 'test', source_record_name: 'Test', confidence: 'ROSTER_CONSISTENT',
    imported_at: '2026-01-01T00:00:00Z',
  };
  beforeEach(() => db.exec('DELETE FROM programme_seasons'));

  it('accepts a well-formed row', () => { expect(() => insert(base)).not.toThrow(); });

  it('refuses a matches_played that does not equal W+D+L', () => {
    expect(() => insert({ ...base, matches_played: 19 })).toThrow(/CHECK/);
  });
  it('refuses a negative count', () => {
    expect(() => insert({ ...base, wins: -1, matches_played: 7 })).toThrow(/CHECK/);
  });
  it('refuses a season with no matches', () => {
    expect(() => insert({ ...base, wins: 0, draws: 0, losses: 0, matches_played: 0 })).toThrow(/CHECK/);
  });
  it('refuses an unknown confidence value', () => {
    expect(() => insert({ ...base, confidence: 'probably fine' })).toThrow(/CHECK/);
  });
  it('refuses a duplicate programme-season', () => {
    insert(base);
    expect(() => insert(base)).toThrow(/UNIQUE/);
  });
  it('allows the same season for the other sport at the same school', () => {
    insert(base);
    expect(() => insert({ ...base, college_id: 'c2', sport: 'womens-soccer' })).not.toThrow();
  });
});

describe('reading a programme', () => {
  beforeEach(() => {
    db.exec("DELETE FROM programme_seasons; DELETE FROM colleges;");
    db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, soccer_score, national_ranking, recent_win_pct, prior_win_pct, postseason_2025_round, conference_champion_2025)
      VALUES ('c1','x','x','Test College','mens-soccer','NCAA D1', 99.9, 1, 0.99, 0.99, 'champion', 1)`).run();
    const ins = db.prepare(`INSERT INTO programme_seasons
      (college_id, sport, season, wins, draws, losses, matches_played, source, source_record_name, confidence, imported_at)
      VALUES ('c1','mens-soccer',?,?,?,?,?,'test','Test College',?, 'x')`);
    ins.run(2022, 8, 3, 7, 18, 'ROSTER_CONSISTENT');
    ins.run(2023, 10, 3, 5, 18, 'ROSTER_CONSISTENT');
    ins.run(2024, 12, 2, 4, 18, 'ROSTER_CONTRADICTED');
    invalidateCompetitivePools();
  });

  it('returns the history keyed on college_id', () => {
    const h = competitiveHistoryFor('c1');
    expect(h.college).toEqual({ id: 'c1', name: 'Test College', sport: 'mens-soccer', division: 'NCAA D1' });
    expect(h.describes).toEqual([2022, 2023]);
  });

  /**
   * The behavioural half of the firewall: this college carries a perfect
   * soccer_score, a number-one ranking and a national championship, and none of
   * it appears anywhere in the model's output.
   */
  it('ignores every rating, rank and postseason column on the college row', () => {
    const out = JSON.stringify(competitiveHistoryFor('c1'));
    for (const v of ['99.9', '0.99', 'champion']) expect(out).not.toContain(v);
    expect(out).not.toMatch(/soccerScore|nationalRanking|postseason|champion/i);
  });

  it('leaves a roster-contradicted season out of the history and out of the pool', () => {
    const h = competitiveHistoryFor('c1');
    expect(h.unreadableSeasons.map((u) => u.season)).toEqual([2024]);
    const pools = buildCompetitivePools();
    expect(pools.byKey.get('mens-soccer|NCAA D1')[2024]).toBeUndefined();
  });

  it('is null for a college that does not exist', () => {
    expect(competitiveHistoryFor('nope')).toBeNull();
  });

  it('refuses to benchmark against a pool of one', () => {
    const h = competitiveHistoryFor('c1');
    expect(h.seasons[0].benchmark.available).toBe(false);
    expect(h.seasons[0].benchmark.n).toBeLessThan(MIN_POOL);
  });
});

describe('the pool cache', () => {
  beforeEach(() => invalidateCompetitivePools());

  it('is empty until something asks for it', () => {
    expect(competitivePoolStatus()).toBeNull();
    competitivePools();
    expect(competitivePoolStatus()).not.toBeNull();
  });

  it('returns the same object rather than rebuilding', () => {
    expect(competitivePools()).toBe(competitivePools());
  });

  it('groups by sport and division, and by season inside that', () => {
    const p = buildCompetitivePools();
    for (const key of p.byKey.keys()) expect(key).toMatch(/^(mens|womens)-soccer\|/);
  });
});
