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

-- ===========================================================================
-- THIS CAMPAIGN IS PURSUING THIS COACH AT THIS PROGRAMME.
--
-- The layer between a programme campaign and the messages sent under it, and
-- the one the model was missing. Four things sit in a line and each answers a
-- different question:
--
--   programme_campaigns  this athlete is pursuing this programme this campaign
--   THIS TABLE           this campaign is pursuing this COACH there
--   outreach             this athlete and this coach, for all time, one token
--   outreach_send        this one message happened
--
-- CAMPAIGN-SPECIFIC, WHICH IS THE WHOLE POINT. A relationship endures and a
-- campaign is finite, so Campaign 1 pursuing Coach Smith and Campaign 2
-- pursuing Coach Smith a season later are TWO attempts sharing ONE outreach
-- row. Keying this on the relationship would have collapsed them into one and
-- lost the second campaign's progression entirely — the same mistake A6 avoided
-- by putting authoritative attribution on the message rather than the
-- relationship.
--
-- A ROW HERE IS A PLAN, NOT A CONTACT. It may exist before anything is drafted
-- and before the campaign is even active: an operator reviews a draft campaign
-- and decides who to pursue. Whether a message may actually be written is B3's
-- question and is asked at the write, not here. Nothing should ever read the
-- existence of a row in this table as "we contacted this coach" — that is what
-- outreach_send is for.
--
-- Nothing writes to it yet. Coach selection, sequence policy, depth by tier and
-- scheduling are all later, and this is the place they will put their state.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS programme_contact_attempts (
  id TEXT PRIMARY KEY,

  -- OWNED BY the programme campaign, so it dies with it: an attempt is
  -- execution state for a pursuit that no longer exists. This is the only
  -- cascade on the table, and it deliberately stops here — see outreach_id.
  programme_campaign_id TEXT NOT NULL
    REFERENCES programme_campaigns(id) ON DELETE CASCADE,

  -- REFERENCED, not owned. No ON DELETE clause, which under foreign_keys=ON
  -- means the delete is refused — matching every other reference to `coaches`
  -- in this schema (outreach.coach_id, outreach_send.coach_id). Deleting a
  -- coach out from under live campaign state should fail loudly.
  coach_id TEXT NOT NULL REFERENCES coaches(id),

  /**
   * The lifetime relationship this attempt executes through, once it has one.
   *
   * NULLABLE UNTIL FIRST EXECUTION, and that is forced rather than preferred.
   * Creating an outreach row mints a permanent tracking token, and B3 refuses
   * to create one under a campaign that is not active — so requiring it here
   * would make it impossible to plan a draft campaign at all, and would mint a
   * token for every one of roughly 320 coaches in a Top 100 that may never be
   * activated.
   *
   * Also RESTRICT rather than SET NULL: an attempt whose relationship vanished
   * is not interpretable, and every other reference to `outreach` in this
   * schema refuses the delete the same way.
   */
  outreach_id TEXT REFERENCES outreach(id),

  /**
   * EXECUTION STATE OF THE PURSUIT. Three of these are reachable today:
   *
   *   planned    selected for pursuit; nothing has been written
   *   active     being pursued
   *   stopped    no longer being pursued
   *
   * `waiting` and `completed` are declared so the column does not need a table
   * rebuild when they become real — SQLite cannot alter a CHECK — but NOTHING
   * CAN REACH THEM. `waiting` means waiting for a reply or an interval, which
   * needs a scheduler and reply ingestion; `completed` means a planned sequence
   * finished, which needs a sequence policy to have planned one. The transition
   * table in server/lib/contactAttempts.js refuses both by name until the thing
   * that gives them meaning exists.
   */
  state TEXT NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned', 'active', 'waiting', 'stopped', 'completed')),

  -- Why it stopped. Off the enum for the same reason as everywhere else here:
  -- reply classification will bring reasons no migration should be needed for.
  state_reason TEXT,
  state_changed_at TEXT,

  /**
   * CAMPAIGN-LOCAL progression, and emphatically not `outreach_send.sequence`.
   *
   *   sequence  the Nth accepted message EVER in the lifetime relationship
   *   step      where this campaign's pursuit of this coach has got to
   *
   * A second campaign reaching a coach who already received two messages starts
   * at step 1 while the next message is sequence 3. Collapsing them would make
   * a campaign's own progression unreadable.
   *
   * WHAT A STEP DOES IS NOT DECIDED HERE. Depth by tier, what step 2 says and
   * how long it waits are a sequence policy's business. This is only somewhere
   * to keep the number.
   */
  step INTEGER NOT NULL DEFAULT 1 CHECK (step >= 1),

  /**
   * When the next thing should happen. WRITTEN BY NOTHING IN THIS BUILD — there
   * is no scheduler and no interval policy. ISO-8601 UTC when it exists,
   * because an instant is what a scheduler compares; which timezone produced it
   * is a question that belongs with the scheduler that answers it.
   */
  next_action_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  /**
   * ONE ATTEMPT PER COACH PER CAMPAIGN.
   *
   * Deliberately NOT unique on outreach_id: one lifetime relationship serves
   * several campaigns, and a uniqueness rule there would stop the second
   * campaign from ever pursuing a coach the first one reached.
   */
  UNIQUE (programme_campaign_id, coach_id)
);

-- The list read: one programme campaign's attempts.
CREATE INDEX IF NOT EXISTS idx_contact_attempts_programme
  ON programme_contact_attempts(programme_campaign_id, created_at, id);
-- The reverse question: which campaigns have pursued this coach.
CREATE INDEX IF NOT EXISTS idx_contact_attempts_coach
  ON programme_contact_attempts(coach_id);
-- Which attempts run through one lifetime relationship, across campaigns.
CREATE INDEX IF NOT EXISTS idx_contact_attempts_outreach
  ON programme_contact_attempts(outreach_id);

-- ===========================================================================
-- ONE ATTEMPT TO HAND A MESSAGE TO A SENDING TRANSPORT.
--
-- THE SECOND SENDING-SAFETY AXIS. `sendCap` protects the RECIPIENT: how often
-- one coach's inbox may be written to, keyed on the recipient address. This
-- protects the other end — the SENDING mailbox's reputation, and the pace at
-- which one athlete consumes campaign capacity. They are different dimensions
-- and neither substitutes for the other:
--
--   sendCap        recipient inbox   keyed on coaches.email    30-day window
--   THIS TABLE     sending mailbox   keyed on sending_identity daily window
--   THIS TABLE     athlete pacing    keyed on athlete_id       daily window
--
-- WHY IT CANNOT BE DERIVED FROM `outreach_send`. Three reasons, each fatal on
-- its own:
--
--   1. A RETRY IS A SECOND ATTEMPT. One message may consume capacity twice,
--      and outreach_send holds one row per message however many times it was
--      handed to a transport.
--   2. A FAILED ATTEMPT STILL CONSUMED CAPACITY. The provider or the network
--      was used either way, and `sent_at` records only successes.
--   3. `sent_at` IS MUTABLE-ADJACENT AND FIRST-WINS. Accounting must not
--      depend on a column whose meaning is "the first confirmation on this
--      relationship".
--
-- SO IT IS ITS OWN LEDGER, AND ITS ROWS ARE IMMUTABLE. A trigger enforces
-- that, following tracking_events and outreach_send_event: what was spent
-- cannot be edited into something else afterwards.
--
-- WHAT IS DELIBERATELY NOT IN IT. No campaign id, no tier, no evidence, no
-- outcome, no counters. Campaign attribution lives on outreach_send, where it
-- is authoritative; putting a second copy here would make this table a place
-- to do campaign analytics, and an accounting ledger that also reports is one
-- that gets a column added to it every quarter.
--
-- No `outcome` column either, and that is the answer to "what if the
-- transport then fails". A row here means ONE THING: an attempt began and
-- capacity was consumed. What became of the message afterwards is already
-- owned by outreach_send.state and outreach_send_event, and an outcome column
-- would have to be written after the fact — which is precisely the mutation
-- the triggers below forbid.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS outbound_send_attempt (
  id TEXT PRIMARY KEY,

  /**
   * The relationship the attempt was made through.
   *
   * NOT `outreach_send_id`, and that is forced by the ordering rather than
   * chosen. Capacity is consumed BEFORE the transport is invoked, and the
   * message row is written AFTER the transport returns — `recordDraft` freezes
   * a snapshot of a body that reached Outlook, so it cannot run first. At the
   * instant this row is written there is no message row to point at, and on a
   * transport failure there never will be one. A send FK would therefore be a
   * column nothing could fill on the path that matters most.
   *
   * The relationship, by contrast, always exists by then — `createOutreach`
   * runs before the transport — and it is also the durable place the athlete
   * is recorded, which is what makes the derivation below trustworthy.
   *
   * ON DELETE SET NULL, which is the one place this table departs from the
   * RESTRICT its neighbours use — and it departs in the direction that keeps
   * the accounting right. THE BUDGET DOES NOT READ THIS COLUMN. Usage is
   * counted on (athlete_id, sending_identity, attempted_at), so a relationship
   * deleted later costs the ledger a pointer and not a single unit of spent
   * capacity. RESTRICT would instead let a stale foreign key veto ordinary
   * housekeeping, and CASCADE would let housekeeping hand back a day's budget.
   * A6 made the same choice for the same reason on programme_campaign_id.
   */
  outreach_id TEXT REFERENCES outreach(id) ON DELETE SET NULL,

  -- DERIVED FROM outreach.athlete_id AT WRITE TIME, never taken from a caller.
  -- Denormalised so the daily-usage query reads one table, following
  -- outreach_send, which denormalises the same pair for the same reason. A
  -- caller may ASSERT an athlete and the assertion is checked against this,
  -- so a wrong id is refused rather than spending someone else's budget.
  --
  -- SET NULL for the same reason as outreach_id, and it is written by nothing
  -- but a delete of that very athlete. An athlete who no longer exists has no
  -- budget to pace, so nothing is lost — while CASCADE would have let deleting
  -- one athlete hand a whole day of MAILBOX capacity back to everybody else,
  -- and RESTRICT would have let this table veto ordinary housekeeping.
  athlete_id TEXT REFERENCES players(id) ON DELETE SET NULL,

  /**
   * WHICH MAILBOX PAID FOR IT.
   *
   * Deliberately not called `email`. Today it is the normalised
   * THRIV3_FROM_ADDRESS, because the Outlook path has exactly one shared
   * sending identity for every athlete — which is the whole reason a
   * per-athlete ceiling is not enough on its own. When Gmail or Graph gives
   * each athlete their own connected mailbox this becomes that account's
   * stable key, and nothing that budgets against it has to change.
   *
   * Stored normalised (trimmed, lowercased) so two spellings of one mailbox
   * cannot each get a full day's allowance.
   */
  sending_identity TEXT NOT NULL,

  /**
   * How the attempt was made, and how we came to know about it.
   *
   *   OUTLOOK_APPLESCRIPT  the process itself issued Outlook's Send. Recorded
   *                        before the call, so it stands whether or not the
   *                        call succeeded.
   *   OUTLOOK_MANUAL       an operator pressed Send in Outlook by hand and
   *                        said so afterwards through `npm run confirm-sends`.
   *                        Recorded late by necessity — see attempted_at.
   *
   * Kept as a column rather than inferred so that mailbox usage assembled from
   * both can still be read apart. They are not equally precise and a future
   * analysis must be able to say so.
   */
  transport TEXT NOT NULL,

  /**
   * WHEN CAPACITY WAS CONSUMED. The instant every window query keys on.
   *
   * For OUTLOOK_APPLESCRIPT this is exact: it is written immediately before
   * the transport call. For OUTLOOK_MANUAL it is the CONFIRMATION time, not
   * the send time, because the send happened inside Outlook's own UI and this
   * process never observed it. That is a real imprecision and it is recorded
   * rather than smoothed over: a batch sent last night and confirmed this
   * morning lands in this morning's window.
   */
  attempted_at TEXT NOT NULL,

  created_at TEXT NOT NULL
);

-- The two usage queries, and nothing else. Both are (key, time) so a day's
-- window is a range scan rather than a table scan.
CREATE INDEX IF NOT EXISTS idx_outbound_attempt_athlete
  ON outbound_send_attempt(athlete_id, attempted_at);
CREATE INDEX IF NOT EXISTS idx_outbound_attempt_mailbox
  ON outbound_send_attempt(sending_identity, attempted_at);
CREATE INDEX IF NOT EXISTS idx_outbound_attempt_outreach
  ON outbound_send_attempt(outreach_id, attempted_at, id);

-- THE ACCOUNTING IS FROZEN; THE POINTERS ARE NOT. What was spent, from which
-- mailbox, by what means and when cannot be edited into something else
-- afterwards — those four plus the row's own id are the trigger's list.
--
-- outreach_id and athlete_id are deliberately absent from it, because their
-- ON DELETE SET NULL is itself an UPDATE: a whole-row guard would turn an
-- ordinary delete elsewhere into a constraint failure, and it would be
-- protecting the two columns the budget never reads. Mailbox usage — the
-- number that protects the sending domain — is untouchable either way.
CREATE TRIGGER IF NOT EXISTS trg_outbound_send_attempt_append_only
BEFORE UPDATE OF id, sending_identity, transport, attempted_at, created_at
ON outbound_send_attempt
BEGIN
  SELECT RAISE(ABORT, 'outbound_send_attempt is append-only');
END;

-- Deletion is NOT blocked, matching tracking_events and outreach_send_event.
-- A guard there would stop retention purges and ordinary housekeeping while
-- stopping nobody with a SQL prompt; what actually protects the accounting is
-- that server/lib/outboundBudget.js exports no delete, no decrement and no
-- refund, which a test asserts.
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

-- ---------------------------------------------------------------------------
-- OPERATOR ACCESS — Phase 13K.
--
-- The internal application had no authentication, deliberately: one operator,
-- one machine, loopback-bound. Hosting it changes that, and nothing else about
-- the delivery model changes with it. Two tables and no more: there are no
-- roles, no client accounts and no permissions hierarchy in V1, because every
-- authenticated account is a Thriv3 operator with the same reach.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operator_users (
  id TEXT PRIMARY KEY,
  -- Stored lowercased; the unique index below is what makes "one account per
  -- person" true rather than merely intended.
  email TEXT NOT NULL,
  -- scrypt, in a self-describing string that carries its own parameters, so a
  -- future work-factor increase can re-hash on next sign-in without guessing
  -- how an old hash was made. Never a plaintext password, never reversible.
  password_hash TEXT NOT NULL,
  -- Revocation without deletion: a deactivated account keeps its history
  -- attribution but cannot sign in, and its live sessions are dropped.
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_users_email
  ON operator_users(email);

-- Server-side sessions. The cookie carries an opaque random token and nothing
-- else — no identity, no claims, no expiry the client could edit — so signing
-- out is a delete here rather than a request the browser is trusted to honour.
CREATE TABLE IF NOT EXISTS operator_sessions (
  -- THE TOKEN IS NOT STORED. Only its SHA-256, so a database dump — or a
  -- backup on somebody's laptop — does not hand over live sessions.
  token_sha256 TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  -- The idle deadline, pushed forward on use but never past
  -- created_at + the absolute lifetime.
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  -- Recorded for the login log, not for enforcement: pinning a session to an
  -- IP breaks a laptop that moves between networks, which is the normal case
  -- for the person this tool is for.
  created_ip TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES operator_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_user
  ON operator_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_expiry
  ON operator_sessions(expires_at);

-- ===========================================================================
-- A MAILBOX THIS APPLICATION MAY SEND THROUGH — Phase D2.
--
-- The athlete's own account at Google or Microsoft, authorised by the athlete
-- and operated by Thriv3. Sending from the client's own mailbox rather than an
-- agency address is a decision the roadmap made and gave two reasons for: an
-- ESP pools every client's list reputation into one domain, and a
-- recruiting-service From address is pattern-matched and binned by coaches who
-- have been trained for a decade to ignore exactly that.
--
-- NOTHING HERE CONNECTS A MAILBOX. There is no OAuth in this build — no
-- consent link, no callback, no Google, no Microsoft, no transport. What exists
-- is the place a verified identity and its credential will live, built first
-- and on its own so that the security properties are settled before anything
-- can create a row.
--
-- ---------------------------------------------------------------------------
-- THE IDENTITY IS THE PROVIDER'S, NEVER THE CALLER'S.
--
-- `provider_account_id` is the immutable subject the provider issues — Google's
-- `sub`, Microsoft's `oid` — read from a verified ID token at consent and never
-- afterwards from a request. `email_address` is read from the same place.
--
-- That is what closes the hole B5 records in its own comment: today the send
-- path charges the budget to the address it ASKED to send from, while New
-- Outlook may silently send from a different account. When the sending
-- identity comes from the provider rather than from a parameter, a caller
-- cannot spend one mailbox's reputation while sending through another. B5 is
-- not wired to this yet — see the note on email_address.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS connected_mailboxes (
  id TEXT PRIMARY KEY,

  /**
   * WHO OPERATES IT. Row-level ownership, kept even though go-live has one
   * operator: "there is only one user" is a fact about today's data, not an
   * authorisation rule, and a service layer that relies on it is one signup
   * away from being wrong. Every read in connectedMailboxes.js is scoped by
   * this column.
   *
   * CASCADE because a mailbox has no meaning without the account that connected
   * it, and because deactivating an operator must not leave live credentials
   * addressable by nobody.
   */
  operator_user_id TEXT NOT NULL REFERENCES operator_users(id) ON DELETE CASCADE,

  /**
   * WHOSE MAILBOX IT IS. Nullable, and the nullability is a judgement rather
   * than indecision.
   *
   * Every mailbox D3 creates will carry an athlete: the consent link is issued
   * for one, so the athlete is known before the provider identity is. But the
   * product may also connect a Thriv3-operated sending address, and a column
   * that forbids one would make that a migration rather than a row.
   *
   * NO ON DELETE CLAUSE, so a delete is refused. Athletes are ARCHIVED in this
   * product, never deleted — `athleteLifecycle.js` sets `archived_at` and the
   * purge removes tracking data while leaving the row — so this costs nothing
   * operationally and says the important thing: a player row may not be removed
   * out from under a live credential that can still send mail in their name.
   * Revoke the mailbox first, which destroys the credential; then the athlete
   * is free to go.
   */
  athlete_id TEXT REFERENCES players(id),

  -- Reserved for both, implemented for neither. A CHECK rather than a comment
  -- so a third provider is a schema decision somebody makes on purpose.
  provider TEXT NOT NULL CHECK (provider IN ('GOOGLE', 'MICROSOFT')),

  /** The provider's own immutable id for the account. THE identity. */
  provider_account_id TEXT NOT NULL,

  /**
   * The verified address, normalised lowercase.
   *
   * THE FUTURE SOURCE OF B5's `sending_identity`, and deliberately not wired to
   * it yet. B5 budgets on a normalised address string and will keep doing so;
   * what changes in a later phase is that callers name a MAILBOX and the
   * address is looked up here, instead of naming an address. Doing that now
   * would change execution behaviour in a slice that has no provider to send
   * through.
   *
   * NOT UNIQUE, and that is considered. One person's alias can resolve to the
   * same address as another account, an address can be reassigned inside an
   * organisation, and a reconnection after revocation legitimately produces a
   * second row with the same address. Identity is the provider account; the
   * address is an attribute of it. Two live mailboxes sharing an address share
   * one budget under B5, which is the correct accounting either way.
   */
  email_address TEXT NOT NULL,
  display_name TEXT,

  /**
   * ADMINISTRATIVE TRUTH, NOT OBSERVED HEALTH.
   *
   *   CONNECTED             a verified provider identity and a stored credential
   *   NEEDS_RECONSENT       the provider refused the credential; a person must act
   *   REVOKED               withdrawn here or at the provider; credential destroyed
   *   UNHEALTHY_TEMPORARY   repeated transient provider failures
   *
   * `CONNECTED` does not claim the provider will accept the next request. This
   * build cannot know that — there is no transport — and a status that implied
   * it would be the "fake healthy" this vocabulary was chosen to avoid. What it
   * claims is exactly what it can: an identity we verified, and a credential we
   * hold.
   */
  status TEXT NOT NULL CHECK (status IN (
    'CONNECTED', 'NEEDS_RECONSENT', 'REVOKED', 'UNHEALTHY_TEMPORARY'
  )),

  -- JSON array of the scopes actually granted, as the provider reported them.
  -- Recorded rather than assumed: a consent screen where the user unticks one
  -- is a mailbox that cannot do what we think it can.
  scopes TEXT,

  connected_at TEXT NOT NULL,
  /** When a provider call last actually succeeded. Null until one does — an
   *  unused mailbox is unverified, not healthy. */
  last_verified_at TEXT,
  revoked_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  /**
   * ONE PROVIDER ACCOUNT, ONE ROW, GLOBALLY.
   *
   * Not scoped to the operator: the constraint is protecting a real mailbox at
   * Google, not a record. Two rows for one account would budget the same
   * inbox's daily sending twice under B5 and split its reputation history in
   * half — the failure being prevented is in the world, not in the table.
   */
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_connected_mailboxes_operator
  ON connected_mailboxes(operator_user_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_connected_mailboxes_athlete
  ON connected_mailboxes(athlete_id);
-- The lookup a future send path makes: which mailbox is this address?
CREATE INDEX IF NOT EXISTS idx_connected_mailboxes_email
  ON connected_mailboxes(email_address);

-- ===========================================================================
-- THE CREDENTIAL, AND THE ONLY ENCRYPTED THING IN THIS DATABASE.
--
-- A refresh token is not like the other secrets here. A session secret signs
-- cookies we issued; a sync secret authenticates our own edge. This lets the
-- bearer send mail as somebody else, from an address a coach trusts, until the
-- athlete revokes it — and they will not think to.
--
-- A SEPARATE TABLE, so that no join reaches it by accident. Every read of a
-- mailbox goes through `connected_mailboxes`; the ciphertext is fetched only by
-- the one internal function that is about to decrypt it, and the public
-- projection cannot express these columns because it never sees this row.
--
-- WHAT IS NOT STORED, EVER: a plaintext refresh token, an access token, a
-- password, an OAuth authorization code. Access tokens are minutes-lived and
-- belong in memory; storing one buys nothing and doubles the blast radius.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS connected_mailbox_credentials (
  /**
   * ONE CREDENTIAL PER MAILBOX, enforced by the primary key rather than by a
   * convention somebody has to maintain. Replacing a credential is an UPDATE
   * of this row, so a rotation cannot leave the old ciphertext behind.
   *
   * CASCADE: if a mailbox row ever is deleted, the credential goes with it.
   * Revocation does not take that path — it deletes this row and keeps the
   * mailbox for attribution — but a delete that left an orphaned encrypted
   * token addressable by nothing is worse than either.
   */
  mailbox_id TEXT PRIMARY KEY REFERENCES connected_mailboxes(id) ON DELETE CASCADE,

  -- AES-256-GCM, base64. The mailbox id and key version are bound in as AAD,
  -- so a ciphertext moved to another mailbox's row fails to authenticate
  -- rather than decrypting into a working credential for the wrong person.
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,          -- 96-bit, random per write, never reused
  auth_tag TEXT NOT NULL,

  /**
   * Which key encrypted this row. One key exists; the column is what makes a
   * second one a config change rather than a migration and a re-encryption of
   * every row. An unknown version is refused, never guessed.
   */
  key_version INTEGER NOT NULL,

  rotated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
