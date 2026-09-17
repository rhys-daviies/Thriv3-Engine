import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';

/**
 * "I HAVE SEEN THAT THIS ATHLETE ALREADY WROTE TO THIS COACH."
 *
 * The durable half of F6d. The pursuit plan withholds a campaign's first
 * approach to somebody with prior confirmed contact; this is where a person
 * recording that they have looked is kept, because a review state that lives
 * in a response object is one refresh away from never having happened.
 *
 * ---------------------------------------------------------------------------
 * AN APPROVAL DESCRIBES THE HISTORY IT WAS GIVEN, AND EXPIRES WHEN THAT
 * CHANGES.
 *
 * The operator approved a specific thing: "this coach has had two messages,
 * the last on 20 August, and I am content for the campaign to write again".
 * If a third message is recorded afterwards, that sentence is no longer true
 * of what is on file — so the snapshot is compared rather than trusted, and an
 * approval that no longer matches goes STALE and the hold returns on its own.
 *
 * Nothing refreshes a snapshot quietly. Re-approving is a new deliberate act
 * by a person looking at the new history, and it replaces the row.
 * ---------------------------------------------------------------------------
 *
 * IT CLEARS ONE HOLD. Do-not-contact, manual-only, suppression, revocation, a
 * stopped programme and a closed campaign are all evaluated elsewhere and none
 * of them is touched by an approval. Approving a first touch says a person has
 * seen the history; it does not say anybody may send.
 */

/**
 * WHERE AN APPROVAL STANDS. Three states, and the middle one is the reason the
 * snapshot columns exist at all.
 *
 *   NONE     nobody has reviewed this coach for this campaign
 *   CURRENT  reviewed, and the history still matches what was reviewed
 *   STALE    reviewed, and something has been sent since
 */
export const APPROVAL_STATUS = Object.freeze({
  NONE: 'none',
  CURRENT: 'current',
  STALE: 'stale',
});

const BY_PAIR = db.prepare(`
  SELECT * FROM campaign_first_touch_approvals
   WHERE programme_campaign_id = @programmeCampaignId AND coach_id = @coachId
`);

const UPSERT = db.prepare(`
  INSERT INTO campaign_first_touch_approvals (
    id, programme_campaign_id, coach_id, approved_by_operator_id, approved_at,
    reviewed_confirmed_send_count, reviewed_last_confirmed_send_at
  ) VALUES (
    @id, @programmeCampaignId, @coachId, @operatorId, @at,
    @reviewedCount, @reviewedLastAt
  )
  ON CONFLICT (programme_campaign_id, coach_id) DO UPDATE SET
    approved_by_operator_id = excluded.approved_by_operator_id,
    approved_at = excluded.approved_at,
    reviewed_confirmed_send_count = excluded.reviewed_confirmed_send_count,
    reviewed_last_confirmed_send_at = excluded.reviewed_last_confirmed_send_at
`);

/** Nothing reviewed. Returned rather than null so callers never branch on shape. */
const NO_APPROVAL = Object.freeze({
  status: APPROVAL_STATUS.NONE,
  approvedAt: null,
  approvedByOperatorId: null,
});

/**
 * DOES THE APPROVAL STILL DESCRIBE WHAT IS ON FILE?
 *
 * Both halves are compared because either can move on its own: a second send
 * on the same day changes the count and not the timestamp, and a re-sent
 * message can change the timestamp without the operator having seen it.
 *
 * `hasConfirmedSend` is NOT part of the comparison and must not be — a legacy
 * relationship reports a count of zero beside a confirmed send, and an
 * approval over zero is as real as any other. Existence is what put the review
 * there; these two columns are what keep it honest afterwards.
 */
function matches(row, priorContact) {
  return row.reviewed_confirmed_send_count === priorContact.confirmedSendCount
    && (row.reviewed_last_confirmed_send_at ?? null)
      === (priorContact.lastConfirmedSendAt ?? null);
}

/**
 * Where the review of this coach, for this campaign, stands right now.
 *
 * ONE INDEXED POINT LOOKUP, on the pair the UNIQUE constraint already indexes.
 * It reads no history of its own: the facts are the ones the plan already
 * loaded, passed in, so asking about an approval costs nothing but this row.
 *
 * @param {object} args.priorContact the F6c fact, as it is on the plan.
 * @returns {{status: string, approvedAt: string|null, approvedByOperatorId: string|null}}
 */
export function approvalStatus({ programmeCampaignId, coachId, priorContact }) {
  if (!programmeCampaignId || !coachId) return NO_APPROVAL;
  const row = BY_PAIR.get({ programmeCampaignId, coachId });
  if (!row) return NO_APPROVAL;
  return {
    status: matches(row, priorContact ?? {})
      ? APPROVAL_STATUS.CURRENT
      : APPROVAL_STATUS.STALE,
    approvedAt: row.approved_at,
    approvedByOperatorId: row.approved_by_operator_id,
  };
}

/** The stored row, for a caller that needs to report it back verbatim. */
export function existingApproval({ programmeCampaignId, coachId }) {
  return BY_PAIR.get({ programmeCampaignId, coachId }) ?? null;
}

/**
 * Record that a person has reviewed this coach's prior contact.
 *
 * THE SNAPSHOT IS THE SERVER'S, NEVER THE CALLER'S. `priorContact` is derived
 * from the database by the caller's own read of the pursuit plan, and the
 * operator id comes from the session — a request body reaches neither, which
 * is what stops an approval being minted for history nobody looked at.
 *
 * UPSERT rather than insert: re-approving a stale review replaces the row, so
 * one decision is in force per coach per campaign. A review that is still
 * CURRENT is not rewritten at all — the route returns it unchanged, so a
 * second click cannot reattribute somebody else's decision.
 */
export function approveFirstTouch({
  programmeCampaignId, coachId, operatorId, priorContact, at = utcNow(),
}) {
  UPSERT.run({
    id: randomUUID(),
    programmeCampaignId,
    coachId,
    operatorId,
    at,
    reviewedCount: priorContact.confirmedSendCount,
    reviewedLastAt: priorContact.lastConfirmedSendAt ?? null,
  });
  return BY_PAIR.get({ programmeCampaignId, coachId });
}
