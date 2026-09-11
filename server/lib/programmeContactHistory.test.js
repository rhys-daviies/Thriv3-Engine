import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { historyForAthleteProgramme } from './programmeContactHistory.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * HISTORY THAT SAYS ONLY WHAT THE TABLES HOLD.
 *
 * The version this replaces got three things wrong by naming rather than by
 * arithmetic, and each one told the operator something false:
 *
 *   it called `outreach.sent_at` the LAST send — it is the first, by design
 *   it counted a DRAFT as a message
 *   it showed no origin, so a campaign message read as a hand-written one
 */

const ATHLETE = 'a-history';
const OTHER = 'a-history-other';
const SCHOOL = 'Duke';
const SPORT = 'mens-soccer';

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function coach({ name, email, school = SCHOOL, sport = SPORT, title = 'Head Coach' }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', ?, ?)
  `).run(id, name, email, school, sport, title);
  return id;
}

function outreach({ athleteId = ATHLETE, coachId, drafted = null, sent = null, revoked = null }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at, revoked_at)
    VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', ?, ?, ?)
  `).run(id, athleteId, coachId, randomUUID(), drafted, sent, revoked);
  return id;
}

let seq = 0;
function message({ outreachId, athleteId = ATHLETE, coachId, state, sentAt = null, draftedAt = '2026-09-01T10:00:00.000Z', origin = null }) {
  db.prepare(`
    INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id,
      college_name, sport, origin, policy_version, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LEGACY_UNKNOWN', ?, '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), outreachId, ++seq, draftedAt, sentAt, athleteId, coachId, SCHOOL, SPORT, origin, state);
}

const ask = (athleteId = ATHLETE, collegeName = SCHOOL, sport = SPORT) =>
  historyForAthleteProgramme({ athleteId, collegeName, sport });

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM players; DELETE FROM coaches;`);
  athlete(ATHLETE);
  athlete(OTHER);
});

// ---------------------------------------------------------------------------

describe('nothing has happened', () => {
  it('answers with an empty list, which is a fact rather than a gap', () => {
    coach({ name: 'A Coach', email: 'a@duke.test' });
    expect(ask()).toEqual([]);
  });

  it('answers empty for missing identifiers rather than throwing', () => {
    expect(historyForAthleteProgramme({})).toEqual([]);
    expect(historyForAthleteProgramme({ athleteId: ATHLETE })).toEqual([]);
  });
});

describe('a draft is not a send', () => {
  it('reports drafts without ever claiming a message reached anyone', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, drafted: '2026-09-02T10:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.DRAFT });

    const [row] = ask();
    expect(row.has_confirmed_send).toBe(false);
    expect(row.accepted_count).toBe(0);
    expect(row.draft_count).toBe(1);
    expect(row.first_confirmed_send_at).toBeNull();
    expect(row.last_confirmed_send_at).toBeNull();
    // The old field name called this "1 message", on a body nobody sent.
    expect(row.record_count).toBe(1);
    expect(row.last_drafted_at).toBe('2026-09-02T10:00:00.000Z');
  });

  it('cannot accumulate open drafts, because the schema forbids it', () => {
    /**
     * `idx_outreach_send_one_open` is UNIQUE on `outreach_id` WHERE the state
     * is DRAFT, QUEUED or SENDING — at most one open message per relationship,
     * which is also why a re-draft reuses the row rather than piling up. So
     * `draft_count` is 0 or 1 and a "3 drafts" line is unreachable.
     */
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, drafted: '2026-09-02T10:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.DRAFT });
    expect(() => message({ outreachId: o, coachId: c, state: MESSAGE_STATE.DRAFT }))
      .toThrowError(/UNIQUE/);
    expect(ask()[0].draft_count).toBe(1);
  });
});

describe('a confirmed send', () => {
  it('reports the LAST one, not the first', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    // `outreach.sent_at` is first-wins — markOutreachSent writes it only when
    // null, so a delivery window cannot move.
    const o = outreach({ coachId: c, sent: '2026-09-01T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-01T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-20T11:00:00.000Z' });

    const [row] = ask();
    expect(row.first_confirmed_send_at).toBe('2026-09-01T11:00:00.000Z');
    expect(row.last_confirmed_send_at).toBe('2026-09-20T11:00:00.000Z');
    expect(row.accepted_count).toBe(2);
    expect(row.has_confirmed_send).toBe(true);
  });

  it('counts only accepted messages as sent, alongside drafts', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-01T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-01T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.DRAFT });

    const [row] = ask();
    expect(row.accepted_count).toBe(1);
    expect(row.draft_count).toBe(1);
    expect(row.record_count).toBe(2);
  });

  it('trusts the relationship timestamp when no message row survives', () => {
    // 41 historical relationships carry a confirmation with no outreach_send
    // row behind it. Saying "never sent" would be worse than saying "sent".
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    outreach({ coachId: c, sent: '2025-11-01T11:00:00.000Z' });
    const [row] = ask();
    expect(row.has_confirmed_send).toBe(true);
    expect(row.first_confirmed_send_at).toBe('2025-11-01T11:00:00.000Z');
    expect(row.accepted_count).toBe(0);
  });
});

describe('origin', () => {
  it('reports manual and campaign distinctly', () => {
    const a = coach({ name: 'Manual Coach', email: 'm@duke.test' });
    const b = coach({ name: 'Campaign Coach', email: 'c@duke.test', title: 'Assistant' });
    const oa = outreach({ coachId: a, sent: '2026-09-02T11:00:00.000Z' });
    const ob = outreach({ coachId: b, sent: '2026-09-03T11:00:00.000Z' });
    message({ outreachId: oa, coachId: a, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });
    message({ outreachId: ob, coachId: b, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-03T11:00:00.000Z', origin: 'campaign' });

    const byName = Object.fromEntries(ask().map((r) => [r.coach_name, r]));
    expect(byName['Manual Coach'].origins).toEqual(['manual']);
    expect(byName['Campaign Coach'].origins).toEqual(['campaign']);
  });

  it('CARRIES NULL THROUGH AS NULL, inventing nothing', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-02T11:00:00.000Z', origin: null });

    // Every row written before the column existed has this, and so would a
    // future path that forgot to classify itself. Guessing "manual" is the
    // exact fabrication the column was added to prevent.
    expect(ask()[0].origins).toEqual([null]);
  });

  it('reports both when one relationship carries both kinds', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-02T11:00:00.000Z', origin: 'campaign' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-09T11:00:00.000Z', origin: 'manual' });
    expect(ask()[0].origins.sort()).toEqual(['campaign', 'manual']);
  });
});

describe('campaign contact is included, not hidden', () => {
  it('appears in the history an operator reads before writing', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-02T11:00:00.000Z', origin: 'campaign' });

    /**
     * The operator's question is "has anyone written to this coach for this
     * athlete". The answer does not depend on which half of the product did
     * it — hiding campaign messages would let somebody write a first
     * introduction to a coach who had already had three.
     */
    expect(ask()).toHaveLength(1);
    expect(ask()[0].origins).toEqual(['campaign']);
  });
});

describe('revocation', () => {
  it('is reported rather than hidden, and does not erase the send', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z', revoked: '2026-09-05T00:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });

    const [row] = ask();
    // The message happened. What changed is that its link no longer resolves.
    expect(row.has_confirmed_send).toBe(true);
    expect(row.revoked_at).toBe('2026-09-05T00:00:00.000Z');
  });
});

describe('scope', () => {
  it('is per athlete', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    outreach({ athleteId: OTHER, coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    expect(ask(ATHLETE)).toEqual([]);
    expect(ask(OTHER)).toHaveLength(1);
  });

  it('is per programme and per sport', () => {
    const here = coach({ name: 'Here', email: 'h@duke.test' });
    const elsewhere = coach({ name: 'Elsewhere', email: 'e@unc.test', school: 'North Carolina' });
    const womens = coach({ name: 'Womens', email: 'w@duke.test', sport: 'womens-soccer' });
    for (const id of [here, elsewhere, womens]) outreach({ coachId: id, sent: '2026-09-02T11:00:00.000Z' });

    expect(ask().map((r) => r.coach_name)).toEqual(['Here']);
    expect(ask(ATHLETE, 'North Carolina').map((r) => r.coach_name)).toEqual(['Elsewhere']);
    expect(ask(ATHLETE, SCHOOL, 'womens-soccer').map((r) => r.coach_name)).toEqual(['Womens']);
  });
});

describe('one address cannot be double-counted inside one programme', () => {
  /**
   * THE SCHEMA ALREADY GUARANTEES THIS, which is why history aggregates on
   * `coach_id` and does not try to be clever about addresses.
   *
   * `idx_coaches_identity` is UNIQUE (email, school, sport), so within one
   * programme an address is exactly one coach row and exactly one `outreach`
   * relationship — `outreach` is itself UNIQUE (athlete_id, coach_id). There
   * is no arrangement of rows that lists one recipient twice here.
   *
   * Collapsing on the address would also be WRONG rather than merely
   * unnecessary: school and sport are in that key precisely because a generic
   * address like msoccer@cornell.edu is shared across a staff, so merging on
   * it would report a message to one person as a message to all of them.
   */
  it('refuses a second coach row for the same address at the same programme', () => {
    coach({ name: 'A Coach', email: 'shared@duke.test' });
    expect(() => coach({ name: 'Another Coach', email: 'shared@duke.test', title: 'Assistant' }))
      .toThrowError(/UNIQUE/);
  });

  it('keeps one line per recipient', () => {
    const c = coach({ name: 'A Coach', email: 'shared@duke.test' });
    outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    const rows = ask();
    expect(rows).toHaveLength(1);
    expect(rows[0].coach_email).toBe('shared@duke.test');
  });

  it('splits across programmes when the same address is filed under two schools', () => {
    // The remaining duplicate shape: one address, two school labels. It
    // divides history between two programmes rather than inflating either —
    // and F1's send-path check already resolves the stance across both.
    const here = coach({ name: 'A Coach', email: 'shared@duke.test' });
    const there = coach({ name: 'A Coach', email: 'shared@duke.test', school: 'Elsewhere' });
    outreach({ coachId: here, sent: '2026-09-02T11:00:00.000Z' });
    outreach({ coachId: there, sent: '2026-09-03T11:00:00.000Z' });

    expect(ask(ATHLETE, SCHOOL)).toHaveLength(1);
    expect(ask(ATHLETE, 'Elsewhere')).toHaveLength(1);
  });
});

describe('ordering', () => {
  it('puts the most recent activity first', () => {
    const older = coach({ name: 'Older', email: 'o@duke.test' });
    const newer = coach({ name: 'Newer', email: 'n@duke.test', title: 'Assistant' });
    outreach({ coachId: older, sent: '2026-09-01T11:00:00.000Z' });
    outreach({ coachId: newer, sent: '2026-09-10T11:00:00.000Z' });
    expect(ask().map((r) => r.coach_name)).toEqual(['Newer', 'Older']);
  });
});

describe('it writes nothing', () => {
  it('leaves every table exactly as it found it', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-02T11:00:00.000Z' });

    const census = () => ['outreach', 'outreach_send', 'coaches', 'athlete_programmes']
      .map((t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
    const before = census();
    ask();
    ask();
    expect(census()).toEqual(before);
  });
});
