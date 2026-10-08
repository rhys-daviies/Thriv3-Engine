import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { corroborateFixtureCoaches } from '../testCanonicalCoaches.js';

/**
 * PHASE 1F (Step 8) — MANUAL OUTREACH TO A PROGRAMME INBOX, THROUGH THE ROUTE AND sendOutreach.
 *
 * The default coach floor is in force. A programme contact is offered and accepted ONLY as the
 * fallback (no eligible named coach), named BY ID, proved again at send time, drafted as a typed
 * PROGRAMME_INBOX relationship, and never turned into a coaches row. An address alone never
 * becomes an inbox. Outlook is mocked: nothing leaves the machine.
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

const T = '2026-09-20T10:00:00.000Z';
const ATH = 'mpc-athlete';
let baseUrl; let unit = 920000;

function programme(key, { coaches = [] } = {}) {
  unit += 1;
  const ent = `AE-U${unit}`; const host = `${key}athletics.example`; const name = `${key} College`;
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?, ?, ?, 'SINGLE', 'test', ?)").run(ent, name, unit, T);
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D3', 1, ?, ?)").run(`col-${key}`, T, T, name, unit, ent);
  db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, ?, 'VERIFIED', 'ATHLETICS_SITE', '[]', ?, 'TEST', 'CERTAIN', ?)").run(host, unit, JSON.stringify([unit]), T);
  coaches.forEach((c, i) => db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
    VALUES (?, ?, ?, ?, ?, 'NCAA D3', 'mens-soccer', 'Head Coach', ?, 'CURRENT')`).run(`co-${key}-${i}`, T, c.name, `coach${i}@${host}`, name, c.status ?? 'verified'));
  corroborateFixtureCoaches(db);
  const email = `msoccer@${host}`; const pc = programmeContactId(ent, 'mens-soccer', email);
  const seen = new Date(Date.now() - 3600_000).toISOString();
  db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, ?, 'TEAM_INBOX', ?, ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
    .run(pc, ent, `col-${key}`, email, `${name} Men's Soccer`, `https://${host}/sports/mens-soccer/coaches`, seen, seen, T, T);
  const relationshipId = upsertAthleteProgramme(ATH, { college_id: `col-${key}`, request_state: 'requested', requested_by: 'athlete' }).programme.id;
  return { name, host, email, pc, relationshipId };
}

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const BODY = 'Hi Coach,\n\nI am writing about Marcus Reyes.\n\nBest regards,\nThriv3';

let A; let B; let C;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api', manualOutreachRouter);
  await new Promise((resolve) => { const s = app.listen(0, () => { baseUrl = `http://127.0.0.1:${s.address().port}`; resolve(); }); s.unref(); });
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug, recruiting_class_year, email, video_id, video_chapters, graduation_year)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'Left Winger', 'mens-soccer', ?, 2027, 'a@example.com', 'aqz-KE-bpKQ', ?, 2027)`)
    .run(ATH, randomUUID().slice(0, 10), JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]));
  A = programme('alfa', { coaches: [{ name: 'Inez Inferred', status: 'inferred' }] });  // no eligible named coach
  B = programme('bravo', { coaches: [{ name: 'Vera Verified' }] });                   // an eligible named coach
  C = programme('charlie');                                                             // no staff at all
});
beforeEach(() => { composed.length = 0; });

describe('the manual picker offers a programme contact only as the fallback', () => {
  it('no eligible named coach -> "Programme Contact" is offered, with its programme as context', async () => {
    const { body } = await api('GET', `/api/players/${ATH}/programmes/${A.relationshipId}/outreach`);
    expect(body.coaches).toEqual([]);
    expect(body.programmeContact).toMatchObject({ programme_contact_id: A.pc, primary: 'Programme Contact', secondary: "alfa College Men's Soccer", isPerson: false, email: A.email });
  });
  it('an eligible named coach -> the coach is offered and the inbox is NOT', async () => {
    const { body } = await api('GET', `/api/players/${ATH}/programmes/${B.relationshipId}/outreach`);
    expect(body.coaches.map((c) => c.name)).toEqual(['Vera Verified']);
    expect(body.programmeContact).toBeNull();
  });
});

describe('POST: the programme contact, by id, drafted as a typed relationship with no coach row', () => {
  it('drafts to the inbox: typed outreach + send, "Hi Coach,", no coaches row minted', async () => {
    const coachesBefore = db.prepare('SELECT COUNT(*) n FROM coaches').get().n;
    const { status, body } = await api('POST', `/api/players/${ATH}/programmes/${A.relationshipId}/outreach`, { programmeContactId: A.pc, subject: 'Marcus Reyes | Winger | 2027', body: BODY, greetingName: 'Coach' });
    expect(status).toBe(200);
    expect(body.results).toEqual([expect.objectContaining({ email: A.email, name: 'Programme Contact', status: 'drafted' })]);
    expect(composed.map((m) => m.to)).toEqual([A.email]);
    const o = db.prepare('SELECT * FROM outreach WHERE athlete_id = ? AND programme_contact_id = ?').get(ATH, A.pc);
    expect(o).toMatchObject({ coach_id: null, programme_contact_id: A.pc });
    const s = db.prepare('SELECT * FROM outreach_send WHERE outreach_id = ?').get(o.id);
    expect(s).toMatchObject({ coach_id: null, programme_contact_id: A.pc, origin: 'manual' });
    expect(composed[0].body.split('\n')[0]).toBe('Hi Coach,');           // what the draft opened with
    expect(db.prepare('SELECT COUNT(*) n FROM coaches').get().n).toBe(coachesBefore);
  });
  it('refuses the inbox where an eligible named coach exists (no bypass of coach-first)', async () => {
    const { status, body } = await api('POST', `/api/players/${ATH}/programmes/${B.relationshipId}/outreach`, { programmeContactId: B.pc, subject: 's', body: BODY, greetingName: 'Coach' });
    expect(status).toBe(422);
    expect(body.code).toBe('PROGRAMME_INBOX_NOT_FALLBACK');
  });
  it('refuses another programme\'s inbox, and a mixed coach + inbox request', async () => {
    expect((await api('POST', `/api/players/${ATH}/programmes/${C.relationshipId}/outreach`, { programmeContactId: A.pc, subject: 's', body: BODY })).body.code).toBe('CAMPAIGN_PROGRAMME_MISMATCH');
    expect((await api('POST', `/api/players/${ATH}/programmes/${A.relationshipId}/outreach`, { programmeContactId: A.pc, coachIds: ['co-alfa-0'], subject: 's', body: BODY })).body.code).toBe('RECIPIENTS_MIXED');
  });
});

describe('sendOutreach is the boundary every path shares', () => {
  const base = (p, entry, over = {}) => ({ athleteId: ATH, coaches: [entry], subject: 'Marcus Reyes', body: BODY, greetingName: 'Coach', collegeName: p.name, division: 'NCAA D3', ...over });
  it('a body that greets a person is refused for an inbox, before anything is written', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n;
    const { results } = await sendOutreach(base(C, { programmeContactId: C.pc }, { body: 'Hi Vera,\n\nAbout Marcus.', greetingName: 'Vera' }));
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: 'INBOX_BODY_GREETING_NOT_NEUTRAL' });
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(before);
  });
  it('an address supplied without the contact id never becomes an inbox, and never a coach row', async () => {
    const { results } = await sendOutreach(base(C, { name: 'Somebody', email: C.email, title: 'Head Coach' }));
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: 'PROGRAMME_INBOX_ADDRESS_NOT_TYPED' });
    expect(db.prepare('SELECT COUNT(*) n FROM coaches WHERE lower(email) = ?').get(C.email).n).toBe(0);
  });
  it('a typed inbox that is suppressed is not drafted', async () => {
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES (?, 'unsubscribed', 'manual', ?)").run(C.email, T);
    const before = db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n;
    const { results } = await sendOutreach(base(C, { programmeContactId: C.pc }));
    expect(results[0].status).toBe('suppressed');
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(before);
    db.prepare('DELETE FROM suppressions WHERE email = ?').run(C.email);
  });
  it('a do-not-contact stance on the programme refuses the inbox draft', async () => {
    db.prepare("UPDATE athlete_programmes SET contact_stance = 'do_not_contact' WHERE id = ?").run(C.relationshipId);
    await expect(sendOutreach(base(C, { programmeContactId: C.pc }))).rejects.toThrow();
    db.prepare("UPDATE athlete_programmes SET contact_stance = 'default' WHERE id = ?").run(C.relationshipId);
  });
});
