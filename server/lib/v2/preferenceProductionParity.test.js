/**
 * A7.12.1 — can a PERSISTED athlete reproduce a HARNESS fixture exactly?
 *
 * THE POINT OF THE WHOLE PHASE. A7.12 found the validation harness could
 * build athlete shapes production could not: the three preference fields
 * existed in the scorer and in no database column. A validation pack
 * generated from a shape nobody can persist is not a validation of the thing
 * that ships.
 *
 * So these run the same athlete twice over the same universe - once as the
 * literal every earlier phase used, and once as a row written through
 * `sanitizePlayerData -> Player.create -> SQLite` and read back out with
 * `Player.get` - and require the two to agree to the last decimal on R, F,
 * O, P and rank.
 *
 * They write throwaway rows and delete them. Nothing else in the database is
 * touched and no scorer constant is read except through the real path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { canonicalPosition } from '../../../shared/positions.js';
import { normaliseAthlete } from '../../../shared/matching/pool.js';
import { buildPoolContext } from './poolContext.js';
import { runPursuit } from './pursuitRun.js';
import { buildValidationAthlete, PROFILES } from '../../../shared/matching/v2/index.js';
import { sanitizePlayerData } from '../../../src/lib/playerPayload.js';
import { preferencePayload } from '../../../src/lib/preferenceIntake.js';
import { FIXTURES } from '../../scripts/v2Fixtures.js';

const SEASON = '2026';
const PREFS = ['competitive_level_priority', 'playing_opportunity_priority', 'academic_strength_priority'];
const created = [];
const CTX = new Map();

/**
 * A SYNTHETIC POOL, because vitest gives every file a `:memory:` database on
 * purpose - a suite must never be able to read or write the working one.
 *
 * So the universe here is 36 programmes rather than 1,166. That is enough for
 * what these tests actually assert, which is that two CONSTRUCTION PATHS
 * agree: the same athlete, once as a literal and once as a row read back out
 * of SQLite, over whatever universe is in front of them. The full-universe
 * run lives in server/scripts/v2PreferenceParity.js and is reported per
 * phase; this is the part that belongs in CI.
 *
 * The programmes are spread across divisions and strengths so that the
 * preference components have something to discriminate between - a pool of
 * identical programmes would let a broken preference look like a working one.
 */
const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA'];
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];

function seedPool(sport) {
  const now = new Date().toISOString();
  const college = db.prepare(`INSERT INTO colleges
    (id, created_date, updated_date, name, sport, division, conference, active,
     soccer_score, academic_rating, academic_rating_source, net_price, control,
     tuition_in_state, tuition_out_state, state, latitude, longitude,
     notable_majors, recent_win_pct, prior_win_pct)
    VALUES (?,?,?,?,?,?,?,1,?,?,'MEASURED',?,?,?,?,?,?,?,?,?,?)`);
  const roster = db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, conference,
     player_name, class_year_label, position, minutes_played, games_played, games_started,
     estimated_graduation_year, eligibility_end_year, projected_minutes, hometown, country)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const arrival = db.prepare(`INSERT INTO recruiting_arrivals
    (programme, sport, arrival_season, prior_season, source_transition, roster_row_id,
     player_name, name_key, arrival_confidence, identity_method,
     canonical_position, is_international, entry_type,
     prior_confidence, coach_attribution, built_at)
    VALUES (?,?,?,?,?,?,?,?,'DIRECT','EXACT',?,?,'FRESHMAN','DIRECT','UNKNOWN',?)`);

  for (let i = 0; i < 36; i += 1) {
    const division = DIVISIONS[i % DIVISIONS.length];
    const name = `Seed ${sport === 'womens-soccer' ? 'W' : 'M'}${i}`;
    // Strength spread across the whole scale, so plausibility discriminates.
    const strength = 25 + (i * 2.1);
    college.run(`c-${sport}-${i}`, now, now, name, sport, division, `Conf ${i % 5}`,
      strength, 3 + ((i % 7)), 18000 + (i * 900), i % 2 === 0 ? 1 : 2,
      12000 + (i * 300), 28000 + (i * 700), ['CA', 'MA', 'TX', 'OH', 'NC'][i % 5],
      34 + (i % 10), -100 + (i % 20), JSON.stringify(['Business', 'Kinesiology']),
      0.4 + ((i % 5) / 20), 0.35 + ((i % 4) / 20));

    // Twelve players: three per position, staggered so some leave before 2028.
    for (let j = 0; j < 12; j += 1) {
      const position = POSITIONS[j % POSITIONS.length];
      const endYear = 2026 + ((i + j) % 4);
      const rowId = `r-${sport}-${i}-${j}`;
      roster.run(rowId, now, now, name, sport, division, SEASON, `Conf ${i % 5}`,
        `Player ${i}-${j}`, ['Fr.', 'So.', 'Jr.', 'Sr.'][(i + j) % 4], position,
        j < 6 ? 1200 : 200, 18, j < 6 ? 15 : 2,
        endYear, endYear, j < 6 ? 1200 : 200,
        `Town ${i % 5}, ${['CA', 'MA', 'TX', 'OH', 'NC'][i % 5]}`, 'USA');
      if (j < 3) {
        arrival.run(name, sport, String(2024 + j), String(2023 + j), 'seeded', rowId,
          `Player ${i}-${j}`, `player ${i}-${j}`, position, 0, now);
      }
    }
  }
}

beforeAll(() => {
  seedPool('mens-soccer');
  seedPool('womens-soccer');
});

const contextFor = (sport) => {
  if (!CTX.has(sport)) CTX.set(sport, buildPoolContext({ db, sport, season: SEASON }));
  return CTX.get(sport);
};

const fixture = (key) => FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${key}-`));

/** Rank the whole universe and flatten what a comparison needs. */
function rank(athlete, sport) {
  const ctx = contextFor(sport);
  const rep = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
  return {
    counts: rep.counts,
    rows: new Map(rep.pipeline.ranked.map((e) => [e.id, {
      name: e.name, rank: e.rank,
      R: e.recruitability.value, F: e.financial.value,
      O: e.opportunity.value, P: e.pursuitPriority.value,
    }])),
  };
}

/** The harness athlete: a literal, exactly as every earlier phase built it. */
function harness(key, profileId) {
  const f = fixture(key);
  const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete } = buildValidationAthlete({
    record: f.player, v1Shape, position: canonicalPosition(f.player.position),
    label: f.id, profile: PROFILES[profileId],
  });
  return { athlete, sport: f.player.sport };
}

/**
 * The same athlete through the real product boundary.
 *
 * Nothing is carried in memory: the row is read BACK out of the database, so
 * a column that does not persist, or a sanitiser that drops a null, fails
 * here rather than looking like a small scoring difference.
 */
function persisted(key, profileId) {
  const f = fixture(key);
  const p = PROFILES[profileId];
  const payload = sanitizePlayerData({
    ...f.player,
    full_name: `A7.12.1 parity ${key} ${profileId}`,
    preferred_divisions: [], preferred_conferences: [],
    ...preferencePayload({
      competitive_level_priority: p.competitiveLevelPriority,
      playing_opportunity_priority: p.playingOpportunityPriority,
      academic_strength_priority: p.academicStrengthPriority,
    }),
  });
  const row = Player.create(payload);
  created.push(row.id);
  const stored = Player.get(row.id);
  const { athlete } = buildValidationAthlete({
    record: stored,
    v1Shape: normaliseAthlete(stored),
    position: canonicalPosition(stored.position),
    label: stored.full_name,
  });
  return { stored, athlete, sport: stored.sport };
}

/** Every shared programme, on every scored quantity. */
function expectIdentical(a, b) {
  /**
   * A REAL UNIVERSE, asserted first.
   *
   * Every check below compares two lists, and two empty lists are identical.
   * Without this line a database with no colleges in it - a fresh :memory:
   * one, say - would report the whole phase as proven.
   */
  expect(a.counts.ranked).toBeGreaterThan(20);
  expect(a.rows.size).toBe(a.counts.ranked);
  expect(b.counts.ranked).toBe(a.counts.ranked);
  expect(b.counts.limitedData).toBe(a.counts.limitedData);
  expect([...b.rows.keys()].filter((id) => !a.rows.has(id))).toEqual([]);
  expect([...a.rows.keys()].filter((id) => !b.rows.has(id))).toEqual([]);
  const differing = [];
  for (const [id, x] of a.rows) {
    const y = b.rows.get(id);
    for (const field of ['R', 'F', 'O', 'P']) {
      if (Math.abs(x[field] - y[field]) > 1e-12) {
        differing.push(`${x.name} ${field} ${x[field]} vs ${y[field]}`);
      }
    }
    if (x.rank !== y.rank) differing.push(`${x.name} rank ${x.rank} vs ${y.rank}`);
  }
  expect(differing.slice(0, 5)).toEqual([]);
}

afterAll(() => {
  for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id);
  expect(db.prepare("SELECT COUNT(*) n FROM players WHERE full_name LIKE 'A7.12.1 parity%'").get().n).toBe(0);
});

/**
 * PARITY IS ONLY EVIDENCE IF THE FIELDS DO SOMETHING.
 *
 * Every test below compares a declared athlete against the same declared
 * athlete. If the three columns were silently ignored - dropped by the
 * sanitiser, absent from the entity, unread by the builder - both sides
 * would be the undeclared athlete and every comparison would pass. This is
 * the test that fails in that world.
 */
describe('the preferences are load-bearing on this pool', () => {
  it('ranks a declared athlete differently from an undeclared one', () => {
    const undeclared = persisted('A', 'UNDECLARED');
    const declared = persisted('A', 'FULLY_DECLARED_LEVEL');
    const u = rank(undeclared.athlete, undeclared.sport);
    const d = rank(declared.athlete, declared.sport);
    expect(u.counts.ranked).toBeGreaterThan(20);

    const movedRank = [...u.rows.keys()].filter((id) => u.rows.get(id).rank !== d.rows.get(id).rank);
    const movedO = [...u.rows.keys()].filter((id) => Math.abs(u.rows.get(id).O - d.rows.get(id).O) > 1e-9);
    expect(movedO.length, 'no programme changed Opportunity').toBeGreaterThan(0);
    expect(movedRank.length, 'no programme changed rank').toBeGreaterThan(0);
  });

  it('leaves Recruitability and Financial untouched, whatever the athlete wants', () => {
    const undeclared = persisted('A', 'UNDECLARED');
    const declared = persisted('A', 'FULLY_DECLARED_LEVEL');
    const u = rank(undeclared.athlete, undeclared.sport);
    const d = rank(declared.athlete, declared.sport);
    for (const [id, x] of u.rows) {
      const y = d.rows.get(id);
      expect(Math.abs(x.R - y.R), `${x.name} R moved on a preference`).toBeLessThan(1e-12);
      expect(Math.abs(x.F - y.F), `${x.name} F moved on a preference`).toBeLessThan(1e-12);
    }
  });
});

describe('fixture A reaches production shape', () => {
  it('ranks identically as a literal and as a persisted row, fully declared', () => {
    const h = harness('A', 'FULLY_DECLARED_LEVEL');
    const p = persisted('A', 'FULLY_DECLARED_LEVEL');
    expect(p.stored.competitive_level_priority).toBe(5);
    expect(p.stored.playing_opportunity_priority).toBe(1);
    expect(p.stored.academic_strength_priority).toBe(3);
    expectIdentical(rank(h.athlete, h.sport), rank(p.athlete, p.sport));
  });

  it('ranks identically undeclared', () => {
    const h = harness('A', 'UNDECLARED');
    const p = persisted('A', 'UNDECLARED');
    for (const c of PREFS) expect(p.stored[c], c).toBeNull();
    expectIdentical(rank(h.athlete, h.sport), rank(p.athlete, p.sport));
  });
});

describe('fixture C reaches production shape', () => {
  it('ranks identically under the academic-first profile', () => {
    const h = harness('C', 'ACADEMIC_FIRST');
    const p = persisted('C', 'ACADEMIC_FIRST');
    expect(p.stored.academic_strength_priority).toBe(5);
    expectIdentical(rank(h.athlete, h.sport), rank(p.athlete, p.sport));
  });

  it('ranks identically under a playing-first profile', () => {
    const h = harness('C', 'FULLY_DECLARED_PLAYING');
    const p = persisted('C', 'FULLY_DECLARED_PLAYING');
    expect(p.stored.playing_opportunity_priority).toBe(5);
    expectIdentical(rank(h.athlete, h.sport), rank(p.athlete, p.sport));
  });
});

describe('the women\'s pool too', () => {
  it('ranks fixture H identically', () => {
    const h = harness('H', 'FULLY_DECLARED_LEVEL');
    const p = persisted('H', 'FULLY_DECLARED_LEVEL');
    expect(p.stored.sport).toBe('womens-soccer');
    expectIdentical(rank(h.athlete, h.sport), rank(p.athlete, p.sport));
  });
});

/**
 * THE REGRESSION THAT MATTERS MOST.
 *
 * Every existing athlete has NULL in all three columns. Adding the columns
 * must not have moved any of them by a single place.
 */
describe('NULL changes nothing, for every fixture A-H', () => {
  for (const f of FIXTURES) {
    const key = f.id[0];
    it(`${f.id} ranks identically with all three columns NULL`, () => {
      const h = harness(key, 'UNDECLARED');
      const p = persisted(key, 'UNDECLARED');
      for (const c of PREFS) expect(p.stored[c], `${f.id} ${c}`).toBeNull();
      expectIdentical(rank(h.athlete, h.sport), rank(p.athlete, p.sport));
    });
  }
});
