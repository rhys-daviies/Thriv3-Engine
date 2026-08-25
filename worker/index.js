import { MAX_PAYLOAD_BYTES, parseEventBody } from '../shared/trackingEvents.js';
import { createRateLimiter } from '../shared/rateLimit.js';
import { renderRevokedPage } from '../shared/revokedPage.js';
import {
  renderUnsubscribeConfirm, renderUnsubscribeDone,
  renderUnsubscribeUnknown, renderPrivacyNotice,
} from '../shared/compliancePages.js';

/**
 * Thriv3 edge event collector.
 *
 * The same contract as the local Express collector, because both import
 * shared/trackingEvents.js — that module was written with no Node, Express or
 * D1 dependencies precisely so this port needed no reimplementation of the
 * payload rules.
 *
 * What this Worker deliberately does not know: which coach a token belongs to,
 * or which athlete. It stores opaque tokens. Attribution happens on the local
 * machine at sync time, so coach identity is never published.
 */

const PER_IP = createRateLimiter({ limit: 240, windowMs: 60_000 });
const PER_TOKEN = createRateLimiter({ limit: 120, windowMs: 60_000 });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
};

const noContent = () => new Response(null, { status: 204, headers: CORS });
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time-ish comparison, so a wrong secret leaks nothing by timing. */
function secretMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function authorised(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return Boolean(env.THRIV3_SYNC_SECRET) && secretMatches(token, env.THRIV3_SYNC_SECRET);
}

/**
 * POST /api/track — public, unauthenticated.
 *
 * Answers 204 for everything except rate limiting: a valid event, an unknown
 * token, a revoked token, malformed JSON, an oversized body. Telling them
 * apart would make this an enumeration oracle for which tokens exist.
 */
async function collect(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!PER_IP.check(ip)) return new Response(null, { status: 429, headers: CORS });

  const raw = await request.text();
  if (raw.length > MAX_PAYLOAD_BYTES) return noContent();

  const parsed = parseEventBody(raw);
  if (!parsed.ok) return noContent();

  const event = parsed.value;
  if (!PER_TOKEN.check(event.token)) return new Response(null, { status: 429, headers: CORS });

  const known = await env.DB
    .prepare('SELECT 1 FROM outreach_tokens WHERE token = ? AND revoked = 0')
    .bind(event.token)
    .first();
  if (!known) return noContent();

  // created_at is stamped here, never taken from the client — its clock
  // belongs to a stranger's laptop.
  await env.DB.prepare(`
    INSERT INTO tracking_events
      (token, session_id, event_type, coverage_pct, watched_seconds, duration_seconds,
       dwell_seconds, rewinds, skips, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    event.token, event.session_id, event.event_type, event.coverage_pct,
    event.watched_seconds, event.duration_seconds, event.dwell_seconds,
    event.rewinds, event.skips, event.payload, new Date().toISOString()
  ).run();

  return noContent();
}

/** GET /api/events?since=<id>&limit=<n> — authed. The local app pulls from here. */
async function drain(request, env) {
  if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);

  const url = new URL(request.url);
  const since = Number(url.searchParams.get('since') || 0);
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 500)));

  const { results } = await env.DB
    .prepare('SELECT * FROM tracking_events WHERE id > ? ORDER BY id LIMIT ?')
    .bind(Number.isFinite(since) ? since : 0, limit)
    .all();

  return json({
    events: results,
    cursor: results.length ? results[results.length - 1].id : since,
    more: results.length === limit,
  });
}

/**
 * POST /api/tokens — authed. The local app pushes which tokens are live.
 *
 * This is what lets revocation take effect at the edge: a deactivated athlete's
 * tokens are marked revoked here, and the collector stops accepting them.
 */
async function syncTokens(request, env) {
  if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.tokens)) return json({ error: 'expected { tokens: [] }' }, 400);

  const now = new Date().toISOString();
  const live = body.tokens.filter((t) => t && typeof t.token === 'string');

  const statements = live.map((t) => env.DB
    .prepare(`
      INSERT INTO outreach_tokens (token, revoked, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET revoked = excluded.revoked, updated_at = excluded.updated_at
    `)
    .bind(t.token, t.revoked ? 1 : 0, now));

  if (statements.length) await env.DB.batch(statements);

  // The local database is the source of truth for which links exist at all.
  // Without this, deleting outreach locally would leave its token accepted
  // here forever — the push would simply stop mentioning it. json_each keeps
  // this to one statement regardless of how many tokens there are.
  let revoked = 0;
  if (body.reconcile) {
    const result = await env.DB
      .prepare(`
        UPDATE outreach_tokens SET revoked = 1, updated_at = ?
        WHERE revoked = 0 AND token NOT IN (SELECT value FROM json_each(?))
      `)
      .bind(now, JSON.stringify(live.map((t) => t.token)))
      .run();
    revoked = result.meta?.changes ?? 0;
  }

  // Reported back so the local app can prove the push actually landed. The
  // edge is the one piece of state nobody looks at, and on 2026-08-20 it was
  // emptied without anything noticing for four days: every link in the wild
  // served the neutral page while the local database still listed 18 live
  // tokens. A count in the response makes that failure loud on the next sync.
  const liveAtEdge = (await env.DB
    .prepare('SELECT count(*) AS n FROM outreach_tokens WHERE revoked = 0')
    .first())?.n ?? 0;

  return json({ synced: statements.length, revokedMissing: revoked, liveAtEdge });
}

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/**
 * Records an opt-out and revokes the link in the same statement batch.
 *
 * Revoking here matters: the local sync might not run for days, and until it
 * does this is the only place that knows. A coach who unsubscribes and then
 * finds their link still works has been told one thing and shown another.
 */
async function unsubscribe(request, env, token) {
  const known = await env.DB.prepare('SELECT token FROM outreach_tokens WHERE token = ?').bind(token).first();
  if (!known) return html(renderUnsubscribeUnknown(), 200);

  // GET only ever shows the confirmation. Mail security gateways follow links
  // in messages to scan them, and a GET that opted people out would
  // unsubscribe every recipient behind such a gateway without them ever
  // seeing the page.
  if (request.method !== 'POST') {
    return html(renderUnsubscribeConfirm({ actionPath: `/u/${encodeURIComponent(token)}` }));
  }

  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO suppressions (token, created_at) VALUES (?, ?)')
      .bind(token, new Date().toISOString()),
    env.DB.prepare('UPDATE outreach_tokens SET revoked = 1, updated_at = ? WHERE token = ?')
      .bind(new Date().toISOString(), token),
  ]);
  return html(renderUnsubscribeDone());
}

/** Authed drain of opt-outs, so the local machine can resolve them to addresses. */
async function drainSuppressions(request, env) {
  if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);
  const { results } = await env.DB.prepare(
    'SELECT token, created_at FROM suppressions ORDER BY created_at'
  ).all();
  return json({ suppressions: results || [] });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname === '/api/track') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method === 'POST' && url.pathname === '/api/track') {
      return collect(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      return drain(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/tokens') {
      return syncTokens(request, env);
    }
    // Opt-out. GET shows a confirmation; only POST records anything.
    if (url.pathname.startsWith('/u/')) {
      const token = decodeURIComponent(url.pathname.slice(3));
      if (!token) return html(renderUnsubscribeUnknown(), 200);
      return unsubscribe(request, env, token);
    }
    if (request.method === 'GET' && url.pathname === '/api/suppressions') {
      return drainSuppressions(request, env);
    }
    // Public, unauthed, and linked from both the profile footer and every
    // email — a notice nobody can reach is not a notice.
    if (url.pathname === '/privacy') {
      return html(renderPrivacyNotice({
        senderIdentity: env.THRIV3_SENDER_IDENTITY,
        postalAddress: env.THRIV3_POSTAL_ADDRESS,
        contactEmail: env.THRIV3_CONTACT_EMAIL,
      }));
    }
    if (url.pathname === '/api/health') {
      // Unauthed callers get liveness and nothing else — counts would leak how
      // much outreach is in flight. Authed callers get the state the local app
      // cannot see any other way, which is the whole reason the 2026-08-20
      // wipe went unnoticed: there was no way to ask the edge how it was doing
      // short of opening a link and reading the page.
      if (!authorised(request, env)) return json({ ok: true });

      const row = await env.DB.prepare(`
        SELECT
          (SELECT count(*) FROM outreach_tokens WHERE revoked = 0) AS liveTokens,
          (SELECT count(*) FROM outreach_tokens WHERE revoked = 1) AS revokedTokens,
          (SELECT count(*) FROM tracking_events)                   AS events,
          (SELECT coalesce(max(id), 0) FROM tracking_events)       AS maxEventId,
          (SELECT coalesce(seq, 0) FROM sqlite_sequence
            WHERE name = 'tracking_events')                        AS eventSequence,
          (SELECT deletes_unlocked_until FROM edge_guard WHERE id = 1) AS guardUnlockedUntil
      `).first();

      // The high-water mark, not the row count: deleted rows keep their ids,
      // and a local cursor above this is the shape that silently swallows the
      // first events of a run.
      return json({ ok: true, ...row, deletesLocked: !row?.guardUnlockedUntil });
    }

    // Profile pages are gated on the link still being live, exactly as the
    // local server gates them. A revoked link has to read as deliberate —
    // brief §7 wants a neutral page, not a 404 and not the profile. Every
    // refusal returns the same 200 and the same body, so responses cannot be
    // used to work out which slugs exist.
    if (url.pathname.startsWith('/p/')) {
      const neutral = () => new Response(renderRevokedPage(), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });

      const ref = url.searchParams.get('ref');
      if (ref !== null) {
        const live = await env.DB
          .prepare('SELECT 1 FROM outreach_tokens WHERE token = ? AND revoked = 0')
          .bind(ref)
          .first();
        if (!live) return neutral();
      }

      const asset = await env.ASSETS.fetch(request);
      return asset.status === 404 ? neutral() : asset;
    }

    // Everything else is a static asset from the Pages build — the generated
    // athlete pages and robots.txt. Serving both from one origin means the
    // tracker posts to a same-origin /api/track and CORS never enters into it.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
