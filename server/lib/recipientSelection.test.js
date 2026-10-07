import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

/**
 * PHASE 1E — FALLBACK RECIPIENT SELECTION AND RECIPIENT AGREEMENT. The synthetic matrix.
 *
 *   named coach  ->  verified programme inbox  ->  nobody
 *
 * Every programme here is built in-memory with its own athletics entity, athletics site and
 * mail domain, so a programme contact passes (or fails) the real 1B floor for real reasons. No
 * canonical data is read or written. The default coach floor is in force throughout, except
 * where a test opts into the pre-8A legacy offer to prove it cannot revive a fake-coach inbox.
 */
delete process.env.THRIV3_ALLOW_LEGACY_COACHES;

const db = (await import('../db/client.js')).default;
const { programmeContactId } = await import('./programmeContactEligibility.js');
const { coachIneligibility } = await import('./coachEligibility.js');
const {
  programmePursuitPlan, contactAttemptPreparation, materialiseNextContactAttempt, PURSUIT_REASON,
  PREPARATION_REFUSAL, FIRST_TOUCH_REVIEW,
} = await import('./pursuitPolicy.js');
const {
  RECIPIENT_SELECTION, INBOX_NOT_SELECTED, TEAM_ROW_SUPERSEDED,
  assertProgrammeInbox, programmeInboxesFor, isProgrammeInboxAddress,
} = await import('./recipientSelection.js');
const { createContactAttempt, attemptForRecipient } = await import('./contactAttempts.js');
const { approveFirstTouch, approvalStatus, APPROVAL_STATUS } = await import('./firstTouchApprovals.js');
const { campaignContactDecision, CONTACT_REFUSAL } = await import('./campaignAttribution.js');
const { generateProgrammeMessage } = await import('./programmeMessageGeneration.js');
const { createProgrammeMessage } = await import('./programmeMessages.js');
const { assertExecutionSafety } = await import('./executionClaim.js');
const { campaignExecutionPlan } = await import('./campaignExecution.js');
const { createOutreach } = await import('./outreach.js');
const { suppress, unsuppress } = await import('./suppressions.js');
const { programmesReachedBy } = await import('./manualOutreachSafety.js');
const { classifyReply } = await import('./v2/replyIntake.js');

const T = '2026-09-20T10:00:00.000Z';
const NOW = () => new Date(Date.now() - 3600_000).toISOString();
const ATH = 'sel-athlete';
const code = (fn) => { try { fn(); } catch (e) { return e.code ?? e.message; } return 'NO_THROW'; };
let unit = 960000;
let K_ATH = null; let R_ATH = null;

/**
 * One programme: an athletics entity, a colleges row, a VERIFIED athletics site (which is also
 * the mail domain), its coaches, and optionally programme_contacts rows.
 */
function programme(key, { sport = 'mens-soccer', coaches = [], inboxes = [] } = {}) {
  unit += 1;
  const ent = `AE-U${unit}`; const host = `${key}athletics.example`; const name = `${key} College`;
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?, ?, ?, 'SINGLE', 'test', ?)").run(ent, name, unit, T);
  for (const sp of ['mens-soccer', 'womens-soccer']) {
    db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?, ?, ?, ?, ?, 'NCAA D3', 1, ?, ?)").run(`col-${key}-${sp}`, T, T, name, sp, unit, ent);
  }
  db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, ?, 'VERIFIED', 'ATHLETICS_SITE', '[]', ?, 'TEST', 'CERTAIN', ?)").run(host, unit, JSON.stringify([unit]), T);
  const ids = [];
  coaches.forEach((c, i) => {
    const id = `co-${key}-${i}`;
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
      VALUES (?, ?, ?, ?, ?, 'NCAA D3', ?, ?, ?, ?)`).run(id, T, c.name === undefined ? `Coach ${i}` : c.name, c.email || `coach${i}@${host}`, name, c.sport || sport,
      c.title || 'Head Coach', c.status || 'verified', c.currentness || 'CURRENT');
    ids.push(id);
  });
  const pcs = [];
  for (const ib of inboxes) {
    const email = ib.email || `msoccer@${host}`;
    const isp = ib.sport || sport;
    const id = programmeContactId(ib.entity || ent, isp, email);
    const seen = ib.observedAt || NOW();
    db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'refresh:test', ?, 'A', ?, ?, 'test', ?, ?)`)
      .run(id, ib.entity || ent, ib.collegeId || `col-${key}-${isp}`, isp, email, `${name} ${isp === 'mens-soccer' ? "Men's" : "Women's"} Soccer`, ib.role || 'TEAM_INBOX',
        `https://${host}/sports/${isp}/coaches`, seen, ib.kind || 'OFFICIAL_STAFF_DIRECTORY', ib.status || 'VERIFIED', seen, T, T);
    pcs.push(id);
  }
  return { ent, host, name, coaches: ids, pcs };
}

let campSeq = 0;
/** A fresh athlete (campaigns are one per athlete), for history that must precede the campaign. */
function athlete() {
  campSeq += 1;
  const id = `sel-ath-${campSeq}`;
  db.prepare("INSERT INTO players (id, created_date, updated_date, full_name, position, sport) VALUES (?, ?, ?, 'Sela Athlete', 'MF', 'mens-soccer')").run(id, T, T);
  return id;
}
function campaignFor(collegeName, { tier = 'C', state = 'active', sport = 'mens-soccer', athleteId = athlete() } = {}) {
  campSeq += 1;
  const camp = `sel-camp-${campSeq}`;
  db.prepare(`INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at, snapshot_taken_at, programme_count)
    VALUES (?, ?, ?, ?, '2020-01-01', ?, ?, ?, 1)`).run(camp, athleteId, sport, state, T, T, T);
  const pc = `sel-pc-${campSeq}`;
  db.prepare(`INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score, tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 80, ?, 'AUTO', 'queued', ?, ?)`).run(pc, camp, collegeName, sport, tier, T, T);
  return { camp, pc, athleteId };
}

const P = {};
beforeAll(() => {
  db.prepare("INSERT INTO players (id, created_date, updated_date, full_name, position, sport) VALUES (?, ?, ?, 'Sela Athlete', 'MF', 'mens-soccer')").run(ATH, T, T);
  db.prepare("INSERT INTO operator_users (id, email, password_hash, active, created_at) VALUES ('sel-operator', 'op@example.com', 'h', 1, ?)").run(T);
  P.a = programme('alpha', { coaches: [{ title: 'Head Coach' }], inboxes: [{}] });                                   // A
  P.b = programme('bravo', { coaches: [{ title: 'Head Coach' }] });                                                  // B
  P.c = programme('charlie', { inboxes: [{}] });                                                                     // C
  P.d = programme('delta', { coaches: [{ title: 'Head Coach', status: 'inferred' }, { title: 'Assistant Coach', currentness: 'PROVEN_STALE' }], inboxes: [{}] }); // D
  P.e = programme('echo', { inboxes: [{ observedAt: '2024-09-01T00:00:00.000Z' }] });                                // E
  P.f = programme('foxtrot', { coaches: [{ name: null, title: "Men's Soccer (Team Email)", status: 'generic', email: 'msoccer@foxtrotathletics.example' }], inboxes: [{ email: 'msoccer@foxtrotathletics.example' }] }); // F
  P.g = programme('golf', { coaches: [{ title: 'Assistant Coach' }], inboxes: [{ role: 'RECRUITING_INBOX', email: 'recruit-msoc@golfathletics.example' }] }); // G
  P.hOther = programme('hotelother', {});
  P.h = programme('hotel', { inboxes: [{ entity: P.hOther.ent, collegeId: 'col-hotelother-mens-soccer', email: 'msoccer@hotelotherathletics.example' }] }); // H
  P.i = programme('india', { inboxes: [{ sport: 'womens-soccer', email: 'wsoccer@indiaathletics.example' }, { email: 'wsoccer@indiaathletics.example', sport: 'mens-soccer' }] }); // I
  P.j = programme('juliet', { inboxes: [{ status: 'HISTORICAL' }, { email: 'msoccer2@julietathletics.example', kind: 'SOCIAL_MEDIA' }] }); // J
  P.k = programme('kilo', { coaches: [{ title: 'Head Coach' }], inboxes: [{}] });                                    // K
  P.r = programme('romeo', { inboxes: [{}] });                                                                        // R
  P.s = programme('sierra', { coaches: [{ title: 'Head Coach' }], inboxes: [{}] });                                  // opt-out
  P.m = programme('mike', { coaches: [{ title: 'Head Coach' }, { title: 'Assistant Coach' }], inboxes: [{}] });     // M
  P.q1 = programme('quebec', { coaches: [{ title: 'Head Coach', status: 'inferred' }, { title: 'Assistant Coach' }], inboxes: [{}] }); // Q1
  P.q2 = programme('quilt', { inboxes: [{ role: 'RECRUITING_INBOX', email: 'recruiting-msoc@quiltathletics.example' }, { email: 'msoccer@quiltathletics.example' }] }); // Q2
});
afterEach(() => { vi.unstubAllEnvs(); });

const planOf = (key, opts) => programmePursuitPlan({ programmeCampaignId: campaignFor(P[key].name, opts).pc });

describe('A–J. the hierarchy: named coach -> verified inbox -> nobody', () => {
  it('A. an eligible named coach and an eligible inbox -> COACH', () => {
    const plan = planOf('a');
    expect(plan.recipientSelection.kind).toBe(RECIPIENT_SELECTION.COACH);
    expect(plan.current).toMatchObject({ recipientKind: 'COACH', coachId: P.a.coaches[0] });
    expect(plan.recipients.every((r) => r.recipientKind === 'COACH')).toBe(true);
    expect(plan.recipientSelection.inbox.blockedBy).toBe(INBOX_NOT_SELECTED.NAMED_COACH_AVAILABLE);
  });
  it('B. an eligible named coach and no inbox -> COACH', () => {
    const plan = planOf('b');
    expect(plan.recipientSelection.kind).toBe('COACH');
    expect(plan.current.coachId).toBe(P.b.coaches[0]);
  });
  it('C. no named coach and an eligible inbox -> PROGRAMME_INBOX, never shaped as a coach', () => {
    const plan = planOf('c');
    expect(plan.recipientSelection.kind).toBe(RECIPIENT_SELECTION.PROGRAMME_INBOX);
    expect(plan.current).toMatchObject({ recipientKind: 'PROGRAMME_INBOX', programmeContactId: P.c.pcs[0], coachId: null, name: null, title: null, email: 'msoccer@charlieathletics.example' });
    expect(plan.coaches).toEqual([]);                 // `coaches` never lists an inbox
    expect(plan.nextAction).toBe('INITIAL_OUTREACH');
    expect(plan.reason).toBe(PURSUIT_REASON.FIRST_CONTACT);
  });
  it('D. ineligible (inferred) and stale named coaches + an eligible inbox -> PROGRAMME_INBOX', () => {
    const plan = planOf('d', { tier: 'A' });
    expect(plan.recipientSelection.kind).toBe('PROGRAMME_INBOX');
    expect(plan.recipients).toHaveLength(1);
    expect(plan.ineligible.map((c) => c.reason)).toEqual(['NOT_OUTREACH_ELIGIBLE', 'NOT_OUTREACH_ELIGIBLE']);
  });
  it('E. no eligible coach and an ineligible (stale) inbox -> NO_RECIPIENT, failing closed', () => {
    const plan = planOf('e');
    expect(plan.recipientSelection.kind).toBe(RECIPIENT_SELECTION.NO_RECIPIENT);
    expect(plan.current).toBeNull();
    expect(plan.reason).toBe(PURSUIT_REASON.NO_ELIGIBLE_COACHES);
    expect(plan.recipientSelection.inbox.refused[0].problems).toContain('PC_NOT_CURRENT');
    expect(contactAttemptPreparation(plan).reason).toBe(PREPARATION_REFUSAL.NO_ELIGIBLE_COACH);
  });
  it('F. a legacy generic fake-coach row + an eligible inbox -> PROGRAMME_INBOX, never the fake coach', () => {
    const plan = planOf('f');
    expect(plan.current).toMatchObject({ recipientKind: 'PROGRAMME_INBOX', coachId: null });
    expect(plan.ineligible.find((c) => c.coachId === P.f.coaches[0]).reason).toBe('NOT_OUTREACH_ELIGIBLE');
  });
  it('F. even under the pre-8A legacy opt-in, a verified inbox supersedes the fake-coach inbox row', () => {
    vi.stubEnv('THRIV3_ALLOW_LEGACY_COACHES', '1');
    const plan = planOf('f');
    expect(plan.current).toMatchObject({ recipientKind: 'PROGRAMME_INBOX', programmeContactId: P.f.pcs[0] });
    expect(plan.ineligible.find((c) => c.coachId === P.f.coaches[0]).reason).toBe(TEAM_ROW_SUPERSEDED);
  });
  it('G. an inbox never outranks or joins an eligible coach — not at full depth, not after the coaches are exhausted', () => {
    const plan = planOf('g', { tier: 'A' });
    expect(plan.recipients.map((r) => r.recipientKind)).toEqual(['COACH']);
    // exhaust the one coach with two accepted campaign messages: the programme is done, not handed to the inbox
    const pc = plan.programmeCampaign.id; const coach = P.g.coaches[0]; const ga = plan.campaign.athleteId;
    const o = createOutreach({ athleteId: ga, coachId: coach, programmeCampaignId: pc });
    for (const n of [1, 2]) {
      db.prepare(`INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id, college_name, sport, policy_version, created_at, state, origin, subject, programme_campaign_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mens-soccer', 'P2', ?, 'ACCEPTED', 'campaign', 's', ?)`).run(`g-send-${n}`, o.id, n, T, T, ga, coach, P.g.name, T, pc);
    }
    const after = programmePursuitPlan({ programmeCampaignId: pc });
    expect(after.reason).toBe(PURSUIT_REASON.ALL_COACHES_EXHAUSTED);
    expect(after.current).toBeNull();
    expect(after.recipientSelection.kind).toBe('COACH');
  });
  it('H. an inbox filed under ANOTHER programme is never this programme\'s recipient', () => {
    const plan = planOf('h');
    expect(plan.recipientSelection.kind).toBe('NO_RECIPIENT');
    expect(code(() => assertProgrammeInbox(P.h.pcs[0], { collegeName: P.h.name, sport: 'mens-soccer' }))).toBe('CAMPAIGN_PROGRAMME_MISMATCH');
    const { pc } = campaignFor(P.h.name);
    expect(code(() => createContactAttempt({ programmeCampaignId: pc, programmeContactId: P.h.pcs[0] }))).toBe('CAMPAIGN_PROGRAMME_MISMATCH');
  });
  it('I. a wrong-sport inbox is rejected: the other sport\'s row, and a men\'s row whose address names women', () => {
    const plan = planOf('i');
    expect(plan.recipientSelection.kind).toBe('NO_RECIPIENT');
    expect(plan.recipientSelection.inbox.refused.flatMap((r) => r.problems)).toContain('PC_SEX_CONFLICT');
    expect(code(() => assertProgrammeInbox(P.i.pcs[0], { collegeName: P.i.name, sport: 'mens-soccer' }))).toBe('CAMPAIGN_PROGRAMME_MISMATCH');
  });
  it('J. an unverified (HISTORICAL) or non-official inbox is rejected', () => {
    const found = programmeInboxesFor({ collegeName: P.j.name, sport: 'mens-soccer' });
    expect(found.eligible).toEqual([]);
    expect(found.refused.flatMap((r) => r.problems)).toContain('PC_SOURCE_NOT_OFFICIAL');   // the HISTORICAL row is not even a candidate
    expect(planOf('j').recipientSelection.kind).toBe('NO_RECIPIENT');
  });
  it('an opt-out by a named coach at the programme blocks the inbox fallback (it would route around it)', () => {
    suppress({ email: `coach0@${P.s.host}`, reason: 'unsubscribed', source: 'manual' });
    try {
      const plan = planOf('s');
      expect(plan.recipientSelection.kind).toBe('NO_RECIPIENT');
      expect(plan.recipientSelection.inbox.blockedBy).toBe(INBOX_NOT_SELECTED.COACH_OPTED_OUT_AT_PROGRAMME);
    } finally { unsuppress(`coach0@${P.s.host}`); }
  });
});

describe('Q1–Q3. the approved product decisions', () => {
  it('Q1. an opt-out by ANY named coach (not only the head coach) blocks the inbox fallback', () => {
    // the head coach is ineligible (inferred address); the assistant is eligible but has opted out
    suppress({ email: `coach1@${P.q1.host}`, reason: 'unsubscribed', source: 'manual' });
    try {
      const plan = planOf('q1', { tier: 'A' });
      expect(plan.recipientSelection.kind).toBe('NO_RECIPIENT');
      expect(plan.recipientSelection.inbox.blockedBy).toBe(INBOX_NOT_SELECTED.COACH_OPTED_OUT_AT_PROGRAMME);
      expect(plan.current).toBeNull();
    } finally { unsuppress(`coach1@${P.q1.host}`); }
    // without the opt-out the same programme falls through to its inbox
    expect(planOf('q1', { tier: 'A' }).recipientSelection.kind).toBe('COACH');   // the assistant again: a named coach, not the inbox
  });
  it('Q2. an inbox is ONE programme-level approach: initial + one follow-up, then done — a second inbox adds nothing', () => {
    const { pc, athleteId } = campaignFor(P.q2.name, { tier: 'A' });
    let plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.recipients).toHaveLength(1);                               // one inbox even at Tier A depth 3
    expect(plan.current).toMatchObject({ recipientKind: 'PROGRAMME_INBOX', contactRole: 'RECRUITING_INBOX', messagesSent: 0 });
    expect(plan.nextAction).toBe('INITIAL_OUTREACH');
    const inbox = plan.current.programmeContactId;
    db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, programme_contact_id, token, created_at, drafted_at, sent_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('q2-o', athleteId, null, inbox, 'q2-tok', T, T, T);
    const send = (n) => db.prepare(`INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id, programme_contact_id, college_name, sport, policy_version, created_at, state, origin, subject, programme_campaign_id)
      VALUES (?, 'q2-o', ?, ?, ?, ?, NULL, ?, ?, 'mens-soccer', 'P2', ?, 'ACCEPTED', 'campaign', 's', ?)`).run(`q2-s${n}`, n, T, T, athleteId, inbox, P.q2.name, T, pc);
    send(1);
    plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan).toMatchObject({ nextAction: 'FOLLOW_UP', step: 2 });
    expect(plan.current.programmeContactId).toBe(inbox);
    send(2);
    plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe('NO_FURTHER_COLD_OUTREACH');
    expect(plan.current).toBeNull();                                         // the TEAM_INBOX is not a second approach
    expect(plan.recipients.map((r) => r.programmeContactId)).toEqual([inbox]);
  });
  it('Q3. programme-level review is kept, and person-level history stays distinguishable (see K and L)', () => {
    const a = athlete();
    db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, programme_contact_id, token, created_at, drafted_at, sent_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('q3-inbox', a, null, P.a.pcs[0], 'q3-tok', T, T, T);
    const plan = planOf('a', { athleteId: a });
    expect(plan.current.recipientKind).toBe('COACH');
    expect(plan.current.priorContact).toMatchObject({ hasConfirmedSend: false });             // the person
    expect(plan.current.reviewContact).toMatchObject({ hasConfirmedSend: true, programmeRecipients: [{ kind: 'PROGRAMME_INBOX', id: P.a.pcs[0] }] });
    expect(plan.programmePriorContact).toMatchObject({ programmeInbox: true, coach: false });   // the programme
    expect(plan.firstTouchReview.required).toBe(true);
  });
});

describe('K–L. history: programme-level and person-level kept distinct', () => {
  it('K. a prior inbox contact counts as reaching the PROGRAMME, and puts the coach\'s first touch up for review', () => {
    const a = athlete(); K_ATH = a;
    db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, programme_contact_id, token, created_at, drafted_at, sent_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('k-inbox', a, null, P.k.pcs[0], 'k-tok', T, T, T);
    const plan = planOf('k', { athleteId: a });
    expect(plan.current.recipientKind).toBe('COACH');
    expect(plan.current.priorContact.hasConfirmedSend).toBe(false);              // the person: never written to
    expect(plan.programmePriorContact).toMatchObject({ hasConfirmedSend: true, programmeInbox: true, coach: false });
    expect(plan.current.reviewContact.hasConfirmedSend).toBe(true);
    expect(plan.firstTouchReview).toMatchObject({ required: true, reason: FIRST_TOUCH_REVIEW.PRIOR_CONFIRMED_CONTACT });
    expect(programmesReachedBy({ collegeName: 'Some Label', sport: 'mens-soccer', coachEmails: ['msoccer@kiloathletics.example'] })).toContain(P.k.name);
  });
  it('L. a prior coach contact behaves exactly as before: the review fact IS the coach\'s own', () => {
    const coach = P.b.coaches[0];
    const a = athlete();
    db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at) VALUES (?,?,?,?,?,?,?)').run('l-coach', a, coach, 'l-tok', T, T, T);
    const plan = planOf('b', { athleteId: a });
    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
    expect(plan.current.reviewContact).toBe(plan.current.priorContact);         // same object: no new semantics
    expect(plan.firstTouchReview.required).toBe(true);
    expect(plan.programmePriorContact).toMatchObject({ coach: true, programmeInbox: false });
  });
  it('K. an inbox recipient is reviewed against everything the athlete sent anyone at the programme', () => {
    const coachAtR = 'co-romeo-hist';
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status) VALUES (?, ?, 'Old Coach', 'old@romeoathletics.example', ?, 'NCAA D3', 'mens-soccer', 'Head Coach', 'verified', 'PROVEN_STALE')").run(coachAtR, T, P.r.name);
    R_ATH = athlete();
    db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at) VALUES (?,?,?,?,?,?,?)').run('r-old', R_ATH, coachAtR, 'r-tok', T, T, T);
    const plan = planOf('r', { athleteId: R_ATH });
    expect(plan.current.recipientKind).toBe('PROGRAMME_INBOX');
    expect(plan.current.priorContact.hasConfirmedSend).toBe(false);
    expect(plan.firstTouchReview.required).toBe(true);
  });
});

describe('M–O. recipient agreement and the exactly-one rule', () => {
  const sendRow = (id, outreach, coach, pcid) => () => db.prepare(`INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, athlete_id, coach_id, programme_contact_id, college_name, sport, policy_version, created_at, state, origin, subject)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'mens-soccer', 'P2', ?, 'DRAFT', 'manual', 's')`).run(id, outreach, T, ATH, coach, pcid, P.m.name, T);
  it('M. a send that names a different recipient from its outreach is refused (coach->coach, coach->inbox)', () => {
    const o = createOutreach({ athleteId: ATH, coachId: P.m.coaches[0] });
    expect(sendRow('m-1', o.id, P.m.coaches[1], null)).toThrow(/RECIPIENT_DISAGREES/);
    expect(sendRow('m-2', o.id, null, P.m.pcs[0])).toThrow(/RECIPIENT_DISAGREES/);
    sendRow('m-ok', o.id, P.m.coaches[0], null)();
    expect(() => db.prepare("UPDATE outreach_send SET coach_id = ? WHERE id = 'm-ok'").run(P.m.coaches[1])).toThrow(/RECIPIENT_DISAGREES/);
    expect(() => db.prepare('UPDATE outreach SET coach_id = ? WHERE id = ?').run(P.m.coaches[1], o.id)).toThrow(/RECIPIENT_DISAGREES/);
    // a missing parent is still the foreign key's refusal, not this one
    expect(sendRow('m-orphan', 'no-such-outreach', P.m.coaches[0], null)).toThrow(/FOREIGN KEY/);
  });
  it('M. an attempt linked to another recipient\'s outreach, and a message disagreeing with its attempt, are refused', () => {
    const { pc } = campaignFor(P.m.name, { tier: 'A' });
    const coachO = createOutreach({ athleteId: ATH, coachId: P.m.coaches[1] });
    expect(() => db.prepare(`INSERT INTO programme_contact_attempts (id, programme_campaign_id, coach_id, outreach_id, state, step, created_at, updated_at)
      VALUES ('m-att-bad', ?, ?, ?, 'planned', 1, ?, ?)`).run(pc, P.m.coaches[0], coachO.id, T, T)).toThrow(/RECIPIENT_DISAGREES/);
    db.prepare(`INSERT INTO programme_contact_attempts (id, programme_campaign_id, programme_contact_id, state, step, created_at, updated_at)
      VALUES ('m-att-inbox', ?, ?, 'planned', 1, ?, ?)`).run(pc, P.m.pcs[0], T, T);
    expect(() => db.prepare("UPDATE programme_contact_attempts SET programme_contact_id = NULL, coach_id = ? WHERE id = 'm-att-inbox'").run(P.m.coaches[0])).toThrow(/RECIPIENT_DISAGREES/);
    const cols = db.prepare('PRAGMA table_info(programme_messages)').all().filter((c) => c.notnull && c.dflt_value === null && c.name !== 'id');
    const vals = Object.fromEntries(cols.map((c) => [c.name, c.type === 'INTEGER' ? 1 : `x-${c.name}`]));
    Object.assign(vals, { programme_contact_attempt_id: 'm-att-inbox', coach_id: P.m.coaches[0], step: 1 });
    const keys = Object.keys(vals);
    expect(() => db.prepare(`INSERT INTO programme_messages (id, ${keys.join(',')}) VALUES ('m-msg', ${keys.map((k) => `@${k}`).join(',')})`).run(vals)).toThrow(/RECIPIENT_DISAGREES|CHECK constraint/);
  });
  it('N/O. every recipient table refuses both recipient ids, and neither', () => {
    const o = createOutreach({ athleteId: ATH, coachId: P.m.coaches[0] });
    expect(() => db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, programme_contact_id, token, created_at) VALUES (?,?,?,?,?,?)').run('n-both', 'other-athlete', P.m.coaches[0], P.m.pcs[0], 'n-tok', T)).toThrow(/CHECK constraint/);
    expect(() => db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, programme_contact_id, token, created_at) VALUES (?,?,?,?,?,?)').run('o-none', 'other-athlete', null, null, 'o-tok', T)).toThrow(/CHECK constraint/);
    expect(sendRow('n-send-both', o.id, P.m.coaches[0], P.m.pcs[0])).toThrow(/CHECK constraint|RECIPIENT_DISAGREES/);
    const { pc } = campaignFor(P.m.name);
    expect(code(() => createContactAttempt({ programmeCampaignId: pc, coachId: P.m.coaches[0], programmeContactId: P.m.pcs[0] }))).toBe('RECIPIENT_OUTREACH_DOUBLY_ADDRESSED');
    expect(code(() => createContactAttempt({ programmeCampaignId: pc }))).toBe('RECIPIENT_OUTREACH_UNADDRESSED');
    expect(code(() => approveFirstTouch({ programmeCampaignId: pc, coachId: P.m.coaches[0], programmeContactId: P.m.pcs[0], operatorId: null, priorContact: { confirmedSendCount: 0 } }))).toBe('RECIPIENT_OUTREACH_DOUBLY_ADDRESSED');
    for (const t of ['programme_contact_attempts', 'campaign_first_touch_approvals', 'programme_messages']) {
      expect(db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(t).sql, t).toContain('CHECK ((coach_id IS NULL) <> (programme_contact_id IS NULL))');
    }
  });
});

describe('R–T. an inbox moves through planning and the typed delivery boundaries', () => {
  let pc; let attempt; let RA;
  it('R. plan -> preparation -> attempt -> approval -> campaign gate, typed all the way', () => {
    // a new athlete with prior (stale) coach contact at romeo, so the first touch is reviewed first
    RA = athlete();
    db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at) VALUES (?,?,?,?,?,?,?)').run('r-old-2', RA, 'co-romeo-hist', 'r-tok-2', T, T, T);
    pc = campaignFor(P.r.name, { athleteId: RA }).pc;
    let plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(contactAttemptPreparation(plan).reason).toBe(PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED);
    approveFirstTouch({ programmeCampaignId: pc, programmeContactId: P.r.pcs[0], operatorId: 'sel-operator', priorContact: plan.current.reviewContact });
    expect(approvalStatus({ programmeCampaignId: pc, programmeContactId: P.r.pcs[0], priorContact: plan.current.reviewContact }).status).toBe(APPROVAL_STATUS.CURRENT);
    plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.firstTouchReview.required).toBe(false);
    expect(contactAttemptPreparation(plan)).toMatchObject({ allowed: true });
    const made = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(made.created).toBe(true);
    attempt = made.attempt;
    expect(attempt).toMatchObject({ coach_id: null, programme_contact_id: P.r.pcs[0], step: 1, state: 'planned' });
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);          // idempotent
    expect(attemptForRecipient(pc, { programmeContactId: P.r.pcs[0] }).id).toBe(attempt.id);
    expect(programmePursuitPlan({ programmeCampaignId: pc }).current.attemptId).toBe(attempt.id);
    expect(campaignContactDecision({ programmeCampaignId: pc, athleteId: RA, programmeContactId: P.r.pcs[0] })).toMatchObject({ allowed: true });
  });
  it('R. the gate applies suppression and do-not-contact to the inbox\'s own address', () => {
    suppress({ email: `msoccer@${P.r.host}`, reason: 'unsubscribed', source: 'manual' });
    try {
      expect(campaignContactDecision({ programmeCampaignId: pc, athleteId: RA, programmeContactId: P.r.pcs[0] }).reason).toBe(CONTACT_REFUSAL.SUPPRESSED);
      expect(programmePursuitPlan({ programmeCampaignId: pc }).recipientSelection.kind).toBe('NO_RECIPIENT');   // a suppressed inbox is not selected
    } finally { unsuppress(`msoccer@${P.r.host}`); }
    db.prepare(`INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged, visibility, contact_stance, created_at, updated_at)
      VALUES ('r-ap', ?, ?, 'mens-soccer', 'none', 0, 'default', 'do_not_contact', ?, ?)`).run(RA, P.r.name, T, T);
    try {
      expect(campaignContactDecision({ programmeCampaignId: pc, athleteId: RA, programmeContactId: P.r.pcs[0] }).reason).toBe(CONTACT_REFUSAL.RELATIONSHIP_DO_NOT_CONTACT);
    } finally { db.prepare("DELETE FROM athlete_programmes WHERE id = 'r-ap'").run(); }
  });
  // Phase 1F: the five delivery boundaries are typed, so S now proves the inbox is HANDLED (and
  // greeted "Hi Coach,") rather than refused. The full workflow is programmeInboxEndToEnd.test.js.
  it('S. generation composes for the inbox: typed row, no coach, greeted "Hi Coach,"', () => {
    const { message } = generateProgrammeMessage({ programmeCampaignId: pc, programmeContactId: P.r.pcs[0] });
    expect(message).toMatchObject({ coach_id: null, programme_contact_id: P.r.pcs[0], recipient_email: `msoccer@${P.r.host}` });
    expect(message.body.split('\n')[0]).toBe('Hi Coach,');
    expect(code(() => createProgrammeMessage({ programmeContactAttemptId: attempt.id, composition: { composedFor: { programmeCampaignId: pc, coachId: null, programmeContactId: P.r.pcs[0] }, step: 1, body: 'Hi Sam,\n\nx', subject: 's' } })))
      .toBe('INBOX_BODY_GREETING_NOT_NEUTRAL');
  });
  it('S. the execution claim reaches the inbox\'s own checks (an unreviewed message stops at review, not at a refusal of the kind)', () => {
    const msg = db.prepare('SELECT * FROM programme_messages WHERE programme_contact_attempt_id = ?').get(attempt.id);
    expect(code(() => assertExecutionSafety({ message: msg, context: { athleteId: RA, programmeCampaignId: pc, collegeName: P.r.name, sport: 'mens-soccer', attemptStep: 1 } }))).toBe('MESSAGE_NOT_REVIEWED');
  });
  it('S. the execution read model shows the inbox as "Programme Contact", never as a coach', () => {
    const c = db.prepare('SELECT campaign_id FROM programme_campaigns WHERE id = ?').get(pc).campaign_id;
    const entry = campaignExecutionPlan(c, { sendingIdentity: 'sender@example.com' }).programmes.find((p) => p.programmeCampaignId === pc);
    expect(entry.currentCoach).toBeNull();
    expect(entry.recipientKind).toBe('PROGRAMME_INBOX');
    expect(entry.currentRecipient).toMatchObject({ kind: 'PROGRAMME_INBOX', id: P.r.pcs[0], primary: 'Programme Contact', secondary: "romeo College Men's Soccer", isPerson: false });
  });
  it('T. no outreach writer accepts an inbox: createOutreach takes a coach only', () => {
    expect(() => createOutreach({ athleteId: ATH, coachId: P.r.pcs[0] })).toThrow(/FOREIGN KEY|COACH|coach/i);
    expect(isProgrammeInboxAddress(`MSOCCER@${P.r.host}`)).toBe(true);
    expect(isProgrammeInboxAddress(`coach0@${P.b.host}`)).toBe(false);
  });
});

describe('U–V. the coach floor is untouched', () => {
  it('U. coachIneligibility gives the same answers it always did', () => {
    expect(coachIneligibility({ email: 'a@b.edu', email_status: 'verified', currentness_status: 'CURRENT' })).toBeNull();
    expect(coachIneligibility({ email: 'a@b.edu', email_status: 'inferred' })).toBe('EMAIL_NOT_VERIFIED:inferred');
    expect(coachIneligibility({ email: 'a@b.edu', email_status: 'verified', currentness_status: 'PROVEN_STALE' })).toBe('COACH_PROVEN_STALE');
  });
  it('V. a legacy generic team row stays ineligible and is never a recipient under the default floor', () => {
    const row = db.prepare('SELECT * FROM coaches WHERE id = ?').get(P.f.coaches[0]);
    expect(coachIneligibility(row)).toBe('EMAIL_NOT_VERIFIED:generic');
    const plan = planOf('f');
    expect(plan.recipients.some((r) => r.coachId === row.id)).toBe(false);
  });
});

describe('H5. recruiting observations: an inbox reply is attributed to no person, and its provenance survives', () => {
  it('records coach_id NULL with the inbox send as its anchor', () => {
    const o = db.prepare("SELECT id FROM outreach WHERE id = 'k-inbox'").get();
    db.prepare(`INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id, programme_contact_id, college_name, sport, policy_version, created_at, state, origin, subject)
      VALUES ('k-send', ?, 1, ?, ?, ?, NULL, ?, ?, 'mens-soccer', 'P2', ?, 'ACCEPTED', 'manual', 's')`).run(o.id, T, T, K_ATH, P.k.pcs[0], P.k.name, T);
    // through the real reply-classification path: it copies send.coach_id, which is NULL for an inbox
    const obs = classifyReply(db, { sendId: 'k-send', kind: 'POSITIVE_REPLY', requireReply: false });
    const row = db.prepare('SELECT coach_id, outreach_send_id, college_name, sport FROM recruiting_observations WHERE id = ?').get(obs.id ?? obs.observation?.id);
    expect(row).toEqual({ coach_id: null, outreach_send_id: 'k-send', college_name: P.k.name, sport: 'mens-soccer' });
    // provenance: the anchor says it came through a programme inbox, without inventing a coach
    const via = db.prepare('SELECT s.programme_contact_id FROM recruiting_observations r JOIN outreach_send s ON s.id = r.outreach_send_id WHERE r.id = ?').get(obs.id ?? obs.observation?.id);
    expect(via.programme_contact_id).toBe(P.k.pcs[0]);
  });
});
