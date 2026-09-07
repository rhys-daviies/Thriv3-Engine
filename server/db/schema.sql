CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by_id TEXT,

  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  graduation_year INTEGER,
  high_school TEXT,
  city TEXT,
  state TEXT,
  position TEXT NOT NULL,
  secondary_position TEXT DEFAULT 'None',
  preferred_divisions TEXT DEFAULT '[]',
  football_ability REAL,
  academic_importance TEXT,
  gpa REAL,
  sat_score INTEGER,
  act_score INTEGER,
  height_inches REAL,
  weight_lbs REAL,
  forty_yard_dash REAL,
  preferred_conferences TEXT DEFAULT '[]',
  budget_range TEXT,
  highlights_url TEXT,
  additional_notes TEXT,
  email_subject TEXT,
  email_template TEXT,
  recommendations TEXT,
  status TEXT DEFAULT 'New',
  sport TEXT DEFAULT 'mens-soccer'
);

CREATE TABLE IF NOT EXISTS colleges (
  id TEXT PRIMARY KEY,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by_id TEXT,

  name TEXT NOT NULL,
  location TEXT,
  division TEXT,
  conference TEXT,
  rating REAL,
  academic_rating REAL,
  soccer_score REAL,
  national_ranking INTEGER,
  website_domain TEXT,
  sport TEXT DEFAULT 'mens-soccer',

  -- False for a program confirmed closed, not sponsoring this sport, or not
  -- yet/no-longer eligible for its listed division (see the audit trail in
  -- Thriv3/Soccer Records/removed_inactive_2025.json). The row and any
  -- coaching contacts on it persist regardless -- this only flags it out of
  -- recruiting-eligible matching/scoring, it does not delete anything.
  active INTEGER DEFAULT 1,

  -- Visual identity, for individualising outreach emails (brief: "grow how
  -- much this database can individualise emails" -- starting with the
  -- athletic department's visual identity). Sourced from Wikipedia infobox
  -- data; see server/scripts/populateSchoolIdentity.js.
  nickname TEXT,
  nickname_plural INTEGER,
  mascot TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  logo_url TEXT,
  identity_source TEXT,
  identity_notes TEXT,

  -- 2025 conference champion, for outreach emails ("congratulations on
  -- winning the ACC last year"). conference_champion_name is stored
  -- independently of `conference` above because that field can be stale
  -- after realignment (e.g. Grand Canyon's 2025 automatic bid was via the
  -- WAC even though this row's `conference` still says Mountain West) --
  -- the champion sentence must stay correct even when that drifts.
  conference_champion_2025 INTEGER,
  conference_champion_name TEXT,
  conference_champion_source TEXT,
  conference_champion_notes TEXT,

  -- 2025 postseason round reached, for outreach emails ("made the Sweet 16
  -- this past season"). One of: appearance, r32, r16, quarter, semi, final,
  -- champion. Sourced from the {year}_ps column already collected in
  -- Thriv3/Soccer Records/soccer_records[_women].csv -- most programs never
  -- reach the postseason, so a low fill rate here is expected, not a gap.
  postseason_2025_round TEXT,

  -- JSON array of notable-major labels (see shared/academicMajors.js) this
  -- school meaningfully offers, so an email can say "we have a strong
  -- Business program" when it matches the recruit's own intended_major.
  -- Computed from College Scorecard's per-institution PCIP fields; see
  -- server/scripts/importNotableMajors.js.
  notable_majors TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_colleges_sport ON colleges(sport);
CREATE UNIQUE INDEX IF NOT EXISTS idx_colleges_name_sport ON colleges(name, sport);

CREATE TABLE IF NOT EXISTS graduating_seniors (
  id TEXT PRIMARY KEY,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by_id TEXT,

  college_name TEXT NOT NULL,
  season TEXT NOT NULL,
  official_roster_url TEXT,
  confirmed_division TEXT,
  total_graduating_seniors INTEGER,
  all_graduating_senior_names TEXT DEFAULT '[]',
  players TEXT DEFAULT '[]',
  position_data TEXT DEFAULT '[]',
  coaching_staff TEXT DEFAULT '[]',
  data_confidence TEXT DEFAULT 'medium',
  notes TEXT,
  sport TEXT DEFAULT 'mens-soccer'
);

CREATE INDEX IF NOT EXISTS idx_gradsen_sport ON graduating_seniors(sport);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gradsen_college_season_sport ON graduating_seniors(college_name, season, sport);

-- Per-player roster rows — the 2025 rebuild. One row per rostered athlete
-- (not just graduating seniors), each tagged with their own estimated
-- graduation year, so the Graduating Database can browse
-- sport -> estimated_graduation_year -> division -> school -> player and
-- matching can target a recruit's actual incoming class year instead of
-- "whoever happens to be a senior this season". Supersedes graduating_seniors
-- for any sport it has rows for; sports without rows keep reading the old
-- table untouched (see GraduatingDatabase.jsx).
CREATE TABLE IF NOT EXISTS roster_players (
  id TEXT PRIMARY KEY,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  created_by_id TEXT,

  college_name TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'mens-soccer',
  division TEXT NOT NULL,
  season TEXT NOT NULL,
  conference TEXT,
  player_name TEXT NOT NULL,
  class_year_label TEXT,
  position TEXT DEFAULT 'UNKNOWN',
  minutes_played INTEGER DEFAULT 0,
  games_played INTEGER,
  games_started INTEGER,
  estimated_graduation_year INTEGER,
  eligibility_end_year INTEGER,
  projected_minutes INTEGER,
  projected_minutes_season TEXT,
  prior_programme TEXT,
  nationality TEXT,
  hometown TEXT,
  country TEXT,
  source_stats_url TEXT,
  source_roster_url TEXT,
  data_confidence TEXT DEFAULT 'medium',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_roster_sport_year_division ON roster_players(sport, estimated_graduation_year, division);
CREATE INDEX IF NOT EXISTS idx_roster_college ON roster_players(college_name);
-- Declared here because it already existed in the working database and in no
-- file: somebody added it by hand in a session. The pool-wide philosophy pass
-- runs 1.2s with it and 1.8s without, so every fresh clone and every in-memory
-- test database was on the slow side of a line nobody could see.
CREATE INDEX IF NOT EXISTS idx_rp_season_sport ON roster_players(season, sport);
-- Covers the per-programme read the reports do, which filters all three.
CREATE INDEX IF NOT EXISTS idx_roster_prog_season ON roster_players(college_name, sport, season);

-- ===========================================================================
-- Coach engagement tracking (brief §7, translated to SQLite / D1)
--
-- Postgres types map as: uuid -> TEXT (randomUUID), timestamptz -> TEXT
-- holding ISO-8601 UTC with an explicit Z, jsonb -> TEXT, bigserial ->
-- INTEGER PRIMARY KEY AUTOINCREMENT. engagement_rollup is a real table
-- rebuilt by a job rather than a materialised view.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS coaches (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,

  full_name TEXT,
  email TEXT,
  school TEXT,
  division TEXT,          -- D1 / D2 / D3 / NAIA / NJCAA
  sport TEXT,
  position_title TEXT     -- Head Coach, Assistant, Recruiting Coordinator
);

-- Not in the brief, but the backfill from graduating_seniors.coaching_staff
-- has to be re-runnable without duplicating people.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coaches_identity ON coaches(email, school, sport);

-- One row per athlete-coach pair. This is the join that makes attribution
-- possible.
CREATE TABLE IF NOT EXISTS outreach (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL REFERENCES players(id),
  coach_id TEXT NOT NULL REFERENCES coaches(id),
  token TEXT NOT NULL UNIQUE,
  match_id TEXT,          -- links back to the Tab 2 recommendation; Phase 5 reads it

  -- THREE TIMESTAMPS, THREE DIFFERENT EVENTS. They were two, and the middle
  -- one was missing, so `sent_at` carried both meanings and the weaker one won.
  --
  --   created_at  the outreach record was created (a token now exists)
  --   drafted_at  a message was successfully handed to Outlook as a draft
  --   sent_at     we have explicit confirmation the coach was written to
  --
  -- `sent_at` used to be stamped the moment a draft window opened, so drafting
  -- twenty and sending fifteen recorded twenty sends. Every denominator in the
  -- system keys on `sent_at IS NOT NULL` — evidence performance, reply rates,
  -- the per-inbox send cap — so that overstated all three. It is now written
  -- ONLY by an explicit confirmation: either the AppleScript itself issued
  -- Send, or a human confirmed the batch afterwards. Nothing infers it.
  drafted_at TEXT,
  sent_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,

  UNIQUE (athlete_id, coach_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_athlete ON outreach(athlete_id);
CREATE INDEX IF NOT EXISTS idx_outreach_token ON outreach(token);
-- The pending-confirmation lookup: drafted but not yet confirmed sent.
-- The index on drafted_at lives in migrate.js, which is where the column is
-- added to databases that already have this table.

-- APPEND-ONLY. Visit history is reconstructed from this table; overwriting
-- destroys it irrecoverably. The trigger below makes that a hard guarantee
-- rather than a convention.
CREATE TABLE IF NOT EXISTS tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT,
  outreach_id TEXT REFERENCES outreach(id),   -- resolved at write time
  session_id TEXT NOT NULL,                   -- one per page load
  event_type TEXT NOT NULL,
  coverage_pct INTEGER,
  watched_seconds INTEGER,
  duration_seconds INTEGER,
  dwell_seconds INTEGER,
  rewinds INTEGER,
  skips INTEGER,
  payload TEXT,                               -- JSON
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracking_outreach ON tracking_events(outreach_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tracking_session ON tracking_events(session_id);

CREATE TRIGGER IF NOT EXISTS trg_tracking_events_append_only
BEFORE UPDATE ON tracking_events
BEGIN
  SELECT RAISE(ABORT, 'tracking_events is append-only');
END;

-- Tab 3 reads from here, never from raw events.
CREATE TABLE IF NOT EXISTS engagement_rollup (
  outreach_id TEXT PRIMARY KEY REFERENCES outreach(id),
  qualified_visits INTEGER NOT NULL DEFAULT 0,
  first_qualified_at TEXT,
  last_qualified_at TEXT,
  best_coverage_pct INTEGER NOT NULL DEFAULT 0,
  total_watched_seconds INTEGER NOT NULL DEFAULT 0,
  total_rewinds INTEGER NOT NULL DEFAULT 0,
  chapter_jumps INTEGER NOT NULL DEFAULT 0,
  engagement_score INTEGER NOT NULL DEFAULT 0,   -- 0-100, brief §10
  tier TEXT NOT NULL DEFAULT 'cold',             -- cold|warm|hot|priority|responded
  responded_at TEXT,
  updated_at TEXT
);

-- ===========================================================================
-- Which personalisation evidence each email actually carried.
--
-- The question this table exists to answer is the one nothing in the product
-- could answer before it: does HISTORICAL_SAME_COUNTRY earn more replies than
-- POSITION_GRADUATION? Every ranking number in shared/evidence/select.js is
-- currently a guess, and it stays a guess until sends can be grouped by what
-- they said.
--
-- One row per outreach, written at send time. NOT a log of what was true about
-- the programme — that changes as rosters are re-scraped — but of what we
-- believed and chose at the moment we wrote, which is the only version that
-- can be correlated with a reply.
--
-- Engagement outcomes are deliberately absent: they live in engagement_rollup
-- keyed on the same outreach_id, and copying them here would give two answers
-- to one question the first time a rollup was rebuilt.
--
-- `payload` carries the whole selection including the evidence that was
-- suppressed or rejected, because "this was available and lost to something
-- stronger" is what makes a later comparison causal rather than merely
-- descriptive.
-- ===========================================================================
/**
 * ONE ACTUAL OUTBOUND EMAIL.
 *
 * `outreach` is the RELATIONSHIP — one row per athlete-coach pair, for all
 * time, carrying the tracking token a coach may click years later. That was
 * also, until now, the only record of a send, so a second email to the same
 * coach would overwrite the first email's evidence and keep the first email's
 * timestamp. This table is the missing distinction: the relationship endures,
 * each message is its own immutable row.
 *
 * A row exists from the moment a body is composed, and BECOMES a confirmed
 * send when `sent_at` is stamped — by Outlook's own Send, or by
 * `npm run confirm-sends`. Analytics counts `sent_at IS NOT NULL` and nothing
 * else, which is exactly the denominator `outreach.sent_at` established and
 * I1 found trustworthy.
 *
 * `sequence` is 1 for the initial approach and 2, 3, … for follow-ups. Nothing
 * sends follow-ups today; the model represents them so that when something
 * does, it cannot destroy the first email's record of itself.
 *
 * The tracking token stays on `outreach` and is NOT per-send. A three-step
 * sequence is one conversation and one link — `server/lib/sendCap.js` already
 * counts it that way — and giving each message its own token would change what
 * a click means.
 */
CREATE TABLE IF NOT EXISTS outreach_send (
  id TEXT PRIMARY KEY,
  outreach_id TEXT NOT NULL REFERENCES outreach(id),
  sequence INTEGER NOT NULL,          -- 1 initial, 2+ follow-up

  drafted_at TEXT,                    -- a body reached Outlook
  sent_at TEXT,                       -- CONFIRMED. The analytics denominator.

  -- Denormalised from the relationship so a snapshot reads without a join and
  -- survives a coach row being merged or a programme renamed.
  athlete_id TEXT NOT NULL REFERENCES players(id),
  coach_id TEXT NOT NULL REFERENCES coaches(id),
  college_name TEXT,
  sport TEXT,

  -- LEGACY_UNKNOWN for anything predating the role-based engine. Never
  -- backfilled to a current version: see shared/evidence/outreachPolicy.js.
  policy_version TEXT NOT NULL,

  structure TEXT,
  structure_source TEXT,
  body_source TEXT,                   -- STRUCTURED | TEMPLATE
  template_variant TEXT,

  -- All four derived from what was RENDERED, never from what was selected.
  has_personalisation INTEGER,
  primary_kind TEXT,
  primary_role TEXT,                  -- HOOK | RELEVANCE (never RECOGNITION)
  hook_kind TEXT,
  rendered_kinds TEXT,                -- ordered, comma-joined
  rendered_roles TEXT,
  rendered_count INTEGER,

  subject TEXT,
  body_hash TEXT,                     -- SHA-256, profile URL normalised
  payload TEXT,                       -- JSON: rendered sentences with text, held, operator state

  created_at TEXT NOT NULL,

  -- Repeated execution must not silently create a second send.
  UNIQUE (outreach_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_outreach_send_outreach ON outreach_send(outreach_id);
CREATE INDEX IF NOT EXISTS idx_outreach_send_sent ON outreach_send(sent_at);
CREATE INDEX IF NOT EXISTS idx_outreach_send_policy ON outreach_send(policy_version);
CREATE INDEX IF NOT EXISTS idx_outreach_send_primary ON outreach_send(primary_kind);

CREATE TABLE IF NOT EXISTS outreach_evidence (
  outreach_id TEXT PRIMARY KEY REFERENCES outreach(id),
  athlete_id TEXT NOT NULL REFERENCES players(id),
  college_name TEXT,
  sport TEXT,

  -- Canonical only: GOALKEEPER / DEFENSE / MIDFIELD / FORWARD / UNKNOWN.
  athlete_position TEXT,
  class_year INTEGER,

  primary_kind TEXT,
  primary_tier TEXT,              -- FACT | SIGNAL
  primary_strength INTEGER,
  secondary_kind TEXT,
  secondary_tier TEXT,
  secondary_strength INTEGER,

  structure TEXT,                 -- which email shape was used
  -- ENGINE or OPERATOR. A structure a human chose is a different treatment
  -- from one the engine reached on its own, and mixing the two would make the
  -- first reply-rate comparison meaningless in a way nobody could see after.
  structure_source TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0,

  -- The ordered selected set as one groupable value, comma-joined, e.g.
  -- 'HISTORICAL_SAME_COUNTRY,POSITION_GRADUATION,ACADEMIC_FIT'. Order is part
  -- of the identity: leading with the country and supporting with the roster
  -- is a different email from the reverse. primary_kind / secondary_kind above
  -- remain as convenience columns for the two questions asked most often.
  selected_kinds TEXT,
  -- How many of those actually survived the operator's editing into the body.
  -- NULL when nobody checked (a dry run has no body), which is a third state
  -- and not the same as zero.
  rendered_count INTEGER,
  -- STRUCTURED (assembled from the structure's blocks) or TEMPLATE (the
  -- athlete's own saved template). Separate from template_variant below, which
  -- describes what their saved template IS rather than whether it was used.
  body_source TEXT,

  -- Separates "we had a roster and found nothing to say" from "we had no
  -- roster". Around 325 men's programmes are in the second case, and grouping
  -- them with the first would make no-evidence sends look twice as common as
  -- they are.
  had_roster INTEGER,
  had_history INTEGER,

  -- Confidence alongside strength, normalised rather than left in the JSON:
  -- "did HIGH-confidence evidence out-reply MEDIUM" is a first-order question
  -- and should not need a JSON extract to group by.
  primary_confidence TEXT,
  secondary_confidence TEXT,

  -- Which template shape produced the email, kept SEPARATE from `structure`
  -- above so an A/B can tell an argument order apart from an evidence angle.
  -- See shared/evidence/templateVariant.js for the ids.
  template_variant TEXT,

  -- The exact sentence(s) claimed, as sent. The payload carries the evidence
  -- that produced them; this carries the prose, so an audit can ask "what did
  -- we actually tell this coach" without re-rendering from data that may since
  -- have been re-scraped.
  rendered_paragraph TEXT,

  -- 1 when a human overrode the engine's ranking in the composer. An override
  -- is a different treatment and must be separable from the engine's own
  -- choice when reply rates are compared.
  operator_selected INTEGER NOT NULL DEFAULT 0,

  -- Whether the evidence sentence actually reached the coach. The composer
  -- hands the operator an editable body, and deleting the programme sentence
  -- is a reasonable edit; attributing a reply to a claim that was cut would be
  -- the exact measurement error this table exists to prevent. NULL means there
  -- was no sentence to look for.
  evidence_rendered INTEGER,

  -- How old the roster behind any present-tense claim was AT SEND TIME. A
  -- roster re-scraped next month cannot answer that, and it is the question an
  -- integrity audit asks first.
  roster_freshness TEXT,          -- CURRENT | ACCEPTABLE | STALE | UNKNOWN
  roster_age_days INTEGER,

  payload TEXT,                   -- JSON: full selection, suppressed, rejected
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outreach_evidence_primary ON outreach_evidence(primary_kind);
CREATE INDEX IF NOT EXISTS idx_outreach_evidence_athlete ON outreach_evidence(athlete_id);
CREATE INDEX IF NOT EXISTS idx_outreach_evidence_structure ON outreach_evidence(structure);
-- The index on selected_kinds lives in migrate.js, not here. schema.sql runs
-- BEFORE the migration that adds the column, so indexing it here fails on
-- every database that already has the table — which is every real one.

-- ===========================================================================
-- DERIVED, DISPOSABLE, REBUILDABLE. Not a source of truth.
--
-- One row per player who appeared on a programme's roster in a season and was
-- not on that programme's previous roster. `roster_players` remains the only
-- source; this table is a materialised read of it and can be dropped and
-- rebuilt at any time by `npm run build:recruiting`. Nothing writes to it by
-- hand, and nothing else in the application writes to it at all.
--
-- It exists because the derivation is a cross-season, cross-programme join
-- that is far too slow to run per request, and because the confidences below
-- are decisions we want recorded once rather than recomputed differently in
-- three places.
--
-- THE GATE: a row only exists here when BOTH adjacent rosters are on file.
-- 195 men's programmes have a 2025 roster and no 2024 one, and reading absence
-- as arrival would invent a recruiting class for every one of them. Those rows
-- are counted in the build report and deliberately not stored as arrivals.
CREATE TABLE IF NOT EXISTS recruiting_arrivals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  programme TEXT NOT NULL,
  sport TEXT NOT NULL,
  arrival_season TEXT NOT NULL,

  -- Provenance: which comparison produced this row. With `prior_season` a
  -- reader can go back to the two roster snapshots and see for themselves.
  prior_season TEXT NOT NULL,
  source_transition TEXT NOT NULL,
  roster_row_id TEXT,

  player_name TEXT NOT NULL,
  name_key TEXT NOT NULL,

  -- DIRECT only. UNKNOWN is never stored — it is the absence of a row, and
  -- storing it would invite somebody to count it.
  arrival_confidence TEXT NOT NULL,
  -- EXACT | RECONCILED. Which name rule matched, so a reconciliation can be
  -- audited rather than trusted.
  identity_method TEXT NOT NULL,
  -- Spellings this row absorbed when one roster printed the same player twice,
  -- as a JSON array of the discarded names. Empty for an EXACT identity. Named
  -- email prose is gated on it being empty; aggregate counts are not.
  reconciled_from TEXT,

  -- GOALKEEPER | DEFENSE | MIDFIELD | FORWARD | UNKNOWN. Never a sub-position.
  canonical_position TEXT NOT NULL,

  nationality_flag TEXT,          -- USA | International | null
  country TEXT,                   -- populated for internationals only
  region TEXT,                    -- international regions only; null otherwise
  is_international INTEGER NOT NULL DEFAULT 0,

  class_label_raw TEXT,
  entry_type TEXT NOT NULL,       -- FRESHMAN | EXPERIENCED | UNKNOWN

  -- Kept entirely separate from arrival_confidence. A player can be a DIRECT
  -- arrival whose origin is AMBIGUOUS: we are certain they are new here and
  -- cannot say where they came from.
  prior_programme TEXT,
  prior_confidence TEXT NOT NULL, -- OBSERVED | NAME_MATCH | AMBIGUOUS | NONE
  prior_candidates TEXT,          -- JSON array, kept for debugging

  coach TEXT,
  -- ATTRIBUTED | INHERITED | UNKNOWN. A coach's first roster is the previous
  -- regime's recruiting and must never be credited to them.
  coach_attribution TEXT NOT NULL,

  built_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recruiting_programme
  ON recruiting_arrivals(programme, sport, arrival_season);
CREATE INDEX IF NOT EXISTS idx_recruiting_country
  ON recruiting_arrivals(sport, country, canonical_position);
CREATE INDEX IF NOT EXISTS idx_recruiting_name
  ON recruiting_arrivals(sport, name_key);

-- Cursor and bookkeeping for the pull from the edge collector.
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

-- ===========================================================================
-- Opt-outs. APPEND-ONLY in spirit: a suppression is never deleted by the app,
-- because "they asked once and we forgot" is the failure this table exists to
-- prevent. CAN-SPAM gives ten business days to honour a request and no
-- expiry at all afterwards.
--
-- Keyed on the address alone, not on (athlete, coach): a coach who opts out
-- is opting out of Thriv3, not out of one athlete. The roadmap wording is
-- "honoured across every athlete's campaigns", and keying it any other way
-- would quietly mean the opposite.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS suppressions (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  reason TEXT,                -- unsubscribed | bounced | complained | manual
  source TEXT,                -- where it came from: edge | manual | sync
  outreach_token TEXT,        -- the link they clicked, when there was one
  note TEXT
);

-- ===========================================================================
-- Who was in charge of a programme, season by season.
--
-- A third of programmes change their freshman usage sharply mid-window, and
-- the roster tables cannot say whether that was a new coach, the same coach
-- changing approach, or a vacancy. Without this, a recruit is shown four
-- seasons of a programme that may no longer exist.
--
-- One row per (school, sport, season) INCLUDING the ones that did not
-- resolve: `reason` carries why, because a missing row reads as coverage
-- while a row with a reason reads as a gap. `confidence` is High for a live
-- year-addressed page and Medium for a Wayback snapshot.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS coach_seasons (
  school TEXT NOT NULL,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  division TEXT,
  coach_name TEXT,            -- null when unresolved or the post was vacant
  coach_title TEXT,
  method TEXT,                -- roster-live | wayback:<ts> | none
  confidence TEXT,            -- High | Medium
  source_url TEXT,
  reason TEXT,                -- why there is no name, when there is none
  imported_at TEXT NOT NULL,

  PRIMARY KEY (school, sport, season)
);

CREATE INDEX IF NOT EXISTS idx_coach_seasons_prog ON coach_seasons(school, sport);

-- ===========================================================================
-- CAMPAIGNS — Phase A1. Additive DDL only.
--
-- A campaign is a FINITE recruiting service around one athlete and the Top 100
-- programmes their matching run produced. It is not a subscription and not an
-- endless automation: `starts_on` opens it, `ends_on` closes it, and both are
-- set by an operator because the product has not fixed a duration.
--
-- WHY THE TOP 100 IS COPIED RATHER THAN POINTED AT. Match recommendations live
-- today as a JSON blob uploaded to server/uploads/, addressed by the single
-- mutable pointer `players.recommendations`. Re-analysing overwrites that
-- pointer and editing a profile nulls it (see src/pages/EditPlayer.jsx), so a
-- campaign that stored the pointer would be one profile save away from having
-- no Top 100 at all. The rank, score, breakdown and programme identity are
-- therefore COPIED into programme_campaigns at creation and never touched by
-- matching again — which is what makes a campaign from last season still
-- readable after the model has been retuned twice.
--
-- Nothing writes to either table yet. Creation, tier assignment, state
-- transitions and the API are A2 onwards.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,

  -- OWNED BY THE ATHLETE. A campaign has no meaning without one, and the
  -- delete path in src/pages/Players.jsx issues a bare DELETE with no cascade
  -- of its own, so the cascade is declared here rather than left to a caller
  -- that does not exist.
  athlete_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,

  -- SNAPSHOT of players.sport at creation. The athlete row is mutable, and a
  -- sport changed afterwards would silently re-interpret every programme row
  -- underneath this campaign.
  sport TEXT NOT NULL,

  label TEXT,                                 -- operator-facing name; two campaigns a year apart need telling apart

  -- LIFECYCLE ONLY, and deliberately three values.
  --   draft   snapshot taken, tiers assignable, nothing may be sent
  --   active  outreach may proceed
  --   closed  the finite service has ended
  -- `paused` is absent because nothing schedules a send yet and there is
  -- nothing to pause; it belongs with the scheduler that would obey it.
  -- NOT named `status`: players.status already exists with unrelated values
  -- (New / Analyzed / Contacted / Committed) and the collision would be read
  -- wrong at a glance.
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'active', 'closed')),

  -- Dates, not timestamps: these are service boundaries an operator sets, not
  -- events we observed. Nullable ends are honest — the product has not fixed a
  -- campaign duration, and encoding a default one here would silently re-date
  -- every live campaign the day that default changed.
  starts_on TEXT NOT NULL,                    -- YYYY-MM-DD
  outreach_ends_on TEXT,                      -- last date new outreach may be initiated
  ends_on TEXT,                               -- the campaign closes

  created_at TEXT NOT NULL,                   -- ISO-8601 UTC with an explicit Z
  updated_at TEXT NOT NULL,

  -- When it ACTUALLY closed, which is not `ends_on`: a campaign can be closed
  -- early, and the planned end and the real end are different facts.
  closed_at TEXT,
  -- Why. Kept off the state enum on purpose, so a new reason never needs a
  -- state migration.
  close_reason TEXT,

  -- ---- snapshot provenance -------------------------------------------------
  -- The exact players.recommendations pointer this snapshot was taken from, so
  -- an audit can go back to the blob while it exists and can tell that it does
  -- not when it has been replaced. Nullable: a campaign seeded by some other
  -- route than the stored analysis has no such reference, and inventing one
  -- would be worse than recording none.
  source_analysis_ref TEXT,
  snapshot_taken_at TEXT NOT NULL,

  -- JSON. The model's INPUTS as they were: match_weights, criterion_ranking,
  -- origin, academic_minimum, preferred divisions/conferences, recruiting
  -- class year, position, roster season, pool size, exclusion counts, and the
  -- identity of the scoring model. A rank without its weights cannot be
  -- explained a year later, and the six-criterion model has already changed
  -- once — comparing ranks across model versions without knowing they differ
  -- is the failure `outreach_send.policy_version` exists to prevent.
  matching_inputs TEXT,

  -- How many programme rows were snapshotted. A denominator recorded once,
  -- rather than recomputed later from rows that may have been added.
  programme_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_athlete ON campaigns(athlete_id, state);

-- ONE ACTIVE CAMPAIGN PER ATHLETE, enforced by the database rather than by a
-- convention somebody has to remember. A partial index, so drafts and closed
-- campaigns are unlimited: an athlete may have several drafts under review and
-- a history of closed campaigns, and only the live one is exclusive.
--
-- This is what lets a later send resolve "the campaign this message belongs
-- to" from the athlete alone, without every call site having to name one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_one_active
  ON campaigns(athlete_id) WHERE state = 'active';

-- ===========================================================================
-- One row per Top 100 programme inside one campaign.
--
-- MEMBERSHIP IS NOT TIERING. Every Top 100 programme is here regardless of
-- tier; tier controls how much outreach a programme receives, never whether it
-- is in the campaign. Nothing should ever delete a row to "remove" a
-- programme — `state = 'stopped'` is how outreach ceases, and it keeps the
-- record of the programme having been in the campaign at all.
--
-- WHAT IS A SNAPSHOT HERE, frozen at campaign creation and never updated by a
-- later matching run: `rank`, `match_score`, `score_breakdown`, `division`,
-- `conference`, and the programme identity itself (`college_name`, `sport`,
-- `college_id`). The name is what everything else in this database joins on —
-- coaches.school, outreach_evidence.college_name, outreach_send.college_name,
-- roster_players.college_name — and the id is kept ALONGSIDE it, not instead,
-- so a school renamed in `colleges` afterwards leaves this row still readable
-- and still joinable.
--
-- WHAT IS AUTHORITATIVE: `tier`, `tier_source`, `state`, `state_reason` and
-- their timestamps. These are decisions, and an operator may change them
-- without disturbing the snapshot that records where the model put the
-- programme.
--
-- Deliberately ABSENT: any counter — coaches contacted, messages sent, replies.
-- All of those are derivable from outreach_send, and a stored counter is a
-- second answer to a question that already has one. outreach_evidence made the
-- same choice for the same reason.
--
-- Also absent: the coaching staff. Contacts legitimately change and outreach
-- must use current addresses, so this table records the PROGRAMME, not its
-- staff list on the day the campaign opened.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS programme_campaigns (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  -- Programme identity, snapshotted. (college_name, sport) is the real key
  -- this codebase joins on; colleges.id is a distinct row per (name, sport).
  college_name TEXT NOT NULL,
  sport TEXT NOT NULL,
  college_id TEXT,                            -- nullable: a name with no colleges row is still a programme

  -- Snapshot of the ranked list. `rank` was previously implicit — array
  -- position in the uploaded blob — and is a stored fact for the first time
  -- here.
  rank INTEGER NOT NULL,
  match_score INTEGER NOT NULL,
  -- JSON: the per-criterion breakdown, labels and confidence as scored. The
  -- difference between "Duke was #4" and "Duke was #4 because geography and
  -- roster opportunity", which is the only version of the first statement
  -- anybody can act on a year later.
  score_breakdown TEXT,

  -- Snapshotted because both drift. Conference realignment is routine — see
  -- the note on colleges.conference_champion_name — so a campaign that read
  -- today's conference would misdescribe its own history.
  division TEXT,
  conference TEXT,

  -- A / B / C. AUTHORITATIVE AND MUTABLE: an operator may promote a programme
  -- without corrupting `rank`, which records where the model put it.
  --
  -- NOT the same concept as engagement_rollup.tier, which is an engagement
  -- temperature (cold | warm | hot | priority | responded) computed from what
  -- a coach did. Any query or response carrying both MUST alias them —
  -- campaign_tier and engagement_tier — because one word answering two
  -- questions is how the wrong one gets rendered.
  --
  -- No DEFAULT: a tier is assigned by the banding rule at creation (A2), and a
  -- row that reached the database without one is a bug worth failing on rather
  -- than a row quietly labelled 'C'.
  tier TEXT NOT NULL CHECK (tier IN ('A', 'B', 'C')),

  -- Whether the band assigned this tier or a human did. An operator's tier is
  -- a different treatment from a banded one, and mixing the two would make the
  -- first "does Tier A out-reply Tier B" comparison meaningless in a way
  -- nobody could see afterwards — the same reasoning as
  -- outreach_evidence.structure_source.
  tier_source TEXT NOT NULL DEFAULT 'AUTO' CHECK (tier_source IN ('AUTO', 'OPERATOR')),
  tier_set_at TEXT,

  -- LIFECYCLE ONLY. Four values, and the restraint is the point:
  --   queued     in the campaign, nothing sent yet
  --   active     at least one message sent for this programme, outreach continues
  --   stopped    outreach deliberately ceased before the plan finished
  --   completed  the planned outreach finished without a stop
  --
  -- `stopped` is what makes a PROGRAMME the decision unit above a coach: Duke
  -- says it is not recruiting the position, this row stops, and every Duke
  -- coach for that athlete is out of scope in one write.
  --
  -- WHAT DOES NOT BELONG IN THIS COLUMN, and why:
  --   * Reply classifications — not_interested, not_recruiting,
  --     active_conversation. Those are the OUTCOME that produces a stop, not
  --     the state; they belong in `state_reason` once reply classification
  --     exists, and `active_conversation` is not even exclusive of `active`.
  --   * Derived facts — awaiting_response, action_required. Both are
  --     computable at read time from outreach_send and a date, and stored they
  --     are only true while something keeps writing them: the first missed
  --     tick leaves the column asserting a falsehood every screen repeats.
  --     engagement_rollup already settled this correctly by being a
  --     rebuildable derived table rather than a status field.
  --   * unreachable — a property of the programme's CONTACT DATA, already
  --     answerable from pickBestContact, emailRisk and suppressions, and one
  --     that changes the moment a contact is added.
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'active', 'stopped', 'completed')),

  -- Why it left `active`. Free text against a vocabulary held in code
  -- (not_recruiting | not_interested | no_contact | suppressed |
  -- athlete_declined | committed_elsewhere | operator) rather than a CHECK,
  -- precisely so growing that list never requires a schema migration.
  state_reason TEXT,
  state_changed_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  -- A programme appears once per campaign.
  UNIQUE (campaign_id, college_name, sport),
  -- `rank` is a snapshot of a TOTAL ORDER. Two #4s in one campaign means the
  -- snapshot was written twice, which is a corruption worth refusing rather
  -- than discovering later in a report.
  UNIQUE (campaign_id, rank)
);

-- The list read: one campaign, grouped by tier, in rank order.
CREATE INDEX IF NOT EXISTS idx_programme_campaigns_list
  ON programme_campaigns(campaign_id, tier, rank);
-- The reverse question: which campaigns is this programme in.
CREATE INDEX IF NOT EXISTS idx_programme_campaigns_programme
  ON programme_campaigns(college_name, sport);

-- ===========================================================================
-- WHAT WE LATER LEARNED ABOUT A MESSAGE. Append-only.
--
-- `outreach_send.state` is EXECUTION state — what Thriv3 did, or was told was
-- done, and it is final the moment it happens. This table is the other half:
-- facts that arrive AFTERWARDS, from outside, about a message already sent. A
-- bounce, a reply, a complaint, an opt-out.
--
-- THEY ARE SEPARATE BECAUSE THEY DECAY DIFFERENTLY. Execution state is ours and
-- settled. An observation may arrive days later, from a source of varying
-- trustworthiness, and may be contradicted by a second one. Folding a bounce
-- into `state` would overwrite the record of what we did with a record of what
-- happened to it, and "did we send this" would stop being answerable.
--
-- APPEND-ONLY, enforced by the trigger below rather than by convention — the
-- same guarantee `tracking_events` makes, for the same reason: an observation
-- history that can be edited is not a history.
--
-- NOTHING WRITES A BOUNCE, REPLY OR COMPLAINT IN THIS BUILD. The vocabulary is
-- declared in shared/outreachMessageState.js so the table has a stated shape
-- from the start; a type existing is not permission to invent an observation.
-- The only events this build can honestly produce are ones explaining an
-- acceptance a provider actually reported, and no provider reports one yet.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS outreach_send_event (
  id TEXT PRIMARY KEY,

  -- The message this is about. No ON DELETE clause: nothing deletes a send,
  -- and an observation orphaned from its message would be uninterpretable.
  outreach_send_id TEXT NOT NULL REFERENCES outreach_send(id),

  -- See SEND_EVENT_TYPE. Validated in code rather than by a CHECK constraint,
  -- because the vocabulary grows when ingestion lands and a new observation
  -- must not need a schema migration to be recordable.
  type TEXT NOT NULL,

  -- WHO SAYS SO. An operator's recollection, a transport command that did not
  -- error, and a provider API's own answer are three different strengths of
  -- evidence, and an analysis that pools them is measuring three things.
  source TEXT NOT NULL,

  -- How much to trust it, where the source cannot be certain. A bounce parsed
  -- out of a mailer-daemon message is a guess with a good hit rate; a provider
  -- webhook is not. NULL when the question does not arise.
  confidence TEXT,

  -- When the thing happened, as distinct from when we heard about it. A reply
  -- observed on Tuesday may have been sent on Sunday, and a retention window
  -- keyed on the wrong one is wrong by days.
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,

  payload TEXT                                  -- JSON, or null
);

CREATE INDEX IF NOT EXISTS idx_send_event_send ON outreach_send_event(outreach_send_id, observed_at, id);
CREATE INDEX IF NOT EXISTS idx_send_event_type ON outreach_send_event(type, observed_at);

CREATE TRIGGER IF NOT EXISTS trg_outreach_send_event_append_only
BEFORE UPDATE ON outreach_send_event
BEGIN
  SELECT RAISE(ABORT, 'outreach_send_event is append-only');
END;
