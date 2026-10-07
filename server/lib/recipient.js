/**
 * THE RECIPIENT OF AN OUTREACH RELATIONSHIP — Phase 1C. One place that answers "who did this
 * outreach go to", so the safety and read paths stop answering it with their own JOIN coaches.
 *
 * TWO KINDS, NEVER INTERCHANGEABLE.
 *
 *   COACH            a person with a verified employment relationship (`coaches`)
 *   PROGRAMME_INBOX  a programme's own published endpoint (`programme_contacts`, Phase 1B)
 *
 * A resolved recipient carries what every safety path needs whatever the kind — kind, id,
 * the exact address, a display name, and the programme it belongs to — and then the facts
 * that only its own kind has, under its own key: `coach` (full name, title, email status,
 * currentness) or `programmeContact` (role, status). A programme inbox has no name, no title,
 * no tenure and no coach currentness, and nothing here invents one. Greetings are NOT decided
 * here: composition owns them (Step 1F), and a second greeting rule would drift from it.
 *
 * FAILS CLOSED. An unknown kind, a missing id, a record that does not exist, or a programme
 * that is not the one the caller expected raises RecipientError with a code. Nothing falls
 * back to the other kind, and nothing converts one kind into the other.
 *
 * ---------------------------------------------------------------------------
 * STEP 1C: EVERY OUTREACH ROW'S RECIPIENT IS STILL ITS COACH.
 *
 * `outreach.coach_id` and `outreach_send.coach_id` are NOT NULL REFERENCES coaches, and no
 * outreach table can name a programme contact. So `recipientRefOfOutreach` can only ever
 * produce a COACH reference, and the SQL fragments below join `coaches` only — with the same
 * INNER / LEFT semantics each caller had before, so every converted query returns exactly what
 * it returned. Step 1D adds programme_contact_id (exactly one of the two set) and these
 * fragments become the ONE place that learns to read it: a send cap, an opt-out, a confirm
 * list or a stance resolution written against them cannot quietly skip an inbox recipient,
 * which a hand-written JOIN coaches would have done.
 * ---------------------------------------------------------------------------
 */
import db from '../db/client.js';

export const RECIPIENT_KIND = Object.freeze({ COACH: 'COACH', PROGRAMME_INBOX: 'PROGRAMME_INBOX' });
const KINDS = new Set(Object.values(RECIPIENT_KIND));

export class RecipientError extends Error {
  constructor(code, message) { super(message); this.name = 'RecipientError'; this.code = code; }
}
export const RECIPIENT_ERROR = Object.freeze({
  KIND_UNKNOWN: 'RECIPIENT_KIND_UNKNOWN',
  ID_MISSING: 'RECIPIENT_ID_MISSING',
  NOT_FOUND: 'RECIPIENT_NOT_FOUND',
  PROGRAMME_MISMATCH: 'RECIPIENT_PROGRAMME_MISMATCH',
  OUTREACH_UNADDRESSED: 'RECIPIENT_OUTREACH_UNADDRESSED',
});

/* -------------------------------------------------------------------------- */
/* SQL: the recipient of an outreach / outreach_send row                       */
/* -------------------------------------------------------------------------- */

/**
 * Expressions for the recipient of the outreach row aliased `outreach`, joined as `as`.
 *
 *   join           the clause to put after FROM (INNER by default: a relationship whose
 *                  recipient cannot be read is excluded, exactly as JOIN coaches did)
 *   kind, id       the typed reference
 *   email          the address the relationship writes to
 *   programmeName  the programme name the recipient is filed under (coaches.school today)
 *   sport
 *   coachName, coachTitle, coachDivision
 *                  COACH-ONLY facts. Today every row is a coach; from 1D they are NULL for a
 *                  programme inbox rather than borrowed from somewhere else.
 */
export function outreachRecipientSql({ outreach = 'o', as = 'rcp', left = false } = {}) {
  return recipientColumns({ fk: `${outreach}.coach_id`, as, left });
}

/** The same, for an `outreach_send` row (which carries its own coach_id). */
export function sendRecipientSql({ send = 's', as = 'rcp', left = true } = {}) {
  return recipientColumns({ fk: `${send}.coach_id`, as, left });
}

function recipientColumns({ fk, as, left }) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(as)) throw new Error(`recipient SQL: bad alias ${as}`);
  return {
    join: `${left ? 'LEFT JOIN' : 'JOIN'} coaches ${as} ON ${as}.id = ${fk}`,
    kind: `'${RECIPIENT_KIND.COACH}'`,
    id: fk,
    email: `${as}.email`,
    programmeName: `${as}.school`,
    sport: `${as}.sport`,
    coachName: `${as}.full_name`,
    coachTitle: `${as}.position_title`,
    coachDivision: `${as}.division`,
  };
}

/* -------------------------------------------------------------------------- */
/* Typed references and resolution                                             */
/* -------------------------------------------------------------------------- */

/**
 * The typed reference an outreach (or outreach_send) row addresses. Step 1C: COACH, from
 * coach_id, always — and a row without one is refused rather than guessed at.
 */
export function recipientRefOfOutreach(row) {
  if (!row || row.coach_id == null || String(row.coach_id).trim() === '') {
    throw new RecipientError(RECIPIENT_ERROR.OUTREACH_UNADDRESSED, 'outreach row has no recipient reference');
  }
  return Object.freeze({ kind: RECIPIENT_KIND.COACH, id: String(row.coach_id) });
}

function coachRecipient(row) {
  return Object.freeze({
    kind: RECIPIENT_KIND.COACH,
    id: row.id,
    email: row.email ?? null,
    displayName: row.full_name ?? null,
    programme: Object.freeze({ name: row.school ?? null, sport: row.sport ?? null }),
    coach: Object.freeze({ full_name: row.full_name ?? null, position_title: row.position_title ?? null, division: row.division ?? null,
      email_status: row.email_status ?? null, currentness_status: row.currentness_status ?? null }),
  });
}

function programmeInboxRecipient(row) {
  return Object.freeze({
    kind: RECIPIENT_KIND.PROGRAMME_INBOX,
    id: row.contact_id,
    email: row.email,
    displayName: row.label,
    programme: Object.freeze({ name: row.college_name ?? null, sport: row.sport, college_id: row.college_id, athletics_entity_id: row.athletics_entity_id }),
    programmeContact: Object.freeze({ contact_role: row.contact_role, status: row.status }),
  });
}

/**
 * Resolve a typed reference to its record. `expectProgramme: { name, sport }` additionally
 * requires the recipient to be filed under exactly that programme.
 */
export function resolveRecipient(ref, { handle = db, expectProgramme = null } = {}) {
  if (!ref || !KINDS.has(ref.kind)) throw new RecipientError(RECIPIENT_ERROR.KIND_UNKNOWN, `unknown recipient kind ${ref?.kind}`);
  if (ref.id == null || String(ref.id).trim() === '') throw new RecipientError(RECIPIENT_ERROR.ID_MISSING, `${ref.kind} recipient has no id`);
  let recipient;
  if (ref.kind === RECIPIENT_KIND.COACH) {
    const row = handle.prepare('SELECT id, full_name, email, school, division, sport, position_title, email_status, currentness_status FROM coaches WHERE id = ?').get(ref.id);
    if (!row) throw new RecipientError(RECIPIENT_ERROR.NOT_FOUND, `no coach ${ref.id}`);
    recipient = coachRecipient(row);
  } else {
    const row = handle.prepare(`SELECT pc.*, c.name AS college_name FROM programme_contacts pc
      LEFT JOIN colleges c ON c.id = pc.college_id WHERE pc.contact_id = ?`).get(ref.id);
    if (!row) throw new RecipientError(RECIPIENT_ERROR.NOT_FOUND, `no programme contact ${ref.id}`);
    recipient = programmeInboxRecipient(row);
  }
  if (expectProgramme && (recipient.programme.name !== expectProgramme.name || recipient.programme.sport !== expectProgramme.sport)) {
    throw new RecipientError(RECIPIENT_ERROR.PROGRAMME_MISMATCH,
      `${ref.kind} ${ref.id} is filed under ${recipient.programme.name} (${recipient.programme.sport}), not ${expectProgramme.name} (${expectProgramme.sport})`);
  }
  return recipient;
}

/**
 * The recipient of the outreach relationship a tracking token belongs to, or null when the
 * token names no relationship (or names one whose recipient record is gone). For opt-outs:
 * the caller suppresses `email`, whatever the kind.
 */
export function recipientForOutreachToken(token, { handle = db } = {}) {
  const r = outreachRecipientSql();
  const row = handle.prepare(`SELECT ${r.kind} AS kind, ${r.id} AS id FROM outreach o ${r.join} WHERE o.token = ?`).get(token);
  return row ? resolveRecipient({ kind: row.kind, id: row.id }, { handle }) : null;
}

/** The athlete and recipient of one outreach relationship, or null when it does not exist. */
export function recipientForOutreach(outreachId, { handle = db } = {}) {
  const r = outreachRecipientSql();
  const row = handle.prepare(`SELECT o.athlete_id, ${r.kind} AS kind, ${r.id} AS id FROM outreach o ${r.join} WHERE o.id = ?`).get(outreachId);
  return row ? { athleteId: row.athlete_id, recipient: resolveRecipient({ kind: row.kind, id: row.id }, { handle }) } : null;
}
