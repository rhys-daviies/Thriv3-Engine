import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow, utcDayWindow } from './time.js';
import {
  ATHLETE_DAILY_OUTBOUND_LIMIT, MAILBOX_DAILY_OUTBOUND_LIMIT, OUTLOOK_FROM_ADDRESS,
} from './config.js';

/**
 * HOW MUCH SENDING CAPACITY HAS BEEN SPENT TODAY, AND WHETHER THERE IS MORE.
 *
 * The second sending-safety axis. `sendCap` asks whether one COACH has been
 * written to too often; this asks whether one MAILBOX has sent too much today,
 * and whether one ATHLETE has consumed more than their share of it. Neither
 * substitutes for the other and both must pass.
 *
 * THE FAILURE THIS PREVENTS, concretely. Every athlete's mail leaves through
 * one shared Outlook account today — THRIV3_FROM_ADDRESS, one identity for the
 * whole system. Ten athletes each politely under a ten-a-day ceiling is a
 * hundred messages from one mailbox in one day, from a domain with no warm-up
 * history, and the athlete-level rule would report all ten as well behaved
 * while it happened. So the mailbox is budgeted separately, and it is budgeted
 * on a key that survives the day each athlete has their own account.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS ONE OUTBOUND ACTION.
 *
 * One ATTEMPT to hand a message to a sending transport. Not a draft, not a
 * preview, not a plan, not a queue entry — those cost a provider nothing. In
 * this build there is exactly one such moment in the whole system: the
 * composeInOutlook call in server/routes/sendOutreach.js, and only when it is
 * asked to Send rather than to open a draft window.
 *
 * IT IS CONSUMED BEFORE THE TRANSPORT RUNS AND IT IS NEVER GIVEN BACK. A
 * failed attempt used the network and the provider's patience exactly as a
 * successful one did, and a system that refunded failures would let a broken
 * mailbox retry all night while reporting nothing spent. A retry is therefore
 * a second action and appears as a second row.
 * ---------------------------------------------------------------------------
 *
 * WHAT THIS MODULE DOES NOT DO. It does not decide who to contact, when, how
 * often, in what order, or whether a retry should happen at all. It is an
 * accountant: something else chooses the action, this says whether there is
 * capacity for it and records that the capacity went.
 */

/**
 * How the attempt reached a transport, and how truthfully we know it.
 *
 * The two are not equally precise and the column exists so nobody has to
 * pretend they are — see the note on `recordManualOutboundAttempt`.
 */
export const TRANSPORT = Object.freeze({
  OUTLOOK_APPLESCRIPT: 'OUTLOOK_APPLESCRIPT',
  OUTLOOK_MANUAL: 'OUTLOOK_MANUAL',
});

/**
 * WHY THERE IS NO CAPACITY FOR THIS ACTION.
 *
 * Four reasons, kept apart because they need four different answers from
 * whoever is told. Two are about a budget being spent; two are about a budget
 * that was never configured, which is a different problem entirely and must
 * not read as "come back tomorrow".
 *
 *   ATHLETE_DAILY_BUDGET_EXHAUSTED   this athlete has had their day's actions
 *   MAILBOX_DAILY_BUDGET_EXHAUSTED   this mailbox has had its day's actions
 *   SENDING_IDENTITY_REQUIRED        nothing said which mailbox would pay
 *   MAILBOX_LIMIT_REQUIRED           no ceiling has been set for that mailbox
 *
 * Collapsing these into RATE_LIMITED would tell an operator to wait for a
 * ceiling that does not exist, which is the one wrong thing to do about it.
 */
export const BUDGET_REFUSAL = Object.freeze({
  ATHLETE_DAILY_BUDGET_EXHAUSTED: 'ATHLETE_DAILY_BUDGET_EXHAUSTED',
  MAILBOX_DAILY_BUDGET_EXHAUSTED: 'MAILBOX_DAILY_BUDGET_EXHAUSTED',
  SENDING_IDENTITY_REQUIRED: 'SENDING_IDENTITY_REQUIRED',
  MAILBOX_LIMIT_REQUIRED: 'MAILBOX_LIMIT_REQUIRED',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * The stable key a mailbox is budgeted against.
 *
 * Trimmed and lowercased, so " Rhys@Striv3.com " and "rhys@striv3.com" cannot
 * each be handed their own full day's allowance. Returns null for anything
 * empty, which the callers turn into SENDING_IDENTITY_REQUIRED rather than
 * budgeting an unnamed mailbox.
 *
 * It happens to be an email address today. It is not typed or named as one,
 * because the next thing it holds is a connected Gmail or Graph account key.
 */
export function normaliseSendingIdentity(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return key || null;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const ATHLETE_USED = db.prepare(`
  SELECT COUNT(*) AS n FROM outbound_send_attempt
  WHERE athlete_id = @athleteId
    AND attempted_at >= @windowStart AND attempted_at < @windowEnd
`);

const MAILBOX_USED = db.prepare(`
  SELECT COUNT(*) AS n FROM outbound_send_attempt
  WHERE sending_identity = @sendingIdentity
    AND attempted_at >= @windowStart AND attempted_at < @windowEnd
`);

/**
 * Attempts this athlete has consumed inside the window.
 *
 * The window is half-open, so an attempt at exactly windowStart counts and one
 * at exactly windowEnd belongs to the next window. Stated here as well as in
 * `utcDayWindow` because an off-by-one at a day boundary is invisible until a
 * campaign gets eleven actions on the day the clocks are read differently.
 */
export function athleteUsage(athleteId, window = utcDayWindow()) {
  const { windowStart, windowEnd } = window;
  return ATHLETE_USED.get({ athleteId, windowStart, windowEnd }).n;
}

/** Attempts this mailbox has made inside the window. Same half-open rule. */
export function mailboxUsage(sendingIdentity, window = utcDayWindow()) {
  const key = normaliseSendingIdentity(sendingIdentity);
  if (!key) return 0;
  const { windowStart, windowEnd } = window;
  return MAILBOX_USED.get({ sendingIdentity: key, windowStart, windowEnd }).n;
}

/** One ledger row by its own id. */
export function outboundAttempt(id) {
  return db.prepare('SELECT * FROM outbound_send_attempt WHERE id = ?').get(id) ?? null;
}

/**
 * Every attempt made through one relationship, oldest first.
 *
 * The relationship rather than the message, because that is what the ledger
 * keys on and why — see the schema note on outreach_id. Ordered by
 * (attempted_at, id), which is total: two attempts sharing a timestamp still
 * come back in a fixed order.
 */
export function attemptsForOutreach(outreachId) {
  return db.prepare(`
    SELECT * FROM outbound_send_attempt WHERE outreach_id = ?
    ORDER BY attempted_at, id
  `).all(outreachId);
}

/** One athlete's attempts inside a window, oldest first. */
export function attemptsForAthlete(athleteId, window = utcDayWindow()) {
  const { windowStart, windowEnd } = window;
  return db.prepare(`
    SELECT * FROM outbound_send_attempt
    WHERE athlete_id = @athleteId
      AND attempted_at >= @windowStart AND attempted_at < @windowEnd
    ORDER BY attempted_at, id
  `).all({ athleteId, windowStart, windowEnd });
}

/** One mailbox's attempts inside a window, oldest first. */
export function attemptsForMailbox(sendingIdentity, window = utcDayWindow()) {
  const key = normaliseSendingIdentity(sendingIdentity);
  if (!key) return [];
  const { windowStart, windowEnd } = window;
  return db.prepare(`
    SELECT * FROM outbound_send_attempt
    WHERE sending_identity = @sendingIdentity
      AND attempted_at >= @windowStart AND attempted_at < @windowEnd
    ORDER BY attempted_at, id
  `).all({ sendingIdentity: key, windowStart, windowEnd });
}

/* -------------------------------------------------------------------------- */
/* Athlete identity                                                            */
/* -------------------------------------------------------------------------- */

const OUTREACH = db.prepare('SELECT id, athlete_id FROM outreach WHERE id = ?');

/**
 * WHOSE BUDGET THIS SPENDS, taken from the durable relationship.
 *
 * Never from the caller. `outreach` carries one row per athlete-coach pair and
 * its athlete_id is the authoritative answer; a caller-supplied id is treated
 * as an ASSERTION and checked against it, so a wrong or malicious one is
 * refused rather than quietly spending somebody else's day.
 *
 * That distinction matters because the two budgets are adversarial in a way
 * the campaign columns are not: an athlete whose own budget is exhausted has
 * an incentive to be attributed to another, and there is no later audit that
 * would notice.
 *
 * Always non-null coming out of here. The COLUMN is nullable only so that
 * deleting an athlete can null the pointer rather than being refused or
 * cascading away the mailbox's spend; nothing in this module ever writes one.
 */
function resolveAthlete(outreachId, assertedAthleteId = null) {
  const row = OUTREACH.get(outreachId);
  if (!row) throw fail('OUTREACH_NOT_FOUND', `No outreach ${outreachId}`);
  if (assertedAthleteId != null && assertedAthleteId !== row.athlete_id) {
    // Deliberately does not name the athlete it does belong to.
    throw fail(
      'OUTBOUND_ATHLETE_MISMATCH',
      `Outreach ${outreachId} belongs to a different athlete. An outbound action is `
      + 'charged to the athlete the relationship is for, never to the one the caller named.',
    );
  }
  return row.athlete_id;
}

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

/**
 * IS THERE CAPACITY FOR ONE MORE OUTBOUND ACTION RIGHT NOW?
 *
 * Returns a decision rather than throwing, so a dry-run screen can explain why
 * an action cannot happen without anything having to catch. `recordOutboundAttempt`
 * is the consuming form and refuses on the same reasons.
 *
 * OFF-BY-ONE, SAID OUT LOUD. The limit is a CEILING and the comparison is
 * `used < limit`. With a limit of 10 that means usage 0 through 9 has capacity,
 * the tenth action is allowed, it takes usage to 10, and the eleventh is
 * refused. Ten actions happen; an eleventh does not.
 *
 * A NULL MAILBOX LIMIT IS NOT INFINITY. It means nobody has decided, and
 * automated execution refuses — see MAILBOX_DAILY_OUTBOUND_LIMIT. `remaining`
 * comes back null rather than a number in that case, because there is no
 * number to report and 0 would read as "exhausted".
 *
 * ORDER OF REFUSALS: an unusable configuration first, then the athlete, then
 * the mailbox. The athlete comes before the mailbox because it is the one an
 * operator can act on — wait until tomorrow, or spread the campaign — while a
 * mailbox at its ceiling is a fact about every athlete on it at once.
 *
 * @returns {{allowed, reason, athlete, mailbox, window}}
 */
export function outboundBudgetDecision({
  outreachId, athleteId = null, sendingIdentity,
  window = utcDayWindow(),
  athleteLimit = ATHLETE_DAILY_OUTBOUND_LIMIT,
  mailboxLimit = MAILBOX_DAILY_OUTBOUND_LIMIT,
} = {}) {
  // Identity of the athlete is resolved first and THROWS, following A6: a
  // relationship that does not exist, or one belonging to somebody else, is a
  // caller bug rather than a state that changes when the day does.
  const athlete = resolveAthlete(outreachId, athleteId);
  return decide({ athlete, sendingIdentity, window, athleteLimit, mailboxLimit });
}

/**
 * THE SAME ANSWER, FOR AN ATHLETE WHO HAS NO RELATIONSHIP WITH THIS COACH YET.
 * READ-ONLY, AND IT CANNOT CONSUME.
 *
 * The gap B6 found and B7 needed closed. `outboundBudgetDecision` identifies
 * the athlete through an `outreach` row, which is right for a caller about to
 * spend and useless for a caller about to ASK: a first approach has no
 * relationship, and creating one to ask a question would mint a permanent
 * tracking token for a message nobody has approved. A dry run across a Top 100
 * would have minted three hundred.
 *
 * ---------------------------------------------------------------------------
 * TWO SECURITY MODELS, KEPT APART DELIBERATELY.
 *
 *   READ / SIMULATE   may be told which athlete. Reporting that athlete X has
 *                     used four of ten leaks nothing and spends nothing.
 *   WRITE / CONSUME   must DERIVE the athlete from a durable relationship, and
 *                     refuses a caller who names a different one. An athlete
 *                     whose own budget is exhausted has an incentive to be
 *                     attributed to another, and no later audit would notice.
 *
 * So this function exists and `recordOutboundAttempt` cannot reach it. A test
 * asserts the consume path still derives and still refuses a named athlete.
 * ---------------------------------------------------------------------------
 *
 * It shares the rule with the relationship-keyed form rather than restating it,
 * so `used < limit`, the order of refusals and the meaning of an unset mailbox
 * ceiling can never mean two different things in two places.
 */
export function outboundBudgetDecisionForAthlete({
  athleteId, sendingIdentity,
  window = utcDayWindow(),
  athleteLimit = ATHLETE_DAILY_OUTBOUND_LIMIT,
  mailboxLimit = MAILBOX_DAILY_OUTBOUND_LIMIT,
} = {}) {
  if (typeof athleteId !== 'string' || !athleteId) {
    throw fail('ATHLETE_REQUIRED', 'A budget reading must say whose budget it is reading.');
  }
  return decide({ athlete: athleteId, sendingIdentity, window, athleteLimit, mailboxLimit });
}

/** The rule itself, in one place, reached by both entry points above. */
function decide({ athlete, sendingIdentity, window, athleteLimit, mailboxLimit }) {
  const key = normaliseSendingIdentity(sendingIdentity);

  const athleteUsed = athleteUsage(athlete, window);
  const athleteSide = {
    id: athlete,
    used: athleteUsed,
    limit: athleteLimit,
    remaining: Math.max(0, athleteLimit - athleteUsed),
  };

  const refuse = (reason, mailboxSide) => ({
    allowed: false, reason, athlete: athleteSide, mailbox: mailboxSide, window,
  });

  if (!key) {
    return refuse(BUDGET_REFUSAL.SENDING_IDENTITY_REQUIRED, {
      identity: null, used: null, limit: mailboxLimit, remaining: null,
    });
  }

  const mailboxUsed = mailboxUsage(key, window);
  const mailboxSide = {
    identity: key,
    used: mailboxUsed,
    limit: mailboxLimit,
    remaining: mailboxLimit === null ? null : Math.max(0, mailboxLimit - mailboxUsed),
  };

  if (mailboxLimit === null) return refuse(BUDGET_REFUSAL.MAILBOX_LIMIT_REQUIRED, mailboxSide);
  if (athleteUsed >= athleteLimit) {
    return refuse(BUDGET_REFUSAL.ATHLETE_DAILY_BUDGET_EXHAUSTED, mailboxSide);
  }
  if (mailboxUsed >= mailboxLimit) {
    return refuse(BUDGET_REFUSAL.MAILBOX_DAILY_BUDGET_EXHAUSTED, mailboxSide);
  }

  return { allowed: true, reason: null, athlete: athleteSide, mailbox: mailboxSide, window };
}

function refusalMessage(decision) {
  const { reason, athlete, mailbox, window } = decision;
  const day = window.windowStart.slice(0, 10);
  switch (reason) {
    case BUDGET_REFUSAL.ATHLETE_DAILY_BUDGET_EXHAUSTED:
      return `This athlete has used all ${athlete.limit} outbound actions for ${day}. `
        + 'The ceiling is per day; the rest of the campaign continues tomorrow.';
    case BUDGET_REFUSAL.MAILBOX_DAILY_BUDGET_EXHAUSTED:
      return `The sending mailbox ${mailbox.identity} has used all ${mailbox.limit} of its `
        + `outbound actions for ${day}, across every athlete sending through it.`;
    case BUDGET_REFUSAL.SENDING_IDENTITY_REQUIRED:
      return 'An outbound action must say which mailbox is paying for it. '
        + 'Budgeting an unnamed sender would protect nothing.';
    case BUDGET_REFUSAL.MAILBOX_LIMIT_REQUIRED:
      return 'No daily ceiling has been set for the sending mailbox. Set '
        + 'THRIV3_MAILBOX_DAILY_OUTBOUND to a number you can defend for this domain. '
        + 'An unset limit means undecided, not unlimited.';
    default:
      return `Outbound action refused: ${reason}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Consumption                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * CHECK AND CONSUME IN ONE STATEMENT.
 *
 * The WHERE clause on an INSERT ... SELECT is what makes this atomic, and it
 * is deliberately not left to the surrounding transaction alone. Two writers
 * both reading remaining = 1 and both inserting is the exact failure a budget
 * cannot survive, and it is the kind of failure that appears only under load,
 * months after anybody remembers why the transaction mode mattered. Here the
 * database itself refuses the second row: the guard and the write are one
 * statement, and `changes` says which happened.
 *
 * (No backticks anywhere in here: this is a JS template literal.)
 */
const GUARDED_INSERT = db.prepare(`
  INSERT INTO outbound_send_attempt
    (id, outreach_id, athlete_id, sending_identity, transport, attempted_at, created_at)
  SELECT @id, @outreach_id, @athlete_id, @sending_identity, @transport, @attempted_at, @created_at
  WHERE (
      SELECT COUNT(*) FROM outbound_send_attempt
      WHERE athlete_id = @athlete_id
        AND attempted_at >= @window_start AND attempted_at < @window_end
    ) < @athlete_limit
    AND (
      SELECT COUNT(*) FROM outbound_send_attempt
      WHERE sending_identity = @sending_identity
        AND attempted_at >= @window_start AND attempted_at < @window_end
    ) < @mailbox_limit
`);

const PLAIN_INSERT = db.prepare(`
  INSERT INTO outbound_send_attempt
    (id, outreach_id, athlete_id, sending_identity, transport, attempted_at, created_at)
  VALUES (@id, @outreach_id, @athlete_id, @sending_identity, @transport, @attempted_at, @created_at)
`);

/**
 * The decision and the write, inseparable.
 *
 * BEGIN IMMEDIATE rather than the default deferred transaction: a deferred one
 * starts as a reader and upgrades on its first write, and two of those racing
 * is how SQLITE_BUSY appears in a place nobody expected a lock. This takes the
 * write lock at the start, so the count that decided and the row that consumed
 * cannot be separated by another writer.
 *
 * NOTHING AWAITS INSIDE IT. The transport call happens after this returns —
 * holding a database write lock across an AppleScript round trip, or across a
 * provider's HTTP call, would block every other writer for as long as the
 * network felt like taking.
 */
const consume = db.transaction((row, decisionArgs) => {
  const decision = outboundBudgetDecision(decisionArgs);
  if (!decision.allowed) throw fail(decision.reason, refusalMessage(decision));

  const result = GUARDED_INSERT.run(row);
  if (result.changes !== 1) {
    // Unreachable while the guard and the decision agree, which inside an
    // immediate transaction they must. Fails closed rather than pretending a
    // row exists that does not.
    throw fail(
      'OUTBOUND_BUDGET_RACE',
      'The budget was spent between deciding and consuming it. Nothing was recorded.',
    );
  }
  return decision;
});

/**
 * SPEND ONE OUTBOUND ACTION, OR REFUSE.
 *
 * Called immediately BEFORE the transport, never after: the whole point is
 * that a message which reaches a provider has already been paid for, including
 * one that then fails. Nothing here decrements, reverses or refunds — there is
 * no operation in this module that removes a row and the schema has a trigger
 * to make sure one cannot be added quietly.
 *
 * Throws with a `.code` from BUDGET_REFUSAL when there is no capacity, matching
 * the convention A2 introduced and B3 uses: routes map codes to statuses, and
 * nothing matches on a sentence.
 *
 * @returns {{attempt, decision}} the ledger row and the usage that allowed it.
 */
export function recordOutboundAttempt({
  outreachId, athleteId = null, sendingIdentity, transport = TRANSPORT.OUTLOOK_APPLESCRIPT,
  window = utcDayWindow(), at = utcNow(),
  athleteLimit = ATHLETE_DAILY_OUTBOUND_LIMIT,
  mailboxLimit = MAILBOX_DAILY_OUTBOUND_LIMIT,
} = {}) {
  const athlete = resolveAthlete(outreachId, athleteId);
  const key = normaliseSendingIdentity(sendingIdentity);
  const decisionArgs = {
    outreachId, athleteId, sendingIdentity, window, athleteLimit, mailboxLimit,
  };

  // The identity and ceiling refusals are reached through the decision below,
  // which owns every reason. Resolved here only so the row can be built.
  const row = {
    id: randomUUID(),
    outreach_id: outreachId,
    athlete_id: athlete,
    sending_identity: key,
    transport,
    attempted_at: at,
    created_at: at,
    window_start: window.windowStart,
    window_end: window.windowEnd,
    athlete_limit: athleteLimit,
    // Only ever read when the decision has already established it is a number.
    mailbox_limit: mailboxLimit ?? 0,
  };

  const decision = consume.immediate(row, decisionArgs);
  return { attempt: outboundAttempt(row.id), decision };
}

/**
 * RECORD AN OUTBOUND ACTION SOMEBODY ELSE ALREADY TOOK. Never refuses.
 *
 * The compatibility decision, and it needs saying plainly because it is the
 * one place this module does not enforce anything.
 *
 * TODAY'S MANUAL WORKFLOW HAS NO ENFORCEABLE MOMENT. The browser composer and
 * the drafting CLI both pass `send: false`; the AppleScript opens a draft
 * window and stops. The operator then presses Send inside Outlook's own UI —
 * outside this process entirely — and tells us afterwards through
 * `npm run confirm-sends`. There is no line of code between the decision and
 * the transmission at which a refusal could do anything, because by the time
 * this system hears about it the coach already has the email.
 *
 * REFUSING WOULD THEREFORE BE THEATRE, AND WORSE THAN THAT. It would refuse to
 * RECORD mail that had already gone, leaving the mailbox's real usage
 * understated by exactly the traffic we were most worried about — every manual
 * message leaves through the same shared account as every automated one.
 *
 * So the honest arrangement is: record it, count it against the mailbox and
 * the athlete, and never pretend we could have stopped it. Automated execution
 * goes through `recordOutboundAttempt` and is enforced properly.
 *
 * IT IS DATED BY ITS CONFIRMATION, NOT ITS SEND. The confirmation instant is
 * the only one this process ever observed, so a batch sent last night and
 * confirmed this morning is counted this morning. That is recorded as an
 * imprecision rather than smoothed over: `transport` is OUTLOOK_MANUAL, so an
 * analysis that needs exact timing can exclude these and know what it lost.
 */
export function recordManualOutboundAttempt({
  outreachId, athleteId = null, sendingIdentity = OUTLOOK_FROM_ADDRESS,
  transport = TRANSPORT.OUTLOOK_MANUAL, at = utcNow(),
} = {}) {
  const athlete = resolveAthlete(outreachId, athleteId);
  const key = normaliseSendingIdentity(sendingIdentity);
  if (!key) {
    throw fail(
      BUDGET_REFUSAL.SENDING_IDENTITY_REQUIRED,
      'A manual outbound action must still say which mailbox sent it; an unattributed '
      + 'one adds nothing to the mailbox usage it exists to keep accurate.',
    );
  }
  const row = {
    id: randomUUID(),
    outreach_id: outreachId,
    athlete_id: athlete,
    sending_identity: key,
    transport,
    attempted_at: at,
    created_at: at,
  };
  PLAIN_INSERT.run(row);
  return outboundAttempt(row.id);
}
