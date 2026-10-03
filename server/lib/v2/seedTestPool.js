import db from '../../db/client.js';

/** The roster season every V2 pool context is built for. */
export const SEASON = '2026';

/**
 * A synthetic pool for tests that need a real ranked universe.
 *
 * vitest gives every suite a `:memory:` database on purpose - a test must
 * never be able to read or write the working one - so any test that needs
 * programmes has to make them. Extracted at A7.13 so the parity suite and the
 * outreach-pack suite share one fixture: two copies of this SQL would drift,
 * and a ranking test whose pool differs from another ranking test's is a
 * comparison nobody can reason about.
 *
 * 36 programmes per sport, spread across divisions and the whole strength
 * scale, each with twelve players staggered so some leave before 2028. Enough
 * for plausibility, positional opportunity, market fit and trajectory all to
 * discriminate; small enough to seed in milliseconds.
 *
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
export const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA'];
export const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];

export function seedPool(sport, { count = 36, unscoreable = 0 } = {}) {
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

  for (let i = 0; i < count; i += 1) {
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

  /**
   * Programmes with a strength and a cost and NO ROSTER, which is what a real
   * LIMITED_DATA row is: Recruitability refuses on NO_ROSTER_ON_FILE and
   * Opportunity on NO_MINUTES_HISTORY, so the programme is eligible, partly
   * evaluated and carries no pursuit priority at all. A pool without any of
   * these cannot exercise the half of the review that tests whether a human
   * reads absence as absence.
   */
  for (let i = 0; i < unscoreable; i += 1) {
    const division = DIVISIONS[i % DIVISIONS.length];
    const name = `Seed ${sport === 'womens-soccer' ? 'W' : 'M'}-nodata${i}`;
    college.run(`c-${sport}-nodata-${i}`, now, now, name, sport, division, `Conf ${i % 5}`,
      30 + (i * 1.3), 4 + (i % 6), 21000 + (i * 700), i % 2 === 0 ? 1 : 2,
      13000 + (i * 250), 29000 + (i * 600), ['CA', 'MA', 'TX', 'OH', 'NC'][i % 5],
      35 + (i % 8), -98 + (i % 15), JSON.stringify(['Business']),
      0.45 + ((i % 4) / 20), 0.4 + ((i % 3) / 20));
  }
}

