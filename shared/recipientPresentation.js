/**
 * HOW A RECIPIENT IS SHOWN, AND HOW A PROGRAMME INBOX IS GREETED — Phase 1F. Pure; shared by the
 * server composers and the operator screens so the two can never word it differently.
 *
 * A PROGRAMME INBOX IS NOT A PERSON. It is shown as "Programme Contact", with the programme it
 * belongs to as secondary context ("Cornell Men's Soccer"). Its label is never used as a
 * person's name, never prefixed with "Coach", and its address is never its primary identity.
 * A coach is shown exactly as before — by name.
 *
 * It is greeted "Hi Coach," and nothing else. A template written for a person is adapted only
 * at its greeting line; any other use of a coach-name token would put a name that does not
 * exist into the email, so composition for an inbox FAILS CLOSED on it rather than guessing.
 */
export const RECIPIENT_KIND = Object.freeze({ COACH: 'COACH', PROGRAMME_INBOX: 'PROGRAMME_INBOX' });

/** The human-facing name of a programme inbox. Never the enum. */
export const PROGRAMME_CONTACT_LABEL = 'Programme Contact';

/** The one line that tells an operator what a programme contact is. */
export const PROGRAMME_CONTACT_HINT = 'A shared programme inbox, not an individual coach';

/** The one greeting a programme inbox receives. */
export const INBOX_GREETING = 'Hi Coach,';

/** Why an inbox composition was refused. */
export const INBOX_COMPOSITION_REFUSAL = Object.freeze({
  NAME_TOKEN_OUTSIDE_GREETING: 'INBOX_TEMPLATE_USES_COACH_NAME',
  NO_GREETING: 'INBOX_TEMPLATE_HAS_NO_GREETING',
  BODY_GREETING: 'INBOX_BODY_GREETING_NOT_NEUTRAL',
  PERSON_NAMED: 'INBOX_BODY_NAMES_A_PERSON',
});

export class InboxCompositionError extends Error {
  constructor(code, message) { super(message); this.name = 'InboxCompositionError'; this.code = code; }
}

const COACH_TOKEN = /\{\{\s*coach_(?:first_)?name(?:\s*\|[^}]*)?\s*\}\}/i;
const GREETING_LINE = /^\s*(?:hi|hello|hey|dear)\s+\{\{\s*coach_(?:first_)?name(?:\s*\|[^}]*)?\s*\}\}\s*[,!:]?\s*$/i;
const NEUTRAL_LINE = /^\s*(?:hi|hello|hey|dear)\s+coach\s*[,!:]?\s*$/i;

/**
 * The presentation of a typed recipient: { kind, primary, secondary, isPerson }.
 *   COACH            primary = the coach's name (unchanged), secondary = their title
 *   PROGRAMME_INBOX  primary = "Programme Contact", secondary = the programme label
 */
export function presentRecipient({ kind, name = null, title = null, label = null } = {}) {
  if (kind === RECIPIENT_KIND.PROGRAMME_INBOX) {
    return Object.freeze({ kind, primary: PROGRAMME_CONTACT_LABEL, secondary: label || null, isPerson: false });
  }
  return Object.freeze({ kind: RECIPIENT_KIND.COACH, primary: name || null, secondary: title || null, isPerson: true });
}

/**
 * A template made fit for a programme inbox: its greeting line ("Hi {{coach_first_name}},",
 * "Dear {{coach_name}},", or already "Hi Coach,") becomes "Hi Coach,"; any OTHER coach-name
 * token refuses. A template that does not open with a greeting refuses too — the inbox's
 * greeting is a rule, not a hope.
 */
export function inboxTemplate(template) {
  const lines = String(template ?? '').split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first === -1 || !(GREETING_LINE.test(lines[first]) || NEUTRAL_LINE.test(lines[first]))) {
    throw new InboxCompositionError(INBOX_COMPOSITION_REFUSAL.NO_GREETING,
      'This template does not open with a greeting a programme inbox can receive ("Hi Coach,").');
  }
  const out = [...lines];
  out[first] = INBOX_GREETING;
  if (out.some((l) => COACH_TOKEN.test(l))) {
    throw new InboxCompositionError(INBOX_COMPOSITION_REFUSAL.NAME_TOKEN_OUTSIDE_GREETING,
      'This template names the coach outside its greeting. A programme inbox has no name to put there, so nothing was composed.');
  }
  return out.join('\n');
}

/** A subject fit for a programme inbox: any coach-name token refuses. */
export function inboxSubject(subject) {
  if (COACH_TOKEN.test(String(subject ?? ''))) {
    throw new InboxCompositionError(INBOX_COMPOSITION_REFUSAL.NAME_TOKEN_OUTSIDE_GREETING,
      'This subject names the coach. A programme inbox has no name to put there, so nothing was composed.');
  }
  return subject;
}

/**
 * A finished (possibly operator-edited) body addressed to a programme inbox must open with
 * exactly "Hi Coach," and must not carry the name of a person the operator was writing to.
 */
export function assertInboxBody(body, { personName = null } = {}) {
  const text = String(body ?? '');
  const firstLine = text.split('\n').find((l) => l.trim() !== '') ?? '';
  if (firstLine.trim() !== INBOX_GREETING) {
    throw new InboxCompositionError(INBOX_COMPOSITION_REFUSAL.BODY_GREETING,
      `A message to a programme inbox opens with "${INBOX_GREETING}". Nothing was drafted.`);
  }
  const person = String(personName ?? '').trim();
  if (person && !/^coach$/i.test(person) && text.toLowerCase().includes(person.toLowerCase())) {
    throw new InboxCompositionError(INBOX_COMPOSITION_REFUSAL.PERSON_NAMED,
      'This message names a person, but it is addressed to a shared programme inbox. Nothing was drafted.');
  }
  return text;
}

/**
 * A read-model row (programmeContactHistory, contactIntelligence, engagement, pending drafts —
 * which carry `recipient_kind`, `recipient_id`, `recipient_label` beside the coach-only fields)
 * presented the same way. A row without `recipient_kind` predates 1D's readers and is a coach.
 */
export function presentRecipientRow(row = {}) {
  const kind = row.recipient_kind === RECIPIENT_KIND.PROGRAMME_INBOX ? RECIPIENT_KIND.PROGRAMME_INBOX : RECIPIENT_KIND.COACH;
  return presentRecipient({ kind, name: row.coach_name ?? null, title: row.position_title ?? row.coach_title ?? null, label: row.recipient_label ?? null });
}

/** A key that never collides across kinds (an inbox has no coach_id). */
export function recipientRowKey(row = {}) {
  if (row.recipient_kind && row.recipient_id) return `${row.recipient_kind}:${row.recipient_id}`;
  return `${RECIPIENT_KIND.COACH}:${row.coach_id ?? ''}`;
}
