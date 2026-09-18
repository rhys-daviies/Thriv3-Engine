import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { MESSAGE_STATE, ACCEPTED_SOURCE, SEND_EVENT_TYPE } from '../../shared/outreachMessageState.js';

/**
 * D4.7 — PROVIDER ACCEPTANCE IS PRIMARY TRUTH, AND SECONDARY BOOKKEEPING MAY
 * NOT UNDO IT.
 *
 * ===========================================================================
 * THE FAILURE THIS FILE EXISTS FOR.
 *
 * A provider accepted a real email addressed to a real coach. If advancing the
 * campaign's step then throws — a constraint, a corrupted row, anything — and
 * that exception unwound the transaction, the only record that the email went
 * would disappear. A caller would see a failure, conclude nothing was sent, and
 * send it again. The coach receives it twice.
 *
 * So acceptance commits in its own transaction and the step moves in a second
 * one. `advanceAttemptForConfirmedSend` cannot be made to throw by any input
 * this build can produce — it answers every expected case with a reason — so
 * the throw is mocked here. That is the only honest way to test a failure mode
 * the code is built to survive but nothing can currently trigger.
 * ===========================================================================
 *
 * `vi.mock` is hoisted per file, which is why this is its own file rather than
 * a case inside executionTransport.test.js.
 */

const { advanceThrows } = vi.hoisted(() => ({ advanceThrows: { on: false } }));

vi.mock('./contactAttempts.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    advanceAttemptForConfirmedSend(...args) {
      if (advanceThrows.on) {
        const err = new Error('the campaign step could not be advanced');
        err.code = 'TEST_ADVANCE_EXPLODED';
        throw err;
      }
      return real.advanceAttemptForConfirmedSend(...args);
    },
  };
});

const { persistTransportResult } = await import('./executionResult.js');
const { TRANSPORT_OUTCOME } = await import('./outboundTransport.js');
const { recordDraft, claimSendForExecution, sendById, sendEvents } = await import('./outreachSend.js');
const { createOutreach } = await import('./outreach.js');
const { findOrCreateCoach } = await import('./coaches.js');
const { RUN_ID } = await import('./executionRun.js');

const ATHLETE = 'a-d47-book';
const NOW = '2026-09-18T12:00:00.000Z';
let seq = 0;

/** A claimed execution row. The campaign chain is irrelevant to this failure. */
function claimedSend() {
  const coach = findOrCreateCoach({
    full_name: `Coach ${++seq}`,
    email: `book${seq}@duke.edu`,
    school: 'Duke',
    sport: 'mens-soccer',
    division: 'NCAA D1',
    position_title: 'Head Coach',
  });
  const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
  const { id } = recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: 'Duke',
    sport: 'mens-soccer', evidence: null, body: 'Wire body.', subject: 'Subject',
    wireBody: 'Wire body.', at: NOW,
  });
  claimSendForExecution(id, { runId: RUN_ID, at: NOW });
  return id;
}

beforeEach(() => {
  advanceThrows.on = false;
  for (const t of [
    'outreach_send_event', 'outbound_send_attempt', 'outreach_send', 'outreach',
    'coaches', 'players',
  ]) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(ATHLETE, randomUUID().slice(0, 10));
  seq = 0;
});

describe('when advancing the attempt throws', () => {
  it('leaves the acceptance, its source, its metadata and its event durable', () => {
    const sendId = claimedSend();
    advanceThrows.on = true;

    const out = persistTransportResult(sendId, {
      outcome: TRANSPORT_OUTCOME.ACCEPTED,
      providerMessageId: 'pm-1',
      providerThreadId: 'pt-1',
    }, { at: NOW });

    const row = sendById(sendId);
    expect(row.state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(row.accepted_source).toBe(ACCEPTED_SOURCE.PROVIDER_ACCEPTED);
    expect(row.provider_message_id).toBe('pm-1');
    expect(row.provider_thread_id).toBe('pt-1');
    expect(row.provider_accepted_at).toBe(NOW);
    expect(row.sent_at).toBe(NOW);

    const events = sendEvents(sendId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(SEND_EVENT_TYPE.ACCEPTED);
  });

  /** Reported, never thrown: an exception here would invite a resend. */
  it('reports the failure instead of raising it', () => {
    const sendId = claimedSend();
    advanceThrows.on = true;

    let threw = null;
    let out = null;
    try {
      out = persistTransportResult(sendId, { outcome: TRANSPORT_OUTCOME.ACCEPTED }, { at: NOW });
    } catch (err) { threw = err; }

    expect(threw).toBe(null);
    expect(out.persisted).toBe(true);
    expect(out.bookkeeping).toEqual({
      advanced: false, reason: 'THREW', error: 'TEST_ADVANCE_EXPLODED',
    });
    expect(out.send.state).toBe(MESSAGE_STATE.ACCEPTED);
  });

  /** And the message is terminal, so nothing can be tempted to send it again. */
  it('leaves a message nothing can re-claim', () => {
    const sendId = claimedSend();
    advanceThrows.on = true;
    persistTransportResult(sendId, { outcome: TRANSPORT_OUTCOME.ACCEPTED }, { at: NOW });

    expect(claimSendForExecution(sendId, { runId: RUN_ID, at: NOW }).claimed).toBe(false);
    expect(sendById(sendId).state).toBe(MESSAGE_STATE.ACCEPTED);
  });
});
