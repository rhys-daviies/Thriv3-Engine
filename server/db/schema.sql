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
  sport TEXT DEFAULT 'mens-soccer'
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
  sent_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,

  UNIQUE (athlete_id, coach_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_athlete ON outreach(athlete_id);
CREATE INDEX IF NOT EXISTS idx_outreach_token ON outreach(token);

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

-- Cursor and bookkeeping for the pull from the edge collector.
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
