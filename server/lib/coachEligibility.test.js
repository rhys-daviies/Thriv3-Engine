import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import db from '../db/client.js';
import {
  coachIneligibility, applyCoachFloor, recipientIneligibility, legacyCoachesAllowed, programmeNames, INELIGIBLE,
} from './coachEligibility.js';
import { programmeCoaches } from '../routes/programmeCoaches.js';

/**
 * PHASE 8A — the runtime coach floor is the DEFAULT on every recipient path.
 * (Suites that model pre-8A outreach mechanics opt in with THRIV3_ALLOW_LEGACY_COACHES=1;
 * this file never does, except where it proves the opt-in itself.)
 */
const T = '2026-09-30T00:00:00Z';
const coach = (id, over = {}) => ({ id, created_at: T, full_name: `Coach ${id}`, email: `${id}@example.edu`, school: 'Floor College', sport: 'mens-soccer', position_title: 'Head Coach', email_status: 'verified', currentness_status: 'CURRENT', ...over });
const ins = (c) => db.prepare(`INSERT INTO coaches (${Object.keys(c).join(',')}) VALUES (${Object.keys(c).map((k) => `@${k}`).join(',')})`).run(c);

beforeAll(() => {
  delete process.env.THRIV3_ALLOW_LEGACY_COACHES;
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active) VALUES ('fc', ?, ?, 'Floor College', 'mens-soccer', 'NAIA', 1)").run(T, T);
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active) VALUES ('fc-alt', ?, ?, 'Floor Coll.', 'mens-soccer', 'NAIA', 1)").run(T, T);
  db.prepare("INSERT INTO programme_row_links (college_id, canonical_college_id, link_kind, provenance, recorded_at) VALUES ('fc-alt','fc','SAME_PROGRAMME_ALT_NAME','test',?)").run(T);
  ins(coach('ok'));
  ins(coach('inferred', { email_status: 'inferred' }));
  ins(coach('generic', { full_name: '', email: 'soccer@example.edu', email_status: 'generic', position_title: 'Team Email' }));
  ins(coach('unknown', { email_status: null }));
  ins(coach('stale', { currentness_status: 'PROVEN_STALE' }));
  ins(coach('altname', { school: 'Floor Coll.' }));
  ins(coach('elsewhere', { school: 'Another College' }));
});
afterEach(() => { delete process.env.THRIV3_ALLOW_LEGACY_COACHES; });

describe('the floor', () => {
  it('passes only a verified address of a coach who is not PROVEN_STALE', () => {
    expect(coachIneligibility(coach('a'))).toBeNull();
    expect(coachIneligibility(coach('a', { email_status: 'inferred' }))).toBe('EMAIL_NOT_VERIFIED:inferred');
    expect(coachIneligibility(coach('a', { email_status: 'generic' }))).toBe('EMAIL_NOT_VERIFIED:generic');
    expect(coachIneligibility(coach('a', { email_status: null }))).toBe('EMAIL_NOT_VERIFIED:unknown');
    expect(coachIneligibility(coach('a', { currentness_status: 'PROVEN_STALE' }))).toBe(INELIGIBLE.COACH_PROVEN_STALE);
    expect(coachIneligibility(coach('a', { email: 'N/A' }))).toBe(INELIGIBLE.NO_USABLE_EMAIL);
  });
  it('is default-on; the legacy offer needs the explicit opt-in (trimmed, case-insensitive)', () => {
    expect(legacyCoachesAllowed({})).toBe(false);
    expect(legacyCoachesAllowed({ THRIV3_ALLOW_LEGACY_COACHES: ' 1 ' })).toBe(true);
    expect(legacyCoachesAllowed({ THRIV3_ALLOW_LEGACY_COACHES: 'no' })).toBe(false);
    const rows = [coach('a'), coach('b', { email_status: 'inferred' })];
    expect(applyCoachFloor(rows, { env: {} }).map((r) => r.id)).toEqual(['a']);
    expect(applyCoachFloor(rows, { env: { THRIV3_ALLOW_LEGACY_COACHES: '1' } })).toHaveLength(2);
  });
});

describe('programme coach API / manual outreach (programmeCoaches)', () => {
  it('offers only floor-passing coaches by default', () => {
    const got = programmeCoaches({ collegeName: 'Floor College', sport: 'mens-soccer' }).map((c) => c.coach_id);
    expect(got).toEqual(['ok']);
  });
  it('offers the pre-8A unfiltered list only under the opt-in', () => {
    process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';
    const got = programmeCoaches({ collegeName: 'Floor College', sport: 'mens-soccer' }).map((c) => c.coach_id).sort();
    expect(got).toEqual(['generic', 'inferred', 'ok', 'stale', 'unknown']);
  });
});

describe('send path recipient gate (recipientIneligibility)', () => {
  it('accepts a verified address of this programme, including its linked alternate spelling', () => {
    expect(recipientIneligibility({ email: 'ok@example.edu', collegeName: 'Floor College', sport: 'mens-soccer' })).toBeNull();
    expect(recipientIneligibility({ email: 'altname@example.edu', collegeName: 'Floor College', sport: 'mens-soccer' })).toBeNull();
    expect(programmeNames('Floor Coll.', 'mens-soccer').sort()).toEqual(['Floor Coll.', 'Floor College']);
  });
  it('refuses an unknown address, one held at another programme, an inferred one and a departed coach', () => {
    const r = (email) => recipientIneligibility({ email, collegeName: 'Floor College', sport: 'mens-soccer' });
    expect(r('nobody@example.edu')).toBe(INELIGIBLE.UNKNOWN_ADDRESS);
    expect(r('elsewhere@example.edu')).toBe(INELIGIBLE.ADDRESS_AT_OTHER_PROGRAMME);
    expect(r('inferred@example.edu')).toMatch(/EMAIL_NOT_VERIFIED/);
    expect(r('stale@example.edu')).toBe(INELIGIBLE.COACH_PROVEN_STALE);
    expect(r('soccer@example.edu')).toMatch(/EMAIL_NOT_VERIFIED:generic/);
  });
  it('is bypassed only by the explicit opt-in', () => {
    process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';
    expect(recipientIneligibility({ email: 'nobody@example.edu', collegeName: 'Floor College', sport: 'mens-soccer' })).toBeNull();
  });
});
