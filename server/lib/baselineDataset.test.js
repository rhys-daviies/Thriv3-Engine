/**
 * THE VERIFICATION INPUT, AND THE GUARD THAT KEEPS IT OUT OF PRODUCTION — D3.2.
 *
 * Two properties, and both of them are about the same mistake: reading or
 * writing the operator's working database when you meant a fixture.
 *
 *   the baselines' input is a snapshot, never `server/data/recruitmatch.sqlite`
 *   an inline `node -e` cannot open the default database at all
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  BASELINE_DB, WORKING_DB, ROOT, assertNotWorkingDatabase,
  baselineDatasetAvailable, materialiseBaselineDataset,
} from './baselineDataset.js';

describe('the baseline dataset is never the working database', () => {
  it('resolves somewhere else, by default', () => {
    expect(path.resolve(BASELINE_DB)).not.toBe(WORKING_DB);
  });

  it('refuses to be pointed at the working database', () => {
    expect(() => assertNotWorkingDatabase(WORKING_DB)).toThrowError(/working database/i);
    try { assertNotWorkingDatabase(WORKING_DB); } catch (err) {
      expect(err.code).toBe('BASELINE_DB_IS_WORKING_DB');
    }
    // A path that merely resembles it is fine — this is identity, not a regex.
    expect(() => assertNotWorkingDatabase(`${WORKING_DB}.snapshot`)).not.toThrow();
  });

  /**
   * The two suites that hold the committed hashes must both go through this
   * module. A file that resolved its own path would be free to resolve the
   * working one again, which is the defect D3.2 exists to remove.
   */
  it('is what evidenceBaseline.test.js and reports.test.js get their database from', () => {
    for (const file of ['server/lib/evidenceBaseline.test.js', 'server/scripts/reports.test.js']) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, file).toMatch(/from '.*baselineDataset\.js'/);
      expect(src, file).toMatch(/materialiseBaselineDataset/);
      // And no longer build a path to the working database themselves.
      expect(src, file).not.toMatch(/data\/recruitmatch\.sqlite/);
    }
  });
});

const withDataset = baselineDatasetAvailable() ? describe : describe.skip;

withDataset('materialising it', () => {
  it('hands out a writable copy, not the canonical file, and cleans up', () => {
    const one = materialiseBaselineDataset({ label: 'unit' });
    try {
      expect(one.path).not.toBe(path.resolve(BASELINE_DB));
      expect(fs.statSync(one.path).size).toBe(fs.statSync(BASELINE_DB).size);
      // Writable, because opening it will run schema and migrations.
      fs.accessSync(one.path, fs.constants.W_OK);
    } finally { one.release(); }
    expect(fs.existsSync(one.path)).toBe(false);
  });

  it('leaves the canonical snapshot read-only, so a run cannot drift it', () => {
    // 0o200 is the owner-write bit. Absent means no suite can migrate the fixture.
    expect(fs.statSync(BASELINE_DB).mode & 0o200).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('the default database cannot be opened from an inline node -e', () => {
  const runInline = (env) => {
    const clean = { ...process.env, ...env };
    if (clean.RECRUITMATCH_DB === undefined) delete clean.RECRUITMATCH_DB;
    try {
      execFileSync('node', ['-e', "import('./server/db/client.js').then(() => console.log('OPENED'))"],
        { cwd: ROOT, env: clean, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, out: 'OPENED' };
    } catch (err) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  /**
   * The exact command that opened and migrated the live database twice, in D2
   * and again in D3.1, while checking that a new module imports cleanly.
   */
  it('refuses, and says how to say which database you meant', () => {
    const result = runInline({ RECRUITMATCH_DB: undefined });
    expect(result.code).not.toBe(0);
    expect(result.out).toMatch(/Refusing to open the default database/);
    expect(result.out).toMatch(/RECRUITMATCH_DB=:memory:/);
    expect(result.out).not.toMatch(/OPENED/);
  });

  it('allows the same check once a database is named', () => {
    const result = runInline({ RECRUITMATCH_DB: ':memory:' });
    expect(result.out).toMatch(/OPENED/);
    expect(result.code).toBe(0);
  });

  /**
   * A real script, an npm script and a vitest worker all set `process.argv[1]`,
   * so none of them is touched. This is the half of the guard that matters:
   * refusing the accident is only useful if normal startup is unaffected.
   */
  it('does not touch a database opened from an actual script', () => {
    const script = path.join(ROOT, 'node_modules/.tmp/thriv3-d32-argv-probe.mjs');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script,
      "import db from '../../server/db/client.js';\n"
      + "console.log(db.prepare('SELECT 1 AS n').get().n === 1 ? 'RAN' : 'BAD');\n");
    try {
      const clean = { ...process.env };
      delete clean.RECRUITMATCH_DB;
      // Named explicitly, because this test must not open the working database
      // either — it is proving argv[1] is respected, not that a default is fine.
      clean.RECRUITMATCH_DB = ':memory:';
      const out = execFileSync('node', [script], { cwd: ROOT, env: clean, encoding: 'utf8' });
      expect(out).toMatch(/RAN/);
    } finally { fs.rmSync(script, { force: true }); }
  });
});
