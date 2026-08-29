import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

process.env.RECRUITMATCH_DB = ':memory:';
const { default: db } = await import('../db/client.js');
const {
  pendingDrafts, pendingBatches, confirmSent, draftSummary, BATCH_GAP_MINUTES,
} = await import('./confirmSends.js');
const { markOutreachDrafted, markOutreachSent } = await import('./outreach.js');

/**
 * The draft → confirm boundary.
 *
 * The property under test is negative and is the whole point: a message that
 * reached Outlook but was never confirmed must not appear in ANY denominator.
 * `sent_at` used to be stamped when the draft window opened, so drafting
 * twenty and sending fifteen recorded twenty sends — and every reply rate,
 * every evidence comparison and the per-inbox send cap was computed over the
 * larger number.
 */

const ATHLETE = 'athlete-1';

function seed() {
  db.exec('DELETE FROM outreach; DELETE FROM coaches; DELETE FROM players;');
  db.prepare(`INSERT INTO players (id, full_name, position, sport, created_date, updated_date)
    VALUES (?, 'Rhys Davies', 'DEFENSE', 'mens-soccer', '2026-01-01', '2026-01-01')`).run(ATHLETE);
}

let seq = 0;
/** One outreach row, at a chosen draft time. */
function draft({ school, draftedAt, sentAt = null }) {
  seq += 1;
  const coachId = randomUUID();
  db.prepare(`INSERT INTO coaches (id, full_name, email, school, sport, created_at)
    VALUES (?, ?, ?, ?, 'mens-soccer', '2026-01-01')`)
    .run(coachId, `Coach ${seq}`, `c${seq}@${school.replace(/\W/g, '')}.edu`, school);
  const id = randomUUID();
  db.prepare(`INSERT INTO outreach (id, athlete_id, coach_id, token, drafted_at, sent_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ATHLETE, coachId, `tok-${seq}`, draftedAt, sentAt, draftedAt);
  return id;
}

const AT = (min) => new Date(Date.UTC(2026, 7, 28, 9, min)).toISOString();

beforeEach(seed);

describe('what counts as pending', () => {
  it('lists a draft that has not been confirmed', () => {
    draft({ school: 'Butler', draftedAt: AT(0) });
    expect(pendingDrafts()).toHaveLength(1);
    expect(draftSummary().pending).toBe(1);
    expect(draftSummary().confirmed_sent).toBe(0);
  });

  it('does not list one already confirmed', () => {
    draft({ school: 'Butler', draftedAt: AT(0), sentAt: AT(5) });
    expect(pendingDrafts()).toHaveLength(0);
    expect(draftSummary().confirmed_sent).toBe(1);
  });

  /**
   * A row whose compose threw. It exists because `createOutreach` runs before
   * the AppleScript, and it must not be confirmable: nothing was ever written,
   * so there is nothing a human could have sent.
   */
  it('does not list one that was never drafted', () => {
    const id = draft({ school: 'Butler', draftedAt: AT(0) });
    db.prepare('UPDATE outreach SET drafted_at = NULL WHERE id = ?').run(id);
    expect(pendingDrafts()).toHaveLength(0);
    expect(draftSummary().never_drafted).toBe(1);
    expect(confirmSent([id]).confirmed).toBe(0);
  });

  it('does not list a revoked one', () => {
    const id = draft({ school: 'Butler', draftedAt: AT(0) });
    db.prepare('UPDATE outreach SET revoked_at = ? WHERE id = ?').run(AT(1), id);
    expect(pendingDrafts()).toHaveLength(0);
    // A withdrawn message must not be confirmable as delivered later.
    expect(confirmSent([id]).confirmed).toBe(0);
  });

  it('scopes to one athlete when asked', () => {
    db.prepare(`INSERT INTO players (id, full_name, position, sport, created_date, updated_date)
      VALUES ('athlete-2', 'Ryan Billings', 'DEFENSE', 'mens-soccer', '2026-01-01', '2026-01-01')`).run();
    const other = draft({ school: 'Elon', draftedAt: AT(0) });
    db.prepare('UPDATE outreach SET athlete_id = ? WHERE id = ?').run('athlete-2', other);
    draft({ school: 'Butler', draftedAt: AT(1) });

    expect(pendingDrafts({ athleteId: ATHLETE })).toHaveLength(1);
    expect(pendingDrafts()).toHaveLength(2);
  });
});

describe('batching', () => {
  it('groups one sitting together', () => {
    draft({ school: 'Butler', draftedAt: AT(0) });
    draft({ school: 'Elon', draftedAt: AT(1) });
    draft({ school: 'Rider', draftedAt: AT(2) });
    const batches = pendingBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0].count).toBe(3);
    expect(batches[0].colleges.sort()).toEqual(['Butler', 'Elon', 'Rider']);
  });

  it('splits on a gap, so yesterday is not confirmed with today', () => {
    draft({ school: 'Butler', draftedAt: AT(0) });
    draft({ school: 'Elon', draftedAt: AT(BATCH_GAP_MINUTES + 5) });
    const batches = pendingBatches();
    expect(batches).toHaveLength(2);
    expect(batches[0].colleges).toEqual(['Butler']);
    expect(batches[1].colleges).toEqual(['Elon']);
  });

  it('puts the newest batch last, which is what the CLI defaults to', () => {
    draft({ school: 'Old', draftedAt: AT(0) });
    draft({ school: 'New', draftedAt: AT(200) });
    const batches = pendingBatches();
    expect(batches[batches.length - 1].colleges).toEqual(['New']);
  });
});

describe('confirming', () => {
  it('stamps only the ids it is given', () => {
    const a = draft({ school: 'Butler', draftedAt: AT(0) });
    draft({ school: 'Elon', draftedAt: AT(1) });

    const result = confirmSent([a]);
    expect(result.confirmed).toBe(1);
    expect(draftSummary().confirmed_sent).toBe(1);
    expect(pendingDrafts()).toHaveLength(1);
  });

  it('takes ids rather than re-running a filter', () => {
    // A draft created between the operator reading the list and confirming it
    // must not be swept in. Confirming a set nobody looked at is how mail
    // nobody sent enters a denominator.
    const a = draft({ school: 'Butler', draftedAt: AT(0) });
    const ids = pendingDrafts().map((r) => r.id);
    draft({ school: 'Sneaked In', draftedAt: AT(1) });

    confirmSent(ids);
    expect(pendingDrafts().map((r) => r.school)).toEqual(['Sneaked In']);
    expect(ids).toEqual([a]);
  });

  it('keeps the first confirmation when re-confirmed', () => {
    const a = draft({ school: 'Butler', draftedAt: AT(0) });
    confirmSent([a], { at: AT(10) });
    confirmSent([a], { at: AT(99) });
    expect(db.prepare('SELECT sent_at FROM outreach WHERE id = ?').get(a).sent_at).toBe(AT(10));
  });

  it('reports what it could not confirm', () => {
    const result = confirmSent(['not-a-real-id']);
    expect(result.confirmed).toBe(0);
    expect(result.skipped).toEqual(['not-a-real-id']);
  });

  it('does nothing on an empty list', () => {
    draft({ school: 'Butler', draftedAt: AT(0) });
    expect(confirmSent([]).confirmed).toBe(0);
    expect(draftSummary().confirmed_sent).toBe(0);
  });
});

describe('a draft costs nothing until confirmed', () => {
  /**
   * The send cap keys on `sent_at`, so an unconfirmed draft must not consume
   * an inbox's allowance. It also must START consuming it the moment the send
   * is confirmed.
   */
  it('is invisible to the per-inbox send cap until confirmed', async () => {
    const { recentSendCount } = await import('./sendCap.js');
    const id = draft({ school: 'Butler', draftedAt: new Date().toISOString() });
    const email = db.prepare(`
      SELECT c.email FROM outreach o JOIN coaches c ON c.id = o.coach_id WHERE o.id = ?
    `).get(id).email;

    expect(recentSendCount(email)).toBe(0);
    markOutreachSent(id);
    expect(recentSendCount(email)).toBe(1);
  });
});

describe('drafting again moves the draft date', () => {
  /**
   * `outreach` holds one row per athlete-coach pair, so a re-draft reuses the
   * row. If `drafted_at` kept its first value the new message would be grouped
   * into the OLD batch, and confirming today's run would silently skip it.
   */
  it('overwrites drafted_at, unlike sent_at', () => {
    const id = draft({ school: 'Butler', draftedAt: AT(0) });
    markOutreachDrafted(id, AT(500));
    expect(db.prepare('SELECT drafted_at FROM outreach WHERE id = ?').get(id).drafted_at)
      .toBe(AT(500));
    expect(pendingBatches()[0].from).toBe(AT(500));
  });
});
