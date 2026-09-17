import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import {
  executionDecision, EXECUTION_CLASS, EXECUTION_REFUSAL, EXECUTABLE_PROVIDERS,
} from './executionDecision.js';

import { materialiseNextContactAttempt, programmePursuitPlan } from './pursuitPolicy.js';
import { generateProgrammeMessage } from './programmeMessageGeneration.js';
import { reviewProgrammeMessage, programmeMessage, programmeMessageWithContext } from './programmeMessages.js';
import { createOutreach, revokeOutreach } from './outreach.js';
import { recordDraft, confirmSend } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { suppress } from './suppressions.js';
import { closeCampaign, setProgrammeCampaignState } from './campaigns.js';
import { createConnectedMailbox, storeMailboxCredential, revokeMailbox } from './connectedMailboxes.js';
import { recordOutboundAttempt, TRANSPORT } from './outboundBudget.js';
import { markResponded } from './engagementRollup.js';
import { approveFirstTouch } from './firstTouchApprovals.js';
import { outreachBetween } from './outreach.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * F11b — MAY THIS REVIEWED MESSAGE BE TRANSMITTED NOW?
 *
 * ===========================================================================
 * THE LAST QUESTION BEFORE SOMETHING IRREVERSIBLE.
 *
 * Every other gate in this system protects a row. This one protects a coach's
 * inbox, and it is the only gate whose failure cannot be undone by editing the
 * database. So the tests are written the way the decision is: fail closed, say
 * the most important true thing, and never guess.
 * ===========================================================================
 *
 * THREE PROPERTIES CARRY THE SLICE.
 *
 *   1. IT DECIDES NOTHING ITSELF. Every rule is called, not copied. A second
 *      implementation of a stance rule would be a second policy, and the last
 *      check before an email leaves is the worst place for two of them.
 *   2. IT WRITES NOTHING AND SPENDS NOTHING. Asking must be free and
 *      repeatable — a screen asks on every render and a scheduler will poll.
 *   3. PRECEDENCE IS FIXED. Several refusals are true at once far more often
 *      than not, and a decision that reported whichever ran first would tell
 *      two operators two different stories about one message.
 */

const ATHLETE = 'a-f11b';
const OTHER_ATHLETE = 'a-f11b-other';
const OPERATOR = 'op-f11b';
const TODAY = '2026-09-20';
const COLLEGE = 'Duke';
let seq = 0;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function athlete(id, name = 'Marcus Reyes') {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', ?, 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(id, name, randomUUID().slice(0, 10));
}

function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(id, `${id}@thriv3.test`);
}

function campaign({ id = `camp-${++seq}`, state = 'active', startsOn = '2020-01-01' } = {}) {
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, ?, 'x', 'x', 'x', 1)
  `).run(id, ATHLETE, state, startsOn);
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

function evidenceFor(college = COLLEGE) {
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

function stance(value, { college = COLLEGE, athleteId = ATHLETE } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
      visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?, 'x', 'x')
  `).run(randomUUID(), athleteId, college, value);
}

/** A connected Google mailbox with a credential on file. */
function mailbox({
  athleteId = ATHLETE, provider = 'GOOGLE', address = `send${++seq}@gmail.test`,
  credential = true, status = 'CONNECTED',
} = {}) {
  const m = createConnectedMailbox({
    operatorUserId: OPERATOR,
    athleteId,
    provider,
    providerAccountId: `acct-${++seq}`,
    emailAddress: address,
    displayName: 'Sender',
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
  });
  if (credential) storeMailboxCredential(m.id, { refreshToken: `rt-${seq}`, operatorUserId: OPERATOR });
  if (status !== 'CONNECTED') {
    db.prepare('UPDATE connected_mailboxes SET status = ? WHERE id = ?').run(status, m.id);
  }
  return m;
}

/** A real accepted campaign send — the only thing that advances a step. */
function sendUnder(pc, coachId, { college = COLLEGE, at = '2026-09-02T09:00:00.000Z' } = {}) {
  const o = createOutreach({ athleteId: ATHLETE, coachId, programmeCampaignId: pc });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: college, sport: 'mens-soccer',
    programmeCampaignId: pc, evidence: null, body: `b${++seq}`, subject: 's',
  });
  confirmSend(o.id, at, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

/** Prepared, written and reviewed, with a usable mailbox. The happy path. */
function reviewed({ withMailbox = true, college = COLLEGE, staff = 2 } = {}) {
  const c = campaign();
  const { id: pc, coaches } = programme(c, { college, staff });
  evidenceFor(college);
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message } = generateProgrammeMessage({
    programmeCampaignId: pc, coachId: coaches[0].id,
  });
  reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
  const box = withMailbox ? mailbox() : null;
  return { c, pc, coaches, head: coaches[0], message: programmeMessage(message.id), box };
}

const decide = (id, at = TODAY) => executionDecision({ programmeMessageId: id, at });

/** The contact history an approval is recorded against — the plan's own. */
function priorContactFor(programmeCampaignId, coachId) {
  const plan = programmePursuitPlan({ programmeCampaignId });
  const found = [...plan.coaches, ...plan.beyondDepth, ...plan.ineligible]
    .find((c) => c.coachId === coachId);
  return found?.priorContact ?? { confirmedSendCount: 0, lastConfirmedSendAt: null };
}

/**
 * One row on the capacity ledger.
 *
 * Written directly rather than through `recordOutboundAttempt`, because that
 * function ENFORCES the ceiling it is being used to reach — the fortieth call
 * would refuse rather than record. What is under test here is the decision's
 * reading of a spent day, not B5's writer.
 */
function spendOne(sendingIdentity) {
  db.prepare(`
    INSERT INTO outbound_send_attempt (id, athlete_id, sending_identity, transport,
      attempted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), ATHLETE, String(sendingIdentity).toLowerCase(),
    TRANSPORT.OUTLOOK_APPLESCRIPT, `${TODAY}T09:00:00.000Z`, `${TODAY}T09:00:00.000Z`);
}

/* -------------------------------------------------------------------------- */

const TABLES = [
  'campaigns', 'programme_campaigns', 'programme_contact_attempts', 'programme_messages',
  'athlete_programmes', 'outreach', 'outreach_send', 'outreach_send_event',
  'outbound_send_attempt', 'connected_mailboxes', 'connected_mailbox_credentials',
  'campaign_first_touch_approvals', 'coaches', 'players', 'suppressions',
  'engagement_rollup', 'colleges', 'roster_players', 'operator_users',
];
const snapshot = () => Object.fromEntries(
  TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]),
);
const expectUnchanged = (before) => {
  const after = snapshot();
  for (const t of TABLES) expect(after[t], t).toEqual(before[t]);
};

const codeOf = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => {
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM programme_contact_attempts; DELETE FROM outbound_send_attempt;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM roster_players; DELETE FROM colleges;
           DELETE FROM coaches; DELETE FROM players; DELETE FROM operator_users;`);
  athlete(ATHLETE);
  athlete(OTHER_ATHLETE, 'Other Athlete');
  operator(OPERATOR);
  seq = 0;
});

/* ========================================================================== */
/* The happy path                                                             */
/* ========================================================================== */

describe('a reviewed message with everything current', () => {
  it('is executable, and says exactly what would happen', () => {
    const { pc, c, head, message, box } = reviewed();
    const d = decide(message.id);

    expect(d.executableNow).toBe(true);
    expect(d.classification).toBe(EXECUTION_CLASS.EXECUTABLE);
    expect(d.reason).toBeNull();
    expect(d).toMatchObject({
      programmeMessageId: message.id,
      programmeCampaignId: pc,
      campaignId: c,
      athleteId: ATHLETE,
      coachId: head.id,
      messageStep: 1,
      currentStep: 1,
      currentCoachId: head.id,
      messageState: 'reviewed',
    });
    expect(d.recipient).toEqual({
      frozen: message.recipient_email, current: message.recipient_email.toLowerCase(), matches: true,
    });
    expect(d.mailbox).toEqual({ id: box.id, provider: 'GOOGLE', address: box.email_address });
  });

  /**
   * THE DECISION IS A SENTENCE, NOT A SECRET. Everything a screen or a
   * transport needs to name the sender, and nothing that would let either
   * reconstruct a credential.
   */
  it('returns no credential, no token and no scope', () => {
    const { message } = reviewed();
    const json = JSON.stringify(decide(message.id));

    for (const forbidden of ['ciphertext', 'iv', 'auth_tag', 'refresh', 'token',
      'key_version', 'scopes', 'provider_account_id', 'credential']) {
      expect(json.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    expect(Object.keys(decide(message.id).mailbox).sort()).toEqual(['address', 'id', 'provider']);
  });

  it('gives the same answer every time it is asked', () => {
    const { message } = reviewed();
    const first = decide(message.id);
    for (let i = 0; i < 5; i += 1) expect(decide(message.id)).toEqual(first);
  });

  it('refuses to be asked about nothing', () => {
    expect(() => executionDecision({})).toThrow(
      expect.objectContaining({ code: 'PROGRAMME_MESSAGE_REQUIRED' }),
    );
  });
});

/* ========================================================================== */
/* The refusal matrix                                                         */
/* ========================================================================== */

describe('hard prohibitions — somebody decided, and waiting changes nothing', () => {
  const CASES = [
    {
      name: 'do not contact',
      apply: () => stance('do_not_contact'),
      reason: 'RELATIONSHIP_DO_NOT_CONTACT',
    },
    {
      name: 'manual outreach only',
      apply: () => stance('manual_only'),
      reason: 'RELATIONSHIP_MANUAL_ONLY',
    },
    {
      name: 'the address is suppressed',
      apply: ({ message }) => suppress({ email: message.recipient_email, reason: 'unsubscribed' }),
      reason: 'SUPPRESSED',
    },
    {
      name: 'the outreach relationship is revoked',
      apply: ({ pc, head }) => {
        const o = createOutreach({ athleteId: ATHLETE, coachId: head.id, programmeCampaignId: pc });
        revokeOutreach(o.id);
        expect(outreachBetween(ATHLETE, head.id).revoked_at).toBeTruthy();
      },
      reason: 'OUTREACH_REVOKED',
    },
    {
      name: 'the programme was stopped',
      apply: ({ pc }) => setProgrammeCampaignState(pc, 'stopped', { reason: 'operator' }),
      reason: 'PROGRAMME_STOPPED',
    },
    {
      name: 'the programme was completed',
      apply: ({ pc }) => {
        setProgrammeCampaignState(pc, 'active', { reason: 'started' });
        setProgrammeCampaignState(pc, 'completed', { reason: 'done' });
      },
      reason: 'PROGRAMME_COMPLETED',
    },
  ];

  for (const c of CASES) {
    it(`refuses ${c.name}`, () => {
      const ctx = reviewed();
      c.apply(ctx);
      const d = decide(ctx.message.id);

      expect(d.executableNow).toBe(false);
      expect(d.classification).toBe(EXECUTION_CLASS.HARD_PROHIBITION);
      expect(d.reason).toBe(c.reason);
      /* The message is still exactly what it was. Readable, not executable. */
      expect(programmeMessage(ctx.message.id)).toEqual(ctx.message);
    });
  }

  /**
   * A REPLY IS QUOTED FROM B6, NOT INVENTED HERE. The campaign stops proposing
   * cold outreach and a person decides — which for an automatic transport is a
   * refusal, and a hard one.
   */
  it('refuses once the coach has replied', () => {
    const { pc, head, message } = reviewed();
    const o = sendUnder(pc, head.id);
    markResponded(o.id, '2026-09-03T10:00:00.000Z');

    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.HARD_PROHIBITION);
    expect(d.reason).toBe(EXECUTION_REFUSAL.RESPONSE_OBSERVED);
  });

  it('refuses when nobody at the programme is reachable', () => {
    const { head, coaches, message } = reviewed({ staff: 1 });
    expect(coaches).toHaveLength(1);
    suppress({ email: head.email, reason: 'unsubscribed' });

    const d = decide(message.id);
    /* SUPPRESSED is the address fact and outranks "nobody is left". */
    expect(d.classification).toBe(EXECUTION_CLASS.HARD_PROHIBITION);
    expect(d.reason).toBe('SUPPRESSED');
  });

  it('refuses while a first touch still needs a person', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    evidenceFor();
    const head = coaches[0];
    /* Prior confirmed contact from OUTSIDE this campaign raises the hold. */
    const o = createOutreach({ athleteId: ATHLETE, coachId: head.id });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: head.id, collegeName: COLLEGE,
      sport: 'mens-soccer', evidence: null, body: 'manual', subject: 's',
    });
    confirmSend(o.id, '2026-08-20T09:00:00.000Z', { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
    approveFirstTouch({
      programmeCampaignId: pc,
      coachId: head.id,
      operatorId: OPERATOR,
      priorContact: priorContactFor(pc, head.id),
    });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
    mailbox();

    /* Approved: executable. */
    expect(decide(message.id).executableNow).toBe(true);

    /* Further confirmed contact makes the approval STALE, and the hold returns. */
    const o2 = createOutreach({ athleteId: ATHLETE, coachId: head.id });
    recordDraft({
      outreachId: o2.id, athleteId: ATHLETE, coachId: head.id, collegeName: COLLEGE,
      sport: 'mens-soccer', evidence: null, body: 'manual 2', subject: 's',
    });
    confirmSend(o2.id, '2026-09-10T09:00:00.000Z', { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });

    const d = decide(message.id);
    expect(d.executableNow).toBe(false);
    expect(d.reason).toBe('CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED');
    expect(d.classification).toBe(EXECUTION_CLASS.HARD_PROHIBITION);
  });

  /**
   * REVIEWING THE WORDS IS NOT REVIEWING THE HISTORY. Two different reviews of
   * two different things, and a message review must never discharge the hold.
   */
  it('does not let a message review satisfy the first-touch gate', () => {
    const code = codeOf('server/lib/executionDecision.js');
    expect(code).toMatch(/assertFirstTouchReviewed\(/);
    /* Called, never read off the flag — the gate narrows the question twice. */
    expect(code).not.toMatch(/firstTouchReview\?\.required/);
  });
});

describe('stale data — the campaign has moved past this message', () => {
  it('refuses a message nobody has reviewed', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    evidenceFor();
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id });
    mailbox();

    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.STALE_DATA);
    expect(d.reason).toBe(EXECUTION_REFUSAL.MESSAGE_NOT_REVIEWED);
    expect(d.messageState).toBe('generated');
  });

  it('refuses a message that does not exist', () => {
    const d = decide('no-such-message');
    expect(d.classification).toBe(EXECUTION_CLASS.STALE_DATA);
    expect(d.reason).toBe(EXECUTION_REFUSAL.PROGRAMME_MESSAGE_NOT_FOUND);
    expect(d.executableNow).toBe(false);
  });

  /**
   * THE ONE THAT MATTERS MOST. A reviewed step-1 message after the opening
   * email has gone is readable history; transmitting it sends it twice.
   */
  it('refuses a step-1 message once the campaign has advanced to step 2', () => {
    const { pc, head, message } = reviewed();
    expect(decide(message.id).executableNow).toBe(true);

    sendUnder(pc, head.id);

    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.STALE_DATA);
    expect(d.reason).toBe(EXECUTION_REFUSAL.STEP_DRIFT);
    expect(d.messageStep).toBe(1);
    expect(d.currentStep).toBe(2);

    /* Readable throughout — history is not deleted by becoming inexecutable. */
    expect(programmeMessageWithContext(message.id).message.body).toBe(message.body);
  });

  it('refuses once the campaign has moved to a different coach', () => {
    const { pc, head, coaches, message } = reviewed();
    /* Two accepted sends exhaust the head coach and move the pursuit on. */
    sendUnder(pc, head.id, { at: '2026-09-02T09:00:00.000Z' });
    sendUnder(pc, head.id, { at: '2026-09-08T09:00:00.000Z' });

    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.STALE_DATA);
    expect([EXECUTION_REFUSAL.COACH_NO_LONGER_CURRENT, EXECUTION_REFUSAL.ATTEMPT_NO_LONGER_CURRENT])
      .toContain(d.reason);
    expect(d.currentCoachId).toBe(coaches[1].id);
    expect(d.coachId).toBe(head.id);
  });

  /**
   * A STOPPED ATTEMPT TAKES ITS COACH OUT OF THE PURSUIT, so the truthful
   * answer is that the campaign now names somebody else — not that the attempt
   * is missing. Pinned because the two are easy to confuse and only one of
   * them is what an operator sees on the card.
   */
  it('refuses when the attempt the message hangs off has been stopped', () => {
    const { head, coaches, message } = reviewed();
    db.prepare('UPDATE programme_contact_attempts SET state = ? WHERE id = ?')
      .run('stopped', message.programme_contact_attempt_id);

    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.STALE_DATA);
    expect(d.reason).toBe(EXECUTION_REFUSAL.COACH_NO_LONGER_CURRENT);
    expect(d.coachId).toBe(head.id);
    expect(d.currentCoachId).toBe(coaches[1].id);
  });

  /** And where the attempt simply vanishes, that is what it says. */
  it('refuses when the attempt row has gone entirely', () => {
    const { message } = reviewed();
    db.prepare('DELETE FROM programme_contact_attempts WHERE id = ?')
      .run(message.programme_contact_attempt_id);

    /* The cascade takes the message with it — which is itself the refusal. */
    expect(decide(message.id).reason).toBe(EXECUTION_REFUSAL.PROGRAMME_MESSAGE_NOT_FOUND);
  });
});

describe('the recipient must still be the coach’s address', () => {
  it('passes on a case-insensitive match', () => {
    const { head, message } = reviewed();
    db.prepare('UPDATE coaches SET email = ? WHERE id = ?')
      .run(message.recipient_email.toUpperCase(), head.id);

    const d = decide(message.id);
    expect(d.executableNow).toBe(true);
    expect(d.recipient.matches).toBe(true);
  });

  /**
   * REFUSED, AND NOTHING IS CORRECTED. Sending to the frozen address emails
   * somebody who left; sending to the new one transmits words reviewed for a
   * different recipient; rewriting the message destroys the record.
   */
  it('refuses when the coach’s address has moved, and mutates nothing', () => {
    const { head, message } = reviewed();
    const before = snapshot();
    db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('moved@elsewhere.edu', head.id);

    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.STALE_DATA);
    expect(d.reason).toBe(EXECUTION_REFUSAL.RECIPIENT_CHANGED);
    expect(d.recipient).toEqual({
      frozen: message.recipient_email, current: 'moved@elsewhere.edu', matches: false,
    });
    /* The frozen provenance is exactly what it was. */
    expect(programmeMessage(message.id).recipient_email).toBe(message.recipient_email);
    expect(snapshot().programme_messages).toEqual(before.programme_messages);
  });

  /**
   * A COACH WITH NO ADDRESS IS NOT ELIGIBLE, so B6 drops them and the campaign
   * names the next person — which is the honest refusal and arrives before the
   * recipient comparison can. `RECIPIENT_MISSING` remains reachable for the
   * case B6 cannot see: a sole coach whose address is emptied, below.
   */
  it('moves on when the coach’s address is emptied and somebody else is available', () => {
    const { head, coaches, message } = reviewed();
    db.prepare('UPDATE coaches SET email = NULL WHERE id = ?').run(head.id);

    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.STALE_DATA);
    expect(d.reason).toBe(EXECUTION_REFUSAL.COACH_NO_LONGER_CURRENT);
    expect(d.currentCoachId).toBe(coaches[1].id);
  });
});

describe('timing and budget — correct, permitted, and not yet', () => {
  it('refuses a follow-up that is not due', () => {
    const { pc, head } = reviewed();
    sendUnder(pc, head.id, { at: `${TODAY}T09:00:00.000Z` });
    const { message: two } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    reviewProgrammeMessage(two.id, { operatorId: OPERATOR });

    const d = decide(two.id, TODAY);
    expect(d.classification).toBe(EXECUTION_CLASS.TIMING_BUDGET);
    expect(d.reason).toBe(EXECUTION_REFUSAL.FOLLOW_UP_NOT_YET_DUE);
    expect(d.policyEligibleOn).toBe('2026-09-24');
  });

  it('allows it four policy days later', () => {
    const { pc, head } = reviewed();
    sendUnder(pc, head.id, { at: `${TODAY}T09:00:00.000Z` });
    const { message: two } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    reviewProgrammeMessage(two.id, { operatorId: OPERATOR });

    expect(decide(two.id, '2026-09-24').executableNow).toBe(true);
  });

  it('refuses a draft campaign as TIMING, not as a prohibition', () => {
    const { message } = reviewed();
    db.prepare("UPDATE campaigns SET state = 'draft' WHERE athlete_id = ?").run(ATHLETE);

    const d = decide(message.id);
    /* B3's own classification, quoted. A draft is a fact about when. */
    expect(d.classification).toBe(EXECUTION_CLASS.TIMING_BUDGET);
    expect(d.reason).toBe('CAMPAIGN_NOT_ACTIVE');
  });

  it('refuses a closed campaign', () => {
    const { c, message } = reviewed();
    closeCampaign(c, { reason: 'completed' });
    expect(decide(message.id).reason).toBe('CAMPAIGN_NOT_ACTIVE');
  });

  it('refuses when the day’s allowance is spent, and spends nothing asking', () => {
    const { box, message } = reviewed();
    for (let i = 0; i < 40; i += 1) {
      spendOne(box.email_address);
    }
    const before = snapshot();

    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.TIMING_BUDGET);
    expect(d.reason).toMatch(/BUDGET_EXHAUSTED$/);
    /* It reports the mailbox that would have paid, and consumes nothing. */
    expect(d.mailbox.id).toBe(box.id);
    expectUnchanged(before);
  });
});

describe('execution configuration — nothing is wrong, something is unset', () => {
  it('refuses with no mailbox at all', () => {
    const { message } = reviewed({ withMailbox: false });
    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.EXECUTION_CONFIGURATION);
    expect(d.reason).toBe(EXECUTION_REFUSAL.MAILBOX_REQUIRED);
    expect(d.mailbox).toBeNull();
  });

  it('refuses a mailbox attached to nobody', () => {
    const { message } = reviewed({ withMailbox: false });
    mailbox({ athleteId: null });
    expect(decide(message.id).reason).toBe(EXECUTION_REFUSAL.MAILBOX_REQUIRED);
  });

  it('refuses another athlete’s mailbox', () => {
    const { message } = reviewed({ withMailbox: false });
    mailbox({ athleteId: OTHER_ATHLETE });
    expect(decide(message.id).reason).toBe(EXECUTION_REFUSAL.MAILBOX_REQUIRED);
  });

  it('asks for a reconnection when the mailbox is revoked', () => {
    const { message } = reviewed({ withMailbox: false });
    const m = mailbox();
    revokeMailbox(m.id, { operatorUserId: OPERATOR });
    const d = decide(message.id);
    expect(d.reason).toBe(EXECUTION_REFUSAL.MAILBOX_RECONSENT_REQUIRED);
  });

  it('asks for a reconnection when the credential has gone', () => {
    const { message } = reviewed({ withMailbox: false });
    mailbox({ credential: false });
    expect(decide(message.id).reason).toBe(EXECUTION_REFUSAL.MAILBOX_RECONSENT_REQUIRED);
  });

  it('asks for a reconnection when consent has lapsed', () => {
    const { message } = reviewed({ withMailbox: false });
    mailbox({ status: 'NEEDS_RECONSENT' });
    expect(decide(message.id).reason).toBe(EXECUTION_REFUSAL.MAILBOX_RECONSENT_REQUIRED);
  });

  /**
   * A PROVIDER NOTHING CAN DRIVE IS NOT A MAILBOX. The schema accepts
   * MICROSOFT; no code can send through it, and calling it usable would return
   * EXECUTABLE for something transport could not honour.
   */
  it('refuses a provider this build cannot transmit through', () => {
    const { message } = reviewed({ withMailbox: false });
    mailbox({ provider: 'MICROSOFT' });
    expect(decide(message.id).reason).toBe(EXECUTION_REFUSAL.MAILBOX_UNSUPPORTED);
    expect(EXECUTABLE_PROVIDERS).toEqual(['GOOGLE']);
  });

  /**
   * TWO IS A QUESTION NOBODY HAS ANSWERED. Choosing silently means outreach
   * leaves from whichever account sorted first.
   */
  it('refuses two usable mailboxes rather than picking one', () => {
    const { message } = reviewed();
    mailbox();
    const d = decide(message.id);
    expect(d.classification).toBe(EXECUTION_CLASS.EXECUTION_CONFIGURATION);
    expect(d.reason).toBe(EXECUTION_REFUSAL.MAILBOX_AMBIGUOUS);
    expect(d.mailbox).toBeNull();
    expect(d.mailboxCandidates).toBe(2);
  });

  /**
   * A CEILING NOBODY HAS CHOSEN IS NOT A SPENT ALLOWANCE. "Come back tomorrow"
   * is the wrong instruction for a setting that does not exist — B5 separates
   * the four budget refusals for exactly this reason, and the classification
   * has to carry the distinction through.
   */
  it('treats an unset mailbox ceiling as configuration, not as a spent day', async () => {
    const { message } = reviewed();
    const real = await import('./outboundBudget.js');
    vi.resetModules();
    /*
      THE SAME CONNECTION, NOT A NEW ONE. A re-imported db client is a different
      in-memory database, and the decision would be taken against no data at
      all — which looks exactly like a passing test until you read the reason.
    */
    vi.doMock('../db/client.js', () => ({ default: db }));
    vi.doMock('./outboundBudget.js', () => ({
      ...real,
      outboundBudgetDecisionForAthlete: () => ({
        allowed: false, reason: 'MAILBOX_LIMIT_REQUIRED', evaluated: true,
      }),
    }));
    const mod = await import('./executionDecision.js');

    const d = mod.executionDecision({ programmeMessageId: message.id, at: TODAY });
    expect(d.reason).toBe('MAILBOX_LIMIT_REQUIRED');
    expect(d.classification).toBe(EXECUTION_CLASS.EXECUTION_CONFIGURATION);

    vi.doUnmock('./outboundBudget.js');
    vi.doUnmock('../db/client.js');
    vi.resetModules();
  });
});

/* ========================================================================== */
/* Precedence                                                                 */
/* ========================================================================== */

describe('when several refusals are true at once, one of them wins', () => {
  const CASES = [
    {
      name: 'do-not-contact outranks a changed recipient',
      apply: ({ head }) => {
        stance('do_not_contact');
        db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('moved@x.edu', head.id);
      },
      reason: 'RELATIONSHIP_DO_NOT_CONTACT',
      classification: EXECUTION_CLASS.HARD_PROHIBITION,
    },
    {
      name: 'a closed campaign outranks a missing mailbox',
      apply: ({ c }) => {
        closeCampaign(c, { reason: 'completed' });
        db.prepare('DELETE FROM connected_mailbox_credentials').run();
        db.prepare('DELETE FROM connected_mailboxes').run();
      },
      /*
        B3'S OWN CLASSIFICATION, AND IT IS NOT THE ONE THE CODE ALONE IMPLIES.
        `CAMPAIGN_NOT_ACTIVE` covers a draft AND a closed campaign — opposite
        facts under one name — and only the decision that read the state can
        say which. A draft is TIMING; a closed campaign is settled.
      */
      reason: 'CAMPAIGN_NOT_ACTIVE',
      classification: EXECUTION_CLASS.HARD_PROHIBITION,
    },
    {
      name: 'manual-only outranks two mailboxes',
      apply: () => { stance('manual_only'); mailbox(); },
      reason: 'RELATIONSHIP_MANUAL_ONLY',
      classification: EXECUTION_CLASS.HARD_PROHIBITION,
    },
    {
      name: 'a changed coach outranks an undue follow-up',
      apply: ({ pc, head }) => {
        sendUnder(pc, head.id, { at: '2026-09-02T09:00:00.000Z' });
        sendUnder(pc, head.id, { at: `${TODAY}T09:00:00.000Z` });
      },
      classification: EXECUTION_CLASS.STALE_DATA,
    },
    {
      name: 'a changed recipient outranks a missing mailbox',
      apply: ({ head }) => {
        db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('moved@x.edu', head.id);
        db.prepare('DELETE FROM connected_mailbox_credentials').run();
        db.prepare('DELETE FROM connected_mailboxes').run();
      },
      reason: EXECUTION_REFUSAL.RECIPIENT_CHANGED,
      classification: EXECUTION_CLASS.STALE_DATA,
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const ctx = reviewed();
      c.apply(ctx);
      const d = decide(ctx.message.id);
      expect(d.executableNow).toBe(false);
      expect(d.classification).toBe(c.classification);
      if (c.reason) expect(d.reason).toBe(c.reason);
    });
  }

  it('an unreviewed message outranks an exhausted budget', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    evidenceFor();
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id });
    const box = mailbox();
    for (let i = 0; i < 40; i += 1) {
      spendOne(box.email_address);
    }
    expect(decide(message.id).reason).toBe(EXECUTION_REFUSAL.MESSAGE_NOT_REVIEWED);
  });
});

/* ========================================================================== */
/* The two proofs this slice exists to give                                   */
/* ========================================================================== */

describe('deciding changes nothing', () => {
  /**
   * EVERY PATH, NOT A SAMPLE. A screen asks this on every render and a
   * scheduler will poll it; a decision that consumed anything would make
   * looking at a campaign cost the thing it was looking at.
   */
  it('leaves nineteen tables byte-identical across every outcome', () => {
    const ctx = reviewed();
    /*
      ORDERED SO EACH MUTATION IS LEGAL FROM THE STATE THE LAST ONE LEFT. A
      closed campaign refuses an accepted send, so the send happens first — the
      point is to sweep every CLASSIFICATION, not to sequence them arbitrarily.
    */
    const mutations = [
      () => {},
      () => db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('x@y.edu', ctx.head.id),
      () => db.prepare('DELETE FROM connected_mailbox_credentials').run(),
      () => sendUnder(ctx.pc, ctx.head.id),
      () => stance('do_not_contact'),
      () => closeCampaign(ctx.c, { reason: 'completed' }),
    ];

    for (const mutate of mutations) {
      mutate();
      const before = snapshot();
      for (let i = 0; i < 3; i += 1) {
        decide(ctx.message.id);
        decide('no-such-message');
      }
      expectUnchanged(before);
    }
  });

  it('contains no write of its own', () => {
    const code = codeOf('server/lib/executionDecision.js');
    expect(code).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
    expect(code).not.toMatch(/db\.prepare|db\.exec|from '\.\.\/db\//);
    /* Nor of anybody else's. */
    expect(code).not.toMatch(/recordOutboundAttempt|recordManualOutboundAttempt/);
    expect(code).not.toMatch(/createOutreach|recordDraft|transitionSend|acceptSend|confirmSend/);
    expect(code).not.toMatch(/materialiseNextContactAttempt|createProgrammeMessage/);
    expect(code).not.toMatch(/approveFirstTouch|suppress\(|revokeMailbox|storeMailboxCredential/);
  });
});

describe('a decision about readiness is not permission to read a secret', () => {
  it('never reaches a credential, a provider or a transport', () => {
    const code = codeOf('server/lib/executionDecision.js');
    expect(code).not.toMatch(/mailboxCredential/);
    expect(code).not.toMatch(/decryptMailboxCredential|encryptMailboxCredential|mailboxCrypto/);
    expect(code).not.toMatch(/connected_mailbox_credentials/);
    expect(code).not.toMatch(/google-auth|googleapis|OAuth2Client|googleMailboxOAuth/);
    expect(code).not.toMatch(/nodemailer|smtp|sendOutreach|outlook/i);

    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual([
      './campaignAttribution.js', './campaignExecution.js', './campaignFirstTouchGate.js',
      './coaches.js', './connectedMailboxes.js', './outboundBudget.js', './outreach.js',
      './programmeMessages.js', './pursuitPolicy.js', './time.js',
    ]);
  });

  /** And the readiness helper it does use cannot leak one either. */
  it('reads credential PRESENCE without selecting the credential', () => {
    const code = codeOf('server/lib/connectedMailboxes.js');
    const helper = code.slice(code.indexOf('export function usableMailboxesForAthlete'));
    const body = helper.slice(0, helper.indexOf('\n}'));
    expect(body).toMatch(/EXISTS \(SELECT 1 FROM connected_mailbox_credentials/);
    expect(body).not.toMatch(/ciphertext|iv|auth_tag|key_version/);
  });
});

/* ========================================================================== */
/* Cost                                                                       */
/* ========================================================================== */

describe('one decision is one message’s worth of work', () => {
  it('does not build a campaign-wide plan for a single message', async () => {
    const c = campaign();
    /* Twenty programmes in the campaign; the decision is about one of them. */
    for (let i = 0; i < 20; i += 1) {
      const p = programme(c, { id: `pc-many-${i}`, college: `P${i}`, staff: 1 });
      materialiseNextContactAttempt({ programmeCampaignId: p.id });
    }
    const target = programme(c, { id: 'pc-target', college: 'Target', staff: 1 });
    evidenceFor('Target');
    materialiseNextContactAttempt({ programmeCampaignId: target.id });
    const { message } = generateProgrammeMessage({
      programmeCampaignId: target.id, coachId: target.coaches[0].id,
    });
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
    mailbox();

    const executions = new Map();
    const counting = new Proxy(db, {
      get(t, prop) {
        if (prop === 'prepare') {
          return (sql) => {
            const stmt = t.prepare(sql);
            return new Proxy(stmt, {
              get(s, key) {
                const v = s[key];
                if (typeof v !== 'function') return v;
                return (...args) => {
                  if (key === 'all' || key === 'get' || key === 'run') {
                    executions.set(sql, (executions.get(sql) ?? 0) + 1);
                  }
                  return v.apply(s, args);
                };
              },
            });
          };
        }
        const v = t[prop];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    vi.resetModules();
    vi.doMock('../db/client.js', () => ({ default: counting }));
    const mod = await import('./executionDecision.js');

    const d = mod.executionDecision({ programmeMessageId: message.id, at: TODAY });
    expect(d.executableNow).toBe(true);

    const total = [...executions.values()].reduce((n, x) => n + x, 0);
    const writes = [...executions.entries()]
      .filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql))
      .reduce((n, [, x]) => n + x, 0);

    // eslint-disable-next-line no-console
    console.log(`[F11b] executionDecision statements: ${total} (writes: ${writes})`);
    expect(writes).toBe(0);
    /*
      BOUNDED BY THE PROGRAMME, NOT BY THE CAMPAIGN. Twenty sibling programmes
      cost nothing: the decision builds ONE pursuit plan, for the one programme
      the message belongs to.
    */
    expect(total).toBeLessThan(80);

    vi.doUnmock('../db/client.js');
    vi.resetModules();
  });
});
