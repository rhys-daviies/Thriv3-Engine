import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * PREPARING A MANUAL EMAIL WHERE THERE IS NO OUTLOOK — R2B.
 *
 * ===========================================================================
 * THE REGRESSION THIS FILE EXISTS FOR IS ONE LINE.
 *
 * `sendOutreach` used to open with:
 *
 *     if (!isOutlookAvailable()) throw new Error(...only available on macOS)
 *
 * ABOVE the compliance check, the contact-stance gate, suppression and every
 * write. Render is Linux, so every hosted manual Specific Search draft threw
 * there and nothing downstream ever ran — while none of that downstream logic
 * was platform-dependent in the first place.
 *
 * So the first test below is the whole point: on a machine that cannot drive
 * Outlook, a DRAFT is created and a handoff comes back. Everything else here
 * makes sure that road does not also carry something it should not.
 * ===========================================================================
 *
 * The mock is controllable rather than fixed, because BOTH platforms have to
 * keep working and a suite that can only be one of them would prove half of
 * it. macOS composes and returns no handoff; everything else prepares the
 * identical email and hands it to the browser.
 */
const outlook = vi.hoisted(() => ({ available: false, composed: [] }));
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => outlook.available,
  composeInOutlook: async (message) => {
    outlook.composed.push(message);
    return { ok: true, sent: message.send };
  },
}));

const db = (await import('../db/client.js')).default;
const { utcNow } = await import('../lib/time.js');
const { sendOutreach } = await import('./sendOutreach.js');
const { suppress } = await import('../lib/suppressions.js');
const { OUTREACH_ORIGIN } = await import('../../shared/outreachOrigin.js');
const { textToHtml } = await import('../../shared/emailHtml.js');
const { bodyHash } = await import('../../shared/evidence/sendSnapshot.js');

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
            '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z')
  `).run(randomUUID(), athleteId, collegeName, contact_stance);
}

const ONE = [{ name: 'A Coach', email: 'a@duke.test', title: 'Head Coach' }];
const TWO = [
  { name: 'A Coach', email: 'a@duke.test', title: 'Head Coach' },
  { name: 'B Coach', email: 'b@duke.test', title: 'Assistant Coach' },
];

const run = (athleteId, opts = {}) => sendOutreach({
  athleteId, coaches: ONE, subject: 'Subject for {{x}}',
  body: 'Hi there.\n\nSee {{player_profile_url}}\n\nBest',
  greetingName: 'A Coach', collegeName: 'Duke', division: 'NCAA D1', send: false,
  ...opts,
}, { origin: OUTREACH_ORIGIN.MANUAL });

const sends = () => db.prepare('SELECT * FROM outreach_send').all();
const byEmail = (result, email) => result.results.find((r) => r.email === email);

beforeEach(() => {
  outlook.available = false;
  outlook.composed.length = 0;
  db.exec(`DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM players; DELETE FROM coaches;`);
});

/* ========================================================================== */
/*  The Render regression                                                     */
/* ========================================================================== */

describe('a machine with no Outlook', () => {
  /** THE ONE THAT MATTERS. */
  it('prepares the draft and hands it back instead of refusing outright', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const result = await run(athlete);
    const row = byEmail(result, 'a@duke.test');

    expect(row.status).toBe('drafted');
    expect(row.handoff).toBeTruthy();
    // The DRAFT is real, not a payload pretending to be one.
    expect(sends()).toHaveLength(1);
    expect(sends()[0].state).toBe('DRAFT');
    // And nothing tried to talk to a mail client.
    expect(outlook.composed).toHaveLength(0);
  });

  /**
   * EVERY SAFETY CHECK STILL RUNS, and this is the assertion that says the
   * gate was REMOVED rather than the checks moved above it. The old throw
   * stood above all of them; if lifting it had reordered anything, a
   * do-not-contact programme would now compose.
   */
  it('still refuses a do-not-contact programme', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke', 'do_not_contact');
    await expect(run(athlete)).rejects.toThrow();
    expect(sends()).toHaveLength(0);
  });

  it('still refuses a suppressed recipient, with no handoff', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    suppress({ email: 'a@duke.test', reason: 'unsubscribed' });

    const row = byEmail(await run(athlete), 'a@duke.test');
    expect(row.status).toBe('suppressed');
    expect(row.handoff ?? null).toBeNull();
    expect(sends()).toHaveLength(0);
  });

  /**
   * SENDING IS STILL REFUSED WITHOUT OUTLOOK. A browser handoff opens a
   * window; it cannot press Send. Returning "sent" for one would be exactly
   * the claim F7b was spent removing.
   */
  it('refuses to send rather than quietly downgrading to a handoff', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    await expect(run(athlete, { send: true })).rejects.toThrow(/only available on macOS/i);
    expect(sends()).toHaveLength(0);
  });
});

/* ========================================================================== */
/*  macOS is unchanged                                                        */
/* ========================================================================== */

describe('a machine that can drive Outlook', () => {
  it('still opens the compose window and hands back no clipboard copy', async () => {
    outlook.available = true;
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const row = byEmail(await run(athlete), 'a@duke.test');

    expect(outlook.composed).toHaveLength(1);
    expect(outlook.composed[0].to).toBe('a@duke.test');
    expect(row.status).toBe('drafted');
    /**
     * NULL DELIBERATELY. The operator already has the compose window open;
     * a clipboard copy as well would put two competing copies of one email
     * on one screen, and the UI keys its whole handoff section on this.
     */
    expect(row.handoff).toBeNull();
    expect(sends()).toHaveLength(1);
  });

  /**
   * THE TWO PATHS PRODUCE THE SAME EMAIL, which is the claim that makes this
   * a routing decision rather than two products. Two athletes with the same
   * name and template rather than one athlete twice, because re-running the
   * same athlete reuses the same outreach row and the same token — and
   * deleting rows that outreach_evidence and engagement_rollup reference is
   * a foreign-key error rather than a clean slate.
   */
  it('composes the same body it would have handed over', async () => {
    const hostedAthlete = makeAthlete('Same Name');
    relate(hostedAthlete, 'Duke');
    const hosted = byEmail(await run(hostedAthlete), 'a@duke.test').handoff;

    outlook.available = true;
    const localAthlete = makeAthlete('Same Name');
    relate(localAthlete, 'Duke');
    await run(localAthlete);

    // Only the tracking token and the profile slug differ, because they are
    // per athlete and per relationship.
    const strip = (t) => String(t)
      .replace(/\/p\/[A-Za-z0-9-]+\.html/, '/p/SLUG.html')
      .replace(/\?ref=[A-Za-z0-9]+/, '?ref=TOKEN');
    expect(strip(outlook.composed[0].body)).toBe(strip(hosted.body));
    expect(outlook.composed[0].subject).toBe(hosted.subject);
  });
});

/* ========================================================================== */
/*  The payload is the record                                                 */
/* ========================================================================== */

describe('what the handoff carries', () => {
  /**
   * THE PROPERTY THE WHOLE DESIGN RESTS ON, AND THE COLUMN IT IS NOT PROVED
   * WITH.
   *
   * `outreach_send.body` is NULL here and that is correct: it is D4.7's
   * frozen wire body, written only by a campaign execution claim through
   * `recordDraft`'s separate `wireBody` argument. A manual draft is hashed
   * and not stored. Writing it from Specific Search would put manual outreach
   * inside a Campaign execution column, so the equality is proved through
   * `body_hash` instead — same guarantee, nothing borrowed.
   */
  it('matches the DRAFT row it was recorded alongside', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    const { handoff } = byEmail(await run(athlete), 'a@duke.test');
    const row = sends()[0];

    expect(handoff.sendId).toBe(row.id);
    expect(handoff.coachId).toBe(row.coach_id);
    expect(handoff.subject).toBe(row.subject);
    expect(bodyHash(handoff.body)).toBe(row.body_hash);
    expect(handoff.bodyHtml).toBe(textToHtml(handoff.body));
  });

  /**
   * THE CAMPAIGN COLUMN IS STILL UNTOUCHED, asserted rather than assumed.
   * If a future change starts writing it from here, this fails — which is
   * the point: `wire_body_sha256` and `body` move together and mean "a claim
   * froze these bytes for a provider transport", and a manual draft has not.
   */
  it('writes nothing into the campaign execution columns', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    await run(athlete);
    const row = sends()[0];

    expect(row.body).toBeNull();
    expect(row.wire_body_sha256).toBeNull();
    expect(row.programme_message_id).toBeNull();
    expect(row.connected_mailbox_id).toBeNull();
    expect(row.provider).toBeNull();
    expect(row.programme_campaign_id).toBeNull();
    /**
     * And the transport columns. `sendingIdentity` IS passed by this file,
     * but only to the outbound BUDGET ledger and only inside `if (send)` —
     * which now requires Outlook — so the hosted path reaches neither it nor
     * this column.
     *
     * `authorised_by_operator_id` and `authorisation_kind` are deliberately
     * not asserted: they exist in the live database but NOT in one built
     * fresh from schema.sql + migrate.js, so asserting them here would pass
     * vacuously on `undefined` and prove nothing. That drift is pre-existing
     * and is recorded as baseline debt rather than papered over here.
     */
    expect(row.sending_identity).toBeNull();
    expect(row.provider_accepted_at).toBeNull();
    // But the analytics digest IS written, which is what the handoff is
    // checked against.
    expect(row.body_hash).toEqual(expect.any(String));
  });

  it('carries the compliance footer and this relationship’s tracking link', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    const { handoff } = byEmail(await run(athlete), 'a@duke.test');
    const token = db.prepare('SELECT token FROM outreach').get().token;

    expect(handoff.body).toContain(`?ref=${token}`);
    // The footer is a legal requirement, not formatting — and it is at the
    // END of the body, which is what a mailto URL would have truncated.
    expect(handoff.body).toMatch(/If you'd rather not hear from us/);
  });

  it('puts no body in the mailto URL, whatever the body is', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    const { handoff } = await run(athlete, { body: `${'padding. '.repeat(400)}{{player_profile_url}}` })
      .then((r) => byEmail(r, 'a@duke.test'));

    expect(handoff.body.length).toBeGreaterThan(3000);
    expect(handoff.mailtoUrl.length).toBeLessThan(250);
    expect(handoff.mailtoUrl).not.toContain('body=');
    expect(handoff.mailtoUrl).not.toContain('padding');
  });

  it('recovers the recipient from the coaches row rather than the request', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    // findOrCreateCoach lowercases and trims; the handoff must carry the
    // canonical value, because that is the row outreach_send.coach_id points
    // at and it is what history will be keyed on.
    const r = await sendOutreach({
      athleteId: athlete, coaches: [{ name: 'A Coach', email: '  A@Duke.Test  ', title: 'Head Coach' }],
      subject: 's', body: 'b {{player_profile_url}}', greetingName: 'A Coach',
      collegeName: 'Duke', division: 'NCAA D1', send: false,
    }, { origin: OUTREACH_ORIGIN.MANUAL });

    expect(r.results[0].handoff.to).toBe('a@duke.test');
  });
});

/* ========================================================================== */
/*  One coach, one email                                                      */
/* ========================================================================== */

describe('two coaches at one programme', () => {
  it('gets two handoffs that share nothing', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    const result = await run(athlete, { coaches: TWO });

    const a = byEmail(result, 'a@duke.test').handoff;
    const b = byEmail(result, 'b@duke.test').handoff;

    expect(a.to).toBe('a@duke.test');
    expect(b.to).toBe('b@duke.test');
    expect(a.sendId).not.toBe(b.sendId);
    expect(a.coachId).not.toBe(b.coachId);

    /**
     * THE TOKENS MUST NOT CROSS. Attribution is per (athlete, coach): a body
     * carrying the other coach's token would credit one coach's reading to
     * the other, permanently and invisibly.
     */
    const tokens = db.prepare('SELECT coach_id, token FROM outreach').all();
    const tokenFor = (coachId) => tokens.find((t) => t.coach_id === coachId).token;
    expect(a.body).toContain(`?ref=${tokenFor(a.coachId)}`);
    expect(b.body).toContain(`?ref=${tokenFor(b.coachId)}`);
    expect(a.body).not.toContain(tokenFor(b.coachId));
    expect(b.body).not.toContain(tokenFor(a.coachId));
  });

  it('hands over only the coach who was actually prepared', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    suppress({ email: 'b@duke.test', reason: 'unsubscribed' });

    const result = await run(athlete, { coaches: TWO });
    const withHandoff = result.results.filter((r) => r.handoff);

    expect(withHandoff).toHaveLength(1);
    expect(withHandoff[0].email).toBe('a@duke.test');
    expect(byEmail(result, 'b@duke.test').status).toBe('suppressed');
  });

  it('hands over nothing for a revoked relationship', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    await run(athlete);                        // creates the outreach row
    db.exec("UPDATE outreach SET revoked_at = '2026-09-12T00:00:00.000Z'");

    const row = byEmail(await run(athlete), 'a@duke.test');
    expect(row.status).toBe('revoked');
    expect(row.handoff ?? null).toBeNull();
  });
});

describe('two athletes', () => {
  it('never hands one athlete’s prepared email to the other', async () => {
    const one = makeAthlete('Athlete One');
    const two = makeAthlete('Athlete Two');
    relate(one, 'Duke');
    relate(two, 'Duke');

    const a = byEmail(await run(one), 'a@duke.test').handoff;
    const b = byEmail(await run(two), 'a@duke.test').handoff;

    expect(a.sendId).not.toBe(b.sendId);
    expect(a.body).toContain('Athlete One');
    expect(a.body).not.toContain('Athlete Two');
    expect(b.body).toContain('Athlete Two');
    expect(b.body).not.toContain('Athlete One');
  });
});

/* ========================================================================== */
/*  Retry                                                                     */
/* ========================================================================== */

describe('when the browser handoff did not work', () => {
  /**
   * NOTHING SPECIAL HAPPENS, WHICH IS THE DESIGN. `recordDraft` reuses the
   * OPEN row — `open?.id ?? randomUUID()` — so re-posting refreshes the same
   * message instead of writing a second one or tripping
   * `idx_outreach_send_one_open`. Retry is idempotent for free, and no new
   * endpoint, column or state was needed to get it.
   */
  it('retrying reuses the same open DRAFT and issues a fresh handoff', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const first = byEmail(await run(athlete), 'a@duke.test').handoff;
    const second = byEmail(await run(athlete), 'a@duke.test').handoff;

    expect(sends()).toHaveLength(1);
    expect(second.sendId).toBe(first.sendId);
    expect(sends()[0].sequence).toBe(1);
    expect(sends()[0].state).toBe('DRAFT');
    expect(second.body).toBe(first.body);
  });

  it('leaves the draft outstanding so the operator can confirm or discard it', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');
    await run(athlete);

    // What /pending-manual-drafts reads: an open manual message with no
    // confirmation. A failed handoff in the browser changes none of this.
    const row = sends()[0];
    expect(row.state).toBe('DRAFT');
    expect(row.sent_at).toBeNull();
    expect(row.accepted_source).toBeNull();
    expect(row.origin).toBe('manual');
  });
});

/* ========================================================================== */
/*  A bad coach row                                                           */
/* ========================================================================== */

describe('a coach address that cannot go in a URL', () => {
  /**
   * `findOrCreateCoach` accepts any non-empty string that is not "n/a", so an
   * address like this can genuinely be in the table from a CSV import. It was
   * harmless while AppleScript took it as argv.
   *
   * The DRAFT is still written and the run still completes: refusing the
   * handoff is a fact about one recipient, and losing the recorded message
   * over it would be worse than the problem.
   */
  it('records the draft but refuses to hand over an injectable recipient', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke');

    const r = await sendOutreach({
      athleteId: athlete,
      coaches: [{ name: 'Bad', email: 'coach?bcc=attacker@evil.example', title: 'Head Coach' }],
      subject: 's', body: 'b {{player_profile_url}}', greetingName: 'Bad',
      collegeName: 'Duke', division: 'NCAA D1', send: false,
    }, { origin: OUTREACH_ORIGIN.MANUAL });

    expect(r.results[0].handoff).toBeNull();
    expect(r.results[0].status).toBe('drafted');
    expect(sends()).toHaveLength(1);
  });
});
