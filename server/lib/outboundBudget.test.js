import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import * as budget from './outboundBudget.js';
import {
  TRANSPORT, BUDGET_REFUSAL, normaliseSendingIdentity,
  outboundBudgetDecision, recordOutboundAttempt, recordManualOutboundAttempt,
  athleteUsage, mailboxUsage, outboundAttempt,
  attemptsForOutreach, attemptsForAthlete, attemptsForMailbox,
} from './outboundBudget.js';
import { utcDayWindow } from './time.js';
import { createOutreach, markOutreachDrafted, resolveToken, revokeOutreach } from './outreach.js';
import { recordDraft, confirmSend, sendsForOutreach, openSendFor } from './outreachSend.js';
import { confirmSent, pendingDrafts } from './confirmSends.js';
import { findOrCreateCoach } from './coaches.js';
import { isSuppressed, suppress } from './suppressions.js';
import { recentSendCount, isSendCapped } from './sendCap.js';
import { createContactAttempt, contactAttempt } from './contactAttempts.js';
import { campaignContactDecision } from './campaignAttribution.js';
import { MESSAGE_STATE, ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * B5 — the outbound action budget.
 *
 * The three properties worth stating before the tests, because every one of
 * them is a place a plausible implementation would have been wrong:
 *
 *   1. CAPACITY IS SPENT BEFORE THE TRANSPORT AND NEVER REFUNDED. A failed
 *      attempt used the provider exactly as a successful one did.
 *   2. THE TWO AXES ARE INDEPENDENT AND BOTH BIND. Ten athletes each under a
 *      ten-a-day ceiling is a hundred messages from one mailbox.
 *   3. USAGE CANNOT BE DERIVED FROM outreach_send. A retry is a second action
 *      and one message may consume capacity twice.
 */

const ATHLETE = 'a-budget';
const OTHER_ATHLETE = 'a-budget-other';
const MAILBOX = 'sender@striv3.com';
const OTHER_MAILBOX = 'second@striv3.com';
const DAY = '2026-09-07';
const WINDOW = utcDayWindow(DAY);
const at = (hhmm) => `${DAY}T${hhmm}:00.000Z`;

let seq = 0;

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer', ?)
  `).run(id, name, randomUUID().slice(0, 10));
}

const makeCoach = ({ school = 'Duke', sport = 'mens-soccer', email } = {}) => findOrCreateCoach({
  full_name: 'A Coach', email: email ?? `c${++seq}@duke.edu`, school, sport, division: 'NCAA D1',
});

/** A relationship, which is all the ledger needs to charge an athlete. */
function relationship(athleteId = ATHLETE, coachOpts = {}) {
  return createOutreach({ athleteId, coachId: makeCoach(coachOpts).id });
}

function makeCampaign({ athleteId = ATHLETE, state = 'active' } = {}) {
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(athleteId);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2020-01-01', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)
  `).run(id, athleteId, state);
  return id;
}

function makeProgramme(campaignId, { college = 'Duke', sport = 'mens-soccer' } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, sport, ++seq);
  return id;
}

/** Spend one action with everything explicit, so no test depends on the env. */
const spend = (opts = {}) => recordOutboundAttempt({
  sendingIdentity: MAILBOX, window: WINDOW, at: at('09:00'),
  athleteLimit: 10, mailboxLimit: 100, ...opts,
});

const decide = (opts = {}) => outboundBudgetDecision({
  sendingIdentity: MAILBOX, window: WINDOW, athleteLimit: 10, mailboxLimit: 100, ...opts,
});

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE, 'Budget Athlete');
  insertAthlete(OTHER_ATHLETE, 'Other Athlete');
});

// ---------------------------------------------------------------------------

describe('the ledger', () => {
  it('creates the table with the approved shape and nothing else', () => {
    const cols = db.prepare('PRAGMA table_info(outbound_send_attempt)').all();
    expect(cols.map((c) => c.name).sort()).toEqual([
      'athlete_id', 'attempted_at', 'created_at', 'id',
      'outreach_id', 'sending_identity', 'transport',
    ]);
    // No outcome, no counters, no campaign columns. An accounting ledger that
    // also reports is one that grows a column every quarter — and an outcome
    // would have to be written after the fact, which the trigger forbids.
    const names = cols.map((c) => c.name);
    for (const forbidden of ['outcome', 'status', 'campaign_id', 'programme_campaign_id',
      'tier', 'attempts', 'count']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('records the first outbound attempt with everything the budget reads', () => {
    const o = relationship();
    const { attempt, decision } = spend({ outreachId: o.id });

    expect(attempt).toMatchObject({
      outreach_id: o.id,
      athlete_id: ATHLETE,
      sending_identity: MAILBOX,
      transport: TRANSPORT.OUTLOOK_APPLESCRIPT,
      attempted_at: at('09:00'),
    });
    expect(attempt.id).toEqual(expect.any(String));
    // The decision reports the usage that ALLOWED it, before this row existed.
    expect(decision.allowed).toBe(true);
    expect(decision.athlete.used).toBe(0);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(1);
  });

  it('counts a retry as a second action, on the same message', () => {
    const o = relationship();
    spend({ outreachId: o.id });
    spend({ outreachId: o.id, at: at('09:05') });

    expect(attemptsForOutreach(o.id)).toHaveLength(2);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(2);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(2);
    // THE REASON THE LEDGER EXISTS. outreach_send holds one row per message
    // however many times it was handed to a transport, so usage derived from
    // it would report one action where two were taken.
    expect(sendsForOutreach(o.id)).toHaveLength(0);
  });

  it('refuses to let a recorded attempt be edited afterwards', () => {
    const o = relationship();
    const { attempt } = spend({ outreachId: o.id });

    // The four accounting facts and the row's own id are frozen: what was
    // spent, from which mailbox, by what means, and when.
    for (const [col, value] of [
      ['sending_identity', OTHER_MAILBOX], ['attempted_at', at('23:59')],
      ['transport', 'SOMETHING_ELSE'], ['created_at', at('23:59')], ['id', 'reissued'],
    ]) {
      expect(() => db.prepare(`UPDATE outbound_send_attempt SET ${col} = ? WHERE id = ?`)
        .run(value, attempt.id)).toThrow(/append-only/);
    }
    expect(outboundAttempt(attempt.id)).toMatchObject({
      sending_identity: MAILBOX, attempted_at: at('09:00'),
      transport: TRANSPORT.OUTLOOK_APPLESCRIPT,
    });
  });

  it('exports no way to give capacity back', () => {
    const src = fs.readFileSync(new URL('./outboundBudget.js', import.meta.url), 'utf8');
    // What actually protects the accounting: not a trigger anybody with a SQL
    // prompt can drop, but the absence of an operation that removes a row.
    // Asserted on the SQL and the exported surface rather than on the prose —
    // this module's own comments say the word "refunded", and a guard that
    // trips on its own explanation is not a guard.
    expect(src).not.toMatch(/DELETE\s+FROM\s+outbound_send_attempt/i);
    expect(src).not.toMatch(/UPDATE\s+outbound_send_attempt/i);
    for (const name of Object.keys(budget)) {
      expect(name).not.toMatch(/refund|decrement|reverse|release|reset|clear/i);
    }
  });

  it('orders attempts deterministically, even when they share a timestamp', () => {
    const o = relationship();
    for (let i = 0; i < 5; i += 1) spend({ outreachId: o.id, at: at('09:00') });
    const ids = attemptsForOutreach(o.id).map((r) => r.id);
    expect(ids).toHaveLength(5);
    expect(ids).toEqual([...ids].sort());          // (attempted_at, id) is total
    expect(attemptsForOutreach(o.id).map((r) => r.id)).toEqual(ids);   // and stable
  });

  it('keeps the mailbox accounting when the athlete who spent it is deleted', () => {
    const o = relationship();
    spend({ outreachId: o.id });
    spend({ outreachId: o.id, at: at('09:05') });

    db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(ATHLETE);
    db.prepare('DELETE FROM players WHERE id = ?').run(ATHLETE);

    // The pointer is nulled; the mailbox's spend is not. CASCADE here would
    // have let deleting one athlete hand a day of sending capacity back to
    // every other athlete on the same mailbox.
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(2);
    expect(attemptsForMailbox(MAILBOX, WINDOW).map((r) => r.athlete_id)).toEqual([null, null]);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(0);
  });

  it('keeps the accounting when the relationship it points at is deleted', () => {
    const o = relationship();
    spend({ outreachId: o.id });
    spend({ outreachId: o.id, at: at('09:05') });

    db.prepare('DELETE FROM outreach WHERE id = ?').run(o.id);

    // The pointer goes; the spent capacity does not. Usage is counted on
    // (athlete, mailbox, time) precisely so housekeeping cannot refund a day.
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(2);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(2);
    expect(attemptsForAthlete(ATHLETE, WINDOW).map((r) => r.outreach_id)).toEqual([null, null]);
  });

  it('holds nothing for the messages that predate it', () => {
    // No backfill, and none is possible: we know 41 historical messages were
    // asserted as sent, and nothing about how many transport attempts that
    // took. Usage before B5 is incomplete BY DESIGN rather than by omission.
    expect(db.prepare('SELECT COUNT(*) n FROM outbound_send_attempt').get().n).toBe(0);
    const src = fs.readFileSync(new URL('./outboundBudget.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/backfill/i);
    expect(src).not.toMatch(/FROM\s+outreach_send\b/);
  });
});

// ---------------------------------------------------------------------------

describe('the athlete daily budget', () => {
  it('allows every action from the first through the tenth, and refuses the eleventh', () => {
    const o = relationship();
    // THE OFF-BY-ONE, SPELLED OUT. The limit is a ceiling: `used < limit`. So
    // usage 0..9 has capacity, the tenth action is allowed and takes usage to
    // 10, and the eleventh is refused. Ten happen; an eleventh does not.
    for (let i = 0; i < 10; i += 1) {
      expect(decide({ outreachId: o.id }).allowed).toBe(true);
      expect(athleteUsage(ATHLETE, WINDOW)).toBe(i);
      spend({ outreachId: o.id });
    }
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(10);

    const eleventh = decide({ outreachId: o.id });
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.reason).toBe(BUDGET_REFUSAL.ATHLETE_DAILY_BUDGET_EXHAUSTED);
    expect(eleventh.athlete).toMatchObject({ used: 10, limit: 10, remaining: 0 });
    expect(() => spend({ outreachId: o.id }))
      .toThrow(/used all 10 outbound actions/);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(10);   // and nothing was written
  });

  it('reports used, limit and remaining so a dry run can explain itself', () => {
    const o = relationship();
    spend({ outreachId: o.id });
    spend({ outreachId: o.id, at: at('09:01') });
    spend({ outreachId: o.id, at: at('09:02') });

    expect(decide({ outreachId: o.id })).toMatchObject({
      allowed: true,
      reason: null,
      athlete: { id: ATHLETE, used: 3, limit: 10, remaining: 7 },
      window: WINDOW,
    });
  });

  it('keeps one athlete out of another athlete\'s budget', () => {
    const mine = relationship(ATHLETE);
    const theirs = relationship(OTHER_ATHLETE, { email: 'other@duke.edu' });
    for (let i = 0; i < 10; i += 1) spend({ outreachId: mine.id });

    expect(() => spend({ outreachId: mine.id })).toThrow(/used all 10/);
    // Exhausting one says nothing about the other.
    expect(decide({ outreachId: theirs.id, athleteId: OTHER_ATHLETE }).allowed).toBe(true);
    expect(spend({ outreachId: theirs.id }).attempt.athlete_id).toBe(OTHER_ATHLETE);
  });
});

// ---------------------------------------------------------------------------

describe('the mailbox daily budget', () => {
  const small = { athleteLimit: 100, mailboxLimit: 3 };

  it('allows the action that reaches the ceiling and refuses the next', () => {
    const o = relationship();
    for (let i = 0; i < 3; i += 1) {
      expect(decide({ outreachId: o.id, ...small }).allowed).toBe(true);
      spend({ outreachId: o.id, ...small });
    }
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(3);

    const refused = decide({ outreachId: o.id, ...small });
    expect(refused.reason).toBe(BUDGET_REFUSAL.MAILBOX_DAILY_BUDGET_EXHAUSTED);
    expect(refused.mailbox).toMatchObject({ identity: MAILBOX, used: 3, limit: 3, remaining: 0 });
    expect(() => spend({ outreachId: o.id, ...small })).toThrow(/across every athlete sending through it/);
  });

  it('charges two athletes on one mailbox to the SAME mailbox budget', () => {
    // The whole reason the mailbox axis exists. Both athletes are politely
    // under their own ceiling and the mailbox is not.
    const mine = relationship(ATHLETE);
    const theirs = relationship(OTHER_ATHLETE, { email: 'other@duke.edu' });
    spend({ outreachId: mine.id, ...small });
    spend({ outreachId: theirs.id, ...small });
    spend({ outreachId: theirs.id, ...small });

    expect(athleteUsage(ATHLETE, WINDOW)).toBe(1);
    expect(athleteUsage(OTHER_ATHLETE, WINDOW)).toBe(2);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(3);

    // Neither athlete is anywhere near their own limit, and neither may send.
    for (const [o, a] of [[mine, ATHLETE], [theirs, OTHER_ATHLETE]]) {
      const d = decide({ outreachId: o.id, athleteId: a, ...small });
      expect(d.reason).toBe(BUDGET_REFUSAL.MAILBOX_DAILY_BUDGET_EXHAUSTED);
      expect(d.athlete.remaining).toBeGreaterThan(0);
    }
  });

  it('budgets two mailboxes separately while one athlete\'s total stays combined', () => {
    const o = relationship();
    const two = { athleteLimit: 4, mailboxLimit: 2 };
    spend({ outreachId: o.id, sendingIdentity: MAILBOX, ...two });
    spend({ outreachId: o.id, sendingIdentity: MAILBOX, ...two });
    spend({ outreachId: o.id, sendingIdentity: OTHER_MAILBOX, ...two });

    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(2);
    expect(mailboxUsage(OTHER_MAILBOX, WINDOW)).toBe(1);
    // Independent per mailbox...
    expect(decide({ outreachId: o.id, sendingIdentity: MAILBOX, ...two }).reason)
      .toBe(BUDGET_REFUSAL.MAILBOX_DAILY_BUDGET_EXHAUSTED);
    expect(decide({ outreachId: o.id, sendingIdentity: OTHER_MAILBOX, ...two }).allowed).toBe(true);
    // ...and COMBINED for the athlete, whose fourth action across BOTH
    // mailboxes is their last: two ceilings of two do not make four each.
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(3);
    spend({ outreachId: o.id, sendingIdentity: OTHER_MAILBOX, ...two });
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(4);
    expect(decide({ outreachId: o.id, sendingIdentity: OTHER_MAILBOX, ...two }).reason)
      .toBe(BUDGET_REFUSAL.ATHLETE_DAILY_BUDGET_EXHAUSTED);
  });

  it('treats an unconfigured ceiling as undecided, never as unlimited', () => {
    const o = relationship();
    const d = decide({ outreachId: o.id, mailboxLimit: null });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(BUDGET_REFUSAL.MAILBOX_LIMIT_REQUIRED);
    // Not 0 either, which would read as exhausted and send somebody looking
    // for capacity that is simply undefined.
    expect(d.mailbox.remaining).toBeNull();
    expect(() => spend({ outreachId: o.id, mailboxLimit: null }))
      .toThrow(/unset limit means undecided, not unlimited/);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(0);
  });

  it('refuses an action that will not say which mailbox pays for it', () => {
    const o = relationship();
    for (const identity of [null, '', '   ', undefined]) {
      const d = decide({ outreachId: o.id, sendingIdentity: identity });
      expect(d.reason).toBe(BUDGET_REFUSAL.SENDING_IDENTITY_REQUIRED);
      expect(() => spend({ outreachId: o.id, sendingIdentity: identity }))
        .toThrow(/must say which mailbox/);
    }
    expect(db.prepare('SELECT COUNT(*) n FROM outbound_send_attempt').get().n).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('the daily window', () => {
  it('is half-open: the opening instant counts and the closing one does not', () => {
    const o = relationship();
    spend({ outreachId: o.id, at: WINDOW.windowStart });
    spend({ outreachId: o.id, at: WINDOW.windowEnd });

    expect(athleteUsage(ATHLETE, WINDOW)).toBe(1);
    // The one at windowEnd belongs to the next day, and to exactly one day.
    expect(athleteUsage(ATHLETE, utcDayWindow('2026-09-08'))).toBe(1);
  });

  it('excludes an attempt made before the window opened', () => {
    const o = relationship();
    spend({ outreachId: o.id, at: '2026-09-06T23:59:59.999Z' });
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(0);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(0);
    expect(decide({ outreachId: o.id, athleteLimit: 1 }).allowed).toBe(true);
  });

  it('counts each day into its own window', () => {
    const o = relationship();
    spend({ outreachId: o.id, at: '2026-09-06T12:00:00.000Z' });
    spend({ outreachId: o.id, at: at('12:00') });
    spend({ outreachId: o.id, at: at('13:00') });
    spend({ outreachId: o.id, at: '2026-09-08T12:00:00.000Z' });

    expect(athleteUsage(ATHLETE, utcDayWindow('2026-09-06'))).toBe(1);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(2);
    expect(athleteUsage(ATHLETE, utcDayWindow('2026-09-08'))).toBe(1);
  });

  it('takes the window as an argument everywhere, so no timezone is baked in', () => {
    const src = fs.readFileSync(new URL('./outboundBudget.js', import.meta.url), 'utf8');
    // utcDayWindow appears only as a DEFAULT. Anything that reached for
    // "today" mid-comparison would be a timezone decision made invisibly, and
    // B3 established that such decisions are named and injectable.
    const uses = src.match(/utcDayWindow\(\)/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const line of src.split('\n')) {
      if (!line.includes('utcDayWindow()')) continue;
      expect(line).toMatch(/window\s*=\s*utcDayWindow\(\)/);
    }
    // And a window is never derived from Date.now() inside a query.
    expect(src).not.toMatch(/Date\.now\(\)/);
  });
});

// ---------------------------------------------------------------------------

describe('identity', () => {
  it('normalises a sending identity so one mailbox gets one allowance', () => {
    expect(normaliseSendingIdentity('  Sender@Striv3.COM ')).toBe('sender@striv3.com');
    expect(normaliseSendingIdentity('')).toBeNull();
    expect(normaliseSendingIdentity(null)).toBeNull();

    const o = relationship();
    spend({ outreachId: o.id, sendingIdentity: '  Sender@Striv3.COM ' });
    spend({ outreachId: o.id, sendingIdentity: 'SENDER@striv3.com' });
    // Two spellings, one mailbox, one budget.
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(2);
    expect(attemptsForMailbox('sender@STRIV3.com', WINDOW)).toHaveLength(2);
  });

  it('charges the athlete the relationship names, not the one the caller does', () => {
    const mine = relationship(ATHLETE);
    // The caller may ASSERT an athlete; the assertion is checked, never trusted.
    expect(() => spend({ outreachId: mine.id, athleteId: OTHER_ATHLETE }))
      .toThrow(/belongs to a different athlete/);
    expect(athleteUsage(OTHER_ATHLETE, WINDOW)).toBe(0);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(0);

    // Omitting it entirely is fine: the durable relationship is the authority.
    expect(spend({ outreachId: mine.id }).attempt.athlete_id).toBe(ATHLETE);
  });

  it('cannot spend against a relationship that does not exist', () => {
    expect(() => spend({ outreachId: 'no-such-outreach' })).toThrow(/No outreach/);
    expect(() => decide({ outreachId: 'no-such-outreach' })).toThrow(/No outreach/);
  });
});

// ---------------------------------------------------------------------------

describe('atomicity', () => {
  it('cannot oversubscribe the final slot', () => {
    const o = relationship();
    const limits = { athleteLimit: 100, mailboxLimit: 7 };
    let taken = 0;
    let refused = 0;
    for (let i = 0; i < 30; i += 1) {
      try { spend({ outreachId: o.id, ...limits }); taken += 1; } catch { refused += 1; }
    }
    expect(taken).toBe(7);
    expect(refused).toBe(23);
    expect(mailboxUsage(MAILBOX, WINDOW)).toBe(7);
  });

  it('makes the guard part of the write rather than a read before it', () => {
    const src = fs.readFileSync(new URL('./outboundBudget.js', import.meta.url), 'utf8');
    // The INSERT carries its own WHERE over both counts, so the database
    // refuses the row rather than the module deciding to. That is what makes
    // "two workers both saw remaining = 1" impossible rather than unlikely.
    expect(src).toMatch(/INSERT INTO outbound_send_attempt[\s\S]*?SELECT[\s\S]*?WHERE[\s\S]*?<\s*@athlete_limit/);
    expect(src).toMatch(/<\s*@mailbox_limit/);
    // BEGIN IMMEDIATE, not a deferred transaction that upgrades on first write.
    expect(src).toMatch(/consume\.immediate\(/);
  });

  it('never holds the write lock across a transport call', () => {
    const src = fs.readFileSync(new URL('./outboundBudget.js', import.meta.url), 'utf8');
    // Nothing in this module talks to a transport, and nothing awaits: an
    // AppleScript round trip inside BEGIN IMMEDIATE would block every other
    // writer for as long as the network felt like taking.
    //
    // Read off the IMPORTS, not the prose — the header explains at length what
    // the Outlook path does, and matching on the word would trip on that.
    expect(src).not.toMatch(/\bawait\b/);
    const imports = src.split('\n').filter((l) => /^import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/outlook|osascript|child_process|node:http/i);
    expect(src).not.toMatch(/\bfetch\(|execFile|spawn\(/);
    const txn = src.slice(src.indexOf('const consume = db.transaction'), src.indexOf('export function recordOutboundAttempt'));
    expect(txn).not.toMatch(/\basync\b|\bawait\b/);
  });
});

// ---------------------------------------------------------------------------

describe('the manual path', () => {
  it('records a confirmed manual send against the mailbox and the athlete', () => {
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    markOutreachDrafted(o.id);

    expect(pendingDrafts()).toHaveLength(1);
    confirmSent([o.id], { at: at('10:00') });

    const rows = attemptsForOutreach(o.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      athlete_id: ATHLETE,
      transport: TRANSPORT.OUTLOOK_MANUAL,
      attempted_at: at('10:00'),
    });
    // Charged to the configured mailbox: every manual message leaves through
    // the same shared account as every automated one.
    expect(rows[0].sending_identity).toBe(normaliseSendingIdentity(process.env.THRIV3_FROM_ADDRESS || 'rhys@striv3.com'));
  });

  it('records a manual send even when the budget is already exhausted', () => {
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    markOutreachDrafted(o.id);
    // Fill the day through the enforced path first.
    const filler = relationship(ATHLETE, { email: 'filler@duke.edu' });
    for (let i = 0; i < 10; i += 1) spend({ outreachId: filler.id });
    expect(() => spend({ outreachId: filler.id })).toThrow(/used all 10/);

    // The coach already has the email. Refusing here would decline to write
    // down mail that has already gone, and understate the mailbox by exactly
    // the traffic the ceiling exists to watch.
    const out = confirmSent([o.id], { at: at('10:00') });
    expect(out.confirmed).toBe(1);
    expect(attemptsForOutreach(o.id)).toHaveLength(1);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(11);
  });

  it('confirms the send even if the accounting write cannot happen', () => {
    // Best-effort, like logEvidence: the confirmation is the more important of
    // the two facts and must not be blocked by a ledger problem.
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    markOutreachDrafted(o.id);
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: 'Duke',
      sport: 'mens-soccer', evidence: null, body: 'b', subject: 's',
    });

    const src = fs.readFileSync(new URL('./confirmSends.js', import.meta.url), 'utf8');
    expect(src).toMatch(/try\s*\{\s*\n\s*recordManualOutboundAttempt/);

    expect(confirmSent([o.id], { at: at('10:00') }).confirmed).toBe(1);
    expect(openSendFor(o.id)).toBeNull();
    expect(sendsForOutreach(o.id)[0].state).toBe(MESSAGE_STATE.ACCEPTED);
  });

  it('does not double-count a batch that is confirmed twice', () => {
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    markOutreachDrafted(o.id);
    confirmSent([o.id], { at: at('10:00') });
    const again = confirmSent([o.id], { at: at('11:00') });

    expect(again.confirmed).toBe(0);
    expect(again.skipped).toEqual([o.id]);
    expect(attemptsForOutreach(o.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('the recipient cap and the sender budget are different things', () => {
  it('counts on different keys and neither moves the other', () => {
    const coach = makeCoach({ email: 'popular@duke.edu' });
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    markOutreachDrafted(o.id);

    // Spending sender budget writes nothing the recipient cap reads: that cap
    // counts distinct athletes who have CONFIRMED SENDS to the address.
    for (let i = 0; i < 5; i += 1) spend({ outreachId: o.id });
    expect(recentSendCount('popular@duke.edu')).toBe(0);
    expect(isSendCapped('popular@duke.edu')).toBe(false);

    // And a confirmation moves the recipient cap without being an extra spend
    // beyond the one it records.
    confirmSent([o.id], { at: at('10:00') });
    expect(recentSendCount('popular@duke.edu')).toBe(1);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(6);
  });

  it('charges a follow-up to the sender budget although the recipient cap counts the relationship once', () => {
    const coach = makeCoach({ email: 'followed@duke.edu' });
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    markOutreachDrafted(o.id);
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: 'Duke',
      sport: 'mens-soccer', evidence: null, body: 'first', subject: 's1',
    });
    confirmSent([o.id], { at: at('10:00') });

    // A second message to the same coach. sendCap counts DISTINCT ATHLETES per
    // inbox, so the relationship still reads as one; the sender budget counts
    // actions, so it reads as two.
    markOutreachDrafted(o.id);
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: 'Duke',
      sport: 'mens-soccer', evidence: null, body: 'follow up', subject: 's2',
    });
    confirmSent([o.id], { at: at('11:00') });

    expect(recentSendCount('followed@duke.edu')).toBe(1);
    expect(athleteUsage(ATHLETE, WINDOW)).toBe(2);
    expect(sendsForOutreach(o.id).map((s) => s.sequence)).toEqual([1, 2]);
  });

  it('leaves sendCap saying exactly what it said before', () => {
    const src = fs.readFileSync(new URL('./sendCap.js', import.meta.url), 'utf8');
    expect(src).toContain('lower(c.email) = ?');
    expect(src).toContain('o.sent_at IS NOT NULL');
    // It has not learned about the sender at all, which is the point.
    expect(src).not.toMatch(/sending_identity|outbound_send_attempt|mailbox/i);
  });
});

// ---------------------------------------------------------------------------

describe('what B5 leaves exactly as it found it', () => {
  it('does not touch a contact attempt when budget is consumed', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const coach = makeCoach();
    const attempt = createContactAttempt({ programmeCampaignId: pc, coachId: coach.id });
    const before = contactAttempt(attempt.id);
    expect(before).toMatchObject({ state: 'planned', step: 1 });
    const snapshot = db.prepare('SELECT * FROM programme_contact_attempts').all();

    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    spend({ outreachId: o.id });

    // Step, state and programme progression are B6/B7 execution semantics.
    expect(db.prepare('SELECT * FROM programme_contact_attempts').all()).toEqual(snapshot);
    expect(contactAttempt(attempt.id)).toEqual(before);
  });

  it('does not move campaign or programme state', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });

    const campaignBefore = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign);
    const programmeBefore = db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc);
    spend({ outreachId: o.id });
    spend({ outreachId: o.id, at: at('09:10') });

    expect(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign)).toEqual(campaignBefore);
    expect(db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc)).toEqual(programmeBefore);
    expect(campaignContactDecision({ programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id }).allowed)
      .toBe(true);
  });

  it('does not move message state, and a spend is not a message', () => {
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: 'Duke',
      sport: 'mens-soccer', evidence: null, body: 'b', subject: 's',
    });
    spend({ outreachId: o.id });

    expect(sendsForOutreach(o.id)[0].state).toBe(MESSAGE_STATE.DRAFT);
    expect(sendsForOutreach(o.id)[0].sent_at).toBeNull();
    confirmSend(o.id, at('12:00'), { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
    expect(sendsForOutreach(o.id)[0].state).toBe(MESSAGE_STATE.ACCEPTED);
  });

  it('does not touch A6 attribution, suppression, revocation or the public token', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    spend({ outreachId: o.id });

    expect(db.prepare('SELECT programme_campaign_id FROM outreach WHERE id = ?').get(o.id))
      .toEqual({ programme_campaign_id: pc });
    expect(resolveToken(o.token)?.id).toBe(o.id);
    expect(isSuppressed(coach.email)).toBe(false);

    suppress({ email: coach.email, reason: 'unsubscribed' });
    expect(isSuppressed(coach.email)).toBe(true);
    // Suppression is not the budget's business and the budget is not
    // suppression's: each keeps answering its own question.
    expect(decide({ outreachId: o.id }).allowed).toBe(true);

    revokeOutreach(o.id);
    expect(resolveToken(o.token)).toBeNull();
  });
});
