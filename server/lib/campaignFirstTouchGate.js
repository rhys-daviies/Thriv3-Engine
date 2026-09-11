import { programmePursuitPlan, PURSUIT_ACTION } from './pursuitPolicy.js';

/**
 * A CAMPAIGN-ATTRIBUTED SEND OBEYS THE SAME FIRST-TOUCH REVIEW AS A CAMPAIGN.
 *
 * F6d held the automated path: the pursuit plan withholds a campaign's first
 * approach to somebody the athlete has already written to, and
 * `materialiseNextContactAttempt` refuses to record the intent. What it did not
 * hold was the OTHER way a campaign-attributed row gets written — an operator
 * posting to the send route with a programme campaign id, which reaches
 * `createOutreach` and `recordDraft` directly.
 *
 * ---------------------------------------------------------------------------
 * A PERSON PRESSING SEND IS NOT THE APPROVAL.
 *
 * That is the whole of it. The durable approval exists because somebody has to
 * look at the prior contact and say so, ON THE RECORD, against the history that
 * was on file at the time. Treating the click as the review would make the
 * approval table decorative: the hold would be clearable by doing the thing the
 * hold exists to prevent, and nothing afterwards could tell whether anybody had
 * looked.
 *
 * So operator presence proves nothing here, and neither does the composer
 * having shown the history, nor `origin: 'manual'`, nor anything a request
 * says. ORIGIN IS PROVENANCE — a record of what kind of action this was.
 * VERIFIED CAMPAIGN ATTRIBUTION IS AUTHORITY, and it is the only thing that
 * brings a send under campaign policy.
 * ---------------------------------------------------------------------------
 *
 * IT IS THE SAME DERIVATION, NOT A SECOND ONE. The plan answers what this
 * campaign would do next, whether prior contact exists and whether a current
 * approval clears it — so the send route, the dry run and the materialiser all
 * hold on exactly the same fact, and an approval that is current for one is
 * current for all three.
 */

/** Reused from F6d rather than invented: one hold, one name for it. */
export const FIRST_TOUCH_REVIEW_REQUIRED = 'CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED';

/**
 * Refuse a campaign-attributed write whose first touch has not been reviewed.
 *
 * CALLED WITH A VERIFIED ID AND NOTHING ELSE. Every caller passes the value
 * `authorisedProgrammeCampaignId` just returned, which has already proved the
 * campaign exists, belongs to this athlete, and is for this coach's programme
 * and sport. A campaign id a client made up never reaches this — it was
 * refused upstream — so nothing here can be invoked, or cleared, by a caller
 * naming a campaign that is not theirs.
 *
 * NULL IS THE MANUAL PATH AND IS NOT GATED. Relationship Outreach, Email
 * Coaches, the manual route and the drafting CLI all pass no campaign, so they
 * return immediately: this rule is about campaign work, and a person writing by
 * hand to somebody they have written to before is the workflow the product is
 * for rather than a thing to stop.
 *
 * ONLY AN INITIAL APPROACH IS HELD. A follow-up inside the same campaign has
 * prior contact by construction — the campaign created it — so holding one
 * would stop every second message on evidence of its own first.
 *
 * @param {string|null} args.programmeCampaignId the VERIFIED id, or null.
 * @throws {Error} with `code = CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED`.
 */
export function assertFirstTouchReviewed({ programmeCampaignId, coachId }) {
  if (!programmeCampaignId) return null;

  const plan = programmePursuitPlan({ programmeCampaignId });

  /**
   * ONLY THE COACH THIS CAMPAIGN IS ACTUALLY APPROACHING. The plan names one
   * current coach and derives the review for them; a send to anybody else at
   * the programme is not the first touch the hold is about, and refusing it
   * here would be this module inventing a rule of its own.
   */
  if (plan.current?.coachId !== coachId) return null;
  if (plan.nextAction !== PURSUIT_ACTION.INITIAL_OUTREACH) return null;
  if (!plan.firstTouchReview?.required) return null;

  const err = new Error(
    `${plan.programmeCampaign.collegeName} (${plan.programmeCampaign.sport}): this athlete has `
    + 'already had confirmed outreach to this coach, so a campaign message would read as a first '
    + 'introduction to somebody who has heard from them before. '
    + (plan.firstTouchReview.approval?.status === 'stale'
      ? 'The earlier review no longer matches what is on file — something has been sent since it '
        + 'was given. Review the contact history again and approve it.'
      : 'Review the contact history and approve the first touch, or send it from Relationship '
        + 'Outreach instead.'),
  );
  err.code = FIRST_TOUCH_REVIEW_REQUIRED;
  err.reason = plan.firstTouchReview.reason;
  err.approvalStatus = plan.firstTouchReview.approval?.status ?? 'none';
  throw err;
}
