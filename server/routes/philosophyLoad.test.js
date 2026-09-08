/**
 * One report request, one programme load.
 *
 * `programReportModel` used to call `philosophyFor` three times — once for
 * itself, once inside `programmeModel` and once inside `fitFor` — and each
 * call re-ran the roster query, the coach query, the squad query and the
 * whole of `programmePhilosophy`. `philosophySummaries` did it twice per
 * school, which at the tab's forty-school ceiling was eighty loads.
 *
 * The counter lives in the test rather than in the module: a production
 * counter would be module-global mutable state, and the thing worth asserting
 * is the call count, not a number the module keeps about itself.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const spy = vi.hoisted(() => ({ loads: 0 }));

vi.mock('../lib/philosophyQueries.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    philosophyFor: (...args) => {
      spy.loads += 1;
      return actual.philosophyFor(...args);
    },
  };
});

const db = (await import('../db/client.js')).default;
const { programReportModel, philosophySummaries, programmeModel, playerProgrammeModel } =
  await import('./philosophy.js');

const now = new Date().toISOString();

function addCollege(id, name) {
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
    VALUES (?,?,?,?,'mens-soccer','NCAA D2','Test Conference','Testville','TS',1)`)
    .run(id, now, now, name);
}

function addPlayer(id) {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, nationality, sport, recruiting_class_year)
    VALUES (?,?,?,'Test Athlete','Defender','New Zealand','mens-soccer',2026)`)
    .run(id, now, now);
}

function addRoster(school) {
  const ins = db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name,
     class_year_label, position, minutes_played, games_played, nationality)
    VALUES (?,?,?,?,'mens-soccer','NCAA D2',?,?,?,?,?,?,?)`);
  let n = 0;
  for (const season of ['2022', '2023', '2024', '2025']) {
    ins.run(`${school}-${n += 1}`, now, now, school, season, `Senior ${season}`, 'Sr.', 'DEFENSE', 1400, 18, 'USA');
    ins.run(`${school}-${n += 1}`, now, now, school, season, `Fresh ${season}`, 'Fr.', 'DEFENSE', 900, 16, 'USA');
    for (let i = 0; i < 10; i += 1) {
      ins.run(`${school}-${n += 1}`, now, now, school, season, `Sub ${i} ${season}`, 'So.', 'MIDFIELD', 300, 10, 'USA');
    }
  }
  for (const s of [2022, 2023, 2024, 2025, 2026]) {
    db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)
      VALUES (?,'mens-soccer',?,'A Coach',?)`).run(school, s, now);
  }
}

beforeEach(() => {
  db.exec('DELETE FROM roster_players; DELETE FROM coach_seasons; DELETE FROM colleges; DELETE FROM players;');
  spy.loads = 0;
});

describe('one request, one programme load', () => {
  it('loads the programme once for a programme-only report', () => {
    addCollege('c1', 'Test College');
    addRoster('Test College');
    programReportModel({ collegeId: 'c1' });
    expect(spy.loads).toBe(1);
  });

  it('loads the programme once for an athlete report', () => {
    addCollege('c1', 'Test College');
    addRoster('Test College');
    addPlayer('p1');
    programReportModel({ collegeId: 'c1', playerId: 'p1' });
    expect(spy.loads).toBe(1);
  });

  it('loads each school once per summaries request, not twice', () => {
    for (const [id, name] of [['c1', 'One College'], ['c2', 'Two College'], ['c3', 'Three College']]) {
      addCollege(id, name);
      addRoster(name);
    }
    addPlayer('p1');
    philosophySummaries({ playerId: 'p1', collegeIds: ['c1', 'c2', 'c3'] });
    expect(spy.loads).toBe(3);
  });

  it('loads once for the standalone programme and player models too', () => {
    addCollege('c1', 'Test College');
    addRoster('Test College');
    addPlayer('p1');

    spy.loads = 0;
    programmeModel({ collegeId: 'c1' });
    expect(spy.loads).toBe(1);

    spy.loads = 0;
    playerProgrammeModel({ collegeId: 'c1', playerId: 'p1' });
    expect(spy.loads).toBe(1);
  });
});

describe('the errors the routes read are unchanged', () => {
  it('still throws Unknown college before touching the roster', () => {
    expect(() => programReportModel({ collegeId: 'nope' })).toThrow(/^Unknown college/);
  });

  it('still throws Unknown player for a missing athlete', () => {
    addCollege('c1', 'Test College');
    addRoster('Test College');
    expect(() => programReportModel({ collegeId: 'c1', playerId: 'nope' })).toThrow(/^Unknown player/);
  });

  // The athlete is resolved before the college in playerProgrammeModel, and
  // the route's 404/400 split reads which error arrives.
  it('reports an unknown player ahead of an unknown college', () => {
    expect(() => playerProgrammeModel({ collegeId: 'nope', playerId: 'nope' }))
      .toThrow(/^Unknown player/);
  });

  it('still refuses a sport mismatch', () => {
    addCollege('c1', 'Test College');
    addRoster('Test College');
    db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, nationality, sport, recruiting_class_year)
      VALUES ('p2',?,?,'Wrong Sport','Defender','USA','womens-soccer',2026)`).run(now, now);
    expect(() => programReportModel({ collegeId: 'c1', playerId: 'p2' })).toThrow(/ plays womens-soccer/);
    expect(() => playerProgrammeModel({ collegeId: 'c1', playerId: 'p2' })).toThrow(/ plays womens-soccer/);
  });
});
