import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { normaliseOrigin, OUTREACH_ORIGIN } from '../../shared/outreachOrigin.js';
import { utcNow } from './time.js';
import { buildSendSnapshot } from '../../shared/evidence/sendSnapshot.js';
import { LEGACY_POLICY_VERSION } from '../../shared/evidence/outreachPolicy.js';
import { authorisedProgrammeCampaignId } from './campaignAttribution.js';
import {
  MESSAGE_STATE, ACCEPTED_SOURCE, OPEN_STATES, LEGAL_TRANSITIONS, canTransition,
  isMessageState, isSendEventType,
} from '../../shared/outreachMessageState.js';

/** Rows leave this module with their payload parsed, never as stored JSON. */
const safeParse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const parse = (row) => (row ? { ...row, payload: safeParse(row.payload) } : null);

/**
 * PERSISTING ONE OUTBOUND EMAIL.
 *
 * Two phases, because the world has two phases and pretending otherwise is
 * what produced the defect this replaces.
 *
 *   DRAFT       a body exists and reached Outlook. The snapshot is frozen HERE,
 *               before anything can move underneath it, and the row is created
 *               with `sent_at` null.
 *   CONFIRM     something we observed sent it — Outlook's own Send, or the
 *               operator saying so through `npm run confirm-sends`. `sent_at`
 *               is stamped and the row becomes an analytics send.
 *
 * A draft is not a send and a preview is not a draft. Only `sent_at IS NOT
 * NULL` counts, which is the denominator I1 found trustworthy and this does
 * not weaken.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS MUTABLE, AND WHERE IT STOPS.
 *
 * A PENDING row is the draft currently sitting in Outlook, and re-drafting to
 * the same coach REPLACES it — same sequence, new snapshot — exactly as
 * `outreach.drafted_at` has always overwritten. Redrafting is not a follow-up.
 *
 * A CONFIRMED row is frozen. Nothing here updates one, and the next draft to
 * that coach opens a new row at the next sequence. So send 1 keeps its own
 * evidence however many times send 2 is rewritten, which is the property the
 * old single-row model could not offer.
 */

const insertSend = db.prepare(`
  INSERT INTO outreach_send (
    id, outreach_id, sequence, drafted_at, sent_at,
    athlete_id, coach_id, college_name, sport, programme_campaign_id, origin, policy_version,
    state, accepted_source,
    structure, structure_source, body_source, template_variant,
    has_personalisation, primary_kind, primary_role, hook_kind,
    rendered_kinds, rendered_roles, rendered_count,
    subject, body_hash, payload, created_at
  ) VALUES (
    @id, @outreach_id, @sequence, @drafted_at, @sent_at,
    @athlete_id, @coach_id, @college_name, @sport, @programme_campaign_id, @origin, @policy_version,
    @state, @accepted_source,
    @structure, @structure_source, @body_source, @template_variant,
    @has_personalisation, @primary_kind, @primary_role, @hook_kind,
    @rendered_kinds, @rendered_roles, @rendered_count,
    @subject, @body_hash, @payload, @created_at
  )
`);

/**
 * The OPEN message for this relationship, if there is one. At most one, and
 * since B2 that is a database guarantee rather than a convention — see
 * `idx_outreach_send_one_open`.
 *
 * Reads `state`, not `sent_at`. They agree today, and the state is what will
 * still be right when a scheduler can hold a message QUEUED with no timestamp
 * of any kind on it.
 */
const OPEN_LIST = OPEN_STATES.map((s) => `'${s}'`).join(', ');
const pendingFor = db.prepare(
  `SELECT * FROM outreach_send WHERE outreach_id = ? AND state IN (${OPEN_LIST})
   ORDER BY sequence DESC LIMIT 1`,
);

/** The open message for a relationship, or null. Message-level truth. */
export function openSendFor(outreachId) {
  return parse(pendingFor.get(outreachId));
}

/**
 * The next sequence number for this relationship.
 *
 * Confirmed sends plus one. A pending draft does not advance it — replacing an
 * unsent draft is not a second message — so drafting five times and sending
 * once produces sequence 1, not sequence 5.
 */
export function nextSequence(outreachId) {
  const { n } = db.prepare(
    "SELECT COUNT(*) AS n FROM outreach_send WHERE outreach_id = ? AND state = 'ACCEPTED'",
  ).get(outreachId);
  return n + 1;
}

/**
 * Record that a body reached Outlook, with the evidence that produced it.
 *
 * @returns {{id, sequence}} the send this draft belongs to.
 */
export function recordDraft({
  outreachId, athleteId, coachId, collegeName = null, sport = null,
  programmeCampaignId = null, onDate = undefined,
  evidence, body = null, subject = null,
  bodySource = null, templateVariant = null, renderedKinds = null,
  /**
   * WHAT KIND OF ACTION THIS WAS — see shared/outreachOrigin.js.
   *
   * Supplied by the caller like `programmeCampaignId` above and for the same
   * reason: whoever composed the message knows what it is, and inferring it
   * here from a null campaign id would record "manual" for every legacy row
   * and every campaign whose campaign row was later deleted.
   */
  origin = null,
  at = utcNow(),
}) {
  /**
   * THE AUTHORITATIVE CAMPAIGN ATTRIBUTION, and it comes from the CALLER.
   *
   * It is deliberately NOT read from `outreach.programme_campaign_id`. That
   * column records which campaign first opened the relationship, and a
   * relationship endures across campaigns: a message sent under Campaign 2
   * through a relationship first opened under Campaign 1 must record Campaign
   * 2, and inferring it from the relationship would credit Campaign 1 with
   * Campaign 2's work — silently, and irrecoverably once the send is history.
   *
   * So whoever composes the message says which campaign it is for, or says
   * nothing and gets NULL, which is the honest record of a manual send.
   */
  /**
   * B3 gates this as well as A6 attributing it, and DRAFTING IS GATED TOO — a
   * stopped programme must not go on accumulating drafts that somebody can
   * send later. Nothing is written when it refuses.
   */
  const verifiedCampaign = authorisedProgrammeCampaignId({
    programmeCampaignId, athleteId, coachId, outreachId, onDate,
  });
  const snapshot = buildSendSnapshot({
    evidence, body, subject, bodySource, templateVariant, renderedKinds,
  });
  const open = pendingFor.get(outreachId);
  const row = {
    id: open?.id ?? randomUUID(),
    outreach_id: outreachId,
    sequence: open?.sequence ?? nextSequence(outreachId),
    drafted_at: at,
    sent_at: null,
    athlete_id: athleteId,
    coach_id: coachId,
    college_name: collegeName,
    sport,
    programme_campaign_id: verifiedCampaign,
    /**
     * CAMPAIGN ATTRIBUTION WINS, and it wins over the CALLER'S OWN CONTEXT.
     *
     * `verifiedCampaign` is what `authorisedProgrammeCampaignId` just approved,
     * so a message that really is campaign work is recorded as campaign work
     * whatever route composed it. Only when there is no campaign does the
     * caller's context decide — and that context is a second argument no
     * request body can reach.
     */
    origin: verifiedCampaign ? OUTREACH_ORIGIN.CAMPAIGN : normaliseOrigin(origin),
    // A body exists and may still be rewritten in place. Nothing has been
    // handed to a transport by the time this is written.
    state: MESSAGE_STATE.DRAFT,
    accepted_source: null,
    policy_version: snapshot.policy_version,
    structure: snapshot.structure,
    structure_source: snapshot.structure_source,
    body_source: snapshot.body_source,
    template_variant: snapshot.template_variant,
    has_personalisation: snapshot.has_personalisation ? 1 : 0,
    primary_kind: snapshot.primary_kind,
    primary_role: snapshot.primary_role,
    hook_kind: snapshot.hook_kind,
    rendered_kinds: snapshot.rendered_kinds,
    rendered_roles: snapshot.rendered_roles,
    rendered_count: snapshot.rendered_count,
    subject: snapshot.subject,
    body_hash: snapshot.body_hash,
    payload: JSON.stringify(snapshot.payload),
    created_at: open?.created_at ?? at,
  };
  if (open) {
    // Replaces the draft in Outlook, and only ever a draft: the WHERE clause
    // cannot reach a confirmed row.
    db.prepare(`
      UPDATE outreach_send SET
        drafted_at = @drafted_at, policy_version = @policy_version,
        structure = @structure, structure_source = @structure_source,
        body_source = @body_source, template_variant = @template_variant,
        has_personalisation = @has_personalisation, primary_kind = @primary_kind,
        primary_role = @primary_role, hook_kind = @hook_kind,
        rendered_kinds = @rendered_kinds, rendered_roles = @rendered_roles,
        rendered_count = @rendered_count, subject = @subject,
        body_hash = @body_hash, payload = @payload,
        college_name = @college_name, sport = @sport,
        -- Moves with the body. Re-drafting to the same coach under a different
        -- campaign replaces the pending message, and the row must not keep the
        -- previous campaign's attribution while carrying the new one's text.
        programme_campaign_id = @programme_campaign_id
      -- The guard is the STATE. An accepted message is history and no re-draft
      -- may reach it. The old guard on sent_at said the same thing, until a
      -- message could be QUEUED or FAILED without a timestamp of any kind.
      -- (No backticks in here: this SQL is a JS template literal.)
      WHERE id = @id AND state = 'DRAFT'
    `).run(row);
  } else {
    insertSend.run(row);
  }
  return { id: row.id, sequence: row.sequence };
}

/* -------------------------------------------------------------------------- */
/* Message state — the one place it changes                                    */
/* -------------------------------------------------------------------------- */

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const SEND_BY_ID = db.prepare('SELECT * FROM outreach_send WHERE id = ?');

/**
 * THE ONLY WRITER OF `outreach_send.state`.
 *
 * Scattering `UPDATE outreach_send SET state = ...` across routes and scripts
 * is how a transition table stops describing anything, so there is one door and
 * the graph in shared/outreachMessageState.js is the rule behind it.
 *
 * SAME-STATE IS A NO-OP THAT WRITES NOTHING, following `suppress()`,
 * `createOutreach` and `markOutreachSent` — and here it matters more than
 * anywhere else: re-confirming a batch must not move the timestamp that dates
 * an acceptance out of an engagement window. Returns `changed: false`.
 *
 * IT SAYS NOTHING ABOUT DELIVERY. `ACCEPTED` records that a transport or a
 * person told us the message was accepted for sending. Whether it reached an
 * inbox is not knowable here and is not claimed anywhere.
 */
export function transitionSend(sendId, nextState, { acceptedSource = null, at = utcNow() } = {}) {
  if (!isMessageState(nextState)) {
    throw fail('INVALID_MESSAGE_STATE', `Unknown message state "${nextState}"`);
  }
  const row = SEND_BY_ID.get(sendId);
  if (!row) throw fail('SEND_NOT_FOUND', `No outreach_send ${sendId}`);

  if (row.state === nextState) return { ...parse(row), changed: false };

  if (!canTransition(row.state, nextState)) {
    throw fail(
      'ILLEGAL_MESSAGE_TRANSITION',
      `A message cannot go from ${row.state} to ${nextState}`
      + (LEGAL_TRANSITIONS[row.state]?.length
        ? ` (allowed: ${LEGAL_TRANSITIONS[row.state].join(', ')})`
        : ` — ${row.state} is terminal`),
    );
  }

  if (nextState === MESSAGE_STATE.ACCEPTED) {
    if (!Object.hasOwn(ACCEPTED_SOURCE, String(acceptedSource))) {
      throw fail(
        'ACCEPTED_SOURCE_REQUIRED',
        'Accepting a message needs to say how we know — one of: '
        + `${Object.keys(ACCEPTED_SOURCE).join(', ')}. An acceptance whose evidence is `
        + 'unrecorded cannot be told apart from a provider-confirmed one later.',
      );
    }
    /**
     * `sent_at` is stamped here for compatibility and nothing else. Every
     * denominator in this system reads it — evidence performance, reply rates,
     * the per-inbox cap — and B2 does not move them; it makes `state` the
     * authority beside them.
     */
    db.prepare(`
      UPDATE outreach_send SET state = ?, accepted_source = ?, sent_at = COALESCE(sent_at, ?)
      WHERE id = ? AND state != 'ACCEPTED'
    `).run(nextState, acceptedSource, at, sendId);
  } else {
    db.prepare('UPDATE outreach_send SET state = ? WHERE id = ?').run(nextState, sendId);
  }

  return { ...parse(SEND_BY_ID.get(sendId)), changed: true };
}

/**
 * ACCEPT ONE SPECIFIC MESSAGE. The message-scoped operation B1 found missing.
 *
 * Confirmation used to be reachable only through the relationship, and
 * `confirmSends.pendingDrafts` filtered on `outreach.sent_at IS NULL` — so once
 * a first message was confirmed the relationship looked settled for ever and a
 * follow-up could never be confirmed by anything. That defect is why this takes
 * a SEND id.
 *
 * Idempotent rather than an error: a batch re-confirmed by a cautious operator
 * is a normal thing to do, and the first acceptance keeps its timestamp and its
 * source. Returns `changed: false`.
 */
export function acceptSend(sendId, { source = ACCEPTED_SOURCE.OPERATOR_ASSERTED, at = utcNow() } = {}) {
  return transitionSend(sendId, MESSAGE_STATE.ACCEPTED, { acceptedSource: source, at });
}

/**
 * Accept whichever message is open on this relationship.
 *
 * Kept because two callers reach acceptance from a relationship — the Outlook
 * send path, which has just drafted through it, and the batch confirmation
 * tool. It is a CONVENIENCE over `acceptSend`, not a second authority: it
 * resolves the open message by STATE and delegates. There is at most one, and
 * since B2 that is a database guarantee.
 *
 * Returns null when nothing is open — the honest answer for a relationship
 * drafted before `outreach_send` existed, of which there are 55 on file.
 */
export function confirmSend(outreachId, at = utcNow(), { source = ACCEPTED_SOURCE.OPERATOR_ASSERTED } = {}) {
  const open = pendingFor.get(outreachId);
  if (!open) return null;
  const out = acceptSend(open.id, { source, at });
  return { id: out.id, sequence: out.sequence, sent_at: out.sent_at, state: out.state };
}

/* -------------------------------------------------------------------------- */
/* Observations — append-only, and empty in this build                         */
/* -------------------------------------------------------------------------- */

/**
 * Record something we LEARNED about a message.
 *
 * Not a state change. A bounce arriving next week does not un-accept a message
 * we accepted, and a reply does not either — which is exactly why these are
 * rows in their own table rather than a column that the last writer wins.
 *
 * NOTHING IN THIS BUILD CALLS THIS WITH A BOUNCE, REPLY, COMPLAINT OR OPT_OUT.
 * The vocabulary exists so ingestion has somewhere to land; producing one of
 * those today would mean claiming an observation nobody made.
 */
export function appendSendEvent({
  sendId, type, source, confidence = null, observedAt = null, payload = null, at = utcNow(),
}) {
  if (!isSendEventType(type)) {
    throw fail('UNKNOWN_SEND_EVENT_TYPE',
      `Unknown send event type "${type}". A new observation needs a name in `
      + 'shared/outreachMessageState.js before it can be recorded.');
  }
  if (typeof source !== 'string' || !source.trim()) {
    throw fail('SEND_EVENT_SOURCE_REQUIRED',
      'An observation must say where it came from; an unattributed one cannot be weighed.');
  }
  if (!SEND_BY_ID.get(sendId)) throw fail('SEND_NOT_FOUND', `No outreach_send ${sendId}`);

  let serialised = null;
  if (payload !== null && payload !== undefined) {
    try {
      serialised = JSON.stringify(payload);
      if (serialised === undefined) throw new Error('not serialisable');
    } catch {
      throw fail('SEND_EVENT_PAYLOAD_INVALID',
        'An observation payload must be JSON-serialisable. Storing "[object Object]" '
        + 'would make the observation unreadable exactly when somebody needed it.');
    }
  }

  const row = {
    id: randomUUID(),
    outreach_send_id: sendId,
    type,
    source: source.trim(),
    confidence,
    // When it HAPPENED, defaulting to when we heard. The two differ for
    // anything ingested later and a window keyed on the wrong one is wrong.
    observed_at: observedAt ?? at,
    created_at: at,
    payload: serialised,
  };
  db.prepare(`
    INSERT INTO outreach_send_event
      (id, outreach_send_id, type, source, confidence, observed_at, created_at, payload)
    VALUES (@id, @outreach_send_id, @type, @source, @confidence, @observed_at, @created_at, @payload)
  `).run(row);
  return { ...row, payload };
}

/**
 * Everything observed about one message, oldest first.
 *
 * Ordered by `observed_at` then `id`, which is total: two observations sharing
 * a timestamp still come back in a fixed order rather than whatever the page
 * order happens to be.
 */
export function sendEvents(sendId) {
  return db.prepare(`
    SELECT * FROM outreach_send_event WHERE outreach_send_id = ?
    ORDER BY observed_at, id
  `).all(sendId).map((r) => ({ ...r, payload: safeParse(r.payload) }));
}

/* -------------------------------------------------------------------------- */
/* The analytics read boundary                                                 */
/* -------------------------------------------------------------------------- */


/**
 * Confirmed sends, with the relationship they belong to.
 *
 * THE ONLY PATH ANALYTICS MAY TAKE, and it reads stored columns. It does not
 * import `evidenceFor`, `outreachEvidenceFor` or `outreachCopyFor`, and a test
 * asserts that it never will: the moment a historical decision can be rebuilt
 * from today's data, it will be — and today's data says something else. The
 * stored sentence reads "you've got three defenders graduating in 2027"; the
 * same programme re-rendered now says "three defenders are listed to graduate
 * in 2027". Re-rendering would fabricate an email nobody received.
 *
 * `policyVersion` defaults to nothing so a caller must decide. Pooling P2 with
 * LEGACY_UNKNOWN is averaging two products; the filter makes that a choice
 * rather than an accident.
 */
export function confirmedSends({ policyVersion = null, athleteId = null, sport = null } = {}) {
  return db.prepare(`
    SELECT s.*, o.token, o.match_id, c.email AS coach_email, c.position_title AS coach_title
    FROM outreach_send s
    JOIN outreach o ON o.id = s.outreach_id
    LEFT JOIN coaches c ON c.id = s.coach_id
    WHERE s.sent_at IS NOT NULL
      AND (@policyVersion IS NULL OR s.policy_version = @policyVersion)
      AND (@athleteId IS NULL OR s.athlete_id = @athleteId)
      AND (@sport IS NULL OR s.sport = @sport)
    ORDER BY s.sent_at, s.id
  `).all({ policyVersion, athleteId, sport }).map(parse);
}

/** Every send for one relationship, initial first. For a drilldown, later. */
export function sendsForOutreach(outreachId) {
  return db.prepare('SELECT * FROM outreach_send WHERE outreach_id = ? ORDER BY sequence')
    .all(outreachId).map(parse);
}

/** One send by its own id. */
export function sendById(id) {
  return parse(db.prepare('SELECT * FROM outreach_send WHERE id = ?').get(id));
}

/**
 * How many confirmed sends we hold under each policy.
 *
 * The first thing any future analysis must look at: LEGACY_UNKNOWN rows record
 * a product that no longer exists and may not be pooled with P2.
 */
export function sendsByPolicy() {
  return db.prepare(`
    SELECT policy_version,
           COUNT(*) AS sends,
           SUM(CASE WHEN payload IS NOT NULL THEN 1 ELSE 0 END) AS with_snapshot,
           SUM(CASE WHEN has_personalisation = 1 THEN 1 ELSE 0 END) AS personalised
    FROM outreach_send WHERE sent_at IS NOT NULL
    GROUP BY policy_version ORDER BY sends DESC
  `).all();
}

export { LEGACY_POLICY_VERSION };

/**
 * Every send made under one programme campaign, in the order they happened.
 *
 * THE question A6 exists to make answerable, and it reads the per-message
 * column rather than the relationship's. A campaign that reused a relationship
 * opened by an earlier campaign appears here for its own messages and not for
 * the earlier one's — which is the whole distinction between the two columns.
 *
 * `sentOnly` because a draft is not a send: every denominator in this system
 * keys on `sent_at IS NOT NULL`, and a caller counting drafts as sends would
 * reintroduce the overstatement `outreach_send` was built to remove.
 */
export function sendsForProgrammeCampaign(programmeCampaignId, { sentOnly = false } = {}) {
  // All-named binding: mixing `?` with `@name` in one statement is legal and
  // reads as though the two are related, which they are not.
  return db.prepare(`
    SELECT * FROM outreach_send
    WHERE programme_campaign_id = @programmeCampaignId
      AND (@sentOnly = 0 OR sent_at IS NOT NULL)
    ORDER BY COALESCE(sent_at, drafted_at, created_at), id
  `).all({ programmeCampaignId, sentOnly: sentOnly ? 1 : 0 }).map(parse);
}
