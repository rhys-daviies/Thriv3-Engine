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
 * STEP 1D: AN OUTREACH ROW NAMES EXACTLY ONE OF coach_id / programme_contact_id.
 *
 * The five recipient tables carry both columns and a CHECK that exactly one is set
 * (migrate.js extendOutreachRecipients). The SQL fragments below are the ONE place that reads
 * them: every safety and read path written against a fragment — the send cap, opt-out
 * resolution, the confirm lists, contact stance, history, intelligence, engagement — sees a
 * programme-inbox relationship as what it is, and sees a coach relationship exactly as it did
 * when the fragment was a plain JOIN coaches. Every kind-dependent expression is a CASE on
 * which column is set, never a COALESCE across the two, so nothing of one kind is ever read
 * as the other's.
 *
 * Nothing in this build CREATES a programme-inbox relationship: no selection or send entry
 * point produces one (programmeContactsIsolation.test.js). The schema and these readers can
 * represent it; choosing one is Step 1E.
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
  OUTREACH_DOUBLY_ADDRESSED: 'RECIPIENT_OUTREACH_DOUBLY_ADDRESSED',
});

/* -------------------------------------------------------------------------- */
/* SQL: the recipient of an outreach / outreach_send row                       */
/* -------------------------------------------------------------------------- */

/**
 * Expressions for the recipient of the outreach row aliased `outreach`, joined under `as`.
 *
 *   join           the clause to put after FROM. Default INNER: a relationship whose recipient
 *                  record cannot be read is excluded, exactly as JOIN coaches excluded one.
 *                  `left: true` keeps it, as the LEFT JOIN coaches callers did.
 *   kind, id       the typed reference ('COACH' | 'PROGRAMME_INBOX', and its id)
 *   coachId, programmeContactId   the two raw columns (one is NULL)
 *   email          the address the relationship writes to
 *   label          the coach's full name, or the inbox's label ("Cornell Men's Soccer")
 *   programmeName  the programme the recipient is filed under (coaches.school for a coach;
 *                  the inbox's canonical colleges row for an inbox)
 *   sport, programmeDivision
 *   coachName, coachTitle, coachEmail, coachDivision
 *                  COACH-ONLY facts: NULL for a programme inbox, never borrowed from it
 */
export function outreachRecipientSql({ outreach = 'o', as = 'rcp', left = false } = {}) {
  return recipientColumns({ row: outreach, as, left });
}

/** The same, for an `outreach_send` row (which carries its own recipient columns). */
export function sendRecipientSql({ send = 's', as = 'rcp', left = true } = {}) {
  return recipientColumns({ row: send, as, left });
}

function recipientColumns({ row, as, left }) {
  for (const a of [row, as]) if (!/^[a-z_][a-z0-9_]*$/i.test(a)) throw new Error(`recipient SQL: bad alias ${a}`);
  const rc = as; const rp = `${as}_pc`; const rpc = `${as}_pcc`;
  const isCoach = `${row}.coach_id IS NOT NULL`;
  const byKind = (coachExpr, inboxExpr) => `(CASE WHEN ${isCoach} THEN ${coachExpr} WHEN ${row}.programme_contact_id IS NOT NULL THEN ${inboxExpr} END)`;
  return {
    join: [
      `LEFT JOIN coaches ${rc} ON ${rc}.id = ${row}.coach_id`,
      `LEFT JOIN programme_contacts ${rp} ON ${rp}.contact_id = ${row}.programme_contact_id`,
      `LEFT JOIN colleges ${rpc} ON ${rpc}.id = ${rp}.college_id`,
      ...(left ? [] : [`JOIN (SELECT 1) ${as}_present ON (${rc}.id IS NOT NULL OR ${rp}.contact_id IS NOT NULL)`]),
    ].join('\n    '),
    kind: byKind(`'${RECIPIENT_KIND.COACH}'`, `'${RECIPIENT_KIND.PROGRAMME_INBOX}'`),
    id: byKind(`${row}.coach_id`, `${row}.programme_contact_id`),
    coachId: `${row}.coach_id`,
    programmeContactId: `${row}.programme_contact_id`,
    email: byKind(`${rc}.email`, `${rp}.email`),
    label: byKind(`${rc}.full_name`, `${rp}.label`),
    programmeName: byKind(`${rc}.school`, `${rpc}.name`),
    sport: byKind(`${rc}.sport`, `${rp}.sport`),
    programmeDivision: byKind(`${rc}.division`, `${rpc}.division`),
    coachName: `${rc}.full_name`,
    coachTitle: `${rc}.position_title`,
    coachEmail: `${rc}.email`,
    coachDivision: `${rc}.division`,
  };
}

/* -------------------------------------------------------------------------- */
/* Typed references and resolution                                             */
/* -------------------------------------------------------------------------- */

const present = (v) => v != null && String(v).trim() !== '';

/**
 * The typed reference an outreach / outreach_send / attempt / message row addresses: COACH from
 * coach_id or PROGRAMME_INBOX from programme_contact_id. A row naming both, or neither, is
 * refused — the schema forbids both, and a row read without the columns is not guessed at.
 */
export function recipientRefOfOutreach(row) {
  const coach = present(row?.coach_id); const inbox = present(row?.programme_contact_id);
  if (coach && inbox) throw new RecipientError(RECIPIENT_ERROR.OUTREACH_DOUBLY_ADDRESSED, 'row names both a coach and a programme contact');
  if (!coach && !inbox) throw new RecipientError(RECIPIENT_ERROR.OUTREACH_UNADDRESSED, 'row has no recipient reference');
  return Object.freeze(coach ? { kind: RECIPIENT_KIND.COACH, id: String(row.coach_id) } : { kind: RECIPIENT_KIND.PROGRAMME_INBOX, id: String(row.programme_contact_id) });
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
 * The recipient of the outreach relationship a tracking token belongs to, or null when the token
 * names no relationship. For opt-outs: the caller suppresses `email`, whatever the kind. A
 * relationship whose recipient record is missing raises NOT_FOUND (the caller reports the token
 * as unresolved); it is never resolved to some other record.
 */
export function recipientForOutreachToken(token, { handle = db } = {}) {
  const row = handle.prepare('SELECT coach_id, programme_contact_id FROM outreach WHERE token = ?').get(token);
  return row ? resolveRecipient(recipientRefOfOutreach(row), { handle }) : null;
}

/** The athlete and recipient of one outreach relationship, or null when it does not exist. */
export function recipientForOutreach(outreachId, { handle = db } = {}) {
  const row = handle.prepare('SELECT athlete_id, coach_id, programme_contact_id FROM outreach WHERE id = ?').get(outreachId);
  return row ? { athleteId: row.athlete_id, recipient: resolveRecipient(recipientRefOfOutreach(row), { handle }) } : null;
}

/**
 * Every programme name an address is a PROGRAMME INBOX for — for do-not-contact. Every spelling
 * of the inbox's logical programme (athletics entity + sport), whatever the contact's status or
 * the programme row's: for a rule whose whole job is to stop a message, an address that is or
 * was a programme's inbox reaches that programme. `sport` null means any sport.
 */
export function programmeNamesForInboxAddress({ email, sport = null }, { handle = db } = {}) {
  const address = String(email ?? '').trim().toLowerCase();
  if (!address) return [];
  return handle.prepare(`
    SELECT DISTINCT c.name FROM programme_contacts pc
      JOIN colleges c ON c.athletics_entity_id = pc.athletics_entity_id AND c.sport = pc.sport
     WHERE pc.email = @address AND (@sport IS NULL OR pc.sport = @sport)
     ORDER BY c.name
  `).pluck().all({ address, sport });
}
