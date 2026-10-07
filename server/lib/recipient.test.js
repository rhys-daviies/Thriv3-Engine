import { describe, it, expect, beforeAll } from 'vitest';
import db from '../db/client.js';
import {
  RECIPIENT_KIND, RECIPIENT_ERROR, RecipientError, resolveRecipient, recipientRefOfOutreach,
  recipientForOutreachToken, recipientForOutreach, outreachRecipientSql, sendRecipientSql,
} from './recipient.js';
import { recentSendCount } from './sendCap.js';
import { pendingDrafts } from './confirmSends.js';
import { manualRelationshipForConfirmedSend } from './manualContactStance.js';
import { historyForAthleteProgramme } from './programmeContactHistory.js';
import { contactIntelligenceForAthlete } from './contactIntelligence.js';
import { pendingManualDraftsForAthlete } from './manualDraftConfirmation.js';
import { confirmedSends } from './outreachSend.js';
import { coachEngagement } from './engagementQueries.js';
import { programmeContactId } from './programmeContactEligibility.js';

/**
 * PHASE 1C — THE TYPED RECIPIENT, AND PARITY OF EVERY PATH MOVED ONTO IT.
 *
 * The resolver must fail closed and never turn one kind into the other; the safety and read
 * paths that now take their recipient from it (send cap, opt-out resolution, confirm lists,
 * manual contact stance, contact history, contact intelligence, Tab 3 engagement) must return
 * EXACTLY what their own JOIN coaches returned. The LEGACY statements below are the
 * pre-refactor SQL verbatim (commit e76a537), run against the same rows as the new code.
 */
const T = '2026-09-20T10:00:00.000Z';
const A = 'rp-ath-a'; const B = 'rp-ath-b';

beforeAll(() => {
  const p = db.prepare("INSERT INTO players (id, created_date, updated_date, full_name, position, sport) VALUES (?, ?, ?, ?, 'MF', 'mens-soccer')");
  p.run(A, T, T, 'Athlete A'); p.run(B, T, T, 'Athlete B');
  const k = db.prepare('INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status) VALUES (?,?,?,?,?,?,?,?,?,?)');
  k.run('rk-head', T, 'Hana Head', 'hana.head@rp.example', 'RP College', 'NCAA D3', 'mens-soccer', 'Head Coach', 'verified', 'CURRENT');
  k.run('rk-null', T, 'Nell Null', null, 'RP College', 'NCAA D3', 'mens-soccer', 'Assistant Coach', 'unknown', null);
  k.run('rk-case', T, 'Cas Case', 'Cas.Case@RP.example', 'RP College', 'NCAA D3', 'mens-soccer', 'Assistant Coach', 'verified', null);
  k.run('rk-team-m', T, null, 'soccer@rp.example', 'RP College', 'NCAA D3', 'mens-soccer', "Men's Soccer (Team Email)", 'generic', null);
  k.run('rk-both-w', T, 'Bo Both', 'soccer@rp.example', 'RP College', 'NCAA D3', 'womens-soccer', 'Head Coach', 'verified', null);
  k.run('rk-noschool', T, 'No School', 'no.school@rp.example', null, null, 'mens-soccer', 'Head Coach', 'verified', null);
  const o = db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at, revoked_at) VALUES (?,?,?,?,?,?,?,?)');
  o.run('ro-1', A, 'rk-head', 'rt-1', T, T, '2026-09-21T00:00:00.000Z', null);
  o.run('ro-2', A, 'rk-null', 'rt-2', T, T, null, null);
  o.run('ro-3', A, 'rk-case', 'rt-3', T, T, '2026-09-22T00:00:00.000Z', null);
  o.run('ro-4', B, 'rk-case', 'rt-4', T, T, '2026-09-23T00:00:00.000Z', null);
  o.run('ro-5', A, 'rk-team-m', 'rt-5', T, T, '2026-09-24T00:00:00.000Z', null);
  o.run('ro-6', B, 'rk-both-w', 'rt-6', T, null, null, null);
  o.run('ro-7', B, 'rk-noschool', 'rt-7', T, T, null, '2026-09-25T00:00:00.000Z');
  o.run('ro-8', A, 'rk-both-w', 'rt-8', T, T, null, null);
  const s = db.prepare(`INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id, college_name, sport, policy_version, created_at, state, origin, subject)
    VALUES (?,?,?,?,?,?,?,?,?,'P2',?,?,?,?)`);
  s.run('rs-1', 'ro-1', 1, T, '2026-09-21T00:00:00.000Z', A, 'rk-head', 'RP College', 'mens-soccer', T, 'ACCEPTED', 'manual', 'a');
  s.run('rs-2', 'ro-2', 1, T, null, A, 'rk-null', 'RP College', 'mens-soccer', T, 'DRAFT', 'manual', 'b');
  s.run('rs-3', 'ro-3', 1, T, '2026-09-22T00:00:00.000Z', A, 'rk-case', 'RP College', 'mens-soccer', T, 'ACCEPTED', 'campaign', 'c');
  s.run('rs-5', 'ro-5', 1, T, '2026-09-24T00:00:00.000Z', A, 'rk-team-m', 'RP College', 'mens-soccer', T, 'ACCEPTED', null, 'd');
  s.run('rs-8', 'ro-8', 1, T, null, A, 'rk-both-w', 'RP College', 'womens-soccer', T, 'DRAFT', 'manual', 'e');
  db.prepare("INSERT INTO engagement_rollup (outreach_id, qualified_visits, best_coverage_pct, engagement_score, tier, responded_at, updated_at) VALUES ('ro-3', 2, 55, 60, 'warm', '2026-09-26T00:00:00Z', ?)").run(T);
  // a programme inbox (Phase 1B table) — resolvable as its own kind, never reachable from outreach
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-U980001', 'RP College', 980001, 'SINGLE', 'test', ?)").run(T);
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES ('rc-rp', ?, ?, 'RP College', 'mens-soccer', 'NCAA D3', 1, 980001, 'AE-U980001')").run(T, T);
  db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
    VALUES (?, 'AE-U980001', 'rc-rp', 'mens-soccer', 'msoccer@rp.example', 'RP College Men''s Soccer', 'TEAM_INBOX', 'https://rp.example/sports/mens-soccer/coaches', ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
    .run(programmeContactId('AE-U980001', 'mens-soccer', 'msoccer@rp.example'), T, T, T, T);
});

const PC_ID = () => programmeContactId('AE-U980001', 'mens-soccer', 'msoccer@rp.example');
const code = (fn) => { try { fn(); } catch (e) { return e instanceof RecipientError ? e.code : `NOT_A_RECIPIENT_ERROR:${e.message}`; } return 'NO_THROW'; };

describe('A. coach recipients resolve, as coaches', () => {
  it('carries kind, id, address, display name, programme and the coach facts — under `coach`', () => {
    const r = resolveRecipient({ kind: 'COACH', id: 'rk-head' });
    expect(r).toEqual({ kind: 'COACH', id: 'rk-head', email: 'hana.head@rp.example', displayName: 'Hana Head', programme: { name: 'RP College', sport: 'mens-soccer' },
      coach: { full_name: 'Hana Head', position_title: 'Head Coach', division: 'NCAA D3', email_status: 'verified', currentness_status: 'CURRENT' } });
    expect(r).not.toHaveProperty('programmeContact');
    expect(Object.isFrozen(r) && Object.isFrozen(r.coach) && Object.isFrozen(r.programme)).toBe(true);
  });
  it('a nameless legacy team-email coach row is still a COACH recipient with no invented name', () => {
    expect(resolveRecipient({ kind: 'COACH', id: 'rk-team-m' })).toMatchObject({ kind: 'COACH', displayName: null, coach: { full_name: null } });
  });
  it('a programme inbox resolves as PROGRAMME_INBOX with no person fields at all', () => {
    const r = resolveRecipient({ kind: 'PROGRAMME_INBOX', id: PC_ID() });
    expect(r).toEqual({ kind: 'PROGRAMME_INBOX', id: PC_ID(), email: 'msoccer@rp.example', displayName: "RP College Men's Soccer",
      programme: { name: 'RP College', sport: 'mens-soccer', college_id: 'rc-rp', athletics_entity_id: 'AE-U980001' }, programmeContact: { contact_role: 'TEAM_INBOX', status: 'VERIFIED' } });
    expect(r).not.toHaveProperty('coach');
  });
  it('every outreach row addresses a COACH in this build; tokens and outreach ids resolve to it', () => {
    for (const row of db.prepare('SELECT * FROM outreach').all()) expect(recipientRefOfOutreach(row)).toEqual({ kind: 'COACH', id: row.coach_id });
    expect(recipientForOutreachToken('rt-3')).toMatchObject({ kind: 'COACH', id: 'rk-case', email: 'Cas.Case@RP.example' });
    expect(recipientForOutreachToken('rt-unknown')).toBeNull();
    expect(recipientForOutreach('ro-6')).toMatchObject({ athleteId: B, recipient: { kind: 'COACH', programme: { name: 'RP College', sport: 'womens-soccer' } } });
    expect(recipientForOutreach('nope')).toBeNull();
  });
});

describe('B. invalid recipients fail closed — no fallback, no conversion', () => {
  it('unknown kind, missing id, missing record, wrong programme, unaddressed outreach row', () => {
    expect(code(() => resolveRecipient({ kind: 'coach', id: 'rk-head' }))).toBe(RECIPIENT_ERROR.KIND_UNKNOWN);
    expect(code(() => resolveRecipient({ kind: 'PERSON', id: 'rk-head' }))).toBe(RECIPIENT_ERROR.KIND_UNKNOWN);
    expect(code(() => resolveRecipient(null))).toBe(RECIPIENT_ERROR.KIND_UNKNOWN);
    expect(code(() => resolveRecipient({ kind: 'COACH' }))).toBe(RECIPIENT_ERROR.ID_MISSING);
    expect(code(() => resolveRecipient({ kind: 'COACH', id: '  ' }))).toBe(RECIPIENT_ERROR.ID_MISSING);
    expect(code(() => resolveRecipient({ kind: 'COACH', id: 'rk-nobody' }))).toBe(RECIPIENT_ERROR.NOT_FOUND);
    expect(code(() => resolveRecipient({ kind: 'COACH', id: 'rk-head' }, { expectProgramme: { name: 'RP College', sport: 'womens-soccer' } }))).toBe(RECIPIENT_ERROR.PROGRAMME_MISMATCH);
    expect(code(() => resolveRecipient({ kind: 'PROGRAMME_INBOX', id: PC_ID() }, { expectProgramme: { name: 'Other', sport: 'mens-soccer' } }))).toBe(RECIPIENT_ERROR.PROGRAMME_MISMATCH);
    expect(code(() => recipientRefOfOutreach({ id: 'x' }))).toBe(RECIPIENT_ERROR.OUTREACH_UNADDRESSED);
    expect(code(() => recipientRefOfOutreach(null))).toBe(RECIPIENT_ERROR.OUTREACH_UNADDRESSED);
  });
  it('a kind is never swapped to find a record: a coach id is not an inbox and an inbox id is not a coach', () => {
    expect(code(() => resolveRecipient({ kind: 'PROGRAMME_INBOX', id: 'rk-head' }))).toBe(RECIPIENT_ERROR.NOT_FOUND);
    expect(code(() => resolveRecipient({ kind: 'COACH', id: PC_ID() }))).toBe(RECIPIENT_ERROR.NOT_FOUND);
  });
});

describe('I/J. in this build the SQL recipient of an outreach row can only be a coach', () => {
  it('the fragments join coaches only, and name no programme contact', () => {
    for (const f of [outreachRecipientSql(), outreachRecipientSql({ left: true }), sendRecipientSql(), sendRecipientSql({ left: false })]) {
      expect(f.kind).toBe(`'${RECIPIENT_KIND.COACH}'`);
      expect(f.join).toMatch(/^(LEFT )?JOIN coaches \w+ ON \w+\.id = \w+\.coach_id$/);
      expect(JSON.stringify(f)).not.toMatch(/programme_contact/);
    }
    expect(() => outreachRecipientSql({ as: 'c; DROP TABLE x' })).toThrow();
  });
});

describe('C–H. every converted path returns exactly what its own JOIN coaches returned', () => {
  const LEGACY = {
    sendCap: `SELECT COUNT(*) AS n FROM outreach o JOIN coaches c ON c.id = o.coach_id WHERE lower(c.email) = ? AND o.sent_at IS NOT NULL AND o.sent_at >= ?`,
    optOut: 'SELECT o.token, c.email FROM outreach o JOIN coaches c ON c.id = o.coach_id WHERE o.token = ?',
    stance: `SELECT o.athlete_id AS athleteId, c.school AS collegeName, c.sport AS sport FROM outreach o JOIN coaches c ON c.id = o.coach_id WHERE o.id = ?`,
    history: `SELECT c.id AS coach_id, c.full_name AS coach_name, c.email AS coach_email, c.position_title, o.created_at AS relationship_opened_at, o.drafted_at AS last_drafted_at,
      o.sent_at AS first_confirmed_send_at, o.revoked_at FROM outreach o JOIN coaches c ON c.id = o.coach_id
      WHERE o.athlete_id = @athleteId AND c.school = @collegeName AND c.sport = @sport ORDER BY COALESCE(o.sent_at, o.drafted_at, o.created_at) DESC, c.id`,
    intelRows: `SELECT c.school AS college_name, c.sport AS sport, c.id AS coach_id, c.full_name AS coach_name, c.position_title, o.id AS outreach_id
      FROM outreach o JOIN coaches c ON c.id = o.coach_id WHERE o.athlete_id = ? AND c.school IS NOT NULL ORDER BY o.id`,
    pending: `SELECT o.id, c.full_name AS coach_name, c.email, c.school FROM outreach o JOIN coaches c ON c.id = o.coach_id WHERE o.revoked_at IS NULL AND o.drafted_at IS NOT NULL`,
    manualPending: `SELECT s.id AS send_id, c.full_name AS coach_name, c.position_title FROM outreach_send s JOIN outreach o ON o.id = s.outreach_id LEFT JOIN coaches c ON c.id = s.coach_id
      WHERE s.athlete_id = ? AND s.origin = 'manual' AND s.state IN ('DRAFT', 'QUEUED', 'SENDING', 'UNKNOWN_PROVIDER_RESULT') AND o.revoked_at IS NULL ORDER BY s.drafted_at, s.id`,
    confirmed: `SELECT s.id, c.email AS coach_email, c.position_title AS coach_title FROM outreach_send s JOIN outreach o ON o.id = s.outreach_id LEFT JOIN coaches c ON c.id = s.coach_id
      WHERE s.sent_at IS NOT NULL ORDER BY s.sent_at, s.id`,
    engagement: `SELECT o.id AS outreach_id, c.id AS coach_id, c.full_name AS coach_name, c.school, c.division, c.position_title FROM outreach o JOIN coaches c ON c.id = o.coach_id
      LEFT JOIN engagement_rollup r ON r.outreach_id = o.id WHERE o.athlete_id = ? AND o.revoked_at IS NULL ORDER BY r.engagement_score DESC NULLS LAST, c.full_name ASC`,
  };
  const addresses = () => [...db.prepare('SELECT DISTINCT email FROM coaches').pluck().all(), 'CAS.CASE@rp.example', 'SOCCER@RP.EXAMPLE', 'nobody@x.example', '', null];
  const NOW = Date.parse('2026-10-07T00:00:00Z');

  it('D. send cap: identical counts for every address, case and window', () => {
    for (const e of addresses()) for (const days of [1, 30, 3650]) {
      const since = new Date(NOW - days * 86_400_000).toISOString();
      const legacy = e ? db.prepare(LEGACY.sendCap).get(String(e).trim().toLowerCase(), since).n : 0;
      expect(recentSendCount(e, { now: NOW, days }), `${e}/${days}`).toBe(legacy);
    }
    expect(recentSendCount('cas.case@rp.example', { now: NOW, days: 3650 })).toBe(2);  // two athletes, one inbox
    expect(recentSendCount('soccer@rp.example', { now: NOW, days: 3650 })).toBe(1);    // shared address counted across both rows
  });

  it('E. opt-out: every token resolves to the same address (and the same unresolved ones)', () => {
    for (const t of [...db.prepare('SELECT token FROM outreach').pluck().all(), 'rt-unknown']) {
      const legacy = db.prepare(LEGACY.optOut).get(t)?.email ?? null;
      expect(recipientForOutreachToken(t)?.email ?? null, t).toBe(legacy);
    }
    expect(recipientForOutreachToken('rt-2').email).toBeNull(); // null address -> the caller reports it unresolved, as before
  });

  it('F. confirm lists: the batch confirm list, manual pending drafts and confirmed sends carry the same recipient columns', () => {
    const legacyPending = new Map(db.prepare(LEGACY.pending).all().map((r) => [r.id, r]));
    const pending = pendingDrafts();
    expect(pending.length).toBeGreaterThan(0);
    for (const row of pending) expect({ coach_name: row.coach_name, email: row.email, school: row.school }).toEqual((({ coach_name, email, school }) => ({ coach_name, email, school }))(legacyPending.get(row.id)));
    for (const a of [A, B]) expect(pendingManualDraftsForAthlete(a).map((r) => [r.send_id, r.coach_name, r.position_title])).toEqual(db.prepare(LEGACY.manualPending).all(a).map((r) => [r.send_id, r.coach_name, r.position_title]));
    expect(confirmedSends().map((r) => [r.id, r.coach_email, r.coach_title])).toEqual(db.prepare(LEGACY.confirmed).all().map((r) => [r.id, r.coach_email, r.coach_title]));
  });

  it('G. manual contact stance: every confirmed send resolves to the same relationship', () => {
    for (const s of db.prepare('SELECT id, outreach_id, origin FROM outreach_send').all()) {
      const legacyRow = db.prepare(LEGACY.stance).get(s.outreach_id);
      const legacy = s.origin === 'manual' && legacyRow?.athleteId && legacyRow?.collegeName && legacyRow?.sport ? legacyRow : null;
      expect(manualRelationshipForConfirmedSend({ outreachId: s.outreach_id, outreachSendId: s.id }), s.id).toEqual(legacy);
    }
    expect(manualRelationshipForConfirmedSend({ outreachId: 'nope', outreachSendId: 'rs-1' })).toBeNull();
  });

  it('H. contact history, contact intelligence and Tab 3 engagement list the same coaches, with the same fields', () => {
    for (const a of [A, B]) for (const sport of ['mens-soccer', 'womens-soccer']) {
      const got = historyForAthleteProgramme({ athleteId: a, collegeName: 'RP College', sport });
      const legacy = db.prepare(LEGACY.history).all({ athleteId: a, collegeName: 'RP College', sport });
      expect(got.map((r) => Object.fromEntries(Object.keys(legacy[0] || {}).map((k) => [k, r[k]])))).toEqual(legacy);
    }
    for (const a of [A, B]) {
      const legacy = db.prepare(LEGACY.intelRows).all(a);
      const got = contactIntelligenceForAthlete(a).flatMap((p) => p.coaches.map((c) => [p.college_name, p.sport, c.coach_id, c.coach_name, c.position_title])).sort();
      expect(got).toEqual(legacy.map((r) => [r.college_name, r.sport, r.coach_id, r.coach_name, r.position_title]).sort());
      expect(coachEngagement(a).map((r) => [r.outreach_id, r.coach_id, r.coach_name, r.school, r.division, r.position_title]))
        .toEqual(db.prepare(LEGACY.engagement).all(a).map((r) => [r.outreach_id, r.coach_id, r.coach_name, r.school, r.division, r.position_title]));
    }
    // the coach with no school is excluded from intelligence exactly as before
    expect(contactIntelligenceForAthlete(B).some((p) => p.coaches.some((c) => c.coach_id === 'rk-noschool'))).toBe(false);
  });
});
