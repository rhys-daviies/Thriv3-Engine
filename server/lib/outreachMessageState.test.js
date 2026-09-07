import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  MESSAGE_STATE, ACCEPTED_SOURCE, SEND_EVENT_TYPE, LEGAL_TRANSITIONS,
  canTransition, isMessageState, isTerminal,
} from '../../shared/outreachMessageState.js';
import { createOutreach, markOutreachSent, resolveToken } from './outreach.js';
import {
  recordDraft, confirmSend, acceptSend, transitionSend, openSendFor,
  appendSendEvent, sendEvents, sendsForOutreach, nextSequence, sendsForProgrammeCampaign,
} from './outreachSend.js';
import { pendingDrafts, draftSummary, confirmSent } from './confirmSends.js';
import { findOrCreateCoach } from './coaches.js';
import { recentSendCount } from './sendCap.js';
import { isSuppressed, suppress } from './suppressions.js';

/**
 * B2 — what happened to one outbound message, according to what Thriv3 can
 * truthfully know.
 *
 * The two properties under test are negative and are the point of the slice:
 *
 *   1. `state` never means delivered. The strongest thing recorded is that a
 *      person or a command said the message was accepted for sending, and
 *      `accepted_source` says which.
 *   2. Whether a message is pending is a fact about THE MESSAGE. It used to be
 *      read off the relationship, so a follow-up disappeared the moment a first
 *      message was confirmed — B1 proved it, and the regression here is the
 *      three-message scenario at the end.
 */

const ATHLETE = 'a-msgstate';
let seq = 0;

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer', ?)
  `).run(id, name, randomUUID().slice(0, 10));
}

const makeCoach = ({ school = 'Duke', email } = {}) => findOrCreateCoach({
  full_name: 'A Coach', email: email ?? `c${++seq}@example.edu`, school, sport: 'mens-soccer',
});

function makeCampaignProgramme(athleteId = ATHLETE, college = 'Duke') {
  const campaign = `camp-${++seq}`;
  const pc = `pc-${++seq}`;
  // Active and long since started: B3 gates campaign-attributed writes, and
  // these tests are about message state rather than permission. One active
  // campaign per athlete, so a new one closes the one before it.
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-07T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(athleteId);
  db.prepare(`INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at,
      updated_at, snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', '2026-09-07T00:00:00.000Z',
      '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', 1)`).run(campaign, athleteId);
  db.prepare(`INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank,
      match_score, tier, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 1, 82, 'A', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z')`)
    .run(pc, campaign, college);
  return pc;
}

/** A relationship with one open message on it. */
function seedMessage({ athleteId = ATHLETE, coach = null, programmeCampaignId = null, at } = {}) {
  const c = coach ?? makeCoach();
  const o = createOutreach({ athleteId, coachId: c.id, programmeCampaignId });
  const draft = recordDraft({
    outreachId: o.id, athleteId, coachId: c.id, collegeName: 'Duke',
    programmeCampaignId, evidence: null, body: 'hello', subject: 'hi', at,
  });
  return { outreach: o, coach: c, sendId: draft.id, sequence: draft.sequence };
}

beforeEach(() => {
  db.exec(`DELETE FROM outreach_send_event; DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns; DELETE FROM coaches;
           DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE, 'Message State Athlete');
});

// ---------------------------------------------------------------------------

describe('the vocabulary', () => {
  it('names only states Thriv3 can know about itself', () => {
    expect(Object.values(MESSAGE_STATE)).toEqual([
      'DRAFT', 'QUEUED', 'SENDING', 'ACCEPTED', 'FAILED', 'CANCELLED',
    ]);
  });

  /**
   * The whole reason the slice exists. Anything in this list is something we
   * would have to learn from outside, and would be an observation.
   */
  it('has no state meaning delivered, opened, replied or bounced', () => {
    for (const forbidden of ['DELIVERED', 'INBOXED', 'OPENED', 'READ', 'REPLIED',
      'BOUNCED', 'SOFT_BOUNCE', 'HARD_BOUNCE', 'DEFERRED', 'COMPLAINED']) {
      expect(Object.values(MESSAGE_STATE)).not.toContain(forbidden);
    }
  });

  it('grades acceptance evidence weakest to strongest', () => {
    expect(Object.values(ACCEPTED_SOURCE)).toEqual([
      'OPERATOR_ASSERTED', 'OUTLOOK_COMMAND_ASSERTED', 'PROVIDER_ACCEPTED',
    ]);
  });

  it('treats ACCEPTED and CANCELLED as terminal, and FAILED as retryable', () => {
    expect(isTerminal('ACCEPTED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(false);
    expect(LEGAL_TRANSITIONS.ACCEPTED).toEqual([]);
    expect(LEGAL_TRANSITIONS.CANCELLED).toEqual([]);
    expect(LEGAL_TRANSITIONS.FAILED).toEqual(['QUEUED']);
  });

  it('refuses a move a transport could not have made', () => {
    // A message never handed to a transport cannot have been accepted by one.
    expect(canTransition('QUEUED', 'ACCEPTED')).toBe(false);
    expect(canTransition('ACCEPTED', 'FAILED')).toBe(false);
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(false);
    expect(canTransition('DRAFT', 'ACCEPTED')).toBe(true);
    expect(canTransition('DRAFT', 'DRAFT')).toBe(true);     // nothing happened
    expect(canTransition('DRAFT', 'NONSENSE')).toBe(false);
    expect(isMessageState('draft')).toBe(false);            // casing is exact
  });
});

// ---------------------------------------------------------------------------

describe('the schema', () => {
  it('carries state and acceptance provenance on the message', () => {
    const cols = db.prepare('PRAGMA table_info(outreach_send)').all().map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['state', 'accepted_source']));
    // The compatibility timestamps stay exactly where they were.
    expect(cols).toEqual(expect.arrayContaining(['drafted_at', 'sent_at', 'sequence']));
  });

  it('creates the append-only observation table', () => {
    const cols = db.prepare('PRAGMA table_info(outreach_send_event)').all().map((c) => c.name);
    expect(cols.sort()).toEqual([
      'confidence', 'created_at', 'id', 'observed_at', 'outreach_send_id', 'payload', 'source', 'type',
    ]);
  });

  it('enforces one open message per relationship', () => {
    const { outreach, coach } = seedMessage();
    // A second open row written around recordDraft is refused by the database.
    expect(() => db.prepare(`
      INSERT INTO outreach_send (id, outreach_id, sequence, athlete_id, coach_id,
        policy_version, state, created_at)
      VALUES (?, ?, 99, ?, ?, 'P2', 'QUEUED', '2026-09-07T00:00:00.000Z')
    `).run(randomUUID(), outreach.id, ATHLETE, coach.id)).toThrow(/UNIQUE constraint failed/);
  });

  it('lets a relationship hold an accepted message and a new open one', () => {
    const { outreach, sendId, coach } = seedMessage();
    acceptSend(sendId);
    expect(() => recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      evidence: null, body: 'again', subject: 'hi',
    })).not.toThrow();
    expect(sendsForOutreach(outreach.id)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe('transitions', () => {
  it('drafts, then accepts, recording how we know', () => {
    const { outreach, sendId } = seedMessage({ at: '2026-09-07T10:00:00.000Z' });
    const drafted = openSendFor(outreach.id);
    expect(drafted.id).toBe(sendId);
    expect(drafted.state).toBe('DRAFT');
    expect(drafted.accepted_source).toBeNull();

    const out = acceptSend(sendId, {
      source: ACCEPTED_SOURCE.OUTLOOK_COMMAND_ASSERTED, at: '2026-09-07T12:00:00.000Z',
    });
    expect(out.state).toBe('ACCEPTED');
    expect(out.accepted_source).toBe('OUTLOOK_COMMAND_ASSERTED');
    expect(out.sent_at).toBe('2026-09-07T12:00:00.000Z');
    expect(out.changed).toBe(true);
  });

  it('refuses an acceptance that cannot say how it knows', () => {
    const { outreach, sendId } = seedMessage();
    expect(() => transitionSend(sendId, 'ACCEPTED'))
      .toThrow(expect.objectContaining({ code: 'ACCEPTED_SOURCE_REQUIRED' }));
    expect(() => transitionSend(sendId, 'ACCEPTED', { acceptedSource: 'BECAUSE' }))
      .toThrow(expect.objectContaining({ code: 'ACCEPTED_SOURCE_REQUIRED' }));
    // Refused before anything was written.
    expect(openSendFor(outreach.id).state).toBe('DRAFT');
    expect(openSendFor(outreach.id).sent_at).toBeNull();
  });

  it('refuses an illegal move and leaves the message alone', () => {
    const { outreach, sendId } = seedMessage();
    acceptSend(sendId, { at: '2026-09-07T12:00:00.000Z' });
    for (const next of ['DRAFT', 'QUEUED', 'SENDING', 'FAILED', 'CANCELLED']) {
      expect(() => transitionSend(sendId, next))
        .toThrow(expect.objectContaining({ code: 'ILLEGAL_MESSAGE_TRANSITION' }));
    }
    const [only] = sendsForOutreach(outreach.id);
    expect([only.state, only.sent_at]).toEqual(['ACCEPTED', '2026-09-07T12:00:00.000Z']);
  });

  it('refuses a state that is not a state, and a message that does not exist', () => {
    const { sendId } = seedMessage();
    expect(() => transitionSend(sendId, 'DELIVERED'))
      .toThrow(expect.objectContaining({ code: 'INVALID_MESSAGE_STATE' }));
    expect(() => transitionSend('nope', 'CANCELLED'))
      .toThrow(expect.objectContaining({ code: 'SEND_NOT_FOUND' }));
  });

  it('treats the same state as nothing having happened', () => {
    const { sendId } = seedMessage();
    const first = acceptSend(sendId, { at: '2026-09-07T12:00:00.000Z' });
    const again = acceptSend(sendId, {
      source: ACCEPTED_SOURCE.PROVIDER_ACCEPTED, at: '2027-01-01T00:00:00.000Z',
    });
    expect(again.changed).toBe(false);
    // The first acceptance keeps its timestamp AND its provenance: a second
    // caller does not get to upgrade how we know.
    expect(again.sent_at).toBe(first.sent_at);
    expect(again.accepted_source).toBe('OPERATOR_ASSERTED');
  });

  it('cancels a draft, and cancelling is terminal', () => {
    const { sendId } = seedMessage();
    expect(transitionSend(sendId, 'CANCELLED').state).toBe('CANCELLED');
    expect(() => acceptSend(sendId)).toThrow(/CANCELLED is terminal/);
  });

  it('does not count a cancelled message toward the next sequence', () => {
    const { outreach, sendId } = seedMessage();
    transitionSend(sendId, 'CANCELLED');
    // Only an ACCEPTED message is a message that happened.
    expect(nextSequence(outreach.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('message-scoped confirmation', () => {
  it('accepts one specific message and cannot reach another', () => {
    const a = seedMessage({ coach: makeCoach({ email: 'a@x.edu' }) });
    const b = seedMessage({ coach: makeCoach({ email: 'b@x.edu' }) });

    acceptSend(a.sendId);

    expect(sendsForOutreach(a.outreach.id)[0].state).toBe('ACCEPTED');
    expect(sendsForOutreach(b.outreach.id)[0].state).toBe('DRAFT');
  });

  it('resolves the open message from a relationship, and says so when there is none', () => {
    const { outreach, sendId } = seedMessage();
    expect(openSendFor(outreach.id).id).toBe(sendId);
    confirmSend(outreach.id);
    expect(openSendFor(outreach.id)).toBeNull();
    expect(confirmSend(outreach.id)).toBeNull();
  });

  it('stamps sent_at per message while the relationship keeps its first', () => {
    const { outreach, coach } = seedMessage({ at: '2026-09-07T10:00:00.000Z' });
    confirmSend(outreach.id, '2026-09-07T12:00:00.000Z');
    markOutreachSent(outreach.id, '2026-09-07T12:00:00.000Z');

    recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      evidence: null, body: 'follow-up', subject: 'again', at: '2026-09-21T10:00:00.000Z',
    });
    confirmSend(outreach.id, '2026-09-21T12:00:00.000Z');
    markOutreachSent(outreach.id, '2026-09-21T12:00:00.000Z');

    expect(sendsForOutreach(outreach.id).map((s) => [s.sequence, s.sent_at])).toEqual([
      [1, '2026-09-07T12:00:00.000Z'],
      [2, '2026-09-21T12:00:00.000Z'],
    ]);
    // FIRST-WINS, unchanged: sendCap and the evidence denominators read this.
    expect(db.prepare('SELECT sent_at FROM outreach WHERE id = ?').get(outreach.id).sent_at)
      .toBe('2026-09-07T12:00:00.000Z');
  });
});

/**
 * THE B1 REGRESSION, END TO END.
 *
 * Before B2 this was impossible past the first message: `pendingDrafts`
 * filtered on `outreach.sent_at IS NULL`, so once sequence 1 was confirmed the
 * relationship looked settled for ever and `confirmSent` returned
 * `{confirmed: 0, skipped: [id]}` for every follow-up.
 */
describe('three messages, each independently true', () => {
  it('drafts, sees, confirms and repeats through sequence 3', () => {
    const { outreach, coach } = seedMessage({ at: '2026-09-07T10:00:00.000Z' });

    const cycle = (n, draftAt, confirmAt) => {
      if (n > 1) {
        recordDraft({
          outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
          evidence: null, body: `message ${n}`, subject: `s${n}`, at: draftAt,
        });
      }
      // The tool SEES it — this is what used to fail.
      const pending = pendingDrafts();
      expect(pending, `sequence ${n} pending`).toHaveLength(1);
      expect(pending[0].sequence).toBe(n);
      expect(pending[0].state).toBe('DRAFT');
      expect(draftSummary().pending).toBe(1);
      expect(draftSummary().confirmed_sent).toBe(n - 1);

      const result = confirmSent([outreach.id], { at: confirmAt });
      expect(result.confirmed, `sequence ${n} confirmed`).toBe(1);
      expect(pendingDrafts()).toHaveLength(0);
      expect(draftSummary().confirmed_sent).toBe(n);
    };

    cycle(1, null, '2026-09-07T12:00:00.000Z');
    cycle(2, '2026-09-21T10:00:00.000Z', '2026-09-21T12:00:00.000Z');
    cycle(3, '2026-10-05T10:00:00.000Z', '2026-10-05T12:00:00.000Z');

    const sends = sendsForOutreach(outreach.id);
    expect(sends.map((s) => [s.sequence, s.state, s.sent_at])).toEqual([
      [1, 'ACCEPTED', '2026-09-07T12:00:00.000Z'],
      [2, 'ACCEPTED', '2026-09-21T12:00:00.000Z'],
      [3, 'ACCEPTED', '2026-10-05T12:00:00.000Z'],
    ]);
    // Each body is its own, and none was overwritten by a later one.
    expect(sends.map((s) => s.subject)).toEqual(['hi', 's2', 's3']);
    // The relationship still dates the FIRST message.
    expect(db.prepare('SELECT sent_at FROM outreach WHERE id = ?').get(outreach.id).sent_at)
      .toBe('2026-09-07T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------

describe('re-drafting', () => {
  it('rewrites the pending message in place, keeping its id and sequence', () => {
    const { outreach, coach, sendId } = seedMessage({ at: '2026-09-07T10:00:00.000Z' });
    const again = recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      evidence: null, body: 'rewritten', subject: 'v2', at: '2026-09-07T11:00:00.000Z',
    });
    expect(again.id).toBe(sendId);
    expect(again.sequence).toBe(1);
    const rows = sendsForOutreach(outreach.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('v2');
    expect(rows[0].state).toBe('DRAFT');
  });

  it('cannot rewrite an accepted message; the next draft is a new sequence', () => {
    const { outreach, coach, sendId } = seedMessage();
    acceptSend(sendId);
    const next = recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      evidence: null, body: 'second', subject: 'two',
    });
    expect(next.id).not.toBe(sendId);
    expect(next.sequence).toBe(2);
    // The accepted row is untouched.
    expect(sendsForOutreach(outreach.id)[0].subject).toBe('hi');
  });

  it('moves campaign attribution with the re-drafted body, never the relationship’s', () => {
    const coach = makeCoach();
    const one = makeCampaignProgramme();
    const { outreach } = seedMessage({ coach, programmeCampaignId: one });

    // A season later: campaign 1 closes, campaign 2 opens.
    const two = makeCampaignProgramme();
    recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      programmeCampaignId: two, evidence: null, body: 'campaign two', subject: 'c2',
    });

    expect(sendsForOutreach(outreach.id)[0].programme_campaign_id).toBe(two);
    // A6: provenance records who OPENED the relationship and does not move.
    expect(db.prepare('SELECT programme_campaign_id FROM outreach WHERE id = ?').get(outreach.id)
      .programme_campaign_id).toBe(one);
    expect(sendsForProgrammeCampaign(one)).toHaveLength(0);
    expect(sendsForProgrammeCampaign(two)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('observations', () => {
  it('appends an event against an existing message', () => {
    const { sendId } = seedMessage();
    acceptSend(sendId, { source: ACCEPTED_SOURCE.PROVIDER_ACCEPTED });
    const e = appendSendEvent({
      sendId, type: SEND_EVENT_TYPE.ACCEPTED, source: 'GMAIL_API',
      payload: { id: 'abc', threadId: 'def' }, at: '2026-09-07T12:00:00.000Z',
    });
    expect(e.type).toBe('ACCEPTED');
    expect(sendEvents(sendId)).toHaveLength(1);
    expect(sendEvents(sendId)[0].payload).toEqual({ id: 'abc', threadId: 'def' });
  });

  it('is append-only, enforced by the database', () => {
    const { sendId } = seedMessage();
    const e = appendSendEvent({ sendId, type: 'ACCEPTED', source: 'GMAIL_API' });
    expect(() => db.prepare('UPDATE outreach_send_event SET type = ? WHERE id = ?')
      .run('REPLY', e.id)).toThrow(/append-only/);
  });

  it('orders deterministically, including a tie on the observed time', () => {
    const { sendId } = seedMessage();
    for (const t of ['2026-09-09T00:00:00.000Z', '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z']) {
      appendSendEvent({ sendId, type: 'ACCEPTED', source: 'GMAIL_API', observedAt: t });
    }
    const ordered = sendEvents(sendId);
    expect(ordered.map((e) => e.observed_at)).toEqual([
      '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z', '2026-09-09T00:00:00.000Z',
    ]);
    // Total order: the tie breaks on id, the same way every time.
    expect(sendEvents(sendId).map((e) => e.id)).toEqual(ordered.map((e) => e.id));
  });

  it('separates when it happened from when we heard', () => {
    const { sendId } = seedMessage();
    const e = appendSendEvent({
      sendId, type: 'REPLY', source: 'OPERATOR',
      observedAt: '2026-09-08T00:00:00.000Z', at: '2026-09-12T00:00:00.000Z',
    });
    expect(e.observed_at).toBe('2026-09-08T00:00:00.000Z');
    expect(e.created_at).toBe('2026-09-12T00:00:00.000Z');
  });

  it('refuses an unknown type, an unattributed event and a message that is not there', () => {
    const { sendId } = seedMessage();
    expect(() => appendSendEvent({ sendId, type: 'DELIVERED', source: 'GMAIL_API' }))
      .toThrow(expect.objectContaining({ code: 'UNKNOWN_SEND_EVENT_TYPE' }));
    expect(() => appendSendEvent({ sendId, type: 'REPLY', source: '  ' }))
      .toThrow(expect.objectContaining({ code: 'SEND_EVENT_SOURCE_REQUIRED' }));
    expect(() => appendSendEvent({ sendId: 'nope', type: 'REPLY', source: 'OPERATOR' }))
      .toThrow(expect.objectContaining({ code: 'SEND_NOT_FOUND' }));
    expect(sendEvents(sendId)).toHaveLength(0);
  });

  it('refuses a payload it could not read back', () => {
    const { sendId } = seedMessage();
    const circular = {}; circular.self = circular;
    expect(() => appendSendEvent({ sendId, type: 'REPLY', source: 'OPERATOR', payload: circular }))
      .toThrow(expect.objectContaining({ code: 'SEND_EVENT_PAYLOAD_INVALID' }));
    expect(() => appendSendEvent({ sendId, type: 'REPLY', source: 'OPERATOR', payload: () => {} }))
      .toThrow(expect.objectContaining({ code: 'SEND_EVENT_PAYLOAD_INVALID' }));
    expect(sendEvents(sendId)).toHaveLength(0);
  });

  it('does not un-accept a message, whatever is observed about it', () => {
    const { sendId } = seedMessage();
    acceptSend(sendId, { at: '2026-09-07T12:00:00.000Z' });
    appendSendEvent({ sendId, type: 'BOUNCE_HARD', source: 'OPERATOR' });
    appendSendEvent({ sendId, type: 'REPLY', source: 'OPERATOR' });
    const send = db.prepare('SELECT * FROM outreach_send WHERE id = ?').get(sendId);
    // We DID accept it. A bounce next week does not change what we did.
    expect(send.state).toBe('ACCEPTED');
    expect(send.sent_at).toBe('2026-09-07T12:00:00.000Z');
  });

  /**
   * B2 builds the table and writes no observation of its own. Nothing in this
   * build watches a mailbox, so producing a bounce or a reply would be
   * inventing one.
   */
  it('is written by nothing in the production send path', () => {
    const src = [
      'server/routes/sendOutreach.js', 'server/lib/confirmSends.js', 'server/lib/outreach.js',
    ].map((f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')).join('\n');
    // Nothing calls the writer, and nothing names an observation type. Matched
    // as a member access so the CAN-SPAM footer's own OPT_OUT_SENTENCE — an
    // unrelated constant in sendOutreach.js — is not mistaken for one.
    expect(src).not.toContain('appendSendEvent');
    expect(src).not.toMatch(/SEND_EVENT_TYPE\s*\./);
    for (const t of ['BOUNCE_HARD', 'BOUNCE_SOFT', 'COMPLAINT']) {
      expect(src).not.toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------

describe('nothing else moved', () => {
  it('leaves the token and the public link working', () => {
    const { outreach, sendId } = seedMessage();
    acceptSend(sendId);
    expect(resolveToken(outreach.token).id).toBe(outreach.id);
  });

  it('leaves suppression keyed on the address alone', () => {
    suppress({ email: 'coach@example.edu' });
    expect(isSuppressed('coach@example.edu')).toBe(true);
    const cols = db.prepare('PRAGMA table_info(suppressions)').all().map((c) => c.name);
    expect(cols).not.toContain('state');
  });

  it('leaves the per-inbox cap counting relationships, not messages', () => {
    const coach = makeCoach({ email: 'popular@example.edu' });
    const { outreach } = seedMessage({ coach });
    markOutreachSent(outreach.id);
    confirmSend(outreach.id);
    // A follow-up is a second message and still one athlete on this inbox.
    recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      evidence: null, body: 'f', subject: 'f',
    });
    confirmSend(outreach.id);
    expect(recentSendCount('popular@example.edu')).toBe(1);
  });

  it('leaves the evidence payload on the message untouched by a state change', () => {
    const { sendId } = seedMessage();
    const before = db.prepare('SELECT payload, policy_version, body_hash FROM outreach_send WHERE id = ?')
      .get(sendId);
    acceptSend(sendId);
    expect(db.prepare('SELECT payload, policy_version, body_hash FROM outreach_send WHERE id = ?')
      .get(sendId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE 41 HISTORICAL ROWS, MIGRATED ON A BACKUP.
 *
 * None of them was observed by a provider. They were confirmed by a person or
 * produced by a path that recorded nothing, so both are OPERATOR_ASSERTED — and
 * no synthetic events are written, because nobody watched these messages leave.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIVE_DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_LIVE = fs.existsSync(LIVE_DB) && fs.statSync(LIVE_DB).size > 1_000_000;
const COPY = path.join(ROOT, 'node_modules/.tmp/message-state-live-copy.sqlite');
const live = HAVE_LIVE ? describe : describe.skip;
if (!HAVE_LIVE) console.warn(`\n  outreachMessageState.test.js live checks SKIPPED — no database at ${LIVE_DB}\n`);

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(COPY + suffix)) fs.unlinkSync(COPY + suffix);
  }
});

const boot = (file) => execFileSync('node', ['--input-type=module', '-e', `
  import db from '${path.join(ROOT, 'server/db/client.js')}';
  process.stdout.write(String(db.prepare('SELECT 1 AS ok').get().ok));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: file }, encoding: 'utf8' });

live('migrating the live database', () => {
  it('gives every historical message a truthful state and moves nothing else', async () => {
    fs.mkdirSync(path.dirname(COPY), { recursive: true });
    const source = new Database(LIVE_DB, { readonly: true });
    await source.backup(COPY);
    source.close();

    const census = (file) => {
      const conn = new Database(file, { readonly: true });
      const out = {
        sends: conn.prepare(`SELECT id, outreach_id, sequence, drafted_at, sent_at, policy_version,
          payload, body_hash, programme_campaign_id FROM outreach_send ORDER BY id`).all(),
        outreach: conn.prepare('SELECT id, token, drafted_at, sent_at, revoked_at FROM outreach ORDER BY id').all(),
      };
      conn.close();
      return out;
    };

    const before = census(COPY);
    expect(before.sends.length).toBeGreaterThan(0);

    boot(COPY);

    let conn = new Database(COPY, { readonly: true });
    expect(conn.prepare('SELECT state, accepted_source, COUNT(*) n FROM outreach_send GROUP BY 1, 2').all())
      .toEqual([{ state: 'ACCEPTED', accepted_source: 'OPERATOR_ASSERTED', n: before.sends.length }]);
    // NOT ONE FABRICATED OBSERVATION.
    expect(conn.prepare('SELECT COUNT(*) n FROM outreach_send_event').get().n).toBe(0);
    conn.close();

    // Ids, sequences, payloads, timestamps and campaign attribution: identical.
    expect(census(COPY)).toEqual(before);

    boot(COPY);                       // idempotent
    expect(census(COPY)).toEqual(before);
    conn = new Database(COPY, { readonly: true });
    expect(conn.prepare("SELECT COUNT(*) n FROM outreach_send WHERE state != 'ACCEPTED'").get().n).toBe(0);
    expect(conn.prepare('SELECT COUNT(*) n FROM outreach_send_event').get().n).toBe(0);
    conn.close();
  });

  it('keeps the 55 legacy drafts confirmable', () => {
    // They have no message record at all — recordDraft only ran when evidence
    // could be derived — so a message-only pending query would strand them.
    const conn = new Database(COPY, { readonly: true });
    const legacyPending = conn.prepare(`
      SELECT COUNT(*) n FROM outreach o
      WHERE o.sent_at IS NULL AND o.drafted_at IS NOT NULL AND o.revoked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM outreach_send s WHERE s.outreach_id = o.id)
    `).get().n;
    conn.close();
    expect(legacyPending).toBeGreaterThan(0);
  });
});
