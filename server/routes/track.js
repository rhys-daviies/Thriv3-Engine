import express from 'express';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { MAX_PAYLOAD_BYTES, parseEventBody } from '../../shared/trackingEvents.js';

/**
 * Public event collector — brief §9 rule 7.
 *
 * Every outcome that is not rate limiting answers 204 with an empty body:
 * a valid event, an unknown token, a revoked token, malformed JSON, an
 * oversized body. Distinguishing them would turn this endpoint into an
 * enumeration oracle that tells an attacker which tokens exist.
 *
 * The only visible difference is a row in tracking_events, which the caller
 * cannot see.
 */

// Generous enough for a real session (a 4-minute watch emits roughly a dozen
// events), tight enough that a scraper achieves nothing.
const PER_IP = createRateLimiter({ limit: 240, windowMs: 60_000 });
const PER_TOKEN = createRateLimiter({ limit: 120, windowMs: 60_000 });

const ALLOWED_ORIGIN = process.env.THRIV3_ALLOWED_ORIGIN || '*';

const insertEvent = db.prepare(`
  INSERT INTO tracking_events
    (token, outreach_id, session_id, event_type, coverage_pct, watched_seconds,
     duration_seconds, dwell_seconds, rewinds, skips, payload, created_at)
  VALUES
    (@token, @outreach_id, @session_id, @event_type, @coverage_pct, @watched_seconds,
     @duration_seconds, @dwell_seconds, @rewinds, @skips, @payload, @created_at)
`);

// Resolved at write time. A revoked token, or one whose athlete has been
// archived, resolves to nothing and the event is dropped.
const resolveOutreach = db.prepare(`
  SELECT o.id FROM outreach o
  JOIN players p ON p.id = o.athlete_id
  WHERE o.token = ? AND o.revoked_at IS NULL AND p.archived_at IS NULL
`);

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

export const trackRouter = express.Router();

// navigator.sendBeacon takes its Content-Type from the Blob and cannot set
// headers, so the body may arrive as application/json, text/plain, or with no
// type at all. Take the bytes whatever the label says and parse them here.
const rawBody = express.text({ type: () => true, limit: MAX_PAYLOAD_BYTES });

trackRouter.options('/track', (req, res) => {
  applyCors(res);
  res.status(204).end();
});

trackRouter.post('/track', rawBody, (req, res) => {
  applyCors(res);

  const ip = req.ip || req.socket?.remoteAddress || null;
  if (!PER_IP.check(ip)) return res.status(429).end();

  const parsed = parseEventBody(req.body);
  if (!parsed.ok) return res.status(204).end();

  const event = parsed.value;
  if (!PER_TOKEN.check(event.token)) return res.status(429).end();

  const outreach = resolveOutreach.get(event.token);
  if (!outreach) return res.status(204).end(); // unknown or revoked — no row, no hint

  insertEvent.run({ ...event, outreach_id: outreach.id, created_at: utcNow() });
  return res.status(204).end();
});

// A body over the parser's limit raises before the handler runs. Answer it the
// same silent 204 as everything else rather than letting Express reply 413.
trackRouter.use('/track', (err, req, res, next) => {
  if (!err) return next();
  applyCors(res);
  res.status(204).end();
});

/** Exposed for tests, which need a clean window per case. */
export function resetTrackRateLimits() {
  PER_IP.reset();
  PER_TOKEN.reset();
}
