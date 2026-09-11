import db from '../db/client.js';

/**
 * WHETHER THIS ATHLETE MAY BE WRITTEN TO AT THIS PROGRAMME.
 *
 * `contact_stance` shipped with `athlete_programmes` as a declared safety
 * decision and was READ BY NOTHING. An operator could set a programme to
 * `do_not_contact`, the column would hold it faithfully, and every send path
 * in the system would carry on as though it said nothing. This module is the
 * reader that makes the column mean what the schema says it means.
 *
 * ---------------------------------------------------------------------------
 * RESOLVED FROM THE DATABASE, NEVER FROM A REQUEST.
 *
 * The whole value of a contact rule is that it holds when the screen that
 * would normally show it is not the one being used. A client that posts
 * `contact_stance: 'default'`, or omits it, or opens a different tab, gets the
 * same answer — because nothing here reads anything the caller supplied
 * except the athlete and the programme name, and those are what a message is
 * addressed with anyway.
 * ---------------------------------------------------------------------------
 *
 * WHAT IS DELIBERATELY NOT CONSULTED. `visibility`, `flagged` and
 * `request_state` are not contact decisions and are not read here. A school
 * taken out of the actionable Top 100 is still a school somebody may want to
 * write to by hand — very often BECAUSE it was taken out — and a flag usually
 * means we know the coach, which is a reason to write rather than not to.
 * Collapsing any of them into this check would silence schools nobody silenced.
 *
 * The global `suppressions` table is also not read here, and must not be: it
 * is keyed on an email address with no athlete column, it is an opt-out rather
 * than a targeting preference, and `sendOutreach` already checks it per coach
 * on every path. Two different questions, two different checks.
 */

export const CONTACT_REFUSAL = Object.freeze({
  DO_NOT_CONTACT: 'RELATIONSHIP_DO_NOT_CONTACT',
});

/**
 * The stance on record for one athlete at one programme.
 *
 * `default` when there is no relationship row at all, which is the common
 * case: most programmes an athlete is matched with have never been flagged,
 * requested or suppressed, and the absence of an opinion is not an opinion.
 */
export function contactStanceFor({ athleteId, collegeName, sport }) {
  if (!athleteId || !collegeName || !sport) return 'default';
  const row = db.prepare(`
    SELECT contact_stance FROM athlete_programmes
     WHERE athlete_id = ? AND college_name = ? AND sport = ?
  `).get(athleteId, collegeName, sport);
  return row?.contact_stance ?? 'default';
}

/**
 * EVERY PROGRAMME THIS SEND ACTUALLY REACHES, not the one it claims to.
 *
 * `collegeName` arrives in the request body on the shared endpoint, and so
 * does every coach's address. `findOrCreateCoach` keys on
 * (email, school, sport) and CREATES a row when it misses — so a caller
 * writing to a coach at School A while labelling the run School B does not
 * merely mislabel it: it mints a second `coaches` row for that address under
 * School B. A stance resolved from the label alone would then be a stance on a
 * school nobody was writing to, and the do-not-contact on School A would never
 * be consulted.
 *
 * So the question asked is not "what did the caller call this" but "who is
 * about to be emailed, and where is that address on record". The claimed name
 * is still included — a first message to a programme we hold no coach row for
 * is a legitimate send, and the relationship for it must still bind.
 *
 * SPORT. Rows for the athlete's own sport, plus rows whose sport is NULL.
 * A null-sport coach row is ambiguous about which programme it belongs to, and
 * for a rule whose whole job is to stop a message, the conservative reading is
 * the correct one: an ambiguous row that might be the suppressed programme is
 * treated as though it is.
 */
export function programmesReachedBy({ collegeName, sport, coachEmails = [] }) {
  const names = new Set();
  if (collegeName) names.add(collegeName);

  const lookup = db.prepare(`
    SELECT DISTINCT school FROM coaches
     WHERE lower(trim(email)) = @email
       AND (sport IS @sport OR sport IS NULL)
       AND school IS NOT NULL
  `);
  for (const raw of coachEmails) {
    const email = String(raw ?? '').trim().toLowerCase();
    if (!email) continue;
    for (const row of lookup.all({ email, sport: sport ?? null })) names.add(row.school);
  }
  return [...names];
}

/**
 * Refuse, or say nothing.
 *
 * ONE STANCE BLOCKS, and only one. `manual_only` is a restriction on WHICH
 * PATH may be used, not on whether contact may happen at all — it permits the
 * hand-written workflow this file was added for and is intended to refuse
 * automated campaign execution later. It does not refuse anything yet, because
 * campaign execution does not consult this module in F1 and inventing a
 * refusal nothing reaches would be a rule that had never been exercised the
 * first time it mattered.
 *
 * @returns {{allowed: boolean, stance: string, reason: string|null}}
 */
export function manualContactDecision({ athleteId, collegeName, sport, coachEmails = [] }) {
  /**
   * ANY REACHED PROGRAMME REFUSES THE WHOLE RUN.
   *
   * One call writes to one programme's staff, so a refusal is a fact about the
   * run rather than about one recipient — and where the reached set has more
   * than one name in it, that is itself a sign the run is not what it says it
   * is. Blocking on any is the only safe reading.
   */
  const reached = programmesReachedBy({ collegeName, sport, coachEmails });
  const names = reached.length ? reached : [collegeName].filter(Boolean);

  for (const name of names) {
    const stance = contactStanceFor({ athleteId, collegeName: name, sport });
    if (stance === 'do_not_contact') {
      return {
        allowed: false,
        stance,
        reason: CONTACT_REFUSAL.DO_NOT_CONTACT,
        // WHICH programme refused, which is not always the one the caller
        // named — and when it is not, that is the more important half.
        programme: name,
        reached: names,
      };
    }
  }
  return {
    allowed: true,
    stance: contactStanceFor({ athleteId, collegeName, sport }),
    reason: null,
    programme: collegeName ?? null,
    reached: names,
  };
}

/**
 * The same decision, as a throw, for a send path that must stop.
 *
 * Carries a `code` like every other domain failure here so a route maps it to
 * a status without matching on prose, and names the programme in the message
 * because an operator sending to four schools needs to know which one refused.
 */
export function assertContactAllowed({ athleteId, collegeName, sport, coachEmails = [] }) {
  const decision = manualContactDecision({ athleteId, collegeName, sport, coachEmails });
  if (!decision.allowed) {
    const err = new Error(
      `${decision.programme} is set to do-not-contact for this athlete. `
      + (decision.programme !== collegeName
        ? `This send was labelled ${collegeName}, but at least one recipient is on record at `
          + `${decision.programme}. `
        : '')
      + 'Nothing was drafted or sent. Change the contact stance on the relationship first.',
    );
    err.code = decision.reason;
    throw err;
  }
  return decision;
}
