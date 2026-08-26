import { extractVideoId } from '../../shared/youtube.js';
import { generateSlug, generateUnique } from '../lib/tokens.js';

/**
 * Additive migrations for tables that already exist in the field.
 *
 * schema.sql uses CREATE TABLE IF NOT EXISTS, so it can introduce new tables
 * but never new columns on an existing database. This module owns every
 * column added to `players` after the initial build — it is the single source
 * of truth for them, deliberately not duplicated in schema.sql, so the two
 * cannot drift. Every step is idempotent and safe to run on each boot.
 */
const PLAYER_COLUMNS = [
  // --- public profile page ---
  ['video_id', 'TEXT'],                        // extracted from highlights_url
  ['video_chapters', "TEXT DEFAULT '[]'"],     // JSON [{"t":18,"label":"..."}]
  ['evaluation', 'TEXT'],
  ['public_slug', 'TEXT'],                     // random, stable across regenerations

  // --- universal athlete fields (sport-independent) ---
  ['height_cm', 'REAL'],
  ['weight_kg', 'REAL'],
  ['nationality', 'TEXT'],
  ['commitment_status', 'TEXT'],
  ['club_name', 'TEXT'],
  ['ncaa_eligibility_id', 'TEXT'],
  ['intended_major', 'TEXT'],
  ['guardian_name', 'TEXT'],
  ['guardian_email', 'TEXT'],
  ['club_coach_name', 'TEXT'],
  ['club_coach_email', 'TEXT'],
  ['time_zone', 'TEXT'],
  ['best_contact_window', 'TEXT'],

  // --- sport-varying metrics, described by server/lib/sportProfiles.js ---
  ['sport_attributes', "TEXT DEFAULT '{}'"],

  // --- lifecycle: drives the deactivation cascade in brief §7 ---
  ['archived_at', 'TEXT'],
  ['published_at', 'TEXT'],

  // --- recruiting class year rebuild ---
  // The year this recruit would join a roster as a freshman. Matched against
  // roster_players.estimated_graduation_year to find programs with an
  // opening at the recruit's position in that exact year.
  ['recruiting_class_year', 'INTEGER'],

  // --- Pillar 1 weighting model ---
  // Per-athlete overrides for the six matching criteria, as JSON on the same
  // arbitrary scale as DEFAULT_WEIGHTS ({"geography": 40, "roster": 0}).
  // Null means "use the defaults", which is not the same as an empty object:
  // an operator who has deliberately zeroed something must not be silently
  // reset by a later change to the defaults.
  ['match_weights', 'TEXT'],

  // The athlete's own ranking of the six criteria, best first, as a JSON
  // array of criterion keys (["geography","affordability",...]). Ranking is
  // how the deck says an athlete expresses priorities, so it is stored as a
  // ranking rather than pre-translated into numbers — the mapping to weights
  // is a tuning decision that will change, and a stored ranking survives it.
  ['criterion_ranking', 'TEXT'],

  // 'USA' or 'International'. Decides which half of the location criterion
  // applies: distance from a home state for a domestic athlete, and for an
  // overseas one whether the program recruits internationally at all. The
  // country itself lives in `nationality`, which already existed.
  ['origin', 'TEXT'],

  // A floor on colleges.academic_rating, or null for no floor. Distinct from
  // the retired importance slider, which was a *preference* the old model
  // silently reinterpreted as a threshold and used to delete two thirds of an
  // athlete's options. This is the athlete stating a constraint, it defaults
  // to none, and what it removes is counted and reported rather than
  // disappearing.
  ['academic_minimum', 'REAL'],
];

/**
 * The edge collector's own row id for an event. Pulling twice must not
 * duplicate, and matching on it is exact where matching on a timestamp would
 * not be.
 */
const TRACKING_EVENT_COLUMNS = [
  ['remote_id', 'INTEGER'],
];

/** Visual identity fields, backfilled by populateSchoolIdentity.js. */
const COLLEGE_COLUMNS = [
  // False for a program confirmed closed / not sponsoring this sport / not
  // eligible for its listed division. The row (and any coaching contacts on
  // it) still persists -- this only excludes it from recruiting matching.
  ['active', 'INTEGER DEFAULT 1'],
  ['nickname', 'TEXT'],
  ['nickname_plural', 'INTEGER'],
  ['mascot', 'TEXT'],
  ['primary_color', 'TEXT'],
  ['secondary_color', 'TEXT'],
  ['logo_url', 'TEXT'],
  ['identity_source', 'TEXT'],
  ['identity_notes', 'TEXT'],
  // Where academic_rating came from, because the number alone cannot say.
  // More than half of D2 and D3 carry their division's modal value — 5.4 and
  // 6.5 — which is a fill, not a measurement, and the matcher cannot tell the
  // difference: at a threshold of 5.5 the D2 field drops from 97% to 28% in
  // one step, entirely at that value. See backfillAcademicRatingSource.
  ['academic_rating_source', 'TEXT'],
  // --- matching model inputs (Phase 1.2) ---
  // Joined from College Scorecard on UNITID via the two academic crosswalks.
  // `location` was in the original schema and is empty on all 2,374 rows, so
  // geography could not be scored at all; city/state/lat/lon replace it.
  ['unitid', 'INTEGER'],
  ['city', 'TEXT'],
  ['state', 'TEXT'],
  ['latitude', 'REAL'],
  ['longitude', 'REAL'],
  ['control', 'INTEGER'],              // 1 public, 2 private non-profit, 3 private for-profit
  // Net price, not sticker tuition: what students actually paid after all
  // grant aid. Sticker price at a well-endowed private school is routinely
  // double what anyone pays, so scoring a family's budget against it would
  // rank by endowment rather than by affordability.
  ['net_price', 'REAL'],
  ['tuition_in_state', 'REAL'],
  ['tuition_out_state', 'REAL'],
  // Admissions, for the admissibility half of academic fit. Collected on the
  // athlete since the form was built and never compared against anything.
  ['sat_avg', 'INTEGER'],
  ['admit_rate', 'REAL'],
  // Programme trajectory from soccer_records.csv: win rate over the two most
  // recent seasons against the two before them. Separates "how good is this
  // programme" from "which way is it heading", which soccer_score alone cannot.
  ['recent_win_pct', 'REAL'],
  ['prior_win_pct', 'REAL'],
  ['matching_data_source', 'TEXT'],
  ['conference_champion_2025', 'INTEGER'],
  ['conference_champion_name', 'TEXT'],
  ['conference_champion_source', 'TEXT'],
  ['conference_champion_notes', 'TEXT'],
];

/**
 * Where a coach's address came from, and how much to trust it.
 *
 * The source CSVs carried this and the import dropped it, so every address
 * looked equally good. It is not: of 6,360 contacts, 5,001 were read off a
 * staff page, 1,188 were *inferred* from the institution's address pattern
 * and have never been seen anywhere, and 171 are shared inboxes. The inferred
 * fifth is what bounces, and a bounce on a cold campaign costs sender
 * reputation rather than just a lost email.
 *
 * `email_confirmed_at` stays null until something actually proves the address
 * — a send that does not bounce, or a reply. It is deliberately not the same
 * field as `email_status`: one records where we got it, the other whether it
 * has since been shown to work.
 */
// The year an athlete's eligibility runs out, which is one further than the
// academic graduation year for every class not already in its last year. Both
// are stored because they answer different questions -- see
// server/lib/classYear.js. Added rather than replacing estimated_graduation_year,
// so nothing that reads the academic year silently shifts by a year.
const ROSTER_PLAYER_COLUMNS = [
  ['eligibility_end_year', 'INTEGER'],
  // Minutes carried forward from an earlier season, for a season not yet
  // played. Deliberately NOT written into minutes_played: that column means
  // "minutes this player actually played this season", and a projection in it
  // would be indistinguishable from the real thing. The source season travels
  // with the value so every consumer can say where it came from.
  ['projected_minutes', 'INTEGER'],
  ['projected_minutes_season', 'TEXT'],
];

const COACH_COLUMNS = [
  ['email_status', "TEXT DEFAULT 'unknown'"],   // verified | inferred | generic | unknown
  ['email_source_url', 'TEXT'],
  ['email_confirmed_at', 'TEXT'],
  ['source', 'TEXT'],                            // which import produced the row
];

function addMissingColumns(db, table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, ddl] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

/**
 * Carries an old `graduation_year` across to `recruiting_class_year`.
 *
 * The two held the same fact and gated different things — publishing wanted
 * one, the form and matching the other — so an athlete could pass the form and
 * then fail to publish on a field nothing had asked for. They are one field
 * now, and this moves records created before it existed rather than leaving
 * them to rely on the fallback for ever.
 *
 * Only fills a blank. Where an athlete has both and they differ, the
 * recruiting class year is the deliberate one — a post-grad year is exactly
 * that case — so it is never overwritten.
 */
function backfillRecruitingClassYear(db) {
  db.prepare(`
    UPDATE players SET recruiting_class_year = graduation_year
    WHERE recruiting_class_year IS NULL AND graduation_year IS NOT NULL
  `).run();
}

/** Derives video_id for any athlete whose highlights_url we can parse. */
function backfillVideoIds(db) {
  const rows = db
    .prepare('SELECT id, highlights_url FROM players WHERE video_id IS NULL AND highlights_url IS NOT NULL')
    .all();
  const update = db.prepare('UPDATE players SET video_id = ? WHERE id = ?');
  for (const row of rows) {
    const id = extractVideoId(row.highlights_url);
    if (id) update.run(id, row.id);
  }
}

/** Every athlete gets a stable random slug; it is never re-rolled once set. */
function backfillSlugs(db) {
  const rows = db.prepare('SELECT id FROM players WHERE public_slug IS NULL').all();
  const taken = db.prepare('SELECT 1 FROM players WHERE public_slug = ?');
  const update = db.prepare('UPDATE players SET public_slug = ? WHERE id = ?');
  for (const row of rows) {
    const slug = generateUnique(generateSlug, (candidate) => !!taken.get(candidate));
    update.run(slug, row.id);
  }
}

/**
 * Labels each academic rating as measured or indistinguishable from a fill.
 *
 * The distinction cannot be recovered from the number, so it is inferred: a
 * rating exactly equal to its division's modal value is marked
 * `division-modal`, because that value is held by 55% of D2 and 58% of D3 and
 * is plainly a default rather than 111 schools independently scoring 5.4.
 *
 * The inference is deliberately not called "default" — some schools genuinely
 * do sit at the modal value, and there is no way here to tell them apart. It
 * marks the rating as unable to bear weight, which is the decision the matcher
 * actually needs to make.
 */
function backfillAcademicRatingSource(db) {
  // An explicit declaration beats any inference. placeBucketB.js creates rows
  // with academic_rating 6.0 and says so in identity_notes — 30 of them, every
  // one of which the modal-value inference below would call `rated`, because
  // 6.0 is nobody's divisional fill. A script that documents its own
  // placeholder should be believed over a statistical guess about it.
  db.prepare(`
    UPDATE colleges SET academic_rating_source = 'placeholder'
    WHERE academic_rating IS NOT NULL AND identity_notes LIKE '%academic_rating are placeholders%'
  `).run();

  const divisions = db.prepare(
    'SELECT DISTINCT division FROM colleges WHERE academic_rating IS NOT NULL'
  ).all().map((r) => r.division);

  for (const division of divisions) {
    const modal = db.prepare(`
      SELECT academic_rating AS value, COUNT(*) AS n FROM colleges
      WHERE division = ? AND academic_rating IS NOT NULL
      GROUP BY academic_rating ORDER BY n DESC LIMIT 1
    `).get(division);
    if (!modal) continue;

    // A modal value held by only a handful of schools is a coincidence, not a
    // fill. D1's is held by 8% and is left alone.
    const total = db.prepare(
      'SELECT COUNT(*) AS n FROM colleges WHERE division = ? AND academic_rating IS NOT NULL'
    ).get(division).n;
    const isFill = modal.n / total >= 0.25;

    db.prepare(`
      UPDATE colleges SET academic_rating_source = ?
      WHERE division = ? AND academic_rating IS NOT NULL AND academic_rating_source IS NULL
        AND academic_rating ${isFill ? '=' : '<>'} ?
    `).run(isFill ? 'division-modal' : 'rated', division, modal.value);

    db.prepare(`
      UPDATE colleges SET academic_rating_source = 'rated'
      WHERE division = ? AND academic_rating IS NOT NULL AND academic_rating_source IS NULL
    `).run(division);
  }
}

export function migrate(db) {
  addMissingColumns(db, 'players', PLAYER_COLUMNS);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_public_slug ON players(public_slug)');
  backfillVideoIds(db);
  backfillSlugs(db);

  addMissingColumns(db, 'tracking_events', TRACKING_EVENT_COLUMNS);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_remote_id ON tracking_events(remote_id)');

  addMissingColumns(db, 'roster_players', ROSTER_PLAYER_COLUMNS);
  addMissingColumns(db, 'colleges', COLLEGE_COLUMNS);
  addMissingColumns(db, 'coaches', COACH_COLUMNS);
  backfillRecruitingClassYear(db);
  backfillAcademicRatingSource(db);
}
