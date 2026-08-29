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
