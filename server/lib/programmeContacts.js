/**
 * PROGRAMME CONTACT INTELLIGENCE — the read side (Phase 1B). READ-ONLY, and NOT A SEND PATH.
 *
 * What a programme card may show about a programme's own published inbox: kind
 * PROGRAMME_INBOX, a registry-derived label ("Cornell Men's Soccer"), the address, its role,
 * and where and when it was observed. Only rows that pass the programme-contact floor NOW are
 * returned; a VERIFIED row that has aged out of the current cycle, or whose ownership evidence
 * has since moved, is withheld (and counted) rather than shown.
 *
 * `sendable: false` on every contact means THIS LIST cannot be used to address one: no pursuit
 * plan, manual outreach route or composer reads this module (a test enforces it). An inbox CAN
 * be written to - since Phase 1F the manual path drafts to the one inbox the hierarchy selects
 * (verified named coach -> verified programme inbox -> no contact, recipientSelection.js), by
 * id and re-proved at send time - but never through this read. (Corrected in Phase 5, #14.)
 */
import db from '../db/client.js';
import { buildProgrammeContactContext, programmeContactProblems } from './programmeContactEligibility.js';
import { freshnessOf } from './refresh/freshness.js';
import { isSuppressed } from './suppressions.js';

export const PROGRAMME_INBOX = 'PROGRAMME_INBOX';

/**
 * The context is the whole registry (colleges, domains, entities, aliases, links), so it is
 * built once per DATA VERSION rather than per request. `data_version` changes when ANOTHER
 * connection commits (a promotion, a refresh — exactly when ownership evidence can move), but
 * NOT when this connection writes; Phase 1F adds `total_changes()`, which does. Without it a
 * write through this same connection (a domain verified, a programme row deactivated) left the
 * cached verdicts standing. Both are O(1) reads, so an unchanged database still builds once.
 */
let cached = null;
function context(handle) {
  const version = `${handle.pragma('data_version', { simple: true })}:${handle.prepare('SELECT total_changes() n').get().n}`;
  if (!cached || cached.handle !== handle || cached.version !== version) cached = { handle, version, ctx: buildProgrammeContactContext(handle) };
  return cached.ctx;
}

function shape(row, now) {
  return {
    kind: PROGRAMME_INBOX,
    contact_id: row.contact_id,
    label: row.label,
    email: row.email,
    contact_role: row.contact_role,
    sendable: false,
    provenance: {
      observed_on_url: row.observed_on_url,
      observed_at: row.observed_at,
      currentness_checked_at: row.currentness_checked_at,
      source_kind: row.source_kind,
      source_tier: row.source_tier,
      freshness: freshnessOf('programme_contact', row, { now }).state,
    },
  };
}

/**
 * Eligible programme contacts for one colleges row (any spelling of the programme: the lookup
 * is by its logical programme, athletics entity + sport). Returns null when there is no such
 * row; otherwise { programme, contacts[], withheld }.
 */
export function programmeContactsForCollege(collegeId, { handle = db, now = new Date() } = {}) {
  const has = handle.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='programme_contacts'").get();
  const college = handle.prepare('SELECT id, name, sport, division, active, athletics_entity_id FROM colleges WHERE id = ?').get(collegeId);
  if (!college) return null;
  const programme = { college_id: college.id, name: college.name, sport: college.sport, division: college.division, active: college.active, athletics_entity_id: college.athletics_entity_id };
  if (!has || !college.athletics_entity_id) return { programme, contacts: [], withheld: 0, optedOut: 0 };
  const rows = handle.prepare(`SELECT * FROM programme_contacts
    WHERE athletics_entity_id = ? AND sport = ? AND status = 'VERIFIED' ORDER BY contact_role DESC, email`).all(college.athletics_entity_id, college.sport);
  if (!rows.length) return { programme, contacts: [], withheld: 0, optedOut: 0 };
  const ctx = context(handle);
  const eligible = rows.filter((r) => programmeContactProblems(r, ctx, { now }).length === 0);
  // Phase 5 (#3): an inbox that has opted out is never listed as a contact; it is counted apart
  // from the ineligible ones, because "opted out" and "not current" are different facts.
  const offered = eligible.filter((r) => !isSuppressed(r.email));
  return {
    programme,
    contacts: offered.map((r) => shape(r, now)),
    withheld: rows.length - eligible.length,
    optedOut: eligible.length - offered.length,
  };
}
