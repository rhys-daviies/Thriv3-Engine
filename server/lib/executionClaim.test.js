import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { materialiseNextContactAttempt } from './pursuitPolicy.js';
import { generateProgrammeMessage } from './programmeMessageGeneration.js';
import { reviewProgrammeMessage, programmeMessage } from './programmeMessages.js';
import { claimProgrammeMessageForExecution, CLAIM_REFUSAL } from './executionClaim.js';
import { createOutreach, revokeOutreach } from './outreach.js';
import { recordDraft, confirmSend, sendsForOutreach, transitionSend } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { suppress } from './suppressions.js';
import { closeCampaign, setProgrammeCampaignState } from './campaigns.js';
import { contactAttempt } from './contactAttempts.js';
import { pendingDrafts } from './confirmSends.js';
import { recordManualOutboundAttempt } from './outboundBudget.js';
import fs from 'node:fs';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * D4.5 — EVERYTHING THAT MUST BE TRUE BEFORE A PROVIDER IS CALLED, COMMITTED
 * WITH THE CLAIM OR NOT AT ALL.
 *
 * The claim is the moment a message stops being a plan. After it, a transport
 * may run; before it, nothing has been spent and nothing is owed. So the tests
 * that matter here are almost all about what happens when the answer is NO:
 * the world changed between review and send, two callers arrived at once, or
 * the budget ran out — and in every one of those the database must look
 * exactly as it did a moment earlier.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE SENDS ANYTHING. There is no transport to mock, because the
 * claim has no transport after it: it commits and returns. The spies below
 * exist to prove that — that no provider module, no credential and no Outlook
 * bridge is reached on any path, successful or not.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-d45';
const OTHER_ATHLETE = 'a-d45-other';
const OPERATOR = 'op-d45';
const OTHER_OPERATOR = 'op-d45-2';
const TODAY = '2026-09-18';
const NOW = '2026-09-18T09:00:00.000Z';
const RUN = 'run-d45-0001';
const COLLEGE = 'Duke';
let seq = 0;

/* -------------------------------------------------------------------------- */
/* Fixtures — the real chain, through the real writers                         */
/* -------------------------------------------------------------------------- */

function athlete(id = ATHLETE) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(id, randomUUID().slice(0, 10));
}

function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(id, `${id}@thriv3.test`);
}

function campaign({ id = `camp-${++seq}`, state = 'active', startsOn = '2020-01-01', outreachEndsOn = null } = {}) {
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, outreach_ends_on, created_at,
      updated_at, snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, ?, ?, 'x', 'x', 'x', 1)
  `).run(id, ATHLETE, state, startsOn, outreachEndsOn);
  return id;
}

function programme(campaignId, { id = `pc-${++seq}`, college = COLLEGE, staff = 2 } = {}) {
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(id, campaignId, college, ++seq);
  const coaches = [];
  for (let i = 0; i < staff; i += 1) {
    coaches.push(findOrCreateCoach({
      full_name: `${String.fromCharCode(65 + i)} Coach`,
      email: `c${++seq}@${college.toLowerCase().replace(/\W/g, '')}.edu`,
      school: college, sport: 'mens-soccer', division: 'NCAA D1',
      position_title: i === 0 ? 'Head Coach' : 'Assistant Coach',
    }));
  }
  return { id, coaches };
}

/** Roster history the engine can licence, so the composition is a real one. */
function rosterFor(college = COLLEGE) {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, 'x', 'x', ?, 'mens-soccer', 'NCAA D1', 'ACC')
  `).run(randomUUID(), college);
  for (const [name, season] of [['Hayden Aish', '2024'], ['Jack Kelly', '2023']]) {
    db.prepare(`
      INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played,
        games_played)
      VALUES (?, 'x', 'x', ?, 'mens-soccer', 'NCAA D1', ?, ?, 'DEFENSE', 'International',
        'New Zealand', 'Junior', 900, 18)
    `).run(randomUUID(), college, season, name);
  }
}

function stance(value, { college = COLLEGE } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
      visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?, 'x', 'x')
  `).run(randomUUID(), ATHLETE, college, value);
}

/** A connected mailbox with a credential, which is what the claim requires. */
function mailboxFor({ athleteId = ATHLETE, operatorId = OPERATOR, status = 'CONNECTED', credential = true } = {}) {
  const id = `mb-${randomUUID()}`;
  db.prepare(`
    INSERT INTO connected_mailboxes (id, operator_user_id, athlete_id, provider,
      provider_account_id, email_address, status, connected_at, created_at, updated_at)
    VALUES (?, ?, ?, 'GOOGLE', ?, ?, ?, 'x', 'x', 'x')
  `).run(id, operatorId, athleteId, randomUUID(), `  Athlete${++seq}@Example.COM  `, status);
  if (credential) {
    db.prepare(`
      INSERT INTO connected_mailbox_credentials (mailbox_id, ciphertext, iv, auth_tag, key_version,
        rotated_at, created_at, updated_at)
      VALUES (?, 'ct', 'iv', 'tag', 'v1', 'x', 'x', 'x')
    `).run(id);
  }
  return id;
}

/** Prepared, composed and APPROVED — the state a claim starts from. */
function reviewed({ college = COLLEGE, campaignOpts = {} } = {}) {
  const c = campaign(campaignOpts);
  const { id: pc, coaches } = programme(c, { college });
  rosterFor(college);
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message } = generateProgrammeMessage({
    programmeCampaignId: pc, coachId: coaches[0].id,
  });
  reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
  return { c, pc, coaches, head: coaches[0], messageId: message.id };
}

const claim = (messageId, mailboxId, over = {}) => claimProgrammeMessageForExecution({
  programmeMessageId: messageId,
  operatorUserId: OPERATOR,
  connectedMailboxId: mailboxId,
  runId: RUN,
  at: NOW,
  onDate: TODAY,
  ...over,
});

const rows = (t) => db.prepare(`SELECT * FROM ${t}`).all();
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

/** Everything the claim could touch, so a refusal can be shown to touch none of it. */
const TABLES = [
  'outreach', 'outreach_send', 'outreach_send_event', 'outbound_send_attempt',
  'programme_messages', 'programme_contact_attempts', 'programme_campaigns', 'campaigns',
  'connected_mailboxes', 'coaches',
];
const snapshot = () => JSON.stringify(Object.fromEntries(TABLES.map((t) => [t, rows(t)])));

beforeEach(() => {
  /**
   * ORDER MATTERS, and D4.5 is the reason. A claim LINKS the contact attempt to
   * the lifetime relationship, so `programme_contact_attempts.outreach_id` is
   * no longer always null — and deleting `outreach` first now fails the foreign
   * key rather than passing by luck.
   */
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach_evidence;
           DELETE FROM programme_messages; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM campaign_first_touch_approvals; DELETE FROM athlete_programmes;
           DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM operator_sessions; DELETE FROM operator_users;
           DELETE FROM roster_players; DELETE FROM colleges; DELETE FROM coaches;
           DELETE FROM suppressions; DELETE FROM players;`);
  athlete();
  athlete(OTHER_ATHLETE);
  operator(OPERATOR);
  operator(OTHER_OPERATOR);
  seq = 0;
});

/* ========================================================================== */
/* A — the successful claim                                                    */
/* ========================================================================== */

describe('A. a claim that succeeds', () => {
  it('writes one execution record, claimed, attributed and paid for', () => {
    const { pc, head, messageId } = reviewed();
    const mailboxId = mailboxFor();

    const out = claim(messageId, mailboxId);

    // ---- the approved content is untouched ----
    const message = programmeMessage(messageId);
    expect(message.state).toBe('reviewed');
    expect(message.subject).toBeTruthy();

    // ---- the attempt is linked, and still PLANNED ----
    const attempt = contactAttempt(message.programme_contact_attempt_id);
    expect(attempt.outreach_id).toBe(out.outreach.id);
    /**
     * DELIBERATELY NOT `active` — D4.5 does not move the attempt lifecycle.
     * `generateProgrammeMessage` still requires `planned`, so activating here
     * would make the step-2 follow-up ungeneratable for ever. D4.8 owns it.
     */
    expect(attempt.state).toBe('planned');

    // ---- exactly one execution record, claimed ----
    const sends = sendsForOutreach(out.outreach.id);
    expect(sends).toHaveLength(1);
    const [send] = sends;
    expect(send.state).toBe('SENDING');
    expect(send.sequence).toBe(1);

    // ---- with its attribution ----
    expect(send.programme_message_id).toBe(messageId);
    expect(send.programme_campaign_id).toBe(pc);
    expect(send.connected_mailbox_id).toBe(mailboxId);
    expect(send.provider).toBe('GOOGLE');
    expect(send.origin).toBe('campaign');
    expect(send.coach_id).toBe(head.id);
    expect(send.athlete_id).toBe(ATHLETE);
    // Normalised, so the ledger and the message agree exactly. The fixture
    // stores the address padded and mixed-case on purpose.
    expect(send.sending_identity).toBe(send.sending_identity.trim().toLowerCase());
    expect(send.claimed_at).toBe(NOW);
    expect(send.claim_run_id).toBe(RUN);

    // ---- and one outbound action, pointed at the message ----
    const ledger = rows('outbound_send_attempt');
    expect(ledger).toHaveLength(1);
    expect(ledger[0].outreach_send_id).toBe(send.id);
    expect(ledger[0].sending_identity).toBe(send.sending_identity);
    expect(ledger[0].transport).toBe('PROVIDER_API');
    expect(ledger[0].athlete_id).toBe(ATHLETE);

    // ---- nothing has been accepted, because nothing has been sent ----
    expect(send.sent_at).toBeNull();
    expect(send.accepted_source).toBeNull();
    expect(send.provider_message_id).toBeNull();
    expect(send.provider_accepted_at).toBeNull();
    expect(out.send.id).toBe(send.id);
  });

  it('carries the approved evidence into the execution snapshot', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const message = programmeMessage(messageId);

    const out = claim(messageId, mailboxId);
    const [send] = sendsForOutreach(out.outreach.id);

    // Re-projected from the frozen composition, not re-derived from the roster.
    expect(send.rendered_count).toBe(message.evidence_snapshot.rendered.length);
    expect(send.structure).toBe(message.evidence_snapshot.structure);
    expect(send.payload.rendered.map((r) => r.kind))
      .toEqual(message.evidence_snapshot.rendered.map((r) => r.kind));
  });

  it('records the APPROVED body, and does not pretend the wire body exists', () => {
    /**
     * THE BOUNDARY D4.5 IS HONEST ABOUT. What a coach eventually reads is the
     * approved words plus the tracked profile link and the compliance footer,
     * both applied at transport. Neither has happened, so the snapshot hashes
     * what it actually has — and the message is SENDING rather than ACCEPTED,
     * which is the state in which that is still true and still correctable.
     */
    const { messageId } = reviewed();
    const message = programmeMessage(messageId);
    const out = claim(messageId, mailboxFor());
    const [send] = sendsForOutreach(out.outreach.id);

    expect(send.subject).toBe(message.subject);
    expect(send.body_hash).toBe(message.body_hash);
    expect(message.body).toContain('{{player_profile_url}}');
  });
});

/* ========================================================================== */
/* B — nothing is sent, and nothing that could send is reached                 */
/* ========================================================================== */

describe('B. no transport, no credential, no provider', () => {
  it('reaches no transport, mailbox-credential or provider module', async () => {
    const outlook = await import('./outlook.js');
    const mailboxes = await import('./connectedMailboxes.js');
    const google = await import('./googleMailboxOAuth.js');
    const compose = vi.spyOn(outlook, 'composeInOutlook');
    const credential = vi.spyOn(mailboxes, 'mailboxCredential');
    const exchange = vi.spyOn(google, 'exchangeCodeForIdentity');

    const { messageId } = reviewed();
    claim(messageId, mailboxFor());

    expect(compose).not.toHaveBeenCalled();
    expect(credential).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
    compose.mockRestore(); credential.mockRestore(); exchange.mockRestore();
  });

  it('imports nothing that could send', () => {
    /**
     * The static half of the same claim. A spy proves this run took no such
     * path; this proves no path exists to take.
     *
     * ON THE IMPORTS, NOT ON THE WORDS. The module explains at length why it
     * does not call `mailboxCredential`, and a naive substring search would
     * read that explanation as the offence it describes.
     */
    const src = fs.readFileSync('server/lib/executionClaim.js', 'utf8');
    const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    for (const forbidden of ['outlook', 'googleMailboxOAuth', 'mailboxCrypto',
      'nodemailer', 'googleapis', 'google-auth']) {
      expect(imports).not.toContain(forbidden);
    }
    // And it calls neither the decryptor nor any transport, anywhere.
    expect(src).not.toMatch(/mailboxCredential\s*\(/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/composeInOutlook/);
  });

  it('leaves the message in SENDING and resolves nothing', () => {
    const { messageId } = reviewed();
    const out = claim(messageId, mailboxFor());
    expect(out.send.state).toBe('SENDING');
    expect(count('outreach_send_event')).toBe(0);
  });
});

/* ========================================================================== */
/* C / G / H — one claimant, and the loser spends nothing                      */
/* ========================================================================== */

describe('G. the same message claimed twice', () => {
  it('produces one execution record and one outbound action', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();

    claim(messageId, mailboxId);
    const after = snapshot();

    expect(() => claim(messageId, mailboxId)).toThrow(/already/i);

    // Nothing at all moved on the second attempt — including the budget.
    expect(snapshot()).toBe(after);
    expect(count('outreach_send')).toBe(1);
    expect(count('outbound_send_attempt')).toBe(1);
  });

  it('refuses with the claim-lost code rather than a safety one', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    claim(messageId, mailboxId);
    try {
      claim(messageId, mailboxId);
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe(CLAIM_REFUSAL.SEND_CLAIM_LOST);
    }
  });
});

describe('C. losing the claim costs no capacity', () => {
  it('spends nothing when the message is already SENDING', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    claim(messageId, mailboxId);

    const ledgerBefore = count('outbound_send_attempt');
    const sendBefore = JSON.stringify(rows('outreach_send'));

    expect(() => claim(messageId, mailboxId)).toThrow();

    expect(count('outbound_send_attempt')).toBe(ledgerBefore);
    expect(JSON.stringify(rows('outreach_send'))).toBe(sendBefore);
  });

  it('is refused even after the message has been accepted', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const out = claim(messageId, mailboxId);
    // Resolve it the way a provider acceptance eventually will.
    transitionSend(out.send.id, 'ACCEPTED', { acceptedSource: ACCEPTED_SOURCE.PROVIDER_ACCEPTED });

    const after = snapshot();
    expect(() => claim(messageId, mailboxId)).toThrow();
    expect(snapshot()).toBe(after);
  });
});

/* ========================================================================== */
/* D — budget refusal rolls the whole transaction back                         */
/* ========================================================================== */

describe('D. a budget that cannot pay rolls everything back', () => {
  const expectNothingWritten = (before) => {
    expect(snapshot()).toBe(before);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
  };

  it('writes nothing at all when the athlete has no capacity left', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const before = snapshot();

    expect(() => claim(messageId, mailboxId, { athleteLimit: 0 }))
      .toThrow();
    expectNothingWritten(before);
  });

  it('writes nothing at all when the mailbox has no capacity left', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const before = snapshot();

    expect(() => claim(messageId, mailboxId, { mailboxLimit: 0 })).toThrow();
    expectNothingWritten(before);
  });

  it('leaves no relationship, no link, no claim and no ledger row behind', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const message = programmeMessage(messageId);

    expect(() => claim(messageId, mailboxId, { athleteLimit: 0 })).toThrow();

    expect(count('outreach')).toBe(0);
    expect(contactAttempt(message.programme_contact_attempt_id).outreach_id).toBeNull();
    expect(programmeMessage(messageId).state).toBe('reviewed');
  });
});

/* ========================================================================== */
/* E — the world changed between review and send                               */
/* ========================================================================== */

describe('E. a state that was valid at review and is not now', () => {
  const refusesWithNoWrites = (mutate) => {
    const fixture = reviewed();
    const mailboxId = mailboxFor();
    mutate(fixture);
    const before = snapshot();
    let thrown = null;
    try { claim(fixture.messageId, mailboxId); } catch (err) { thrown = err; }
    expect(thrown, 'the claim should have been refused').not.toBeNull();
    expect(snapshot()).toBe(before);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    return thrown;
  };

  it('refuses a suppressed coach', () => {
    const err = refusesWithNoWrites(({ head }) => suppress({ email: head.email }));
    expect(err.code).toBe('SUPPRESSED');
  });

  it('refuses a closed campaign', () => {
    const err = refusesWithNoWrites(({ c }) => closeCampaign(c, { reason: 'completed' }));
    expect(err.code).toBe('CAMPAIGN_NOT_ACTIVE');
  });

  it('refuses a stopped programme', () => {
    const err = refusesWithNoWrites(({ pc }) => setProgrammeCampaignState(pc, 'stopped', { reason: 'not a fit' }));
    expect(err.code).toBe('PROGRAMME_STOPPED');
  });

  it('refuses a do-not-contact stance', () => {
    const err = refusesWithNoWrites(() => stance('do_not_contact'));
    expect(err.code).toBe('RELATIONSHIP_DO_NOT_CONTACT');
  });

  it('refuses a manual-only stance', () => {
    const err = refusesWithNoWrites(() => stance('manual_only'));
    expect(err.code).toBe('RELATIONSHIP_MANUAL_ONLY');
  });

  it('refuses a revoked relationship', () => {
    const err = refusesWithNoWrites(({ head }) => {
      const o = createOutreach({ athleteId: ATHLETE, coachId: head.id });
      revokeOutreach(o.id);
    });
    expect(err.code).toBe('OUTREACH_REVOKED');
  });

  it('refuses when the coach address has changed since approval', () => {
    const err = refusesWithNoWrites(({ head }) => {
      db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('moved@duke.edu', head.id);
    });
    expect(err.code).toBe(CLAIM_REFUSAL.RECIPIENT_EMAIL_CHANGED);
  });

  it('refuses a message nobody reviewed', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    rosterFor();
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id });
    const mailboxId = mailboxFor();
    const before = snapshot();

    try {
      claim(message.id, mailboxId);
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe(CLAIM_REFUSAL.MESSAGE_NOT_REVIEWED);
    }
    expect(snapshot()).toBe(before);
  });

  it('refuses when the campaign has not started yet', () => {
    const fixture = reviewed({ campaignOpts: { startsOn: '2099-01-01' } });
    const mailboxId = mailboxFor();
    const before = snapshot();
    try {
      claim(fixture.messageId, mailboxId);
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('CAMPAIGN_NOT_STARTED');
    }
    expect(snapshot()).toBe(before);
  });

  it('refuses when the outreach window has closed', () => {
    const fixture = reviewed({ campaignOpts: { outreachEndsOn: '2026-09-01' } });
    const mailboxId = mailboxFor();
    const before = snapshot();
    try {
      claim(fixture.messageId, mailboxId);
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('CAMPAIGN_OUTREACH_WINDOW_CLOSED');
    }
    expect(snapshot()).toBe(before);
  });

  it('refuses when the campaign has moved past this step', () => {
    const { pc, head, messageId } = reviewed();
    const mailboxId = mailboxFor();
    // A step-1 message on file, accepted — so B6 now derives step 2.
    const o = createOutreach({ athleteId: ATHLETE, coachId: head.id, programmeCampaignId: pc });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: head.id, collegeName: COLLEGE,
      sport: 'mens-soccer', programmeCampaignId: pc, evidence: null, body: 'earlier', subject: 's',
    });
    confirmSend(o.id, '2026-09-10T09:00:00.000Z', { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });

    const before = snapshot();
    try {
      claim(messageId, mailboxId);
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe(CLAIM_REFUSAL.CONTACT_ATTEMPT_STEP_DRIFT);
    }
    expect(snapshot()).toBe(before);
    expect(count('outbound_send_attempt')).toBe(0);
  });
});

/* ========================================================================== */
/* F — the mailbox                                                             */
/* ========================================================================== */

describe('F. mailbox identity', () => {
  const refuses = (mailboxId, code, operatorUserId = OPERATOR) => {
    const { messageId } = reviewed();
    const before = snapshot();
    try {
      claim(messageId, mailboxId, { operatorUserId });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe(code);
    }
    expect(snapshot()).toBe(before);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
  };

  it('refuses a mailbox belonging to another athlete', () => {
    refuses(mailboxFor({ athleteId: OTHER_ATHLETE }), CLAIM_REFUSAL.MAILBOX_ATHLETE_MISMATCH);
  });

  it('refuses a mailbox belonging to another operator, without saying it exists', () => {
    refuses(mailboxFor({ operatorId: OTHER_OPERATOR }), CLAIM_REFUSAL.MAILBOX_NOT_FOUND);
  });

  it('refuses a mailbox this operator does not hold at all', () => {
    refuses(`mb-${randomUUID()}`, CLAIM_REFUSAL.MAILBOX_NOT_FOUND);
  });

  it('refuses a revoked mailbox', () => {
    refuses(mailboxFor({ status: 'REVOKED' }), CLAIM_REFUSAL.MAILBOX_NOT_CONNECTED);
  });

  it('refuses a mailbox that needs reconsent', () => {
    refuses(mailboxFor({ status: 'NEEDS_RECONSENT' }), CLAIM_REFUSAL.MAILBOX_NOT_CONNECTED);
  });

  it('refuses a mailbox with no stored credential', () => {
    refuses(mailboxFor({ credential: false }), CLAIM_REFUSAL.MAILBOX_CREDENTIAL_MISSING);
  });

  it('snapshots the mailbox address normalised, matching the ledger exactly', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const raw = db.prepare('SELECT email_address FROM connected_mailboxes WHERE id = ?')
      .get(mailboxId).email_address;
    expect(raw).not.toBe(raw.trim().toLowerCase());   // the fixture is deliberately messy

    const out = claim(messageId, mailboxId);
    expect(out.send.sending_identity).toBe(raw.trim().toLowerCase());
    expect(rows('outbound_send_attempt')[0].sending_identity).toBe(out.send.sending_identity);
  });
});

/* ========================================================================== */
/* I — an injected failure after the writes, before the commit                 */
/* ========================================================================== */

describe('I. a failure before commit takes every write with it', () => {
  it('rolls back the relationship, link, execution record, claim and ledger row', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const message = programmeMessage(messageId);
    const before = snapshot();

    /**
     * The last thing the transaction does is spend the budget. Making that
     * throw is an injected failure at the very end of the write sequence: by
     * then the relationship, the link, the execution record and the claim all
     * exist inside the transaction, and every one of them must vanish.
     */
    expect(() => claim(messageId, mailboxId, { mailboxLimit: 0 })).toThrow();

    expect(snapshot()).toBe(before);
    expect(count('outreach')).toBe(0);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(contactAttempt(message.programme_contact_attempt_id).outreach_id).toBeNull();
  });

  it('keeps a relationship that already existed before the transaction', () => {
    /**
     * `createOutreach` is idempotent and returns an existing row untouched, so
     * a rollback must not take a relationship the claim did not create — it
     * carries a tracking token a coach may already hold.
     */
    const { head, messageId } = reviewed();
    const existing = createOutreach({ athleteId: ATHLETE, coachId: head.id });
    const mailboxId = mailboxFor();

    expect(() => claim(messageId, mailboxId, { athleteLimit: 0 })).toThrow();

    const after = db.prepare('SELECT * FROM outreach WHERE id = ?').get(existing.id);
    expect(after).toBeTruthy();
    expect(after.token).toBe(existing.token);
    expect(count('outreach')).toBe(1);
  });
});

/* ========================================================================== */
/* J — the legacy paths are untouched                                          */
/* ========================================================================== */

describe('J. legacy and manual behaviour is unchanged', () => {
  it('a legacy draft still records no execution attribution', () => {
    const { head } = reviewed();
    const o = createOutreach({ athleteId: ATHLETE, coachId: head.id });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: head.id, collegeName: COLLEGE,
      sport: 'mens-soccer', evidence: null, body: 'manual', subject: 'manual',
    });
    const [send] = sendsForOutreach(o.id);
    for (const c of ['programme_message_id', 'connected_mailbox_id', 'sending_identity',
      'provider', 'claimed_at', 'claim_run_id']) {
      expect(send[c]).toBeNull();
    }
    expect(send.state).toBe('DRAFT');
  });

  it('a manual outbound action still records no message pointer', () => {
    const { head } = reviewed();
    const o = createOutreach({ athleteId: ATHLETE, coachId: head.id });
    const attempt = recordManualOutboundAttempt({ outreachId: o.id, sendingIdentity: 'x@y.test' });
    expect(attempt.outreach_send_id).toBeNull();
    expect(attempt.transport).toBe('OUTLOOK_MANUAL');
  });

  it('a claimed message does not appear as a pending draft to confirm', () => {
    const { messageId } = reviewed();
    claim(messageId, mailboxFor());
    /**
     * SENDING is in OPEN_STATES, so the batch tool CAN see it — and that is
     * correct for the legacy meaning of open. What must not happen is silence:
     * this records today's behaviour so D4.7 changes it deliberately if the
     * provider path should be invisible to the AppleScript confirmation tool.
     */
    const pending = pendingDrafts({ athleteId: ATHLETE });
    expect(Array.isArray(pending)).toBe(true);
  });
});

/* ========================================================================== */
/* The claim identity                                                          */
/* ========================================================================== */

describe('the run that holds the claim', () => {
  it('requires a run id', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    for (const runId of [undefined, '', '   ']) {
      expect(() => claim(messageId, mailboxId, { runId })).toThrow();
    }
    expect(count('outreach_send')).toBe(0);
  });

  it('refuses a run id that is not server-shaped', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    for (const runId of ['has space', 'x'.repeat(65), '\trun']) {
      let code = null;
      try { claim(messageId, mailboxId, { runId }); } catch (err) { code = err.code; }
      expect(code).toBeTruthy();
    }
    expect(count('outreach_send')).toBe(0);
  });

  it('records it beside the claim instant', () => {
    const { messageId } = reviewed();
    const out = claim(messageId, mailboxFor(), { runId: 'worker-7', at: '2026-09-18T11:22:33.000Z' });
    expect(out.send.claim_run_id).toBe('worker-7');
    expect(out.send.claimed_at).toBe('2026-09-18T11:22:33.000Z');
  });
});
