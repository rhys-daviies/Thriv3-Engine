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
 * `manual_only` — PHRASED FOR WHAT IS TRUE TODAY.
 *
 * It records an intention that automated outreach should leave this programme
 * alone. Campaign execution does not consult it yet, so saying "excluded from
 * automated outreach" would describe enforcement this build does not have and
 * would be believed. The wording says what the operator should do, and what the
 * setting is for, without claiming a guard that is not there.
 */
export const MANUAL_ONLY_HINT =
  'Manual only — contact this programme directly rather than through automated outreach.';

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
