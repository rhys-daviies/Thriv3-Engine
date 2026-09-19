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

/**
 * THE ACTION, ON A RELATIONSHIP SURFACE — RENAMED IN F8b.
 *
 * ===========================================================================
 * IT NAMES THE ARTEFACT NOW, BECAUSE SINCE F7b THAT IS ALL IT CAN PRODUCE.
 *
 * "Relationship Outreach" named the SYSTEM's concept — the relationship-scoped
 * route as distinct from the recommendation-scoped one — and carried no verb
 * at all. F7b narrowed what the button does to exactly one thing: a draft
 * appears in Outlook and nothing is sent, whatever the operator asks for. A
 * label with no verb, on a button whose whole contract is that ceiling, was
 * under-describing a guarantee that cost a slice to build.
 *
 * "Contact Coach" was rejected for implying contact occurs, which is the one
 * thing this button does not do.
 * ===========================================================================
 *
 * ONE VALUE ACROSS ALL THREE SURFACES — Specific Schools, the match-card
 * relationship footer, and the removed-from-Top-100 panel — plus the dialog
 * title. Forking it to spare the Top 100 the knock-on would leave two names
 * for one action, which is the problem the single constant exists to prevent.
 */
export const CREATE_EMAIL_DRAFT = 'Create email draft';

/** The action, on a ranked match card. Unchanged; operators know it. */
export const RECOMMENDATION_OUTREACH = 'Email Coaches';

/**
 * One line, shown only where both actions are reachable at once — the expanded
 * body of a card that also has a relationship. Everywhere else the surface
 * already says which kind of thing it is, and a sentence repeating that on
 * every card is noise.
 */
export const BOTH_PATHS_HINT =
  `Composes from this match. Use "${CREATE_EMAIL_DRAFT}" to write using what is on `
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
 * THE CONSEQUENCE, SAID BEFORE THE CLICK RATHER THAN AFTER IT — F8b.
 *
 * The label states a fact about the world; the button's effect is a CONTACT
 * POLICY, and until F8b nothing visible connected the two. An operator read
 * "We've already been in touch", pressed it because it was true, and only then
 * discovered — from `MANUAL_ONLY_HINT`, which renders afterwards — what it had
 * decided on their behalf.
 *
 * BOTH HALVES, for the same reason `MANUAL_ONLY_HINT` says both: the half that
 * restricts and the half that does not. An operator who reads only "stops
 * outreach" will not discover the school is still theirs to write to by hand.
 *
 * IT DOES NOT MENTION SENDING. "Mark as sent" is the other thing on this
 * screen an operator might read as "yes, we contacted them", and the two are
 * one row apart. This one asserts that a RELATIONSHIP exists; that one asserts
 * that ONE SPECIFIC DRAFTED MESSAGE left the operator's machine. No wording
 * here may blur them.
 */
export const ALREADY_IN_TOUCH_HINT =
  'Records that contact already exists and stops automated Campaign outreach to this '
  + 'school. Manual outreach is still allowed.';

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

/**
 * WHAT HAPPENS AFTER THRIV3 OPENS THE DRAFT — F7b.
 *
 * ===========================================================================
 * THE HANDOVER IS THE MOMENT WORTH BEING HONEST ABOUT.
 *
 * Thriv3 hands the message to Outlook over AppleScript and receives nothing
 * back it could use later — no message id, no draft handle, no callback. From
 * that instant the draft belongs to the operator and to Outlook, and this
 * system cannot see it, cannot change it and cannot stop it.
 *
 * Two consequences the operator has to be told, once, plainly:
 *
 *   IT WILL NOT KNOW WHEN YOU PRESS SEND. Nothing is recorded as contact until
 *   a person says so, which is why "Mark as sent" exists at all.
 *
 *   A LATER CHANGE OF MIND CANNOT REACH IT. Setting the school to
 *   do-not-contact tomorrow stops Thriv3; it does not stop a draft already
 *   sitting in Outlook.
 *
 * Stated, not dramatised. It is how the tool works rather than a warning.
 * ===========================================================================
 */
/**
 * PLATFORM-NEUTRAL SINCE R2B, AND NOT MERELY FOR TIDINESS.
 *
 * These said "Outlook" because AppleScript was the only transport and the
 * claim was true. On the hosted deployment nothing drives Outlook: the email
 * is prepared, put on the clipboard and handed to whatever mail application
 * the operator's machine is configured to use. Leaving the old wording would
 * have named a product Thriv3 has not opened and cannot see — the same
 * overstatement F7b and F9e were spent removing, reintroduced by a string.
 *
 * "Your email app" rather than "Outlook" is also the literally correct
 * authority: a `mailto` URL resolves through the operating system's handler, and
 * Thriv3 does not get to know which application that is.
 */
export const DRAFT_OPENED_TITLE = 'After Thriv3 prepares the email';
export const DRAFT_OPENED_BODY =
  'Review and edit it in your email app, then send it yourself. Thriv3 does not know when '
  + 'you press Send — come back and use "Mark as sent" so this school counts as contacted.';
export const DRAFT_HANDOVER_HINT =
  'Once the email is in your email app, Thriv3 can no longer change or stop it — including '
  + 'if you later set this school to do-not-contact.';

/**
 * THE CONFIRMATION, AND THE WORD IT MUST NOT USE.
 *
 * "Confirm" is the operator confirming their own action, never Thriv3
 * confirming an observation. There is no pixel, no provider callback and no
 * Outlook handle, so nothing here may read as "verified", "detected" or
 * "delivered" — see ACCEPTED_SOURCE.OPERATOR_ASSERTED, which is the weakest of
 * the four and is what this records.
 */
export const MARK_AS_SENT = 'Mark as sent';
export const MARK_AS_SENT_HINT = 'Confirm that you sent this email from Outlook.';
export const AWAITING_CONFIRMATION = 'Draft awaiting your confirmation';

/**
 * THE DRAFT THAT NEVER WENT.
 *
 * Deliberately "draft record", not "draft": Thriv3 cannot see or delete
 * anything in Outlook, and a label promising otherwise would be the one claim
 * this whole workflow is careful not to make. What it clears is this system's
 * own expectation of an answer.
 *
 * The history stays. Subject, body hash, evidence and coach all survive, so
 * what Thriv3 composed remains answerable; only the pending claim goes away.
 */
export const DISCARD_DRAFT = 'Discard draft record';
export const DISCARD_DRAFT_HINT =
  'Use this if you did not send it. The record of what Thriv3 drafted is kept, and nothing '
  + 'is counted as contact. It does not delete anything in Outlook.';

/**
 * WHAT THRIV3 CAN HONESTLY SAY ABOUT THE COPY IT HOLDS.
 *
 * The operator is expected to edit the draft in Outlook, and Thriv3 never sees
 * those edits — it stores what it GENERATED. So stored subject, body hash and
 * evidence describe the drafted copy and not the sent copy, and no surface may
 * call them the email that was sent.
 */
export const GENERATED_DRAFT_COPY = 'Generated draft';
export const GENERATED_DRAFT_HINT =
  'What Thriv3 drafted. You may have edited it in Outlook before sending; those edits are '
  + 'not visible here.';

/** Outlook, and only Outlook. There is no Apple Mail or Gmail path in this build. */
export const MAIL_CLIENT = 'Outlook';


/* ========================================================================== */
/*  F8b — THE SPECIFIC SCHOOL WORKSPACE                                       */
/* ========================================================================== */

/**
 * THE RELATIONSHIP FACT, UNDER ONE NAME.
 *
 * `athlete_programmes.flagged` was rendered as "Existing relationship" by the
 * match card, the removed-from-Top-100 panel and the outreach dialog, and as
 * "Flagged" by Specific Schools and Specific Search — one column, one amber
 * badge, two words, two of them on the same screen at once.
 *
 * "Existing relationship" wins because it names the FACT. "Flagged" names what
 * an operator DID to record it, which is the right word for the action and the
 * wrong one for the state it leaves behind. The action keeps its own wording —
 * "Flag relationship", "Unflag" — and that asymmetry is deliberate.
 */
export const EXISTING_RELATIONSHIP = 'Existing relationship';

/**
 * CONTACT POLICY, SAID OUT LOUD — INCLUDING WHEN IT PERMITS EVERYTHING.
 *
 * ===========================================================================
 * "CAMPAIGN MAY CONTACT" IS THE BADGE THAT DID NOT EXIST, AND ITS ABSENCE WAS
 * THE AMBIGUITY.
 *
 * `manual_only` and `do_not_contact` each had a badge; `default` had nothing.
 * So the most permissive state in the product — the one where an automated
 * campaign is free to write to a coach — was indistinguishable from a row
 * whose policy nobody had considered. On a workspace whose entire purpose is
 * deliberate, high-attention contact, that is exactly the state that most
 * needs saying.
 * ===========================================================================
 *
 * EXACTLY ONE OF THE THREE, EVER. They are values of one column, not flags,
 * and rendering two would suggest a state that cannot exist.
 */
export const CAMPAIGN_MAY_CONTACT = 'Campaign may contact';
export const CAMPAIGN_MAY_CONTACT_HINT =
  'No contact restriction is recorded for this school, so the automated campaign may '
  + 'write to it.';

/** The strongest stance, worded identically wherever it appears. */
export const DO_NOT_CONTACT_BADGE = 'Do not contact';

/** The ranking decision. A decision, not a fact and not a policy. */
export const NOT_IN_TOP_100 = 'Not in Top 100';
export const REMOVE_FROM_TOP_100 = 'Remove from Top 100';
export const KEEP_IN_TOP_100 = 'Keep in Top 100';

/**
 * WHAT HAS ACTUALLY GONE TO THIS PROGRAMME, IN ONE PHRASE — F8b.
 *
 * ===========================================================================
 * THE COLLAPSED ROW GETS A PHRASE; THE EXPANSION KEEPS THE FULL BADGE STRIP.
 *
 * `ProgrammeContactSummary` renders up to eight badges, which is right where
 * the operator has opened a row to study it and wrong on a list they are
 * scanning. This compresses the OUTREACH half of that summary — and only that
 * half — into the shortest true phrase.
 * ===========================================================================
 *
 * NULL MEANS "SAY NOTHING", AND THAT IS THE IMPORTANT RETURN VALUE. It is
 * returned whenever the history is not known to have arrived, so a row that
 * has not settled cannot claim an absence. `known` is the same gate
 * `ProgrammeContactSummary` applies to NO_CONTACT_RECORDED, applied here for
 * the same reason: a programme nobody has written to is ABSENT from the map,
 * and so is every programme in the product while the request is in flight.
 *
 * "Drafted" AND "Sent" ARE NEVER THE SAME PHRASE. A draft nobody confirmed did
 * not reach a coach, and this is the one line on a scanned row that says so.
 */
export function contactStateShort(summary, known) {
  if (!known) return null;
  if (!summary?.contacted) return NO_CONTACT_RECORDED;
  if (summary.draft_only) return 'Drafted';
  if (summary.has_confirmed_send) {
    const n = summary.confirmed_send_count;
    return n > 1 ? `Sent ×${n}` : 'Sent';
  }
  /**
   * An outreach record exists that is neither an unconfirmed draft nor a
   * confirmed send — a cancelled draft, for instance. Saying "Sent" would be
   * false and saying "No contact recorded" would be false too, so the row says
   * nothing and the expansion shows the detail.
   */
  return null;
}

/**
 * THE STRONGEST ENGAGEMENT FACT, AND ONLY ONE OF THEM — F8b.
 *
 * Engagement is the rarest and most valuable signal here, so the collapsed row
 * carries one badge meaning "somebody at this school did something" rather
 * than three the operator has to read together. The order is by what it says
 * about the COACH, matching `lastActivity` on the server: a reply outranks a
 * visit, and a visit outranks nothing.
 *
 * THIS IS DISPLAY COMPRESSION, NOT A SCORE. Nothing is ranked, nothing is
 * weighted, and the expansion shows every fact unabridged. Deciding which
 * engagement MATTERS is judgement and belongs to Email Intelligence.
 */
export function engagementShort(summary) {
  const e = summary?.engagement;
  if (!e) return null;
  if (e.reply_recorded) return 'Reply recorded';
  if (e.profile_visits > 0) return 'Profile visit';
  return null;
}

/**
 * HOW LONG A DRAFT HAS BEEN WAITING — F8b.
 *
 * ===========================================================================
 * AGE, NOT URGENCY. THE WORDING DOES NOT ESCALATE.
 *
 * A draft from March is stated exactly as flatly as one from this morning:
 * there is no "overdue", no "still", no colour that deepens, no exclamation.
 * Thriv3 does not know whether the operator sent it, so it cannot know whether
 * anything is wrong — and an interface that grows more alarmed about a fact it
 * has not established is one that teaches operators to dismiss it.
 *
 * What age genuinely buys is discrimination: "drafted 3 minutes ago" is
 * probably the message the operator is mid-way through, and "drafted 9 days
 * ago" probably is not. That is worth showing and it is all that is shown.
 * ===========================================================================
 *
 * Returns null on a missing or unparseable timestamp rather than guessing.
 */
export function draftAge(iso, now = Date.now()) {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;

  const minutes = Math.floor((now - at) / 60000);
  // A clock skew between the server and this browser is not a fact about the
  // draft, so a negative age reads as the present rather than as the future.
  if (minutes < 1) return 'Drafted just now';
  if (minutes < 60) return `Drafted ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Drafted ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Drafted yesterday';
  if (days < 30) return `Drafted ${days} days ago`;

  // Past a month a relative count stops being readable; the date itself is
  // shorter and more precise.
  return `Drafted on ${new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/**
 * THE SECTION THAT EXISTS ONLY WHEN THERE IS SOMETHING TO DO — F8b.
 *
 * A heading reading "Awaiting your confirmation (0)" would be a standing
 * reminder of an obligation nobody has, so the section is absent rather than
 * empty. The count is in the heading because the operator's question is "how
 * many", and a heading that answers it saves counting rows.
 */
export const AWAITING_SECTION = (n) => `Awaiting your confirmation (${n})`;

/**
 * The tab, carrying BOTH facts and never one at the expense of the other.
 *
 * The school count is what the tab has always meant and operators navigate by
 * it. The pending count is the reason to look now. Replacing the first with
 * the second would silently change what a familiar number means.
 */
export const TAB_AWAITING = (n) => `${n} awaiting`;

/**
 * THE PENDING READ FAILED, SAID ONCE, AT THE PAGE — F8b.
 *
 * ===========================================================================
 * THE SAME DISCIPLINE AS CONTACT_UNAVAILABLE_NOTICE, FOR THE SAME REASON.
 *
 * `usePendingManualDrafts` has always computed `failed` precisely so a caller
 * could tell "nothing is pending" from "we could not ask" — and until F8b the
 * only caller dropped it on the floor. A failed pending read therefore
 * rendered as a workspace with no outstanding actions, which is the single
 * most consequential false statement this screen can make: it is the exact
 * moment an operator concludes there is nothing to confirm.
 * ===========================================================================
 *
 * ONE NOTICE, NOT ONE PER ROW. The request is athlete-level, so its failure is
 * a fact about the page rather than about any school on it.
 */
export const PENDING_UNAVAILABLE_NOTICE =
  'Drafts awaiting confirmation could not be loaded. Some may be outstanding.';

/**
 * A CONFIRMATION OR A DISCARD THAT DID NOT LAND.
 *
 * Nothing is removed from the list optimistically, so the draft the operator
 * acted on is still on screen beneath this sentence, still offering both
 * answers. The failure is attached to that draft rather than to the page: it
 * is about one message, unlike the load failure above it.
 */
export const CONFIRM_FAILED = 'That confirmation did not save. Nothing was recorded as sent.';
export const DISCARD_FAILED = 'That draft record could not be discarded. Nothing was changed.';

/** The expansion. Named for what it reveals rather than for the widget. */
export const SHOW_DETAILS = 'Details';
export const HIDE_DETAILS = 'Hide details';

/** Editing the two pieces of operator-written context, kept distinct. */
export const NOTE_LABEL = 'Note';
export const ADD_NOTE = 'Add a note';
export const EDIT_NOTE = 'Edit note';
export const SAVE_NOTE = 'Save note';
export const NOTE_PLACEHOLDER = 'Ongoing context for this school';
export const FLAG_REASON_LABEL = 'Why this school matters';
export const ADD_FLAG_REASON = 'Add a reason';
export const EDIT_FLAG_REASON = 'Edit reason';
export const SAVE_FLAG_REASON = 'Save reason';
export const FLAG_REASON_PLACEHOLDER = 'What makes this school specifically important';

/**
 * WHY THE TWO EDITORS ARE NOT ONE FIELD.
 *
 * `flag_reason` is mandatory when a relationship is flagged and answers a
 * question asked once — why this school became specifically important. `note`
 * is the operator's running context and changes as the recruitment does.
 * Stored in separate columns, written by separate mutations, and worth keeping
 * apart on screen: merged, the reason a school matters would be overwritten by
 * whatever happened most recently.
 */
export const CONTEXT_HINT =
  'The reason says why this school became important. The note is ongoing context.';

/** Every coach on file for this programme, in the expansion. */
export const ALL_CONTACTED_COACHES = 'Coaches contacted';


/* ========================================================================== */
/*  F9b — PROGRAMME EVIDENCE, ON THE WORKSPACE                                */
/* ========================================================================== */

/**
 * TWO QUESTIONS, TWO SURFACES, AND THEY MUST NOT ANSWER EACH OTHER'S.
 *
 * ===========================================================================
 * THE WORKSPACE ASKS "WHAT DOES THRIV3 KNOW?"
 * THE COMPOSER ASKS "WHAT IS THRIV3 USING FOR THIS EMAIL?"
 *
 * Both read the same server contract, deliberately — a second idea of what the
 * evidence is would eventually disagree with the one that sends the email, and
 * the disagreement would surface as a coach receiving something no screen ever
 * showed. What differs is the job. This one is read-only and answers a
 * question asked BEFORE anyone opens a composer: is there anything here worth
 * writing about, or will the draft be the plain template?
 * ===========================================================================
 *
 * It carries no selection controls, no reordering, no structure and no
 * preview. Choosing the angle is the composer's job and stays there.
 */
export const PROGRAMME_EVIDENCE_HEADING = 'What Thriv3 knows';
export const PROGRAMME_EVIDENCE_HINT =
  'What this programme’s own record supports saying. Choosing what an email actually '
  + 'says happens in the draft.';

/** Said while the answer is still coming, so silence is never read as absence. */
export const PROGRAMME_EVIDENCE_LOADING = 'Checking what we can say about this programme…';

/**
 * WE ASKED, AND THE ANSWER IS NOTHING — WHICH IS A FACT ABOUT THE SCHOOL.
 *
 * Only ever rendered from a SUCCESSFUL response carrying no usable finding.
 * A programme with nothing to say and a programme we could not read produce
 * the same empty screen, and conflating them would turn a server problem into
 * a statement about a school. The sentence also says what follows from it —
 * the draft still works, it is simply not personalised.
 */
export const PROGRAMME_EVIDENCE_NONE =
  'Nothing specific to say about this programme — a draft would use the plain template.';

/**
 * WE ASKED AND COULD NOT FIND OUT. Never rendered beside the sentence above.
 * `reason` from the wire is appended where the server supplied one, because
 * "the roster page could not be read" is more actionable than a generic
 * failure and it is the server's own words rather than an interpretation.
 */
export const PROGRAMME_EVIDENCE_FAILED = 'Could not load programme evidence.';
export const PROGRAMME_EVIDENCE_RETRY = 'Try again';

/**
 * EVERYTHING ELSE THE ENGINE HAS, KEPT SECONDARY.
 *
 * The findings the outbound selector did not lead with. Shown because "we knew
 * this too" is the difference between a considered choice and an arbitrary
 * one, and collapsed because this is a preview rather than the composer's
 * working surface — the full picture, with what was dropped and why, stays in
 * `EvidencePanel`.
 */
export const PROGRAMME_EVIDENCE_ALSO_KNOWN = 'Also known';


/* ========================================================================== */
/*  F9e - WHAT THIS COACH HAS ALREADY BEEN PUT                                */
/* ========================================================================== */

/**
 * THE STRONGEST TRUTHFUL SENTENCE, AND IT IS WEAKER THAN IT LOOKS.
 *
 * ===========================================================================
 * THRIV3 KNOWS WHAT IT WROTE. IT DOES NOT KNOW WHAT WAS SENT.
 *
 * `outreach_send.rendered_kinds` records the claims present in the body
 * Thriv3 handed to Outlook, and ACCEPTED records that a person afterwards
 * asserted they sent it. Between those two moments the operator has an
 * editable draft in a mail client this build cannot see: they may delete the
 * sentence, rewrite it, or send something else entirely.
 *
 * So the honest claim is about the DRAFT and the ASSERTION, never about the
 * coach. "Already sent" would state a fact nobody established; "the coach
 * received this" and "the coach read this" would state two.
 * ===========================================================================
 *
 * THE SAME WORDING FOR A CAMPAIGN MESSAGE, deliberately. A provider-accepted
 * campaign send is evidentially stronger, and a second sentence saying so
 * would put two grades of certainty on one list for a reader who has to act on
 * both. Consistent understatement is the safer of the two errors; the origin
 * is shown beside it for anyone who needs the distinction.
 */
export const EVIDENCE_USED_BEFORE = 'Used in a draft confirmed as sent to this coach';
export const evidenceUsedBefore = (coachCount) => (coachCount > 1
  ? `Used in a draft confirmed as sent to ${coachCount} selected coaches`
  : EVIDENCE_USED_BEFORE);

/**
 * A BODY IN A WINDOW IS NOT A MESSAGE. Kept in wholly separate words from the
 * sentence above, because nobody has read this one and the two facts must
 * never be mistaken for each other.
 */
export const EVIDENCE_IN_OPEN_DRAFT = 'Already in an open draft for this coach';
export const evidenceInOpenDraft = (coachCount) => (coachCount > 1
  ? `Already in an open draft for ${coachCount} selected coaches`
  : EVIDENCE_IN_OPEN_DRAFT);

/** Where it is recorded. Never guessed, and never shown as extra certainty. */
export const EVIDENCE_USE_ORIGIN = Object.freeze({
  manual: 'by hand',
  campaign: 'by a campaign',
});

/**
 * UNKNOWN HISTORY IS NOT NO HISTORY - and this is the sentence that keeps
 * those apart.
 *
 * A failed lookup leaves every finding unmarked, which looks exactly like a
 * programme nothing has ever been said about. Composition continues, because
 * a history query must never be able to block manual drafting; this says why
 * the markers are missing so their absence cannot be read as an answer.
 */
export const EVIDENCE_HISTORY_UNAVAILABLE =
  'Could not check what has been sent to this coach before.';


/* ========================================================================== */
/*  R2B — HANDING A PREPARED EMAIL TO THE OPERATOR'S OWN MAIL APP            */
/* ========================================================================== */

/**
 * THE TWO ACTIONS, AND WHY NEITHER OF THEM NAMES OUTLOOK.
 *
 * ===========================================================================
 * THE OPERATING SYSTEM DECIDES WHICH APPLICATION OPENS, NOT THRIV3.
 *
 * A `mailto` URL resolves through the OS's registered handler. On one
 * operator's machine that is Outlook, on another Apple Mail, on a third a
 * webmail tab. Thriv3 hands over a URL and learns nothing about what happened
 * to it — there is no callback, no handle and no way to ask.
 *
 * So "Open in Outlook" would be a guess printed as a fact, and it would be
 * wrong on the first machine that is set up differently. "Open in email" is
 * the strongest true version.
 * ===========================================================================
 */
export const OPEN_IN_EMAIL = 'Open in email';
export const COPY_EMAIL = 'Copy email';
/** After a successful handoff. Says what was observed, which is very little. */
export const HANDOFF_OPENED = 'Opened in your email app';
export const HANDOFF_RETRY = 'Open again';

/**
 * WHAT THE OPERATOR HAS TO DO NEXT, SAID BEFORE THEY GO LOOKING.
 *
 * The paste is the one step nobody expects, because every other "open in your
 * email app" button on the internet fills the body in. It does not say why
 * — the reason is a 2,007-character URL limit and it is the wrong thing to
 * put in front of somebody trying to email a coach — but it does say it
 * plainly enough that nobody stares at an empty compose window.
 */
export const HANDOFF_READY =
  'Email copied. Your email app will open with the address and subject filled in — paste '
  + 'the message in, check it over, and send.';

/** The same instruction where only the clipboard worked. */
export const HANDOFF_COPY_ONLY = (email) =>
  `Email copied. Paste it into a new message to ${email} with the subject above.`;

/**
 * NOTHING HAS HAPPENED YET, AND THIS IS THE LINE THAT SAYS SO.
 *
 * ---------------------------------------------------------------------------
 * A COMPOSE WINDOW OPENING IS THE MOST CONVINCING FALSE SIGNAL IN THIS
 * WORKFLOW. The operator clicks, their mail app comes to the front with a
 * recipient and a subject already in it, and the whole thing FEELS finished.
 * It is not: nothing has been pasted, nothing has been read, nothing has been
 * sent, and Thriv3 has recorded a DRAFT and no more.
 *
 * The F7b confirmation exists precisely because Thriv3 cannot observe the
 * send. This sentence is what stops the handoff quietly undermining it.
 * ---------------------------------------------------------------------------
 */
export const HANDOFF_NOT_SENT_YET =
  'Nothing has been sent. Thriv3 only records this once you confirm you sent it.';

/**
 * THE CLIPBOARD REFUSED, WHICH IS A REDUCED HANDOFF AND NOT A FAILED ONE.
 *
 * Said as an instruction rather than an error, because the operator can
 * complete the task from here unaided — the authoritative body is on screen
 * beside this and selecting it is the only difference. The DRAFT is already
 * recorded either way, so nothing has been lost and nothing needs retrying.
 */
export const HANDOFF_CLIPBOARD_FAILED =
  'Could not copy the email. Select the message below and copy it by hand.';

/**
 * A PLAIN-TEXT COPY, NAMED RATHER THAN HIDDEN.
 *
 * The rich clipboard carries the anchors; plain text does not, so the profile
 * link arrives as a bare URL most mail apps will linkify and the WhatsApp
 * number arrives as the markdown it is written in. That is a visible
 * difference in a coach's inbox, so the operator is told rather than left to
 * notice it after sending.
 */
export const HANDOFF_PLAIN_ONLY =
  'Copied as plain text — your browser would not take formatted text. Links may arrive '
  + 'unformatted; check the message before you send it.';

/** The section heading, above one row per prepared coach. */
export const HANDOFF_SECTION = (n) => `Ready to send (${n})`;
