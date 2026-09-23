import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import {
  FRESH, STALE, LEGACY_UNVERIFIED, BUILDER_VERSION,
  effectiveInputDigest, materialisationState, recordBuild, buildRecordFor,
  StaleMaterialisationError,
} from './recruitingMaterialisation.js';
import { loadProgrammePatterns, loadPatternsForSport } from './recruitingPatterns.js';
import { recordDisposition, exclusionBlockedReason } from './seasonTrustReview.js';
import { DIAGNOSIS, DISPOSITION, trustedRosterPredicate } from '../../shared/roster/seasonTrust.js';
import { SEASONS } from '../../shared/philosophy.js';

/**
 * L7ZL — `recruiting_arrivals` and the roster it was built from.
 *
 * The table is MATERIALISED: the builder reads a sport's roster, computes every
 * arrival, and rewrites the sport wholesale. Nothing recorded WHICH roster it
 * read, so nothing could tell whether the answer it serves is still the answer
 * the data supports.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT. Once a programme-season is EXCLUDE_FROM_EVIDENCE, no
 * roster-derived intelligence may keep consuming a materialised representation
 * derived from it. Raw roster reads honour an exclusion immediately; the
 * arrivals do not. Without a guard the product holds two truths at once — a
 * season removed from the ladder and still present behind
 * ARRIVAL_SAME_COUNTRY_POSITION, which is outreach-licensed and reaches email.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FINGERPRINT IS OVER, and why it gives three properties for free.
 * It digests the EFFECTIVE input — the roster the builder can actually read,
 * with excluded seasons removed — rather than `roster_players` and the trust
 * table separately. So:
 *
 *   a DIAGNOSIS changes no row of it              -> no staleness
 *   a RETAIN changes no row of it either          -> no staleness
 *   an EXCLUSION removes rows from it             -> stale immediately
 *
 * RETAIN and absence are the same instruction to Evidence, and rebuilding
 * 87,000 rows because someone wrote an audit note would be work with no product
 * meaning.
 */

const COLS = ['college_name', 'sport', 'division', 'season', 'player_name', 'class_year_label',
  'position', 'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'conference', 'nationality', 'country'];

const SPORT = 'mens-soccer';
const [Y1, Y2] = [SEASONS.map(String)[2], SEASONS.map(String)[3]];   // 2024, 2025

function seed({ name, season, names }) {
  const ins = db.prepare(`INSERT INTO roster_players (id, created_date, updated_date, ${COLS.join(', ')})
    VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${COLS.map(() => '?').join(', ')})`);
  names.forEach((n, i) => {
    ins.run(`${name}|${season}|${i}`, name, SPORT, 'NCAA D1', season, n,
      'Fr.', 'MIDFIELD', 500, 18, 16, Number(season) + 4, Number(season) + 4,
      'Test Conf', 'International', 'Brazil');
  });
}

const TRUST = `INSERT INTO roster_season_trust
  (season, college_name, sport, diagnosis, diagnosis_evidence, diagnosed_at,
   disposition, disposition_evidence, reviewed_at, reviewed_by_operator_id)
  VALUES (@season, @college_name, @sport, @diagnosis, @diagnosis_evidence, @diagnosed_at,
          @disposition, @disposition_evidence, @reviewed_at, @reviewed_by_operator_id)`;

const trustRow = (over = {}) => ({
  season: Y1, college_name: 'Alpha College', sport: SPORT,
  diagnosis: DIAGNOSIS.SEASON_IDENTITY_UNPROVEN, diagnosis_evidence: 'measured',
  diagnosed_at: '2026-09-19T00:00:00Z',
  disposition: null, disposition_evidence: null, reviewed_at: null,
  reviewed_by_operator_id: null, ...over,
});

/**
 * The real builder's write half, stamped exactly as production stamps it —
 * including reading the EFFECTIVE roster rather than the raw one, which is the
 * property the exclusion lifecycle below actually tests.
 */
function build(sport = SPORT, { crashBeforeStamp = false } = {}) {
  const digest = effectiveInputDigest(sport);
  const rows = db.prepare(
    `SELECT college_name, season, player_name FROM roster_players
      WHERE sport = ? AND ${trustedRosterPredicate('roster_players')}`).all(sport);
  db.transaction(() => {
    db.prepare('DELETE FROM recruiting_arrivals WHERE sport = ?').run(sport);
    const ins = db.prepare(`INSERT INTO recruiting_arrivals
      (programme, sport, arrival_season, prior_season, source_transition, roster_row_id,
       player_name, name_key, arrival_confidence, identity_method, canonical_position,
       is_international, entry_type, prior_confidence, coach_attribution, built_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DIRECT', 'EXACT', 'MIDFIELD', 1, 'FRESHMAN', 'NONE', 'UNKNOWN', ?)`);
    for (const r of rows) {
      if (String(r.season) !== Y2) continue;   // arrivals into Y2 only, for the fixture
      ins.run(r.college_name, sport, Y2, Y1, `${Y1}->${Y2}`, `${r.college_name}|${r.season}`,
        r.player_name, r.player_name.toLowerCase().replace(/[^a-z]/g, ''), '2026-01-01T00:00:00Z');
    }
    if (crashBeforeStamp) throw new Error('simulated crash before the stamp');
    recordBuild({ sport, digest });
  })();
}

beforeEach(() => {
  db.prepare('DELETE FROM roster_players').run();
  db.prepare('DELETE FROM recruiting_arrivals').run();
  db.prepare('DELETE FROM recruiting_arrivals_build').run();
  db.prepare('DELETE FROM roster_season_trust').run();
  db.prepare('DELETE FROM coach_seasons').run();
  seed({ name: 'Alpha College', season: Y1, names: ['Ana Silva', 'Bea Costa', 'Cia Lima'] });
  seed({ name: 'Alpha College', season: Y2, names: ['Dia Rocha', 'Eva Souza'] });
  seed({ name: 'Beta College', season: Y1, names: ['Fia Alves', 'Gia Dias'] });
  seed({ name: 'Beta College', season: Y2, names: ['Hia Melo', 'Ina Pinto'] });
});

/* -------------------------------------------------------------------------- */

describe('L7ZL — the three states', () => {
  it('is LEGACY_UNVERIFIED with no build record, and reads still work', () => {
    /*
     * The honest third state, following L7ZK's LEGACY_UNATTRIBUTED. Production
     * has been in it since 2026-08-29; stamping that build as FRESH would have
     * asserted a freshness L7ZL measured to be false, and refusing every read
     * would take working product down to make a point.
     */
    expect(buildRecordFor(SPORT)).toBeNull();
    expect(materialisationState(SPORT).state).toBe(LEGACY_UNVERIFIED);
    expect(() => loadProgrammePatterns(SPORT, 'Alpha College')).not.toThrow();
  });

  it('is FRESH after a build, with a stamp that names its inputs', () => {
    build();
    const s = materialisationState(SPORT);
    expect(s.state).toBe(FRESH);
    expect(s.expected).toBe(s.actual);
    expect(buildRecordFor(SPORT).builder_version).toBe(BUILDER_VERSION);
    expect(buildRecordFor(SPORT).generation).toBe(1);
  });

  it('is STALE when the roster moves under it', () => {
    build();
    seed({ name: 'Gamma College', season: Y2, names: ['Jia Neves'] });
    expect(materialisationState(SPORT).state).toBe(STALE);
  });

  it('is STALE after an in-place correction that moves no counter', () => {
    /*
     * THE REGRESSION THIS EXISTS FOR. The first cache key here was a set of
     * COUNT()s and a MAX(updated_date). An UPDATE that corrects one player's
     * position moves neither: same row count, same timestamps, different
     * roster. That key would have held its digest and gone on reporting FRESH
     * for an input that had changed — the cache quietly defeating the guard it
     * was added to make affordable.
     *
     * The change token is data_version + total_changes(), so any write at all
     * drops it. Deliberately over-invalidating; safe in the only direction
     * that matters.
     */
    build();
    const before = db.prepare('SELECT COUNT(*) n, MAX(updated_date) at FROM roster_players WHERE sport = ?').get(SPORT);
    db.prepare(`UPDATE roster_players SET position = 'Goalkeeper'
        WHERE sport = ? AND college_name = 'Alpha College' AND season = ?`).run(SPORT, Y2);
    const after = db.prepare('SELECT COUNT(*) n, MAX(updated_date) at FROM roster_players WHERE sport = ?').get(SPORT);

    expect(after).toEqual(before);                       // the old key saw nothing
    expect(materialisationState(SPORT).state).toBe(STALE);  // the new one does
  });
});

describe('L7ZL — a stale read refuses, and is not "no evidence"', () => {
  it('RAISES a typed condition rather than returning null', () => {
    /*
     * THE DISTINCTION THAT MATTERS MOST. `loadProgrammePatterns` answers null
     * for a programme with no recruiting history, which is ordinary and true.
     * A stale materialisation is "we cannot say", and returning null would make
     * a data-integrity failure read as a programme with no arrivals — silently
     * withholding claims instead of reporting why.
     */
    build();
    seed({ name: 'Gamma College', season: Y2, names: ['Jia Neves'] });
    let err = null;
    try { loadProgrammePatterns(SPORT, 'Alpha College'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(StaleMaterialisationError);
    expect(err.code).toBe('MATERIALISATION_STALE');
    expect(err.sport).toBe(SPORT);
    expect(err.message).toMatch(/npm run build:recruiting/);
  });

  it('refuses the whole-sport loader too', () => {
    build();
    seed({ name: 'Gamma College', season: Y2, names: ['Jia Neves'] });
    expect(() => loadPatternsForSport(SPORT)).toThrow(StaleMaterialisationError);
  });

  it('and a genuinely empty programme still answers null when fresh', () => {
    // The control: null must keep meaning "no recruiting history".
    build();
    expect(materialisationState(SPORT).state).toBe(FRESH);
    expect(loadProgrammePatterns(SPORT, 'Nowhere College')).toBeNull();
  });
});

describe('L7ZL — only an exclusion stales the materialisation', () => {
  const insTrust = (over) => db.prepare(TRUST).run(trustRow(over));

  it('a DIAGNOSIS changes nothing', () => {
    /*
     * A machine measurement does not alter Evidence, so it must not cost a
     * rebuild either. The fingerprint is over the effective roster, and a
     * diagnosis removes no row from it.
     */
    build();
    const before = effectiveInputDigest(SPORT);
    insTrust({ diagnosis: DIAGNOSIS.PROBABLE_DUPLICATE_CAPTURE });
    expect(effectiveInputDigest(SPORT)).toBe(before);
    expect(materialisationState(SPORT).state).toBe(FRESH);
  });

  it('a RETAIN changes nothing either', () => {
    /*
     * RETAIN and absence are the same instruction to Evidence. Rebuilding
     * 87,000 rows because someone recorded an audit note would be work with no
     * product meaning — and would train people to ignore the staleness signal.
     */
    build();
    const before = effectiveInputDigest(SPORT);
    insTrust({ disposition: DISPOSITION.RETAIN, disposition_evidence: 'kept',
      reviewed_at: '2026-09-19T00:00:00Z', reviewed_by_operator_id: 'op-1' });
    expect(effectiveInputDigest(SPORT)).toBe(before);
    expect(materialisationState(SPORT).state).toBe(FRESH);
  });

  it('an EXCLUSION stales it immediately', () => {
    build();
    insTrust({ disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE,
      disposition_evidence: 'confirmed wrong season', reviewed_at: '2026-09-19T00:00:00Z',
      reviewed_by_operator_id: 'op-1' });
    expect(materialisationState(SPORT).state).toBe(STALE);
    expect(() => loadProgrammePatterns(SPORT, 'Alpha College')).toThrow(StaleMaterialisationError);
  });

  it('clearing an exclusion stales it again, because the season re-enters', () => {
    build();
    insTrust({ disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE,
      disposition_evidence: 'x', reviewed_at: '2026-09-19T00:00:00Z', reviewed_by_operator_id: 'op-1' });
    build();                                   // rebuild without the excluded season
    expect(materialisationState(SPORT).state).toBe(FRESH);
    db.prepare('UPDATE roster_season_trust SET disposition = ? WHERE college_name = ?')
      .run(DISPOSITION.RETAIN, 'Alpha College');
    expect(materialisationState(SPORT).state).toBe(STALE);
    build();
    expect(materialisationState(SPORT).state).toBe(FRESH);
  });

  it('two changes before a rebuild are ONE stale state and ONE rebuild', () => {
    /*
     * Staleness is a property of the data, not a queue of events. An operator
     * reviewing five seasons in a sitting should rebuild once at the end, not
     * five times.
     */
    build();
    insTrust({ disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE, disposition_evidence: 'x',
      reviewed_at: '2026-09-19T00:00:00Z', reviewed_by_operator_id: 'op-1' });
    insTrust({ college_name: 'Beta College', disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE,
      disposition_evidence: 'x', reviewed_at: '2026-09-19T00:00:00Z', reviewed_by_operator_id: 'op-1' });
    expect(materialisationState(SPORT).state).toBe(STALE);
    build();
    expect(materialisationState(SPORT).state).toBe(FRESH);
    expect(buildRecordFor(SPORT).generation).toBe(2);
  });
});

describe('L7ZL — the excluded season is gone after a rebuild', () => {
  it('its rows stop contributing, and reads resume', () => {
    build();
    const beforeRows = db.prepare(
      'SELECT COUNT(*) n FROM recruiting_arrivals WHERE programme = ?').get('Alpha College').n;
    expect(beforeRows).toBeGreaterThan(0);

    db.prepare(TRUST).run(trustRow({ season: Y2, disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE,
      disposition_evidence: 'confirmed wrong season', reviewed_at: '2026-09-19T00:00:00Z',
      reviewed_by_operator_id: 'op-1' }));
    expect(materialisationState(SPORT).state).toBe(STALE);

    build();
    expect(materialisationState(SPORT).state).toBe(FRESH);
    expect(db.prepare('SELECT COUNT(*) n FROM recruiting_arrivals WHERE programme = ?')
      .get('Alpha College').n).toBe(0);
    // And Beta, which was never excluded, is untouched.
    expect(db.prepare('SELECT COUNT(*) n FROM recruiting_arrivals WHERE programme = ?')
      .get('Beta College').n).toBeGreaterThan(0);
    expect(() => loadProgrammePatterns(SPORT, 'Beta College')).not.toThrow();
  });
});

describe('L7ZL — data and stamp cannot diverge', () => {
  it('a failed rebuild leaves the previous state, not a false FRESH', () => {
    /*
     * ATOMICITY. If the rows and the stamp could commit separately, a crash
     * between them would leave a materialisation claiming a freshness it does
     * not have — the precise failure the stamp exists to prevent. Both are in
     * one transaction, so a throw rolls back both.
     */
    build();
    seed({ name: 'Gamma College', season: Y2, names: ['Jia Neves'] });
    expect(materialisationState(SPORT).state).toBe(STALE);
    const genBefore = buildRecordFor(SPORT).generation;
    const rowsBefore = db.prepare('SELECT COUNT(*) n FROM recruiting_arrivals').get().n;

    expect(() => build(SPORT, { crashBeforeStamp: true })).toThrow(/simulated crash/);

    // Neither half landed: still stale, same generation, same rows.
    expect(materialisationState(SPORT).state).toBe(STALE);
    expect(buildRecordFor(SPORT).generation).toBe(genBefore);
    expect(db.prepare('SELECT COUNT(*) n FROM recruiting_arrivals').get().n).toBe(rowsBefore);
  });

  it('the stamp is taken from the input the build actually read', () => {
    // Computed before the write, so a roster change landing mid-build cannot be
    // certified by a digest taken afterwards.
    build();
    expect(buildRecordFor(SPORT).input_digest).toBe(effectiveInputDigest(SPORT));
  });
});

describe('L7ZL — the write boundary now asks a real question', () => {
  it('refuses an exclusion while the materialisation is LEGACY_UNVERIFIED', () => {
    expect(materialisationState(SPORT).state).toBe(LEGACY_UNVERIFIED);
    expect(exclusionBlockedReason(SPORT)).toMatch(/LEGACY_UNVERIFIED/);
    db.prepare(TRUST).run(trustRow());
    const r = recordDisposition({
      season: Y1, college_name: 'Alpha College', sport: SPORT,
      disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE, evidence: 'confirmed',
      expectedDisposition: null, operatorId: 'op-1',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/LEGACY_UNVERIFIED/);
  });

  it('PERMITS an authenticated exclusion once the sport is FRESH', () => {
    /*
     * The L7ZK finding inverted. Exclusion had two blockers: authentication and
     * this. With a verified materialisation the second is closed, so an
     * authenticated operator could now decide — and authentication is the only
     * remaining one.
     */
    build();
    expect(exclusionBlockedReason(SPORT)).toBeNull();
    db.prepare(TRUST).run(trustRow());
    const r = recordDisposition({
      season: Y1, college_name: 'Alpha College', sport: SPORT,
      disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE,
      evidence: 'confirmed wrong season; removed pending repair',
      expectedDisposition: null, operatorId: 'op-1',
    });
    expect(r.ok).toBe(true);
    expect(r.record.disposition).toBe(DISPOSITION.EXCLUDE_FROM_EVIDENCE);
    // And the materialisation immediately reports the consequence.
    expect(materialisationState(SPORT).state).toBe(STALE);
    expect(() => loadProgrammePatterns(SPORT, 'Alpha College')).toThrow(StaleMaterialisationError);
  });

  it('still refuses an unauthenticated exclusion on a FRESH sport', () => {
    // Freshness removes one blocker, never the other.
    build();
    db.prepare(TRUST).run(trustRow());
    const r = recordDisposition({
      season: Y1, college_name: 'Alpha College', sport: SPORT,
      disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE, evidence: 'x',
      expectedDisposition: null, operatorId: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/requires an authenticated operator/);
  });

  it('a RETAIN is unaffected by materialisation state', () => {
    expect(materialisationState(SPORT).state).toBe(LEGACY_UNVERIFIED);
    db.prepare(TRUST).run(trustRow());
    const r = recordDisposition({
      season: Y1, college_name: 'Alpha College', sport: SPORT,
      disposition: DISPOSITION.RETAIN, evidence: 'kept on the record',
      expectedDisposition: null, operatorId: 'op-1',
    });
    expect(r.ok).toBe(true);
    expect(materialisationState(SPORT).state).toBe(LEGACY_UNVERIFIED);
  });
});
