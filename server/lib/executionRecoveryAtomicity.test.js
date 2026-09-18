import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * D4.6 — THE TWO HALVES GO IN TOGETHER, OR NEITHER DOES.
 *
 * A recovery writes two things about one message: the state, which says the
 * outcome is unknown, and the event, which says WHY — which run abandoned it
 * and when. Either one alone is a worse record than none:
 *
 *   state without event   a message nobody can explain. It reads as an
 *                         ambiguous send with no account of where the
 *                         ambiguity came from, and the operator who has to
 *                         reconcile it has nothing to go on.
 *   event without state   an observation about a message that is still SENDING,
 *                         so the relationship stays blocked and the next boot
 *                         writes a second event saying the same thing.
 *
 * So this file removes each half in turn and proves the other did not happen.
 * `vi.mock` is hoisted per file, which is why these two live apart from the
 * behavioural suite rather than beside it.
 */

const { appendThrows, transitionLoses } = vi.hoisted(() => ({
  appendThrows: { on: false },
  transitionLoses: { on: false },
}));

vi.mock('./outreachSend.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    appendSendEvent(...args) {
      if (appendThrows.on) {
        const err = new Error('the event could not be written');
        err.code = 'TEST_EVENT_WRITE_FAILED';
        throw err;
      }
      return real.appendSendEvent(...args);
    },
    transitionSend(...args) {
      /**
       * THE RACE, IN THE ONE SHAPE IT CAN TAKE. `transitionSend` reports a
       * transition it did not make as `changed: false` rather than as an error
       * — the same answer it gives when somebody else got there first.
       */
      if (transitionLoses.on) return { id: args[0], changed: false };
      return real.transitionSend(...args);
    },
  };
});

const { recoverPriorRunSendingClaims } = await import('./executionRecovery.js');
const { recordDraft, claimSendForExecution, sendById, sendEvents } = await import('./outreachSend.js');
const { createOutreach } = await import('./outreach.js');
const { findOrCreateCoach } = await import('./coaches.js');

const ATHLETE = 'a-d46-atomic';
const NOW = '2026-09-18T12:00:00.000Z';
const DEAD_RUN = 'run-that-died-0002';
let seq = 0;

function abandoned() {
  const c = findOrCreateCoach({
    full_name: `Coach ${++seq}`,
    email: `atomic${seq}@duke.edu`,
    school: 'Duke',
    sport: 'mens-soccer',
    division: 'NCAA D1',
    position_title: 'Head Coach',
  });
  const o = createOutreach({ athleteId: ATHLETE, coachId: c.id });
  const { id } = recordDraft({
    outreachId: o.id,
    athleteId: ATHLETE,
    coachId: c.id,
    collegeName: 'Duke',
    sport: 'mens-soccer',
    evidence: null,
    body: 'Body.',
    subject: 'Subject',
    at: NOW,
  });
  claimSendForExecution(id, { runId: DEAD_RUN, at: NOW });
  return id;
}

beforeEach(() => {
  appendThrows.on = false;
  transitionLoses.on = false;
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

describe('when the event cannot be written', () => {
  it('rolls the transition back and leaves the claim exactly as it was', () => {
    const sendId = abandoned();
    const before = JSON.stringify(sendById(sendId));
    appendThrows.on = true;

    expect(() => recoverPriorRunSendingClaims({ currentRunId: 'run-now', at: NOW }))
      .toThrow(/could not be written/);

    expect(JSON.stringify(sendById(sendId))).toBe(before);
    expect(sendById(sendId).state).toBe(MESSAGE_STATE.SENDING);
    expect(sendEvents(sendId)).toEqual([]);
  });

  /** And the whole sweep rolls back, not merely the row that failed. */
  it('leaves a message recovered earlier in the same sweep untouched too', () => {
    const first = abandoned();
    const second = abandoned();
    appendThrows.on = true;

    expect(() => recoverPriorRunSendingClaims({ currentRunId: 'run-now', at: NOW })).toThrow();

    for (const id of [first, second]) {
      expect(sendById(id).state).toBe(MESSAGE_STATE.SENDING);
      expect(sendEvents(id)).toEqual([]);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM outreach_send_event').get().n).toBe(0);
  });

  /** The next boot finds it still SENDING and can recover it properly. */
  it('leaves it recoverable by the next boot', () => {
    const sendId = abandoned();
    appendThrows.on = true;
    expect(() => recoverPriorRunSendingClaims({ currentRunId: 'run-now', at: NOW })).toThrow();

    appendThrows.on = false;
    const out = recoverPriorRunSendingClaims({ currentRunId: 'run-now', at: NOW });

    expect(out.sendIds).toEqual([sendId]);
    expect(sendById(sendId).state).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(sendEvents(sendId).length).toBe(1);
  });
});

describe('when the transition does not happen', () => {
  /**
   * NO TRANSITION, NO EVENT. An event written beside a transition that did not
   * occur is a false account of something this sweep did not do — and it would
   * be written against a message somebody else is still working on.
   */
  it('appends no event and counts no recovery', () => {
    const sendId = abandoned();
    transitionLoses.on = true;

    const out = recoverPriorRunSendingClaims({ currentRunId: 'run-now', at: NOW });

    expect(out).toEqual({ recovered: 0, sendIds: [] });
    expect(sendEvents(sendId)).toEqual([]);
    expect(sendById(sendId).state).toBe(MESSAGE_STATE.SENDING);
  });
});
