import { describe, it, expect, beforeAll } from 'vitest';
import db from '../db/client.js';
import {
  EXPECTED, loadProgrammeSeasons, deriveDuplicates, deriveUnproven, buildRecords, planDigest,
} from './recordSeasonTrust.js';
import { trustQueue } from './seasonTrustQueue.js';
import { DIAGNOSIS, DISPOSITION, validateTrustRecord, isExcluded } from '../../shared/roster/seasonTrust.js';
import { SEASONS, SQUAD_SEASON } from '../../shared/philosophy.js';

/**
 * L7ZJ — writing down what was measured, without deciding anything new.
 *
 * L7ZG found two probable duplicate captures and L7ZH thirteen seasons whose
 * identity nothing surviving can establish. L7ZI built somewhere to put that.
 * This stage records it, and the whole risk is that recording turns into
 * deciding: a queue cleared by marking everything RETAIN, an exclusion written
 * because a heuristic was confident, an operator id invented so a column could
 * be filled.
 *
 * These pin the three refusals that stop that happening:
 *
 *   1. the cohort is DERIVED, and a changed measurement stops the run
 *   2. the thirteen get NO disposition — unproven is not wrong
 *   3. nothing here can write EXCLUDE_FROM_EVIDENCE at all
 *
 * A seeded fixture, because `vitest.config.js` points every file at its own
 * in-memory database. The derivation rules are the real ones, exported from
 * the script rather than restated here — a rule re-expressed in its own test
 * proves only that the copy agrees with itself.
 */

const COLS = ['college_name', 'sport', 'division', 'season', 'player_name', 'class_year_label',
  'position', 'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'conference'];
const POS = ['MIDFIELD', 'DEFENSE', 'FORWARD', 'GOALKEEPER'];

function seedProgramme({ name, sport, season, url, names, division = 'NCAA D1' }) {
  const ins = db.prepare(`INSERT INTO roster_players (id, created_date, updated_date, ${COLS.join(', ')})
    VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${COLS.map(() => '?').join(', ')})`);
  names.forEach((n, i) => {
    ins.run(`${name}|${sport}|${season}|${i}`, name, sport, division, season, n,
      i < 4 ? 'Fr.' : 'Sr.', POS[i % 4], 900 - i * 10, 18, 16,
      Number(season) + 4, Number(season) + 4, 'Test Conf');
  });
  db.prepare('UPDATE roster_players SET source_roster_url = ? WHERE college_name = ? AND sport = ? AND season = ?')
    .run(url, name, sport, season);
}

const SQUAD_A = Array.from({ length: 10 }, (_, i) => `Alpha Player ${i}`);
const SQUAD_B = Array.from({ length: 10 }, (_, i) => `Beta Player ${i}`);

/*
 * The REAL loader, not a copy of it. A first draft of this file rebuilt the
 * programme-season shape by hand and left out the route computation, so every
 * fixture looked as though nothing asserted its season and the control
 * programme was wrongly called a duplicate. A rule re-expressed in its own test
 * proves only that the copy agrees with itself.
 */
const derive = () => loadProgrammeSeasons();

beforeAll(async () => {
  db.prepare('DELETE FROM roster_players').run();
  db.prepare('DELETE FROM roster_season_trust').run();
  db.prepare('DELETE FROM colleges').run();
  const col = db.prepare(`INSERT INTO colleges
    (id, created_date, updated_date, name, sport, division, conference, active)
    VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?, ?, ?, ?, 1)`);
  for (const n of ['Dup College', 'Kept College', 'Clean College', 'New College']) {
    col.run(`${n}|mens-soccer`, n, 'mens-soccer', 'NCAA D1', 'Test Conf');
  }
  const { routeClass } = await import('./seasonIntegrityAudit.js');
  expect(routeClass('https://x.com/sports/mens-soccer/roster')).toBe('C_BARE_CURRENT_ROUTE');

  const [y1, y2] = [SEASONS.map(String)[2], SEASONS.map(String)[3]];  // 2024, 2025

  /*
   * DUP: the same squad in consecutive seasons, from the bare route. Resembles
   * AND nothing asserts the season — the two signals L7ZG requires together.
   */
  seedProgramme({ name: 'Dup College', sport: 'mens-soccer', season: y1, names: SQUAD_A,
    url: 'https://x.com/sports/mens-soccer/roster/2024' });
  seedProgramme({ name: 'Dup College', sport: 'mens-soccer', season: y2, names: SQUAD_A,
    url: 'https://x.com/sports/mens-soccer/roster' });

  /*
   * KEPT: the same squad in consecutive seasons, but the later one came from a
   * season-bearing URL. Resemblance alone, which must NOT be a finding — real
   * programmes keep their squads.
   */
  seedProgramme({ name: 'Kept College', sport: 'mens-soccer', season: y1, names: SQUAD_A,
    url: 'https://y.com/sports/mens-soccer/roster/2024' });
  seedProgramme({ name: 'Kept College', sport: 'mens-soccer', season: y2, names: SQUAD_A,
    url: 'https://y.com/sports/mens-soccer/roster/2025' });

  /* CLEAN: ordinary turnover, season-bearing URLs. Neither cohort. */
  seedProgramme({ name: 'Clean College', sport: 'mens-soccer', season: y1, names: SQUAD_A,
    url: 'https://z.com/sports/mens-soccer/roster/2024' });
  seedProgramme({ name: 'Clean College', sport: 'mens-soccer', season: y2, names: SQUAD_B,
    url: 'https://z.com/sports/mens-soccer/roster/2025' });

  /* NEW: first appearance, bare route. No prior season and nothing asserts one. */
  seedProgramme({ name: 'New College', sport: 'mens-soccer', season: y2, names: SQUAD_B,
    url: 'https://w.com/sports/mens-soccer/roster' });
});

/* -------------------------------------------------------------------------- */

describe('L7ZJ — the cohort is derived, not listed', () => {
  it('finds the duplicate by TWO signals, not by resemblance alone', () => {
    /*
     * `Kept College` is the control and it is the important one. Its two
     * seasons are the identical squad — a 100% overlap — and it is not a
     * finding, because a season-bearing URL asserts which season the later one
     * is. Without this control the rule would be "high overlap is corruption",
     * which would have condemned the eight real programmes L7Q admits.
     */
    const dups = deriveDuplicates(derive());
    expect(dups.map((d) => d.college_name)).toEqual(['Dup College']);
    expect(dups[0].overlap).toBe(1);
    expect(dups[0].identical).toBe(true);
  });

  it('finds the unproven season by absence of BOTH legs', () => {
    const ps = derive();
    const unproven = deriveUnproven(ps, deriveDuplicates(ps));
    expect(unproven.map((u) => u.college_name)).toEqual(['New College']);
  });

  it('never counts a programme in both cohorts', () => {
    const ps = derive();
    const dups = deriveDuplicates(ps);
    const unproven = deriveUnproven(ps, dups);
    const keys = (xs) => xs.map((x) => `${x.college_name}||${x.sport}||${x.season}`);
    expect(keys(unproven).filter((k) => keys(dups).includes(k))).toEqual([]);
  });

  it('excludes the earliest season, where a missing reference is arithmetic', () => {
    // Nothing can precede the first season held, so its absent prior is not a
    // finding about the data. Otherwise every programme's debut is "unproven".
    const earliest = [...SEASONS.map(String), String(SQUAD_SEASON)].sort()[0];
    const ps = derive();
    const unproven = deriveUnproven(ps, deriveDuplicates(ps));
    expect(unproven.every((u) => u.season !== earliest)).toBe(true);
  });

  it('states what it expects to find, so a changed measurement stops the run', () => {
    // The production cohort. A run that found three duplicates would be finding
    // something new, and a stage told to record two must not record three.
    expect(EXPECTED).toEqual({ duplicates: 2, unproven: 13 });
  });
});

describe('L7ZJ — what the records say', () => {
  const build = () => {
    const ps = derive();
    const duplicates = deriveDuplicates(ps);
    return buildRecords({ duplicates, unproven: deriveUnproven(ps, duplicates), at: '2026-09-19T00:00:00Z' });
  };

  it('gives the duplicate a diagnosis AND a human RETAIN', () => {
    const r = build().find((x) => x.college_name === 'Dup College');
    expect(r.diagnosis).toBe(DIAGNOSIS.PROBABLE_DUPLICATE_CAPTURE);
    expect(r.disposition).toBe(DISPOSITION.RETAIN);
    expect(r.reviewed_at).toBeTruthy();
    expect(r.disposition_evidence).toBeTruthy();
  });

  it('does NOT claim the retained season is correct', () => {
    /*
     * The sentence an operator will read later, and the distinction the record
     * exists to hold: retaining a season nobody can vouch for is not the same
     * as verifying it. A record that blurred the two would be worse than none.
     */
    const r = build().find((x) => x.college_name === 'Dup College');
    expect(r.disposition_evidence).toMatch(/does not assert that the stored season is correct/i);
    expect(r.disposition_evidence).not.toMatch(/\bverified\b/i);
    expect(r.disposition_evidence).not.toMatch(/\bconfirmed\b/i);
    expect(r.disposition_evidence).not.toMatch(/\bresolved\b/i);
    // And the diagnosis is preserved, not cleared by the decision.
    expect(r.diagnosis).toBe(DIAGNOSIS.PROBABLE_DUPLICATE_CAPTURE);
  });

  it('gives the unproven season a diagnosis and NO disposition', () => {
    /*
     * THE REFUSAL THAT MATTERS MOST. Marking thirteen seasons RETAIN would
     * empty the queue and would be a decision disguised as tidiness — and
     * excluding them because provenance is absent would convict on one signal.
     * Both are refused by writing nothing in the human half.
     */
    const r = build().find((x) => x.college_name === 'New College');
    expect(r.diagnosis).toBe(DIAGNOSIS.SEASON_IDENTITY_UNPROVEN);
    expect(r.disposition).toBeNull();
    expect(r.disposition_evidence).toBeNull();
    expect(r.reviewed_at).toBeNull();
    expect(r.reviewed_by_operator_id).toBeNull();
  });

  it('says in the evidence itself that unproven is not wrong', () => {
    const r = build().find((x) => x.college_name === 'New College');
    expect(r.diagnosis_evidence).toMatch(/not a finding that they are wrong/i);
  });

  it('writes no exclusion, in any record', () => {
    const recs = build();
    expect(recs.filter((r) => r.disposition === DISPOSITION.EXCLUDE_FROM_EVIDENCE)).toEqual([]);
    expect(recs.filter(isExcluded)).toEqual([]);
    expect(recs.filter((r) => r.diagnosis === DIAGNOSIS.DEFINITE_MISMATCH)).toEqual([]);
  });

  it('passes the L7ZI validator unmodified', () => {
    // Validation was not weakened to make these writes easier; every record
    // satisfies the contract as it already stood.
    for (const r of build()) expect(validateTrustRecord(r)).toEqual({ ok: true, reason: null });
  });

  it('digests the decision and not the clock', () => {
    /*
     * A plan digest that included `diagnosed_at` could never match another run,
     * which is the opposite of what a plan digest is for. Two builds an hour
     * apart must agree.
     */
    const ps = derive();
    const duplicates = deriveDuplicates(ps);
    const unproven = deriveUnproven(ps, duplicates);
    const a = buildRecords({ duplicates, unproven, at: '2026-09-19T00:00:00Z' });
    const b = buildRecords({ duplicates, unproven, at: '2027-01-01T12:34:56Z' });
    expect(planDigest(a)).toBe(planDigest(b));
    expect(a[0].diagnosed_at).not.toBe(b[0].diagnosed_at);
  });
});

describe('L7ZJ — the write is atomic and the read model is deterministic', () => {
  const INSERT = `INSERT INTO roster_season_trust
    (season, college_name, sport, diagnosis, diagnosis_evidence, diagnosed_at,
     disposition, disposition_evidence, reviewed_at, reviewed_by_operator_id, next_action)
    VALUES (@season, @college_name, @sport, @diagnosis, @diagnosis_evidence, @diagnosed_at,
            @disposition, @disposition_evidence, @reviewed_at, @reviewed_by_operator_id, @next_action)`;

  const build = () => {
    const ps = derive();
    const duplicates = deriveDuplicates(ps);
    return buildRecords({ duplicates, unproven: deriveUnproven(ps, duplicates), at: '2026-09-19T00:00:00Z' });
  };

  it('rolls back every record when one fails', () => {
    /*
     * A partial record of a measurement is not a measurement. Forced by giving
     * the last row a duplicate key, which the primary key refuses.
     */
    const recs = build();
    const before = db.prepare('SELECT COUNT(*) n FROM roster_season_trust').get().n;
    const write = db.transaction((rows) => {
      const ins = db.prepare(INSERT);
      for (const r of rows) ins.run(r);
    });
    expect(() => write([...recs, recs[0]])).toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM roster_season_trust').get().n).toBe(before);
  });

  it('reads back as an operator queue, ordered by facts', () => {
    const recs = build();
    db.transaction((rows) => {
      const ins = db.prepare(INSERT);
      for (const r of rows) ins.run(r);
    })(recs);

    const q = trustQueue();
    expect(q).toHaveLength(recs.length);
    // Every field a reviewer needs is present on every row.
    for (const r of q) {
      for (const f of ['college_name', 'sport', 'season', 'diagnosis', 'diagnosis_evidence',
        'diagnosed_at', 'disposition', 'disposition_evidence', 'reviewed_at',
        'reviewed_by_operator_id', 'next_action', 'rows', 'division', 'association',
        'evidenceExposed', 'excludedFromEvidence', 'reviewState']) {
        expect(r, `${r.college_name} is missing ${f}`).toHaveProperty(f);
      }
    }
    // Nothing in the queue removes anything from Evidence.
    expect(q.filter((r) => r.excludedFromEvidence)).toEqual([]);
    // Dispositioned and pending are separated by the record, not by a guess.
    expect(q.filter((r) => r.reviewState === 'DISPOSITIONED').map((r) => r.college_name))
      .toEqual(['Dup College']);
    expect(q.filter((r) => r.reviewState === 'PENDING_REVIEW').map((r) => r.college_name))
      .toEqual(['New College']);

    // Deterministic: the same queue twice, in the same order.
    expect(trustQueue().map((r) => `${r.college_name}|${r.sport}|${r.season}`))
      .toEqual(q.map((r) => `${r.college_name}|${r.sport}|${r.season}`));

    db.prepare('DELETE FROM roster_season_trust').run();
  });

  it('orders Evidence-exposed and NCAA first, without scoring anything', () => {
    /*
     * The order is a reading order, not a ranking. Asserted on the comparator's
     * behaviour rather than on a number, because a score would be this file
     * inventing an opinion the audits never formed.
     */
    const recs = build().map((r) => ({ ...r }));
    const ins = db.prepare(INSERT);
    db.transaction((rows) => { for (const r of rows) ins.run(r); })(recs);
    const q = trustQueue();
    const rank = (r) => [Number(!r.evidenceExposed), Number(r.association !== 'NCAA')].join('');
    const ranks = q.map(rank);
    expect([...ranks].sort()).toEqual(ranks);   // non-decreasing: the order holds
    db.prepare('DELETE FROM roster_season_trust').run();
  });
});
