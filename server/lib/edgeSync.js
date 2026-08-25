import db from '../db/client.js';
import { suppress } from './suppressions.js';
import { utcNow } from './time.js';
import { EDGE_BASE_URL, SYNC_SECRET } from './config.js';
import { scheduleRollup, rebuildRollup } from './engagementRollup.js';

/**
 * Moves data between the local database and the edge collector.
 *
 * Two directions, each carrying as little as possible:
 *   up   — which opaque tokens are live, so the edge can reject the rest
 *   down — raw events, which are resolved to a coach here and only here
 *
 * Coach and athlete identity never leave this machine. The edge holds tokens
 * and event counters; the join that turns those into "Coach Whitfield watched
 * 95% of the reel" exists nowhere else.
 */

const CURSOR_KEY = 'edge_events_cursor';

function readState(key) {
  return db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key)?.value ?? null;
}

function writeState(key, value) {
  db.prepare(`
    INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), utcNow());
}

export function isEdgeConfigured() {
  return Boolean(EDGE_BASE_URL && SYNC_SECRET);
}

function requireEdge() {
  if (!EDGE_BASE_URL) throw new Error('THRIV3_EDGE_URL is not set');
  if (!SYNC_SECRET) throw new Error('THRIV3_SYNC_SECRET is not set');
}

async function edgeFetch(path, options = {}) {
  const res = await fetch(`${EDGE_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${SYNC_SECRET}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Edge ${path} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Compares what the edge says it holds against what we just sent it.
 *
 * A reconciling push rewrites the whole allowlist, so afterwards the two
 * counts must agree exactly. They did not on 2026-08-20: the edge had been
 * emptied, every tracked link served the neutral "profile unavailable" page,
 * and nothing surfaced it because the push only ever reported what it sent,
 * never what arrived. Older deployments omit `liveAtEdge` entirely — treat
 * that as unknown rather than as a mismatch, so a stale worker does not cry
 * wolf.
 */
function checkLanded(expectedLive, reported) {
  if (typeof reported !== 'number') return { liveAtEdge: null, mismatch: false };
  return { liveAtEdge: reported, mismatch: reported !== expectedLive };
}

/**
 * Pushes the current token allowlist up.
 *
 * This is what makes revocation bite at the edge: a deactivated athlete's
 * tokens go up marked revoked, and the collector stops accepting them.
 */
export async function pushTokens() {
  requireEdge();
  const tokens = db.prepare('SELECT token, revoked_at FROM outreach').all()
    .map((row) => ({ token: row.token, revoked: row.revoked_at ? 1 : 0 }));
  const expectedLive = tokens.filter((t) => !t.revoked).length;

  if (tokens.length === 0) {
    // Nothing live locally means everything at the edge should be revoked.
    const cleared = await edgeFetch('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ tokens: [], reconcile: true }),
    });
    writeState('tokens_pushed_at', utcNow());
    return {
      pushed: 0,
      revokedMissing: cleared.revokedMissing ?? 0,
      ...checkLanded(0, cleared.liveAtEdge),
    };
  }

  // reconcile: anything the edge holds that we no longer have is revoked
  // there. Deleting outreach locally has to take the link down, not merely
  // stop mentioning it.
  const result = await edgeFetch('/api/tokens', {
    method: 'POST',
    body: JSON.stringify({ tokens, reconcile: true }),
  });
  writeState('tokens_pushed_at', utcNow());
  return {
    pushed: result.synced ?? tokens.length,
    revokedMissing: result.revokedMissing ?? 0,
    expectedLive,
    ...checkLanded(expectedLive, result.liveAtEdge),
  };
}

const insertEvent = db.prepare(`
  INSERT INTO tracking_events
    (remote_id, token, outreach_id, session_id, event_type, coverage_pct, watched_seconds,
     duration_seconds, dwell_seconds, rewinds, skips, payload, created_at)
  VALUES
    (@remote_id, @token, @outreach_id, @session_id, @event_type, @coverage_pct, @watched_seconds,
     @duration_seconds, @dwell_seconds, @rewinds, @skips, @payload, @created_at)
  ON CONFLICT(remote_id) DO NOTHING
`);

const resolveToken = db.prepare(`
  SELECT o.id FROM outreach o
  JOIN players p ON p.id = o.athlete_id
  WHERE o.token = ? AND p.archived_at IS NULL
`);

/**
 * Pulls new events down and resolves each token to its outreach row.
 *
 * Idempotent on the edge's own row id, so re-running cannot duplicate. Events
 * whose token no longer resolves — a purged athlete, a token that never
 * existed — are counted and dropped rather than stored unattributed.
 */
export async function pullEvents({ maxBatches = 20 } = {}) {
  requireEdge();

  let cursor = Number(readState(CURSOR_KEY) || 0);
  let inserted = 0;
  let unresolved = 0;
  let fetched = 0;
  const touched = new Set();

  for (let batch = 0; batch < maxBatches; batch++) {
    const page = await edgeFetch(`/api/events?since=${cursor}&limit=500`);
    if (!page.events.length) break;
    fetched += page.events.length;

    db.transaction(() => {
      for (const event of page.events) {
        const outreach = resolveToken.get(event.token);
        if (!outreach) {
          unresolved++;
          continue;
        }
        const result = insertEvent.run({
          remote_id: event.id,
          token: event.token,
          outreach_id: outreach.id,
          session_id: event.session_id,
          event_type: event.event_type,
          coverage_pct: event.coverage_pct,
          watched_seconds: event.watched_seconds,
          duration_seconds: event.duration_seconds,
          dwell_seconds: event.dwell_seconds,
          rewinds: event.rewinds,
          skips: event.skips,
          payload: event.payload,
          created_at: event.created_at,
        });
        if (result.changes > 0) inserted++;
        touched.add(outreach.id);
      }
      cursor = page.cursor;
      writeState(CURSOR_KEY, cursor);
    })();

    if (!page.more) break;
  }

  for (const outreachId of touched) rebuildRollup(outreachId);

  return { fetched, inserted, unresolved, cursor, rollups: touched.size };
}

/** Both directions, in the order that matters: tokens up, then events down. */
/**
 * Pulls opt-outs down and resolves them to addresses.
 *
 * The edge records a token, because it does not know any coach's email and
 * must not learn one. Resolving token -> outreach -> coach happens here, on
 * the machine that already holds both. A token whose outreach has since been
 * deleted is skipped rather than guessed at, and reported so it is not
 * silently lost — an opt-out we cannot attribute is still an opt-out somebody
 * made.
 */
export async function pullSuppressions() {
  const res = await edgeFetch('/api/suppressions');
  const rows = res?.suppressions || [];
  let added = 0;
  let already = 0;
  const unresolved = [];

  for (const row of rows) {
    const link = db
      .prepare('SELECT o.token, c.email FROM outreach o JOIN coaches c ON c.id = o.coach_id WHERE o.token = ?')
      .get(row.token);
    if (!link?.email) { unresolved.push(row.token); continue; }
    const result = suppress({
      email: link.email,
      reason: 'unsubscribed',
      source: 'edge',
      outreachToken: row.token,
      // The edge's timestamp, not now: when they asked is the fact that
      // matters if anybody ever checks how quickly it was honoured.
      note: `opted out at ${row.created_at}`,
    });
    if (result.alreadySuppressed) already++; else added++;
  }
  return { pulled: rows.length, added, already, unresolved };
}

export async function syncWithEdge() {
  const tokens = await pushTokens();
  const events = await pullEvents();
  // After the token push, so an address suppressed on this run has its link
  // revoked locally too rather than waiting a further cycle.
  const suppressions = await pullSuppressions();
  return { tokens, events, suppressions, syncedAt: utcNow() };
}

export function lastSyncedAt() {
  return readState('tokens_pushed_at');
}
