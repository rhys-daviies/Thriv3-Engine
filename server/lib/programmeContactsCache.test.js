import { describe, it, expect } from 'vitest';
import db from '../db/client.js';
import { programmeContactsForCollege } from './programmeContacts.js';
import { programmeContactId } from './programmeContactEligibility.js';

/**
 * PHASE 1F — THE VALIDATION CACHE NOTICES THIS CONNECTION'S OWN WRITES.
 *
 * The programme-contact context (the whole registry) is cached per data version. Before 1F the
 * version was `data_version` alone, which moves only when ANOTHER connection commits — so a
 * write made through the same connection (here: the programme row deactivated) left the cached
 * verdict standing, and an inbox whose programme had just been switched off was still shown as
 * eligible. Keyed on total_changes() as well, the very next read re-judges it.
 */
const T = '2026-09-01T00:00:00.000Z';
const ENT = 'AE-U940001';
const EMAIL = 'msoccer@cacheathletics.example';

describe('programmeContactsForCollege — cache correctness', () => {
  it('re-judges an inbox after a write through the SAME connection', () => {
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?, 'Cache College', 940001, 'SINGLE', 'test', ?)").run(ENT, T);
    db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES ('c-cache', ?, ?, 'Cache College', 'mens-soccer', 'NCAA D3', 1, 940001, ?)").run(T, T, ENT);
    db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES ('cacheathletics.example', 940001, 'VERIFIED', 'ATHLETICS_SITE', '[]', '[940001]', 'TEST', 'CERTAIN', ?)").run(T);
    const seen = new Date(Date.now() - 3600_000).toISOString();
    db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, ?, 'c-cache', 'mens-soccer', ?, 'Cache College Men''s Soccer', 'TEAM_INBOX', 'https://cacheathletics.example/sports/mens-soccer/coaches', ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
      .run(programmeContactId(ENT, 'mens-soccer', EMAIL), ENT, EMAIL, seen, seen, T, T);

    const before = programmeContactsForCollege('c-cache');
    expect(before.contacts.map((c) => c.email)).toEqual([EMAIL]);       // the context is now cached

    // the same connection deactivates the programme row: the inbox's floor now fails
    db.prepare("UPDATE colleges SET active = 0 WHERE id = 'c-cache'").run();
    const after = programmeContactsForCollege('c-cache');
    expect(after.contacts).toEqual([]);
    expect(after.withheld).toBe(1);

    // and back: the next read follows the write again, without a second connection
    db.prepare("UPDATE colleges SET active = 1 WHERE id = 'c-cache'").run();
    expect(programmeContactsForCollege('c-cache').contacts).toHaveLength(1);
  });
});
