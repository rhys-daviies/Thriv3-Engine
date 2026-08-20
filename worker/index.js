import { MAX_PAYLOAD_BYTES, parseEventBody } from '../shared/trackingEvents.js';
import { createRateLimiter } from '../shared/rateLimit.js';

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
  const statements = body.tokens
    .filter((t) => t && typeof t.token === 'string')
    .map((t) => env.DB
      .prepare(`
        INSERT INTO outreach_tokens (token, revoked, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(token) DO UPDATE SET revoked = excluded.revoked, updated_at = excluded.updated_at
      `)
      .bind(t.token, t.revoked ? 1 : 0, now));

  if (statements.length) await env.DB.batch(statements);
  return json({ synced: statements.length });
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
    if (url.pathname === '/api/health') {
      return json({ ok: true });
    }

    // Everything else is a static asset from the Pages build — the generated
    // athlete pages and robots.txt. Serving both from one origin means the
    // tracker posts to a same-origin /api/track and CORS never enters into it.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
