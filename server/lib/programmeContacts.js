/**
 * PROGRAMME CONTACT INTELLIGENCE — the read side (Phase 1B). READ-ONLY, and NOT A SEND PATH.
 *
 * What a programme card may show about a programme's own published inbox: kind
 * PROGRAMME_INBOX, a registry-derived label ("Cornell Men's Soccer"), the address, its role,
 * and where and when it was observed. Only rows that pass the programme-contact floor NOW are
 * returned; a VERIFIED row that has aged out of the current cycle, or whose ownership evidence
 * has since moved, is withheld (and counted) rather than shown.
 *
 * `sendable: false` on every contact: no pursuit plan, manual outreach route or composer reads
 * this module (a test enforces it). The selection hierarchy (verified named coach -> verified
 * programme inbox -> no contact) lives in recipientSelection.js (Step 1E), and no delivery
 * boundary sends to an inbox yet.
 */
import db from '../db/client.js';
import { buildProgrammeContactContext, programmeContactProblems } from './programmeContactEligibility.js';
import { freshnessOf } from './refresh/freshness.js';

export const PROGRAMME_INBOX = 'PROGRAMME_INBOX';

/**
 * The context is the whole registry (colleges, domains, entities, aliases, links), so it is
 * built once per DATA VERSION of this connection rather than per request. `data_version`
 * changes whenever another connection commits — a promotion, a refresh — which is exactly
 * when ownership evidence can have moved; this connection itself never writes these tables.
 */
let cached = null;
function context(handle) {
  const version = `${handle.pragma('data_version', { simple: true })}`;
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
  if (!has || !college.athletics_entity_id) return { programme, contacts: [], withheld: 0 };
  const rows = handle.prepare(`SELECT * FROM programme_contacts
    WHERE athletics_entity_id = ? AND sport = ? AND status = 'VERIFIED' ORDER BY contact_role DESC, email`).all(college.athletics_entity_id, college.sport);
  if (!rows.length) return { programme, contacts: [], withheld: 0 };
  const ctx = context(handle);
  const eligible = rows.filter((r) => programmeContactProblems(r, ctx, { now }).length === 0);
  return { programme, contacts: eligible.map((r) => shape(r, now)), withheld: rows.length - eligible.length };
}
