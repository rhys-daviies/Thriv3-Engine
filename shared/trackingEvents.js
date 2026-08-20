/**
 * The tracking event payload contract — defined once, here.
 *
 * This module is imported by the Express collector today and by the
 * Cloudflare Worker when the collector moves there. It therefore depends on
 * nothing beyond standard JavaScript: no Node built-ins, no Express, no D1.
 * If the two ends of the wire ever disagree about this shape, they disagree
 * because someone changed it here, not because one of them drifted.
 *
 * Brief §8 defines the vocabulary; §9 rule 7 requires the collector to
 * validate and to stay silent about what it rejects.
 */

/** The complete event vocabulary. The client emits exactly these. */
export const EVENT_TYPES = Object.freeze([
  'visit_start',
  'visit_qualified',
  'play_start',
  'coverage_10',
  'coverage_25',
  'coverage_50',
  'coverage_75',
  'coverage_95',
  'chapter_jump',
  'pause',
  'ended',
  'session_end',
]);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);

/** Events that count as engagement. visit_start deliberately does not. */
export const QUALIFYING_EVENT = 'visit_qualified';

/** Opaque outreach tokens: 32 characters of base62, nothing else. */
export const TOKEN_PATTERN = /^[A-Za-z0-9]{32}$/;

/** A session id is a UUID from crypto.randomUUID, or the tracker's fallback. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Hard cap on a single request body. A real event is a few hundred bytes. */
export const MAX_PAYLOAD_BYTES = 4096;

/** Counter fields are bounded so a malformed client cannot poison the rollup. */
const LIMITS = {
  coveragePct: [0, 100],
  watchedSeconds: [0, 86_400],
  durationSeconds: [0, 86_400],
  dwellSeconds: [0, 86_400],
  rewinds: [0, 10_000],
  skips: [0, 10_000],
};

/** Extra keys the client may attach; anything else is dropped, not rejected. */
const PAYLOAD_KEYS = ['reason', 'returning', 'toSeconds', 'label', 'qualified', 'played', 'visitNumber', 'athleteId', 'ts'];

/** Run-length encoded played seconds: [[from, to], ...]. Bounded on both the
 *  number of ranges and their values, since it is the one client-supplied
 *  field large enough to matter. */
const MAX_COVERAGE_RANGES = 150;

function clampInt(value, [min, max]) {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validates and normalises one raw event into the shape tracking_events
 * stores. Never throws — returns { ok: false, reason } instead, because the
 * collector's answer to every bad request is an identical silent 204.
 *
 * `created_at` is deliberately NOT taken from the client. The client's clock
 * belongs to a stranger's laptop; its `ts` is kept in the payload for
 * reference and the server stamps the authoritative time.
 */
export function validateEvent(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'not_an_object' };
  }

  const token = typeof raw.token === 'string' ? raw.token : '';
  if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: 'bad_token' };

  const eventType = typeof raw.event === 'string' ? raw.event : '';
  if (!EVENT_TYPE_SET.has(eventType)) return { ok: false, reason: 'unknown_event_type' };

  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : '';
  if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, reason: 'bad_session_id' };

  const payload = {};
  for (const key of PAYLOAD_KEYS) {
    if (raw[key] !== undefined && raw[key] !== null) payload[key] = raw[key];
  }
  const ranges = sanitiseCoverageRanges(raw.coverageRanges);
  if (ranges) payload.coverageRanges = ranges;

  return {
    ok: true,
    value: {
      token,
      session_id: sessionId,
      event_type: eventType,
      coverage_pct: clampInt(raw.coveragePct, LIMITS.coveragePct),
      watched_seconds: clampInt(raw.watchedSeconds, LIMITS.watchedSeconds),
      duration_seconds: clampInt(raw.durationSeconds, LIMITS.durationSeconds),
      dwell_seconds: clampInt(raw.dwellSeconds, LIMITS.dwellSeconds),
      rewinds: clampInt(raw.rewinds, LIMITS.rewinds),
      skips: clampInt(raw.skips, LIMITS.skips),
      payload: JSON.stringify(payload),
    },
  };
}

/**
 * Parses a request body that may have arrived either as JSON from fetch or as
 * a Blob from navigator.sendBeacon. sendBeacon takes its Content-Type from the
 * Blob and cannot send custom headers, so the collector must not insist on
 * application/json.
 */
/** Drops anything that is not a well-formed, ordered pair of second offsets. */
export function sanitiseCoverageRanges(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const range of input.slice(0, MAX_COVERAGE_RANGES)) {
    if (!Array.isArray(range) || range.length !== 2) continue;
    const from = clampInt(range[0], LIMITS.watchedSeconds);
    const to = clampInt(range[1], LIMITS.watchedSeconds);
    if (from === null || to === null || to < from) continue;
    out.push([from, to]);
  }
  return out.length ? out : null;
}

export function parseEventBody(body) {
  if (body === null || body === undefined) return { ok: false, reason: 'empty_body' };

  let text = null;
  if (typeof body === 'string') text = body;
  else if (typeof body.byteLength === 'number') text = new TextDecoder().decode(body);
  // Anything else is a body some upstream parser already turned into an object.
  if (text === null) return validateEvent(body);

  if (byteLength(text) > MAX_PAYLOAD_BYTES) return { ok: false, reason: 'too_large' };
  try {
    return validateEvent(JSON.parse(text));
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }
}

export function byteLength(text) {
  return new TextEncoder().encode(text).length;
}
