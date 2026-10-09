/**
 * A DISPOSABLE CORRECTION COPY IS NEVER SERVED — Phase DI-03H (DI-03G MAJOR-A).
 *
 * The correction engine (server/lib/refresh/correctionTarget.js) treats a database carrying the
 * disposable marker as a scratch copy: it accepts an operator-named activation-holds file and the
 * public-seed rehearsal reviewer. That is safe only if no application ever SERVES such a database —
 * otherwise a copy a dev server or agent is actually running against would be corrected under
 * rehearsal rules. So the shared database-opening path (db/client.js) refuses any database that
 * carries the marker, before it reads application data, changes the journal mode, runs schema.sql
 * or migrates. There is no override: a disposable copy is opened only by the correction tools,
 * which use their own explicit `--db` handles.
 */
export const DISPOSABLE_MARKER_TABLE = 'correction_disposable_marker';

/** Does this open handle carry the disposable marker? Unreadable catalogue -> treated as marked (fail closed). */
export function carriesDisposableMarker(db) {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(DISPOSABLE_MARKER_TABLE);
  } catch { return true; }
}

/** Close the handle and throw if it carries the marker. */
export function refuseDisposableDatabase(db, label) {
  if (!carriesDisposableMarker(db)) return;
  try { db.close(); } catch { /* already closed */ }
  throw new Error(`Refusing to serve ${label}: it carries the disposable correction marker (${DISPOSABLE_MARKER_TABLE}) — `
    + 'it is a correction rehearsal copy, never an application database. Point RECRUITMATCH_DB at a real database.');
}
