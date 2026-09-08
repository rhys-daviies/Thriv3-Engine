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

  /**
   * The athlete's saved template, set aside rather than deleted.
   *
   * Clearing `email_template` is how an athlete is moved onto the structured
   * composer — `canComposeStructured` returns false for anything customised —
   * and a clear that destroys the original is not a decision anybody can walk
   * back. The archive is a column rather than a file so that the old template
   * travels with the row it belongs to, and restoring is one UPDATE.
   *
   * Nothing reads this but `server/scripts/archiveEmailTemplate.js`. It is not
   * a fallback: an archived template is not used to send anything.
   */
  ['email_template_archived', 'TEXT'],
  ['email_template_archived_at', 'TEXT'],

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
  ['postseason_2025_round', 'TEXT'],
  ['notable_majors', "TEXT DEFAULT '[]'"],
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
  // Where this player was the season before, if we can identify them
  // unambiguously. Explains an absent figure instead of leaving a bare dash:
  // a transfer's prior minutes are deliberately NOT carried forward (they
  // predict a starting place at the new programme only 54.9% of the time,
  // against 77.4% for a player who stayed) but knowing they arrived from
  // somewhere is worth more to an operator than knowing nothing.
  ['prior_programme', 'TEXT'],
];

/**
 * Added after `outreach_evidence` was already in the field. schema.sql creates
 * the table but cannot add a column to an existing one.
 */
const OUTREACH_EVIDENCE_COLUMNS = [
  ['evidence_rendered', 'INTEGER'],
  ['primary_confidence', 'TEXT'],
  ['secondary_confidence', 'TEXT'],
  ['template_variant', 'TEXT'],
  ['rendered_paragraph', 'TEXT'],
  ['operator_selected', 'INTEGER NOT NULL DEFAULT 0'],
  ['roster_freshness', 'TEXT'],
  ['roster_age_days', 'INTEGER'],
  // The multi-evidence columns. Added 2026-08-28 with the structure library;
  // rows written before it carry NULL, which reads correctly — they had no
  // ordered set beyond primary/secondary and no structure that changed a word.
  ['structure_source', 'TEXT'],
  ['selected_kinds', 'TEXT'],
  ['rendered_count', 'INTEGER'],
  ['body_source', 'TEXT'],
];

/**
 * `drafted_at` — the event `sent_at` used to stand in for.
 *
 * See the schema comment on `outreach`. Added 2026-08-28 with the send
 * confirmation workflow.
 */
const OUTREACH_COLUMNS = [
  ['drafted_at', 'TEXT'],
  /**
   * WHICH PROGRAMME CAMPAIGN FIRST CREATED THIS RELATIONSHIP. Provenance only.
   *
   * `outreach` is one row per athlete-coach pair FOR ALL TIME — the token a
   * coach may click two years from now lives on it. A campaign is finite, so a
   * second campaign next season reaches the same coach through the SAME row.
   * This column therefore answers "under which campaign did we first open this
   * relationship", and nothing else. It is written once, at creation, and never
   * rewritten; a relationship first opened under Campaign 1 stays that way
   * however many campaigns later use it.
   *
   * IT IS NOT THE CAMPAIGN A GIVEN MESSAGE BELONGS TO. That is
   * `outreach_send.programme_campaign_id`, which is per-message and
   * authoritative. Reading this one to attribute a send would credit Campaign 1
   * with Campaign 2's work.
   *
   * NULL for every row that predates campaigns, and it stays NULL: nothing
   * infers a campaign for a relationship opened before campaigns existed.
   *
   * ON DELETE SET NULL, never CASCADE. Deleting a campaign must not delete the
   * relationship or the token in a coach's inbox — the provenance goes, the
   * relationship stays.
   */
  ['programme_campaign_id', 'TEXT REFERENCES programme_campaigns(id) ON DELETE SET NULL'],
];

/**
 * WHICH PROGRAMME CAMPAIGN THIS MESSAGE WAS SENT UNDER. Authoritative.
 *
 * One row per message, so this is the only place campaign attribution can be
 * correct: the relationship is reused across campaigns and the message is not.
 * Written explicitly by whoever composes the message; never inferred from
 * `outreach.programme_campaign_id`, which may name an earlier campaign.
 *
 * NULL for a manual or legacy send, which is the honest record of a message
 * nobody sent under a campaign. The 41 historical sends keep it.
 *
 * ON DELETE SET NULL: send history is evidence and outlives the campaign that
 * produced it.
 */
const OUTREACH_SEND_COLUMNS = [
  ['programme_campaign_id', 'TEXT REFERENCES programme_campaigns(id) ON DELETE SET NULL'],

  /**
   * WHAT WE DID WITH THIS MESSAGE — the authoritative execution state.
   *
   * See shared/outreachMessageState.js for the vocabulary and the legal graph.
   * It records only actions this system took or was told were taken, and never
   * means delivered, inboxed, opened, replied or bounced. Those are learned
   * afterwards from outside and live in `outreach_send_event`.
   *
   * `sent_at` and `drafted_at` stay exactly as they are, as compatibility
   * timestamps — every denominator in the system reads them and a rename would
   * be a large change to prove nothing. After this, `state` is the authority
   * and `sent_at` is the date of the acceptance it records.
   *
   * No DEFAULT: a row that reached the database without a state is a bug worth
   * failing on rather than one quietly called a draft. `recordDraft` sets it.
   */
  ['state', 'TEXT'],

  /**
   * HOW WE CAME TO BELIEVE IT WAS ACCEPTED, and the reason this is a column
   * rather than an inference.
   *
   * An operator's recollection, an AppleScript command that did not error, and
   * a provider API's own acceptance are three different strengths of evidence.
   * They are indistinguishable in `sent_at`, which is why the 41 historical
   * rows cannot be told apart from a future Gmail send without it.
   *
   * NULL until a message is ACCEPTED.
   */
  ['accepted_source', 'TEXT'],
];

/**
 * Every message gets the state it truthfully had, and not one it did not.
 *
 * THE 41 HISTORICAL ROWS WERE NOT OBSERVED BY ANY PROVIDER. They were either
 * confirmed by a person through `npm run confirm-sends` or produced by a send
 * path that recorded no provenance at all, and both are OPERATOR_ASSERTED —
 * the weakest of the three sources, which is the honest reading. Calling them
 * PROVIDER_ACCEPTED would invent an API call that never happened.
 *
 * NO SYNTHETIC EVENTS. `outreach_send_event` records observations, and there
 * were none: nobody watched these messages leave. Writing 41 ACCEPTED events
 * dated at the confirmation would manufacture a history of observations that
 * do not exist, so the acceptance lives on the row as state plus source and
 * the event table stays empty.
 *
 * Idempotent by construction: only rows with no state are touched, so a second
 * boot changes nothing and a row whose state has since moved is never reset.
 */
function backfillSendState(db) {
  db.prepare(`
    UPDATE outreach_send SET state = 'ACCEPTED', accepted_source = 'OPERATOR_ASSERTED'
    WHERE state IS NULL AND sent_at IS NOT NULL
  `).run();
  db.prepare(`
    UPDATE outreach_send SET state = 'DRAFT'
    WHERE state IS NULL AND sent_at IS NULL
  `).run();
}

const COACH_COLUMNS = [
  ['email_status', "TEXT DEFAULT 'unknown'"],   // verified | inferred | generic | unknown
  ['email_source_url', 'TEXT'],
  ['email_confirmed_at', 'TEXT'],
  ['source', 'TEXT'],                            // which import produced the row
];

/**
 * `reconciled_from` — which duplicate spellings a stored arrival absorbed.
 *
 * Added with the same-season identity cleanup. `recruiting_arrivals` is derived
 * and disposable, so this only matters for a database that already holds a
 * build; the next `npm run build:recruiting` fills it.
 */
const RECRUITING_ARRIVAL_COLUMNS = [
  ['reconciled_from', 'TEXT'],
];

/**
 * Retires `programme_seasons.historical_division`, which 12B.1 added and 12D
 * moved (Phase 12D / O).
 *
 * It was always null. It is owned by `programme_conference_seasons` now, and
 * the reason it could not stay is mechanical rather than aesthetic:
 * `importProgrammeSeasons.js` rebuilds its table with `DELETE FROM
 * programme_seasons` and a full re-insert, so a column that importer does not
 * write is emptied by every routine records refresh. The benchmark would have
 * stopped producing percentiles with nothing raised anywhere.
 *
 * The index has to go first — SQLite refuses to drop an indexed column — and
 * is recreated on the narrower key. Any value in the column is discarded, and
 * on every database that has one that value is null.
 */
/**
 * Phase 12E added membership provenance and a record status to
 * `programme_conference_seasons`. Both have defaults that describe every row
 * 12D wrote — every one of them came from a conference's own standings table
 * and carried a record — so an existing table upgrades without a rebuild.
 */
/**
 * Phase 12E.1 added a conference scope to `institution_aliases`. Every row 12E
 * wrote is global, which is what the default says, so an existing table upgrades
 * without a rebuild — but the primary key changes with it, so the table is
 * rebuilt where the old single-column key is still in place.
 */
function scopeInstitutionAliases(db) {
  if (!db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'institution_aliases'").get().n) return;
  const cols = db.prepare('PRAGMA table_info(institution_aliases)').all();
  if (cols.some((c) => c.name === 'conference_scope')) return;
  const names = cols.map((c) => c.name).join(', ');
  db.exec(`
    ALTER TABLE institution_aliases RENAME TO institution_aliases_pre_12e1;
    CREATE TABLE institution_aliases (
      alias_key TEXT NOT NULL, alias_raw TEXT NOT NULL, unitid INTEGER NOT NULL,
      conference_scope TEXT NOT NULL DEFAULT '*',
      alias_type TEXT NOT NULL, source TEXT NOT NULL, confidence TEXT NOT NULL,
      notes TEXT, imported_at TEXT NOT NULL,
      PRIMARY KEY (alias_key, conference_scope)
    );
    INSERT INTO institution_aliases (${names}) SELECT ${names} FROM institution_aliases_pre_12e1;
    DROP TABLE institution_aliases_pre_12e1;
    CREATE INDEX IF NOT EXISTS idx_institution_aliases_unitid ON institution_aliases(unitid);
    CREATE INDEX IF NOT EXISTS idx_institution_aliases_scope ON institution_aliases(conference_scope);
  `);
}

const PCS_COLUMNS = [
  ['membership_provenance', "TEXT NOT NULL DEFAULT 'OFFICIAL_CONFERENCE_STANDINGS'"],
  ['record_status', "TEXT NOT NULL DEFAULT 'RECORD_KNOWN'"],
];

function retireProgrammeSeasonDivision(db) {
  const cols = db.prepare('PRAGMA table_info(programme_seasons)').all().map((c) => c.name);
  if (!cols.includes('historical_division')) return;
  db.exec('DROP INDEX IF EXISTS idx_programme_seasons_pool');
  db.exec('ALTER TABLE programme_seasons DROP COLUMN historical_division');
  db.exec('CREATE INDEX IF NOT EXISTS idx_programme_seasons_pool ON programme_seasons(sport, season)');
}

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
/**
 * Dates the draft for rows that predate the column.
 *
 * Every outreach row in existence when this shipped had been composed
 * successfully: `sendOutreach` creates the row, hands the message to Outlook,
 * and only then stamps a timestamp — so a row that reached a timestamp was
 * drafted, and the 49 whose `sent_at` was cleared as never-sent were drafted
 * at the second they were created.
 *
 * Bounded by date rather than left open. Without the bound, a row written by
 * the CURRENT code whose compose failed would have a null `drafted_at` and
 * would be "backfilled" on the next startup into claiming a draft that never
 * opened — quietly reintroducing the exact overstatement this column exists to
 * remove.
 */
const DRAFTED_AT_BACKFILL_BEFORE = '2026-08-29';

function backfillDraftedAt(db) {
  db.prepare(`
    UPDATE outreach SET drafted_at = COALESCE(sent_at, created_at)
    WHERE drafted_at IS NULL AND created_at < ?
  `).run(DRAFTED_AT_BACKFILL_BEFORE);
}

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

/**
 * Every LIVE athlete gets a stable random slug; it is never re-rolled once set.
 *
 * ARCHIVED ROWS ARE SKIPPED — 13I / §31. An archived athlete has no public
 * profile: `publicProfileHandler` returns the same neutral response for an
 * archived row as for an unknown slug, and `publish` refuses one outright. So
 * a slug on an archived row is a handle that resolves to nothing, and giving
 * one to every row regardless meant the seeded women's-soccer QA fixture
 * acquired a public handle on the next migration after it was created. A row
 * that is later un-archived is picked up by the next run, which is when it
 * first needs one.
 */
function backfillSlugs(db) {
  const rows = db.prepare(
    'SELECT id FROM players WHERE public_slug IS NULL AND archived_at IS NULL').all();
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

/**
 * One send event for every email already confirmed sent.
 *
 * CONSERVATIVE, AND IT INVENTS NOTHING.
 *
 * Every historical row is stamped LEGACY_UNKNOWN. Fourteen of them carry an
 * `outreach_evidence` snapshot and thirteen carry none, and both are recorded
 * as what they are — a null snapshot is the honest record of an email we did
 * not instrument, and filling it in from today's engine would fabricate a
 * decision that was never made.
 *
 * The evidence that IS present is copied narrowly: structure, body source,
 * variant and the stored sentences. `primary_kind` is deliberately NOT copied
 * into the analytics columns — those rows name kinds that are no longer
 * licensed and one names a RECOGNITION kind as primary, a state the current
 * model cannot represent. It stays readable in the legacy table and in
 * `payload.legacy`, and it is not laundered into a column an analysis would
 * read as current vocabulary.
 *
 * Idempotent: keyed on (outreach_id, sequence), and every historical send is
 * sequence 1 because nothing has ever sent a follow-up.
 */
function backfillSendEvents(db) {
  const rows = db.prepare(`
    SELECT o.id, o.athlete_id, o.coach_id, o.sent_at, o.drafted_at, o.created_at,
           e.college_name, e.sport, e.structure, e.structure_source, e.body_source,
           e.template_variant, e.rendered_paragraph, e.payload
    FROM outreach o
    LEFT JOIN outreach_evidence e ON e.outreach_id = o.id
    WHERE o.sent_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM outreach_send s WHERE s.outreach_id = o.id)
  `).all();
  if (!rows.length) return 0;

  const insert = db.prepare(`
    INSERT INTO outreach_send (
      id, outreach_id, sequence, drafted_at, sent_at,
      athlete_id, coach_id, college_name, sport, policy_version,
      structure, structure_source, body_source, template_variant,
      has_personalisation, primary_kind, primary_role, hook_kind,
      rendered_kinds, rendered_roles, rendered_count,
      subject, body_hash, payload, created_at
    ) VALUES (
      @id, @outreach_id, 1, @drafted_at, @sent_at,
      @athlete_id, @coach_id, @college_name, @sport, 'LEGACY_UNKNOWN',
      @structure, @structure_source, @body_source, @template_variant,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL,
      NULL, NULL, @payload, @created_at
    )
  `);

  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      let legacy = null;
      if (r.payload) {
        try {
          const p = JSON.parse(r.payload);
          /**
           * Only what the current vocabulary can hold: the sentences as sent,
           * and the paragraph. `ranked`, `suppressed`, `belowThreshold` and
           * `rejected` are the legacy selector's fields, deleted at H7, and
           * they are NOT copied — the new model speaks one language. They stay
           * untouched in `outreach_evidence` for anyone auditing back.
           */
          legacy = {
            rendered: (p.sentences ?? []).map((x) => ({
              order: x.order, slot: x.slot, role: null, kind: x.kind, text: x.text,
            })),
            paragraph: r.rendered_paragraph ?? null,
            note: 'Pre-P2 send. Kinds and roles are in a retired vocabulary and are '
              + 'not promoted to the analytics columns. See outreach_evidence for the '
              + 'full historical record.',
          };
        } catch { legacy = null; }
      }
      insert.run({
        id: `legacy-${r.id}`,
        outreach_id: r.id,
        drafted_at: r.drafted_at,
        sent_at: r.sent_at,
        athlete_id: r.athlete_id,
        coach_id: r.coach_id,
        college_name: r.college_name,
        sport: r.sport,
        structure: r.structure,
        structure_source: r.structure_source,
        body_source: r.body_source,
        template_variant: r.template_variant,
        payload: legacy ? JSON.stringify({ legacy }) : null,
        created_at: r.created_at,
      });
      n += 1;
    }
  })();
  return n;
}

/**
 * Delivery history — Phase 13J. `generated_reports` is created by schema.sql,
 * which uses CREATE TABLE IF NOT EXISTS and therefore cannot add a column to a
 * table that already exists in the field. `content_sha256` was added after the
 * first databases had the table, so it is owned here like every other added
 * column.
 *
 * `generated_by` / `generated_by_email` follow in Phase 13K, once there is an
 * authenticated operator to attribute a generation to. They answer "who
 * generated the document we sent", which nothing else could answer.
 *
 * REVERSIBLE. All three are nullable with no default, so dropping them restores
 * the previous shape exactly and nothing reads them as required:
 *
 *   ALTER TABLE generated_reports DROP COLUMN content_sha256;
 *   ALTER TABLE generated_reports DROP COLUMN generated_by;
 *   ALTER TABLE generated_reports DROP COLUMN generated_by_email;
 *
 * Rows written before a column existed simply carry null. The operator screen
 * renders a null fingerprint as no fingerprint and a null operator as no
 * attribution, rather than as an error: a report generated before there were
 * accounts was still generated, and its artefact is still valid.
 *
 * The email is denormalised beside the id for the same reason `athlete_name`
 * and `college_name` are — history has to read correctly years later, including
 * after an account is deleted, and an id alone would then attribute a sent
 * document to nobody.
 */
const GENERATED_REPORT_COLUMNS = [
  ['content_sha256', 'TEXT'],
  ['generated_by', 'TEXT'],
  ['generated_by_email', 'TEXT'],
];

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
  addMissingColumns(db, 'outreach', OUTREACH_COLUMNS);
  backfillDraftedAt(db);
  db.exec('CREATE INDEX IF NOT EXISTS idx_outreach_drafted ON outreach(drafted_at)');
  // Campaign attribution. Both columns are added here rather than in
  // schema.sql because both tables already exist in the field, and both
  // indexes are created after the column they cover — schema.sql runs first
  // and cannot index a column this function is about to add.
  addMissingColumns(db, 'outreach_send', OUTREACH_SEND_COLUMNS);
  db.exec('CREATE INDEX IF NOT EXISTS idx_outreach_programme_campaign ON outreach(programme_campaign_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_outreach_send_programme_campaign ON outreach_send(programme_campaign_id)');
  backfillSendState(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_outreach_send_state ON outreach_send(state)");
  /**
   * ONE OPEN MESSAGE PER RELATIONSHIP, enforced rather than remembered.
   *
   * `recordDraft` has always replaced the pending row instead of adding a
   * second, and until now that was a convention one writer maintained. The
   * index covers every open state together, so it is not possible to hold a
   * DRAFT and a QUEUED for the same relationship once a scheduler exists —
   * which is the version of this rule that would otherwise be discovered too
   * late.
   *
   * It is scoped to the RELATIONSHIP because that is the unit the current
   * architecture has. When contact attempts exist, "one open message per
   * attempt" may be the better scope; that is a later decision and this index
   * does not prejudge it.
   *
   * Created after the backfill, never before: every row has NULL state until
   * then, and NULL is not in the predicate.
   */
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_send_one_open
             ON outreach_send(outreach_id)
             WHERE state IN ('DRAFT', 'QUEUED', 'SENDING')`);
  addMissingColumns(db, 'outreach_evidence', OUTREACH_EVIDENCE_COLUMNS);
  // After the column exists, never before: schema.sql runs first and cannot
  // index a column this function is about to add.
  db.exec('CREATE INDEX IF NOT EXISTS idx_outreach_evidence_selected ON outreach_evidence(selected_kinds)');
  backfillSendEvents(db);
  addMissingColumns(db, 'recruiting_arrivals', RECRUITING_ARRIVAL_COLUMNS);
  retireProgrammeSeasonDivision(db);
  scopeInstitutionAliases(db);
  if (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'programme_conference_seasons'").get().n) {
    addMissingColumns(db, 'programme_conference_seasons', PCS_COLUMNS);
  }
  backfillRecruitingClassYear(db);
  backfillAcademicRatingSource(db);

  // Guarded the same way `programme_conference_seasons` is: the table arrives
  // with schema.sql, and on a database from before it existed there is nothing
  // to alter yet.
  if (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'generated_reports'").get().n) {
    addMissingColumns(db, 'generated_reports', GENERATED_REPORT_COLUMNS);
  }
}
