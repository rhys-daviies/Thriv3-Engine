import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { corroborateFixtureCoaches } from '../testCanonicalCoaches.js';

/**
 * THE SEND FLOOR ENFORCES THE CANONICAL DECISION AND THE ACTIVATION HOLDS — Phase 1G-D close-out.
 *
 * The 8D.3F hand-off: a coach whose recorded address is POSITIVELY ABSENT from their own official
 * page (Brosnihan) passed this branch's floor, because the floor checked only "verified and not
 * PROVEN_STALE". Every outreach path read that floor. Each test below tries to reach a held or
 * canonically ineligible coach through a different door — the manual picker, the manual send
 * boundary (sendOutreach, which the /send route and the manual composer share), the programme
 * inbox fallback, the legacy opt-in — and is refused. The campaign plan and the claim of an
 * already-prepared campaign message are covered in coachOutreachRefusal.test.js.
 * Outlook is mocked: nothing leaves the machine.
 */
delete process.env.THRIV3_ALLOW_LEGACY_COACHES;

const composed = [];
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => { composed.push(message); return { ok: true, sent: false }; }),
}));

const db = (await import('../db/client.js')).default;
const { manualOutreachRouter } = await import('./manualOutreach.js');
const { sendOutreach } = await import('./sendOutreach.js');
const { upsertAthleteProgramme } = await import('../lib/athleteProgrammes.js');
const { programmeContactId } = await import('../lib/programmeContactEligibility.js');
const { coachIneligibility, outreachIneligibility, recipientIneligibility, applyCoachFloor, INELIGIBLE } = await import('../lib/coachEligibility.js');
const { manualRecipientChoice, INBOX_NOT_SELECTED } = await import('../lib/recipientSelection.js');
const { activationHolds, activationHold, canonicalDecisions, CANONICAL_INELIGIBLE } = await import('../lib/canonicalCoachEligibility.js');
const { programmeCoaches } = await import('./programmeCoaches.js');

const T = '2026-09-20T10:00:00.000Z';
const ATH = 'floor-athlete';
const BODY = 'Hi Coach,\n\nI am writing about Marcus Reyes.\n\nBest regards,\nThriv3';
const SEED = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/seeds/coach_activation_holds.json'), 'utf8'));
const heldId = (kind) => SEED.holds.find((h) => h.hold === kind).coach_id;
let baseUrl; let unit = 930000;

/** One programme with a corroborated staff (canonically eligible unless a test says otherwise) and an inbox. */
function programme(key, { coaches = [], inbox = true, corroborate = true, active = 1 } = {}) {
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
  let pc = null; const email = `msoccer@${host}`;
  if (inbox) {
    pc = programmeContactId(ent, 'mens-soccer', email);
    const seen = new Date(Date.now() - 3600_000).toISOString();
    db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, ?, ?, 'mens-soccer', ?, ?, 'TEAM_INBOX', ?, ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
      .run(pc, ent, `col-${key}`, email, `${name} Men's Soccer`, `https://${host}/sports/mens-soccer/coaches`, seen, seen, T, T);
  }
  // an inactive programme cannot be on an athlete's list (athleteProgrammes refuses it), which is the point of that fixture
  const relationshipId = active ? upsertAthleteProgramme(ATH, { college_id: `col-${key}`, request_state: 'requested', requested_by: 'athlete' }).programme.id : null;
  return { name, host, unit, email, pc, ids, relationshipId };
}

/** A qualifying positive email absence, exactly as the 8D.3D composite writer records one. */
function recordAbsence(coachId, p) {
  const c = db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
  const observedAt = '2026-10-01T12:00:00.000Z';                     // cycle 2026
  const src = `https://${p.host}/sports/mens-soccer/coaches`;
  const sha = createHash('sha256').update(`page-${coachId}`).digest('hex');
  const oid = createHash('sha256').update([coachId, c.email.toLowerCase(), src, sha].join('|')).digest('hex');
  db.prepare(`INSERT INTO coach_email_absence_observations (observation_id, coach_id, email, observed_at, page_season, source_url, source_host, page_unitid, page_sport,
      parser_version, evidence_sha256, parse_status, staff_records, emails_published, coach_name_found, coach_email_found, other_email_for_coach, fixture_hash, action_id, recorded_at)
    VALUES (?, ?, ?, ?, 2026, ?, ?, ?, 'mens-soccer', 'sidearm-staff-2', ?, 'COMPLETE', 4, 3, 1, 0, ?, 'test-fixture', 'test-action', ?)`)
    .run(oid, coachId, c.email.toLowerCase(), observedAt, src, p.host, p.unit, sha, `other.${c.email}`, T);
}

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const sends = () => db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n;
const send = (p, entry) => sendOutreach({ athleteId: ATH, coaches: [entry], subject: 'Marcus Reyes', body: BODY, greetingName: 'Coach', collegeName: p.name, division: 'NCAA D3' });
const row = (id) => db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);

let ABS; let HELD; let STALE; let UNCORR; let OK; let FROM; let TO; let OPT; let GONE;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api', manualOutreachRouter);
  await new Promise((resolve) => { const s = app.listen(0, () => { baseUrl = `http://127.0.0.1:${s.address().port}`; resolve(); }); s.unref(); });
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug, recruiting_class_year, email, video_id, video_chapters, graduation_year)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'Left Winger', 'mens-soccer', ?, 2027, 'a@example.com', 'aqz-KE-bpKQ', ?, 2027)`)
    .run(ATH, randomUUID().slice(0, 10), JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]));
  ABS = programme('absent', { coaches: [{ name: 'Abby Absent' }] });                                           // absence recorded in the test
  HELD = programme('held', { coaches: [{ id: heldId('PENDING_SEND_TIME_VERIFICATION'), name: 'Hal Held' }] });   // a real 8D.3F newly eligible id
  STALE = programme('stale', { coaches: [{ id: heldId('PROVEN_STALE'), name: 'Sam Stale', currentness: 'PROVEN_STALE' }] });
  UNCORR = programme('uncorr', { coaches: [{ name: 'Una Uncorroborated' }], corroborate: false });
  OK = programme('okay', { coaches: [{ name: 'Olive Okay' }] });
  OPT = programme('optout', { coaches: [{ name: 'Otto Optout' }] });
  GONE = programme('gone', { coaches: [{ name: 'Gus Gone' }], inbox: false, active: 0 });
  // a coach filed at FROM whose own mail domain and identity place them at TO: the engine REASSIGNS
  TO = programme('target', { coaches: [], inbox: false });
  FROM = programme('filed', { coaches: [{ name: 'Rita Reassigned', email: `rita@${'target'}athletics.example` }], inbox: false, corroborate: false });
  db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, method, imported_at) VALUES (?, 'mens-soccer', 1901, 'Rita Reassigned', 'test-fixture', ?)").run(TO.name, T);
});
beforeEach(() => { composed.length = 0; });
afterEach(() => { delete process.env.THRIV3_ALLOW_LEGACY_COACHES; });

describe('the holds file', () => {
  it('lists the 8D.3F hand-off: 131 newly eligible (129 pending + 2 caution), the absence coach and the 3 proven stale', () => {
    expect(SEED.counts).toEqual({ PENDING_SEND_TIME_VERIFICATION: 129, ACTIVATION_CAUTION: 2, POSITIVE_EMAIL_ABSENCE: 1, PROVEN_STALE: 3, PROGRAMME_NOT_FIELDED: 2 });
    expect(new Set(SEED.holds.map((h) => h.coach_id)).size).toBe(137);
    expect(activationHold('647c575f-b199-4669-9dff-3542cd607029')).toMatchObject({ hold: 'POSITIVE_EMAIL_ABSENCE' });
    expect(activationHolds().size).toBe(137);
  });
  it('holds the 2 DI-08 protective coaches whose filed programme is not fielded in 2026 (ENMU men\'s, UW-Oshkosh men\'s)', () => {
    for (const id of ['2aeeace0-9bb5-4252-b303-37f459247e2b', '9188175f-39c3-4288-ab07-28b7802b0d71']) {
      expect(activationHold(id)).toMatchObject({ coach_id: id, hold: 'PROGRAMME_NOT_FIELDED' });
    }
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
    // a well-formed file holds exactly its coaches
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
    recordAbsence(id, ABS);
    expect(coachIneligibility(row(id))).toBe(CANONICAL_INELIGIBLE.EMAIL_POSITIVELY_ABSENT);
  });
  it('is not offered by the manual picker, and does NOT open the inbox fallback in their place', async () => {
    const choice = manualRecipientChoice({ collegeName: ABS.name, sport: 'mens-soccer' });
    expect(choice.kind).toBe('NO_RECIPIENT');
    expect(choice.inbox.blockedBy).toBe(INBOX_NOT_SELECTED.NAMED_COACH_HELD);
    const { body } = await api('GET', `/api/players/${ATH}/programmes/${ABS.relationshipId}/outreach`);
    expect(body.coaches).toEqual([]);
    expect(body.programmeContact).toBeNull();
  });
  it('cannot be written to directly, by id or by address, and nothing is drafted', async () => {
    const before = sends();
    const { results } = await send(ABS, { name: 'Abby Absent', email: row(ABS.ids[0]).email, title: 'Head Coach' });
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: CANONICAL_INELIGIBLE.EMAIL_POSITIVELY_ABSENT });
    const viaRoute = await api('POST', `/api/players/${ATH}/programmes/${ABS.relationshipId}/outreach`, { coachIds: [ABS.ids[0]], subject: 's', body: BODY, greetingName: 'Coach' });
    expect(viaRoute.status === 422 || viaRoute.body.results?.every((r) => r.status !== 'drafted')).toBe(true);
    expect(sends()).toBe(before);
    expect(composed).toEqual([]);
  });
  it('the programme inbox cannot be used to route around them', async () => {
    const { status, body } = await api('POST', `/api/players/${ATH}/programmes/${ABS.relationshipId}/outreach`, { programmeContactId: ABS.pc, subject: 's', body: BODY, greetingName: 'Coach' });
    expect(status).toBe(422);
    expect(body.code).toBe(INBOX_NOT_SELECTED.NAMED_COACH_HELD);
    expect(composed).toEqual([]);
  });
});

describe('an activation hold (a coach newly eligible after 8D.3F)', () => {
  it('the coach is canonically eligible yet refused: held until send-time verification is authorised', () => {
    const r = row(HELD.ids[0]);
    expect(canonicalDecisions(db).byCoach.get(r.id).outreach_eligibility).toBe('YES');   // the engine would allow them
    expect(coachIneligibility(r)).toBe(`${CANONICAL_INELIGIBLE.ACTIVATION_HELD}:PENDING_SEND_TIME_VERIFICATION`);
    expect(applyCoachFloor([r])).toEqual([]);
    expect(programmeCoaches({ collegeName: HELD.name, sport: 'mens-soccer' })).toEqual([]);
  });
  it('is not selected, blocks the inbox fallback, and cannot be written to directly', async () => {
    const choice = manualRecipientChoice({ collegeName: HELD.name, sport: 'mens-soccer' });
    expect(choice).toMatchObject({ kind: 'NO_RECIPIENT', inbox: { blockedBy: INBOX_NOT_SELECTED.NAMED_COACH_HELD } });
    const before = sends();
    const { results } = await send(HELD, { name: 'Hal Held', email: row(HELD.ids[0]).email, title: 'Head Coach' });
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: `${CANONICAL_INELIGIBLE.ACTIVATION_HELD}:PENDING_SEND_TIME_VERIFICATION` });
    const inbox = await api('POST', `/api/players/${ATH}/programmes/${HELD.relationshipId}/outreach`, { programmeContactId: HELD.pc, subject: 's', body: BODY, greetingName: 'Coach' });
    expect(inbox.body.code).toBe(INBOX_NOT_SELECTED.NAMED_COACH_HELD);
    expect(sends()).toBe(before);
  });
  it('the legacy opt-in (THRIV3_ALLOW_LEGACY_COACHES) does not lift a hold', async () => {
    process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';
    expect(outreachIneligibility(row(HELD.ids[0]))).toBe(`${CANONICAL_INELIGIBLE.ACTIVATION_HELD}:PENDING_SEND_TIME_VERIFICATION`);
    expect(recipientIneligibility({ email: row(HELD.ids[0]).email, collegeName: HELD.name, sport: 'mens-soccer' })).toMatch(/^COACH_ACTIVATION_HELD/);
    const { results } = await send(HELD, { name: 'Hal Held', email: row(HELD.ids[0]).email, title: 'Head Coach' });
    expect(results[0].status).toBe('not-eligible');
    expect(manualRecipientChoice({ collegeName: HELD.name, sport: 'mens-soccer' }).recipients).toEqual([]);
  });
  it('a PROVEN_STALE hold is a departure: refused, and the inbox fallback works as before', () => {
    expect(coachIneligibility(row(STALE.ids[0]))).toBe('COACH_PROVEN_STALE');
    const choice = manualRecipientChoice({ collegeName: STALE.name, sport: 'mens-soccer' });
    expect(choice.kind).toBe('PROGRAMME_INBOX');
    expect(choice.recipients[0].programmeContactId).toBe(STALE.pc);
  });
});

describe('the canonical decision itself', () => {
  it('an uncorroborated coach (verified address, no evidence they work there) is refused; the inbox fallback is unchanged', () => {
    expect(coachIneligibility(row(UNCORR.ids[0]))).toBe(CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE);
    const choice = manualRecipientChoice({ collegeName: UNCORR.name, sport: 'mens-soccer' });
    expect(choice.kind).toBe('PROGRAMME_INBOX');
  });
  it('a coach the engine REASSIGNS to another institution is refused at the filed programme and not activated at the other', () => {
    expect(coachIneligibility(row(FROM.ids[0]))).toBe(CANONICAL_INELIGIBLE.CANONICAL_PROGRAMME_MISMATCH);
    expect(manualRecipientChoice({ collegeName: FROM.name, sport: 'mens-soccer' }).recipients).toEqual([]);
    expect(manualRecipientChoice({ collegeName: TO.name, sport: 'mens-soccer' }).recipients).toEqual([]);
  });
  it('a send naming an inactive (superseded or retired) programme row is refused', () => {
    expect(recipientIneligibility({ email: row(GONE.ids[0]).email, collegeName: GONE.name, sport: 'mens-soccer' })).toBe(INELIGIBLE.PROGRAMME_INACTIVE);
  });
  it('a corroborated, unheld coach is still offered first, ahead of the inbox (coach-first unchanged)', async () => {
    expect(coachIneligibility(row(OK.ids[0]))).toBeNull();
    const choice = manualRecipientChoice({ collegeName: OK.name, sport: 'mens-soccer' });
    expect(choice).toMatchObject({ kind: 'COACH', inbox: { blockedBy: INBOX_NOT_SELECTED.NAMED_COACH_AVAILABLE } });
    const { body } = await api('GET', `/api/players/${ATH}/programmes/${OK.relationshipId}/outreach`);
    expect(body.coaches.map((c) => c.name)).toEqual(['Olive Okay']);
    expect(body.programmeContact).toBeNull();
  });
});

describe('suppression and opt-out are unchanged', () => {
  it('a suppressed eligible coach is not offered, and their opt-out still blocks the inbox', () => {
    const email = row(OPT.ids[0]).email;
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES (?, 'unsubscribed', 'manual', ?)").run(email, T);
    const choice = manualRecipientChoice({ collegeName: OPT.name, sport: 'mens-soccer' });
    expect(choice).toMatchObject({ kind: 'NO_RECIPIENT', inbox: { blockedBy: INBOX_NOT_SELECTED.COACH_OPTED_OUT_AT_PROGRAMME } });
    db.prepare('DELETE FROM suppressions WHERE email = ?').run(email);
  });
  it('a suppressed programme inbox is still refused where it would otherwise be the fallback', () => {
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES (?, 'unsubscribed', 'manual', ?)").run(UNCORR.email, T);
    expect(manualRecipientChoice({ collegeName: UNCORR.name, sport: 'mens-soccer' }).kind).toBe('NO_RECIPIENT');
    db.prepare('DELETE FROM suppressions WHERE email = ?').run(UNCORR.email);
  });
});

describe('the send boundary itself (also on main, PR #64)', () => {
  it('an uncorroborated coach cannot be written to, also under the legacy opt-in', async () => {
    process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';
    const { results } = await send(UNCORR, { name: 'Una Uncorroborated', email: row(UNCORR.ids[0]).email, title: 'Head Coach' });
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: CANONICAL_INELIGIBLE.NOT_CANONICALLY_ELIGIBLE });
  });
  it('a corroborated, unheld coach is still writable (nothing over-blocked)', async () => {
    const { results } = await send(OK, { name: 'Olive Okay', email: row(OK.ids[0]).email, title: 'Head Coach' });
    expect(results[0].status).toBe('drafted');
  });
});

