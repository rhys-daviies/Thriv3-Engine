import { describe, it, expect } from 'vitest';
import {
  validateEvent, parseEventBody, EVENT_TYPES, TOKEN_PATTERN, MAX_PAYLOAD_BYTES,
} from './trackingEvents.js';

const TOKEN = 'k7Fm2xQ9abcdefghijklmnopqrstuvwx';
const SESSION = '123e4567-e89b-12d3-a456-426614174000';
const VALID = {
  token: TOKEN,
  event: 'play_start',
  sessionId: SESSION,
  coveragePct: 55,
  watchedSeconds: 73,
  durationSeconds: 635,
  dwellSeconds: 120,
  rewinds: 1,
  skips: 2,
  ts: '2026-08-20T10:00:00.000Z',
  reason: 'video_play',
  label: '1v1 isolation',
  athleteId: 'ath-1',
  visitNumber: 2,
};

describe('event vocabulary', () => {
  it('matches the twelve events in brief §8', () => {
    expect(EVENT_TYPES).toHaveLength(12);
    expect(EVENT_TYPES).toContain('visit_start');
    expect(EVENT_TYPES).toContain('visit_qualified');
    expect(EVENT_TYPES).toContain('session_end');
  });

  it('accepts the tokens the generator actually mints', () => {
    expect(TOKEN_PATTERN.test(TOKEN)).toBe(true);
  });
});

describe('validateEvent', () => {
  it('normalises a good event into the tracking_events shape', () => {
    const { ok, value } = validateEvent(VALID);
    expect(ok).toBe(true);
    expect(value).toMatchObject({
      token: TOKEN,
      session_id: SESSION,
      event_type: 'play_start',
      coverage_pct: 55,
      watched_seconds: 73,
      rewinds: 1,
      skips: 2,
    });
  });

  it('never takes created_at from the client', () => {
    expect(validateEvent(VALID).value).not.toHaveProperty('created_at');
  });

  it('keeps the client timestamp in the payload for reference', () => {
    expect(JSON.parse(validateEvent(VALID).value.payload).ts).toBe(VALID.ts);
  });

  it('keeps chapter labels and qualification reasons in the payload', () => {
    const payload = JSON.parse(validateEvent(VALID).value.payload);
    expect(payload.label).toBe('1v1 isolation');
    expect(payload.reason).toBe('video_play');
  });

  it.each([
    ['a short token', { token: 'abc' }, 'bad_token'],
    ['a token with punctuation', { token: `${'a'.repeat(31)}!` }, 'bad_token'],
    ['a missing token', { token: undefined }, 'bad_token'],
    ['an unknown event type', { event: 'drop_table' }, 'unknown_event_type'],
    ['a missing event type', { event: undefined }, 'unknown_event_type'],
    ['a missing session id', { sessionId: undefined }, 'bad_session_id'],
  ])('rejects %s', (_label, override, reason) => {
    expect(validateEvent({ ...VALID, ...override })).toEqual({ ok: false, reason });
  });

  it.each([null, undefined, 'a string', 42, []])('rejects the non-object %p', (input) => {
    expect(validateEvent(input).ok).toBe(false);
  });

  it('clamps counters so a malformed client cannot poison the rollup', () => {
    const { value } = validateEvent({ ...VALID, coveragePct: 99999, rewinds: -5, watchedSeconds: 1e12 });
    expect(value.coverage_pct).toBe(100);
    expect(value.rewinds).toBe(0);
    expect(value.watched_seconds).toBe(86_400);
  });

  it('drops unrecognised extra keys rather than storing them', () => {
    const { value } = validateEvent({ ...VALID, injected: 'nope' });
    expect(JSON.parse(value.payload)).not.toHaveProperty('injected');
  });

  it('accepts every event type in the vocabulary', () => {
    for (const event of EVENT_TYPES) {
      expect(validateEvent({ ...VALID, event }).ok).toBe(true);
    }
  });
});

describe('parseEventBody', () => {
  it('accepts a JSON string, as fetch sends', () => {
    expect(parseEventBody(JSON.stringify(VALID)).ok).toBe(true);
  });

  it('accepts raw bytes, as sendBeacon sends', () => {
    expect(parseEventBody(new TextEncoder().encode(JSON.stringify(VALID))).ok).toBe(true);
  });

  it('accepts an already-parsed object', () => {
    expect(parseEventBody(VALID).ok).toBe(true);
  });

  it('rejects malformed JSON without throwing', () => {
    expect(parseEventBody('{oh dear')).toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects an empty body', () => {
    expect(parseEventBody(undefined).ok).toBe(false);
    expect(parseEventBody(null).ok).toBe(false);
  });

  it('rejects a body over the size cap', () => {
    const huge = JSON.stringify({ ...VALID, label: 'x'.repeat(MAX_PAYLOAD_BYTES) });
    expect(parseEventBody(huge)).toEqual({ ok: false, reason: 'too_large' });
  });
});
