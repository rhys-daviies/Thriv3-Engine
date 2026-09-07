import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * B5 on the one path in this system that can reach a transport.
 *
 * `server/lib/outboundBudget.test.js` proves the accounting. This proves the
 * two things only the send path can: that capacity is spent BEFORE the
 * transport and survives its failure, and that nothing already refused by the
 * campaign gate, suppression or the per-inbox cap ever spends any.
 */

const composed = [];
let transportFails = null;

vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => {
    composed.push(message);
    if (transportFails) throw new Error(transportFails);
    return { ok: true, sent: message.send, from: null, fromMatches: null };
  }),
}));

const db = (await import('../db/client.js')).default;
const { sendOutreach } = await import('./sendOutreach.js');
const { suppress } = await import('../lib/suppressions.js');
const {
  athleteUsage, mailboxUsage, attemptsForAthlete, TRANSPORT,
} = await import('../lib/outboundBudget.js');
const { utcDayWindow, utcToday } = await import('../lib/time.js');
const { OUTLOOK_FROM_ADDRESS, ATHLETE_DAILY_OUTBOUND_LIMIT } = await import('../lib/config.js');
const { sendsForOutreach } = await import('../lib/outreachSend.js');
const { recentSendCount } = await import('../lib/sendCap.js');

const MAILBOX = OUTLOOK_FROM_ADDRESS.trim().toLowerCase();
/** Today's window, because the send path stamps `utcNow()` and cannot be told otherwise. */
const today = () => utcDayWindow(utcToday());

const COACHES = [
  { name: 'A. Whitfield', email: 'awhitfield@example.edu', title: 'Head Coach' },
  { name: 'J. Marsden', email: 'jmarsden@example.edu', title: 'Assistant Coach' },
];
const BODY = 'Dear A. Whitfield,\n\nI am writing about Nikau Brennan.\n\nBest regards,\nThriv3';

let seq = 0;

function makeAthlete(overrides = {}) {
  const id = randomUUID();
  const row = {
    id,
    created_date: '2026-09-01T00:00:00.000Z',
    updated_date: '2026-09-01T00:00:00.000Z',
    full_name: 'Nikau Brennan',
    position: 'Left Winger',
    graduation_year: 2027,
    email: 'athlete@example.com',
    video_id: 'aqz-KE-bpKQ',
    video_chapters: '[]',
    public_slug: randomUUID().slice(0, 10),
    sport: 'mens-soccer',
    ...overrides,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
  return id;
}

const request = (athleteId, overrides = {}) => ({
  athleteId,
  coaches: COACHES,
  subject: 'Recruitment Inquiry - Nikau Brennan',
  body: BODY,
  greetingName: 'A. Whitfield',
  collegeName: 'Butler University',
  division: 'NCAA Division I',
  matchId: 'Butler University',
  ...overrides,
});

/** An active campaign whose Butler programme the coaches above belong to. */
function campaignFor(athleteId, { campaignState = 'active', programmeState = 'queued' } = {}) {
  const campaign = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2020-01-01', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)
  `).run(campaign, athleteId, campaignState);
  const pc = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, state, created_at, updated_at)
    VALUES (?, ?, 'Butler University', 'mens-soccer', 1, 82, 'A', ?,
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(pc, campaign, programmeState);
  return pc;
}

beforeEach(() => {
  composed.length = 0;
  transportFails = null;
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM players; DELETE FROM coaches; DELETE FROM suppressions;`);
});

// ---------------------------------------------------------------------------

describe('what counts as an outbound action', () => {
  it('spends nothing for a draft, however many are drafted', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId));
    await sendOutreach(request(athleteId));

    // Four compose calls, all of them draft windows, no provider touched.
    expect(composed).toHaveLength(4);
    expect(composed.every((m) => m.send === false)).toBe(true);
    expect(athleteUsage(athleteId, today())).toBe(0);
    expect(mailboxUsage(MAILBOX, today())).toBe(0);
  });

  it('spends one action per coach when something is actually sent', async () => {
    const athleteId = makeAthlete();
    const { results } = await sendOutreach(request(athleteId, { send: true }));

    expect(results.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(athleteUsage(athleteId, today())).toBe(2);
    expect(mailboxUsage(MAILBOX, today())).toBe(2);
    expect(attemptsForAthlete(athleteId, today()).map((r) => r.transport))
      .toEqual([TRANSPORT.OUTLOOK_APPLESCRIPT, TRANSPORT.OUTLOOK_APPLESCRIPT]);
  });

  it('charges the mailbox the run asked to send from', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId, { send: true }));
    expect(attemptsForAthlete(athleteId, today()).every((r) => r.sending_identity === MAILBOX))
      .toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('a transport that fails', () => {
  it('keeps the action counted', async () => {
    const athleteId = makeAthlete();
    transportFails = 'Outlook does not appear to be running.';

    const { results } = await sendOutreach(request(athleteId, { send: true }));

    expect(results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(composed).toHaveLength(2);         // both reached the transport
    // AND BOTH STAY SPENT. The provider and the network were used exactly as
    // they would have been by a success; a budget that refunded failures would
    // let a broken mailbox retry all night reporting nothing spent.
    expect(athleteUsage(athleteId, today())).toBe(2);
    expect(mailboxUsage(MAILBOX, today())).toBe(2);
  });

  it('counts the retry as a second action', async () => {
    const athleteId = makeAthlete();
    transportFails = 'Outlook does not appear to be running.';
    await sendOutreach(request(athleteId, { coaches: [COACHES[0]], send: true }));

    transportFails = null;
    await sendOutreach(request(athleteId, { coaches: [COACHES[0]], send: true }));

    // One relationship, one message, TWO attempts — which is exactly why usage
    // cannot be derived from outreach_send.
    expect(athleteUsage(athleteId, today())).toBe(2);
    const outreach = db.prepare('SELECT id FROM outreach WHERE athlete_id = ?').all(athleteId);
    expect(outreach).toHaveLength(1);
    expect(sendsForOutreach(outreach[0].id).length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe('nothing already refused ever spends budget', () => {
  it('spends nothing on a suppressed address', async () => {
    const athleteId = makeAthlete();
    suppress({ email: COACHES[0].email, reason: 'unsubscribed' });

    const { results } = await sendOutreach(request(athleteId, { send: true }));
    expect(results.map((r) => r.status)).toEqual(['suppressed', 'sent']);
    expect(athleteUsage(athleteId, today())).toBe(1);
    expect(composed).toHaveLength(1);
  });

  it('spends nothing on an address at the per-inbox cap', async () => {
    const athleteId = makeAthlete();
    // Three other athletes have already written to the first coach this month.
    for (let i = 0; i < 3; i += 1) {
      const other = makeAthlete({ public_slug: randomUUID().slice(0, 10) });
      await sendOutreach(request(other, { coaches: [COACHES[0]], send: true }));
    }
    expect(recentSendCount(COACHES[0].email)).toBe(3);
    const spentBefore = mailboxUsage(MAILBOX, today());
    composed.length = 0;

    const { results } = await sendOutreach(request(athleteId, { send: true }));
    expect(results[0].status).toBe('rate-capped');
    expect(results[1].status).toBe('sent');
    // The capped coach cost the sender nothing; only the one that went did.
    expect(athleteUsage(athleteId, today())).toBe(1);
    expect(mailboxUsage(MAILBOX, today())).toBe(spentBefore + 1);
  });

  it('spends nothing when the campaign gate refuses the run', async () => {
    const athleteId = makeAthlete();
    const pc = campaignFor(athleteId, { campaignState: 'draft' });

    await expect(sendOutreach(request(athleteId, { send: true, programmeCampaignId: pc })))
      .rejects.toThrow(/CAMPAIGN_NOT_ACTIVE/);

    expect(composed).toHaveLength(0);
    expect(athleteUsage(athleteId, today())).toBe(0);
    expect(mailboxUsage(MAILBOX, today())).toBe(0);
  });

  it('spends nothing when the programme has been stopped', async () => {
    const athleteId = makeAthlete();
    const pc = campaignFor(athleteId, { programmeState: 'stopped' });

    await expect(sendOutreach(request(athleteId, { send: true, programmeCampaignId: pc })))
      .rejects.toThrow(/PROGRAMME_STOPPED/);
    expect(athleteUsage(athleteId, today())).toBe(0);
  });

  it('spends budget normally for a campaign that may send', async () => {
    const athleteId = makeAthlete();
    const pc = campaignFor(athleteId);

    const { results } = await sendOutreach(request(athleteId, { send: true, programmeCampaignId: pc }));
    expect(results.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(athleteUsage(athleteId, today())).toBe(2);
    // A6 attribution is untouched by any of this.
    expect(db.prepare('SELECT DISTINCT programme_campaign_id p FROM outreach WHERE athlete_id = ?')
      .all(athleteId)).toEqual([{ p: pc }]);
  });
});

// ---------------------------------------------------------------------------

describe('an exhausted budget', () => {
  it('reaches no transport, and says which budget it was', async () => {
    const athleteId = makeAthlete();
    const many = Array.from({ length: ATHLETE_DAILY_OUTBOUND_LIMIT }, (_, i) => ({
      name: `Coach ${i}`, email: `filler${i}@example.edu`, title: 'Assistant Coach',
    }));
    await sendOutreach(request(athleteId, { coaches: many, send: true }));
    expect(athleteUsage(athleteId, today())).toBe(ATHLETE_DAILY_OUTBOUND_LIMIT);
    composed.length = 0;

    const { results } = await sendOutreach(request(athleteId, { send: true }));

    // Nothing was handed to Outlook: the refusal is BEFORE the transport, not
    // an error reported after one.
    expect(composed).toHaveLength(0);
    expect(results.map((r) => r.status)).toEqual(['budget-refused', 'budget-refused']);
    expect(results[0].reason).toBe('ATHLETE_DAILY_BUDGET_EXHAUSTED');
    expect(results[0].error).toMatch(/used all 10 outbound actions/);
    expect(athleteUsage(athleteId, today())).toBe(ATHLETE_DAILY_OUTBOUND_LIMIT);
  });

  it('ends the coach and not the run', async () => {
    // A campaign that runs out mid-list must keep what it did and name what it
    // did not, so the operator knows where to pick up tomorrow.
    const athleteId = makeAthlete();
    const coaches = Array.from({ length: ATHLETE_DAILY_OUTBOUND_LIMIT + 3 }, (_, i) => ({
      name: `Coach ${i}`, email: `run${i}@example.edu`, title: 'Assistant Coach',
    }));

    const { results } = await sendOutreach(request(athleteId, { coaches, send: true }));

    expect(results.filter((r) => r.status === 'sent')).toHaveLength(ATHLETE_DAILY_OUTBOUND_LIMIT);
    expect(results.filter((r) => r.status === 'budget-refused')).toHaveLength(3);
    expect(composed).toHaveLength(ATHLETE_DAILY_OUTBOUND_LIMIT);
    expect(results.at(-1).email).toBe(`run${ATHLETE_DAILY_OUTBOUND_LIMIT + 2}@example.edu`);
  });

  it('still lets the same mailbox send for a different athlete', async () => {
    const first = makeAthlete();
    const many = Array.from({ length: ATHLETE_DAILY_OUTBOUND_LIMIT }, (_, i) => ({
      name: `Coach ${i}`, email: `f${i}@example.edu`, title: 'Assistant Coach',
    }));
    await sendOutreach(request(first, { coaches: many, send: true }));

    const second = makeAthlete({ public_slug: randomUUID().slice(0, 10) });
    const { results } = await sendOutreach(request(second, { coaches: [COACHES[0]], send: true }));

    // The athlete ceiling is about pacing one athlete. The mailbox ceiling is
    // the axis that would stop this, and it has not been reached.
    expect(results[0].status).toBe('sent');
    expect(athleteUsage(second, today())).toBe(1);
    expect(mailboxUsage(MAILBOX, today())).toBe(ATHLETE_DAILY_OUTBOUND_LIMIT + 1);
  });
});
