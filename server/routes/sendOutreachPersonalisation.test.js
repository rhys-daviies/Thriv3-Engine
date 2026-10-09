import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { corroborateFixtureCoaches, seedFieldedProgramme } from '../testCanonicalCoaches.js';

/**
 * PHASE 1F.1 — EACH NAMED COACH IS GREETED BY THEIR OWN NAME.
 *
 * The composer renders ONE body for a multi-coach send, greeted with the seeded coach's name —
 * "Hi {{coach_name}}," (the default template: the full name) or "Hi {{coach_first_name}}," (the
 * structured composer: the first name). sendOutreach writes it to every selected coach, and its
 * personalise() rewrote only "Dear <full name>,", so a "Hi ..." greeting reached every coach
 * carrying the FIRST coach's name. These cases pin that, and the fix: the greeting line — and
 * only the greeting line — is re-rendered for each recipient, in the same form it was written in.
 *
 * The default coach floor is in force (verified coaches of the programme). Outlook is mocked and
 * the hosted handoff is read from the result: nothing leaves the machine.
 */
delete process.env.THRIV3_ALLOW_LEGACY_COACHES;

const composed = [];
const outlook = { available: true };
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => outlook.available,
  composeInOutlook: vi.fn(async (message) => { composed.push(message); return { ok: true, sent: false }; }),
}));

const db = (await import('../db/client.js')).default;
const { sendOutreach } = await import('./sendOutreach.js');
const { programmeContactId } = await import('../lib/programmeContactEligibility.js');

const T = '2026-09-20T10:00:00.000Z';
const COLLEGE = 'Personal College';
const ALEX = { name: 'Alex Smith', email: 'alex@personal.example', title: 'Head Coach' };
const JAMIE = { name: 'Jamie Jones', email: 'jamie@personal.example', title: 'Assistant Coach' };
const SAM = { name: 'Coach Sam', email: 'sam@personal.example', title: 'Assistant Coach' };   // no first name recognisable
const AFTER = '\n\nI\'m reaching out regarding Marcus Reyes, who admires Alex Smith\'s programme.\n\nBest regards,\nRhys Davies';
let athleteId;

function body(first) { return `${first}${AFTER}`; }
const to = (email) => composed.find((m) => m.to === email);

beforeAll(() => {
  athleteId = randomUUID();
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, graduation_year, email, video_id, video_chapters, public_slug, sport)
    VALUES (?, ?, ?, 'Marcus Reyes', 'Defender', 2027, 'a@example.com', 'aqz-KE-bpKQ', ?, ?, 'mens-soccer')`)
    .run(athleteId, T, T, JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]), randomUUID().slice(0, 10));
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active) VALUES ('col-personal', ?, ?, ?, 'mens-soccer', 'NCAA D1', 1)").run(T, T, COLLEGE);
  for (const [i, c] of [ALEX, JAMIE, SAM].entries()) {
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
      VALUES (?, ?, ?, ?, ?, 'NCAA D1', 'mens-soccer', ?, 'verified', 'CURRENT')`).run(`pc-${i}`, T, c.name, c.email, COLLEGE, c.title);
  }
  corroborateFixtureCoaches(db);
});
beforeEach(() => { composed.length = 0; outlook.available = true; db.prepare('DELETE FROM suppressions').run(); db.prepare('DELETE FROM athlete_programmes').run(); });

const send = (coaches, b, over = {}) => sendOutreach({
  athleteId, coaches, subject: 'Marcus Reyes | Defender | 2027', body: b, greetingName: coaches[0]?.name ?? 'Coach',
  collegeName: COLLEGE, division: 'NCAA D1', ...over,
});

describe('A–E. every named coach gets their own greeting, and nothing else changes', () => {
  it('A. one coach, "Hi <full name>," -> their greeting, untouched', async () => {
    await send([ALEX], body('Hi Alex Smith,'));
    expect(to(ALEX.email).body.split('\n')[0]).toBe('Hi Alex Smith,');
  });
  it('B/D. two coaches, default template ("Hi <full name>,") -> each their own; no leakage', async () => {
    await send([ALEX, JAMIE], body('Hi Alex Smith,'));
    expect(to(ALEX.email).body.split('\n')[0]).toBe('Hi Alex Smith,');
    expect(to(JAMIE.email).body.split('\n')[0]).toBe('Hi Jamie Jones,');
    expect(to(JAMIE.email).body).not.toMatch(/^Hi Alex/);
  });
  it('B/D. two coaches, structured greeting ("Hi <first name>,") -> each their own first name', async () => {
    await send([ALEX, JAMIE], body('Hi Alex,'));
    expect(to(ALEX.email).body.split('\n')[0]).toBe('Hi Alex,');
    expect(to(JAMIE.email).body.split('\n')[0]).toBe('Hi Jamie,');
  });
  it('B. a recipient with no recognisable first name falls back the way the composer does (the full name)', async () => {
    await send([ALEX, SAM], body('Hi Alex,'));
    expect(to(SAM.email).body.split('\n')[0]).toBe('Hi Coach Sam,');
  });
  it('C. "Dear <name>," -> each their own', async () => {
    await send([ALEX, JAMIE], body('Dear Alex Smith,'));
    expect(to(JAMIE.email).body.split('\n')[0]).toBe('Dear Jamie Jones,');
  });
  it('E. everything after the greeting line is byte-identical — including another mention of the first coach', async () => {
    await send([ALEX, JAMIE], body('Hi Alex Smith,'));
    // byte-for-byte after the greeting (each recipient's own tracking link and footer follow it)
    expect(to(ALEX.email).body.startsWith(`Hi Alex Smith,${AFTER}`)).toBe(true);
    expect(to(JAMIE.email).body.startsWith(`Hi Jamie Jones,${AFTER}`)).toBe(true);
    expect(to(JAMIE.email).body).toContain('who admires Alex Smith\'s programme');
  });
  it('E. an operator-edited greeting that names nobody selected is left exactly as written', async () => {
    await send([ALEX, JAMIE], body('Hello there,'));
    expect(to(JAMIE.email).body.split('\n')[0]).toBe('Hello there,');
  });
  it('F. the subject is unchanged', async () => {
    await send([ALEX, JAMIE], body('Hi Alex,'));
    expect(to(JAMIE.email).subject).toBe('Marcus Reyes | Defender | 2027');
  });
  it('N. the hosted handoff (no Outlook) carries the same per-recipient body', async () => {
    outlook.available = false;
    const { results } = await send([ALEX, JAMIE], body('Hi Alex,'));
    const handoff = (email) => results.find((r) => r.email === email)?.handoff;
    expect(handoff(JAMIE.email).body.split('\n')[0]).toBe('Hi Jamie,');
    expect(handoff(ALEX.email).body.split('\n')[0]).toBe('Hi Alex,');
  });
});

describe('G–M. the 1F rules and the safety rules are untouched', () => {
  let inbox;
  beforeAll(() => {
    // a second programme with no staff and a verified inbox, for the programme-contact cases
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-U910001', 'Inbox Personal', 910001, 'SINGLE', 'test', ?)").run(T);
    db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES ('col-ip', ?, ?, 'Inbox Personal', 'mens-soccer', 'NCAA D3', 1, 910001, 'AE-U910001')").run(T, T);
    seedFieldedProgramme(db, 'Inbox Personal', 'mens-soccer');   // DI-08: the recruitment-year gate's evidence
    db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES ('ipathletics.example', 910001, 'VERIFIED', 'ATHLETICS_SITE', '[]', '[910001]', 'TEST', 'CERTAIN', ?)").run(T);
    const email = 'msoccer@ipathletics.example'; const seen = new Date(Date.now() - 3600_000).toISOString();
    inbox = { id: programmeContactId('AE-U910001', 'mens-soccer', email), email };
    db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, 'AE-U910001', 'col-ip', 'mens-soccer', ?, 'Inbox Personal Men''s Soccer', 'TEAM_INBOX', 'https://ipathletics.example/sports/mens-soccer/coaches', ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`).run(inbox.id, email, seen, seen, T, T);
  });
  it('G. a programme contact is greeted "Hi Coach," and nothing else', async () => {
    await send([{ programmeContactId: inbox.id }], body('Hi Coach,'), { collegeName: 'Inbox Personal', greetingName: 'Coach' });
    expect(to(inbox.email).body.split('\n')[0]).toBe('Hi Coach,');
  });
  it('G. a programme contact never receives a coach\'s name, even if the operator\'s body carries one', async () => {
    const { results } = await send([{ programmeContactId: inbox.id }], body('Hi Alex Smith,'), { collegeName: 'Inbox Personal', greetingName: 'Alex Smith' });
    expect(results[0]).toMatchObject({ status: 'not-eligible', reason: 'INBOX_BODY_GREETING_NOT_NEUTRAL' });
    expect(composed).toHaveLength(0);
  });
  it('H. a coach and a programme contact in one manual run: the inbox is refused (a named coach exists), the coach is greeted by name', async () => {
    const { results } = await send([ALEX, { programmeContactId: inbox.id }], body('Hi Alex Smith,'));
    expect(results.find((r) => r.recipientKind === 'PROGRAMME_INBOX')?.status).toBe('not-eligible');
    expect(composed.map((m) => m.to)).toEqual([ALEX.email]);
  });
  it('I. a bare inbox address stays refused', async () => {
    const { results } = await send([ALEX, { name: 'Someone', email: inbox.email, title: 'Head Coach' }], body('Hi Alex Smith,'));
    expect(results.find((r) => r.email === inbox.email)).toMatchObject({ status: 'not-eligible', reason: 'PROGRAMME_INBOX_ADDRESS_NOT_TYPED' });
  });
  it('J. an unknown address is refused, not turned into a coach or an inbox', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM coaches').get().n;
    const { results } = await send([ALEX, { name: 'Pat Unknown', email: 'pat@nowhere.example', title: 'Head Coach' }], body('Hi Alex Smith,'));
    expect(results.find((r) => r.email === 'pat@nowhere.example')).toMatchObject({ status: 'not-eligible', reason: 'UNKNOWN_ADDRESS' });
    expect(db.prepare('SELECT COUNT(*) n FROM coaches').get().n).toBe(before);
    expect(composed.map((m) => m.to)).toEqual([ALEX.email]);
  });
  it('K/M. a suppressed coach is skipped and the other is still greeted by their own name', async () => {
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES (?, 'unsubscribed', 'manual', ?)").run(ALEX.email, T);
    const { results } = await send([ALEX, JAMIE], body('Hi Alex Smith,'));
    expect(results.find((r) => r.email === ALEX.email).status).toBe('suppressed');
    expect(composed.map((m) => m.to)).toEqual([JAMIE.email]);
    expect(to(JAMIE.email).body.split('\n')[0]).toBe('Hi Jamie Jones,');
  });
  it('L. do-not-contact still refuses the whole run', async () => {
    db.prepare(`INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged, visibility, contact_stance, created_at, updated_at)
      VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', 'do_not_contact', ?, ?)`).run(randomUUID(), athleteId, COLLEGE, T, T);
    await expect(send([ALEX, JAMIE], body('Hi Alex Smith,'))).rejects.toThrow();
    expect(composed).toHaveLength(0);
  });
});
