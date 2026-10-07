/**
 * WHO A PROGRAMME IS APPROACHED THROUGH — Phase 1E. The one place the recipient hierarchy lives.
 *
 *   1. an eligible, current NAMED COACH            (coachIneligibility, unchanged)
 *   2. an eligible, current verified PROGRAMME INBOX (programmeContactProblems, unchanged)
 *   3. NO RECIPIENT                                 (fail closed)
 *
 * A programme inbox is a FALLBACK. It is considered only when no named coach at the programme
 * is eligible, so it can never outrank, sit beside or compete with one: the result is either a
 * list of coaches or exactly one inbox, never a mixture. It is never represented as a coach —
 * it carries `recipientKind: PROGRAMME_INBOX`, `programmeContactId`, and `coachId: null`, and
 * no name, title or role is invented for it.
 *
 * THE LEGACY TEAM-INBOX COACH ROWS. 168 `coaches` rows classify as `team-email`; every one is
 * email_status 'generic', so the Phase 8A floor already refuses them and they are LEADS, not
 * recipients. They remain reachable only under the explicit pre-8A opt-in
 * (THRIV3_ALLOW_LEGACY_COACHES), exactly as before — and even then only when no verified
 * programme inbox exists. A verified inbox always supersedes a fake-coach inbox row.
 *
 * AN OPT-OUT AT THE PROGRAMME BLOCKS THE FALLBACK. If any named coach at the programme has an
 * address on the suppression list, the inbox is not offered: a person there asked not to hear
 * from Thriv3, and their programme's shared inbox is very likely an inbox they read. Falling
 * back to it would route around the opt-out. Fails closed; an operator can still write by hand.
 *
 * Read-only. Nothing here sends, creates outreach, or decides what a message says.
 */
import db from '../db/client.js';
import { buildProgrammeContactContext, programmeContactProblems } from './programmeContactEligibility.js';
import { isSuppressed } from './suppressions.js';
import { RECIPIENT_KIND } from './recipient.js';

export const RECIPIENT_SELECTION = Object.freeze({
  COACH: RECIPIENT_KIND.COACH,
  PROGRAMME_INBOX: RECIPIENT_KIND.PROGRAMME_INBOX,
  NO_RECIPIENT: 'NO_RECIPIENT',
});

/** Why a programme inbox was not the recipient. Machine-readable, never a sentence. */
export const INBOX_NOT_SELECTED = Object.freeze({
  NAMED_COACH_AVAILABLE: 'PROGRAMME_INBOX_NAMED_COACH_AVAILABLE',
  NOT_NEEDED: 'PROGRAMME_INBOX_NOT_NEEDED',
  INELIGIBLE: 'PROGRAMME_INBOX_INELIGIBLE',
  SUPPRESSED: 'PROGRAMME_INBOX_SUPPRESSED',
  COACH_OPTED_OUT_AT_PROGRAMME: 'PROGRAMME_INBOX_COACH_OPTED_OUT_AT_PROGRAMME',
});

/** The reason a legacy team-inbox coach row is not pursued when a verified inbox exists. */
export const TEAM_ROW_SUPERSEDED = 'TEAM_INBOX_SUPERSEDED_BY_PROGRAMME_INBOX';

/** The refusal every delivery boundary raises for a programme inbox until composition (1F). */
export const PROGRAMME_INBOX_DELIVERY_DISABLED = 'PROGRAMME_INBOX_DELIVERY_DISABLED';

export class RecipientSelectionError extends Error {
  constructor(code, message) { super(message); this.name = 'RecipientSelectionError'; this.code = code; }
}

const has = (handle, t) => !!handle.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

/**
 * The context is the whole registry, so it is built once per DATA VERSION of the connection:
 * `data_version` moves when ANOTHER connection commits (a promotion — exactly when ownership
 * evidence can move), and `total_changes()` when THIS one writes. Selection may run on the
 * connection that also writes, so both are part of the key; a read-only dry run over a
 * hundred programmes still builds it once.
 */
let cached = null;
function context(handle) {
  const version = `${handle.pragma('data_version', { simple: true })}:${handle.prepare('SELECT total_changes() n').get().n}`;
  if (!cached || cached.handle !== handle || cached.version !== version) cached = { handle, version, ctx: buildProgrammeContactContext(handle) };
  return cached.ctx;
}

/**
 * The logical programme a (name, sport) pair names: its canonical colleges row and athletics
 * entity. A non-canonical spelling resolves through programme_row_links. Null when the name is
 * not a programme row — and a programme that cannot be identified has no inbox.
 */
export function programmeIdentity({ collegeName, sport }, { handle = db } = {}) {
  const row = handle.prepare('SELECT id, name, sport, athletics_entity_id FROM colleges WHERE name = ? AND sport = ?').get(collegeName, sport);
  if (!row) return null;
  let canon = row;
  if (has(handle, 'programme_row_links')) {
    const link = handle.prepare('SELECT canonical_college_id c FROM programme_row_links WHERE college_id = ?').get(row.id);
    if (link?.c) canon = handle.prepare('SELECT id, name, sport, athletics_entity_id FROM colleges WHERE id = ?').get(link.c) || row;
  }
  return { collegeId: canon.id, name: canon.name, sport: canon.sport, athleticsEntityId: canon.athletics_entity_id || row.athletics_entity_id || null };
}

/** Does this programme_contacts row belong to that programme (same athletics entity and sport)? */
export function inboxBelongsTo(inbox, programme) {
  return !!(inbox && programme && programme.athleticsEntityId
    && inbox.athletics_entity_id === programme.athleticsEntityId && inbox.sport === programme.sport);
}

const ROLE_ORDER = { RECRUITING_INBOX: 0, TEAM_INBOX: 1 };
const inboxOrder = (a, b) => (ROLE_ORDER[a.contact_role] ?? 9) - (ROLE_ORDER[b.contact_role] ?? 9)
  || a.email.localeCompare(b.email) || a.contact_id.localeCompare(b.contact_id);

/** The typed candidate a pursuit plan carries for an inbox. Nothing coach-shaped is invented. */
export function inboxCandidate(row) {
  return {
    recipientKind: RECIPIENT_KIND.PROGRAMME_INBOX,
    programmeContactId: row.contact_id,
    coachId: null,
    name: null,
    label: row.label,
    email: row.email,
    title: null,
    role: 'programme-inbox',
    contactRole: row.contact_role,
    emailStatus: 'verified',
    usable: true,
  };
}

/**
 * Every VERIFIED programme_contacts row filed under this programme, judged NOW, split into the
 * eligible (in selection order) and the refused (with every reason).
 */
export function programmeInboxesFor({ collegeName, sport }, { handle = db, now = new Date() } = {}) {
  const programme = programmeIdentity({ collegeName, sport }, { handle });
  if (!programme || !programme.athleticsEntityId || !has(handle, 'programme_contacts')) return { programme, eligible: [], refused: [] };
  const rows = handle.prepare(`SELECT * FROM programme_contacts WHERE athletics_entity_id = ? AND sport = ? AND status = 'VERIFIED'`)
    .all(programme.athleticsEntityId, programme.sport).sort(inboxOrder);
  if (!rows.length) return { programme, eligible: [], refused: [] };
  const ctx = context(handle);
  const eligible = []; const refused = [];
  for (const r of rows) {
    const problems = programmeContactProblems(r, ctx, { now });
    if (problems.length) refused.push({ row: r, reason: INBOX_NOT_SELECTED.INELIGIBLE, problems });
    else if (isSuppressed(r.email)) refused.push({ row: r, reason: INBOX_NOT_SELECTED.SUPPRESSED, problems: [] });
    else eligible.push(r);
  }
  return { programme, eligible, refused };
}

/**
 * THE HIERARCHY. Given what the coach floor already decided, choose the recipients.
 *
 *   named       eligible named coaches, already ordered and deduplicated by the caller
 *   teamRows    `team-email` coach rows that passed the floor (only under the legacy opt-in)
 *   staff       every coach row at the programme, for the opt-out rule
 *
 * Returns { kind, recipients[], inbox: {considered, eligible[], refused[], blockedBy}, teamRowsSuperseded }
 * where `recipients` is the named coaches (COACH), exactly one inbox (PROGRAMME_INBOX), the
 * legacy team row (COACH, pre-8A opt-in only), or empty (NO_RECIPIENT).
 */
export function chooseRecipients({ collegeName, sport, named = [], teamRows = [], staff = [] }, { handle = db, now = new Date() } = {}) {
  if (named.length) {
    return { kind: RECIPIENT_SELECTION.COACH, recipients: named, inbox: { considered: false, eligible: [], refused: [], blockedBy: INBOX_NOT_SELECTED.NAMED_COACH_AVAILABLE }, teamRowsSuperseded: false };
  }
  const found = programmeInboxesFor({ collegeName, sport }, { handle, now });
  const optedOut = staff.some((c) => String(c.full_name ?? '').trim() !== '' && c.email && isSuppressed(c.email));
  if (found.eligible.length && optedOut) {
    // The legacy opt-in keeps its pre-8A behaviour (a team row, as before); otherwise nobody.
    return teamRows.length
      ? { kind: RECIPIENT_SELECTION.COACH, recipients: [teamRows[0]], inbox: { considered: true, ...found, blockedBy: INBOX_NOT_SELECTED.COACH_OPTED_OUT_AT_PROGRAMME }, teamRowsSuperseded: false }
      : { kind: RECIPIENT_SELECTION.NO_RECIPIENT, recipients: [], inbox: { considered: true, ...found, blockedBy: INBOX_NOT_SELECTED.COACH_OPTED_OUT_AT_PROGRAMME }, teamRowsSuperseded: false };
  }
  if (found.eligible.length) {
    return { kind: RECIPIENT_SELECTION.PROGRAMME_INBOX, recipients: [inboxCandidate(found.eligible[0])], inbox: { considered: true, ...found, blockedBy: null }, teamRowsSuperseded: true };
  }
  if (teamRows.length) {
    return { kind: RECIPIENT_SELECTION.COACH, recipients: [teamRows[0]], inbox: { considered: true, ...found, blockedBy: null }, teamRowsSuperseded: false };
  }
  return { kind: RECIPIENT_SELECTION.NO_RECIPIENT, recipients: [], inbox: { considered: true, ...found, blockedBy: null }, teamRowsSuperseded: false };
}

/**
 * Re-prove, at a later step, that a programme contact is still an eligible inbox for this
 * programme: it exists, it is filed under the same athletics entity and sport, and it passes
 * the floor now. Throws RecipientSelectionError; never falls back to anything else.
 */
export function assertProgrammeInbox(programmeContactId, { collegeName, sport }, { handle = db, now = new Date(), requireEligible = true } = {}) {
  const row = has(handle, 'programme_contacts') ? handle.prepare('SELECT * FROM programme_contacts WHERE contact_id = ?').get(programmeContactId) : null;
  if (!row) throw new RecipientSelectionError('PROGRAMME_CONTACT_NOT_FOUND', `No programme contact ${programmeContactId}`);
  const programme = programmeIdentity({ collegeName, sport }, { handle });
  if (!inboxBelongsTo(row, programme)) {
    throw new RecipientSelectionError('CAMPAIGN_PROGRAMME_MISMATCH',
      `Programme contact ${programmeContactId} is not filed under ${collegeName} (${sport}).`);
  }
  if (requireEligible) {
    const problems = programmeContactProblems(row, context(handle), { now });
    if (problems.length) throw new RecipientSelectionError('PROGRAMME_CONTACT_NOT_ELIGIBLE', `Programme contact ${programmeContactId} is not eligible: ${problems.join(', ')}`);
  }
  return row;
}

/** Is this address any programme's inbox, verified or not? For the delivery gates. */
export function isProgrammeInboxAddress(email, { handle = db } = {}) {
  const address = String(email ?? '').trim().toLowerCase();
  if (!address || !has(handle, 'programme_contacts')) return false;
  return !!handle.prepare('SELECT 1 FROM programme_contacts WHERE email = ? LIMIT 1').get(address);
}
