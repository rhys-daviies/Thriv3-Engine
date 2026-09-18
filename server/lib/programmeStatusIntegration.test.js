import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7P — the six approved decisions, against the live registry.
 *
 * These read the working database rather than a fixture, because the question
 * is whether the real universe now tells the truth about 2026. Nothing here
 * writes: every assertion is a read, and one test proves the row count does not
 * move.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIVE_DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');

const run = (body) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  process.env.RECRUITMATCH_DB = ${JSON.stringify(LIVE_DB)};
  const { default: db } = await import('${ROOT}/server/db/client.js');
  const U = await import('${ROOT}/server/scripts/rosterTargetUniverse.js');
  const Q = await import('${ROOT}/server/scripts/rosterGapQueue.js');
  const S = await import('${ROOT}/server/lib/programmeStatus.js');
  void db; void U; void Q; void S;
  process.stdout.write(JSON.stringify(await (async () => { ${body} })() ?? null));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: LIVE_DB }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

const KEYS = {
  annaM: ['Anna Maria', 'mens-soccer'],
  annaW: ['Anna Maria College', 'womens-soccer'],
  njcuM: ['New Jersey City', 'mens-soccer'],
  uwlM: ['Wisconsin-La Crosse', 'mens-soccer'],
  oshM: ['Wisconsin-Oshkosh', 'mens-soccer'],
  smsuM: ['Southwest Minnesota State', 'mens-soccer'],
  njcuW: ['New Jersey City University', 'womens-soccer'],
  brynM: ['Bryn Athyn', 'mens-soccer'],
  brynW: ['Bryn Athyn College of the New Church', 'womens-soccer'],
};

describe('the six approved decisions', () => {
  const seen = run(`
    const out = {};
    for (const [k, [school, sport]] of Object.entries(${JSON.stringify(KEYS)})) {
      out[k] = { status: S.statusFor(school, sport),
                 a2024: S.programmeActiveForSeason(school, sport, 2024),
                 a2026: S.programmeActiveForSeason(school, sport, 2026),
                 a2027: S.programmeActiveForSeason(school, sport, 2027) };
    }
    out._count = db.prepare('SELECT COUNT(*) n FROM programme_status').get().n;
    return out;`);

  it('records exactly six and no more', () => {
    expect(seen._count).toBe(6);
  });

  it('9/10. Anna Maria M and W are excluded for 2026 and preserved for 2024', () => {
    for (const k of ['annaM', 'annaW']) {
      expect(seen[k].status.status).toBe('NOT_ACTIVE');
      expect(seen[k].status.reason).toBe('INSTITUTION_CLOSED');
      // The college closed after the 2025-26 academic year, which is season
      // 2025; soccer is played in the autumn, so 2025 was its last season.
      expect(seen[k].status.activeToSeason).toBe(2025);
      expect(seen[k].a2026).toBe(false);
      expect(seen[k].a2024).toBe(true);
    }
  });

  it('11. New Jersey City M is excluded for 2026 and preserved for 2024', () => {
    expect(seen.njcuM.status.reason).toBe('IDENTITY_TRANSITION');
    expect(seen.njcuM.a2026).toBe(false);
    expect(seen.njcuM.a2024).toBe(true);
  });

  it('12/15. La Crosse M and SMSU M were never fielded, in any season', () => {
    for (const k of ['uwlM', 'smsuM']) {
      expect(seen[k].status.reason).toBe('NOT_SPONSORED');
      expect(seen[k].status.activeToSeason).toBe(null);
      expect(seen[k].a2024).toBe(false);
      expect(seen[k].a2026).toBe(false);
    }
  });

  it('13/14. Wisconsin-Oshkosh M is excluded for 2026 and eligible from 2027', () => {
    expect(seen.oshM.status.status).toBe('FUTURE');
    expect(seen.oshM.status.activeFromSeason).toBe(2027);
    expect(seen.oshM.a2026).toBe(false);
    expect(seen.oshM.a2027).toBe(true);
  });

  it('16/17/18. the three unresolved have no row and stay counted', () => {
    for (const k of ['njcuW', 'brynM', 'brynW']) {
      expect(seen[k].status).toBe(null);
      expect(seen[k].a2026).toBe(true);
    }
  });

  it('every record cites evidence and a first-party source', () => {
    for (const k of ['annaM', 'annaW', 'njcuM', 'uwlM', 'smsuM', 'oshM']) {
      expect(seen[k].status.evidence.length).toBeGreaterThan(40);
      expect(seen[k].status.sourceUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('23. the target universe is season-aware', () => {
  const u = run(`return {
    legacy: U.rosterTargetUniverse().length,
    y2024: U.rosterTargetUniverse({ season: 2024 }).length,
    y2026: U.rosterTargetUniverse({ season: 2026 }).length,
    y2027: U.rosterTargetUniverse({ season: 2027 }).length,
    osh2026: U.rosterTargetUniverse({ season: 2026 }).some(p => p.school === 'Wisconsin-Oshkosh' && p.sport === 'mens-soccer'),
    osh2027: U.rosterTargetUniverse({ season: 2027 }).some(p => p.school === 'Wisconsin-Oshkosh' && p.sport === 'mens-soccer'),
  };`);

  it('omitting a season preserves the old behaviour exactly', () => {
    expect(u.legacy).toBe(1761);
  });

  it('2026 drops the six, and 2027 returns the one that launches', () => {
    expect(u.y2026).toBe(1755);
    expect(u.y2027).toBe(1756);
    expect(u.osh2026).toBe(false);
    expect(u.osh2027).toBe(true);
  });

  it('a past season answers with that season, not with today', () => {
    // Anna Maria and NJCU were fielded in 2024; La Crosse, SMSU and Oshkosh
    // never were, so 2024 loses three rather than six.
    expect(u.y2024).toBe(1758);
  });
});

describe('20/21/22/24. current-season coverage means the season asked for', () => {
  const q = run(`
    const q26 = Q.gapQueue({ season: 2026 });
    return { s: q26.summary,
             keys: q26.rows.map(r => r.key),
             historicalOnlySample: q26.rows.filter(r => r.historicalOnly).slice(0, 3)
               .map(r => ({ key: r.key, latest: r.latestRosterSeason })) };`);

  it('a programme with only a 2025 roster is a 2026 gap', () => {
    // 138 when L7P named the cohort; L7Q re-acquired 13 and L7R one more.
    expect(q.s.historicalOnly).toBe(124);
    for (const r of q.historicalOnlySample) expect(r.latest).toBe('2025');
  });

  it('separates current-season from historical coverage by name', () => {
    /*
     * The clearest demonstration of why these are two metrics: L7Q's pilot
     * re-acquired 13 programmes the dataset ALREADY knew from 2025, and L7R a
     * fourteenth, so the current-season figure rose by 14 and the historical
     * figure could not move at all. One number could never have shown that.
     */
    expect(q.s.currentSeasonRostered).toBe(1621);
    expect(q.s.historicallyRostered).toBe(1745);
    expect(q.s.currentSeasonRostered).toBeLessThan(q.s.historicallyRostered);
  });

  it('31. reconciles, duplicates and all', () => {
    expect(q.s.reconciles).toBe(true);
    expect(q.s.registryDuplicates).toBe(7);
    expect(q.s.currentSeasonRostered + q.s.registryDuplicates + q.s.currentSeasonMissing)
      .toBe(q.s.ncaaTotal);
    expect(q.s.ncaaTotal).toBe(1755);
  });

  it('24. the six are gone from the queue and the three unresolved remain', () => {
    for (const k of ['Anna Maria||mens-soccer', 'Anna Maria College||womens-soccer',
      'New Jersey City||mens-soccer', 'Wisconsin-La Crosse||mens-soccer',
      'Wisconsin-Oshkosh||mens-soccer', 'Southwest Minnesota State||mens-soccer']) {
      expect(q.keys).not.toContain(k);
    }
    for (const k of ['New Jersey City University||womens-soccer', 'Bryn Athyn||mens-soccer',
      'Bryn Athyn College of the New Church||womens-soccer']) {
      expect(q.keys).toContain(k);
    }
    expect(q.s.neverRostered).toBe(3);
  });
});

describe('what L7P must not have changed', () => {
  const fp = run(`return {
    colleges: db.prepare('SELECT COUNT(*) n FROM colleges').get().n,
    inactive: db.prepare('SELECT COUNT(*) n FROM colleges WHERE active = 0').get().n,
    activeDigest: db.prepare("SELECT group_concat(name || ':' || sport || ':' || COALESCE(active,'')) d FROM (SELECT name, sport, active FROM colleges ORDER BY sport, name)").get().d.length,
    rosterPlayers: db.prepare('SELECT COUNT(*) n FROM roster_players').get().n,
    closedSeasons: db.prepare("SELECT COUNT(*) n FROM roster_players WHERE season != '2026'").get().n,
    domains: db.prepare('SELECT COUNT(*) n FROM athletics_domains').get().n,
    reviews: db.prepare('SELECT COUNT(*) n FROM roster_gap_reviews').get().n,
  };`);

  it('32. colleges.active is untouched — three inactive, as before', () => {
    expect(fp.colleges).toBe(2404);
    expect(fp.inactive).toBe(3);
  });

  it('33/34. programme status moved no roster row and no domain row', () => {
    /*
     * PINNED AT THE SEASON BOUNDARY, NOT AT A TOTAL.
     *
     * This asserted `roster_players = 277410`, which said "L7P wrote no roster
     * data" by freezing a number that every acquiring stage is supposed to
     * move — and L7Q moved it, adding 424 rows across 13 programmes. Repinning
     * the total each time would make the assertion mean nothing.
     *
     * What a programme-status stage may never do is rewrite a season that is
     * already closed, or touch the domain ledger. That is the claim, so that is
     * what is measured.
     */
    expect(fp.closedSeasons).toBe(218938);
    expect(fp.domains).toBe(2723);
    expect(fp.rosterPlayers).toBeGreaterThanOrEqual(fp.closedSeasons);
  });

  it('19. the six roster-gap reviews are preserved', () => {
    // Status supersedes their operational question for 2026; the review remains
    // the record of why the decision was made.
    expect(fp.reviews).toBe(7);
  });

  it('28. historical rosters survive a NOT_ACTIVE status', () => {
    const r = run(`return db.prepare(
      "SELECT season, COUNT(*) n FROM roster_players WHERE college_name = 'Kean' AND sport = 'mens-soccer' GROUP BY season ORDER BY season").all();`);
    expect(r.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------- */
/* 26. both database construction paths                                      */
/* ------------------------------------------------------------------------- */

describe('the table exists on a database built either way', () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l7p-')); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('a fresh database gets programme_status and accepts a row', () => {
    const fresh = path.join(dir, 'fresh.sqlite');
    const out = JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
      process.env.RECRUITMATCH_DB = ${JSON.stringify('PLACEHOLDER')}.replace('PLACEHOLDER', ${JSON.stringify(fresh)});
      const { default: db } = await import('${ROOT}/server/db/client.js');
      const cols = db.prepare('PRAGMA table_info(programme_status)').all().map(c => c.name);
      const S = await import('${ROOT}/server/lib/programmeStatus.js');
      db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active) VALUES ('c1','t','t','Fixture','mens-soccer','NCAA D3',1)").run();
      const w = S.recordStatus({ school: 'Fixture', sport: 'mens-soccer', status: 'FUTURE',
        reason: 'LAUNCHING', activeFromSeason: 2027, evidence: 'the site says it starts in 2027',
        sourceUrl: 'https://example.test/' });
      process.stdout.write(JSON.stringify({ cols, ok: w.ok, reason: w.reason,
        active26: S.programmeActiveForSeason('Fixture','mens-soccer',2026),
        active27: S.programmeActiveForSeason('Fixture','mens-soccer',2027) }));
    `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: fresh }, encoding: 'utf8' }));
    expect(out.cols).toContain('active_from_season');
    expect(out.cols).toContain('source_url');
    expect(out.ok).toBe(true);
    expect(out.active26).toBe(false);
    expect(out.active27).toBe(true);
  });

  it('is idempotent — booting twice neither fails nor duplicates', () => {
    const twice = path.join(dir, 'twice.sqlite');
    const boot = () => execFileSync('node', ['--input-type=module', '-e', `
      process.env.RECRUITMATCH_DB = ${JSON.stringify(twice)};
      const { default: db } = await import('${ROOT}/server/db/client.js');
      process.stdout.write(String(db.prepare('SELECT COUNT(*) n FROM programme_status').get().n));
    `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: twice }, encoding: 'utf8' });
    expect(boot()).toBe('0');
    expect(boot()).toBe('0');
  });

  it('refuses a status for a programme the registry does not have', () => {
    const p = path.join(dir, 'reg.sqlite');
    const out = JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
      process.env.RECRUITMATCH_DB = ${JSON.stringify(p)};
      await import('${ROOT}/server/db/client.js');
      const S = await import('${ROOT}/server/lib/programmeStatus.js');
      const w = S.recordStatus({ school: 'Nowhere', sport: 'mens-soccer', status: 'NOT_ACTIVE',
        reason: 'NOT_SPONSORED', evidence: 'nothing', sourceUrl: 'https://example.test/' });
      process.stdout.write(JSON.stringify({ ok: w.ok, reason: w.reason }));
    `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: p }, encoding: 'utf8' }));
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not a registry programme/);
  });
});
