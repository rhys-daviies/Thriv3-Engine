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
 * never move a state. Since D4.4 that table also carries this system's own
 * account of a transport attempt — see SEND_EVENT_TYPE — and the rule is the
 * same for both: an event records a fact, and no event moves a state.
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
  /**
   * A TRANSPORT RAN AND WE CANNOT SAY WHAT HAPPENED — D4.4.
   *
   * Not a failure, not a success, and not still in flight. The request may
   * have reached the provider and may have been accepted; nothing this process
   * observed settles it. It is written where the truth is unavailable:
   *
   *   - a timeout after the request body may have been transmitted
   *   - a connection reset after transmission may have begun
   *   - a crash after the provider accepted but before the local write
   *   - a crash after the SENDING claim but before or during the provider call
   *   - any provider answer that cannot confidently be called accepted or
   *     definitely rejected
   *
   * IT EXISTS SO THAT UNCERTAINTY IS NEVER RESOLVED BY GUESSING. Calling it
   * FAILED would license an automatic resend of a message a coach may already
   * have; calling it ACCEPTED would claim a send nobody observed; leaving it
   * SENDING would make a dead claim indistinguishable from a live one, which
   * is the thing a recovery sweep has to tell apart.
   *
   * NOTHING PRODUCES IT YET. D4.4 is the vocabulary and the graph; the
   * execution boundary that can reach it is a later slice.
   */
  UNKNOWN_PROVIDER_RESULT: 'UNKNOWN_PROVIDER_RESULT',
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
  /**
   * AN AMBIGUOUS SEND WAS LATER ESTABLISHED TO HAVE BEEN ACCEPTED — D4.4.
   *
   * The only source that may resolve `UNKNOWN_PROVIDER_RESULT` to ACCEPTED,
   * and it is deliberately NOT `PROVIDER_ACCEPTED`. The two describe different
   * evidence: a live 2xx is the provider answering the request we made, while
   * this is a message found afterwards — in the sent mailbox, by message id,
   * by a person looking. Both mean the message went; only one of them was
   * watched. Pooling them would make "did our transport work" unanswerable
   * exactly when somebody needed to know.
   *
   * IT MUST NEVER BE WRITTEN FOR A LIVE 2xx. That is PROVIDER_ACCEPTED.
   *
   * NOTHING PRODUCES IT YET. Reconciliation is a later slice; this names the
   * value so the state graph below can require it.
   */
  PROVIDER_RECONCILED: 'PROVIDER_RECONCILED',
});

/**
 * A transport may still act on a message in one of these, and a person may
 * still be shown it as the draft that is waiting.
 *
 * `UNKNOWN_PROVIDER_RESULT` IS DELIBERATELY NOT HERE — D4.4. Three callers
 * read this list and every one of them would be wrong about an ambiguous
 * message:
 *
 *   outreachSend.openSendFor   `recordDraft` reuses the open row, so an
 *                              UNKNOWN row would be rewritten in place with a
 *                              new body — over a message a coach may have.
 *   confirmSends.pendingDrafts an operator would be offered it as a draft to
 *                              confirm, and would accept it OPERATOR_ASSERTED
 *                              — turning "we do not know" into "a person says
 *                              it was sent".
 *   evidenceHistory            it would read as a message still being written.
 *
 * So this list keeps its narrow meaning, and the wider question — may another
 * message be opened on this relationship at all — is asked of
 * RELATIONSHIP_BLOCKING_STATES below.
 */
export const OPEN_STATES = Object.freeze([
  MESSAGE_STATE.DRAFT, MESSAGE_STATE.QUEUED, MESSAGE_STATE.SENDING,
]);

/**
 * WHILE A MESSAGE IS IN ONE OF THESE, THE RELATIONSHIP HOLDS NO OTHER — D4.4.
 *
 * The predicate behind `idx_outreach_send_one_open`, and a wider question than
 * OPEN_STATES asks. A message whose provider result is unknown may already be
 * in a coach's inbox; opening a second one beside it would be the double send
 * the whole ambiguity model exists to prevent, arrived at by the back door.
 *
 * It stops blocking when somebody resolves it — to ACCEPTED, which ends the
 * message, or to FAILED, which is retryable and is a decision a person made.
 */
export const RELATIONSHIP_BLOCKING_STATES = Object.freeze([
  ...OPEN_STATES, MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT,
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
  /**
   * A transport that ran and could not be read lands in
   * UNKNOWN_PROVIDER_RESULT — D4.4. It is the third outcome of a provider
   * call, beside acceptance and definite refusal.
   */
  SENDING: Object.freeze(['ACCEPTED', 'FAILED', 'UNKNOWN_PROVIDER_RESULT']),
  /**
   * ONLY RESOLUTION LEAVES IT, AND THE OMISSIONS ARE THE POINT — D4.4.
   *
   * ACCEPTED and FAILED are the two things reconciliation can establish. There
   * is NO edge to QUEUED and NO edge to SENDING, so "an ambiguous send is
   * never automatically retried" is a property of this table rather than of
   * somebody remembering it at the call site. A message that may already be in
   * a coach's inbox cannot be handed back to a transport by any code path,
   * including one nobody has written yet.
   *
   * Resolving to ACCEPTED requires PROVIDER_RECONCILED, never
   * PROVIDER_ACCEPTED: nobody watched this one leave.
   */
  UNKNOWN_PROVIDER_RESULT: Object.freeze(['ACCEPTED', 'FAILED']),
  FAILED: Object.freeze(['QUEUED']),
  ACCEPTED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

const STATE_VALUES = Object.freeze(Object.values(MESSAGE_STATE));

/** Checks the VALUE, which is the question actually being asked. */
export const isMessageState = (s) => STATE_VALUES.includes(s);
export const isOpen = (s) => OPEN_STATES.includes(s);
export const isTerminal = (s) => TERMINAL_STATES.includes(s);
/** Does a message in this state stop another being opened on the relationship? */
export const blocksRelationship = (s) => RELATIONSHIP_BLOCKING_STATES.includes(s);

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
 *
 * ---------------------------------------------------------------------------
 * WIDENED IN D4.4, AND THE ONE INVARIANT THAT MATTERS IS UNCHANGED.
 *
 * This list used to be described as things learned LATER and from OUTSIDE.
 * A transport outcome is neither: it is this system's own account of a call it
 * made. It belongs here anyway, because the alternative is worse. A transport
 * outcome is MULTI-VALUED — a retry produces a second one — and columns on a
 * single row cannot hold two; `outbound_send_attempt` cannot hold it either,
 * since its rows are written before the outcome is known and a trigger forbids
 * editing them afterwards. This table is append-only, carries `source`,
 * `confidence`, `observed_at` and a JSON `payload`, and is already indexed per
 * message in time order. It is the shape the fact needs.
 *
 * So the framing becomes: THINGS THIS SYSTEM LEARNED ABOUT ONE MESSAGE,
 * whether from its own transport or from the world afterwards. And the hard
 * rule stands exactly as it did — NO EVENT MOVES A STATE. `outreach_send.state`
 * remains the authority on what was done; an event is detail beside it, never
 * instead of it.
 * ---------------------------------------------------------------------------
 */
export const SEND_EVENT_TYPE = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  /**
   * A PROVIDER DEFINITELY REFUSED THIS ATTEMPT — D4.4. An invalid recipient, a
   * revoked scope, a quota, a structured 4xx: an answer, not a silence. The
   * message's own state goes to FAILED; this carries which attempt, when, and
   * what the provider said.
   */
  TRANSPORT_REJECTED: 'TRANSPORT_REJECTED',
  /**
   * AN ATTEMPT RAN AND ITS OUTCOME COULD NOT BE READ — D4.4. The companion of
   * `UNKNOWN_PROVIDER_RESULT`, and the reason that state is auditable: the row
   * says the message is unresolved, and these say how many times a transport
   * touched it and what each attempt looked like.
   */
  TRANSPORT_UNKNOWN: 'TRANSPORT_UNKNOWN',
  BOUNCE_HARD: 'BOUNCE_HARD',
  BOUNCE_SOFT: 'BOUNCE_SOFT',
  REPLY: 'REPLY',
  COMPLAINT: 'COMPLAINT',
  OPT_OUT: 'OPT_OUT',
});

const EVENT_VALUES = Object.freeze(Object.values(SEND_EVENT_TYPE));

export const isSendEventType = (t) => EVENT_VALUES.includes(t);
