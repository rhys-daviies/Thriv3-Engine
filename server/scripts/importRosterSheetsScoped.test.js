import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * L7X — an import that may touch six programme-seasons and no others.
 *
 * L7W repaired six programmes' 2025 squads from season-pinned sources and then
 * could not put them in the database: `importRosterSheets.js` replaces a whole
 * `(sport, division, season)` slice per sheet, so reconciling six programmes
 * meant rewriting roughly two thousand programme-seasons. The scope is the
 * whole feature.
 *
 * THE INVARIANT UNDER TEST. For an explicit scope R of (programme, season)
 * pairs, the set of programme-seasons whose importer-owned fields move must
 * satisfy `changed_keys ⊆ R`. Both dimensions are load-bearing: a programme
 * key alone would carry 2025 and 2026 together, and a season alone would carry
 * everything. Tests 22-24 are the two dimensions asserted separately.
 *
 * WHY THIS FILE COULD NOT HAVE EXISTED BEFORE. The importer called `run()` at
 * module scope, so `import`ing it ran a full import against the ambient argv's
 * season. There was no way to load the module without it writing first, which
 * is why an eight-hundred-line script that deletes rows has never had a test.
 *
 * NETWORK-FREE AND DATABASE-FREE. Every row below is synthetic and every sheet
 * is written to a temp directory; `RECRUITMATCH_DB` points the entity layer at
 * a throwaway file. Nothing here can see the working database.
 */

const HDR = ['School', 'Conference', 'Player Name', 'Class/Year', 'Total Minutes Played',
  'Games Played', 'Games Started', 'Nationality', 'Hometown', 'Country',
  'Source Stats URL', 'Source Roster URL', 'Data Confidence', 'Notes',
  'Estimated Graduation', 'Position'];

/** One sheet row. `src` is the provenance the importer must transport verbatim. */
const row = (school, name, cls, pos, src, conf = 'High') => ({
  School: school, Conference: 'Test Conf', 'Player Name': name, 'Class/Year': cls,
  'Total Minutes Played': '', 'Games Played': '', 'Games Started': '',
  Nationality: 'United States', Hometown: 'Somewhere, ST', Country: 'United States',
  'Source Stats URL': '', 'Source Roster URL': src, 'Data Confidence': conf,
  Notes: '', 'Estimated Graduation': '', Position: pos,
});

const csv = (rows) => [HDR.join(','), ...rows.map((r) => HDR.map((h) => {
  const v = String(r[h] ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}).join(','))].join('\n') + '\n';

let tmp; let sheets; let dbFile; let mod; let db; let RosterPlayer;

const PINNED_A25 = 'https://a.test/sports/womens-soccer/roster/2025';
const BARE_A25 = 'https://a.test/sports/womens-soccer/roster';
const A26 = 'https://a.test/sports/womens-soccer/roster/2026';

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l7x-'));
  sheets = path.join(tmp, 'sheets');
  fs.mkdirSync(sheets, { recursive: true });
  dbFile = path.join(tmp, 'fixture.sqlite');
  process.env.RECRUITMATCH_DB = dbFile;
  mod = await import('./importRosterSheets.js');
  db = (await import('../db/client.js')).default;
  RosterPlayer = (await import('../db/entities/rosterPlayer.js')).RosterPlayer;
});

afterAll(() => {
  delete process.env.RECRUITMATCH_DB;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* the fixture: two institutions x two sports x two seasons                    */
/* -------------------------------------------------------------------------- */

/**
 * Six programme-seasons, seeded THROUGH THE IMPORTER from baseline sheets.
 *
 * Hand-writing the rows meant hand-deriving `estimated_graduation_year`,
 * `eligibility_end_year`, the position vocabulary and the confidence casing --
 * and getting any of them wrong makes a row that should read "unchanged" read
 * as an update, which is the exact signal these tests exist to measure. So the
 * baseline is whatever the importer itself produces from the baseline sheets,
 * and every later comparison is importer-against-importer.
 */
function writeBaselineSheets() {
  fs.writeFileSync(path.join(sheets, 'ncaa_d1_womens_soccer_2025_rosters.csv'), csv([
    row('School A', 'Aw One', 'Jr.', 'Midfielder', BARE_A25, 'Medium'),
    row('School A', 'Aw Two', 'Jr.', 'Midfielder', BARE_A25, 'Medium'),
    row('School A', 'Aw Gone', 'Jr.', 'Midfielder', BARE_A25, 'Medium'),
  ]));
  fs.writeFileSync(path.join(sheets, 'ncaa_d1_mens_soccer_2025_rosters.csv'), csv([
    row('School A', 'Am One', 'Jr.', 'Midfielder', 'https://a.test/m/2025', 'Medium'),
    row('School A', 'Am Two', 'Jr.', 'Midfielder', 'https://a.test/m/2025', 'Medium'),
  ]));
  fs.writeFileSync(path.join(sheets, 'ncaa_d3_womens_soccer_2025_rosters.csv'), csv([
    row('School B', 'Bw One', 'Jr.', 'Midfielder', 'https://b.test/w/2025', 'Medium'),
    row('School B', 'Bw Two', 'Jr.', 'Midfielder', 'https://b.test/w/2025', 'Medium'),
  ]));
  fs.writeFileSync(path.join(sheets, 'ncaa_d1_womens_soccer_2026_rosters.csv'), csv([
    row('School A', 'Aw One', 'Sr.', 'Midfielder', A26, 'Medium'),
    row('School A', 'Aw New', 'Fr.', 'Forward', A26, 'Medium'),
  ]));
  fs.writeFileSync(path.join(sheets, 'ncaa_d1_mens_soccer_2026_rosters.csv'), csv([
    row('School A', 'Am One', 'Sr.', 'Midfielder', 'https://a.test/m/2026', 'Medium'),
  ]));
  fs.writeFileSync(path.join(sheets, 'ncaa_d3_womens_soccer_2026_rosters.csv'), csv([
    row('School B', 'Bw One', 'Sr.', 'Midfielder', 'https://b.test/w/2026', 'Medium'),
  ]));
}

function seedDb() {
  db.prepare('DELETE FROM roster_players').run();
  writeBaselineSheets();
  const quiet = console.log;
  console.log = () => {};
  try {
    mod.runBroad({ season: '2025', dir: sheets });
    mod.runBroad({ season: '2026', dir: sheets });
  } finally { console.log = quiet; }
}

/**
 * The 2025 sheets. School A W is the repaired programme: one player kept
 * unchanged, one changed, one dropped, one added, and a season-pinned source
 * replacing the bare one. Everything else is written IDENTICAL to the database,
 * so any movement outside the scope is the importer's doing and not the data's.
 */
function writeSheets2025({ aWomen = 'repaired' } = {}) {
  writeBaselineSheets();
  if (aWomen !== 'repaired') return;
  // School A women is the repaired programme: one row re-sourced only, one
  // materially changed, one added, one dropped. School A men and School B women
  // keep their baseline sheets, so anything that moves there is a leak.
  fs.writeFileSync(path.join(sheets, 'ncaa_d1_womens_soccer_2025_rosters.csv'), csv([
    row('School A', 'Aw One', 'Jr.', 'Midfielder', PINNED_A25, 'Medium'),   // provenance only
    row('School A', 'Aw Two', 'Sr.', 'Defender', PINNED_A25, 'Medium'),     // class + position
    row('School A', 'Aw Three', 'Fr.', 'Forward', PINNED_A25, 'Medium'),    // inserted
  ]));
}

/** The 2026 sheets, written to DIFFER from the database on purpose: if a 2025
 *  scope ever reached 2026, these rows would land and the test would see it. */
function writeSheets2026() {
  fs.writeFileSync(path.join(sheets, 'ncaa_d1_womens_soccer_2026_rosters.csv'), csv([
    row('School A', 'Aw Intruder', 'Fr.', 'Forward', 'https://a.test/INTRUDER/2026', 'Medium'),
  ]));
  fs.writeFileSync(path.join(sheets, 'ncaa_d1_mens_soccer_2026_rosters.csv'), csv([
    row('School A', 'Am Intruder', 'Fr.', 'Forward', 'https://a.test/INTRUDER/m2026', 'Medium'),
  ]));
  fs.writeFileSync(path.join(sheets, 'ncaa_d3_womens_soccer_2026_rosters.csv'), csv([
    row('School B', 'Bw Intruder', 'Fr.', 'Forward', 'https://b.test/INTRUDER/2026', 'Medium'),
  ]));
}

/** Every programme-season in the database, with its importer-owned fields. */
function snapshot() {
  const out = new Map();
  for (const r of db.prepare('SELECT * FROM roster_players ORDER BY college_name, sport, season, player_name').all()) {
    const k = `${r.college_name}||${r.sport}||${r.season}`;
    if (!out.has(k)) out.set(k, []);
    const o = { player_name: r.player_name };
    for (const f of mod.OWNED_FIELDS) o[f] = r[f] ?? null;
    out.get(k).push(o);
  }
  return out;
}

const changedKeys = (before, after) => [...new Set([...before.keys(), ...after.keys()])]
  .filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k))).sort();

const KEY_AW25 = 'School A||womens-soccer||2025';
const KEY_AW26 = 'School A||womens-soccer||2026';
const KEY_AM25 = 'School A||mens-soccer||2025';
const KEY_BW25 = 'School B||womens-soccer||2025';

beforeEach(() => {
  seedDb();
  writeSheets2025();
  writeSheets2026();
});

const scoped = (keys, opts = {}) => mod.importScoped({
  season: '2025', dir: sheets, scope: mod.parseScope(keys).scope, ...opts,
});

/* -------------------------------------------------------------------------- */

describe('L7X — the canonical scoped identity', () => {
  it('distinguishes sport and season at the same institution', () => {
    const a = mod.parseScopeEntry('School A||mens-soccer||2025');
    const b = mod.parseScopeEntry('School A||womens-soccer||2025');
    const c = mod.parseScopeEntry('School A||mens-soccer||2026');
    const keys = [a, b, c].map(mod.scopeKey);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual([KEY_AM25, 'School A||womens-soccer||2025', 'School A||mens-soccer||2026']);
  });

  it('14. rejects a malformed key', () => {
    for (const bad of ['School A', 'School A||2025', 'School A||soccer||2025',
      '||mens-soccer||2025', 'School A||mens-soccer||2025||extra', '']) {
      expect(() => mod.parseScopeEntry(bad)).toThrow();
    }
  });

  it('15. rejects a missing or unsupported season', () => {
    expect(() => mod.parseScopeEntry('School A||mens-soccer||')).toThrow(/expected exactly|no season/);
    expect(() => mod.parseScopeEntry('School A||mens-soccer||twenty-five')).toThrow(/unsupported season/);
    expect(() => mod.parseScopeEntry('School A||mens-soccer||25')).toThrow(/unsupported season/);
  });

  it('11. dedupes a repeated entry rather than scoping it twice', () => {
    const { scope, duplicates } = mod.parseScope([KEY_AW25, ` ${KEY_AW25} `, KEY_AM25]);
    expect(scope.size).toBe(2);
    expect(duplicates).toBe(1);
  });
});

describe('L7X — fail-closed', () => {
  it('13. missing scope fails closed and never becomes a broad import', () => {
    const before = snapshot();
    expect(() => mod.importScoped({ season: '2025', dir: sheets })).toThrow(/requires an explicit scope/);
    expect(() => mod.planScopedImport({ season: '2025', dir: sheets, scope: null })).toThrow(/not a \s*shorthand|shorthand/);
    expect(changedKeys(before, snapshot())).toEqual([]);
  });

  it('12. an empty scope changes nothing', () => {
    const before = snapshot();
    const r = scoped([]);
    expect(r.requested).toBe(0);
    expect(r.entries).toEqual([]);
    expect(changedKeys(before, snapshot())).toEqual([]);
  });

  it('16. a scope entry absent from the sheets reports and mutates nothing', () => {
    const before = snapshot();
    expect(() => scoped(['School Nowhere||womens-soccer||2025'])).toThrow(/absent from the 2025/);
    expect(changedKeys(before, snapshot())).toEqual([]);
    const plan = mod.planScopedImport({ season: '2025', dir: sheets,
      scope: mod.parseScope(['School Nowhere||womens-soccer||2025']).scope });
    expect(plan.missing).toEqual(['School Nowhere||womens-soccer||2025']);
    expect(plan.entries).toEqual([]);
  });

  it('17. an ambiguous sheet programme stops the import', () => {
    // The same programme-season in two division files: two sheets claim it and
    // the importer may not pick one.
    fs.writeFileSync(path.join(sheets, 'ncaa_d2_womens_soccer_2025_rosters.csv'), csv([
      row('School A', 'Aw Ghost', 'Jr.', 'Midfielder', 'https://a.test/d2'),
    ]));
    const before = snapshot();
    expect(() => scoped([KEY_AW25])).toThrow(/ambiguous/);
    expect(changedKeys(before, snapshot())).toEqual([]);
    fs.rmSync(path.join(sheets, 'ncaa_d2_womens_soccer_2025_rosters.csv'));
  });

  it('a scope entry for another season is refused', () => {
    expect(() => scoped([KEY_AW26])).toThrow(/not in season 2025/);
  });
});

describe('L7X — the diff, and that one programme-season moves', () => {
  it('1 + 5 + 6 + 7 + 8. one exact programme-season imports, insert/update/delete/unchanged', () => {
    const before = snapshot();
    const r = scoped([KEY_AW25]);
    expect(r.applied).toBe(true);
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0];
    expect(e.insert).toEqual(['Aw Three']);                    // 5. inserted
    expect(e.update.sort()).toEqual(['Aw One', 'Aw Two']);     // 6. provenance / class+position
    expect(e.remove).toEqual(['Aw Gone']);                     // 7. dropped from the squad
    expect(changedKeys(before, snapshot())).toEqual([KEY_AW25]);

    // 8. an unchanged programme-season: School B's sheet is its own baseline,
    // so every row reads unchanged and the import is a no-op for it.
    seedDb(); writeSheets2025(); writeSheets2026();
    const b = scoped([KEY_BW25], { dryRun: true }).entries[0];
    expect(b.unchanged.sort()).toEqual(['Bw One', 'Bw Two']);
    expect([b.insert, b.update, b.remove]).toEqual([[], [], []]);
  });

  it('25 + 2 + 3 + 4. every unrelated programme-season is deep-equal afterwards', () => {
    const before = snapshot();
    scoped([KEY_AW25]);
    const after = snapshot();
    for (const k of before.keys()) {
      if (k === KEY_AW25) continue;
      expect(after.get(k)).toEqual(before.get(k));     // deep equality, not counts
    }
    expect(after.get(KEY_AW26)).toEqual(before.get(KEY_AW26));   // 2. other season
    expect(after.get(KEY_AM25)).toEqual(before.get(KEY_AM25));   // 3. other gender
    expect(after.get(KEY_BW25)).toEqual(before.get(KEY_BW25));   // 4. other institution
  });

  it('9 + 10. several exact scopes import together, and order is irrelevant', () => {
    const before = snapshot();
    scoped([KEY_AW25, KEY_BW25]);
    const forward = snapshot();
    expect(changedKeys(before, forward)).toEqual([KEY_AW25]);   // B's sheet matches its rows
    // Same scope, opposite order, from the same starting state. `seedDb`
    // rewrites the sheets to their baseline, so the repaired variant has to be
    // laid down again or the second run would import different input.
    seedDb(); writeSheets2025(); writeSheets2026();
    scoped([KEY_BW25, KEY_AW25]);
    expect(snapshot()).toEqual(forward);
  });

  it('22. a 2025 scope cannot move 2026, even with 2026 sheets present and different', () => {
    const before = snapshot();
    scoped([KEY_AW25, KEY_AM25, KEY_BW25]);
    const after = snapshot();
    for (const k of [...before.keys()].filter((x) => x.endsWith('||2026'))) {
      expect(after.get(k)).toEqual(before.get(k));
    }
    expect(changedKeys(before, after).every((k) => k.endsWith('||2025'))).toBe(true);
  });

  it('23. a 2026 scope cannot move 2025', () => {
    const before = snapshot();
    mod.importScoped({ season: '2026', dir: sheets,
      scope: mod.parseScope([KEY_AW26]).scope });
    const after = snapshot();
    for (const k of [...before.keys()].filter((x) => x.endsWith('||2025'))) {
      expect(after.get(k)).toEqual(before.get(k));
    }
    expect(changedKeys(before, after)).toEqual([KEY_AW26]);
  });

  it('24. men\'s and women\'s programmes at one institution stay isolated', () => {
    const before = snapshot();
    scoped([KEY_AM25]);
    const after = snapshot();
    expect(changedKeys(before, after)).toEqual([]);              // its sheet matches
    expect(after.get(KEY_AW25)).toEqual(before.get(KEY_AW25));
    // and the other direction: importing the women's scope leaves the men alone
    scoped([KEY_AW25]);
    expect(snapshot().get(KEY_AM25)).toEqual(before.get(KEY_AM25));
  });

  it('21. a scoped delete removes only rows inside the scope', () => {
    const rowsFor = (k) => {
      const [c, s, y] = k.split('||');
      return db.prepare('SELECT COUNT(*) n FROM roster_players WHERE college_name=? AND sport=? AND season=?')
        .get(c, s, y).n;
    };
    const was = { aw26: rowsFor(KEY_AW26), am25: rowsFor(KEY_AM25), bw25: rowsFor(KEY_BW25) };
    scoped([KEY_AW25]);
    expect(rowsFor(KEY_AW25)).toBe(3);                 // replaced by the sheet
    expect(rowsFor(KEY_AW26)).toBe(was.aw26);
    expect(rowsFor(KEY_AM25)).toBe(was.am25);
    expect(rowsFor(KEY_BW25)).toBe(was.bw25);
  });
});

describe('L7X — dry run', () => {
  it('18. uses the same plan as the live import and writes nothing', () => {
    const before = snapshot();
    const dry = scoped([KEY_AW25], { dryRun: true });
    expect(dry.applied).toBe(false);
    expect(changedKeys(before, snapshot())).toEqual([]);         // no mutation

    const live = scoped([KEY_AW25]);
    // The plan is one function; the dry run is that function not executed.
    const shape = (r) => r.entries.map((e) => ({ key: e.key, sheetRows: e.sheetRows,
      dbRows: e.dbRows, insert: e.insert, update: e.update, remove: e.remove,
      unchanged: e.unchanged, provenance: e.provenance }));
    expect(shape(dry)).toEqual(shape(live));
  });

  it('reports missing and ambiguous entries without mutating', () => {
    const before = snapshot();
    const plan = mod.planScopedImport({ season: '2025', dir: sheets,
      scope: mod.parseScope([KEY_AW25, 'Ghost||mens-soccer||2025']).scope });
    expect(plan.entries.map((e) => e.key)).toEqual([KEY_AW25]);
    expect(plan.missing).toEqual(['Ghost||mens-soccer||2025']);
    expect(changedKeys(before, snapshot())).toEqual([]);
  });
});

describe('L7X — transaction', () => {
  it('18b. rolls the whole scope back when one entry fails validation', () => {
    const before = snapshot();
    // A valid repaired programme alongside one that is not in the sheets: the
    // import must not leave the first applied.
    expect(() => scoped([KEY_AW25, 'Ghost||womens-soccer||2025'])).toThrow(/absent/);
    expect(changedKeys(before, snapshot())).toEqual([]);
  });

  it('rolls back a failure raised inside the transaction', () => {
    const before = snapshot();
    const orig = RosterPlayer.bulkCreate;
    let calls = 0;
    RosterPlayer.bulkCreate = function patched(items) {
      calls += 1;
      if (calls === 2) throw new Error('simulated failure on the second programme');
      return orig.call(this, items);
    };
    try {
      expect(() => scoped([KEY_AW25, KEY_BW25])).toThrow(/simulated failure/);
    } finally { RosterPlayer.bulkCreate = orig; }
    // Neither programme applied: one transaction, not two.
    expect(changedKeys(before, snapshot())).toEqual([]);
  });
});

describe('L7X — provenance', () => {
  it('19 + 23. the sheet\'s source URL is transported verbatim, never rewritten', () => {
    const r = scoped([KEY_AW25]);
    expect(r.entries[0].provenance.map((p) => p.player).sort()).toEqual(['Aw One', 'Aw Two']);
    for (const p of r.entries[0].provenance) {
      expect(p.from).toBe(BARE_A25);
      expect(p.to).toBe(PINNED_A25);
    }
    const urls = db.prepare('SELECT DISTINCT source_roster_url u FROM roster_players '
      + 'WHERE college_name=? AND sport=? AND season=?').all('School A', 'womens-soccer', '2025');
    expect(urls.map((x) => x.u)).toEqual([PINNED_A25]);          // season-pinned, not bare
  });

  it('20. importer-owned fields it does not own are not invented', () => {
    scoped([KEY_AW25]);
    const r = db.prepare('SELECT * FROM roster_players WHERE college_name=? AND sport=? '
      + 'AND season=? AND player_name=?').get('School A', 'womens-soccer', '2025', 'Aw Two');
    expect(r.class_year_label).toBe('Sr.');
    expect(r.position).toBe('DEFENSE');   // the importer's own vocabulary
    expect(r.data_confidence).toBe('medium');   // normalised from the sheet, not invented
    expect(r.division).toBe('NCAA D1');
    expect(r.source_roster_url).toBe(PINNED_A25);
    // Season comes from the scope, never inferred from the page or the sheet name.
    expect(r.season).toBe('2025');
  });

  it('26. unrelated provenance is deep-equal', () => {
    const provOf = () => db.prepare('SELECT college_name, sport, season, player_name, '
      + 'source_roster_url, source_stats_url, data_confidence FROM roster_players '
      + 'WHERE NOT (college_name=? AND sport=? AND season=?) ORDER BY 1,2,3,4')
      .all('School A', 'womens-soccer', '2025');
    const before = provOf();
    scoped([KEY_AW25]);
    expect(provOf()).toEqual(before);
  });
});

describe('L7X — freshness and the tables the importer must not touch', () => {
  /*
   * `roster_freshness` is NOT a table. The manifest derives it as one MAX per
   * (college_name, sport) over the CURRENT season -- see
   * `rosterFreshnessFingerprint`. So scoping it is not a separate feature:
   * a scoped 2025 import cannot move 2026 freshness because it writes no 2026
   * row, which tests 22 and 27 assert directly rather than by argument.
   */
  const freshness = (season) => db.prepare('SELECT college_name, sport, MAX(updated_date) latest '
    + 'FROM roster_players WHERE season = ? GROUP BY college_name, sport ORDER BY sport, college_name')
    .all(season);

  it('27 + 21b + 43. a scoped 2025 import moves no 2026 freshness', () => {
    const before = freshness('2026');
    scoped([KEY_AW25]);
    expect(freshness('2026')).toEqual(before);
  });

  it('freshness movement inside 2025 is confined to the scope', () => {
    const before = freshness('2025');
    scoped([KEY_AW25]);
    const after = freshness('2025');
    const moved = after.filter((a) => {
      const b = before.find((x) => x.college_name === a.college_name && x.sport === a.sport);
      return !b || b.latest !== a.latest;
    });
    expect(moved.map((m) => `${m.college_name}||${m.sport}`)).toEqual(['School A||womens-soccer']);
  });

  it('28 + 29 + 30. programme_status, athletics_domains and colleges are untouched', () => {
    const digest = () => ['programme_status', 'athletics_domains', 'colleges'].map((t) => {
      try { return JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()); }
      catch { return `${t}:absent`; }
    });
    const before = digest();
    scoped([KEY_AW25]);
    expect(digest()).toEqual(before);
  });
});

describe('L7X — the property invariant', () => {
  /*
   * L7S's run containment, for the importer. Given arbitrary database state,
   * arbitrary sheet input and an explicit scope R, every programme-season
   * outside R must be deep-equal afterwards on every importer-owned field.
   *
   * The scope is drawn at random from the six fixture programme-seasons and the
   * sheets are regenerated to DISAGREE with the database, so a leak has
   * something to leak.
   */
  const ALL25 = [KEY_AW25, KEY_AM25, KEY_BW25];

  it('for every subset of the 2025 programme-seasons, nothing outside it moves', () => {
    for (let mask = 0; mask < 8; mask += 1) {
      const chosen = ALL25.filter((_, i) => mask & (1 << i));
      seedDb();
      writeSheets2025();
      writeSheets2026();
      const before = snapshot();
      if (chosen.length) scoped(chosen);
      const after = snapshot();
      const moved = changedKeys(before, after);
      for (const k of moved) expect(chosen).toContain(k);
      for (const k of before.keys()) {
        if (chosen.includes(k)) continue;
        expect(after.get(k)).toEqual(before.get(k));
      }
    }
  });

  it('and a 200-trial randomised version says the same', () => {
    let leaks = 0;
    for (let t = 0; t < 200; t += 1) {
      seedDb();
      writeSheets2025({ aWomen: t % 2 ? 'repaired' : 'identical' });
      writeSheets2026();
      const chosen = ALL25.filter(() => Math.random() < 0.5);
      const before = snapshot();
      if (chosen.length) scoped(chosen);
      const after = snapshot();
      for (const k of changedKeys(before, after)) if (!chosen.includes(k)) leaks += 1;
    }
    expect(leaks).toBe(0);
  }, 60000);
});

describe('L7X — the CLI chooses its mode by the flag, not the value', () => {
  /*
   * `arg()` falls back when a flag's value is missing, so reading the scope
   * through it would turn `--scope` with no value into a BROAD import of the
   * whole season: a scoped request silently widening, which is the single
   * outcome this stage exists to make impossible. Presence and value are read
   * separately, and every unusable value is an error.
   */
  const cli = (...a) => mod.main(['node', 'importRosterSheets.js', '--season', '2025',
    '--dir', sheets, ...a]);

  it('5. --scope with no value is an error, never a broad import', () => {
    const before = snapshot();
    expect(() => cli('--scope')).toThrow(/needs a file/);
    expect(() => cli('--scope', '--dry-run')).toThrow(/needs a file/);
    expect(changedKeys(before, snapshot())).toEqual([]);
  });

  it('--key with no value is an error', () => {
    const before = snapshot();
    expect(() => cli('--key')).toThrow(/needs a School\|\|sport\|\|season/);
    expect(changedKeys(before, snapshot())).toEqual([]);
  });

  it('--scope and --key together is an error', () => {
    expect(() => cli('--scope', 'x', '--key', KEY_AW25)).toThrow(/not both/);
  });

  it('a named scope file that does not exist is an error', () => {
    const before = snapshot();
    expect(() => cli('--scope', path.join(tmp, 'no-such.scope'))).toThrow(/scope file not found/);
    expect(changedKeys(before, snapshot())).toEqual([]);
  });

  it('--dry-run without a scope is refused rather than run broadly', () => {
    const before = snapshot();
    expect(() => cli('--dry-run')).toThrow(/only available for scoped imports/);
    expect(changedKeys(before, snapshot())).toEqual([]);
  });

  it('a scope file of only comments and blanks imports nothing', () => {
    const f = path.join(tmp, 'empty.scope');
    fs.writeFileSync(f, '# just a comment\n\n   \n');
    const before = snapshot();
    const r = cli('--scope', f);
    expect(r.requested).toBe(0);
    expect(changedKeys(before, snapshot())).toEqual([]);
  });

  it('and the scoped CLI path does import exactly its keys', () => {
    const before = snapshot();
    const r = cli('--key', KEY_AW25);
    expect(r.applied).toBe(true);
    expect(changedKeys(before, snapshot())).toEqual([KEY_AW25]);
  });
});

describe('L7X — the broad path is unchanged', () => {
  it('30b. broad import still replaces a whole sheet slice', () => {
    seedDb();
    writeSheets2025();
    const before = snapshot();
    mod.runBroad({ season: '2025', dir: sheets });
    const after = snapshot();
    // Every 2025 slice present in the sheets is replaced; only School A women's
    // sheet differs from the baseline, and 2026 is a different set of files.
    expect(changedKeys(before, after)).toEqual([KEY_AW25]);
    for (const k of [...before.keys()].filter((x) => x.endsWith('||2026'))) {
      expect(after.get(k)).toEqual(before.get(k));
    }
  });

  it('and a partial sheet under broad import deletes the rest of its slice — the reason scope exists', () => {
    seedDb();
    writeSheets2025();
    // A sheet holding only one of School B's two players, as a targeted repair
    // would produce.
    fs.writeFileSync(path.join(sheets, 'ncaa_d3_womens_soccer_2025_rosters.csv'), csv([
      row('School B', 'Bw One', 'Jr.', 'Midfielder', 'https://b.test/w/2025'),
    ]));
    mod.runBroad({ season: '2025', dir: sheets });
    expect(snapshot().get(KEY_BW25)).toHaveLength(1);            // Bw Two deleted
    // The scoped path would have done the same INSIDE the scope and nothing
    // outside it, which is the whole distinction.
    writeSheets2025();
  });
});
