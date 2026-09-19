import { describe, it, expect, beforeAll } from 'vitest';
import db from '../db/client.js';
import {
  DIAGNOSIS, DISPOSITION, trustedRosterPredicate, isExcluded, validateTrustRecord,
} from '../../shared/roster/seasonTrust.js';
import { programmeRows, squadRows, buildPoolBenchmarks } from './philosophyQueries.js';
import { loadProgrammePatterns } from './recruitingPatterns.js';
import { datasetManifest, MANIFEST_VERSION } from './evidenceBaseline.js';
import { SEASONS, SQUAD_SEASON, programmePhilosophy } from '../../shared/philosophy.js';

/**
 * L7ZI — the trust mechanism, proved on a seeded fixture and applied to nothing.
 *
 * `vitest.config.js` points every test file at its own throwaway in-memory
 * database, so this seeds the roster it needs rather than reading the working
 * one. That is the right arrangement for a file whose subject is a mechanism
 * for REMOVING data from Evidence — nothing here can reach production — and
 * every write still happens inside a transaction that is always rolled back.
 *
 * The disposition decisions for Eastern New Mexico, San Francisco State and the
 * thirteen unproven seasons belong to a later stage with measurements in front
 * of it. This stage builds the mechanism and applies it to no real season.
 *
 * ---------------------------------------------------------------------------
 * THE TWO PROPERTIES THAT MATTER MOST, and both are about NOT acting:
 *
 *   1. Absence changes nothing. 6,844 programme-seasons have no row here and
 *      must behave exactly as they did before the table existed.
 *   2. A machine diagnosis changes nothing. An audit heuristic that silently
 *      removed a season from Evidence would be the same class of defect the
 *      table exists to record — a conclusion nobody signed, acting on product
 *      intelligence.
 *
 * Only an explicit operator EXCLUDE_FROM_EVIDENCE moves anything.
 */

const COLS = ['college_name', 'sport', 'division', 'season', 'player_name',
  'class_year_label', 'position', 'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'conference'];
const POS = ['MIDFIELD', 'DEFENSE', 'FORWARD', 'GOALKEEPER'];
const PLAYERS = 10;

/** One programme-season with a readable freshman ladder, deterministic. */
function seed({ name, sport, season, minutes }) {
  const ins = db.prepare(`INSERT INTO roster_players (id, created_date, updated_date, ${COLS.join(', ')})
    VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${COLS.map(() => '?').join(', ')})`);
  for (let i = 0; i < PLAYERS; i += 1) {
    const fresh = i < 4;
    ins.run(`${name}|${sport}|${season}|${i}`, name, sport, 'NCAA D1', season,
      `${name} ${season} P${i}`, fresh ? 'Fr.' : ['So.', 'Jr.', 'Sr.'][i % 3], POS[i % 4],
      fresh ? Math.max(1, minutes - i * 40) : 1400 - i * 10, 18, 16,
      Number(season) + 4, Number(season) + 4, 'Test Conf');
  }
}

/** The programme-season every disposition below is applied to. */
const TARGET = { college_name: 'Target College', sport: 'mens-soccer', season: '2024', n: PLAYERS };
/** Same sport, different programme. Must never move. */
const NEIGHBOUR = { college_name: 'Neighbour College', sport: 'mens-soccer', season: '2024', n: PLAYERS };

beforeAll(() => {
  db.prepare('DELETE FROM roster_players').run();
  db.prepare('DELETE FROM roster_season_trust').run();
  db.prepare('DELETE FROM colleges').run();
  const col = db.prepare(`INSERT INTO colleges
    (id, created_date, updated_date, name, sport, division, conference, active)
    VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?, ?, ?, ?, 1)`);
  for (const [name, sport] of [['Target College', 'mens-soccer'], ['Neighbour College', 'mens-soccer'],
    ['Other College', 'mens-soccer'], ['Target College', 'womens-soccer']]) {
    col.run(`${name}|${sport}`, name, sport, 'NCAA D1', 'Test Conf');
  }
  /*
   * The target in EVERY historical season plus the current squad, so excluding
   * one season can be told apart from losing the programme — and a same-named
   * women's programme, which is the axis a programme-only key would lose.
   */
  for (const [i, season] of SEASONS.map(String).entries()) {
    seed({ name: 'Target College', sport: 'mens-soccer', season, minutes: 600 + i * 200 });
    seed({ name: 'Neighbour College', sport: 'mens-soccer', season, minutes: 900 + i * 100 });
    seed({ name: 'Other College', sport: 'mens-soccer', season, minutes: 1500 - i * 100 });
    seed({ name: 'Target College', sport: 'womens-soccer', season, minutes: 700 + i * 150 });
  }
  seed({ name: 'Target College', sport: 'mens-soccer', season: String(SQUAD_SEASON), minutes: 300 });
});

const INSERT = `INSERT INTO roster_season_trust
  (season, college_name, sport, diagnosis, diagnosis_evidence, diagnosed_at,
   disposition, disposition_evidence, reviewed_at, reviewed_by_operator_id)
  VALUES (@season, @college_name, @sport, @diagnosis, @diagnosis_evidence, @diagnosed_at,
          @disposition, @disposition_evidence, @reviewed_at, @reviewed_by_operator_id)`;

const record = (over = {}) => ({
  season: TARGET.season, college_name: TARGET.college_name, sport: TARGET.sport,
  diagnosis: null, diagnosis_evidence: null, diagnosed_at: null,
  disposition: null, disposition_evidence: null, reviewed_at: null,
  reviewed_by_operator_id: null, ...over,
});

/** Run `fn` with `rows` present, then roll every one of them back. */
function withTrust(rows, fn) {
  db.exec('BEGIN');
  try {
    const ins = db.prepare(INSERT);
    for (const r of rows) ins.run(r);
    return fn();
  } finally { db.exec('ROLLBACK'); }
}

/** Everything a roster-derived consumer can see for one programme. */
function snapshot(prog) {
  const history = programmeRows(prog.college_name, prog.sport);
  const squad = squadRows(prog.college_name, prog.sport);
  const philosophy = (() => {
    try { return programmePhilosophy({ rows: history, coachRows: [] }); } catch { return null; }
  })();
  const patterns = loadProgrammePatterns(prog.sport, prog.college_name);
  return JSON.stringify({
    historyRows: history.length,
    historySeasons: [...new Set(history.map((r) => String(r.season)))].sort(),
    squadRows: squad.length,
    ladder: philosophy?.ladder ?? null,
    freshman: philosophy?.freshman ?? null,
    patternSeasons: patterns?.comparableTransitions ?? null,
  });
}

const ladderOf = (sport) => JSON.stringify((buildPoolBenchmarks(sport).ladderByRank ?? [])
  .map((r) => [r.rank, r.n, r.p25, r.median, r.p75]));
const dialsOf = (sport) => JSON.stringify(buildPoolBenchmarks(sport).dials);

/* -------------------------------------------------------------------------- */

describe('L7ZI — the vocabulary is a contract, not a convention', () => {
  it('keeps diagnosis and disposition in separate vocabularies', () => {
    /*
     * They answer different questions and must not become one enum. A
     * measurement says what was observed; a decision says what to do about it.
     * Collapsing them is how a heuristic becomes a policy nobody chose.
     */
    expect(Object.values(DIAGNOSIS)).toEqual([
      'SEASON_IDENTITY_UNPROVEN', 'PROBABLE_DUPLICATE_CAPTURE', 'DEFINITE_MISMATCH']);
    expect(Object.values(DISPOSITION)).toEqual(['RETAIN', 'EXCLUDE_FROM_EVIDENCE']);
    for (const d of Object.values(DIAGNOSIS)) {
      expect(Object.values(DISPOSITION)).not.toContain(d);
    }
  });

  it('only one disposition can remove a season from Evidence', () => {
    expect(isExcluded({ disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE })).toBe(true);
    expect(isExcluded({ disposition: DISPOSITION.RETAIN })).toBe(false);
    expect(isExcluded({ diagnosis: DIAGNOSIS.DEFINITE_MISMATCH })).toBe(false);
    expect(isExcluded(null)).toBe(false);
    expect(isExcluded({})).toBe(false);
  });

  it('refuses a decision nobody can audit later', () => {
    // An exclusion is the only operation here that changes what the product
    // believes. One without a stated reason is worse than no mechanism.
    const base = { college_name: 'X', sport: 'mens-soccer', season: '2024' };
    expect(validateTrustRecord({ ...base, disposition: 'EXCLUDE_FROM_EVIDENCE' }).ok).toBe(false);
    expect(validateTrustRecord({ ...base, disposition: 'EXCLUDE_FROM_EVIDENCE' }).reason)
      .toMatch(/needs evidence/);
    expect(validateTrustRecord({
      ...base, disposition: 'EXCLUDE_FROM_EVIDENCE',
      disposition_evidence: 'source cannot establish the season', reviewed_at: '2026-09-19',
    }).ok).toBe(true);
  });

  it('refuses a record that says nothing, and an unknown state', () => {
    const base = { college_name: 'X', sport: 'mens-soccer', season: '2024' };
    expect(validateTrustRecord(base).reason).toMatch(/says nothing/);
    expect(validateTrustRecord({ ...base, diagnosis: 'LOOKS_ODD' }).ok).toBe(false);
    expect(validateTrustRecord({ ...base, diagnosis: 'SEASON_IDENTITY_UNPROVEN' }).ok).toBe(true);
  });

  it('is written once and reads the disposition, not the diagnosis', () => {
    // The predicate every roster read appends. Asserted on its text because a
    // filter that quietly started keying on `diagnosis` would make a machine
    // suspicion act on Evidence.
    const sql = trustedRosterPredicate('roster_players');
    expect(sql).toContain('roster_season_trust');
    expect(sql).toContain("t.disposition  = 'EXCLUDE_FROM_EVIDENCE'");
    expect(sql).not.toContain('diagnosis');
    expect(sql).toContain('NOT EXISTS');
  });
});

describe('L7ZI — absence and diagnosis change nothing', () => {
  it('a programme with no trust row reads exactly as before', () => {
    const before = snapshot(TARGET);
    const during = withTrust([], () => snapshot(TARGET));
    expect(during).toBe(before);
  });

  it('a DIAGNOSIS with no disposition changes nothing at all', () => {
    /*
     * THE PROPERTY THAT PROTECTS THE PRODUCT FROM ITS OWN AUDIT. L7ZG's
     * classifier is a heuristic over surviving evidence. It may be wrong — it
     * was, about Clemson, in its first draft — and a heuristic that removed
     * seasons on its own would have acted on that before anyone read it.
     */
    const before = snapshot(TARGET);
    const beforePool = ladderOf(TARGET.sport);
    const [after, afterPool] = withTrust([record({
      diagnosis: DIAGNOSIS.PROBABLE_DUPLICATE_CAPTURE,
      diagnosis_evidence: 'squad is 100% of the prior season and no season evidence survives',
      diagnosed_at: '2026-09-19T00:00:00Z',
    })], () => [snapshot(TARGET), ladderOf(TARGET.sport)]);
    expect(after).toBe(before);
    expect(afterPool).toBe(beforePool);
  });

  it('every diagnosis is inert, not just the one', () => {
    const before = snapshot(TARGET);
    for (const diagnosis of Object.values(DIAGNOSIS)) {
      const after = withTrust([record({
        diagnosis, diagnosis_evidence: 'measured', diagnosed_at: '2026-09-19T00:00:00Z',
      })], () => snapshot(TARGET));
      expect(after, `diagnosis ${diagnosis} must not move Evidence`).toBe(before);
    }
  });

  it('an explicit RETAIN behaves exactly like absence', () => {
    /*
     * An operator must be able to look at a diagnosed season, decide it stays,
     * and have that decision recorded WITHOUT it being a change. Otherwise the
     * only way to leave data alone is to leave it un-reviewed.
     */
    const before = snapshot(TARGET);
    const after = withTrust([record({
      diagnosis: DIAGNOSIS.SEASON_IDENTITY_UNPROVEN,
      diagnosis_evidence: 'no surviving season evidence',
      diagnosed_at: '2026-09-19T00:00:00Z',
      disposition: DISPOSITION.RETAIN,
      disposition_evidence: 'kept on the record pending a repair source',
      reviewed_at: '2026-09-19T00:00:00Z',
    })], () => snapshot(TARGET));
    expect(after).toBe(before);
  });
});

describe('L7ZI — EXCLUDE removes exactly its own programme-season', () => {
  const excluded = (over = {}) => record({
    diagnosis: DIAGNOSIS.DEFINITE_MISMATCH,
    diagnosis_evidence: 'source names another season and the rows corroborate it',
    diagnosed_at: '2026-09-19T00:00:00Z',
    disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE,
    disposition_evidence: 'confirmed wrong season; removed from Evidence pending repair',
    reviewed_at: '2026-09-19T00:00:00Z',
    reviewed_by_operator_id: 'op-fixture',
    ...over,
  });

  it('removes the targeted season from the historical read', () => {
    const before = JSON.parse(snapshot(TARGET));
    const after = JSON.parse(withTrust([excluded()], () => snapshot(TARGET)));
    expect(before.historySeasons).toContain(TARGET.season);
    expect(after.historySeasons).not.toContain(TARGET.season);
    expect(after.historyRows).toBe(before.historyRows - TARGET.n);
  });

  it('leaves the same programme’s OTHER seasons untouched', () => {
    const before = JSON.parse(snapshot(TARGET));
    const after = JSON.parse(withTrust([excluded()], () => snapshot(TARGET)));
    const others = before.historySeasons.filter((s) => s !== TARGET.season);
    expect(after.historySeasons).toEqual(others);
    expect(others.length).toBeGreaterThan(0);
  });

  it('leaves a NEIGHBOURING programme byte-identical', () => {
    const before = snapshot(NEIGHBOUR);
    const after = withTrust([excluded()], () => snapshot(NEIGHBOUR));
    expect(after).toBe(before);
  });

  it('leaves the opposite sport byte-identical', () => {
    /*
     * The key is three columns and all three are load-bearing. A filter keyed
     * on programme alone would take both of a school's teams; one keyed on
     * season alone would take a whole year of the sport.
     */
    const beforeW = ladderOf('womens-soccer');
    const beforeDials = dialsOf('womens-soccer');
    const [afterW, afterDials] = withTrust([excluded()],
      () => [ladderOf('womens-soccer'), dialsOf('womens-soccer')]);
    expect(afterW).toBe(beforeW);
    expect(afterDials).toBe(beforeDials);
  });

  it('does not touch the CURRENT squad when a historical season is excluded', () => {
    // Phase 11: the mechanism is all-season capable by schema, and excluding a
    // historical season must not reach 2026. Nothing restricts it structurally;
    // what keeps current data safe is that no current season is dispositioned.
    const before = JSON.parse(snapshot(TARGET));
    const after = JSON.parse(withTrust([excluded()], () => snapshot(TARGET)));
    expect(after.squadRows).toBe(before.squadRows);
    expect(SEASONS.map(String)).toContain(TARGET.season);
    expect(String(SQUAD_SEASON)).not.toBe(TARGET.season);
  });

  it('a repair clears the exclusion and the season re-enters cleanly', () => {
    /*
     * The transition the whole model exists to allow: excluded, repaired,
     * restored. Proved by measuring the restored state against the original
     * rather than against itself — the season must come back as what it was,
     * not as something that merely has the right row count.
     */
    const original = snapshot(TARGET);
    const whileExcluded = withTrust([excluded()], () => snapshot(TARGET));
    expect(whileExcluded).not.toBe(original);

    const afterRepair = withTrust([excluded({
      disposition: DISPOSITION.RETAIN,
      disposition_evidence: 'repaired from a dated archive capture; restored',
      previous_disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE,
      previous_reviewed_at: '2026-09-19T00:00:00Z',
    })], () => snapshot(TARGET));
    expect(afterRepair).toBe(original);
  });

  it('moves the pool legitimately, because a historical input was removed', () => {
    /*
     * EXPECTED MOVEMENT, not a regression. The pool is a relative statistic
     * over the programmes that contributed, so removing a contributor is
     * supposed to change it. What must NOT move is the other sport, asserted
     * above.
     */
    const readableOf = (s) => buildPoolBenchmarks(s).readable;
    const beforeLadder = ladderOf(TARGET.sport);
    const beforeReadable = readableOf(TARGET.sport);
    const [afterLadder, afterReadable] = withTrust([excluded()],
      () => [ladderOf(TARGET.sport), readableOf(TARGET.sport)]);

    // The dials take one observation per readable position-season, so removing
    // a season removes its observations from the population behind them.
    expect(afterReadable).toBeLessThan(beforeReadable);

    /*
     * The ladder takes one median per programme per rank. The target keeps its
     * other seasons and so still contributes a median — a different one, now
     * that one of its seasons is gone — which moves the quantiles beneath it
     * WITHOUT changing `n`. Exactly the relative behaviour L7ZA described, and
     * the reason movement here is legitimate rather than a defect.
     */
    expect(afterLadder).not.toBe(beforeLadder);
    const [b, a] = [JSON.parse(beforeLadder)[0], JSON.parse(afterLadder)[0]];
    expect(a[1]).toBe(b[1]);        // rank-1 n unchanged: no programme left the pool
    expect(a[2]).not.toBe(b[2]);    // p25 moved: a contributor's median changed
  });
});

describe('L7ZI — the manifest can see every state that matters', () => {
  it('is V5, because the definition gained a behavioural component', () => {
    expect(MANIFEST_VERSION).toBe('V5');
    const m = datasetManifest();
    expect(m.tables.map((t) => t.table)).toContain('roster_season_trust');
  });

  it('MOVES when a season is excluded', () => {
    /*
     * The blind spot this had to avoid. An exclusion changes what every
     * roster-derived kind computes while `roster_players` is untouched, so
     * without its own component the dataset line would read UNCHANGED beside a
     * behavioural hash that moved — the exact misdiagnosis K3A, L7O and L7ZA
     * each found one version earlier.
     */
    const before = datasetManifest().digest;
    const after = withTrust([record({
      disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE,
      disposition_evidence: 'confirmed wrong season',
      reviewed_at: '2026-09-19T00:00:00Z',
    })], () => datasetManifest().digest);
    expect(after).not.toBe(before);
  });

  it('MOVES for a diagnosis too, because the record itself is data', () => {
    /*
     * Deliberate, and the distinction is worth stating: a diagnosis does not
     * change EVIDENCE, but it does change the DATASET. The manifest's job is to
     * say whether the data underneath a product hash is the same data, and a
     * row appearing in a behavioural table is a change to it. Reporting the
     * dataset as unchanged while a new record sits in it would be the manifest
     * lying about something it can see.
     */
    const before = datasetManifest().digest;
    const after = withTrust([record({
      diagnosis: DIAGNOSIS.PROBABLE_DUPLICATE_CAPTURE,
      diagnosis_evidence: 'measured', diagnosed_at: '2026-09-19T00:00:00Z',
    })], () => datasetManifest().digest);
    expect(after).not.toBe(before);
  });

  it('returns to its original digest when the exclusion is cleared', () => {
    const original = datasetManifest().digest;
    const excluded = withTrust([record({
      disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE,
      disposition_evidence: 'confirmed wrong season',
      reviewed_at: '2026-09-19T00:00:00Z',
    })], () => datasetManifest().digest);
    expect(excluded).not.toBe(original);
    // Rolled back by `withTrust`, so the live manifest is the original again.
    expect(datasetManifest().digest).toBe(original);
  });

  it('distinguishes RETAIN from EXCLUDE in the digest', () => {
    // Two records identical but for the disposition must not fingerprint the
    // same, or an exclusion could be edited into a retention unnoticed.
    const common = {
      diagnosis: DIAGNOSIS.SEASON_IDENTITY_UNPROVEN,
      diagnosis_evidence: 'no surviving season evidence',
      diagnosed_at: '2026-09-19T00:00:00Z',
      disposition_evidence: 'reviewed', reviewed_at: '2026-09-19T00:00:00Z',
    };
    const retain = withTrust([record({ ...common, disposition: DISPOSITION.RETAIN })],
      () => datasetManifest().digest);
    const exclude = withTrust([record({ ...common, disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE })],
      () => datasetManifest().digest);
    expect(retain).not.toBe(exclude);
  });
});

describe('L7ZI — every write is rolled back', () => {
  it('leaves no trust row behind after all of the above', () => {
    // Asserted here rather than in afterAll so a leak is attributed to this
    // file's own writes rather than to whatever ran last.
    expect(db.prepare('SELECT COUNT(*) n FROM roster_season_trust').get().n).toBe(0);
  });

  it('and the excluded-season component fingerprints an empty table', () => {
    const t = datasetManifest().tables.find((x) => x.table === 'roster_season_trust');
    expect(t.rows).toBe(0);
    expect(t.error).toBeUndefined();
  });
});
