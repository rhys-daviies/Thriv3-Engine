import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L6C — that the worklist generator still behaves, without touching the network.
 *
 * Live acquisition is an operational command. What CI can and must check is the
 * rule L6B established: the REGISTRY decides who is considered, and prior roster
 * success only suggests where to look. These run against fixture sheets in a
 * temporary RB_ROOT, so they neither read nor write a real season.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

const SHEET = 'School,Conference,Player Name,Class/Year,Total Minutes Played,Games Played,'
  + 'Games Started,Nationality,Hometown,Country,Source Stats URL,Source Roster URL,'
  + 'Data Confidence,Notes,Estimated Graduation,Position';
const row = (school, conf, url) => `${school},${conf},A Player,Fr.,,,,,,,,${url},high,,2029,DEFENSE`;

/** A throwaway RB_ROOT holding one prior season and an empty target season. */
function fixture({ prior = [], registry = null, season = 2026 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-'));
  fs.mkdirSync(path.join(root, `${season} Roster Sheets`), { recursive: true });
  const prev = path.join(root, `${season - 1} Roster Sheets`);
  fs.mkdirSync(prev, { recursive: true });
  const byFile = new Map();
  for (const p of prior) {
    const f = `ncaa_${p.div}_${p.gender}_soccer_${season - 1}_rosters.csv`;
    if (!byFile.has(f)) byFile.set(f, [SHEET]);
    byFile.get(f).push(row(p.school, p.conf ?? 'CONF', p.url ?? ''));
  }
  for (const [f, lines] of byFile) fs.writeFileSync(path.join(prev, f), lines.join('\n'));
  if (registry) {
    fs.writeFileSync(path.join(root, `${season} Roster Sheets`, '_registry_universe.csv'),
      ['School,Sport,Division,Conference,Unitid',
        ...registry.map((r) => `${r.school},${r.sport},${r.division},${r.conference ?? ''},${r.unitid ?? ''}`),
      ].join('\r\n') + '\r\n');
  }
  return root;
}

function run(root, season = 2026) {
  execFileSync(python, ['build_targets.py', String(season)],
    { cwd: HERE, env: { ...process.env, RB_ROOT: root }, encoding: 'utf8' });
  const out = fs.readFileSync(path.join(root, `${season} Roster Sheets`, '_targets.csv'), 'utf8');
  const [head, ...rest] = out.trim().split(/\r?\n/);
  const cols = head.split(',');
  return rest.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}

d('the registry decides membership', () => {
  it('admits an active programme that has never had a roster', () => {
    const root = fixture({
      prior: [{ school: 'Has Roster', div: 'd3', gender: 'womens', url: 'https://x.test/2025' }],
      registry: [
        { school: 'Has Roster', sport: 'womens-soccer', division: 'NCAA D3' },
        { school: 'Never Fetched', sport: 'womens-soccer', division: 'NCAA D3' },
      ],
    });
    const rows = run(root);
    const names = rows.map((r) => r.School);
    expect(names).toContain('Never Fetched');
    expect(names).toContain('Has Roster');
  });

  it('gives a history-less programme a discovery method, not an exclusion', () => {
    const root = fixture({
      prior: [{ school: 'Has Roster', div: 'd3', gender: 'womens', url: 'https://x.test/2025' }],
      registry: [{ school: 'Never Fetched', sport: 'womens-soccer', division: 'NCAA D3' }],
    });
    const r = run(root).find((x) => x.School === 'Never Fetched');
    expect(r.Method).toMatch(/discover from scratch/);
    expect(r['Roster URL 2026 (candidate)']).toBe('');
  });

  it('still reuses a known-good URL where one exists', () => {
    const root = fixture({
      prior: [{ school: 'Has Roster', div: 'd3', gender: 'womens', url: 'https://x.test/2025' }],
      registry: [{ school: 'Has Roster', sport: 'womens-soccer', division: 'NCAA D3' }],
    });
    const r = run(root).find((x) => x.School === 'Has Roster');
    expect(r['Roster URL 2026 (candidate)']).toBe('https://x.test/2026');
    expect(r.Method).toBe('year-swap (direct)');
  });

  it('behaves exactly as before when no registry file is present', () => {
    const prior = [{ school: 'Only In Sheet', div: 'd3', gender: 'mens', url: 'https://y.test/2025' }];
    const withReg = run(fixture({ prior, registry: [] })).map((r) => r.School);
    const without = run(fixture({ prior })).map((r) => r.School);
    expect(withReg).toEqual(without);
    expect(without).toEqual(['Only In Sheet']);
  });
});

d('scope stays isolated', () => {
  it('does not let a men\'s sheet entry satisfy a women\'s programme', () => {
    // The L4 defect. Same school, two genders, one of them never fetched.
    const root = fixture({
      prior: [{ school: 'Both Genders', div: 'd3', gender: 'mens', url: 'https://z.test/2025' }],
      registry: [
        { school: 'Both Genders', sport: 'mens-soccer', division: 'NCAA D3' },
        { school: 'Both Genders', sport: 'womens-soccer', division: 'NCAA D3' },
      ],
    });
    const rows = run(root).filter((r) => r.School === 'Both Genders');
    expect(rows).toHaveLength(2);
    const w = rows.find((r) => r.Sport === 'womens-soccer');
    const m = rows.find((r) => r.Sport === 'mens-soccer');
    expect(w.Method).toMatch(/discover from scratch/);
    expect(m['Roster URL 2026 (candidate)']).toBe('https://z.test/2026');
  });

  it('carries the registry division for a programme with no sheet history', () => {
    const root = fixture({
      prior: [{ school: 'Anchor', div: 'd3', gender: 'mens', url: 'https://a.test/2025' }],
      registry: [{ school: 'D2 Only', sport: 'mens-soccer', division: 'NCAA D2', conference: 'NSIC' }],
    });
    const r = run(root).find((x) => x.School === 'D2 Only');
    expect(r.Division).toBe('NCAA D2');
    expect(r.Conference).toBe('NSIC');
  });
});
