/**
 * ITS OWN FAILURE HELPER, AND NOT `matchmakingService`'s — A9.7.
 *
 * Four lines duplicated on purpose. `matchmakingService.js` imports the frozen
 * engine at module scope — `pursuitRun`, `poolContext`, `validationUniverse`,
 * `financialRules` — so importing `serviceError` from it would pull the whole
 * matchmaking model into whatever imports THIS.
 *
 * And A9.7 is the phase that makes that matter: `attachSelectionToSend` is now
 * called from `executionClaim.js` and `sendOutreach.js`, which are in turn
 * imported by `confirmSends.js` and `draftOutreach.js` — standalone CLI tools
 * that confirm mail an operator already sent by hand. Those have no business
 * loading a scoring engine, and `importGraph.test.js` now asserts they do not.
 *
 * The shape is the repo's own: `outreachSend.js` carries an identical local
 * `fail`, for the same reason, one directory up.
 */
function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * WHAT CAUSED THIS MESSAGE — A9.6.
 *
 * ===========================================================================
 * THE GAP THIS CLOSES, MEASURED RATHER THAN ASSERTED.
 *
 * A9.5 reported that outreach keys on `(athlete_id, coach_id)` and does not
 * carry the programme selection that caused it. Against the live database that
 * is not a theoretical shortfall:
 *
 *   96 outreach relationships    0 carry a programme_campaign_id
 *   41 sends                    14 carry a college_name, 27 carry none
 *   58 distinct `match_id`      42 (72.4%) name a school that exists in TWO
 *                               sports, so they are not programme identities
 *
 * `match_id` holds a bare college NAME — "Clemson", "Duke" — and programme
 * identity in this codebase is everywhere `(college_name, sport)`. A name
 * alone cannot say which of two programmes was pursued.
 * ===========================================================================
 *
 * -- AND THE COACH CANNOT SUPPLY THE MISSING HALF ---------------------------
 *
 * The tempting repair is to read the sport, and the school, off the coach. It
 * is wrong, and the live data already proves it rather than merely warning:
 *
 *   match_id "Trinity (TX)"   coach.school "Trinity (CT)"
 *   match_id "Wheaton (MA)"   coach.school "Wheaton (IL)"
 *
 * Two relationships whose recommendation named one institution and whose coach
 * row names a DIFFERENT institution of the same name in another state. At
 * least one side of each pair is already wrong and no join can say which. A
 * `coaches` row is current, mutable staffing data; coaches move, and a
 * historical attribution derived from where somebody works today is a guess
 * wearing a foreign key.
 *
 * So programme identity is FROZEN WHEN THE MESSAGE IS CREATED and never
 * re-derived — the rule §E asked for, and the one `outreach_send.college_name`
 * was already built for.
 */

/**
 * V1 / PRE_PROVENANCE is not a defect to be repaired — §M.
 *
 * Every send on file predates matchmaking. A null selection is the TRUE
 * statement about those rows, and the only alternative on offer is a
 * fabricated one. `createOutreach` already states this rule for
 * `programme_campaign_id`: "Filling it in from whichever campaign happened to
 * reuse it would be inventing a history."
 */
export const PROVENANCE_CLASS = Object.freeze({
  V2_PROVENANCE: 'V2_PROVENANCE',
  PRE_PROVENANCE: 'PRE_PROVENANCE',
});

export const classifySend = (row) => (
  row?.matchmaking_selection_id ? PROVENANCE_CLASS.V2_PROVENANCE : PROVENANCE_CLASS.PRE_PROVENANCE
);

const SELECTION_BY_ID = `
  SELECT s.*, r.player_id AS run_player_id
    FROM matchmaking_selections s
    JOIN matchmaking_runs r ON r.id = s.matchmaking_run_id
   WHERE s.id = ?`;

/**
 * Attach a selection to a message, once.
 *
 * FOUR THINGS ARE CHECKED BEFORE ANYTHING IS WRITTEN, and each one exists
 * because the alternative is a plausible-looking lie:
 *
 *   1. the selection exists;
 *   2. it belongs to the athlete this message is for — otherwise one athlete's
 *      reasoning becomes the stated cause of another athlete's email;
 *   3. the message already knows its own programme, and it is the SAME
 *      programme the selection names, on both halves of the identity;
 *   4. the coach, on the evidence held at creation time, belongs to that
 *      programme.
 *
 * (3) refuses a message whose `college_name` or `sport` is null rather than
 * filling them in from the selection. A send that never froze its programme is
 * a pre-provenance send; adopting the selection's spelling would make the
 * check in (4) compare the selection against itself and pass trivially.
 */
/**
 * THE FOUR CHECKS, AS A FUNCTION — A9.7.
 *
 * Extracted from `attachSelectionToSend` so the PRODUCTION write can run the
 * same validation without becoming a second writer of the column.
 *
 * `recordDraft` now carries `matchmaking_selection_id` in its own INSERT (and
 * in the draft-replacement UPDATE beside `programme_campaign_id`, which moves
 * with the body for the reason stated there). That makes the provenance write
 * ATOMIC with the send it describes: there is no window in which a message
 * exists without the selection that caused it, and no partial state for §S's
 * "send creation fails after selection" to leave behind.
 *
 * Had the production path called `attachSelectionToSend` as a second step, the
 * two writers would also have disagreed about re-drafting: that function
 * refuses to re-point a message at a different selection, which is right for a
 * message that has been SENT and wrong for a draft being replaced in place.
 * One validator, two callers, one writer each in its own domain.
 */
export function assertSelectionMatchesSend(db, {
  selectionId, athleteId, coachId, collegeName, sport,
} = {}) {
  const selection = db.prepare(SELECTION_BY_ID).get(selectionId);
  if (!selection) throw fail('SELECTION_NOT_FOUND', `No matchmaking selection ${selectionId}.`);

  if (selection.player_id !== athleteId) {
    throw fail('SELECTION_ATHLETE_MISMATCH',
      'That selection belongs to a different athlete.');
  }

  if (!collegeName || !sport) {
    throw fail('SEND_PROGRAMME_UNKNOWN',
      'This message did not record which programme it was for, so a selection '
      + 'cannot be checked against it. Programme identity is frozen when the '
      + 'message is created, never adopted afterwards.');
  }

  if (collegeName !== selection.college_name || sport !== selection.sport) {
    throw fail('SELECTION_PROGRAMME_MISMATCH',
      `That selection is for ${selection.college_name} (${selection.sport}), but the `
      + `message was written for ${collegeName} (${sport}).`);
  }

  const coach = db.prepare('SELECT id, school, sport FROM coaches WHERE id = ?').get(coachId);
  if (!coach) throw fail('COACH_NOT_FOUND', `No coach ${coachId}.`);
  if (coach.school !== selection.college_name || coach.sport !== selection.sport) {
    throw fail('COACH_PROGRAMME_MISMATCH',
      `The evidence on file puts this coach at ${coach.school} (${coach.sport}), not at `
      + `${selection.college_name} (${selection.sport}).`);
  }

  return selection;
}

export function attachSelectionToSend(db, { sendId, selectionId } = {}) {
  const send = db.prepare('SELECT * FROM outreach_send WHERE id = ?').get(sendId);
  if (!send) throw fail('SEND_NOT_FOUND', `No outreach_send ${sendId}.`);

  /**
   * IMMUTABLE, AND IDEMPOTENT ON THE SAME ANSWER. Re-running an attach with
   * the selection already recorded is a normal thing for a retried request to
   * do; re-pointing a sent message at a DIFFERENT cause is the silent relink
   * A9.5 §Q forbade and this refuses it by name.
   */
  if (send.matchmaking_selection_id) {
    if (send.matchmaking_selection_id === selectionId) {
      return { changed: false, sendId, selectionId };
    }
    throw fail('SEND_PROVENANCE_IMMUTABLE',
      'This message already records the selection that caused it. A message is '
      + 'not re-attributed to a different selection after the fact.');
  }

  /**
   * THE COACH CHECK INSIDE THIS READS A MUTABLE ROW, and is bounded to the
   * moment of attachment on purpose: §L licenses exactly that, and the Trinity
   * and Wheaton rows above are what it catches. Nothing re-runs it later —
   * once written, the attribution stands whatever the coach does next, which
   * is the entire point of freezing it.
   */
  assertSelectionMatchesSend(db, {
    selectionId,
    athleteId: send.athlete_id,
    coachId: send.coach_id,
    collegeName: send.college_name,
    sport: send.sport,
  });

  db.prepare('UPDATE outreach_send SET matchmaking_selection_id = ? WHERE id = ?')
    .run(selectionId, sendId);
  return { changed: true, sendId, selectionId };
}

/**
 * The whole chain behind one message, or the honest absence of it.
 *
 * Reads THROUGH the immutable links rather than copying their contents: the
 * rank and band come from the selection, which froze them, and the run id
 * comes from the selection too. §H asked for no duplicated ids where a
 * reliable immutable FK chain exists, and this is that chain.
 */
export function sendProvenance(db, sendId) {
  const send = db.prepare(`
    SELECT id, athlete_id, coach_id, college_name, sport, sent_at, state,
           matchmaking_selection_id
      FROM outreach_send WHERE id = ?`).get(sendId);
  if (!send) throw fail('SEND_NOT_FOUND', `No outreach_send ${sendId}.`);

  const provenance = classifySend(send);
  if (provenance === PROVENANCE_CLASS.PRE_PROVENANCE) {
    return { sendId, provenance, selection: null, run: null };
  }

  const s = db.prepare(SELECTION_BY_ID).get(send.matchmaking_selection_id);
  return {
    sendId,
    provenance,
    selection: {
      id: s.id,
      collegeName: s.college_name,
      sport: s.sport,
      status: s.status,
      rank: s.rank,
      band: s.band,
      pursuit: s.pursuit,
      source: s.source,
      runWasStale: s.run_was_stale === 1,
      selectedAt: s.selected_at,
    },
    run: { id: s.matchmaking_run_id },
  };
}

/** Every message attributed to one selection, oldest first. */
export function sendsForSelection(db, selectionId) {
  return db.prepare(`
    SELECT id, athlete_id, coach_id, college_name, sport, state, sent_at, created_at
      FROM outreach_send
     WHERE matchmaking_selection_id = ?
     ORDER BY created_at, id`).all(selectionId);
}
