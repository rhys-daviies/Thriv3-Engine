import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { corroborateFixtureCoaches } from '../testCanonicalCoaches.js';

/**
 * CONTACT SAFETY — Phase 5, PR A (docs/IMMEDIATE_CHANGES_ROADMAP.md).
 *
 *   #2  An operator records an opt-out from the app, through the existing
 *       `suppress()`: keyed on the address the outreach names, idempotent,
 *       first record wins, and the next send to it is refused.
 *   #3  An opted-out coach or inbox is never OFFERED (coach list, programme
 *       contacts, manual picker), and is named - never addressed - as left out.
 *   #10 When nobody can be written to, the reason given is the hierarchy's own:
 *       a held coach, a coach's opt-out, unverified staff, a stale inbox, or
 *       nothing on file.
 *
 * Outlook is mocked: nothing leaves the machine.
 */
delete process.env.THRIV3_ALLOW_LEGACY_COACHES;
process.env.THRIV3_SCRYPT_COST = '14';
process.env.THRIV3_SESSION_SECRET = `p5a-${'k'.repeat(40)}`;
process.env.THRIV3_APP_ORIGIN = 'http://localhost:5185';
process.env.THRIV3_REPORT_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-p5a-'));

const composed = [];
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => { composed.push(message); return { ok: true, sent: false }; }),
}));

const ORIGIN = 'http://localhost:5185';
const { default: app } = await import('../index.js');
const db = (await import('../db/client.js')).default;
const { createOperator, resetLoginLimits } = await import('../lib/operatorAuth.js');
const { upsertAthleteProgramme } = await import('../lib/athleteProgrammes.js');
const { programmeContactId } = await import('../lib/programmeContactEligibility.js');
const { isSuppressed } = await import('../lib/suppressions.js');
const { coachEngagement } = await import('../lib/engagementQueries.js');
const { recordOptOut, OptOutError } = await import('../lib/optOut.js');
const { explainNoManualRecipient, NO_RECIPIENT_REASON } = await import('../lib/recipientExplanation.js');

const SEED = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/seeds/coach_activation_holds.json'), 'utf8'));
const HELD_ID = SEED.holds.find((h) => h.hold === 'PENDING_SEND_TIME_VERIFICATION').coach_id;

const T = '2026-09-20T10:00:00.000Z';
const ATH = 'p5a-athlete';
const BODY = 'Hi Coach,\n\nI am writing about Marcus Reyes.\n\nBest regards,\nThriv3';
let server; let base; let cookie; let unit = 950000;

/** One programme: staff (corroborated unless told otherwise) and, optionally, an inbox. */
function programme(key, { coaches = [], inbox = 'current' } = {}) {
  unit += 1;
  const ent = `AE-U${unit}`; const host = `${key}athletics.example`; const name = `${key} College`;
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?, ?, ?, 'SINGLE', 'test', ?)").run(ent, name, unit, T);
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D3', 1, ?, ?)").run(`col-${key}`, T, T, name, unit, ent);
  db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, ?, 'VERIFIED', 'ATHLETICS_SITE', '[]', ?, 'TEST', 'CERTAIN', ?)").run(host, unit, JSON.stringify([unit]), T);
  const ids = coaches.map((c, i) => {
    const id = c.id || `co-${key}-${i}`;
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
      VALUES (?, ?, ?, ?, ?, 'NCAA D3', 'mens-soccer', 'Head Coach', ?, 'CURRENT')`).run(id, T, c.name, `coach${i}@${host}`, name, c.status ?? 'verified');
    return id;
  });
  corroborateFixtureCoaches(db, { ids });
  const email = `msoccer@${host}`; const pc = programmeContactId(ent, 'mens-soccer', email);
  if (inbox) {
    // 'current' = seen an hour ago; 'stale' = seen long ago, so the floor refuses it as not current.
    const seen = inbox === 'stale' ? '2020-01-01T00:00:00.000Z' : new Date(Date.now() - 3600_000).toISOString();
    db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, ?, ?, 'mens-soccer', ?, ?, 'TEAM_INBOX', ?, ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
      .run(pc, ent, `col-${key}`, email, `${name} Men's Soccer`, `https://${host}/sports/mens-soccer/coaches`, seen, seen, T, T);
  }
  const relationshipId = upsertAthleteProgramme(ATH, { college_id: `col-${key}`, request_state: 'requested', requested_by: 'athlete' }).programme.id;
  return { key, name, host, email, pc, relationshipId, coachEmail: (i = 0) => `coach${i}@${host}` };
}

const api = (method, url, body) => fetch(`${base}${url}`, {
  method,
  headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const context = (p) => api('GET', `/api/players/${ATH}/programmes/${p.relationshipId}/outreach`).then((r) => r.body);
const draftTo = (p, body) => api('POST', `/api/players/${ATH}/programmes/${p.relationshipId}/outreach`, { subject: 'Marcus Reyes', body: BODY, greetingName: 'Coach', ...body });
const outreachFor = (email) => db.prepare(`SELECT o.* FROM outreach o
  LEFT JOIN coaches c ON c.id = o.coach_id LEFT JOIN programme_contacts pc ON pc.contact_id = o.programme_contact_id
  WHERE o.athlete_id = ? AND lower(COALESCE(c.email, pc.email)) = ?`).get(ATH, email);

let P = {};
beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  resetLoginLimits();
  await createOperator({ email: 'p5a-operator@example.test', password: 'a-perfectly-fine-passphrase' });
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: 'p5a-operator@example.test', password: 'a-perfectly-fine-passphrase' }),
  });
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug, recruiting_class_year, email, video_id, video_chapters, graduation_year)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'W', 'mens-soccer', ?, 2027, 'a@example.test', 'aqz-KE-bpKQ', ?, 2027)`)
    .run(ATH, randomUUID().slice(0, 10), JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]));
  P = {
    vera: programme('vera', { coaches: [{ name: 'Vera Verified' }, { name: 'Otto Other' }] }),
    optout: programme('optout', { coaches: [{ name: 'Olive Optout' }] }),
    inferred: programme('inferred', { coaches: [{ name: 'Inez Inferred', status: 'inferred' }], inbox: null }),
    held: programme('held', { coaches: [{ id: HELD_ID, name: 'Hal Held' }] }),
    empty: programme('empty', { inbox: null }),
    stale: programme('stale', { inbox: 'stale' }),
    inboxOut: programme('inboxout'),
  };
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { composed.length = 0; });

describe('#2 recording an opt-out from the app', () => {
  it('suppresses the address the outreach names; the next draft to it is refused, and nothing is composed', async () => {
    expect((await draftTo(P.vera, { coachIds: ['co-vera-0'] })).status).toBe(200);
    const o = outreachFor(P.vera.coachEmail(0));
    expect(isSuppressed(P.vera.coachEmail(0))).toBe(false);

    const res = await api('POST', `/api/engagement/outreach/${o.id}/opt-out`, { reason: 'unsubscribed', note: 'replied 9 Oct: please remove me' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ optedOut: true, alreadyRecorded: false, reason: 'unsubscribed' });
    expect(isSuppressed(P.vera.coachEmail(0))).toBe(true);
    const row = db.prepare('SELECT * FROM suppressions WHERE email = ?').get(P.vera.coachEmail(0));
    expect(row).toMatchObject({ source: 'manual', outreach_token: o.token });
    expect(row.note).toBe('replied 9 Oct: please remove me (recorded in app by p5a-operator@example.test)');

    composed.length = 0;
    const again = await api('POST', '/api/outreach/send', {
      athleteId: ATH, coaches: [{ name: 'Vera Verified', email: P.vera.coachEmail(0), title: 'Head Coach' }],
      subject: 's', body: BODY, greetingName: 'Coach', collegeName: P.vera.name, division: 'NCAA D3',
    });
    expect(again.body.results[0].status).toBe('suppressed');
    expect(composed).toEqual([]);
  });

  it('is idempotent: a second record keeps the first date and says it was already recorded', async () => {
    const o = outreachFor(P.vera.coachEmail(0));
    const first = db.prepare('SELECT created_at FROM suppressions WHERE email = ?').get(P.vera.coachEmail(0)).created_at;
    const res = await api('POST', `/api/engagement/outreach/${o.id}/opt-out`, { reason: 'manual' });
    expect(res.body).toMatchObject({ alreadyRecorded: true, recordedAt: first, reason: 'unsubscribed' });
    expect((await api('GET', `/api/engagement/outreach/${o.id}/opt-out`)).body).toMatchObject({ optedOut: true, recordedAt: first });
  });

  it('shows on the Engagement tab row, for this and every other athlete', () => {
    const rows = coachEngagement(ATH);
    expect(rows.find((r) => r.outreach_id === outreachFor(P.vera.coachEmail(0)).id).opted_out).toBe(1);
  });

  it('refuses an unknown outreach, an unknown reason, and a request that names an address', async () => {
    expect((await api('POST', '/api/engagement/outreach/nope/opt-out', {})).status).toBe(404);
    const o = outreachFor(P.vera.coachEmail(0));
    expect((await api('POST', `/api/engagement/outreach/${o.id}/opt-out`, { reason: 'bounced' })).body.code).toBe('UNKNOWN_REASON');
    // An address in the body is ignored: only the relationship's own recipient is ever suppressed.
    expect(() => recordOptOut(o.id, { reason: 'unsubscribed', email: 'someone-else@example.test' })).not.toThrow();
    expect(isSuppressed('someone-else@example.test')).toBe(false);
    expect(() => recordOptOut('nope')).toThrow(OptOutError);
  });

  it('requires a signed-in operator', async () => {
    const o = outreachFor(P.vera.coachEmail(0));
    const res = await fetch(`${base}/api/engagement/outreach/${o.id}/opt-out`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
  });
});

describe('final safety check: the send-time refusal, the resolved recipient, the original date', () => {
  it('a stale Top 100 / bulk list holding a suppressed address: refused at send time, the others still prepared', async () => {
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES (?, 'unsubscribed', 'manual', ?) ON CONFLICT(email) DO NOTHING").run(P.vera.coachEmail(0), T);
    for (const send of [false, true]) {
      composed.length = 0;
      const res = await api('POST', '/api/outreach/send', {
        athleteId: ATH, send,
        coaches: [
          { name: 'Vera Verified', email: P.vera.coachEmail(0), title: 'Head Coach' },  // opted out, still on the stale list
          { name: 'Otto Other', email: P.vera.coachEmail(1), title: 'Head Coach' },
        ],
        subject: 's', body: BODY, greetingName: 'Coach', collegeName: P.vera.name, division: 'NCAA D3',
      });
      const byEmail = Object.fromEntries(res.body.results.map((r) => [r.email, r.status]));
      expect(byEmail[P.vera.coachEmail(0)]).toBe('suppressed');
      // The eligible coach on the same list is processed on its own merits, not refused as opted
      // out. (In this test there is no edge service to make its profile link live, so it stops
      // at 'link-not-activated' - the existing safeguard, unrelated to suppression.)
      expect(byEmail[P.vera.coachEmail(1)]).not.toBe('suppressed');
      // Outlook is never asked to compose, let alone send, to the opted-out address.
      expect(composed.map((m) => m.to)).not.toContain(P.vera.coachEmail(0));
    }
  });

  it('opting out an inbox relationship suppresses that inbox and nobody else at the programme', async () => {
    const p = programme('inboxonly');
    expect((await draftTo(p, { programmeContactId: p.pc })).status).toBe(200);
    const o = outreachFor(p.email);
    expect((await api('POST', `/api/engagement/outreach/${o.id}/opt-out`, { reason: 'unsubscribed' })).status).toBe(200);
    expect(isSuppressed(p.email)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) n FROM suppressions WHERE email LIKE ?').get(`%@${p.host}`).n).toBe(1);
  });

  it('an opt-out already on file (e.g. from the CLI or the edge) keeps its original date, reason and source', async () => {
    const p = programme('preexisting', { coaches: [{ name: 'Pat Prior' }] });
    expect((await draftTo(p, { coachIds: ['co-preexisting-0'] })).status).toBe(200);
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at, note) VALUES (?, 'unsubscribed', 'edge', '2026-01-02T03:04:05.000Z', 'from the edge')").run(p.coachEmail(0));
    const o = outreachFor(p.coachEmail(0));
    const res = await api('POST', `/api/engagement/outreach/${o.id}/opt-out`, { reason: 'manual', note: 'again' });
    expect(res.body).toMatchObject({ alreadyRecorded: true, recordedAt: '2026-01-02T03:04:05.000Z', reason: 'unsubscribed' });
    expect(db.prepare('SELECT * FROM suppressions WHERE email = ?').get(p.coachEmail(0)))
      .toMatchObject({ created_at: '2026-01-02T03:04:05.000Z', reason: 'unsubscribed', source: 'edge', note: 'from the edge' });
  });

  it('GET and POST both require a signed-in operator', async () => {
    const o = outreachFor(P.vera.coachEmail(0));
    for (const method of ['GET', 'POST']) {
      const r = await fetch(`${base}/api/engagement/outreach/${o.id}/opt-out`, {
        method, headers: { origin: ORIGIN, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(r.status).toBe(401);
    }
  });
});

describe('#3 an opted-out contact is never offered, and is named as left out', () => {
  it('the coach list leaves the opted-out coach out, names them, and never sends their address', async () => {
    const { body } = await api('GET', '/api/colleges/col-vera/coaches');
    expect(body.coaches.map((c) => c.name)).toEqual(['Otto Other']);
    expect(body.optedOut).toEqual([{ coach_id: 'co-vera-0', name: 'Vera Verified', title: 'Head Coach' }]);
    expect(JSON.stringify(body.optedOut)).not.toContain('@');
  });

  it('the manual picker does the same', async () => {
    const ctx = await context(P.vera);
    expect(ctx.coaches.map((c) => c.name)).toEqual(['Otto Other']);
    expect(ctx.optedOutCoaches.map((c) => c.name)).toEqual(['Vera Verified']);
    expect(ctx.noRecipient).toBeNull();
  });

  it('an opted-out programme inbox is not listed as a contact, and is counted apart from ineligible ones', async () => {
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES (?, 'unsubscribed', 'manual', ?)").run(P.inboxOut.email, T);
    const { body } = await api('GET', '/api/colleges/col-inboxout/programme-contacts');
    expect(body.contacts).toEqual([]);
    expect(body).toMatchObject({ optedOut: 1, withheld: 0 });
    // and the manual picker does not offer it either
    expect((await context(P.inboxOut)).programmeContact).toBeNull();
  });
});

describe('#10 when nobody can be written to, the reason is the hierarchy\'s own', () => {
  it('a coach\'s opt-out also stops the programme inbox being used in their place', async () => {
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES (?, 'unsubscribed', 'manual', ?)").run(P.optout.coachEmail(0), T);
    const ctx = await context(P.optout);
    expect(ctx.coaches).toEqual([]);
    expect(ctx.programmeContact).toBeNull();
    expect(ctx.noRecipient.reason).toBe(NO_RECIPIENT_REASON.COACH_OPTED_OUT);
    expect(ctx.noRecipient.summary).toMatch(/opted out/);
    expect(ctx.noRecipient.details).toContain('1 coach has opted out of Thriv3 email');
  });

  it('a held coach pauses the programme: no inbox in their place, and the hold is named', async () => {
    const ctx = await context(P.held);
    expect(ctx.coaches).toEqual([]);
    expect(ctx.programmeContact).toBeNull();
    expect(ctx.noRecipient.reason).toBe(NO_RECIPIENT_REASON.NAMED_COACH_HELD);
    expect(ctx.noRecipient.details).toContain('1 coach is paused by an activation hold');
  });

  it('unverified staff and no inbox: says why each coach was not offered', async () => {
    const ctx = await context(P.inferred);
    expect(ctx.noRecipient.reason).toBe(NO_RECIPIENT_REASON.NOTHING_ELIGIBLE);
    expect(ctx.noRecipient.details).toContain('1 coach: email address not verified');
  });

  it('a stale inbox and no staff: the inbox is named as not current', async () => {
    const ctx = await context(P.stale);
    expect(ctx.noRecipient.reason).toBe(NO_RECIPIENT_REASON.NOTHING_ELIGIBLE);
    expect(ctx.noRecipient.details.join(' ')).toMatch(/programme inbox is on file but not current/);
  });

  it('nothing on file says exactly that', async () => {
    const ctx = await context(P.empty);
    expect(ctx.noRecipient).toMatchObject({ reason: NO_RECIPIENT_REASON.NOTHING_ON_FILE, details: [] });
  });

  it('is null whenever somebody can be written to - a coach, or the inbox fallback', async () => {
    expect((await context(P.vera)).noRecipient).toBeNull();
    expect(explainNoManualRecipient({ collegeName: P.vera.name, sport: 'mens-soccer' })).toBeNull();
    // an inbox-only programme with a current inbox: the inbox is offered, so no explanation
    const fresh = programme('fresh');
    const ctx = await context(fresh);
    expect(ctx.programmeContact).not.toBeNull();
    expect(ctx.noRecipient).toBeNull();
  });
});
