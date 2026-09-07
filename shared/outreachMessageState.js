/**
 * WHAT THRIV3 KNOWS IT DID WITH ONE OUTBOUND MESSAGE.
 *
 * `outreach_send.state` is EXECUTION state: the record of actions this system
 * took, or was told were taken. The boundary is the whole point of the file.
 *
 *   it MAY mean   a body exists; it was handed to a transport; a transport or
 *                 a person told us the message was accepted for sending.
 *
 *   it MAY NOT    delivered, inboxed, opened, replied, bounced, complained.
 *
 * Those last are things learned LATER, from outside, about a message already
 * sent. They are observations, they belong in `outreach_send_event`, and they
 * never move a state.
 *
 * THE TWO DECAY DIFFERENTLY, which is the real argument for separating them.
 * Execution state is ours and settles the moment it happens. An observation
 * arrives days later, from a source of varying trustworthiness, and a second
 * one may contradict it. Folding a bounce into `state` would overwrite the
 * record of what we did with a record of what happened afterwards — and "did
 * we send this" would stop being answerable at the moment somebody asked.
 *
 * ---------------------------------------------------------------------------
 * ACCEPTED IS NOT DELIVERED, AND MUST NEVER BE READ AS DELIVERED.
 *
 * The strongest thing this build can say is that Outlook's own Send command
 * was issued without erroring, or that an operator confirmed a batch by hand.
 * Neither observes a provider accepting anything. `accepted_source` records
 * which it was, so the day a provider API returns a real acceptance the three
 * are distinguishable in the data rather than only in a changelog.
 * ---------------------------------------------------------------------------
 */

/**
 * SCREAMING_SNAKE strings, matching this table's neighbours —
 * `policy_version` ('LEGACY_UNKNOWN'), `body_source` ('STRUCTURED'),
 * `structure_source` ('ENGINE' | 'OPERATOR'). The campaign tables use
 * lowercase for their own states; the convention is per-table and this one
 * follows `outreach_send`.
 */
export const MESSAGE_STATE = Object.freeze({
  /** A body exists. It may still be rewritten in place. */
  DRAFT: 'DRAFT',
  /**
   * Handed to a scheduler and waiting its turn.
   *
   * NOTHING PRODUCES THIS TODAY — there is no scheduler. It is named now so
   * that building one is not also a migration, and so the transition graph
   * already says what a scheduler may and may not do.
   */
  QUEUED: 'QUEUED',
  /**
   * A transport is working on it. Its value is as a LOCK against a double
   * send, not as something to report. Also unreachable today: the AppleScript
   * path returns having either issued Send or thrown, with no in-flight
   * moment anybody could observe.
   */
  SENDING: 'SENDING',
  /** Accepted for sending — by a person, by a command, or later by an API. */
  ACCEPTED: 'ACCEPTED',
  /** A transport refused it or the attempt failed. Terminal until retried. */
  FAILED: 'FAILED',
  /** Withdrawn before it went anywhere. Terminal. */
  CANCELLED: 'CANCELLED',
});

/**
 * HOW WE CAME TO BELIEVE A MESSAGE WAS ACCEPTED.
 *
 * Weakest first, and the ordering is the reason the field exists at all: an
 * analysis pooling an operator's recollection with a provider's own answer is
 * measuring two different things and cannot say so.
 */
export const ACCEPTED_SOURCE = Object.freeze({
  /**
   * A person said so afterwards. `npm run confirm-sends`, and all 41 of the
   * historical rows, which were confirmed by hand or produced by a path that
   * recorded no provenance at all.
   */
  OPERATOR_ASSERTED: 'OPERATOR_ASSERTED',
  /**
   * The AppleScript issued Outlook's own Send and did not error. Stronger than
   * a recollection, weaker than an API: we observed a command succeed, not a
   * message leave.
   */
  OUTLOOK_COMMAND_ASSERTED: 'OUTLOOK_COMMAND_ASSERTED',
  /**
   * A provider API returned acceptance — Gmail `messages.send`, Microsoft
   * Graph `sendMail`. NOTHING PRODUCES THIS YET. Named now so the weaker two
   * look weak, rather than looking like the only kind of truth there is.
   */
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
});

/** A transport may still act on a message in one of these. */
export const OPEN_STATES = Object.freeze([
  MESSAGE_STATE.DRAFT, MESSAGE_STATE.QUEUED, MESSAGE_STATE.SENDING,
]);

/** Nothing moves out of these. FAILED is absent: a retry is a legal exit. */
export const TERMINAL_STATES = Object.freeze([
  MESSAGE_STATE.ACCEPTED, MESSAGE_STATE.CANCELLED,
]);

/**
 * The legal graph — broader than today exercises, narrower than the vocabulary
 * would allow.
 *
 * ONLY DRAFT → ACCEPTED AND DRAFT → DRAFT HAPPEN IN THIS BUILD. There is no
 * scheduler and no in-flight moment. The scheduler edges are declared anyway,
 * because a graph that has to grow is a migration, and because writing them
 * down now is what stops somebody later deciding QUEUED → ACCEPTED is
 * reasonable. It is not: a message that was never handed to a transport cannot
 * have been accepted by one.
 *
 * ACCEPTED and CANCELLED go nowhere. A bounce arriving next week does not
 * un-accept a message — we did accept it — and that invariant is precisely
 * what the event table exists to protect.
 */
export const LEGAL_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['QUEUED', 'SENDING', 'ACCEPTED', 'CANCELLED']),
  QUEUED: Object.freeze(['SENDING', 'CANCELLED', 'FAILED']),
  SENDING: Object.freeze(['ACCEPTED', 'FAILED']),
  FAILED: Object.freeze(['QUEUED']),
  ACCEPTED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

const STATE_VALUES = Object.freeze(Object.values(MESSAGE_STATE));

/** Checks the VALUE, which is the question actually being asked. */
export const isMessageState = (s) => STATE_VALUES.includes(s);
export const isOpen = (s) => OPEN_STATES.includes(s);
export const isTerminal = (s) => TERMINAL_STATES.includes(s);

/**
 * May a message move from one state to another?
 *
 * Same-state returns true and means NOTHING HAPPENED — the caller writes
 * nothing. Re-confirming a batch or re-drafting a draft must not restamp a
 * timestamp or look like a second event, which is the convention `suppress()`,
 * `createOutreach` and `markOutreachSent` already set.
 */
export function canTransition(from, to) {
  if (!isMessageState(from) || !isMessageState(to)) return false;
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * THE VOCABULARY AN OBSERVATION MAY USE.
 *
 * Declared so `outreach_send_event` has a stated shape from the start, and
 * EMPTY OF PRODUCERS on purpose. Nothing in this build observes a bounce, a
 * reply or a complaint — there is no inbox ingestion and no provider webhook —
 * and a type existing here is not permission to invent one.
 *
 * `ACCEPTED` is here as well as being a state, and the two are not redundant:
 * the state says a message was accepted, an ACCEPTED event carries a
 * provider's own evidence for it (a message id, a 202, a response body). No
 * transition requires an event, and no historical event was fabricated for the
 * 41 rows whose acceptance nobody watched.
 */
export const SEND_EVENT_TYPE = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  BOUNCE_HARD: 'BOUNCE_HARD',
  BOUNCE_SOFT: 'BOUNCE_SOFT',
  REPLY: 'REPLY',
  COMPLAINT: 'COMPLAINT',
  OPT_OUT: 'OPT_OUT',
});

const EVENT_VALUES = Object.freeze(Object.values(SEND_EVENT_TYPE));

export const isSendEventType = (t) => EVENT_VALUES.includes(t);
