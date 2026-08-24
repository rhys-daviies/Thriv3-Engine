-- D1 schema for the edge collector.
--
-- Mirrors the local tracking_events table with one deliberate difference: no
-- outreach_id. The Worker never learns which coach a token belongs to — that
-- resolution happens on the local machine during sync, so coach identity is
-- never published to the edge.

CREATE TABLE IF NOT EXISTS tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  coverage_pct INTEGER,
  watched_seconds INTEGER,
  duration_seconds INTEGER,
  dwell_seconds INTEGER,
  rewinds INTEGER,
  skips INTEGER,
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracking_created ON tracking_events(created_at);
CREATE INDEX IF NOT EXISTS idx_tracking_session ON tracking_events(session_id);

-- Append-only here too, so the guarantee holds on both sides of the wire.
CREATE TRIGGER IF NOT EXISTS trg_tracking_events_append_only
BEFORE UPDATE ON tracking_events
BEGIN
  SELECT RAISE(ABORT, 'tracking_events is append-only');
END;

-- Which tokens the edge should accept. Pushed up from the local app so an
-- unknown or revoked token can be rejected at the edge without a row being
-- written. Carries no athlete or coach identity — just the opaque token.
CREATE TABLE IF NOT EXISTS outreach_tokens (
  token TEXT PRIMARY KEY,
  revoked INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Delete guard.
--
-- The append-only triggers above only cover UPDATE, and on 2026-08-20 both
-- tables were emptied by hand — the tokens went with them, so every tracked
-- link in the wild served the neutral page for four days before anyone
-- looked. Nothing in the application deletes from either table, so casual
-- deletion should be impossible.
--
-- A flat ABORT would be wrong, though: edge events genuinely need pruning
-- once they have been pulled down, and local retention already deletes its
-- own copies. So deletion stays possible and becomes deliberate — unlock,
-- delete, and the window closes on its own if you forget to re-lock.
--
--   npx wrangler d1 execute thriv3-engagement --remote \
--     --command "UPDATE edge_guard SET deletes_unlocked_until = datetime('now', '+10 minutes') WHERE id = 1"
--   ...delete...
--   npx wrangler d1 execute thriv3-engagement --remote \
--     --command "UPDATE edge_guard SET deletes_unlocked_until = NULL WHERE id = 1"
CREATE TABLE IF NOT EXISTS edge_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  deletes_unlocked_until TEXT
);

INSERT OR IGNORE INTO edge_guard (id, deletes_unlocked_until) VALUES (1, NULL);

-- datetime() on both sides so the stored value can be written in any form
-- SQLite understands, rather than only the one that string-compares correctly.
CREATE TRIGGER IF NOT EXISTS trg_tracking_events_no_delete
BEFORE DELETE ON tracking_events
WHEN NOT EXISTS (
  SELECT 1 FROM edge_guard
  WHERE id = 1
    AND deletes_unlocked_until IS NOT NULL
    AND datetime('now') < datetime(deletes_unlocked_until)
)
BEGIN
  SELECT RAISE(ABORT, 'tracking_events deletes are locked — unlock edge_guard first');
END;

CREATE TRIGGER IF NOT EXISTS trg_outreach_tokens_no_delete
BEFORE DELETE ON outreach_tokens
WHEN NOT EXISTS (
  SELECT 1 FROM edge_guard
  WHERE id = 1
    AND deletes_unlocked_until IS NOT NULL
    AND datetime('now') < datetime(deletes_unlocked_until)
)
BEGIN
  SELECT RAISE(ABORT, 'outreach_tokens deletes are locked — unlock edge_guard first');
END;
