import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * NO EMAIL IS PRESENTED UNTIL ITS TRACKING LINK WORKS — R4C.
 *
 * ===========================================================================
 * THE DEFECT, IN ONE SENTENCE: an operator could Prepare, send, and the
 * coach's first click would render "Profile unavailable".
 *
 * `createOutreach` minted a token locally. The edge gates every profile on
 * its own allowlist and had never been told about it. Nothing pushed it —
 * not `createOutreach`, not `sendOutreach`, not `publish` — and the scheduled
 * sync is off in production (THRIV3_SYNC_INTERVAL_MINUTES = 0).
 *
 * These tests are about the LINE the email may not cross before the link is
 * proved: the macOS compose window on one side, the browser handoff on the
 * other, and nothing on either until activation has succeeded.
 * ===========================================================================
 */

const outlook = vi.hoisted(() => ({ available: false, composed: [] }));
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => outlook.available,
  composeInOutlook: async (message) => {
    outlook.composed.push(message);
    return { ok: true, sent: message.send };
  },
}));

/**
 * The activation, faked at the module boundary rather than at the network.
 * What is under test here is what `sendOutreach` DOES with the answer; the
 * answer itself is proved in server/lib/tokenActivation.test.js.
 */
const activation = vi.hoisted(() => ({ calls: [], result: { ok: true, reason: null, required: true } }));
vi.mock('../lib/tokenActivation.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ensureTokenLive: async (outreachId) => {
    activation.calls.push(outreachId);
    return typeof activation.result === 'function'
      ? activation.result(outreachId)
      : activation.result;
  },
}));

const db = (await import('../db/client.js')).default;
const { utcNow } = await import('../lib/time.js');
const { sendOutreach } = await import('./sendOutreach.js');
const { OUTREACH_ORIGIN } = await import('../../shared/outreachOrigin.js');
const { ACTIVATION_REFUSAL } = await import('../lib/tokenActivation.js');

const CHAPTERS = [{ t: 10, label: 'Opening' }];

function makeAthlete(name = 'Nikau Brennan') {
  const id = randomUUID();
  const ts = utcNow();
  const row = {
    id, created_date: ts, updated_date: ts,
    full_name: name, position: 'Centre Back', graduation_year: 2027,
    email: 'athlete@example.com', video_id: 'aqz-KE-bpKQ',
    video_chapters: JSON.stringify(CHAPTERS), public_slug: randomUUID().slice(0, 10),
    sport: 'mens-soccer',
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
  return id;
}

function relate(athleteId, collegeName, contact_stance = 'default') {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
      flagged, visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?,
            '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z')
  `).run(randomUUID(), athleteId, collegeName, contact_stance);
}

const ONE = [{ name: 'A Coach', email: 'a@duke.test', title: 'Head Coach' }];
const TWO = [
  { name: 'A Coach', email: 'a@duke.test', title: 'Head Coach' },
  { name: 'B Coach', email: 'b@duke.test', title: 'Assistant Coach' },
];

const run = (athleteId, opts = {}) => sendOutreach({
  athleteId, coaches: ONE, subject: 'Subject',
  body: 'Hi there.\n\nSee {{player_profile_url}}\n\nBest',
  greetingName: 'A Coach', collegeName: 'Duke', division: 'NCAA D1', send: false,
  ...opts,
}, { origin: OUTREACH_ORIGIN.MANUAL });

const sends = () => db.prepare('SELECT * FROM outreach_send').all();
const byEmail = (r, email) => r.results.find((x) => x.email === email);

beforeEach(() => {
  outlook.available = false;
  outlook.composed.length = 0;
  activation.calls.length = 0;
  activation.result = { ok: true, reason: null, required: true };
  db.exec(`DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM players; DELETE FROM coaches;`);
});

/* ========================================================================== */
/*  A. The link is activated before the handoff exists                        */
/* ========================================================================== */

describe('a manual draft on the hosted path', () => {
  it('activates the new token before returning a handoff', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const row = byEmail(await run(athlete), 'a@duke.test');
    const outreachId = db.prepare('SELECT id FROM outreach').get().id;

    expect(activation.calls).toEqual([outreachId]);
    expect(row.status).toBe('drafted');
    expect(row.handoff).toBeTruthy();
  });

  /**
   * ORDER, NOT MERELY PRESENCE. A handoff produced before the link worked
   * would be a send-ready email with a dead link in it — the whole defect.
   */
  it('asks about the link before anything is presented', async () => {
    const order = [];
    activation.result = () => { order.push('activate'); return { ok: true, reason: null, required: true }; };
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const row = byEmail(await run(athlete), 'a@duke.test');
    if (row.handoff) order.push('handoff');

    expect(order).toEqual(['activate', 'handoff']);
  });

  it('J. the browser handoff still carries everything it did', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    const { handoff } = byEmail(await run(athlete), 'a@duke.test');
    const token = db.prepare('SELECT token FROM outreach').get().token;

    expect(handoff.to).toBe('a@duke.test');
    expect(handoff.body).toContain(`?ref=${token}`);
    expect(handoff.mailtoUrl).not.toContain('body=');
  });
});

/* ========================================================================== */
/*  B & C. Activation failure                                                 */
/* ========================================================================== */

describe('when the link cannot be proved live', () => {
  const failing = { ok: false, reason: ACTIVATION_REFUSAL.EDGE_UNREACHABLE, required: true };

  it('B. returns no send-ready handoff', async () => {
    activation.result = failing;
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const row = byEmail(await run(athlete), 'a@duke.test');

    expect(row.status).toBe('link-not-activated');
    expect(row.handoff).toBeNull();
    expect(row.reason).toBe(ACTIVATION_REFUSAL.EDGE_UNREACHABLE);
  });

  it('C. leaves the message as a DRAFT awaiting confirmation, never sent', async () => {
    activation.result = failing;
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    await run(athlete);

    const row = sends()[0];
    expect(row.state).toBe('DRAFT');
    expect(row.sent_at).toBeNull();
    expect(row.accepted_source).toBeNull();
    expect(row.origin).toBe('manual');
  });

  /**
   * K. NOTHING THAT LOOKS LIKE CONTACT. A failed activation is a fact about a
   * URL. It must not leave a trace anyone downstream could read as an
   * approach having been made.
   */
  it('K. creates no contact, no send and no engagement state', async () => {
    activation.result = failing;
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    await run(athlete);

    const outreach = db.prepare('SELECT * FROM outreach').get();
    expect(outreach.sent_at).toBeNull();
    // Drafted IS recorded — a body was composed for this relationship and
    // declining to write that down would understate real work.
    expect(outreach.drafted_at).not.toBeNull();

    expect(db.prepare('SELECT COUNT(*) n FROM tracking_events').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM engagement_rollup').get().n).toBe(0);
    expect(db.prepare("SELECT contact_stance FROM athlete_programmes").get().contact_stance)
      .toBe('default');
  });

  it('opens no compose window on macOS either', async () => {
    activation.result = failing;
    outlook.available = true;
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const row = byEmail(await run(athlete), 'a@duke.test');

    // I. The macOS path is gated by the same line. A compose window IS the
    // presentation on that platform.
    expect(outlook.composed).toHaveLength(0);
    expect(row.status).toBe('link-not-activated');
  });

  it('says what happened without implying a delivery failure', async () => {
    activation.result = failing;
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    const row = byEmail(await run(athlete), 'a@duke.test');

    expect(row.message).toMatch(/prepared/i);
    expect(row.message).toMatch(/nothing has been sent/i);
    expect(row.message).not.toMatch(/deliver|bounce|mail server|provider|failed to send/i);
  });

  it('names a revoked link as the different thing it is', async () => {
    activation.result = { ok: false, reason: ACTIVATION_REFUSAL.OUTREACH_REVOKED, required: true };
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    const row = byEmail(await run(athlete), 'a@duke.test');

    expect(row.reason).toBe(ACTIVATION_REFUSAL.OUTREACH_REVOKED);
    expect(row.message).toMatch(/revoked/i);
  });
});

/* ========================================================================== */
/*  D. Retry                                                                  */
/* ========================================================================== */

describe('retrying after a failed activation', () => {
  /**
   * NO SECOND TOKEN, EVER. `createOutreach` is idempotent per athlete × coach
   * and `recordDraft` reuses the open row, so a retry is the same
   * relationship, the same token and the same message — which is why no new
   * endpoint or state was needed for it.
   */
  it('D. activates the existing token without minting another', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    activation.result = { ok: false, reason: ACTIVATION_REFUSAL.EDGE_UNREACHABLE, required: true };
    const first = byEmail(await run(athlete), 'a@duke.test');
    const tokenAfterFailure = db.prepare('SELECT token FROM outreach').get().token;

    activation.result = { ok: true, reason: null, required: true };
    const second = byEmail(await run(athlete), 'a@duke.test');

    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(1);
    expect(db.prepare('SELECT token FROM outreach').get().token).toBe(tokenAfterFailure);
    expect(sends()).toHaveLength(1);
    expect(sends()[0].sequence).toBe(1);

    expect(first.handoff).toBeNull();
    expect(second.handoff).toBeTruthy();
    expect(second.status).toBe('drafted');
  });
});

/* ========================================================================== */
/*  E. Two coaches                                                            */
/* ========================================================================== */

describe('two coaches at one programme', () => {
  it('E. activates each coach’s own token', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const result = await run(athlete, { coaches: TWO });
    const ids = db.prepare('SELECT id FROM outreach ORDER BY created_at, id').all().map((r) => r.id);

    expect(activation.calls.sort()).toEqual([...ids].sort());
    expect(byEmail(result, 'a@duke.test').handoff).toBeTruthy();
    expect(byEmail(result, 'b@duke.test').handoff).toBeTruthy();
  });

  it('holds back only the coach whose link failed', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    // The second relationship created in the run is the one that fails.
    let seen = 0;
    activation.result = () => (++seen === 1
      ? { ok: true, reason: null, required: true }
      : { ok: false, reason: ACTIVATION_REFUSAL.EDGE_UNREACHABLE, required: true });

    const result = await run(athlete, { coaches: TWO });

    const ok = result.results.filter((r) => r.handoff);
    const held = result.results.filter((r) => r.status === 'link-not-activated');
    expect(ok).toHaveLength(1);
    expect(held).toHaveLength(1);
    // Both were still recorded as drafts. Neither was sent.
    expect(sends()).toHaveLength(2);
    expect(sends().every((s) => s.state === 'DRAFT')).toBe(true);
  });
});

/* ========================================================================== */
/*  F–H. What must not change                                                 */
/* ========================================================================== */

describe('the guards that were already there', () => {
  /**
   * F. A revoked relationship never reaches activation at all — it is skipped
   * before the token is looked at, so nothing can accidentally re-enable it.
   */
  it('F. never asks to activate a revoked relationship', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    await run(athlete);
    db.exec("UPDATE outreach SET revoked_at = '2026-09-22T02:00:00.000Z'");
    activation.calls.length = 0;

    const row = byEmail(await run(athlete), 'a@duke.test');

    expect(row.status).toBe('revoked');
    expect(activation.calls).toEqual([]);
  });

  it('G. still refuses an archived athlete, before any activation', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    db.prepare('UPDATE players SET archived_at = ? WHERE id = ?').run(utcNow(), athlete);

    await expect(run(athlete)).rejects.toThrow(/deleted from Thriv3/i);
    expect(activation.calls).toEqual([]);
    expect(sends()).toHaveLength(0);
  });

  it('still refuses a do-not-contact programme, before any activation', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke', 'do_not_contact');

    await expect(run(athlete)).rejects.toThrow();
    expect(activation.calls).toEqual([]);
  });

  it('H. a campaign-attributed send is activated the same way, and nothing else changes', async () => {
    // Campaign has no special case here: a tracked link is a tracked link.
    // What matters is that this slice added no campaign branch at all.
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    await run(athlete);

    const row = sends()[0];
    expect(row.programme_campaign_id).toBeNull();
    expect(row.programme_message_id).toBeNull();
    expect(row.connected_mailbox_id).toBeNull();
    expect(row.provider).toBeNull();
    expect(row.body).toBeNull();          // still D4.7's frozen wire body, untouched
    expect(row.wire_body_sha256).toBeNull();
  });

  it('I. macOS still opens the compose window once the link is live', async () => {
    outlook.available = true;
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const row = byEmail(await run(athlete), 'a@duke.test');

    expect(outlook.composed).toHaveLength(1);
    expect(outlook.composed[0].to).toBe('a@duke.test');
    expect(row.handoff).toBeNull();       // the macOS path hands over no clipboard copy
    expect(row.status).toBe('drafted');
  });
});
