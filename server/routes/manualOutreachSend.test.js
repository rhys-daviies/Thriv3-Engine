import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// Same interception as sendOutreach.test.js: the orchestration is what is
// under test, not whether a compose window opens on whoever runs the suite.
const composed = [];
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => {
    composed.push(message);
    return { ok: true, sent: message.send };
  }),
}));

const db = (await import('../db/client.js')).default;
const { utcNow } = await import('../lib/time.js');
const { sendOutreach } = await import('./sendOutreach.js');
const { suppress } = await import('../lib/suppressions.js');
const { OUTREACH_ORIGIN } = await import('../../shared/outreachOrigin.js');

/**
 * THE GUARANTEE, AS OPPOSED TO THE DOORWAY.
 *
 * server/routes/manualOutreach.test.js proves the manual route refuses a
 * do-not-contact relationship. These tests prove the refusal lives one layer
 * deeper — inside `sendOutreach`, which is the single function every path to a
 * coach's inbox passes through. That is what makes it a rule rather than a
 * property of one screen: a script, a stale tab, the match-card composer and
 * any future endpoint all hit the same check.
 *
 * They also pin the provenance, because F6's duplicate protection will depend
 * on being able to tell a manual send from a campaign one, and today it cannot.
 */

const CHAPTERS = [{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }];

function makeAthlete() {
  const id = randomUUID();
  const ts = utcNow();
  const row = {
    id, created_date: ts, updated_date: ts,
    full_name: 'Nikau Brennan', position: 'Left Winger', graduation_year: 2027,
    email: 'athlete@example.com', video_id: 'aqz-KE-bpKQ',
    video_chapters: JSON.stringify(CHAPTERS), public_slug: randomUUID().slice(0, 10),
    sport: 'mens-soccer',
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
  return id;
}

function relate(athleteId, collegeName, contact_stance, extra = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
      flagged, visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, ?, ?, ?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z')
  `).run(
    randomUUID(), athleteId, collegeName,
    extra.request_state ?? 'none', extra.flagged ? 1 : 0,
    extra.visibility ?? 'default', contact_stance,
  );
}

const COACHES = [{ name: 'A Coach', email: 'a@duke.test', title: 'Head Coach' }];

const run = (athleteId, opts = {}, context = undefined) => sendOutreach({
  athleteId, coaches: COACHES, subject: 'Subject', body: 'Body {{player_profile_url}}',
  greetingName: 'A Coach', collegeName: 'Duke', division: 'NCAA D1', send: false,
  ...opts,
}, context);

const sends = () => db.prepare('SELECT * FROM outreach_send').all();

beforeEach(() => {
  composed.length = 0;
  // Order matters: outreach_evidence, engagement_rollup and outreach_send all
  // reference outreach, and outreach references players and coaches.
  db.exec(`DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM players; DELETE FROM coaches;`);
});

// ---------------------------------------------------------------------------

describe('contact stance is enforced inside the send path itself', () => {
  it('refuses a do-not-contact relationship, whatever the caller is', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke', 'do_not_contact');

    await expect(run(athlete)).rejects.toThrow(/do-not-contact/i);
    // Nothing composed, nothing written. It is checked before anything is.
    expect(composed).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) c FROM outreach').get().c).toBe(0);
    expect(sends()).toHaveLength(0);
  });

  it('refuses it on the manual path and on the shared one alike', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke', 'do_not_contact');

    // The manual context and no context at all — the check does not care which
    // door was used, which is the whole point of putting it here.
    await expect(run(athlete, {}, { origin: OUTREACH_ORIGIN.MANUAL })).rejects.toThrow(/do-not-contact/i);
    await expect(run(athlete)).rejects.toThrow(/do-not-contact/i);
  });

  it('permits manual_only', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke', 'manual_only');
    const result = await run(athlete, {}, { origin: OUTREACH_ORIGIN.MANUAL });
    expect(result.drafted ?? result.results?.length ?? 1).toBeTruthy();
    expect(sends()).toHaveLength(1);
  });

  it('permits default, and a programme with no relationship at all', async () => {
    const withRow = makeAthlete();
    relate(withRow, 'Duke', 'default');
    await run(withRow);
    expect(sends()).toHaveLength(1);

    db.exec(`DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
             DELETE FROM outreach_send; DELETE FROM outreach;`);
    const withoutRow = makeAthlete();
    await run(withoutRow);
    expect(sends()).toHaveLength(1);
  });

  it('is not confused by visibility, flagged or request_state', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke', 'default', {
      visibility: 'suppressed', flagged: true, request_state: 'withdrawn',
    });
    // A school removed from the Top 100, flagged, with a withdrawn request, is
    // still a school a person may deliberately write to.
    await run(athlete);
    expect(sends()).toHaveLength(1);
  });
});

describe('origin is recorded, and cannot be claimed by the payload', () => {
  it('writes manual when the manual route says so', async () => {
    const athlete = makeAthlete();
    await run(athlete, {}, { origin: OUTREACH_ORIGIN.MANUAL });
    expect(sends()[0]).toMatchObject({ origin: 'manual', programme_campaign_id: null });
  });

  it('writes NULL only when no caller said what this was', async () => {
    const athlete = makeAthlete();
    await run(athlete);
    /**
     * The FUNCTION default, which is not the same as a path's default. Every
     * route and script that reaches this function now names its own origin —
     * see server/index.js and server/scripts/draftOutreach.js — so NULL is
     * reserved for history and for a caller that has not been classified yet,
     * rather than being what a new send quietly gets.
     */
    expect(sends()[0].origin).toBeNull();
  });

  it('IGNORES an origin in the payload', async () => {
    const athlete = makeAthlete();
    // The field a browser would try. It is not a parameter of the payload at
    // all — the context is a second argument no request body can reach.
    await run(athlete, { origin: 'campaign' });
    expect(sends()[0].origin).toBeNull();
  });

  it('refuses an origin outside the vocabulary', async () => {
    const athlete = makeAthlete();
    await expect(run(athlete, {}, { origin: 'whatever' })).rejects.toThrow(/Unknown outreach origin/);
  });
});

describe('every existing safety control still applies to a manual send', () => {
  it('still honours the global suppression list', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke', 'manual_only');
    suppress({ email: 'a@duke.test', reason: 'unsubscribed' });

    await run(athlete, {}, { origin: OUTREACH_ORIGIN.MANUAL });
    // An address-level opt-out is a different question from a relationship
    // stance, and manual outreach is not an exemption from it.
    expect(composed).toHaveLength(0);
    expect(sends()).toHaveLength(0);
  });

  it('still drafts rather than sends unless asked', async () => {
    const athlete = makeAthlete();
    await run(athlete, {}, { origin: OUTREACH_ORIGIN.MANUAL });
    expect(composed[0].send).toBe(false);
    expect(sends()[0].sent_at).toBeNull();
    expect(sends()[0].drafted_at).toBeTruthy();
  });

  it('sends only on an explicit opt-in', async () => {
    const athlete = makeAthlete();
    await run(athlete, { send: true }, { origin: OUTREACH_ORIGIN.MANUAL });
    expect(composed[0].send).toBe(true);
  });
});

describe('a manual send is not campaign work', () => {
  it('records no campaign attribution', async () => {
    const athlete = makeAthlete();
    await run(athlete, {}, { origin: OUTREACH_ORIGIN.MANUAL });
    const row = sends()[0];
    expect(row.programme_campaign_id).toBeNull();
    expect(db.prepare('SELECT COUNT(*) c FROM campaigns').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM programme_campaigns').get().c).toBe(0);
  });

  it('needs no match, rank, score or recommendation', async () => {
    const athlete = makeAthlete();
    // Everything a Specific Search school lacks, and none of it supplied.
    await run(athlete, { matchId: 'Duke' }, { origin: OUTREACH_ORIGIN.MANUAL });
    expect(sends()).toHaveLength(1);
    expect(db.prepare('SELECT match_id FROM outreach').get().match_id).toBe('Duke');
  });
});


// ---------------------------------------------------------------------------

describe('ADVERSARIAL — the programme label cannot be swapped', () => {
  /**
   * THE HOLE THIS CLOSES.
   *
   * `findOrCreateCoach` keys on (email, school, sport) and CREATES a row when
   * it misses. A caller writing to a Duke address while labelling the run
   * "Elsewhere" therefore did not merely mislabel it — it minted a second
   * coaches row for that address under "Elsewhere", and a stance resolved from
   * the label alone was a stance on a school nobody was writing to. Duke's
   * do-not-contact was never consulted.
   */
  function canonicalCoach({ email, school, sport = 'mens-soccer' }) {
    db.prepare(`
      INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
      VALUES (?, '2026-09-11T00:00:00.000Z', 'A Coach', ?, ?, 'NCAA D1', ?, 'Head Coach')
    `).run(randomUUID(), email, school, sport);
  }

  it('blocks a send to a do-not-contact school that claims to be another school', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'a@duke.test', school: 'Duke' });
    relate(athlete, 'Duke', 'do_not_contact');

    // The attack: the label says Elsewhere, the recipient works at Duke.
    await expect(sendOutreach({
      athleteId: athlete, coaches: [{ name: 'A Coach', email: 'a@duke.test', title: 'Head Coach' }],
      subject: 'S', body: 'B', greetingName: 'A Coach',
      collegeName: 'Elsewhere', division: 'NCAA D1', send: false,
    })).rejects.toThrow(/Duke is set to do-not-contact/);

    expect(composed).toHaveLength(0);
    expect(sends()).toHaveLength(0);
    // And no coach row was minted under the false label on the way past.
    expect(db.prepare("SELECT COUNT(*) c FROM coaches WHERE school = 'Elsewhere'").get().c).toBe(0);
  });

  it('says which programme refused, and that it was not the one claimed', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'a@duke.test', school: 'Duke' });
    relate(athlete, 'Duke', 'do_not_contact');

    await expect(sendOutreach({
      athleteId: athlete, coaches: [{ name: 'A Coach', email: 'a@duke.test' }],
      subject: 'S', body: 'B', collegeName: 'Elsewhere', send: false,
    })).rejects.toThrow(/labelled Elsewhere, but at least one recipient is on record at Duke/);
  });

  it('blocks when only ONE of several recipients is at the refused school', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'clean@unc.test', school: 'North Carolina' });
    canonicalCoach({ email: 'a@duke.test', school: 'Duke' });
    relate(athlete, 'Duke', 'do_not_contact');

    // A refusal is a fact about the run, not about one recipient.
    await expect(sendOutreach({
      athleteId: athlete,
      coaches: [{ name: 'Clean', email: 'clean@unc.test' }, { name: 'A Coach', email: 'a@duke.test' }],
      subject: 'S', body: 'B', collegeName: 'North Carolina', send: false,
    })).rejects.toThrow(/Duke is set to do-not-contact/);
    expect(composed).toHaveLength(0);
  });

  it('blocks on a coach row whose sport was never recorded', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'a@duke.test', school: 'Duke', sport: null });
    relate(athlete, 'Duke', 'do_not_contact');

    // An ambiguous row that MIGHT be the suppressed programme is treated as
    // though it is — the conservative direction for a rule whose job is to
    // stop a message.
    await expect(sendOutreach({
      athleteId: athlete, coaches: [{ name: 'A Coach', email: 'a@duke.test' }],
      subject: 'S', body: 'B', collegeName: 'Elsewhere', send: false,
    })).rejects.toThrow(/do-not-contact/i);
  });

  it('does NOT block across sports', async () => {
    const athlete = makeAthlete();   // mens-soccer
    canonicalCoach({ email: 'a@duke.test', school: 'Duke', sport: 'womens-soccer' });
    relate(athlete, 'Duke', 'default');
    db.prepare(`
      INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
        flagged, visibility, contact_stance, created_at, updated_at)
      VALUES (?, ?, 'Duke', 'womens-soccer', 'none', 0, 'default', 'do_not_contact',
        '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z')
    `).run(randomUUID(), athlete);

    // A women's-soccer refusal is not a men's-soccer one.
    await sendOutreach({
      athleteId: athlete, coaches: [{ name: 'A Coach', email: 'a@duke.test' }],
      subject: 'S', body: 'B {{player_profile_url}}', collegeName: 'Duke',
      division: 'NCAA D1', send: false,
    });
    expect(sends()).toHaveLength(1);
  });

  it('still binds when the programme has no coach row at all', async () => {
    const athlete = makeAthlete();
    relate(athlete, 'Duke', 'do_not_contact');
    // A first message to a programme we hold no contact for is a legitimate
    // send, and the claimed name must still resolve the relationship.
    await expect(sendOutreach({
      athleteId: athlete, coaches: [{ name: 'New', email: 'new@duke.test' }],
      subject: 'S', body: 'B', collegeName: 'Duke', send: false,
    })).rejects.toThrow(/do-not-contact/i);
  });
});
