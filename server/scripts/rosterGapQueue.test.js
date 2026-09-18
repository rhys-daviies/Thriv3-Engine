import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7K — the residual queue, against the live registry.
 *
 * Read-only by construction. Every stage since L6D rebuilt this queue by hand
 * out of prose, and each rebuild promoted one layer into another; these assert
 * the three stay apart and that the counts add up.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/*
 * The real database, named explicitly. Another test file sets
 * RECRUITMATCH_DB=':memory:' at module scope and vitest shares the environment
 * across files in a worker, so inheriting it silently pointed this queue at an
 * empty database and it reported no registry at all.
 */
const LIVE_DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const queue = (env = {}) => JSON.parse(execFileSync('node',
  [path.join(ROOT, 'server/scripts/rosterGapQueue.js'), '--json'],
  {
    cwd: ROOT,
    env: { ...process.env, RECRUITMATCH_DB: LIVE_DB, ...env },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }));

describe('the NCAA residual queue', () => {
  const q = queue();

  it('16. is NCAA only', () => {
    expect(q.rows.length).toBeGreaterThan(0);
    for (const r of q.rows) expect(r.division).toMatch(/^NCAA /);
  });

  it('17. reconciles: current-season rostered + duplicates + missing = the universe', () => {
    const s = q.summary;
    expect(s.reconciles).toBe(true);
    expect(s.currentSeasonRostered + s.registryDuplicates + s.currentSeasonMissing)
      .toBe(s.ncaaTotal);
    expect(s.currentSeasonMissing).toBe(q.rows.length);
  });

  it('26. states the live accounting, for the season it is asked about', () => {
    /*
     * 1,761 registry rows carry 6 programmes L7P recorded as not fielded in
     * 2026, leaving 1,755 active. Of those, 1,644 hold a 2026 roster, 7 are
     * duplicate rows whose twin holds one, and 104 are missing it.
     *
     * The two coverage numbers are asserted separately on purpose. Until L7P
     * this file had one, counted over every season, and 1,745 was being read as
     * a 2026 figure when the 2026 figure was 1,607.
     *
     * L7Q moved the current-season figures and NOT the historical one, which is
     * the clearest possible statement of what the two metrics mean: the pilot
     * re-acquired 13 programmes the dataset already knew, so 1,745 could not
     * move and 1,607 had to. L7R took one more and L7T twenty-three, all for
     * the same reason. These are live-registry numbers and a stage that
     * acquires rosters is expected to change them; `reconciles` above is the
     * invariant, and this is the measurement.
     */
    const s = q.summary;
    expect(s.ncaaTotal).toBe(1755);
    expect(s.registryDuplicates).toBe(7);
    expect(s.currentSeasonRostered).toBe(1644);
    expect(s.currentSeasonMissing).toBe(104);
    expect(s.historicallyRostered).toBe(1745);
    expect(s.historicalOnly).toBe(101);
    expect(s.neverRostered).toBe(3);
  });

  it('27. the never-fetched three are not in the re-acquisition cohort', () => {
    /*
     * L7Q's cohort clause is "has a roster for the season before", and these
     * three have none at all. It matters that they are excluded by that clause
     * rather than by name: New Jersey City W and Bryn Athyn M/W carry unresolved
     * identity and status questions, and a pilot must not quietly answer one by
     * attempting it.
     */
    const never = q.rows.filter((r) => !r.historicalOnly);
    expect(never).toHaveLength(3);
    for (const r of never) expect(r.latestRosterSeason).toBe(null);
  });

  it('separates a registry duplicate from an acquisition gap', () => {
    // L6 found seven duplicate registry rows whose twin holds the roster.
    // Counting them as gaps is how two different numbers both get called
    // "programmes with a roster" in the same week.
    expect(q.summary.registryDuplicates).toBeGreaterThan(0);
    const keys = new Set(q.rows.map((r) => r.key));
    expect(keys.size).toBe(q.rows.length);
  });

  it('15. is deterministic', () => {
    expect(JSON.stringify(queue().rows)).toBe(JSON.stringify(q.rows));
  });

  it('keeps the three layers in separate fields', () => {
    for (const r of q.rows) {
      // machine, live
      expect(r).toHaveProperty('candidateState');
      expect(r).toHaveProperty('candidates');
      // machine, recorded
      expect(r).toHaveProperty('lastFailureClass');
      expect(r).toHaveProperty('lastError');
      // operator
      expect(r).toHaveProperty('disposition');
      expect(r).toHaveProperty('reviewStatus');
      // and no single merged "status" that would let one become the other
      expect(r).not.toHaveProperty('status');
    }
  });

  it('carries only dispositions a person actually recorded', () => {
    // L7K bootstrapped nothing and L7N wrote seven explicit human decisions.
    // What must stay true is that a disposition never appears without a review
    // behind it, and never comes from a stage document.
    expect(q.summary.reviewed + q.summary.unreviewed).toBe(q.rows.length);
    for (const r of q.rows) {
      if (r.reviewStatus === 'UNREVIEWED') {
        expect(r.disposition).toBe(null);
        expect(r.nextAction).toBe(null);
      } else {
        expect(r.disposition).toBeTruthy();
        expect(r.reviewedAt).toMatch(/^\d{4}-\d\d-\d\d/);
        expect(r.reviewEvidence).toBeTruthy();
      }
    }
  });

  it('leaves an unreviewed gap retry-eligible, and holds only what a review held', () => {
    // An unreviewed queue that blocks is a blocklist nobody chose.
    for (const r of q.rows) {
      if (r.reviewStatus === 'UNREVIEWED') expect(r.retryEligible).toBe(true);
      else if (r.nextAction === 'CONFIRM_PROGRAMME_STATUS') expect(r.retryEligible).toBe(false);
    }
    expect(q.summary.retryEligible + q.summary.retryHeld).toBe(q.rows.length);
  });

  it('flags a recorded reason the live machine contradicts', () => {
    // L7J: durable reasons froze at the first attempt. Where state says there
    // was nothing to try and the planner offers candidates now, that is
    // deterministic and worth saying out loud.
    expect(q.summary.recordedReasonStale).toBeGreaterThan(0);
    for (const r of q.rows.filter((x) => x.recordedStale)) {
      expect(r.candidates).toBeGreaterThan(0);
      expect(r.lastError).toMatch(/no candidate|no trusted host|not attempted/i);
    }
  });

  it('reports NO_HOST from the planner rather than from a stored label', () => {
    const noHost = q.rows.filter((r) => r.candidateState === 'NO_TRUSTED_HOST');
    expect(noHost.length).toBeGreaterThan(0);
    for (const r of noHost) {
      expect(r.candidates).toBe(0);
      expect(r.recordedStale).toBe(false);
      // It is a query result, so it is never the disposition itself — a person
      // may still have reviewed the programme for a reason of their own.
      expect(r.disposition).not.toBe('NO_HOST');
    }
  });

  it('writes nothing', () => {
    const dbPath = LIVE_DB;
    const before = fs.statSync(dbPath).size;
    const reviews = execFileSync('node', ['--input-type=module', '-e', `
      const { default: db } = await import('${ROOT}/server/db/client.js');
      process.stdout.write(String(db.prepare('SELECT COUNT(*) n FROM roster_gap_reviews').get().n));
    `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: LIVE_DB }, encoding: 'utf8' });
    queue();
    expect(fs.statSync(dbPath).size).toBe(before);
    // Reading the queue must not create, remove or alter a review.
    const after = execFileSync('node', ['--input-type=module', '-e', `
      const { default: db } = await import('${ROOT}/server/db/client.js');
      process.stdout.write(String(db.prepare('SELECT COUNT(*) n FROM roster_gap_reviews').get().n));
    `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: LIVE_DB }, encoding: 'utf8' });
    expect(after).toBe(reviews);
  });

  it('6/7. a pipeline reset cannot reach a review — different store entirely', () => {
    // build_targets.py --reset-state clears Status and Notes in _targets.csv.
    // Reviews live in the database, which the Python pipeline never opens.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l7k-reset-'));
    try {
      const season = path.join(dir, '2026 Roster Sheets');
      const prev = path.join(dir, '2025 Roster Sheets');
      fs.mkdirSync(season, { recursive: true }); fs.mkdirSync(prev, { recursive: true });
      const SHEET = 'School,Conference,Player Name,Class/Year,Total Minutes Played,Games Played,'
        + 'Games Started,Nationality,Hometown,Country,Source Stats URL,Source Roster URL,'
        + 'Data Confidence,Notes,Estimated Graduation,Position';
      fs.writeFileSync(path.join(prev, 'ncaa_d2_mens_soccer_2025_rosters.csv'),
        `${SHEET}\nAlpha,CONF,A Player,Fr.,,,,,,,,https://alpha.test/sports/mens-soccer/roster/2025,high,,2029,DEFENSE\n`);
      const db = path.join(dir, 'reviews.sqlite');
      const write = (body) => execFileSync('node', ['--input-type=module', '-e', `
        process.env.RECRUITMATCH_DB = ${JSON.stringify(db)};
        const R = await import('${ROOT}/server/lib/rosterGapReview.js');
        const V = await import('${ROOT}/shared/roster/gapReview.js');
        ${body}
      `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: db }, encoding: 'utf8' });
      write(`R.recordReview({ season: 2026, school: 'Alpha', sport: 'mens-soccer',
        disposition: V.DISPOSITION.SOURCE_NOT_AVAILABLE, nextAction: V.NEXT_ACTION.RETRY_ACQUISITION,
        evidence: 'a person looked' });`);
      for (const args of [[], ['--reset-state']]) {
        execFileSync('python3', ['build_targets.py', '2026', ...args],
          { cwd: path.join(ROOT, 'tools/roster_pipeline'), env: { ...process.env, RB_ROOT: dir }, encoding: 'utf8' });
      }
      const after = write("process.stdout.write(JSON.stringify(R.reviewFor(2026,'Alpha','mens-soccer')));");
      expect(JSON.parse(after).disposition).toBe('SOURCE_NOT_AVAILABLE');
      expect(JSON.parse(after).evidence).toBe('a person looked');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
