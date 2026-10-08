import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { corroborateFixtureCoaches } from '../testCanonicalCoaches.js';

/**
 * THE SEND FLOOR ENFORCES THE CANONICAL DECISION AND THE ACTIVATION HOLDS.
 *
 * Data Integrity 8D.3F: a coach whose recorded address is POSITIVELY ABSENT from their own official
 * page (Brosnihan) passed the runtime floor, because the floor checked only "verified and not
 * PROVEN_STALE", and every outreach path read that floor. Each test below tries to reach a held or
 * canonically ineligible coach through a different door — the floor itself, the staff list the
 * manual picker reads, the manual send boundary (sendOutreach, which /api/outreach/send, the manual
 * composer, bulk outreach and the draft CLI share), the legacy opt-in — and is refused. The campaign
 * plan and the claim of an already-prepared campaign message are covered in
 * coachOutreachRefusal.test.js. Outlook is mocked: nothing leaves the machine.
 */
delete process.env.THRIV3_ALLOW_LEGACY_COACHES;

const composed = [];
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => { composed.push(message); return { ok: true, sent: false }; }),
}));

const db = (await import('../db/client.js')).default;
const { sendOutreach } = await import('./sendOutreach.js');
const { coachIneligibility, outreachIneligibility, recipientIneligibility, applyCoachFloor, INELIGIBLE } = await import('../lib/coachEligibility.js');
const { activationHolds, activationHold, canonicalDecisions, CANONICAL_INELIGIBLE } = await import('../lib/canonicalCoachEligibility.js');
const { programmeCoaches } = await import('./programmeCoaches.js');

const T = '2026-09-20T10:00:00.000Z';
const ATH = 'floor-athlete';
const BODY = 'Hi Coach,\n\nI am writing about Marcus Reyes.\n\nBest regards,\nThriv3';
const SEED = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/seeds/coach_activation_holds.json'), 'utf8'));
const heldId = (kind) => SEED.holds.find((h) => h.hold === kind).coach_id;
let unit = 930000;

/** One programme with a staff that is corroborated (canonically eligible) unless a test says otherwise. */
function programme(key, { coaches = [], corroborate = true, active = 1 } = {}) {
  unit += 1;
  const ent = `AE-U${unit}`; const host = `${key}athletics.example`; const name = `${key} College`;
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?, ?, ?, 'SINGLE', 'test', ?)").run(ent, name, unit, T);
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D3', ?, ?, ?)").run(`col-${key}`, T, T, name, active, unit, ent);
  db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, ?, 'VERIFIED', 'ATHLETICS_SITE', '[]', ?, 'TEST', 'CERTAIN', ?)").run(host, unit, JSON.stringify([unit]), T);
  const ids = coaches.map((c, i) => {
    const id = c.id || `co-${key}-${i}`;
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
      VALUES (?, ?, ?, ?, ?, 'NCAA D3', 'mens-soccer', ?, 'verified', ?)`).run(id, T, c.name, c.email || `coach${i}@${host}`, name, c.title || 'Head Coach', c.currentness || 'CURRENT');
    return id;
  });
  if (corroborate) corroborateFixtureCoaches(db, { ids });
  return { name, host, unit, ids };
}

/** A qualifying positive email absence, exactly as the 8D.3D composite writer records one. */
function recordAbsence(coachId, p) {
  const c = db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
  const src = `https://${p.host}/sports/mens-soccer/coaches`;
  const sha = createHash('sha256').update(`page-${coachId}`).digest('hex');
  const oid = createHash('sha256').update([coachId, c.email.toLowerCase(), src, sha].join('|')).digest('hex');
  db.prepare(`INSERT INTO coach_email_absence_observations (observation_id, coach_id, email, observed_at, page_season, source_url, source_host, page_unitid, page_sport,
      parser_version, evidence_sha256, parse_status, staff_records, emails_published, coach_name_found, coach_email_found, other_email_for_coach, fixture_hash, action_id, recorded_at)
    VALUES (?, ?, ?, '2026-10-01T12:00:00.000Z', 2026, ?, ?, ?, 'mens-soccer', 'sidearm-staff-2', ?, 'COMPLETE', 4, 3, 1, 0, ?, 'test-fixture', 'test-action', ?)`)
    .run(oid, coachId, c.email.toLowerCase(), src, p.host, p.unit, sha, `other.${c.email}`, T);
}

const sends = () => db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n;
const send = (p, entry) => sendOutreach({ athleteId: ATH, coaches: [entry], subject: 'Marcus Reyes', body: BODY, greetingName: 'Coach', collegeName: p.name, division: 'NCAA D3' });
const row = (id) => db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
const staffIds = (p) => programmeCoaches({ collegeName: p.name, sport: 'mens-soccer' }).map((c) => c.coach_id);

let ABS; let HELD; let UNCORR; let OK; let FROM; let TO; let GONE;
beforeAll(() => {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug, recruiting_class_year, email, video_id, video_chapters, graduation_year)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'Left Winger', 'mens-soccer', ?, 2027, 'a@example.com', 'aqz-KE-bpKQ', ?, 2027)`)
    .run(ATH, randomUUID().slice(0, 10), JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]));
  ABS = programme('absent', { coaches: [{ name: 'Abby Absent' }] });
  HELD = programme('held', { coaches: [{ id: heldId('PENDING_SEND_TIME_VERIFICATION'), name: 'Hal Held' }] });   // a real 8D.3F newly eligible id
  UNCORR = programme('uncorr', { coaches: [{ name: 'Una Uncorroborated' }], corroborate: false });
  OK = programme('okay', { coaches: [{ name: 'Olive Okay' }] });
  GONE = programme('gone', { coaches: [{ name: 'Gus Gone' }], active: 0 });
  // a coach filed at FROM whose own mail domain and identity place them at TO: the engine REASSIGNS
  TO = programme('target', { coaches: [] });
  FROM = programme('filed', { coaches: [{ name: 'Rita Reassigned', email: 'rita@targetathletics.example' }], corroborate: false });
  db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, method, imported_at) VALUES (?, 'mens-soccer', 1901, 'Rita Reassigned', 'test-fixture', ?)").run(TO.name, T);
});
beforeEach(() => { composed.length = 0; });
afterEach(() => { delete process.env.THRIV3_ALLOW_LEGACY_COACHES; });

describe('the holds file', () => {
  it('lists the 8D.3F hand-off: 131 newly eligible (129 pending + 2 caution), the absence coach and the 3 proven stale', () => {
    expect(SEED.counts).toEqual({ PENDING_SEND_TIME_VERIFICATION: 129, ACTIVATION_CAUTION: 2, POSITIVE_EMAIL_ABSENCE: 1, PROVEN_STALE: 3 });
    expect(new Set(SEED.holds.map((h) => h.coach_id)).size).toBe(135);
    expect(activationHold('647c575f-b199-4669-9dff-3542cd607029')).toMatchObject({ hold: 'POSITIVE_EMAIL_ABSENCE' });
    expect(activationHolds().size).toBe(135);
  });
  it('fails CLOSED when the file is missing, malformed, emptied or inconsistent: every coach is treated as held', () => {
    const tmp = (content) => { const f = path.join(os.tmpdir(), `holds-${randomUUID()}.json`); fs.writeFileSync(f, content); return f; };
    const ok = { kind: 'COACH_ACTIVATION_HOLDS', counts: { PENDING_SEND_TIME_VERIFICATION: 1 }, holds: [{ coach_id: 'c1', hold: 'PENDING_SEND_TIME_VERIFICATION' }] };
    const bad = {
      missing: path.join(os.tmpdir(), `no-such-holds-${randomUUID()}.json`),
      notJson: tmp('{ "kind": "COACH_ACTIVATION_HOLDS", "holds": ['),
      wrongKind: tmp(JSON.stringify({ ...ok, kind: 'SOMETHING_ELSE' })),
      noHolds: tmp(JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', counts: {} })),
      emptied: tmp(JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', counts: {}, holds: [] })),
      countsDisagree: tmp(JSON.stringify({ ...ok, counts: { PENDING_SEND_TIME_VERIFICATION: 2 } })),
      duplicate: tmp(JSON.stringify({ ...ok, counts: { PENDING_SEND_TIME_VERIFICATION: 2 }, holds: [ok.holds[0], ok.holds[0]] })),
      badRow: tmp(JSON.stringify({ ...ok, holds: [{ coach_id: '', hold: 'PENDING_SEND_TIME_VERIFICATION' }] })),
    };
    for (const [why, f] of Object.entries(bad)) expect(activationHold('anyone-at-all', f), why).toMatchObject({ hold: 'HOLDS_FILE_UNREADABLE' });
    const good = tmp(JSON.stringify(ok));
    expect(activationHold('c1', good)).toMatchObject({ hold: 'PENDING_SEND_TIME_VERIFICATION' });
    expect(activationHold('someone-else', good)).toBeNull();
    activationHolds(); // restore the memo to the real file for the rest of the suite
  });
  it('a hold added to the file applies to the very next check, without a restart', () => {
    const f = path.join(os.tmpdir(), `holds-${randomUUID()}.json`);
    const write = (holds) => fs.writeFileSync(f, JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', counts: { PENDING_SEND_TIME_VERIFICATION: holds.length }, holds: holds.map((id) => ({ coach_id: id, hold: 'PENDING_SEND_TIME_VERIFICATION' })) }));
    write(['c1']);
    expect(activationHold('c2', f)).toBeNull();
    write(['c1', 'c2-newly-held']);
    expect(activationHold('c2-newly-held', f)).toMatchObject({ hold: 'PENDING_SEND_TIME_VERIFICATION' });
    activationHolds();
  });
  it('is committed: tracked by git and not ignored, so a deploy built from the repository carries it', () => {
    const rel = 'server/data/seeds/coach_activation_holds.json';
    const cwd = path.resolve(import.meta.dirname, '../..');
    expect(execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd, encoding: 'utf8' }).trim()).toBe(rel);
    let ignored = true; try { execFileSync('git', ['check-ignore', '-q', rel], { cwd }); } catch { ignored = false; }
    expect(ignored).toBe(false);
  });
});

describe('a positive email absence (the Brosnihan case)', () => {
  it('the coach is eligible before the observation and refused the moment it is recorded (no stale decision)', () => {
    const id = ABS.ids[0];
    expect(coachIneligibility(row(id))).toBeNull();
    expect(staffIds(ABS)).toEqual([id]);
    recordAbsence(id, ABS);
    expect(coachIneligibility(row(id))).toBe(CANONICAL_INELIGIBLE.EMAIL_POSITIVELY_ABSENT);
    expect(staffIds(ABS)).toEqual([]);
  });
  it('cannot be written to through the send boundary, and nothing is drafted', async () => {
    const before = sends();
    const { results } = await send(ABS, { name: 'Abby Absent', email: row(ABS.ids[0]).email, title: 'Head Coach' });
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: CANONICAL_INELIGIBLE.EMAIL_POSITIVELY_ABSENT });
    expect(sends()).toBe(before);
    expect(composed).toEqual([]);
  });
});

describe('an activation hold (a coach newly eligible after 8D.3F)', () => {
  it('the coach is canonically eligible yet refused: held until send-time verification is authorised', () => {
    const r = row(HELD.ids[0]);
    expect(canonicalDecisions(db).byCoach.get(r.id).outreach_eligibility).toBe('YES');   // the engine would allow them
    expect(coachIneligibility(r)).toBe(`${CANONICAL_INELIGIBLE.ACTIVATION_HELD}:PENDING_SEND_TIME_VERIFICATION`);
    expect(applyCoachFloor([r])).toEqual([]);
    expect(staffIds(HELD)).toEqual([]);
  });
  it('cannot be written to through the send boundary', async () => {
    const before = sends();
    const { results } = await send(HELD, { name: 'Hal Held', email: row(HELD.ids[0]).email, title: 'Head Coach' });
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: `${CANONICAL_INELIGIBLE.ACTIVATION_HELD}:PENDING_SEND_TIME_VERIFICATION` });
    expect(sends()).toBe(before);
  });
  it('the legacy opt-in (THRIV3_ALLOW_LEGACY_COACHES) does not lift a hold, offered or sent', async () => {
    process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';
    expect(outreachIneligibility(row(HELD.ids[0]))).toBe(`${CANONICAL_INELIGIBLE.ACTIVATION_HELD}:PENDING_SEND_TIME_VERIFICATION`);
    expect(recipientIneligibility({ email: row(HELD.ids[0]).email, collegeName: HELD.name, sport: 'mens-soccer' })).toMatch(/^COACH_ACTIVATION_HELD/);
    expect(staffIds(HELD)).toEqual([]);
    const { results } = await send(HELD, { name: 'Hal Held', email: row(HELD.ids[0]).email, title: 'Head Coach' });
    expect(results[0].status).toBe('not-eligible');
  });
});

describe('the canonical decision at the send boundary', () => {
  it('an uncorroborated coach (verified address, no evidence they work there) is refused, also under the legacy opt-in', async () => {
    expect(coachIneligibility(row(UNCORR.ids[0]))).toBe(CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE);
    process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';
    const { results } = await send(UNCORR, { name: 'Una Uncorroborated', email: row(UNCORR.ids[0]).email, title: 'Head Coach' });
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE });
  });
  it('a coach the engine REASSIGNS to another institution is refused at the filed programme and not offered at the other', () => {
    expect(coachIneligibility(row(FROM.ids[0]))).toBe(CANONICAL_INELIGIBLE.CANONICAL_PROGRAMME_MISMATCH);
    expect(recipientIneligibility({ email: row(FROM.ids[0]).email, collegeName: FROM.name, sport: 'mens-soccer' })).toBe(CANONICAL_INELIGIBLE.CANONICAL_PROGRAMME_MISMATCH);
    expect(staffIds(FROM)).toEqual([]);
    expect(staffIds(TO)).toEqual([]);
  });
  it('a send naming an inactive (superseded or retired) programme row is refused', () => {
    expect(recipientIneligibility({ email: row(GONE.ids[0]).email, collegeName: GONE.name, sport: 'mens-soccer' })).toBe(INELIGIBLE.PROGRAMME_INACTIVE);
  });
  it('a corroborated, unheld coach is still offered and writable (nothing over-blocked)', async () => {
    expect(coachIneligibility(row(OK.ids[0]))).toBeNull();
    expect(staffIds(OK)).toEqual([OK.ids[0]]);
    const { results } = await send(OK, { name: 'Olive Okay', email: row(OK.ids[0]).email, title: 'Head Coach' });
    expect(results[0].status).toBe('drafted');
  });
});
