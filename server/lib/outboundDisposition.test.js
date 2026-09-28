import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  OUTBOUND_ATTEMPT_DISPOSITION, TRANSPORT, isAttemptDisposition,
  recordOutboundAttempt, recordManualOutboundAttempt, settleOutboundAttempt,
  outboundAttempt, athleteUsage, mailboxUsage, attemptsForOutreach,
  outboundBudgetDecisionForAthlete,
} from './outboundBudget.js';

/**
 * D5.0 — A RESERVATION, AND WHAT BECAME OF IT.
 *
 * ===========================================================================
 * THE ONE ACCOUNTING CHANGE IN THE SLICE, AND THE TWO WAYS IT COULD GO WRONG.
 *
 * Until now every ledger row consumed a day's capacity from the moment it was
 * written, because every row represented an attempt that had genuinely been
 * handed to a transport. D5.0 introduces an attempt that provably was NOT — a
 * transport that stopped before it could submit anything — and such a row must
 * stop counting.
 *
 * The two failures worth testing for are opposite and both expensive:
 *
 *   RELEASING TOO MUCH   an ambiguous or accepted send treated as free. One
 *                        transmission paid for twice, and a retry licensed on a
 *                        message that may be in a coach's inbox.
 *   RELEASING TOO LITTLE   a legacy NULL row, or a crashed RESERVED one, read
 *                        as free. Capacity handed back that was really spent.
 *
 * So the tests below are mostly about which rows still count.
 * ===========================================================================
 *
 * NOTHING HERE SENDS ANYTHING, and there is no transport in this file at all.
 */

const ATHLETE = 'a-d50-disp';
const OTHER_ATHLETE = 'a-d50-disp-2';
const MAILBOX = 'box@thriv3.test';
const OTHER_MAILBOX = 'other@thriv3.test';
const DAY = '2026-09-18';
const WINDOW = { windowStart: `${DAY}T00:00:00.000Z`, windowEnd: '2026-09-19T00:00:00.000Z' };
const at = (hhmm) => `${DAY}T${hhmm}:00.000Z`;
let seq = 0;

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?)
  `).run(id, randomUUID().slice(0, 10));
}

function relationship(athleteId = ATHLETE) {
  const coachId = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, 'x', ?, ?, 'Duke', 'NCAA D1', 'mens-soccer', 'Head Coach')
  `).run(coachId, `Coach ${++seq}`, `c${seq}@duke.edu`);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO outreach (id, created_at, athlete_id, coach_id, token)
    VALUES (?, 'x', ?, ?, ?)
  `).run(id, athleteId, coachId, randomUUID());
  return { id, coachId };
}

/** A reservation taken exactly as the execution claim takes one. */
const reserve = ({
  outreachId, sendingIdentity = MAILBOX, when = at('09:00'),
  disposition = OUTBOUND_ATTEMPT_DISPOSITION.RESERVED, athleteLimit = 10, mailboxLimit = 50,
} = {}) => recordOutboundAttempt({
  outreachId, sendingIdentity, transport: TRANSPORT.PROVIDER_API,
  disposition, at: when, window: WINDOW, athleteLimit, mailboxLimit,
});

/**
 * THE CODE, NEVER THE SENTENCE. Routes map `err.code` to a status and nothing
 * in this system matches on prose, so a test that asserted a message would pin
 * wording that is free to change and miss the contract that is not.
 */
function refusalCode(fn) {
  try { fn(); } catch (err) { return err.code; }
  return null;
}

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM coaches; DELETE FROM players;`);
  athlete(ATHLETE);
  athlete(OTHER_ATHLETE);
  seq = 0;
});

/* ========================================================================== */
/* A — the column, and what it does not disturb                                */
/* ========================================================================== */

describe('A. the column', () => {
  it('is nullable, has no default, and adds no constraint', () => {
    const col = db.prepare('PRAGMA table_info(outbound_send_attempt)').all()
      .find((c) => c.name === 'disposition');
    expect(col).toBeTruthy();
    expect(col.type).toBe('TEXT');
    expect(col.notnull).toBe(0);
    expect(col.dflt_value).toBeNull();

    /**
     * NO CHECK CONSTRAINT, for the reason every other vocabulary column on this
     * schema gives: SQLite cannot alter one, so a fourth disposition would
     * become a table rebuild. The vocabulary is enforced in code — see below.
     */
    const sql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='outbound_send_attempt'",
    ).get().sql;
    expect(sql).not.toMatch(/CHECK\s*\([^)]*disposition/i);
  });

  it('backfills nothing — rows written before it keep NULL', () => {
    const o = relationship();
    /* A row inserted the way a pre-D5.0 writer would have, with no disposition. */
    db.prepare(`
      INSERT INTO outbound_send_attempt
        (id, outreach_id, athlete_id, sending_identity, transport, attempted_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), o.id, ATHLETE, MAILBOX, TRANSPORT.OUTLOOK_APPLESCRIPT,
      at('08:00'), at('08:00'));

    const [row] = attemptsForOutreach(o.id);
    expect(row.disposition).toBeNull();
  });

  it('leaves the five append-only accounting facts frozen', () => {
    const o = relationship();
    const { attempt } = reserve({ outreachId: o.id });

    for (const [col, value] of [
      ['sending_identity', OTHER_MAILBOX], ['attempted_at', at('23:59')],
      ['transport', 'SOMETHING_ELSE'], ['created_at', at('23:59')], ['id', 'reissued'],
    ]) {
      expect(() => db.prepare(`UPDATE outbound_send_attempt SET ${col} = ? WHERE id = ?`)
        .run(value, attempt.id)).toThrow(/append-only/);
    }

    /**
     * AND THE DISPOSITION IS OUTSIDE THAT TRIGGER ON PURPOSE. It is not a fact
     * about what was attempted — it is what was learned afterwards — which is
     * the entire reason settling it is possible at all.
     */
    expect(() => settleOutboundAttempt(
      attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS,
    )).not.toThrow();
  });

  it('exports no delete, no decrement and no refund', () => {
    const src = fs.readFileSync(new URL('./outboundBudget.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/DELETE\s+FROM\s+outbound_send_attempt/i);
    /* Releasing capacity never removes the row that reserved it. */
    const o = relationship();
    const { attempt } = reserve({ outreachId: o.id });
    settleOutboundAttempt(attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);
    expect(outboundAttempt(attempt.id)).toBeTruthy();
    expect(attemptsForOutreach(o.id)).toHaveLength(1);
  });
});

/* ========================================================================== */
/* B — which rows count                                                        */
/* ========================================================================== */

describe('B. what consumes a day', () => {
  it('counts RESERVED, because an attempt is in flight', () => {
    const o = relationship();
    reserve({ outreachId: o.id });
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(1);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(1);
  });

  it('counts SUBMITTED_OR_AMBIGUOUS', () => {
    const o = relationship();
    const { attempt } = reserve({ outreachId: o.id });
    settleOutboundAttempt(attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(1);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(1);
  });

  it('does NOT count REFUSED_BEFORE_TRANSPORT, on either ceiling', () => {
    const o = relationship();
    const { attempt } = reserve({ outreachId: o.id });
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(1);

    settleOutboundAttempt(attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);

    /* Both rules, identically. One predicate, four sites — that is the point. */
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(0);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(0);
  });

  it('counts NULL, so no legacy or manual row is quietly handed back', () => {
    const o = relationship();
    /** The manual confirmation path, which has no reservation to settle. */
    recordManualOutboundAttempt({ outreachId: o.id, sendingIdentity: MAILBOX, at: at('09:00') });
    expect(outboundAttempt(attemptsForOutreach(o.id)[0].id).disposition).toBeNull();
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(1);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(1);
  });

  it('keeps the athlete and the mailbox rules in step over a mixed day', () => {
    const o = relationship();
    const refused = reserve({ outreachId: o.id, when: at('09:00') });
    const sent = reserve({ outreachId: o.id, when: at('09:01') });
    reserve({ outreachId: o.id, when: at('09:02') });                 // stays RESERVED
    recordManualOutboundAttempt({ outreachId: o.id, sendingIdentity: MAILBOX, at: at('09:03') });

    settleOutboundAttempt(refused.attempt.id,
      OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);
    settleOutboundAttempt(sent.attempt.id,
      OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);

    /* Four rows on file; three of them spent something. */
    expect(attemptsForOutreach(o.id)).toHaveLength(4);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(3);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(3);
  });

  it('feeds the budget decision, so a release makes room for another send', () => {
    const o = relationship();
    const taken = [];
    for (let i = 0; i < 3; i += 1) {
      taken.push(reserve({ outreachId: o.id, when: at(`09:0${i}`), athleteLimit: 3 }));
    }
    /* At the ceiling: the guarded insert itself refuses a fourth. */
    expect(refusalCode(() => reserve({ outreachId: o.id, when: at('09:05'), athleteLimit: 3 })))
      .toBe('ATHLETE_DAILY_BUDGET_EXHAUSTED');
    expect(outboundBudgetDecisionForAthlete({
      athleteId: ATHLETE, sendingIdentity: MAILBOX, window: WINDOW,
      athleteLimit: 3, mailboxLimit: 50,
    }).allowed).toBe(false);

    settleOutboundAttempt(taken[0].attempt.id,
      OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);

    /**
     * ROOM AGAIN — and the released row is still on file. This is the whole
     * behavioural point of the slice: a mailbox is not charged for a message
     * that demonstrably never left the process.
     */
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(2);
    expect(() => reserve({ outreachId: o.id, when: at('09:06'), athleteLimit: 3 })).not.toThrow();
    expect(attemptsForOutreach(o.id)).toHaveLength(4);
  });

  it('keeps the guarded insert atomic — the ceiling still holds under the new predicate', () => {
    const o = relationship();
    for (let i = 0; i < 5; i += 1) {
      reserve({ outreachId: o.id, when: at(`09:0${i}`), mailboxLimit: 5, athleteLimit: 50 });
    }
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(5);
    expect(() => reserve({ outreachId: o.id, when: at('09:09'), mailboxLimit: 5, athleteLimit: 50 }))
      .toThrow();
    /* Nothing was written by the refusal. */
    expect(attemptsForOutreach(o.id)).toHaveLength(5);
  });

  it('does not let one athlete’s refusal free another athlete’s spend', () => {
    const mine = relationship(ATHLETE);
    const theirs = relationship(OTHER_ATHLETE);
    const a = reserve({ outreachId: mine.id });
    reserve({ outreachId: theirs.id, when: at('09:01') });

    settleOutboundAttempt(a.attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);

    expect(athleteUsage(ATHLETE, WINDOW)).toBe(0);
    expect(athleteUsage(OTHER_ATHLETE, WINDOW)).toBe(1);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(1);
  });
});

/* ========================================================================== */
/* C — settlement is a one-way door                                            */
/* ========================================================================== */

describe('C. settling a reservation', () => {
  it('moves a RESERVED row exactly once', () => {
    const o = relationship();
    const { attempt } = reserve({ outreachId: o.id });

    const first = settleOutboundAttempt(
      attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS,
    );
    expect(first).toEqual({
      settled: true,
      disposition: OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS,
      already: null,
    });
    expect(outboundAttempt(attempt.id).disposition)
      .toBe(OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);
  });

  it('is idempotent rather than throwing when it is asked twice', () => {
    const o = relationship();
    const { attempt } = reserve({ outreachId: o.id });
    settleOutboundAttempt(attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);

    /**
     * A SECOND ANSWER IS NOT AN ERROR. The caller is `executionResult`, whose
     * design principle is that bookkeeping must never unwind a durable provider
     * truth. It is told nothing moved, and what stands.
     */
    const again = settleOutboundAttempt(
      attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS,
    );
    expect(again.settled).toBe(false);
    expect(again.already).toBe(OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);
  });

  it('cannot turn a released row back into a consumed one', () => {
    const o = relationship();
    const { attempt } = reserve({ outreachId: o.id });
    settleOutboundAttempt(attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);

    const out = settleOutboundAttempt(
      attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS,
    );
    expect(out.settled).toBe(false);
    expect(outboundAttempt(attempt.id).disposition)
      .toBe(OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(0);
  });

  it('cannot turn a consumed row into a released one', () => {
    const o = relationship();
    const { attempt } = reserve({ outreachId: o.id });
    settleOutboundAttempt(attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS);

    /** The dangerous direction: a real transmission declared free. */
    const out = settleOutboundAttempt(
      attempt.id, OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT,
    );
    expect(out.settled).toBe(false);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(1);
  });

  it('will not touch a legacy NULL row', () => {
    const o = relationship();
    recordManualOutboundAttempt({ outreachId: o.id, sendingIdentity: MAILBOX, at: at('09:00') });
    const [row] = attemptsForOutreach(o.id);

    const out = settleOutboundAttempt(
      row.id, OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT,
    );
    expect(out.settled).toBe(false);
    expect(out.already).toBeNull();
    expect(outboundAttempt(row.id).disposition).toBeNull();
    /* And it still counts, which is the reason it must not be settleable. */
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(1);
  });

  it('refuses to settle back into RESERVED, or to an invented word', () => {
    const o = relationship();
    const { attempt } = reserve({ outreachId: o.id });
    for (const bad of [OUTBOUND_ATTEMPT_DISPOSITION.RESERVED, 'SENT', '', null, 'refused']) {
      expect(refusalCode(() => settleOutboundAttempt(attempt.id, bad)))
        .toBe('OUTBOUND_DISPOSITION_INVALID');
    }
  });

  it('refuses a missing ledger id rather than guessing at the latest row', () => {
    expect(refusalCode(
      () => settleOutboundAttempt('', OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS),
    )).toBe('OUTBOUND_ATTEMPT_ID_REQUIRED');
    expect(refusalCode(() => settleOutboundAttempt(
      randomUUID(), OUTBOUND_ATTEMPT_DISPOSITION.SUBMITTED_OR_AMBIGUOUS,
    ))).toBe('OUTBOUND_ATTEMPT_NOT_FOUND');
  });

  it('settles the named row when a message has several, not the newest', () => {
    /**
     * THE REASON SETTLEMENT TAKES AN ID. Two attempts for one message can share
     * a timestamp to the second; "the latest row" would then be decided by a
     * UUID comparison, and settling the wrong one releases capacity a real
     * transmission spent.
     */
    const o = relationship();
    const first = reserve({ outreachId: o.id, when: at('09:00') });
    const second = reserve({ outreachId: o.id, when: at('09:00') });

    settleOutboundAttempt(first.attempt.id,
      OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);

    expect(outboundAttempt(first.attempt.id).disposition)
      .toBe(OUTBOUND_ATTEMPT_DISPOSITION.REFUSED_BEFORE_TRANSPORT);
    expect(outboundAttempt(second.attempt.id).disposition)
      .toBe(OUTBOUND_ATTEMPT_DISPOSITION.RESERVED);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(1);
  });

  it('refuses an invalid disposition at reservation time too', () => {
    const o = relationship();
    expect(refusalCode(() => reserve({ outreachId: o.id, disposition: 'MAYBE' })))
      .toBe('OUTBOUND_DISPOSITION_INVALID');
    expect(attemptsForOutreach(o.id)).toHaveLength(0);
  });

  it('knows its own vocabulary and nothing else', () => {
    expect(isAttemptDisposition('RESERVED')).toBe(true);
    expect(isAttemptDisposition('SUBMITTED_OR_AMBIGUOUS')).toBe(true);
    expect(isAttemptDisposition('REFUSED_BEFORE_TRANSPORT')).toBe(true);
    for (const bad of ['SENT', 'FAILED', 'ACCEPTED', 'UNKNOWN', null, undefined, '']) {
      expect(isAttemptDisposition(bad)).toBe(false);
    }
  });
});
