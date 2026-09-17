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

  it('17. reconciles: with roster + registry duplicates + gaps = the universe', () => {
    const s = q.summary;
    expect(s.reconciles).toBe(true);
    expect(s.ncaaWithRoster + s.registryDuplicates + s.legitimateGaps).toBe(s.ncaaTotal);
    expect(s.legitimateGaps).toBe(q.rows.length);
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

  it('starts every gap unreviewed rather than inheriting a stage document', () => {
    // L7K bootstrapped nothing: the five labels in L7F..L7I were conclusions
    // about a state of the world that L7J proved the pipeline can no longer
    // vouch for, and asserting them here would be the fabrication the stage
    // exists to avoid.
    expect(q.summary.reviewed).toBe(0);
    expect(q.summary.unreviewed).toBe(q.rows.length);
    for (const r of q.rows) {
      expect(r.disposition).toBe(null);
      expect(r.reviewStatus).toBe('UNREVIEWED');
    }
  });

  it('leaves an unreviewed gap retry-eligible', () => {
    expect(q.summary.retryEligible).toBe(q.rows.length);
    expect(q.summary.retryHeld).toBe(0);
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
      expect(r.disposition).toBe(null);   // it is a query result, not a conclusion
      expect(r.recordedStale).toBe(false);
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
    expect(reviews).toBe('0');
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
