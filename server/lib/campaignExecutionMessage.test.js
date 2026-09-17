import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import { campaignExecutionPlan } from './campaignExecution.js';
import { materialiseNextContactAttempt } from './pursuitPolicy.js';
import { generateProgrammeMessage } from './programmeMessageGeneration.js';
import {
  reviewProgrammeMessage, programmeMessage, currentMessagesForAttempts,
} from './programmeMessages.js';
import { createOutreach } from './outreach.js';
import { recordDraft, confirmSend } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * F10b-5 — DOES THIS CAMPAIGN ALREADY HAVE THE WORDS.
 *
 * ---------------------------------------------------------------------------
 * THE READ MODEL EXISTS SO A SCREEN NEVER HAS TO ASK.
 *
 * Without `currentMessage` a campaign tab has exactly three ways to find out
 * whether a message has been written, and all three are wrong: search the
 * message table from the browser, infer it from the attempt's state (which
 * says nothing about content), or call generate to see what comes back — which
 * would make LOOKING at a campaign write to it. So the server says.
 * ---------------------------------------------------------------------------
 *
 * TWO PROPERTIES CARRY THE SLICE.
 *
 *   1. ONE READ FOR A HUNDRED PROGRAMMES. A plan that asked per programme would
 *      grow with the campaign rather than with the question.
 *   2. CURRENT MEANS THIS ATTEMPT, THIS STEP, THIS COACH. A step-1 message is
 *      not the current message of a campaign that has advanced to step 2, and
 *      surfacing it as one would tell an operator the follow-up was already
 *      written.
 */

const ATHLETE = 'a-exec-msg';
const OPERATOR = 'op-exec-msg';
const TODAY = '2026-09-07';
let seq = 0;

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'Msg Athlete',
      'MIDFIELD', 'mens-soccer', ?)
  `).run(id, randomUUID().slice(0, 10));
}

function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, '2026-09-01T00:00:00.000Z')
  `).run(id, `${id}@thriv3.test`);
}

function makeCampaign({ state = 'active' } = {}) {
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2020-01-01', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 0)
  `).run(id, ATHLETE, state);
  return id;
}

function makeProgramme(campaignId, { college, rank = 1, tier = 'A', staff = 2 } = {}) {
  const id = `pc-${college}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, ?, 'AUTO', 'queued', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, rank, tier);
  const coaches = [];
  for (let i = 0; i < staff; i += 1) {
    coaches.push(findOrCreateCoach({
      full_name: `${String.fromCharCode(65 + i)} Coach`,
      email: `c${i}@${college.toLowerCase()}.edu`,
      school: college, sport: 'mens-soccer', division: 'NCAA D1',
      position_title: i === 0 ? 'Head Coach' : 'Assistant Coach',
    }));
  }
  return { id, coaches };
}

/** A real accepted campaign message, through the real write path. */
function sendUnder(pcId, coachRow, college, at) {
  const o = createOutreach({ athleteId: ATHLETE, coachId: coachRow.id, programmeCampaignId: pcId });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId: coachRow.id, collegeName: college,
    sport: 'mens-soccer', programmeCampaignId: pcId, evidence: null,
    body: `b${++seq}`, subject: 's',
  });
  confirmSend(o.id, at, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

const plan = (campaignId, opts = {}) => campaignExecutionPlan(campaignId, { onDate: TODAY, ...opts });
const entry = (campaignId, pcId) => plan(campaignId).programmes
  .find((p) => p.programmeCampaignId === pcId);

const NOTHING = Object.freeze({ id: null, state: null, generatedAt: null });

beforeEach(() => {
  db.exec(`DELETE FROM programme_messages; DELETE FROM programme_contact_attempts;
           DELETE FROM outbound_send_attempt; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM campaign_first_touch_approvals;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM players; DELETE FROM operator_users;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;`);
  athlete(ATHLETE);
  operator(OPERATOR);
  seq = 0;
});

/* -------------------------------------------------------------------------- */
/* The field                                                                   */
/* -------------------------------------------------------------------------- */

describe('currentMessage on the execution plan', () => {
  it('is null-filled where nothing has been prepared, in the attempt’s own shape', () => {
    const c = makeCampaign();
    const { id: pc } = makeProgramme(c, { college: 'Alpha' });

    const e = entry(c, pc);
    expect(e.currentAttempt).toEqual({ id: null, state: null, storedStep: null, createdAt: null });
    expect(e.currentMessage).toEqual(NOTHING);
  });

  /**
   * PREPARED IS NOT WRITTEN, and this is the state the whole slice turns on:
   * the campaign has recorded that it means to write to somebody, and no words
   * exist yet. A card showing "Review message" here would be offering to review
   * nothing.
   */
  it('is null-filled where an attempt exists but nobody has written the message', () => {
    const c = makeCampaign();
    const { id: pc } = makeProgramme(c, { college: 'Alpha' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    const e = entry(c, pc);
    expect(e.currentAttempt.id).toBeTruthy();
    expect(e.currentMessage).toEqual(NOTHING);
  });

  it('carries the id, the content state and when it was written', () => {
    const c = makeCampaign();
    const { id: pc, coaches } = makeProgramme(c, { college: 'Alpha' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({
      programmeCampaignId: pc, coachId: coaches[0].id,
    });

    expect(entry(c, pc).currentMessage).toEqual({
      id: message.id, state: 'generated', generatedAt: message.generated_at,
    });
  });

  it('follows the content state to reviewed, and adds nothing else', () => {
    const c = makeCampaign();
    const { id: pc, coaches } = makeProgramme(c, { college: 'Alpha' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({
      programmeCampaignId: pc, coachId: coaches[0].id,
    });
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });

    const e = entry(c, pc);
    expect(e.currentMessage.state).toBe('reviewed');
    /**
     * THREE KEYS, AND NO CONTENT. The plan says WHETHER the words exist and
     * what state they are in; the words themselves are one read away by id.
     * Carrying a hundred email bodies in a campaign plan would make the screen
     * that lists a campaign pay for the screen that reviews one message.
     */
    expect(Object.keys(e.currentMessage).sort()).toEqual(['generatedAt', 'id', 'state']);
  });

  /**
   * A CONTENT STATE IS NOT A PERMISSION, and the plan must keep saying so while
   * a message exists. This is the assertion that stops a later slice reading
   * "reviewed" as "sendable".
   */
  it('changes no safety, timing, budget or executability answer', () => {
    const c = makeCampaign();
    const { id: pc, coaches } = makeProgramme(c, { college: 'Alpha' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const before = entry(c, pc);

    const { message } = generateProgrammeMessage({
      programmeCampaignId: pc, coachId: coaches[0].id,
    });
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
    const after = entry(c, pc);

    for (const key of ['safety', 'budget', 'blockers', 'executableNow', 'preparableNow',
      'derivedStep', 'nextAction', 'operatorReviewRequired', 'stepConsistent']) {
      expect(after[key], key).toEqual(before[key]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Which message is "current"                                                  */
/* -------------------------------------------------------------------------- */

describe('current means this attempt, this step, this coach', () => {
  /**
   * THE SEQUENCE THIS FIELD EXISTS FOR.
   *
   * Step 1 written, step 1 sent and accepted, the campaign advances to step 2 —
   * and the follow-up has not been written. `currentMessage` must go back to
   * null, or the card offers to review a message that is already in somebody's
   * inbox.
   */
  it('returns to null when an accepted send advances the campaign to step 2', () => {
    const c = makeCampaign();
    const { id: pc, coaches } = makeProgramme(c, { college: 'Alpha' });
    const head = coaches[0];
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    const { message: first } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    expect(entry(c, pc)).toMatchObject({
      derivedStep: 1, currentMessage: { id: first.id, state: 'generated' },
    });

    sendUnder(pc, head, 'Alpha', '2026-09-01T09:00:00.000Z');

    const advanced = entry(c, pc);
    expect(advanced.derivedStep).toBe(2);
    expect(advanced.currentAttempt.id).toBeTruthy();
    expect(advanced.currentMessage).toEqual(NOTHING);

    // And the step-1 message is not gone. It is history, and history is kept.
    expect(programmeMessage(first.id)).toMatchObject({ step: 1, state: 'generated' });
  });

  it('becomes the step-2 message once the follow-up is written', () => {
    const c = makeCampaign();
    const { id: pc, coaches } = makeProgramme(c, { college: 'Alpha' });
    const head = coaches[0];
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message: first } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    sendUnder(pc, head, 'Alpha', '2026-09-01T09:00:00.000Z');

    const { message: second } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });

    expect(second.step).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(entry(c, pc).currentMessage).toEqual({
      id: second.id, state: 'generated', generatedAt: second.generated_at,
    });
    // Both on file, one current.
    expect(db.prepare('SELECT COUNT(*) n FROM programme_messages').get().n).toBe(2);
  });

  /**
   * DATA CORRUPTION IS NOT SOMETHING TO RENDER. The attempt names a coach and
   * the message names a coach, and the only reason they can differ is that
   * something wrote a row nothing in this build writes. Showing it as the
   * current message would attach one coach's words to another coach's card.
   */
  it('refuses a message whose coach is not the coach the campaign is pursuing', () => {
    const c = makeCampaign();
    const { id: pc, coaches } = makeProgramme(c, { college: 'Alpha' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({
      programmeCampaignId: pc, coachId: coaches[0].id,
    });

    db.prepare('UPDATE programme_messages SET coach_id = ? WHERE id = ?')
      .run(coaches[1].id, message.id);

    expect(entry(c, pc).currentMessage).toEqual(NOTHING);
  });

  it('does not lend one programme’s message to another', () => {
    const c = makeCampaign();
    const a = makeProgramme(c, { college: 'Alpha', rank: 1 });
    const b = makeProgramme(c, { college: 'Bravo', rank: 2 });
    materialiseNextContactAttempt({ programmeCampaignId: a.id });
    materialiseNextContactAttempt({ programmeCampaignId: b.id });
    generateProgrammeMessage({ programmeCampaignId: a.id, coachId: a.coaches[0].id });

    expect(entry(c, a.id).currentMessage.id).toBeTruthy();
    expect(entry(c, b.id).currentMessage).toEqual(NOTHING);
  });
});

/* -------------------------------------------------------------------------- */
/* The batch helper on its own                                                 */
/* -------------------------------------------------------------------------- */

describe('the batch read', () => {
  it('asks nothing when there is nothing to ask about', () => {
    expect(currentMessagesForAttempts([])).toEqual(new Map());
    expect(currentMessagesForAttempts([{ attemptId: null, step: 1, coachId: 'x' }]))
      .toEqual(new Map());
    // A step nobody supplied is not a step-1 request.
    expect(currentMessagesForAttempts([{ attemptId: 'a', step: null, coachId: 'x' }]))
      .toEqual(new Map());
  });

  it('answers per attempt, keyed by the attempt that asked', () => {
    const c = makeCampaign();
    const a = makeProgramme(c, { college: 'Alpha', rank: 1 });
    materialiseNextContactAttempt({ programmeCampaignId: a.id });
    const { message } = generateProgrammeMessage({
      programmeCampaignId: a.id, coachId: a.coaches[0].id,
    });

    const out = currentMessagesForAttempts([
      { attemptId: message.programme_contact_attempt_id, step: 1, coachId: a.coaches[0].id },
      { attemptId: message.programme_contact_attempt_id, step: 2, coachId: a.coaches[0].id },
    ]);
    // The LAST request for an attempt wins the key, and step 2 does not exist —
    // so asking for both is asking for step 2, which is absent.
    expect(out.size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Cost                                                                        */
/* -------------------------------------------------------------------------- */

describe('a hundred programmes cost one message read', () => {
  /**
   * THE COUNT IS TAKEN AGAINST THE SAME CONNECTION, through a proxy over
   * `db.prepare`. A re-imported client would be a different in-memory database
   * and the measurement would be taken against no data at all.
   */
  let executions;

  async function instrumented() {
    executions = new Map();
    const counting = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql) => {
            const stmt = target.prepare(sql);
            return new Proxy(stmt, {
              get(t, key) {
                const value = t[key];
                if (typeof value !== 'function') return value;
                return (...args) => {
                  if (key === 'all' || key === 'get' || key === 'run') {
                    executions.set(sql, (executions.get(sql) ?? 0) + 1);
                  }
                  return value.apply(t, args);
                };
              },
            });
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    vi.resetModules();
    vi.doMock('../db/client.js', () => ({ default: counting }));
    return import('./campaignExecution.js');
  }

  const messageReads = () => [...executions.entries()]
    .filter(([sql]) => /FROM programme_messages/.test(sql))
    .reduce((n, [, count]) => n + count, 0);

  const total = () => [...executions.values()].reduce((n, c) => n + c, 0);

  it('executes ONE statement against programme_messages, not a hundred', async () => {
    const c = makeCampaign();
    for (let i = 0; i < 100; i += 1) {
      const p = makeProgramme(c, { college: `P${String(i).padStart(3, '0')}`, rank: i + 1, staff: 1 });
      materialiseNextContactAttempt({ programmeCampaignId: p.id });
      // Half of them written, so the read has both answers to give.
      if (i % 2 === 0) {
        generateProgrammeMessage({ programmeCampaignId: p.id, coachId: p.coaches[0].id });
      }
    }

    const mod = await instrumented();
    const out = mod.campaignExecutionPlan(c, { onDate: TODAY });

    expect(out.programmes).toHaveLength(100);
    expect(out.programmes.filter((p) => p.currentMessage.id).length).toBe(50);
    expect(messageReads()).toBe(1);
    vi.doUnmock('../db/client.js');
    vi.resetModules();
  });

  it('asks nothing of the table when no programme has an attempt', async () => {
    const c = makeCampaign();
    for (let i = 0; i < 10; i += 1) {
      makeProgramme(c, { college: `Q${i}`, rank: i + 1, staff: 1 });
    }

    const mod = await instrumented();
    mod.campaignExecutionPlan(c, { onDate: TODAY });

    // Nothing to ask about is nothing asked, not an empty IN ().
    expect(messageReads()).toBe(0);
    expect(total()).toBeGreaterThan(0);
    vi.doUnmock('../db/client.js');
    vi.resetModules();
  });
});

/* -------------------------------------------------------------------------- */

describe('reading a campaign still writes nothing', () => {
  it('leaves programme_messages exactly as it found it', () => {
    const c = makeCampaign();
    const { id: pc, coaches } = makeProgramme(c, { college: 'Alpha' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id });

    const before = db.prepare('SELECT * FROM programme_messages').all();
    for (let i = 0; i < 5; i += 1) plan(c);
    expect(db.prepare('SELECT * FROM programme_messages').all()).toEqual(before);
  });

  it('does not generate a message in order to discover one', () => {
    const c = makeCampaign();
    const { id: pc } = makeProgramme(c, { college: 'Alpha' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    for (let i = 0; i < 5; i += 1) plan(c);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_messages').get().n).toBe(0);

    const src = fs.readFileSync(new URL('./campaignExecution.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/generateProgrammeMessage|createProgrammeMessage|composeProgrammeMessage/);
  });
});
