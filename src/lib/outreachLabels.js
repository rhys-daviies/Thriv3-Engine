/**
 * THE TWO WAYS TO WRITE TO A COACH, NAMED SO AN OPERATOR CAN TELL THEM APART.
 *
 * Both paths compose an email by hand and both are legitimate, so the word
 * that distinguishes them cannot be "manual" — the operator types the message
 * either way, and "manual as opposed to what?" is the question that label
 * invites. What actually differs is WHY this programme is being written to:
 *
 *   RECOMMENDATION   the model ranked it, and the email is composed from that
 *                    match. Nothing is on record about this athlete and this
 *                    school beyond the ranking.
 *
 *   RELATIONSHIP     something is on record — a school the family asked for, a
 *                    coach we already know, an operator note, a contact rule —
 *                    and the composer is scoped to that record.
 *
 * So the distinguishing word comes first and answers "why", not "how".
 *
 * ---------------------------------------------------------------------------
 * THE UI VOCABULARY IS NOT THE SCHEMA VOCABULARY, deliberately. The route, the
 * dialog component and `outreach_send.origin = 'manual'` all keep the word
 * manual, because there it records PROVENANCE — a person composed and approved
 * this — which is exactly the right word for a database column and the wrong
 * one for a button competing with another button a person also presses.
 *
 * One constant, so the three surfaces that offer it cannot drift apart and
 * changing the wording is one line rather than four.
 */

/** The action, on a relationship surface. */
export const RELATIONSHIP_OUTREACH = 'Relationship Outreach';

/** The action, on a ranked match card. Unchanged; operators know it. */
export const RECOMMENDATION_OUTREACH = 'Email Coaches';

/**
 * One line, shown only where both actions are reachable at once — the expanded
 * body of a card that also has a relationship. Everywhere else the surface
 * already says which kind of thing it is, and a sentence repeating that on
 * every card is noise.
 */
export const BOTH_PATHS_HINT =
  'Composes from this match. Use Relationship Outreach to write using what is on '
  + 'record for this school — its notes, flags and contact settings.';

/** Read under the dialog title, so the two composers are not mistaken after opening. */
export const RECOMMENDATION_DIALOG_HINT = 'Composed from this match recommendation.';
export const RELATIONSHIP_DIALOG_HINT =
  'Composed from what is on record for this school with this athlete.';

/**
 * `manual_only` — AND IT IS NOW ENFORCED, SO IT MAY SAY SO.
 *
 * This wording used to hedge: it said what an operator SHOULD do rather than
 * what the product WOULD do, because when it was written campaign execution
 * did not consult the column and promising a guard that did not exist would
 * have been believed. F6a made `campaignStanceDecision` refuse
 * RELATIONSHIP_MANUAL_ONLY at the one chokepoint every campaign write passes
 * through, and F11b's execution decision reads the same authority. The
 * enforcement is real, so the sentence is now a statement of fact.
 *
 * BOTH HALVES ARE SAID, because only one of them is a restriction. An operator
 * who reads "won't be contacted" and stops there will not discover that the
 * school is still theirs to write to by hand, which is the entire point of
 * this stance rather than the stronger one.
 */
export const MANUAL_ONLY_HINT =
  'This school won\'t be contacted by the automated campaign. You can still contact it manually.';

/** The badge, kept short — the sentence above carries the explanation. */
export const MANUAL_ONLY_BADGE = 'Manual outreach only';

/**
 * THE TWO CONTACT-POLICY ACTIONS, AND WHY NEITHER MENTIONS HISTORY.
 *
 * "We've already been in touch" states a fact the operator knows and the
 * database may not — contact that happened outside Thriv3 leaves no row here,
 * and that case is the reason the stance is stored rather than derived.
 *
 * Its opposite is emphatically NOT "not previously contacted". History does
 * not un-happen, and an operator changing a policy must not be made to assert
 * something false to do it. `contact_stance` is CURRENT POLICY; the messages
 * in `outreach` are the history, and they stay exactly as they are either way.
 */
export const ALREADY_IN_TOUCH = 'We\'ve already been in touch';
export const ALLOW_CAMPAIGN_OUTREACH = 'Allow campaign outreach';

/**
 * The flag the "already in touch" button installs ALONGSIDE the stance.
 *
 * TWO MUTATIONS, NOT ONE, and the client makes both explicitly. A flag is a
 * fact about the world and a stance is a contact policy; `establishManualOnly`
 * on the server touches only the second and must never infer the first. What
 * an operator may do in one click, a domain function may not do behind one.
 *
 * It is NEVER written over an existing reason. "Her father is an alum" is
 * context somebody took the trouble to record, and replacing it with this
 * would destroy the more informative of the two.
 */
export const ALREADY_IN_TOUCH_FLAG_REASON = 'Already in contact with this school';

/**
 * `do_not_contact` — AND WHAT WILL NOT LIFT IT.
 *
 * The two neighbouring controls an operator would reach for are visibility and
 * the flag, and neither touches this. Saying so is the difference between a
 * refusal somebody works around and one they understand.
 */
export const DO_NOT_CONTACT_TITLE = 'This programme is set to do-not-contact for this athlete.';
export const DO_NOT_CONTACT_BODY =
  'Nothing can be drafted or sent while that stands, from here or anywhere else. '
  + 'Restoring it to the Top 100 or clearing its flag will not change it — the contact '
  + 'stance is a separate setting on the relationship.';


/**
 * HOW A PAST MESSAGE'S PROVENANCE IS WORDED.
 *
 * `null` is the honest record for every row written before the column existed,
 * and would be the record for any future path that forgot to classify itself.
 * "Historical" was the other candidate and was rejected: it asserts AGE, which
 * is true of today's null rows and would quietly become false the first time a
 * new path produced one. "Origin not recorded" stays true in both cases and
 * says exactly what is known — nothing.
 */
export const ORIGIN_LABEL = Object.freeze({
  manual: 'Relationship or manual outreach',
  campaign: 'Campaign outreach',
});

export const ORIGIN_UNRECORDED = 'origin not recorded';


/**
 * WHAT THIS PRODUCT CAN HONESTLY SAY A COACH DID.
 *
 * NOT "opened" and NOT "clicked". There is no email pixel and no email click
 * tracking — what exists is a PROFILE VISIT, recorded when the coach follows
 * their own tracked link and the athlete's page qualifies. That is a stronger
 * signal than an open, and calling it an open would be both wrong and weaker.
 *
 * `visit_start` is deliberately non-qualifying in the collector because it is
 * exactly what a Safe Links scanner produces, and the rollup collapses
 * sessions into visits — so a visit count is neither raw events nor scanner
 * noise, which is why a number is safe to show here at all.
 *
 * A REPLY IS ONLY EVER OPERATOR-RECORDED. Nothing ingests replies and nothing
 * classifies them; a person sets it. The wording says so rather than implying
 * the system observed it.
 */
export const ACTIVITY_LABEL = Object.freeze({
  reply: 'Reply recorded',
  /**
   * "Profile visit recorded", NOT "opened profile" and certainly not "the
   * coach viewed it".
   *
   * What the token proves is that the athlete's page was visited THROUGH THIS
   * OUTREACH LINK. It does not prove who was holding the link: a coach
   * forwards a promising recruit to an assistant, or to a recruiting
   * coordinator, and the visit is attributed to the addressee either way.
   * Naming the person would be an inference the data does not support, and it
   * is the kind that reads as certainty.
   */
  profile_visit: 'Profile visit recorded',
  confirmed_send: 'Sent',
  draft: 'Drafted',
});

export const ENGAGEMENT_HINT = Object.freeze({
  profile_visit: 'A qualified visit to the athlete profile was recorded through this '
    + 'outreach link. Scanner-only page loads are excluded and repeat sessions count '
    + 'as one visit. The link may have been forwarded, so this does not identify who visited.',
  reply: 'Recorded by an operator. Nothing in this build reads replies automatically.',
});

/**
 * UNKNOWN IS NOT THE SAME AS NONE, AND IT IS SAID ONCE, AT THE PAGE.
 *
 * One athlete-level request feeds every card, so its failure is a fact about
 * the page and not about any programme on it. Repeated per card it would be
 * the same sentence twenty times, each copy reading as a statement about the
 * school it sat under \u2014 twenty programmes looking individually broken
 * because one request failed.
 *
 * While this notice stands, cards show no contact intelligence at all. Showing
 * nothing is only honest because this sentence is on screen saying why.
 */
export const CONTACT_UNAVAILABLE_NOTICE =
  'Contact history unavailable. Some prior outreach information may be missing.';

/** Said where a programme has been written to but nothing was ever confirmed. */
export const DRAFT_ONLY_HINT = 'A message was drafted and never confirmed sent.';

/**
 * NOTHING ON FILE — AND ONLY EVER SAID WHEN THAT IS ACTUALLY KNOWN.
 *
 * ===========================================================================
 * UNKNOWN IS NOT NONE, AND THIS IS THE SENTENCE THAT COULD GET IT WRONG.
 *
 * Every other string in this file describes something that happened. This one
 * describes an ABSENCE, which is the only kind of claim that can be false
 * merely because a request had not finished. While the athlete-level history
 * is loading, or failed, the honest answer is silence — see
 * CONTACT_UNAVAILABLE_NOTICE above, which is the page-level sentence that
 * explains the silence.
 *
 * `ProgrammeContactSummary` therefore renders this only when the history
 * LOADED and the programme is genuinely absent from it. A programme nobody has
 * written to is absent from the map rather than present and empty, so absence
 * is the fact — once, and only once, the map is known to be complete.
 * ===========================================================================
 *
 * IT MATTERS MOST BESIDE `manual_only`. F5b made "We've already been in touch"
 * an explicit operator statement that establishes CURRENT CONTACT POLICY
 * without fabricating a send — so a school can legitimately be worked by hand
 * with nothing in `outreach` to show for it. Those two facts side by side are
 * the point: the policy is ours, the history is the database's, and neither
 * implies the other.
 */
export const NO_CONTACT_RECORDED = 'No contact recorded';
export const NO_CONTACT_RECORDED_HINT =
  'Nothing has been drafted or sent to this programme through Thriv3 for this athlete. '
  + 'Contact made outside Thriv3 leaves no record here.';

/**
 * WHAT THE COACH DID WITH THE VIDEO, AS A PERCENTAGE AND NOTHING MORE.
 *
 * Worded identically to the per-coach line in ManualOutreachDialog, because
 * the same fact appearing two ways on two surfaces is how an operator comes to
 * believe they are two facts. Coverage is the highest any single session
 * reached — `best_coverage_pct` on the rollup — so it is "watched N%", never a
 * total across visits.
 *
 * NOT an email open and not a click. Neither exists in this build.
 */
export const videoWatched = (pct) => `Watched ${pct}% of the video`;

export const VIDEO_HINT =
  'The furthest through the highlight video any single viewing session reached, '
  + 'recorded on the athlete profile rather than in the email.';

/**
 * WHICH PART OF THE PRODUCT WROTE TO THEM, IN THE SHORT FORM A BADGE CAN HOLD.
 *
 * ORIGIN_LABEL above is the sentence form used in the relationship dialog,
 * where there is room for it. This is the same vocabulary compressed for a
 * list row, and it is deliberately a SEPARATE map rather than a truncation:
 * "Relationship or manual outreach" cannot be shortened mechanically without
 * losing which of the two it was.
 *
 * NULL IS NOT IN THIS MAP. It is not a value in the origin vocabulary — it is
 * the absence of one — so it is rendered through ORIGIN_UNRECORDED_SHORT and
 * never guessed at. A message written before the column existed records no
 * provenance, and inventing one would be exactly the fabrication the column
 * was added to prevent.
 */
export const ORIGIN_SHORT = Object.freeze({
  manual: 'Manual',
  campaign: 'Campaign',
});

export const ORIGIN_UNRECORDED_SHORT = 'Origin not recorded';

/** Said where several coaches at one programme have been written to. */
export const moreCoaches = (n) => `+${n} more`;
