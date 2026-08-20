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
