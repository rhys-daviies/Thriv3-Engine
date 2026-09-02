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
-- programme_seasons — what each programme actually recorded, season by season
--
-- The competitive truth layer. One row per (college_id, season), and only for
-- a season whose win/draw/loss triple was read in full: a partly-read season
-- is absent rather than stored with a hole, because a hole in this table would
-- be summed as a zero somewhere downstream.
--
-- KEYED ON college_id, WHICH IS THE POINT. Every other table here keys a
-- programme by its name, and that has cost this codebase real coverage —
-- 79 NAIA men's programmes were once invisible to every join because the
-- records file and `colleges` spelled the school differently. `colleges.id`
-- already encodes the sport (a school has one row per sport), so the pair
-- cannot drift apart. `sport` is carried alongside anyway, because the
-- division-and-season benchmark pool reads it on every build and should not
-- need a join to do it.
--
-- WHAT IS DELIBERATELY NOT HERE: goals, conference, conference standing,
-- postseason round, and any rating. Phase 12A found the source's postseason
-- column wrong in two of the three D1 values it could check against the
-- schools' own schedules; goals and postseason still have no validated source.
-- Conference membership and the division a season was played in DO exist now —
-- in `programme_conference_seasons`, collected from the conferences' own
-- standings tables in Phase 12D, and joined rather than copied here. See
-- docs/competitive-history.md and docs/competitive-identity.md.
--
-- `matches_played` is stored rather than derived so the pool query can sum it
-- without arithmetic, and the CHECK is what makes that safe.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS programme_seasons (
  college_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,

  wins INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  matches_played INTEGER NOT NULL,

  -- Where the row came from, and how far it has been corroborated.
  --   ROSTER_CONSISTENT   — this season's roster rows agree the team played
  --                         at least this many matches
  --   ROSTER_CONTRADICTED — a player on that roster logged MORE appearances
  --                         than the record says the team played. Two internal
  --                         sources disagree; neither is assumed right, and the
  --                         model refuses the season rather than pick one.
  --   UNCHECKED           — no roster appearances on file to check against
  source TEXT NOT NULL,
  source_record_name TEXT NOT NULL,
  confidence TEXT NOT NULL,

  -- HISTORICAL DIVISION IS NOT HERE, AND THAT IS A DECISION (Phase 12D / O).
  --
  -- It lived here, always null, from 12B.1 until 12D could establish it. It is
  -- owned by `programme_conference_seasons` now and joined on
  -- (college_id, season), for one measured reason: `importProgrammeSeasons.js`
  -- rebuilds this table with `DELETE FROM programme_seasons` followed by a full
  -- re-insert, so any column that importer does not write is silently emptied
  -- every time the win/draw/loss layer is refreshed from its CSVs. A duplicated
  -- division would have been wiped by a routine records refresh, and the
  -- benchmark would have gone quiet with no error raised anywhere. One owner,
  -- one writer, one rebuild path.

  imported_at TEXT NOT NULL,

  PRIMARY KEY (college_id, season),
  CHECK (wins >= 0 AND draws >= 0 AND losses >= 0),
  CHECK (matches_played = wins + draws + losses),
  CHECK (matches_played > 0),
  CHECK (confidence IN ('ROSTER_CONSISTENT', 'ROSTER_CONTRADICTED', 'UNCHECKED'))
);

CREATE INDEX IF NOT EXISTS idx_programme_seasons_pool ON programme_seasons(sport, season);

-- ===========================================================================
-- institution_aliases — every spelling that names one institution
--
-- THE CANONICAL INSTITUTION IS AN IPEDS UNITID, not a name. Names are the
-- problem this table exists to solve: `colleges.name` spells the same school
-- two ways across the two sports for 378 of the 896 institutions that field
-- both, and "Columbia", "Bethel", "Maryville", "Miami" and "Concordia" each
-- name several different colleges. UNITID is assigned by the U.S. Department
-- of Education, one per institution, and is already on 2,145 of the 2,155 rows
-- in the report universe.
--
-- ONE ALIAS, ONE INSTITUTION, ENFORCED BY THE PRIMARY KEY. `alias_key` is the
-- normalised spelling and it is the key: two institutions cannot both claim
-- it. The importer reports a collision and refuses the row rather than letting
-- the second write win, because the second write winning is how a spelling
-- silently changes meaning between two runs.
--
-- PROVENANCE IS NOT OPTIONAL. `source` says where the spelling was read and
-- `alias_type` says what kind of name it is — a rename, a merger, an official
-- abbreviation. A row with no source could not be re-checked, and this table
-- decides which institution a fetched page belongs to.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS institution_aliases (
  alias_key TEXT NOT NULL,        -- normaliseInstitution(alias_raw)
  alias_raw TEXT NOT NULL,
  unitid INTEGER NOT NULL,

  -- ONE CONFERENCE'S OWN SPELLING, where the bare name means something else
  -- everywhere else. '*' is global; a conference id scopes the alias to the
  -- tables that conference publishes.
  --
  -- The Wolverine-Hoosier prints "Rochester" in 2022 and 2023 and "Rochester
  -- Christian (Mich.)" in 2024 and 2025 — the institution renamed mid-window and
  -- the conference's own table followed. A GLOBAL "Rochester" alias would be
  -- wrong: the University Athletic Association prints the same bare name for the
  -- University of Rochester, in Division III, in the same seasons. Scoping it is
  -- what lets both be right.
  conference_scope TEXT NOT NULL DEFAULT '*',

  alias_type TEXT NOT NULL,
  source TEXT NOT NULL,           -- 'colleges.name', a URL, or a curated note
  confidence TEXT NOT NULL,
  notes TEXT,
  imported_at TEXT NOT NULL,

  CHECK (alias_type IN ('CURRENT_NAME', 'HISTORICAL_NAME', 'OFFICIAL_ABBREVIATION',
                        'ATHLETICS_NAME', 'MERGER_NAME', 'RENAMED_INSTITUTION',
                        'CONFERENCE_DISPLAY_NAME')),
  CHECK (confidence IN ('CERTAIN', 'CORROBORATED', 'CURATED')),

  PRIMARY KEY (alias_key, conference_scope)
);

CREATE INDEX IF NOT EXISTS idx_institution_aliases_unitid ON institution_aliases(unitid);
CREATE INDEX IF NOT EXISTS idx_institution_aliases_scope ON institution_aliases(conference_scope);

-- ===========================================================================
-- athletics_domains — which institution a host actually belongs to
--
-- Phase 12C fetched four seasons of well-formed athletics data from
-- `gocolumbialions.com` and filed it under Columbia College, Missouri. The
-- host is Columbia University, New York. Nothing about the fetch was broken.
-- The mapping was wrong, and an HTTP 200 cannot tell you that.
--
-- So this table records what each HOST SAYS IT IS — its <title>, its
-- og:site_name — and compares that against who claimed it in
-- `tools/soccer/verification/known_domains.json`. `status` is the verdict on
-- the host; `wrong_mappings` names the claims the host contradicts.
--
-- REFUTING TAKES MORE EVIDENCE THAN CONFIRMING. A claim is refuted only when
-- an ATHLETICS site's og:site_name or whole title names a whole written-down
-- institution name. A university homepage titled with a system brand
-- ("Purdue University" on pnw.edu) cannot refute a campus's mapping, and a
-- match reached through a shared bare base ("Queens College") cannot either.
-- Confirming is safe on weaker evidence, because the claimant's own name is
-- what generated the spelling being matched.
--
-- NOTHING HERE REWRITES known_domains.json. A WRONG_INSTITUTION verdict makes
-- a mapping unusable; proving the replacement is separate work.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS athletics_domains (
  domain TEXT PRIMARY KEY,
  unitid INTEGER,                 -- who the HOST says it is; null when unestablished
  status TEXT NOT NULL,
  role TEXT,                      -- ATHLETICS_SITE | INSTITUTION_SITE | UNKNOWN

  claimed_keys TEXT NOT NULL,     -- JSON — the names that claimed it in the mapping file
  claimed_unitids TEXT NOT NULL,  -- JSON — those names, resolved
  wrong_mappings TEXT,            -- JSON — claims this host contradicts

  evidence_kind TEXT,             -- OG_SITE_NAME | PAGE_TITLE | TITLE_SEGMENT
  evidence_text TEXT,
  identity_method TEXT,
  identity_strength TEXT,         -- WHOLE_NAME | BASE_ONLY
  platform TEXT,
  http_status INTEGER,
  final_url TEXT,

  verification_method TEXT NOT NULL,
  confidence TEXT NOT NULL,
  notes TEXT,
  checked_at TEXT NOT NULL,

  CHECK (status IN ('VERIFIED', 'VERIFIED_ALIAS', 'AMBIGUOUS', 'WRONG_INSTITUTION',
                    'UNREACHABLE', 'INSUFFICIENT_EVIDENCE'))
);

CREATE INDEX IF NOT EXISTS idx_athletics_domains_unitid ON athletics_domains(unitid);
CREATE INDEX IF NOT EXISTS idx_athletics_domains_status ON athletics_domains(status);

-- ===========================================================================
-- conference_seasons — one conference's own table, for one sport, one season
--
-- The cheapest coverage in this design. One fetch of a conference's standings
-- page returns every member of that conference for that season, with each
-- member's conference record and the size of the conference — which is where
-- both historical conference and historical division come from. Phase 12C
-- reached historical conference for 19.8% of programme-seasons from the
-- programme side after 1,088 requests; this reaches the whole universe in
-- about 1,300.
--
-- `division` IS THE CONFERENCE'S DIVISION IN THAT SEASON, and where it is null
-- no member of that conference gets a benchmark. `season_confirmed` records
-- that the fetched table's own title named the season we asked for: a
-- standings URL that quietly serves the current season is the single most
-- dangerous failure available here, and `themw.com` does exactly that.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS conference_seasons (
  conference_id TEXT NOT NULL,
  conference_name TEXT NOT NULL,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,

  division TEXT,
  division_provenance TEXT NOT NULL,

  member_count INTEGER,           -- rows in the conference's own table
  resolved_member_count INTEGER,  -- of those, ones matched to a programme
  groups TEXT,                    -- JSON — "East"/"West" pods, why row order is not finish

  source_url TEXT,
  source_platform TEXT,
  season_confirmed INTEGER NOT NULL,
  sport_confirmed INTEGER NOT NULL,
  status TEXT NOT NULL,
  imported_at TEXT NOT NULL,

  PRIMARY KEY (conference_id, sport, season),
  CHECK (division IS NULL OR division IN ('NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA')),
  CHECK (division_provenance IN ('EXPLICIT_OFFICIAL', 'DERIVED_FROM_OFFICIAL_MEMBERSHIP',
                                 'CONFLICTING', 'UNKNOWN')),
  CHECK (season_confirmed IN (0, 1)),
  CHECK (sport_confirmed IN (0, 1))
);

-- ===========================================================================
-- programme_conference_seasons — which conference and division a programme
-- actually played in, season by season
--
-- The production output of Phase 12D, and the sole owner of historical
-- division. `programme_seasons` says what a programme recorded; this says who
-- it was recording it against, and in which division — which is the
-- denominator the benchmark needs and the one thing 12B.1 had to withhold.
--
-- HISTORICAL DIVISION IS NEVER THE CURRENT DIVISION. `colleges.division` is a
-- snapshot: Mercyhurst men's played 2022 in Division II and every internal
-- column calls that season Division I. Null here means not established, the
-- benchmark refuses, and a stated refusal is the correct output. There is no
-- fallback, and no disclosure that would make one acceptable.
--
-- CONFERENCE FINISH IS NOT HERE. `conference_table_row` is the row's position
-- as PRINTED and is explicitly not a finish: the PSAC prints East then West,
-- so Mercyhurst, first in the West, is eighth by row. `seed` is stored only
-- where the conference printed one in its own notation.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS programme_conference_seasons (
  college_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  unitid INTEGER,

  conference_id TEXT NOT NULL,
  conference_raw TEXT NOT NULL,   -- exactly as the source printed the member's conference

  historical_division TEXT,
  division_provenance TEXT NOT NULL,

  conference_wins INTEGER,
  conference_draws INTEGER,
  conference_losses INTEGER,
  conference_matches INTEGER,

  conference_size INTEGER,
  conference_table_row INTEGER,   -- as printed. NOT a finish.
  conference_group TEXT,          -- the pod heading the row sat under, where there was one
  seed INTEGER,                   -- only where the conference printed one
  champion_marker INTEGER,

  member_raw TEXT NOT NULL,       -- exactly as the conference printed the institution
  identity_method TEXT NOT NULL,
  identity_evidence TEXT NOT NULL,

  -- WHICH OFFICIAL SOURCE ESTABLISHED THE MEMBERSHIP, and whether that source
  -- also carried the record made inside the conference. The two are separate
  -- facts from separate parts of a page: "Big East, NCAA Division I" is complete
  -- and checkable without "5-2-1 in conference", and requiring the second before
  -- believing the first would throw the first away.
  membership_provenance TEXT NOT NULL DEFAULT 'OFFICIAL_CONFERENCE_STANDINGS',
  record_status TEXT NOT NULL DEFAULT 'RECORD_KNOWN',

  source_url TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  provenance TEXT NOT NULL,
  confidence TEXT NOT NULL,
  season_confirmed INTEGER NOT NULL,
  imported_at TEXT NOT NULL,

  PRIMARY KEY (college_id, season),
  CHECK (historical_division IS NULL OR historical_division IN ('NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA')),
  CHECK (division_provenance IN ('EXPLICIT_OFFICIAL', 'DERIVED_FROM_OFFICIAL_MEMBERSHIP',
                                 'CONFLICTING', 'UNKNOWN')),
  CHECK (conference_matches IS NULL
         OR conference_matches = conference_wins + conference_draws + conference_losses),
  CHECK (conference_wins IS NULL OR conference_wins >= 0),
  CHECK (conference_draws IS NULL OR conference_draws >= 0),
  CHECK (conference_losses IS NULL OR conference_losses >= 0),
  CHECK (season_confirmed IN (0, 1)),
  CHECK (membership_provenance IN ('OFFICIAL_CONFERENCE_STANDINGS', 'OFFICIAL_PROGRAMME_SOURCE',
                                   'OFFICIAL_CONFERENCE_MEMBERSHIP', 'OFFICIAL_NCAA_MEMBERSHIP',
                                   'OFFICIAL_NAIA_MEMBERSHIP')),
  CHECK (record_status IN ('RECORD_KNOWN', 'RECORD_UNAVAILABLE')),
  -- Membership without a record is allowed; a record without its own status is not.
  CHECK ((record_status = 'RECORD_KNOWN') = (conference_wins IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_pcs_pool ON programme_conference_seasons(sport, season, historical_division);
CREATE INDEX IF NOT EXISTS idx_pcs_conf ON programme_conference_seasons(conference_id, sport, season);

-- ===========================================================================
-- conference_membership_quarantine — the rows collection could not place
--
-- A member of a conference's own table that no programme in `colleges` claims.
-- Kept rather than dropped, because the reasons are evidence: Limestone's
-- programme was discontinued inside the window and its 2022 and 2023 rows are
-- real history; PennWest Edinboro and PennWest Clarion share one UNITID with
-- PennWest California and are separate programmes; and a name we simply cannot
-- resolve is a gap in `institution_aliases` that this table makes visible.
-- Silently discarding them would make the conference look smaller than it was
-- and would hide every alias we still owe.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS conference_membership_quarantine (
  conference_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  season INTEGER NOT NULL,
  member_raw TEXT NOT NULL,

  reason TEXT NOT NULL,
  candidates TEXT,                -- JSON — where a name resolved to more than one
  conference_record TEXT,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL,

  PRIMARY KEY (conference_id, sport, season, member_raw)
);

-- ===========================================================================
-- conference_members_official — the associations' own membership record
--
-- Phase 12E. The NCAA publishes a member directory: every institution, its
-- division, its conference, and its official athletics website. It is the
-- authoritative answer to "which conferences exist and who belongs to them",
-- and it removed the circularity in 12D's inventory, which had been seeded from
-- the conference strings already in `colleges` — so a conference our own data
-- never named was never looked for, and a conference our data named for one
-- sport was only looked for in that sport.
--
-- IT IS A CURRENT SNAPSHOT AND AN ALL-SPORTS CONFERENCE, and both limits are
-- load-bearing. The directory's `academicYear` parameter is accepted and
-- silently ignored — it returns 2027 whatever you ask for — and a school's
-- listed conference is its primary one, which for soccer is sometimes a
-- different conference entirely: Akron men's soccer played the Mid-American
-- while the directory lists Akron in the Mid-American for everything else and
-- our own row says Big East.
--
-- SO IT IS NEVER HISTORICAL MEMBERSHIP. It is used for exactly two things:
-- deciding which conferences to collect, and breaking a tie between
-- institutions that share a spelling — "Westminster" is three colleges, and one
-- of them being in the conference that published the table is evidence about
-- identity, not about the season.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS conference_members_official (
  -- Nullable, and deliberately: an institution the directory lists that our own
  -- table does not hold still belongs in its conference's roster. The Centennial
  -- Conference's Washington College is not a programme we track, and its absence
  -- from the roster is what let "Washington College #1 seed" reduce to the
  -- University of Washington and take a Division III season with it.
  unitid INTEGER,
  conference_id TEXT NOT NULL,
  conference_raw TEXT NOT NULL,
  division TEXT,
  name_official TEXT NOT NULL,
  athletics_host TEXT,
  state TEXT,
  identity_method TEXT,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL,

  PRIMARY KEY (conference_id, name_official)
);

CREATE INDEX IF NOT EXISTS idx_cmo_conf ON conference_members_official(conference_id);

-- ---------------------------------------------------------------------------
-- Generated reports — the delivery surface's own history, and nothing else.
--
-- Phase 13J. One row per SUCCESSFUL OR FAILED generation of one document. It
-- is the answer to six operator questions and no more: when was this
-- generated, who for, which programme, which report type, which artefact went
-- out, and which engine produced it.
--
-- IMMUTABLE. A row is written once and never updated. Regenerating the same
-- athlete and programme writes a NEW row with a NEW artefact, because the
-- roster and projection data underneath a report change between generations —
-- so a report sent to a family in March is not the document the same inputs
-- would produce in June, and calling them the same file would be a lie about
-- what was sent.
--
-- `id` is the artefact key as well as the row key, so two generations of one
-- pair cannot collide on disk however the display filename repeats.
--
-- NOT a document-management system. No folders, no tags, no sharing, no
-- retention rules, no analytical model JSON. The report engine is frozen and
-- this table does not touch a single one of its tables.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generated_reports (
  id TEXT PRIMARY KEY,

  -- 'athlete' (athlete × programme) or 'programme' (the programme document).
  report_type TEXT NOT NULL,
  -- Null for a programme report. Deliberately NOT a foreign key: a history row
  -- must survive an athlete being archived or removed, because it records
  -- something that was sent.
  athlete_id TEXT,
  college_id TEXT NOT NULL,
  sport TEXT NOT NULL,

  -- Denormalised on purpose, so the history reads correctly years later even
  -- if a programme is renamed or an athlete record changes.
  athlete_name TEXT,
  college_name TEXT,

  -- The canonical human-readable name, from the frozen `reportFilename`.
  filename TEXT NOT NULL,
  -- Relative to the store root, never absolute: an absolute path in a database
  -- row is a path that breaks when the machine changes.
  artifact_path TEXT,

  page_count INTEGER,
  byte_size INTEGER,
  -- TWO HASHES, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
  --
  -- `sha256` covers the file as stored, so it detects an artefact that has
  -- been altered or truncated on disk. It CANNOT detect a duplicate: every
  -- PDF embeds its own creation timestamp and an /ID derived from it, so two
  -- generations of identical data are two different files.
  --
  -- `content_sha256` covers the concatenated content streams — the ink. 13I
  -- proved those are byte-identical across repeated generation from unchanged
  -- data, so this is what says "the same document, generated twice" and it is
  -- what the operator sees as a fingerprint.
  --
  -- Internal either way; neither is ever shown as a client identifier.
  sha256 TEXT,
  content_sha256 TEXT,
  -- Which frozen engine produced this artefact.
  engine_sha TEXT,

  -- 'generated' or 'failed'. A row is only written as generated once the
  -- artefact is on disk, so a success row cannot describe a missing file.
  status TEXT NOT NULL,
  error TEXT,

  generated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generated_reports_athlete
  ON generated_reports(athlete_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_reports_pair
  ON generated_reports(athlete_id, college_id, generated_at DESC);
