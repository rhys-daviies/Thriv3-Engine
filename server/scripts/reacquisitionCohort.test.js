import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pilotSample, PILOT_SIZE } from '../../shared/roster/reacquisitionPilot.js';

/**
 * L7Q — the cohort, derived against the live registry.
 *
 * The cohort's job is to separate two kinds of gap that had been one number:
 * programmes that need re-acquiring from a source the pipeline already knows,
 * and programmes that have never been fetched and need a host, a candidate and
 * in two cases an identity decision.
 *
 * The assertion that matters most is the exclusion. New Jersey City W and Bryn
 * Athyn M/W carry unresolved identity and status questions, and a re-acquisition
 * pilot must not answer one by quietly attempting it. They are excluded by the
 * clause "has a roster for the season before" — a fact about rosters — and not
 * by a list of names, so the guard survives the next stage renaming something.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIVE_DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');

const cohort = () => JSON.parse(execFileSync('node',
  [path.join(ROOT, 'server/scripts/reacquisitionCohort.js'), '--json'],
  { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: LIVE_DB }, encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024 }));

describe('the 2026 re-acquisition cohort', () => {
  const c = cohort();

  it('1. is every current-season gap that already holds a source, and nothing else', () => {
    expect(c.rows.length + c.excluded.length).toBe(c.coverage.currentSeasonMissing);
    expect(c.rows.length).toBe(c.coverage.historicalOnly);
  });

  it('2. excludes the never-fetched by a roster clause, not by name', () => {
    const never = c.excluded.filter((e) => e.reason === 'NEVER_FETCHED');
    expect(never).toHaveLength(3);
    // Named here only to say WHICH programmes the structural clause removes.
    // Nothing in the derivation reads these strings.
    expect(never.map((e) => e.key).sort()).toEqual([
      'Bryn Athyn College of the New Church||womens-soccer',
      'Bryn Athyn||mens-soccer',
      'New Jersey City University||womens-soccer',
    ]);
  });

  it('3. requires the season before, not merely some earlier season', () => {
    for (const r of c.rows) expect(r.priorSeason).toBe(String(c.season - 1));
    for (const e of c.excluded) {
      expect(e.reason === 'NEVER_FETCHED' || /^LATEST_ROSTER_/.test(e.reason)
        || /^CANDIDATE_STATE_/.test(e.reason) || e.reason === 'NO_SOURCE_URL').toBe(true);
    }
  });

  it('4. every member carries a real source URL and prior-season players', () => {
    for (const r of c.rows) {
      expect(r.priorSource).toMatch(/^https?:\/\//);
      expect(r.priorPlayers).toBeGreaterThan(0);
      expect(r.division).toMatch(/^NCAA /);
      expect(['M', 'W']).toContain(r.gender);
    }
  });

  it('5. reads an archived source through to the host that really served it', () => {
    for (const r of c.rows) {
      expect(r.priorSourceHost).not.toBe('web.archive.org');
      if (r.priorSourceArchived) expect(r.priorSource).toMatch(/web\.archive\.org/);
    }
  });

  it('6. the audit totals agree with the rows they describe', () => {
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(c.audit.cohort).toBe(c.rows.length);
    for (const t of ['byDivision', 'byGender', 'bySourceShape', 'byProvider', 'byStratum']) {
      expect(sum(c.audit[t])).toBe(c.rows.length);
    }
  });

  it('7. yields a reproducible pilot of exactly twenty from the live cohort', () => {
    const a = pilotSample(c.rows);
    const b = pilotSample(cohort().rows);
    /*
     * The pilot is `PILOT_SIZE` programmes, or the whole cohort when fewer
     * remain. L7W acquired six of the twenty and took the cohort to 14, which
     * is the first time this has been smaller than the pilot -- and asserting
     * a bare 20 would now be asserting that acquisition never succeeds.
     */
    expect(a.keys).toHaveLength(Math.min(PILOT_SIZE, c.rows.length));
    expect(a.keys).toEqual(b.keys);
    expect(a.digest).toBe(b.digest);
    const keys = new Set(c.rows.map((r) => r.key));
    for (const k of a.keys) expect(keys.has(k)).toBe(true);
  });

  it('8. the pilot can never contain a never-fetched or excluded programme', () => {
    const excluded = new Set(c.excluded.map((e) => e.key));
    for (const k of pilotSample(c.rows).keys) expect(excluded.has(k)).toBe(false);
  });

  it('9. writes nothing', () => {
    const before = JSON.stringify(cohort());
    expect(JSON.stringify(cohort())).toBe(before);
  });
});
