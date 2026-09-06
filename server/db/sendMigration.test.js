import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * THE HISTORICAL SENDS, MIGRATED WITHOUT INVENTING ANYTHING.
 *
 * I1 found forty-one confirmed sends: fourteen with an evidence snapshot,
 * twenty-seven without, and every one of them produced by a policy that no
 * longer exists. The migration's whole job is to represent that honestly —
 * `LEGACY_UNKNOWN`, a null snapshot where there was none, and the retired
 * vocabulary kept out of the columns an analysis would read as current.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;
const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  sendMigration.test.js SKIPPED — no database at ${DB}\n`);

const query = (sql) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  import db from '${path.join(ROOT, 'server/db/client.js')}';
  process.stdout.write(JSON.stringify(db.prepare(\`${sql}\`).all()));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

d('the legacy migration', () => {
  it('gives every confirmed send an event', () => {
    const [{ sends, events }] = query(`
      SELECT (SELECT COUNT(*) FROM outreach WHERE sent_at IS NOT NULL) AS sends,
             (SELECT COUNT(*) FROM outreach_send) AS events`);
    expect(events).toBe(sends);
    expect(sends).toBeGreaterThan(0);
  });

  it('stamps every historical row LEGACY_UNKNOWN and none of them current', () => {
    /**
     * The rule the whole policy field exists for. These rows name kinds that
     * are not licensed today and one names a RECOGNITION kind as primary —
     * a state H18 proved impossible. Labelling them P2 would silently pool two
     * different products.
     */
    const rows = query("SELECT policy_version, COUNT(*) AS n FROM outreach_send GROUP BY policy_version");
    expect(rows).toEqual([{ policy_version: 'LEGACY_UNKNOWN', n: expect.any(Number) }]);
    expect(query("SELECT COUNT(*) AS n FROM outreach_send WHERE policy_version = 'P2'")[0].n).toBe(0);
  });

  it('leaves the current-vocabulary columns null on legacy rows', () => {
    // Not "unknown for now" — these columns mean something specific under P2
    // and the legacy rows cannot answer them. Null is the correct value.
    const [r] = query(`SELECT
      SUM(primary_kind IS NOT NULL) AS pk, SUM(hook_kind IS NOT NULL) AS hk,
      SUM(primary_role IS NOT NULL) AS pr, SUM(has_personalisation IS NOT NULL) AS hp,
      SUM(rendered_kinds IS NOT NULL) AS rk
      FROM outreach_send WHERE policy_version = 'LEGACY_UNKNOWN'`);
    expect([r.pk, r.hk, r.pr, r.hp, r.rk]).toEqual([0, 0, 0, 0, 0]);
  });

  it('records a missing snapshot as missing', () => {
    const [r] = query(`SELECT
      COUNT(*) AS all_rows,
      SUM(payload IS NOT NULL) AS with_snapshot,
      SUM(payload IS NULL) AS without
      FROM outreach_send`);
    expect(r.with_snapshot + r.without).toBe(r.all_rows);
    // Both cases exist in the real data; neither was filled in.
    expect(r.with_snapshot).toBeGreaterThan(0);
    expect(r.without).toBeGreaterThan(0);
  });

  it('keeps the retired selector vocabulary out of the new model', () => {
    // `ranked`, `suppressed`, `belowThreshold` and `rejected` were deleted at
    // H7. They stay readable in `outreach_evidence` and appear nowhere here.
    const rows = query("SELECT payload FROM outreach_send WHERE payload IS NOT NULL");
    for (const { payload } of rows) {
      for (const dead of ['"ranked"', '"suppressed"', '"belowThreshold"', '"rejected"']) {
        expect(payload, `${dead} must not reach the send model`).not.toContain(dead);
      }
      expect(JSON.parse(payload)).toHaveProperty('legacy');
    }
  });

  it('preserves the sentences the coach actually read', () => {
    const rows = query("SELECT payload FROM outreach_send WHERE payload IS NOT NULL LIMIT 5");
    for (const { payload } of rows) {
      const { legacy } = JSON.parse(payload);
      expect(Array.isArray(legacy.rendered)).toBe(true);
      for (const s of legacy.rendered) expect(typeof s.text).toBe('string');
    }
  });

  it('numbers every historical send 1, because none was a follow-up', () => {
    expect(query('SELECT DISTINCT sequence FROM outreach_send')).toEqual([{ sequence: 1 }]);
  });

  it('is safe to run twice', () => {
    const before = query('SELECT COUNT(*) AS n FROM outreach_send')[0].n;
    // Importing the client runs `migrate` on boot; this is the second run.
    execFileSync('node', ['--input-type=module', '-e', `import '${path.join(ROOT, 'server/db/client.js')}';`],
      { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8' });
    expect(query('SELECT COUNT(*) AS n FROM outreach_send')[0].n).toBe(before);
  });
});
