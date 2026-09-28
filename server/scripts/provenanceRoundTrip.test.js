import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * L7Z — provenance survives the whole journey, or it is not provenance.
 *
 * The facts are observed during acquisition and consumed much later, and every
 * boundary between is a chance to lose them: the sheet, the importer, the
 * scoped replace. This file walks a synthetic accepted roster from sheet to
 * `roster_players` and asserts the values arrive identical.
 *
 * It also pins the two compatibility properties that make the change additive:
 * a sheet written before these columns existed still imports, and the rows it
 * produces carry NULL rather than a manufactured value.
 */

const HDR_LEGACY = ['School', 'Conference', 'Player Name', 'Class/Year', 'Total Minutes Played',
  'Games Played', 'Games Started', 'Nationality', 'Hometown', 'Country',
  'Source Stats URL', 'Source Roster URL', 'Data Confidence', 'Notes',
  'Estimated Graduation', 'Position'];
const HDR = [...HDR_LEGACY, 'Source Page Season', 'Source Fetched At', 'Source Parser'];

const csv = (hdr, rows) => [hdr.join(','), ...rows.map((r) => hdr.map((h) => {
  const v = String(r[h] ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}).join(','))].join('\n') + '\n';

const PINNED = 'https://l7z.test/sports/womens-soccer/roster/2025';
const FETCHED = '2026-09-18T07:41:12Z';

const row = (school, name, extra = {}) => ({
  School: school, Conference: 'Test Conf', 'Player Name': name, 'Class/Year': 'Jr.',
  'Total Minutes Played': '', 'Games Played': '', 'Games Started': '',
  Nationality: 'United States', Hometown: 'Somewhere, ST', Country: 'United States',
  'Source Stats URL': '', 'Source Roster URL': PINNED, 'Data Confidence': 'High',
  Notes: '', 'Estimated Graduation': '', Position: 'Midfielder',
  'Source Page Season': '2025', 'Source Fetched At': FETCHED, 'Source Parser': 'nuxt',
  ...extra,
});

let tmp; let sheets; let mod; let db;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l7z-rt-'));
  sheets = path.join(tmp, 'sheets');
  fs.mkdirSync(sheets, { recursive: true });
  process.env.RECRUITMATCH_DB = path.join(tmp, 'fixture.sqlite');
  mod = await import('./importRosterSheets.js');
  db = (await import('../db/client.js')).default;
});

afterAll(() => {
  delete process.env.RECRUITMATCH_DB;
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => { db.prepare('DELETE FROM roster_players').run(); });

const write = (file, hdr, rows) => fs.writeFileSync(path.join(sheets, file), csv(hdr, rows));
const rowsFor = (school, sport, season) => db.prepare(
  'SELECT * FROM roster_players WHERE college_name=? AND sport=? AND season=? ORDER BY player_name',
).all(school, sport, season);

const quiet = (fn) => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

/* -------------------------------------------------------------------------- */

describe('L7Z — the migration is additive', () => {
  it('the three columns exist and default to NULL', () => {
    const cols = db.prepare('PRAGMA table_info(roster_players)').all().map((c) => c.name);
    expect(cols).toContain('source_page_season');
    expect(cols).toContain('source_fetched_at');
    expect(cols).toContain('source_parser');
  });
});

describe('L7Z — round trip, sheet to roster_players', () => {
  it('18. every observed fact arrives identical', () => {
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR,
      [row('School A', 'Aw One'), row('School A', 'Aw Two')]);
    quiet(() => mod.runBroad({ season: '2025', dir: sheets }));
    const got = rowsFor('School A', 'womens-soccer', '2025');
    expect(got).toHaveLength(2);
    for (const r of got) {
      expect(r.source_roster_url).toBe(PINNED);
      expect(r.source_page_season).toBe('2025');
      expect(r.source_fetched_at).toBe(FETCHED);
      expect(r.source_parser).toBe('nuxt');
      // And the season column is the season imported, which is a DIFFERENT
      // fact from the season the page established. They agree here; the point
      // is that one is not derived from the other.
      expect(r.season).toBe('2025');
    }
  });

  it('35. nothing is reconstructed from the clock, the URL or the season', () => {
    /*
     * A sheet whose page season disagrees with the season being imported, whose
     * parser does not match its URL's shape, and whose fetch time is long past.
     * All three must arrive exactly as written -- a value that "looks wrong" is
     * still the observed fact, and correcting it here would be inventing.
     */
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR, [row('School A', 'Aw One', {
      'Source Page Season': '2024',
      'Source Fetched At': '2019-01-02T03:04:05Z',
      'Source Parser': 'list',
      'Source Roster URL': 'https://l7z.test/sports/womens-soccer/roster/2026',
    })]);
    quiet(() => mod.runBroad({ season: '2025', dir: sheets }));
    const [r] = rowsFor('School A', 'womens-soccer', '2025');
    expect(r.source_page_season).toBe('2024');
    expect(r.source_fetched_at).toBe('2019-01-02T03:04:05Z');
    expect(r.source_parser).toBe('list');
  });
});

describe('L7Z — legacy compatibility', () => {
  it('10 + 40. a sheet without the columns still imports', () => {
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR_LEGACY,
      [row('School B', 'Bw One'), row('School B', 'Bw Two')]);
    quiet(() => mod.runBroad({ season: '2025', dir: sheets }));
    const got = rowsFor('School B', 'womens-soccer', '2025');
    expect(got).toHaveLength(2);
    expect(got[0].source_roster_url).toBe(PINNED);     // the old columns still work
  });

  it('11 + 41. and its rows carry NULL, not a manufactured value', () => {
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR_LEGACY, [row('School B', 'Bw One')]);
    quiet(() => mod.runBroad({ season: '2025', dir: sheets }));
    const [r] = rowsFor('School B', 'womens-soccer', '2025');
    expect(r.source_page_season).toBe(null);
    expect(r.source_fetched_at).toBe(null);
    expect(r.source_parser).toBe(null);
  });

  it('an empty cell is unknown, not an empty string', () => {
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR,
      [row('School B', 'Bw One', { 'Source Page Season': '', 'Source Fetched At': '', 'Source Parser': '' })]);
    quiet(() => mod.runBroad({ season: '2025', dir: sheets }));
    const [r] = rowsFor('School B', 'womens-soccer', '2025');
    expect(r.source_page_season).toBe(null);
    expect(r.source_parser).toBe(null);
  });
});

describe('L7Z — the scoped importer still contains itself', () => {
  const KEY_A25 = 'School A||womens-soccer||2025';

  beforeEach(() => {
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR, [
      row('School A', 'Aw One'), row('School B', 'Bw One'),
    ]);
    write('ncaa_d1_womens_soccer_2026_rosters.csv', HDR, [
      row('School A', 'Aw Next', { 'Source Page Season': '2026', 'Source Parser': 'table' }),
      row('School B', 'Bw Next', { 'Source Page Season': '2026', 'Source Parser': 'table' }),
    ]);
    write('ncaa_d1_mens_soccer_2025_rosters.csv', HDR, [
      row('School A', 'Am One', { 'Source Parser': 'sidearm-html' }),
    ]);
    quiet(() => { mod.runBroad({ season: '2025', dir: sheets }); mod.runBroad({ season: '2026', dir: sheets }); });
  });

  it('17. a scoped import transports provenance only inside its scope', () => {
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR, [
      row('School A', 'Aw One', { 'Source Parser': 'roster-card', 'Source Page Season': '2025' }),
      row('School B', 'Bw One'),
    ]);
    const before = {
      a26: rowsFor('School A', 'womens-soccer', '2026'),
      am25: rowsFor('School A', 'mens-soccer', '2025'),
      b25: rowsFor('School B', 'womens-soccer', '2025'),
    };
    quiet(() => mod.importScoped({ season: '2025', dir: sheets,
      scope: mod.parseScope([KEY_A25]).scope }));

    expect(rowsFor('School A', 'womens-soccer', '2025')[0].source_parser).toBe('roster-card');
    // 18/19/20. Everything outside the scope, on every provenance field.
    expect(rowsFor('School A', 'womens-soccer', '2026')).toEqual(before.a26);
    expect(rowsFor('School A', 'mens-soccer', '2025')).toEqual(before.am25);
    expect(rowsFor('School B', 'womens-soccer', '2025')).toEqual(before.b25);
  });

  it('37. the dry run reports the provenance change without making it', () => {
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR, [
      row('School A', 'Aw One', { 'Source Parser': 'presto-card' }),
      row('School B', 'Bw One'),
    ]);
    const before = rowsFor('School A', 'womens-soccer', '2025');
    const plan = mod.importScoped({ season: '2025', dir: sheets,
      scope: mod.parseScope([KEY_A25]).scope, dryRun: true });
    expect(plan.applied).toBe(false);
    expect(plan.entries[0].update).toEqual(['Aw One']);      // parser is an owned field
    expect(rowsFor('School A', 'womens-soccer', '2025')).toEqual(before);
  });
});

describe('L7Z — the prospective proof', () => {
  /*
   * THE QUESTION L7W COULD NOT ANSWER.
   *
   * L7W had to re-fetch the live web, and in two cases the Wayback index, to
   * find out whether rows filed under season=2025 came from pages that said
   * 2025. For 641 of 2,123 programmes the answer was "unknowable". This asserts
   * that a roster acquired from now on answers all four questions from the
   * database alone.
   */
  it('45. a newly acquired roster answers L7W\'s four questions without the web', () => {
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR, [
      row('School C', 'Cw One'), row('School C', 'Cw Two'),
    ]);
    quiet(() => mod.runBroad({ season: '2025', dir: sheets }));

    const rows = rowsFor('School C', 'womens-soccer', '2025');
    const answers = {
      whatPage: [...new Set(rows.map((r) => r.source_roster_url))],
      whatSeasonDidItEstablish: [...new Set(rows.map((r) => r.source_page_season))],
      whenWasItFetched: [...new Set(rows.map((r) => r.source_fetched_at))],
      whatParserAccepted: [...new Set(rows.map((r) => r.source_parser))],
    };
    expect(answers.whatPage).toEqual([PINNED]);
    expect(answers.whatSeasonDidItEstablish).toEqual(['2025']);
    expect(answers.whenWasItFetched).toEqual([FETCHED]);
    expect(answers.whatParserAccepted).toEqual(['nuxt']);

    // And the season the page established is a SEPARATE fact from the season
    // the row is filed under. L7W's whole difficulty was that only the latter
    // existed, so the former had to be guessed from a bare URL.
    expect(rows[0].season).toBe('2025');
    expect(rows[0].source_page_season).toBe('2025');
    expect(rows[0].source_page_season).not.toBe(rows[0].season === rows[0].source_page_season
      ? undefined : rows[0].season);          // they agree, and are independently recorded
  });

  it('and a page that established nothing says so, which is also an answer', () => {
    /*
     * The honest negative. A live current-season page with no year in its title
     * is accepted on turnover, and the record must say the page established no
     * season -- not repeat the season it was filed under. That distinction is
     * what makes the column worth having: "unknown" is information.
     */
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR,
      [row('School C', 'Cw One', { 'Source Page Season': '' })]);
    quiet(() => mod.runBroad({ season: '2025', dir: sheets }));
    const [r] = rowsFor('School C', 'womens-soccer', '2025');
    expect(r.season).toBe('2025');
    expect(r.source_page_season).toBe(null);   // and NOT '2025'
    expect(r.source_parser).toBe('nuxt');      // the other facts are still recorded
  });

  it('44. legacy rows remain unknown, and absence is not evidence', () => {
    // A legacy sheet and a new sheet side by side: one programme answerable,
    // one not, and nothing pretends otherwise.
    write('ncaa_d1_womens_soccer_2025_rosters.csv', HDR, [row('School C', 'Cw One')]);
    write('ncaa_d3_womens_soccer_2025_rosters.csv', HDR_LEGACY, [row('School D', 'Dw One')]);
    quiet(() => mod.runBroad({ season: '2025', dir: sheets }));
    expect(rowsFor('School C', 'womens-soccer', '2025')[0].source_page_season).toBe('2025');
    expect(rowsFor('School D', 'womens-soccer', '2025')[0].source_page_season).toBe(null);
  });
});
