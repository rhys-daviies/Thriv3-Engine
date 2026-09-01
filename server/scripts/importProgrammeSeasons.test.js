/**
 * The loader's refusals.
 *
 * The source is a hand-maintained CSV outside this repository, so the failure
 * modes worth testing are the ones a human editing a spreadsheet actually
 * produces: a renamed column, a blank cell in a triple, a stray word in a
 * number, and a school we cannot identify.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '../db/client.js';
import { run, readSeason, SEASONS, REQUIRED_COLUMNS, CONFIDENCE } from './importProgrammeSeasons.js';

const HEAD = ['name', ...SEASONS.flatMap((y) => [`${y}_W`, `${y}_L`, `${y}_D`])].join(',');
let dir;
const write = (file, rows) => fs.writeFileSync(path.join(dir, file), [HEAD, ...rows].join('\n'));
/**
 * Both files always, because the loader reads both and fails closed on an
 * empty one. The filler row is a school that is not in `colleges`, so it lands
 * in `unmatched` and never in the table.
 */
const FILLER = 'Filler School,1,1,1,1,1,1,1,1,1,1,1,1';
const both = (menRows, womenRows = []) => {
  write('soccer_records.csv', menRows.length ? menRows : [FILLER]);
  write('soccer_records_women.csv', womenRows.length ? womenRows : [FILLER]);
};
const quiet = () => {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-'));
  db.exec('DELETE FROM programme_seasons; DELETE FROM colleges; DELETE FROM roster_players;');
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division)
    VALUES ('c1','x','x','Test College','mens-soccer','NCAA D1')`).run();
});

describe('season parsing', () => {
  const row = (o) => ({ '2022_W': '10', '2022_L': '5', '2022_D': '3', ...o });

  it('reads a complete triple', () => {
    expect(readSeason(row({}), 2022)).toEqual({ ok: true, wins: 10, losses: 5, draws: 3, matches: 18 });
  });

  // Two of three is not two thirds of a season; it is a season we cannot state.
  it('refuses a partial triple rather than assuming the third is zero', () => {
    expect(readSeason(row({ '2022_D': '' }), 2022)).toEqual({ ok: false, reason: 'partial' });
  });

  it('reports an absent season as absent, not as malformed', () => {
    expect(readSeason(row({ '2022_W': '', '2022_L': '', '2022_D': '' }), 2022).reason).toBe('absent');
  });

  it.each([['10.5'], ['ten'], ['-2'], ['1a'], ['1,0']])('refuses %s as a count', (v) => {
    expect(readSeason(row({ '2022_W': v }), 2022).ok).toBe(false);
  });

  // A trailing space in a spreadsheet cell is not corruption.
  it('trims whitespace around a count', () => {
    expect(readSeason(row({ '2022_W': ' 10 ' }), 2022)).toMatchObject({ ok: true, wins: 10 });
  });

  it('refuses a season of no matches at all', () => {
    expect(readSeason(row({ '2022_W': '0', '2022_L': '0', '2022_D': '0' }), 2022).reason).toBe('zero matches');
  });
});

describe('the loader', () => {
  it('loads one row per programme-season and records provenance', () => {
    both(['Test College,10,5,3,11,4,3,12,3,3,13,2,3']);
    const { written } = run({ dir, apply: true, log: quiet });
    expect(written).toBe(4);
    const rows = db.prepare('SELECT * FROM programme_seasons ORDER BY season').all();
    expect(rows.map((r) => r.season)).toEqual(SEASONS);
    expect(rows[0]).toMatchObject({
      college_id: 'c1', sport: 'mens-soccer', wins: 10, losses: 5, draws: 3, matches_played: 18,
      source: 'soccer-records:soccer_records.csv', source_record_name: 'Test College',
      confidence: CONFIDENCE.UNCHECKED,
    });
    expect(rows[0].imported_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('is idempotent — the same source twice is the same table', () => {
    both(['Test College,10,5,3,11,4,3,12,3,3,13,2,3']);
    run({ dir, apply: true, log: quiet });
    const first = db.prepare('SELECT * FROM programme_seasons ORDER BY season').all();
    run({ dir, apply: true, log: quiet });
    const second = db.prepare('SELECT * FROM programme_seasons ORDER BY season').all();
    expect(second.map((r) => ({ ...r, imported_at: null })))
      .toEqual(first.map((r) => ({ ...r, imported_at: null })));
    expect(second).toHaveLength(4);
  });

  it('writes nothing on a dry run', () => {
    both(['Test College,10,5,3,11,4,3,12,3,3,13,2,3']);
    const { rows, written } = run({ dir, apply: false, log: quiet });
    expect(rows).toHaveLength(4);
    expect(written).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_seasons').get().n).toBe(0);
  });

  // Fail closed. A renamed column would otherwise load as a table of absent
  // seasons, which looks exactly like a coverage collapse.
  it('throws on an unexpected source schema rather than loading a hole', () => {
    fs.writeFileSync(path.join(dir, 'soccer_records.csv'), 'name,2022_Wins\nTest College,10');
    write('soccer_records_women.csv', ['W Only,1,1,1,1,1,1,1,1,1,1,1,1']);
    expect(() => run({ dir, apply: false, log: quiet })).toThrow(/missing columns/);
  });

  it('throws on a missing or empty source file', () => {
    expect(() => run({ dir, apply: false, log: quiet })).toThrow(/source missing/);
    fs.writeFileSync(path.join(dir, 'soccer_records.csv'), HEAD);
    write('soccer_records_women.csv', ['W Only,1,1,1,1,1,1,1,1,1,1,1,1']);
    expect(() => run({ dir, apply: false, log: quiet })).toThrow(/source empty/);
  });

  it('names every column it depends on', () => {
    expect(REQUIRED_COLUMNS).toContain('name');
    for (const y of SEASONS) for (const k of ['W', 'L', 'D']) expect(REQUIRED_COLUMNS).toContain(`${y}_${k}`);
  });

  // Identity is exact or it is a gap. Reaching for a fuzzy matcher to close the
  // last fraction of a percent is how Kansas got Central Arkansas's rating.
  it('reports an unmatched school rather than guessing at it', () => {
    both(['Test Collage,10,5,3,11,4,3,12,3,3,13,2,3']);
    const { rows, report } = run({ dir, apply: false, log: quiet });
    expect(rows).toHaveLength(0);
    expect(report.unmatched).toContain('Test Collage [mens-soccer]');
  });

  it('does not match a school across sports', () => {
    both([], ['Test College,10,5,3,11,4,3,12,3,3,13,2,3']);
    const { report } = run({ dir, apply: false, log: quiet });
    expect(report.unmatched).toContain('Test College [womens-soccer]');
  });

  it('reports a duplicate source name once and loads it once', () => {
    both(['Test College,10,5,3,11,4,3,12,3,3,13,2,3', 'Test College,1,1,1,1,1,1,1,1,1,1,1,1']);
    const { rows, report } = run({ dir, apply: false, log: quiet });
    expect(report.duplicates).toEqual(['soccer_records.csv: Test College']);
    expect(rows).toHaveLength(4);
    expect(rows[0].wins).toBe(10);
  });

  it('reports a malformed season and loads the others', () => {
    both(['Test College,10,5,,11,4,3,12,3,3,13,2,3']);
    const { rows, report } = run({ dir, apply: false, log: quiet });
    expect(report.malformed).toEqual(['Test College [mens-soccer] 2022: partial']);
    expect(rows.map((r) => r.season)).toEqual([2023, 2024, 2025]);
  });
});

describe('roster cross-check', () => {
  const roster = (season, games) => db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name, games_played)
    VALUES (?, 'x','x','Test College','mens-soccer','NCAA D1',?,?,?)`)
    .run(`r${season}${games}`, season, `P${games}`, games);

  it('marks a season consistent where no player exceeds the match count', () => {
    roster('2022', 18);
    both(['Test College,10,5,3,11,4,3,12,3,3,13,2,3']);
    run({ dir, apply: true, log: quiet });
    expect(db.prepare('SELECT confidence FROM programme_seasons WHERE season=2022').get().confidence)
      .toBe(CONFIDENCE.CONSISTENT);
  });

  /**
   * Nobody plays in more matches than their team did. Where the roster says
   * otherwise the two internal sources contradict each other, and the row is
   * kept with the contradiction recorded rather than deleted or corrected.
   */
  it('marks a season contradicted where a player logged more appearances', () => {
    roster('2022', 22);
    both(['Test College,10,5,3,11,4,3,12,3,3,13,2,3']);
    const { report } = run({ dir, apply: true, log: quiet });
    expect(db.prepare('SELECT confidence FROM programme_seasons WHERE season=2022').get().confidence)
      .toBe(CONFIDENCE.CONTRADICTED);
    expect(report.contradicted[0]).toMatch(/record says 18 matches, a player logged 22/);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_seasons').get().n).toBe(4);
  });

  /**
   * `roster_players.season` has TEXT affinity and a writer binding a number
   * lands '2022.0'. The cross-check must survive that: a key built by string
   * interpolation missed every row and marked the whole table UNCHECKED, which
   * is a silent loss of the only corroboration this loader has.
   */
  it('cross-checks whatever spelling the season column holds', () => {
    roster(2022, 22);
    expect(db.prepare('SELECT season FROM roster_players').get().season).toBe('2022.0');
    both(['Test College,10,5,3,11,4,3,12,3,3,13,2,3']);
    run({ dir, apply: true, log: quiet });
    expect(db.prepare('SELECT confidence FROM programme_seasons WHERE season=2022').get().confidence)
      .toBe(CONFIDENCE.CONTRADICTED);
  });

  it('marks a season unchecked where there is no roster to check against', () => {
    both(['Test College,10,5,3,11,4,3,12,3,3,13,2,3']);
    run({ dir, apply: true, log: quiet });
    expect(db.prepare('SELECT confidence FROM programme_seasons WHERE season=2025').get().confidence)
      .toBe(CONFIDENCE.UNCHECKED);
  });
});
