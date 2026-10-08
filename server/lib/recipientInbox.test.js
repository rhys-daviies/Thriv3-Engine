import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';

/**
 * PHASE 1D — A PROGRAMME-INBOX RELATIONSHIP, WRITTEN DIRECTLY INTO THE SCHEMA.
 *
 * No selection or send entry point can create one yet (programmeContactsIsolation.test.js), so
 * these rows are inserted by hand to prove that the persistence model holds one correctly and
 * that every safety and read path sees it as what it is: counted by the send cap, suppressed by
 * an opt-out, listed by the confirm paths, attributed to its programme for do-not-contact and
 * stance, and never dressed up as a coach.
 */
vi.stubEnv('THRIV3_EDGE_URL', 'https://edge.test');
vi.stubEnv('THRIV3_SYNC_SECRET', 'test-secret');

const db = (await import('../db/client.js')).default;
const { programmeContactId } = await import('./programmeContactEligibility.js');
const { resolveRecipient, recipientForOutreachToken, recipientForOutreach, recipientRefOfOutreach, RECIPIENT_ERROR, RecipientError } = await import('./recipient.js');
const { recentSendCount } = await import('./sendCap.js');
const { pullSuppressions } = await import('./edgeSync.js');
const { isSuppressed } = await import('./suppressions.js');
const { pendingDrafts } = await import('./confirmSends.js');
const { pendingManualDraftsForAthlete } = await import('./manualDraftConfirmation.js');
const { confirmedSends } = await import('./outreachSend.js');
const { manualRelationshipForConfirmedSend } = await import('./manualContactStance.js');
const { historyForAthleteProgramme } = await import('./programmeContactHistory.js');
const { contactIntelligenceForAthlete } = await import('./contactIntelligence.js');
const { coachEngagement } = await import('./engagementQueries.js');
const { programmesReachedBy, manualContactDecision } = await import('./manualOutreachSafety.js');

const T = '2026-09-20T10:00:00.000Z';
const ATH = 'ib-athlete'; const ATH2 = 'ib-athlete-2';
const ENT = 'AE-U970001';
const INBOX = 'msoccer@inbox.example';
const PC = programmeContactId(ENT, 'mens-soccer', INBOX);
const code = (fn) => { try { fn(); } catch (e) { return e instanceof RecipientError ? e.code : String(e.message); } return 'NO_THROW'; };

beforeAll(() => {
  const p = db.prepare("INSERT INTO players (id, created_date, updated_date, full_name, position, sport) VALUES (?, ?, ?, ?, 'MF', 'mens-soccer')");
  p.run(ATH, T, T, 'Ina Athlete'); p.run(ATH2, T, T, 'Ina Two');
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?, 'Inbox College', 970001, 'SINGLE', 'test', ?)").run(ENT, T);
  const c = db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D3', ?, 970001, ?)");
  c.run('ic-canon', T, T, 'Inbox College', 1, ENT);
  c.run('ic-alt', T, T, 'Inbox Coll.', 0, ENT);           // another spelling of the same programme
  db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
    VALUES (?, ?, 'ic-canon', 'mens-soccer', ?, 'Inbox College Men''s Soccer', 'TEAM_INBOX', 'https://inbox.example/sports/mens-soccer/coaches', ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`).run(PC, ENT, INBOX, T, T, T, T);
  db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status) VALUES ('ib-coach', ?, 'Cole Coach', 'cole@inbox.example', 'Inbox College', 'NCAA D3', 'mens-soccer', 'Head Coach', 'verified')").run(T);
  // the inbox relationship (sent), and a coach relationship at the same programme for contrast
  const o = db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, programme_contact_id, token, created_at, drafted_at, sent_at) VALUES (?,?,?,?,?,?,?,?)');
  o.run('io-inbox', ATH, null, PC, 'it-inbox', T, T, '2026-09-21T00:00:00.000Z');
  o.run('io-coach', ATH, 'ib-coach', null, 'it-coach', T, T, '2026-09-22T00:00:00.000Z');
  o.run('io-inbox-2', ATH2, null, PC, 'it-inbox-2', T, T, null);
  const s = db.prepare(`INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id, programme_contact_id, college_name, sport, policy_version, created_at, state, origin, subject)
    VALUES (?,?,?,?,?,?,?,?,'Inbox College','mens-soccer','P2',?,?,?,?)`);
  s.run('is-inbox-1', 'io-inbox', 1, T, '2026-09-21T00:00:00.000Z', ATH, null, PC, T, 'ACCEPTED', 'manual', 'first');
  s.run('is-inbox-2', 'io-inbox-2', 1, T, null, ATH2, null, PC, T, 'DRAFT', 'manual', 'draft');
  db.prepare("INSERT INTO engagement_rollup (outreach_id, qualified_visits, best_coverage_pct, engagement_score, tier, updated_at) VALUES ('io-inbox', 4, 80, 90, 'hot', ?)").run(T);
});
afterEach(() => vi.unstubAllGlobals());

describe('17–21. the schema holds a programme-inbox relationship, and only a well-formed one', () => {
  const insert = (id, coach, pc, athlete = ATH) => () => db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, programme_contact_id, token, created_at) VALUES (?,?,?,?,?,?)').run(id, athlete, coach, pc, `tok-${id}`, T);
  it('17. an outreach row can address a programme contact, and resolves as PROGRAMME_INBOX', () => {
    expect(recipientRefOfOutreach(db.prepare("SELECT * FROM outreach WHERE id='io-inbox'").get())).toEqual({ kind: 'PROGRAMME_INBOX', id: PC });
    expect(recipientForOutreachToken('it-inbox')).toMatchObject({ kind: 'PROGRAMME_INBOX', id: PC, email: INBOX, displayName: "Inbox College Men's Soccer", programme: { name: 'Inbox College', sport: 'mens-soccer' } });
    expect(recipientForOutreach('io-inbox').recipient).not.toHaveProperty('coach');
  });
  it('18/19. both recipients, or neither, is refused by the table itself', () => {
    expect(insert('x-both', 'ib-coach', PC)).toThrow(/CHECK constraint failed/);
    expect(insert('x-none', null, null)).toThrow(/CHECK constraint failed/);
    for (const t of ['outreach_send', 'programme_contact_attempts', 'campaign_first_touch_approvals', 'programme_messages']) {
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t).sql, t).toContain('CHECK ((coach_id IS NULL) <> (programme_contact_id IS NULL))');
    }
    expect(code(() => recipientRefOfOutreach({ coach_id: 'a', programme_contact_id: 'b' }))).toBe(RECIPIENT_ERROR.OUTREACH_DOUBLY_ADDRESSED);
    expect(code(() => recipientRefOfOutreach({ coach_id: null, programme_contact_id: null }))).toBe(RECIPIENT_ERROR.OUTREACH_UNADDRESSED);
  });
  it('20. a programme_contact_id that names no programme contact fails its foreign key', () => {
    expect(insert('x-fk', null, 'PC-does-not-exist')).toThrow(/FOREIGN KEY/);
  });
  it('21. the same athlete cannot open two relationships with one inbox (nor pursue it twice per campaign)', () => {
    expect(insert('x-dup', null, PC)).toThrow(/UNIQUE constraint failed: outreach.athlete_id, outreach.programme_contact_id/);
    for (const [t, idx] of [['programme_contact_attempts', 'idx_contact_attempts_campaign_programme_contact'], ['campaign_first_touch_approvals', 'idx_first_touch_campaign_programme_contact']]) {
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(idx).sql, t).toMatch(/UNIQUE INDEX [\s\S]*\(programme_campaign_id, programme_contact_id\) WHERE programme_contact_id IS NOT NULL/);
    }
  });
  it('a kind is never swapped to find a record', () => {
    expect(code(() => resolveRecipient({ kind: 'COACH', id: PC }))).toBe(RECIPIENT_ERROR.NOT_FOUND);
    expect(code(() => resolveRecipient({ kind: 'PROGRAMME_INBOX', id: 'ib-coach' }))).toBe(RECIPIENT_ERROR.NOT_FOUND);
  });
});

describe('22–28. every safety and read path sees the inbox relationship as what it is', () => {
  const NOW = Date.parse('2026-10-07T00:00:00Z');
  it('22. an inbox send counts toward the inbox\'s send cap (and only the sent one)', () => {
    expect(recentSendCount(INBOX, { now: NOW, days: 3650 })).toBe(1);
    expect(recentSendCount(INBOX.toUpperCase(), { now: NOW, days: 3650 })).toBe(1);
    expect(recentSendCount('cole@inbox.example', { now: NOW, days: 3650 })).toBe(1);
  });

  it('23/28. an opt-out on an inbox token suppresses the inbox\'s actual address', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ suppressions: [{ token: 'it-inbox', created_at: '2026-10-01T00:00:00Z' }, { token: 'no-such-token', created_at: '2026-10-01T00:00:00Z' }] }), { status: 200 }));
    expect(isSuppressed(INBOX)).toBe(false);
    const r = await pullSuppressions();
    expect(r).toMatchObject({ pulled: 2, added: 1, unresolved: ['no-such-token'] });
    expect(isSuppressed(INBOX)).toBe(true);
    expect(db.prepare('SELECT outreach_token FROM suppressions WHERE email = ?').get(INBOX).outreach_token).toBe('it-inbox');
  });

  it('24. the confirm paths list the inbox draft and the inbox send by its address, with no coach', () => {
    const d = pendingDrafts().find((r) => r.id === 'io-inbox-2');
    expect(d).toMatchObject({ email: INBOX, school: 'Inbox College', coach_name: null, recipient_kind: 'PROGRAMME_INBOX', recipient_id: PC, recipient_label: "Inbox College Men's Soccer" });
    expect(pendingManualDraftsForAthlete(ATH2)).toEqual([expect.objectContaining({ send_id: 'is-inbox-2', coach_id: null, coach_name: null, position_title: null, recipient_kind: 'PROGRAMME_INBOX', recipient_id: PC })]);
    expect(confirmedSends({ athleteId: ATH }).find((r) => r.id === 'is-inbox-1')).toMatchObject({ coach_email: null, coach_title: null, recipient_kind: 'PROGRAMME_INBOX', recipient_address: INBOX, programme_contact_id: PC });
  });

  it('25. engagement reports the inbox relationship as PROGRAMME_INBOX, under its programme', () => {
    const rows = coachEngagement(ATH);
    expect(rows.find((r) => r.outreach_id === 'io-inbox')).toMatchObject({ recipient_kind: 'PROGRAMME_INBOX', recipient_id: PC, recipient_label: "Inbox College Men's Soccer", coach_id: null, coach_name: null, position_title: null, school: 'Inbox College', division: 'NCAA D3', engagement_score: 90 });
    expect(rows.find((r) => r.outreach_id === 'io-coach')).toMatchObject({ recipient_kind: 'COACH', coach_id: 'ib-coach', coach_name: 'Cole Coach' });
  });

  it('26. history and intelligence attribute it to the programme without inventing a person', () => {
    const h = historyForAthleteProgramme({ athleteId: ATH, collegeName: 'Inbox College', sport: 'mens-soccer' });
    expect(h).toHaveLength(2);
    expect(h.find((r) => r.recipient_kind === 'PROGRAMME_INBOX')).toMatchObject({ recipient_id: PC, recipient_email: INBOX, coach_id: null, coach_name: null, coach_email: null, position_title: null, has_confirmed_send: true, origins: ['manual'] });
    const p = contactIntelligenceForAthlete(ATH).find((x) => x.college_name === 'Inbox College');
    expect(p.coaches.find((c) => c.recipient_kind === 'PROGRAMME_INBOX')).toMatchObject({ recipient_id: PC, coach_id: null, coach_name: null, position_title: null, has_confirmed_send: true });
    expect(p.coach_count).toBe(2);
  });

  it('27. a send to the inbox reaches its programme for do-not-contact — under any label, on any spelling', () => {
    expect(programmesReachedBy({ collegeName: 'Some Other School', sport: 'mens-soccer', coachEmails: [INBOX] })).toEqual(['Some Other School', 'Inbox Coll.', 'Inbox College']);
    db.prepare(`INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged, visibility, contact_stance, created_at, updated_at)
      VALUES ('ib-dnc', ?, 'Inbox College', 'mens-soccer', 'none', 0, 'default', 'do_not_contact', 'x', 'x')`).run(ATH2);
    const d = manualContactDecision({ athleteId: ATH2, collegeName: 'Some Other School', sport: 'mens-soccer', coachEmails: [INBOX] });
    expect(d).toMatchObject({ allowed: false, stance: 'do_not_contact', programme: 'Inbox College' });
  });

  it('a confirmed MANUAL inbox send resolves to its programme for the manual-only stance', () => {
    expect(manualRelationshipForConfirmedSend({ outreachId: 'io-inbox', outreachSendId: 'is-inbox-1' })).toEqual({ athleteId: ATH, collegeName: 'Inbox College', sport: 'mens-soccer' });
  });
});
