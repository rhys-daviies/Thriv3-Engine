import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { TARGET_DIVISIONS, TARGET_SPORTS, toCsv } from './rosterTargetUniverse.js';

/**
 * L6B — the worklist must be a statement about the REGISTRY, not about what we
 * managed to fetch last time.
 *
 * The pipeline built its universe by scanning adjacent seasons' roster files,
 * so membership required already having a roster. L6 measured the cost: the
 * 2025 D3 women's sheet held 394 schools against 418, and the shortfall was
 * carried into 2026 untouched because the 2026 worklist was derived from the
 * 2025 output. Every test below exists to keep that from coming back.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const d = fs.existsSync(DB) ? describe : describe.skip;

const universe = () => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  process.env.RECRUITMATCH_DB = ${JSON.stringify(DB)};
  const { rosterTargetUniverse } = await import(${JSON.stringify(path.join(ROOT, 'server/scripts/rosterTargetUniverse.js'))});
  process.stdout.write(JSON.stringify(rosterTargetUniverse()));
`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

const rostered = () => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  process.env.RECRUITMATCH_DB = ${JSON.stringify(DB)};
  const { default: db } = await import(${JSON.stringify(path.join(ROOT, 'server/db/client.js'))});
  process.stdout.write(JSON.stringify(db.prepare(
    'SELECT DISTINCT college_name AS school, sport FROM roster_players').all()));
`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

d('membership comes from the registry', () => {
  const rows = universe();

  it('includes programmes that have never had a roster', () => {
    // The whole point. Under the old rule these could not be targets, which is
    // why they had no roster, which is why they could not be targets.
    const have = new Set(rostered().map((r) => `${r.school}|${r.sport}`));
    const withoutRoster = rows.filter((r) => !have.has(`${r.school}|${r.sport}`));
    expect(withoutRoster.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(have.size - 400);
  });

  it('treats prior success as an optimisation, not as membership', () => {
    // A registry row is sufficient. Nothing in the selection consults
    // roster_players, so no fetch outcome can remove a programme.
    const src = fs.readFileSync(path.join(ROOT, 'server/scripts/rosterTargetUniverse.js'), 'utf8');
    const selection = src.slice(src.indexOf('export function rosterTargetUniverse'),
      src.indexOf('export function toCsv'));
    expect(selection).not.toMatch(/roster_players/);
  });

  it('is deterministic, so two seasons can be diffed', () => {
    expect(universe().map((r) => `${r.division}|${r.sport}|${r.school}`))
      .toEqual(rows.map((r) => `${r.division}|${r.sport}|${r.school}`));
  });
});

d('scope is isolated by sport, gender and division', () => {
  const rows = universe();

  it('keys every programme by sport, so one gender never satisfies the other', () => {
    // L4's defect in one assertion: it pooled all eight sheets and let a men's
    // entry answer for a women's programme. A school fielding both teams must
    // appear twice, and the two rows must be independent.
    const both = rows.filter((r) => r.sport === 'mens-soccer')
      .filter((m) => rows.some((w) => w.sport === 'womens-soccer' && w.school === m.school));
    expect(both.length).toBeGreaterThan(100);
    for (const m of both.slice(0, 25)) {
      const w = rows.find((x) => x.school === m.school && x.sport === 'womens-soccer');
      expect(`${m.school}|${m.sport}`).not.toBe(`${w.school}|${w.sport}`);
    }
  });

  it('carries a division on every row, so a D2 target is not answered by D3', () => {
    for (const r of rows) expect(TARGET_DIVISIONS, r.school).toContain(r.division);
    const keys = rows.map((r) => `${r.school}|${r.sport}|${r.division}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('admits only the sports the pipeline can acquire', () => {
    for (const r of rows) expect(TARGET_SPORTS, r.school).toContain(r.sport);
  });

  it('excludes deferred associations entirely', () => {
    // NAIA, NJCAA and USCAA are expansion targets. Including them here would
    // silently re-scope an acquisition run.
    for (const bad of ['NAIA', 'NJCAA', 'USCAA']) {
      expect(rows.some((r) => r.division === bad), bad).toBe(false);
    }
  });

  it('excludes inactive programmes', () => {
    for (const r of rows) expect(r.active, r.school).toBe(1);
  });
});

d('the gap it must close', () => {
  it('contains every active NCAA programme with no roster', () => {
    const have = new Set(rostered().map((r) => `${r.school}|${r.sport}`));
    const gaps = universe().filter((r) => !have.has(`${r.school}|${r.sport}`));
    // L6 counted 41 such rows: 34 genuinely source-missing plus 7 duplicate
    // registry rows whose twin holds the data. Both belong in the worklist —
    // suppressing the duplicates by name would be the ad-hoc identity guess
    // L4 made and L5 had to undo, and they resolve to a real source anyway.
    expect(gaps.length).toBe(41);
    for (const name of ['Wisconsin-Oshkosh', 'UMass Boston', 'Pace', 'Tuskegee']) {
      expect(gaps.some((g) => g.school === name), name).toBe(true);
    }
  });
});

describe('the CSV handed to the pipeline', () => {
  it('is membership only — it offers no URL to fall back on', () => {
    const csv = toCsv([{ school: 'A', sport: 'mens-soccer', division: 'NCAA D1', conference: 'X', unitid: 1 }]);
    expect(csv.split('\r\n')[0]).toBe('School,Sport,Division,Conference,Unitid');
    expect(csv).not.toMatch(/http/);
  });

  it('quotes a conference containing a comma', () => {
    const csv = toCsv([{ school: 'B', sport: 'womens-soccer', division: 'NCAA D3', conference: 'A, B', unitid: 2 }]);
    expect(csv).toContain('"A, B"');
  });
});
