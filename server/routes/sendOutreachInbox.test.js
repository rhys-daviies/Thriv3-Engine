import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * PHASE 1E (T) — THE MANUAL SEND BOUNDARY NEVER WRITES TO A PROGRAMME INBOX.
 *
 * Run with the legacy opt-in set on purpose: it is the widest mode an operator can choose. That
 * flag now widens only what is OFFERED, never what is sent — the send floor applies in full
 * either way — and a programme's inbox must still be refused before any coach row could be
 * minted for it — no coach row, no relationship, no compose — while a genuinely sendable coach
 * (seeded below) in the same request goes through exactly as before.
 */
process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';

const composed = [];
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => { composed.push(message); return { ok: true, sent: message.send }; }),
}));

const db = (await import('../db/client.js')).default;
const { sendOutreach } = await import('./sendOutreach.js');
const { programmeContactId } = await import('../lib/programmeContactEligibility.js');
const { PROGRAMME_INBOX_ADDRESS_NOT_TYPED } = await import('../lib/recipientSelection.js');
const { seedSendableCoach } = await import('../testCanonicalCoaches.js');

const T = '2026-09-20T10:00:00.000Z';
const INBOX = 'msoccer@butlerathletics.example';

describe('T. sendOutreach refuses a programme inbox, whatever mode the floor is in', () => {
  it('drafts to the coach and refuses the inbox, minting nothing for it', async () => {
    const athleteId = randomUUID();
    db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, graduation_year, email, video_id, video_chapters, public_slug, sport)
      VALUES (?, ?, ?, 'Nikau Brennan', 'Left Winger', 2027, 'athlete@example.com', 'aqz-KE-bpKQ', ?, ?, 'mens-soccer')`)
      .run(athleteId, T, T, JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]), randomUUID().slice(0, 10));
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-U950001', 'Butler University', 950001, 'SINGLE', 'test', ?)").run(T);
    db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES ('col-butler', ?, ?, 'Butler University', 'mens-soccer', 'NCAA D1', 1, 950001, 'AE-U950001')").run(T, T);
    db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, 'AE-U950001', 'col-butler', 'mens-soccer', ?, 'Butler University Men''s Soccer', 'TEAM_INBOX', 'https://butlerathletics.example/sports/mens-soccer/coaches', ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`)
      .run(programmeContactId('AE-U950001', 'mens-soccer', INBOX), INBOX, T, T, T, T);
    seedSendableCoach(db, { name: 'A. Whitfield', email: 'awhitfield@example.edu', school: 'Butler University', sport: 'mens-soccer' });

    const { results } = await sendOutreach({
      athleteId,
      coaches: [
        { name: 'A. Whitfield', email: 'awhitfield@example.edu', title: 'Head Coach' },
        { name: null, email: INBOX.toUpperCase(), title: "Men's Soccer (Team Email)" },
      ],
      subject: 'Recruitment Inquiry - Nikau Brennan',
      body: 'Dear A. Whitfield,\n\nI am writing about Nikau Brennan.\n\nBest regards,\nThriv3',
      greetingName: 'A. Whitfield',
      collegeName: 'Butler University',
      division: 'NCAA Division I',
      matchId: 'Butler University',
    });

    const refused = results.find((r) => r.email.toLowerCase() === INBOX);
    // Phase 1F: an inbox reached as a bare ADDRESS (not addressed as a programme contact by id)
    // is still refused — an address never becomes an inbox, and never a coach.
    expect(refused).toMatchObject({ status: 'not-eligible', reason: PROGRAMME_INBOX_ADDRESS_NOT_TYPED });
    expect(composed.map((m) => m.to)).toEqual(['awhitfield@example.edu']);
    expect(db.prepare('SELECT COUNT(*) n FROM coaches WHERE lower(email) = ?').get(INBOX).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach WHERE programme_contact_id IS NOT NULL').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send WHERE programme_contact_id IS NOT NULL').get().n).toBe(0);
  });
});
