/**
 * PR #49 PRE-MERGE SAFETY CLOSURE — the standing guard on data-mutation paths.
 *
 * The defect this exists to prevent, stated plainly: the branch shipped
 * `applyReconciledToProduction.js`, which targeted `/data/recruitmatch.sqlite`
 * and applied a 188-row `athletics_domains` fixture built from Thriv3's OWN
 * `coach_seasons` scrape. By the time it would have run, Phases 2C/2D and 6C.4
 * had replaced that evidence standard with external verification: 180 of the
 * 188 would have auto-promoted INSUFFICIENT_EVIDENCE domains that the branch's
 * own `flagUnverifiedAthleticsDomains.js` exists to hold for human checking,
 * and 2 would have downgraded domains Phase 6C.4 had externally proven.
 *
 * Its pre-invariants would NOT have stopped it. They pin production's untouched
 * 6,347-row baseline, and production IS untouched — so the guard matched and the
 * apply proceeded. The protection was aimed at drift, and this was not drift.
 *
 * These tests are the durable form of that lesson. They are deliberately
 * mechanical: a rule remembered is a rule violated, and a superseded fixture
 * looks exactly like a current one from the outside.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../..');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
  return p.endsWith('.js') && !p.endsWith('.test.js') ? [p] : [];
});
const SOURCES = walk(path.join(REPO, 'server')).map((p) => ({ path: p, rel: path.relative(REPO, p), text: fs.readFileSync(p, 'utf8') }));

/** A fixture is superseded if it says so — as a top-level marker or a status string. */
function supersededFixtures() {
  const dirs = ['docs/validation/generated', 'docs/validation/integrity-audit'];
  const out = new Set();
  for (const d of dirs) {
    const abs = path.join(REPO, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.json')) continue;
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(path.join(abs, f), 'utf8')); } catch { continue; }
      if (Array.isArray(parsed)) continue;
      const marked = '_SUPERSEDED_BY' in parsed || /SUPERSEDED/i.test(String(parsed.status ?? ''));
      if (marked) out.add(`${d}/${f}`);
    }
  }
  return out;
}

describe('no executable may reach production data', () => {
  it('nothing under server/ opens a database on the /data volume', () => {
    // The ONE script that did was removed by this closure. `render.yaml` still
    // points the running app at /data, which is correct — the app serves from
    // production; what must not exist is a SCRIPT that writes it.
    const offenders = SOURCES
      .filter((s) => /['"`]\/data\/[A-Za-z0-9_.-]*\.sqlite/.test(s.text))
      .filter((s) => !/Refusing|refuse/i.test(s.text))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('every apply/repair script carries a production refusal', () => {
    /**
     * TWO GUARDS, AND WHY BOTH ARE NEEDED.
     *
     * A script taking an explicit `--db` refuses the path itself, before it
     * constructs a Database. A script resolving its target from the environment
     * CANNOT do that inline: importing `db/client.js` opens the file and runs
     * `schema.sql` + `migrate()` during module evaluation, so by its first
     * statement production has already been opened and migrated. Those import
     * `db/refuseProductionVolume.js` first instead.
     *
     * `assertCanonicalWrite` is NOT on this list. It refuses the shared DEV
     * corpus and `--canonical` waives it; it never looks at /data. Three apply
     * scripts were relying on it as though it did.
     */
    const appliers = SOURCES.filter((s) => /server\/scripts\/(apply|repair)[A-Z]/.test(s.rel));
    expect(appliers.length).toBeGreaterThan(5); // the suite is looking at something
    const unguarded = appliers
      .filter((s) => !/[\\/]data[\\/]/.test(s.text) && !s.text.includes('refuseProductionVolume.js'))
      .map((s) => s.rel);
    expect(unguarded).toEqual([]);
  });

  it('the pre-open refusal is imported before anything that opens a database', () => {
    const users = SOURCES.filter((s) => s.text.includes('refuseProductionVolume.js') && !s.rel.endsWith('refuseProductionVolume.js'));
    expect(users.length).toBeGreaterThan(0);
    for (const s of users) {
      // The SPECIFIER only — the guard's own line mentions db/client.js in a comment.
      const imports = [...s.text.matchAll(/^import\s.*?from\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/gm)]
        .map((m) => m[1] ?? m[2]);
      const guardAt = imports.findIndex((spec) => spec.endsWith('refuseProductionVolume.js'));
      const opensAt = imports.findIndex((spec) => /db\/client\.js$|db\/entities\/|^better-sqlite3$/.test(spec));
      expect(guardAt, s.rel).toBe(0);
      if (opensAt > -1) expect(guardAt, s.rel).toBeLessThan(opensAt);
    }
  });

  it('refuses a /data target without opening it — the path that used to migrate first', () => {
    /**
     * The give-away is WHICH error comes back. Before the guard, the failure was
     * better-sqlite3 opening (and migrating) the file; the refusal only arrived
     * afterwards. A clean exit 2 with our sentence and no SqliteError is the
     * proof that nothing was opened.
     */
    const script = path.join(REPO, 'server/scripts/applyUscaaDivision.js');
    let code = 0; let out = '';
    try {
      out = execFileSync('node', [script], {
        encoding: 'utf8', env: { ...process.env, RECRUITMATCH_DB: '/data/recruitmatch.sqlite' },
      });
    } catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
    expect(code).toBe(2);
    expect(out).toContain('Refusing to target the production /data volume');
    expect(out).not.toMatch(/SqliteError|better-sqlite3|unable to open/i);
  });

  it('the retired production-apply machinery is not referenced anywhere', () => {
    const retired = ['applyReconciledToProduction', 'repairAthleticsDomains'];
    for (const name of retired) {
      expect(fs.existsSync(path.join(REPO, `server/scripts/${name}.js`)), name).toBe(false);
      expect(SOURCES.filter((s) => s.text.includes(name)).map((s) => s.rel), name).toEqual([]);
    }
  });
});

describe('no executable may apply a superseded decision set', () => {
  const superseded = supersededFixtures();

  it('finds the superseded fixtures it is supposed to be guarding', () => {
    // If this ever empties, the guard below is vacuous and the test says so.
    expect([...superseded].sort()).toEqual([
      'docs/validation/generated/athletics_domains_repairs_phase3b_SUPERSEDED.json',
      'docs/validation/integrity-audit/phase2a_domain_corrections.json',
    ]);
  });

  it('no source file reads one', () => {
    const offenders = [];
    for (const f of superseded) {
      const base = path.basename(f);
      for (const s of SOURCES) if (s.text.includes(base)) offenders.push(`${s.rel} reads ${base}`);
    }
    expect(offenders).toEqual([]);
  });

  it('and each is structurally non-iterable, so a naive applier throws instead of applying', () => {
    // Belt and braces: the appliers all do `for (const r of fixture)`. An object
    // fails loudly. Neither file may be a bare array again.
    for (const f of superseded) {
      const parsed = JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
      expect(Array.isArray(parsed), f).toBe(false);
      expect(() => { for (const _ of parsed) break; }).toThrow();
    }
  });
});
