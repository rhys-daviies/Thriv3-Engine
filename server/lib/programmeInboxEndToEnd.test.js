import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { corroborateFixtureCoaches } from '../testCanonicalCoaches.js';

/**
 * PHASE 1F — A PROGRAMME INBOX, END TO END, THROUGH THE REAL CHAIN.
 *
 * One synthetic programme with NO eligible named coach (its only person has an inferred address,
 * and a legacy generic team row sits beside it) and one VERIFIED programme inbox that passes the
 * 1B floor for real reasons (its own athletics site, its own mail domain, observed an hour ago).
 *
 *   selection -> attempt -> review/approval -> composition -> persisted message -> claim -> send
 *   -> outreach / send history -> engagement -> programme-level history -> follow-up -> exhausted
 *
 * NOTHING IS SENT. The provider is the established `fakeTransport`, handed in as the transport;
 * it opens no socket and records the request it was given. Everything runs on :memory:.
 */
delete process.env.THRIV3_ALLOW_LEGACY_COACHES;

const db = (await import('../db/client.js')).default;
const { programmeContactId } = await import('./programmeContactEligibility.js');
const { programmePursuitPlan, materialiseNextContactAttempt, contactAttemptPreparation } = await import('./pursuitPolicy.js');
const { approveFirstTouch, approvalStatus, APPROVAL_STATUS } = await import('./firstTouchApprovals.js');
const { generateProgrammeMessage } = await import('./programmeMessageGeneration.js');
const { reviewProgrammeMessage, programmeMessage } = await import('./programmeMessages.js');
const { executeProgrammeMessage } = await import('./executeProgrammeMessage.js');
const { fakeTransport } = await import('./outboundTransport.js');
const { campaignExecutionPlan } = await import('./campaignExecution.js');
const { coachEngagement } = await import('./engagementQueries.js');
const { historyForAthleteProgramme } = await import('./programmeContactHistory.js');
const { programmePriorContact } = await import('./contactIntelligence.js');
const { suppress, unsuppress } = await import('./suppressions.js');
const { composeProgrammeMessage } = await import('./programmeMessage.js');

const T = '2026-09-20T10:00:00.000Z';
const AT1 = '2026-10-01T09:00:00.000Z'; const DAY1 = '2026-10-01';
const AT2 = '2026-10-06T09:00:00.000Z'; const DAY2 = '2026-10-06';
const OP = 'e2e-operator';
const code = async (fn) => { try { await fn(); } catch (e) { return e.code ?? e.message; } return 'NO_THROW'; };
let unit = 930000;

/** A programme with its own entity, athletics site + mail domain, staff and a VERIFIED inbox. */
function programme(key, { staff = [], inbox = true } = {}) {
  unit += 1;
  const ent = `AE-U${unit}`; const host = `${key}athletics.example`; const name = `${key} College`;
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?, ?, ?, 'SINGLE', 'test', ?)").run(ent, name, unit, T);
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?, ?, ?, ?, 'mens-soccer', 'NCAA D3', 1, ?, ?)").run(`col-${key}`, T, T, name, unit, ent);
  db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, ?, 'VERIFIED', 'ATHLETICS_SITE', '[]', ?, 'TEST', 'CERTAIN', ?)").run(host, unit, JSON.stringify([unit]), T);
  const coaches = staff.map((c, i) => {
    const id = `co-${key}-${i}`;
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
      VALUES (?, ?, ?, ?, ?, 'NCAA D3', 'mens-soccer', ?, ?, 'CURRENT')`).run(id, T, c.name ?? null, c.email ?? `coach${i}@${host}`, name, c.title ?? 'Head Coach', c.status ?? 'verified');
    corroborateFixtureCoaches(db, { ids: [id] });
    return id;
  });
  let pc = null; const email = `msoccer@${host}`;
  if (inbox) {
    pc = programmeContactId(ent, 'mens-soccer', email);
    const seen = new Date(Date.now() - 3600_000).toISOString();
    db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, ?, ?, 'mens-soccer', ?, ?, 'TEAM_INBOX', ?, ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
      .run(pc, ent, `col-${key}`, email, `${name} Men's Soccer`, `https://${host}/sports/mens-soccer/coaches`, seen, seen, T, T);
  }
  return { ent, host, name, coaches, pc, email };
}

function athlete(id) {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug, nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)`).run(id, randomUUID().slice(0, 10));
}
function campaignFor(athleteId, collegeName) {
  const c = `e2e-camp-${randomUUID().slice(0, 8)}`; const pc = `e2e-pc-${randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at, snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)`).run(c, athleteId);
  db.prepare(`INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score, tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 1, 82, 'A', 'AUTO', 'queued', 'x', 'x')`).run(pc, c, collegeName);
  return { c, pc };
}
function mailboxFor(athleteId) {
  const id = `mb-${randomUUID()}`;
  db.prepare(`INSERT INTO connected_mailboxes (id, operator_user_id, athlete_id, provider, provider_account_id, email_address, status, connected_at, created_at, updated_at)
    VALUES (?, ?, ?, 'GOOGLE', ?, ?, 'CONNECTED', 'x', 'x', 'x')`).run(id, OP, athleteId, randomUUID(), `${athleteId}@example.com`);
  db.prepare(`INSERT INTO connected_mailbox_credentials (mailbox_id, ciphertext, iv, auth_tag, key_version, rotated_at, created_at, updated_at)
    VALUES (?, 'ct', 'iv', 'tag', 'v1', 'x', 'x', 'x')`).run(id);
  return id;
}
const count = (sql, ...a) => db.prepare(sql).get(...a).n;

const ATH = 'e2e-athlete';
let Z; let flow; let mailbox; let transport;

beforeAll(() => {
  db.prepare("INSERT INTO operator_users (id, email, password_hash, active, created_at) VALUES (?, 'op@e2e.test', 'h', 1, 'x')").run(OP);
  athlete(ATH);
  // a person with an INFERRED address (ineligible), and a legacy generic team row on the inbox's own address
  Z = programme('zulu', { staff: [{ name: 'Ian Inferred', status: 'inferred' }, { name: null, title: "Men's Soccer (Team Email)", status: 'generic', email: 'msoccer@zuluathletics.example' }] });
  // the athlete once wrote (by hand) to the ineligible coach: programme-level history the inbox's first touch must be reviewed against
  db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at) VALUES (?,?,?,?,?,?,?)').run('e2e-old', ATH, Z.coaches[0], 'e2e-old-tok', T, T, T);
  flow = campaignFor(ATH, Z.name);
  mailbox = mailboxFor(ATH);
  transport = fakeTransport();
});

describe('A–N. the whole chain, once', () => {
  let message; let coachesBefore;
  it('A. the inbox is selected ONLY because no named coach is eligible', () => {
    const plan = programmePursuitPlan({ programmeCampaignId: flow.pc });
    expect(plan.recipientSelection.kind).toBe('PROGRAMME_INBOX');
    expect(plan.ineligible.map((c) => [c.coachId, c.reason])).toEqual([[Z.coaches[0], 'NOT_OUTREACH_ELIGIBLE'], [Z.coaches[1], 'NOT_OUTREACH_ELIGIBLE']]);
    expect(plan.current).toMatchObject({ recipientKind: 'PROGRAMME_INBOX', programmeContactId: Z.pc, coachId: null, name: null, title: null });
    coachesBefore = count('SELECT COUNT(*) n FROM coaches');
  });
  it('B/D. the operator sees "Programme Contact", never a coach; no name or title is invented', () => {
    const entry = campaignExecutionPlan(flow.c, { onDate: DAY1, sendingIdentity: 'x@example.com' }).programmes[0];
    expect(entry.currentCoach).toBeNull();
    expect(entry.currentRecipient).toMatchObject({ kind: 'PROGRAMME_INBOX', id: Z.pc, primary: 'Programme Contact', secondary: "zulu College Men's Soccer", isPerson: false });
  });
  it('F. the first touch is reviewed (Q3: the programme was reached before) and the approval stores programme_contact_id', () => {
    let plan = programmePursuitPlan({ programmeCampaignId: flow.pc });
    expect(plan.firstTouchReview.required).toBe(true);
    expect(contactAttemptPreparation(plan).reason).toBe('CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED');
    approveFirstTouch({ programmeCampaignId: flow.pc, programmeContactId: Z.pc, operatorId: OP, priorContact: plan.current.reviewContact });
    expect(db.prepare('SELECT coach_id, programme_contact_id FROM campaign_first_touch_approvals WHERE programme_campaign_id = ?').get(flow.pc)).toEqual({ coach_id: null, programme_contact_id: Z.pc });
    plan = programmePursuitPlan({ programmeCampaignId: flow.pc });
    expect(approvalStatus({ programmeCampaignId: flow.pc, programmeContactId: Z.pc, priorContact: plan.current.reviewContact }).status).toBe(APPROVAL_STATUS.CURRENT);
  });
  it('E. the attempt stores programme_contact_id', () => {
    const { attempt } = materialiseNextContactAttempt({ programmeCampaignId: flow.pc });
    expect(attempt).toMatchObject({ coach_id: null, programme_contact_id: Z.pc, step: 1 });
  });
  it('C/D/G. composition greets "Hi Coach," and the message stores programme_contact_id and the inbox address', () => {
    ({ message } = generateProgrammeMessage({ programmeCampaignId: flow.pc, programmeContactId: Z.pc }));
    expect(message).toMatchObject({ coach_id: null, programme_contact_id: Z.pc, recipient_email: Z.email, step: 1 });
    expect(message.body.split('\n')[0]).toBe('Hi Coach,');
    for (const t of [message.body, message.subject]) {
      expect(t).not.toMatch(/Ian|Inferred|Programme Contact|Men's Soccer,/);
    }
  });
  it('H–L. the claim resolves the programme contact, the send goes to the inbox address, every row is typed, no coach row appears', async () => {
    reviewProgrammeMessage(message.id, { operatorId: OP });
    const out = await executeProgrammeMessage({
      programmeMessageId: message.id, operatorUserId: OP, connectedMailboxId: mailbox,
      bodyHash: programmeMessage(message.id).body_hash, at: AT1, onDate: DAY1, transport,
    });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].to).toBe(Z.email);
    expect(transport.sent[0].body.split('\n')[0]).toBe('Hi Coach,');
    const send = db.prepare('SELECT * FROM outreach_send WHERE programme_message_id = ?').get(message.id);
    expect(send).toMatchObject({ coach_id: null, programme_contact_id: Z.pc, state: 'ACCEPTED' });
    expect(db.prepare('SELECT coach_id, programme_contact_id FROM outreach WHERE id = ?').get(send.outreach_id)).toEqual({ coach_id: null, programme_contact_id: Z.pc });
    expect(count('SELECT COUNT(*) n FROM coaches')).toBe(coachesBefore);
    expect(count("SELECT COUNT(*) n FROM coaches WHERE lower(email) = ? AND id NOT IN (?, ?)", Z.email, Z.coaches[0], Z.coaches[1])).toBe(0);
    expect(out).toBeTruthy();
  });
  it('M. engagement resolves PROGRAMME_INBOX', () => {
    const send = db.prepare('SELECT outreach_id FROM outreach_send WHERE programme_contact_id = ?').get(Z.pc);
    db.prepare("INSERT INTO engagement_rollup (outreach_id, qualified_visits, best_coverage_pct, engagement_score, tier, updated_at) VALUES (?, 2, 60, 70, 'warm', ?)").run(send.outreach_id, T);
    const row = coachEngagement(ATH).find((r) => r.outreach_id === send.outreach_id);
    expect(row).toMatchObject({ recipient_kind: 'PROGRAMME_INBOX', coach_id: null, coach_name: null });
  });
  it('N. history records a programme-level contact through the inbox', () => {
    const h = historyForAthleteProgramme({ athleteId: ATH, collegeName: Z.name, sport: 'mens-soccer' });
    expect(h.map((r) => r.recipient_kind).sort()).toEqual(['COACH', 'PROGRAMME_INBOX']);
    expect(programmePriorContact({ athleteId: ATH, collegeName: Z.name, sport: 'mens-soccer' })).toMatchObject({ programmeInbox: true });
  });
});

describe('R–S. one programme-level approach: initial + one follow-up, then nothing (Q2)', () => {
  it('R. the follow-up is represented: step 2, the same inbox, composed and sent', async () => {
    let plan = programmePursuitPlan({ programmeCampaignId: flow.pc, onDate: DAY2 });
    expect(plan).toMatchObject({ nextAction: 'FOLLOW_UP', step: 2 });
    expect(plan.current.programmeContactId).toBe(Z.pc);
    materialiseNextContactAttempt({ programmeCampaignId: flow.pc });
    const { message } = generateProgrammeMessage({ programmeCampaignId: flow.pc, programmeContactId: Z.pc });
    expect(message).toMatchObject({ step: 2, programme_contact_id: Z.pc });
    expect(message.body.split('\n')[0]).toBe('Hi Coach,');
    reviewProgrammeMessage(message.id, { operatorId: OP });
    await executeProgrammeMessage({ programmeMessageId: message.id, operatorUserId: OP, connectedMailboxId: mailbox, bodyHash: programmeMessage(message.id).body_hash, at: AT2, onDate: DAY2, transport });
    expect(transport.sent).toHaveLength(2);
    plan = programmePursuitPlan({ programmeCampaignId: flow.pc, onDate: DAY2 });
    expect(plan.nextAction).toBe('NO_FURTHER_COLD_OUTREACH');
  });
  it('S. a third cold touch is refused at generation and at composition', async () => {
    expect(await code(() => generateProgrammeMessage({ programmeCampaignId: flow.pc, programmeContactId: Z.pc }))).not.toBe('NO_THROW');
    expect(await code(() => composeProgrammeMessage({ programmeCampaignId: flow.pc, programmeContactId: Z.pc }))).toBe('UNSUPPORTED_SEQUENCE_STEP');
    expect(transport.sent).toHaveLength(2);
  });
});

describe('O–Q. suppression, opt-out and agreement stop an inbox send', () => {
  async function readyToSend(key) {
    const p = programme(key);
    const a = `e2e-ath-${key}`; athlete(a);
    const f = campaignFor(a, p.name);
    const box = mailboxFor(a);
    materialiseNextContactAttempt({ programmeCampaignId: f.pc });
    const { message } = generateProgrammeMessage({ programmeCampaignId: f.pc, programmeContactId: p.pc });
    reviewProgrammeMessage(message.id, { operatorId: OP });
    return { p, a, f, box, message };
  }
  it('O. an opted-out inbox address is not sent to', async () => {
    const { p, box, message } = await readyToSend('oscar');
    const t = fakeTransport();
    suppress({ email: p.email, reason: 'unsubscribed', source: 'manual' });
    try {
      const why = await code(() => executeProgrammeMessage({ programmeMessageId: message.id, operatorUserId: OP, connectedMailboxId: box, bodyHash: programmeMessage(message.id).body_hash, at: AT1, onDate: DAY1, transport: t }));
      expect(why).toBe('SUPPRESSED');
      expect(t.calls).toBe(0);
    } finally { unsuppress(p.email); }
  });
  it('P. a programme do-not-contact stance is not routed around through its inbox', async () => {
    const { p, a, box, message } = await readyToSend('papa');
    db.prepare(`INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged, visibility, contact_stance, created_at, updated_at)
      VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', 'do_not_contact', 'x', 'x')`).run(randomUUID(), a, p.name);
    const t = fakeTransport();
    const why = await code(() => executeProgrammeMessage({ programmeMessageId: message.id, operatorUserId: OP, connectedMailboxId: box, bodyHash: programmeMessage(message.id).body_hash, at: AT1, onDate: DAY1, transport: t }));
    expect(why).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect(t.calls).toBe(0);
  });
  it('P/Q1. a named coach\'s opt-out at the programme blocks the inbox from being selected at all', () => {
    const p = programme('quebec', { staff: [{ name: 'Quinn Optout' }] });
    suppress({ email: `coach0@${p.host}`, reason: 'unsubscribed', source: 'manual' });
    try {
      const a = 'e2e-ath-q1'; athlete(a);
      const plan = programmePursuitPlan({ programmeCampaignId: campaignFor(a, p.name).pc });
      expect(plan.recipientSelection).toMatchObject({ kind: 'NO_RECIPIENT', inbox: { blockedBy: 'PROGRAMME_INBOX_COACH_OPTED_OUT_AT_PROGRAMME' } });
    } finally { unsuppress(`coach0@${p.host}`); }
  });
  it('Q. a send that disagrees with its inbox outreach is refused by the schema', () => {
    const o = db.prepare('SELECT id FROM outreach WHERE programme_contact_id = ?').get(Z.pc);
    expect(() => db.prepare(`INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, athlete_id, coach_id, college_name, sport, policy_version, created_at, state, origin, subject)
      VALUES ('e2e-bad', ?, 9, ?, ?, ?, ?, 'mens-soccer', 'P2', ?, 'DRAFT', 'campaign', 's')`).run(o.id, T, ATH, Z.coaches[0], Z.name, T)).toThrow(/RECIPIENT_DISAGREES/);
  });
});

describe('T. a named coach who becomes eligible later outranks the inbox, and is reviewed against the inbox contact', () => {
  it('the coach is current, the inbox is not offered beside them, and the first touch needs review (Q3)', () => {
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
      VALUES ('co-zulu-new', ?, 'Nora Newcoach', 'nora@zuluathletics.example', ?, 'NCAA D3', 'mens-soccer', 'Assistant Coach', 'verified', 'CURRENT')`).run(T, Z.name);
    corroborateFixtureCoaches(db, { ids: ['co-zulu-new'] });
    const a = 'e2e-ath-t'; athlete(a);
    db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, programme_contact_id, token, created_at, drafted_at, sent_at) VALUES (?,?,?,?,?,?,?,?)').run('e2e-t-inbox', a, null, Z.pc, 'e2e-t-tok', T, T, T);
    const plan = programmePursuitPlan({ programmeCampaignId: campaignFor(a, Z.name).pc });
    expect(plan.recipientSelection.kind).toBe('COACH');
    expect(plan.recipients.map((r) => r.recipientKind)).toEqual(['COACH']);
    expect(plan.current).toMatchObject({ coachId: 'co-zulu-new' });
    expect(plan.current.priorContact.hasConfirmedSend).toBe(false);          // the person: untouched
    expect(plan.firstTouchReview).toMatchObject({ required: true, reason: 'PRIOR_CONFIRMED_CONTACT' });   // the programme: reached
  });
});
