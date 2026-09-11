import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';

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
const { manualOutreachRouter } = await import('./manualOutreach.js');
const { OUTREACH_ORIGIN } = await import('../../shared/outreachOrigin.js');
const { upsertAthleteProgramme } = await import('../lib/athleteProgrammes.js');

/**
 * WHERE PROVENANCE COMES FROM, PATH BY PATH.
 *
 * The rule under test is that every NEW send this system can classify gets
 * classified, and that NULL stops meaning "we forgot". The other half is that
 * no request body can choose the answer — so both routes are mounted for real
 * and driven over HTTP with hostile payloads.
 */

let baseUrl;

/**
 * `server/index.js` is not importable in a test — it opens the working
 * database, mounts authentication and starts a listener — so the two handlers
 * are reproduced here EXACTLY as that file declares them. The assertion below
 * checks the real file still says this, so a drift fails rather than passes.
 */
const app = express();
app.use(express.json());
app.post('/api/outreach/send', async (req, res) => {
  try {
    res.json(await sendOutreach(req.body || {}, { origin: OUTREACH_ORIGIN.MANUAL }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.use('/api', manualOutreachRouter);
await new Promise((resolve) => {
  const server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
  server.unref();
});

const post = async (url, body) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const CHAPTERS = [{ t: 10, label: 'Opening' }];

function makeAthlete() {
  const id = randomUUID();
  const ts = utcNow();
  const row = {
    id, created_date: ts, updated_date: ts, full_name: 'Nikau Brennan',
    position: 'Left Winger', graduation_year: 2027, email: 'athlete@example.com',
    video_id: 'aqz-KE-bpKQ', video_chapters: JSON.stringify(CHAPTERS),
    public_slug: randomUUID().slice(0, 10), sport: 'mens-soccer',
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
  return id;
}

function canonicalCoach({ email, school = 'Duke', sport = 'mens-soccer' }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-11T00:00:00.000Z', 'A Coach', ?, ?, 'NCAA D1', ?, 'Head Coach')
  `).run(id, email, school, sport);
  return id;
}

const origins = () => db.prepare('SELECT origin FROM outreach_send').all().map((r) => r.origin);

beforeEach(() => {
  composed.length = 0;
  db.exec(`DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM colleges; DELETE FROM players; DELETE FROM coaches;`);
});

const BODY = (athleteId) => ({
  athleteId,
  coaches: [{ name: 'A Coach', email: 'a@duke.test', title: 'Head Coach' }],
  subject: 'S', body: 'B {{player_profile_url}}', greetingName: 'A Coach',
  collegeName: 'Duke', division: 'NCAA D1', send: false,
});

// ---------------------------------------------------------------------------

describe('the shared browser endpoint', () => {
  it('records manual — an operator composing by hand', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'a@duke.test' });
    const { status } = await post('/api/outreach/send', BODY(athlete));
    expect(status).toBe(200);
    // Everything past requireOperator is a signed-in person; the two things
    // that reach this endpoint are both a person composing and approving.
    expect(origins()).toEqual(['manual']);
  });

  it('IGNORES an origin in the request body', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'a@duke.test' });
    await post('/api/outreach/send', { ...BODY(athlete), origin: 'campaign' });
    // The context is a second argument; a spread of req.body reaches nothing.
    expect(origins()).toEqual(['manual']);
  });

  it('cannot be talked into an origin outside the vocabulary either', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'a@duke.test' });
    await post('/api/outreach/send', { ...BODY(athlete), origin: 'definitely_not_manual' });
    expect(origins()).toEqual(['manual']);
  });

  it('still refuses a do-not-contact relationship from this route', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'a@duke.test' });
    db.prepare(`
      INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
        flagged, visibility, contact_stance, created_at, updated_at)
      VALUES (?, ?, 'Duke', 'mens-soccer', 'requested', 1, 'suppressed', 'do_not_contact',
        '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z')
    `).run(randomUUID(), athlete);

    const { status, body } = await post('/api/outreach/send', {
      ...BODY(athlete), contact_stance: 'default', visibility: 'default',
      flagged: false, request_state: 'none',
    });
    // Not the manual route, and every relationship field in the body ignored.
    expect(status).toBe(400);
    expect(body.error).toMatch(/do-not-contact/i);
    expect(origins()).toEqual([]);
  });
});

describe('the manual relationship route', () => {
  it('records manual', async () => {
    const athlete = makeAthlete();
    const coachId = canonicalCoach({ email: 'a@duke.test' });
    db.prepare(`
      INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active)
      VALUES ('col-d', '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 'Duke', 'mens-soccer', 'NCAA D1', 1)
    `).run();
    const rel = upsertAthleteProgramme(athlete, { college_id: 'col-d' }).programme.id;

    const { status } = await post(`/api/players/${athlete}/programmes/${rel}/outreach`, {
      coachIds: [coachId], subject: 'S', body: 'B {{player_profile_url}}', greetingName: 'A Coach',
    });
    expect(status).toBe(200);
    expect(origins()).toEqual(['manual']);
    expect(db.prepare('SELECT programme_campaign_id FROM outreach_send').get().programme_campaign_id)
      .toBeNull();
  });
});

describe('campaign attribution overrides whatever composed the message', () => {
  it('records campaign, not the route default', async () => {
    const athlete = makeAthlete();
    const coachId = canonicalCoach({ email: 'a@duke.test' });

    db.prepare(`
      INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
        snapshot_taken_at, programme_count)
      VALUES ('c-1', ?, 'mens-soccer', 'active', '2026-01-01', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)
    `).run(athlete);
    db.prepare(`
      INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, college_id, rank,
        match_score, division, conference, tier, state, created_at, updated_at)
      VALUES ('pc-1', 'c-1', 'Duke', 'mens-soccer', NULL, 1, 90, 'NCAA D1', 'ACC', 'A', 'queued',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run();

    const { status } = await post('/api/outreach/send', {
      ...BODY(athlete), programmeCampaignId: 'pc-1',
    });
    expect(status).toBe(200);
    /**
     * The route said `manual`. `recordDraft` overrode it against the
     * attribution it VERIFIED — a message that really is campaign work is
     * recorded as campaign work whatever composed it.
     */
    expect(origins()).toEqual(['campaign']);
    expect(coachId).toBeTruthy();
  });
});

describe('the function default is not a path default', () => {
  it('is NULL only for a caller that named nothing', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'a@duke.test' });
    await sendOutreach(BODY(athlete));
    // Reserved for history and for a path nobody has classified yet — not
    // something a new send quietly receives.
    expect(origins()).toEqual([null]);
  });

  it('every call site in the tree names one', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = process.cwd();

    // server/index.js is not importable here, so its handler is reproduced at
    // the top of this file. Check the real one still agrees.
    const index = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
    expect(index).toMatch(/sendOutreach\(req\.body \|\| \{\}, \{ origin: OUTREACH_ORIGIN\.MANUAL \}\)/);

    const cli = fs.readFileSync(path.join(root, 'server/scripts/draftOutreach.js'), 'utf8');
    expect(cli).toMatch(/origin: OUTREACH_ORIGIN\.MANUAL/);

    const manual = fs.readFileSync(path.join(root, 'server/routes/manualOutreach.js'), 'utf8');
    expect(manual).toMatch(/\{ origin: OUTREACH_ORIGIN\.MANUAL \}/);
  });

  it('backfills no historical row', async () => {
    const athlete = makeAthlete();
    canonicalCoach({ email: 'a@duke.test' });
    await sendOutreach(BODY(athlete));
    const before = origins();
    expect(before).toEqual([null]);

    // A later classified send does not retro-label what came before it.
    await post('/api/outreach/send', BODY(athlete));
    expect(origins().filter((o) => o === null)).toHaveLength(1);
  });
});
