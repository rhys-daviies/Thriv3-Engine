import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  contactStanceFor, manualContactDecision, assertContactAllowed, CONTACT_REFUSAL,
} from './manualOutreachSafety.js';

/**
 * The column that meant nothing until now.
 *
 * `contact_stance` shipped as a declared safety decision and was read by no
 * sending or campaign code at all — an operator could set a programme to
 * do-not-contact and every send path would carry on. These tests are about the
 * two halves of making it real: that one stance blocks, and that the three
 * neighbouring columns do not.
 */

const ATHLETE = 'a-stance';
const OTHER = 'a-stance-other';

function relate(athleteId, collegeName, fields = {}, sport = 'mens-soccer') {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
      flagged, visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z')
  `).run(
    randomUUID(), athleteId, collegeName, sport,
    fields.request_state ?? 'none',
    fields.flagged ? 1 : 0,
    fields.visibility ?? 'default',
    fields.contact_stance ?? 'default',
  );
}

beforeEach(() => {
  db.exec('DELETE FROM athlete_programmes; DELETE FROM players;');
  for (const id of [ATHLETE, OTHER]) {
    db.prepare(`
      INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
      VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
    `).run(id, id);
  }
});

const ask = (collegeName, athleteId = ATHLETE, sport = 'mens-soccer') =>
  manualContactDecision({ athleteId, collegeName, sport });

describe('the one stance that blocks', () => {
  it('refuses do_not_contact', () => {
    relate(ATHLETE, 'Duke', { contact_stance: 'do_not_contact' });
    const d = ask('Duke');
    expect(d.allowed).toBe(false);
    expect(d.stance).toBe('do_not_contact');
    expect(d.reason).toBe(CONTACT_REFUSAL.DO_NOT_CONTACT);
  });

  it('throws with a code and names the programme', () => {
    relate(ATHLETE, 'Duke', { contact_stance: 'do_not_contact' });
    try {
      assertContactAllowed({ athleteId: ATHLETE, collegeName: 'Duke', sport: 'mens-soccer' });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe(CONTACT_REFUSAL.DO_NOT_CONTACT);
      // An operator writing to four schools needs to know which one refused.
      expect(err.message).toContain('Duke');
      expect(err.message).toMatch(/Nothing was drafted or sent/);
    }
  });
});

describe('the stances that permit this workflow', () => {
  it('permits manual_only', () => {
    relate(ATHLETE, 'Duke', { contact_stance: 'manual_only' });
    // A restriction on WHICH PATH may be used, not on whether contact may
    // happen. This is the path it names.
    expect(ask('Duke')).toMatchObject({ allowed: true, stance: 'manual_only' });
  });

  it('permits default', () => {
    relate(ATHLETE, 'Duke', { contact_stance: 'default' });
    expect(ask('Duke')).toMatchObject({ allowed: true, stance: 'default' });
  });

  it('permits a programme with no relationship at all', () => {
    // The absence of an opinion is not an opinion, and most programmes an
    // athlete matches have never been flagged, requested or suppressed.
    expect(ask('Duke')).toMatchObject({ allowed: true, stance: 'default' });
    expect(contactStanceFor({ athleteId: ATHLETE, collegeName: 'Duke', sport: 'mens-soccer' }))
      .toBe('default');
  });
});

describe('the three columns that are not contact decisions', () => {
  it('ignores visibility = suppressed', () => {
    relate(ATHLETE, 'Duke', { visibility: 'suppressed' });
    // Taken out of the actionable Top 100 is very often the REASON somebody
    // wants to write by hand.
    expect(ask('Duke').allowed).toBe(true);
  });

  it('ignores flagged', () => {
    relate(ATHLETE, 'Duke', { flagged: true });
    // A flag usually means we know the coach, which is a reason to write.
    expect(ask('Duke').allowed).toBe(true);
  });

  it('ignores request_state, requested or withdrawn', () => {
    relate(ATHLETE, 'Duke', { request_state: 'requested' });
    expect(ask('Duke').allowed).toBe(true);
    db.exec("UPDATE athlete_programmes SET request_state = 'withdrawn'");
    expect(ask('Duke').allowed).toBe(true);
  });

  it('blocks on do_not_contact even when every other column says go', () => {
    relate(ATHLETE, 'Duke', {
      request_state: 'requested', flagged: true, visibility: 'default',
      contact_stance: 'do_not_contact',
    });
    expect(ask('Duke').allowed).toBe(false);
  });
});

describe('scope', () => {
  it('is per athlete', () => {
    relate(ATHLETE, 'Duke', { contact_stance: 'do_not_contact' });
    relate(OTHER, 'Duke', { contact_stance: 'default' });
    expect(ask('Duke', ATHLETE).allowed).toBe(false);
    // One athlete's decision is not another's — the whole reason this is not
    // in the global suppressions table.
    expect(ask('Duke', OTHER).allowed).toBe(true);
  });

  it('is per sport', () => {
    relate(ATHLETE, 'Duke', { contact_stance: 'do_not_contact' }, 'womens-soccer');
    expect(ask('Duke', ATHLETE, 'mens-soccer').allowed).toBe(true);
    expect(ask('Duke', ATHLETE, 'womens-soccer').allowed).toBe(false);
  });

  it('is per programme', () => {
    relate(ATHLETE, 'Duke', { contact_stance: 'do_not_contact' });
    expect(ask('North Carolina').allowed).toBe(true);
  });

  it('answers default rather than throwing on missing identifiers', () => {
    expect(contactStanceFor({})).toBe('default');
    expect(contactStanceFor({ athleteId: ATHLETE })).toBe('default');
  });
});

describe('it never reaches the global suppressions table', () => {
  it('does not consult it, and does not write to it', async () => {
    db.prepare(`
      INSERT INTO suppressions (email, created_at, reason, source)
      VALUES ('coach@duke.test', '2026-09-01T00:00:00.000Z', 'unsubscribed', 'edge')
    `).run();
    relate(ATHLETE, 'Duke', { contact_stance: 'default' });

    // A suppressed ADDRESS is a different question from a do-not-contact
    // RELATIONSHIP, answered by a different check on the same send path.
    expect(ask('Duke').allowed).toBe(true);
    expect(db.prepare('SELECT COUNT(*) c FROM suppressions').get().c).toBe(1);

    // The CODE, with comments stripped — the file explains at length why it
    // does not read that table, and an error message saying so is not a query.
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./manualOutreachSafety.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/suppressions/i);
    expect(code).not.toMatch(/isSuppressed/);
  });
});
