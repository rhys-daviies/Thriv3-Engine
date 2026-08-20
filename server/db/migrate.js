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
];

/**
 * The edge collector's own row id for an event. Pulling twice must not
 * duplicate, and matching on it is exact where matching on a timestamp would
 * not be.
 */
const TRACKING_EVENT_COLUMNS = [
  ['remote_id', 'INTEGER'],
];

function addMissingColumns(db, table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, ddl] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
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

export function migrate(db) {
  addMissingColumns(db, 'players', PLAYER_COLUMNS);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_public_slug ON players(public_slug)');
  backfillVideoIds(db);
  backfillSlugs(db);

  addMissingColumns(db, 'tracking_events', TRACKING_EVENT_COLUMNS);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_remote_id ON tracking_events(remote_id)');
}
