import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// Intercept the Outlook bridge so the orchestration can be inspected without
// opening a compose window on whoever runs the suite.
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

const CHAPTERS = [
  { t: 10, label: 'Opening' },
  { t: 60, label: 'Middle' },
  { t: 120, label: 'Late' },
];

function makeAthlete(overrides = {}) {
  const id = randomUUID();
  const ts = utcNow();
  const row = {
    id,
    created_date: ts,
    updated_date: ts,
    full_name: 'Nikau Brennan',
    position: 'Left Winger',
    graduation_year: 2027,
    email: 'athlete@example.com',
    video_id: 'aqz-KE-bpKQ',
    video_chapters: JSON.stringify(CHAPTERS),
    public_slug: randomUUID().slice(0, 10),
    sport: 'mens-soccer',
    ...overrides,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
  return id;
}

const COACHES = [
  { name: 'A. Whitfield', email: 'awhitfield@example.edu', title: 'Head Coach' },
  { name: 'J. Marsden', email: 'jmarsden@example.edu', title: 'Assistant Coach' },
];

const BODY = 'Dear A. Whitfield,\n\nI am writing about Nikau Brennan.\n\nBest regards,\nThriv3';

const baseRequest = (athleteId, overrides = {}) => ({
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

beforeEach(() => {
  composed.length = 0;
  // outreach_evidence references outreach, so it goes first — sendOutreach
  // now writes a row per message describing the personalisation it used.
  db.exec('DELETE FROM outreach_evidence; DELETE FROM engagement_rollup; DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches; DELETE FROM suppressions;');
});

describe('one email per coach', () => {
  it('composes a separate message for each coach', async () => {
    const athleteId = makeAthlete();
    const { results } = await sendOutreach(baseRequest(athleteId));

    expect(results).toHaveLength(2);
    expect(composed).toHaveLength(2);
    expect(composed.map((m) => m.to)).toEqual(['awhitfield@example.edu', 'jmarsden@example.edu']);
  });

  it('gives every coach a different token, so viewing attributes to them alone', async () => {
    const athleteId = makeAthlete();
    const { results } = await sendOutreach(baseRequest(athleteId));

    const tokens = results.map((r) => new URL(r.url).searchParams.get('ref'));
    expect(new Set(tokens).size).toBe(2);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('puts each coach their own link and nobody else\'s', async () => {
    const athleteId = makeAthlete();
    const { results } = await sendOutreach(baseRequest(athleteId));

    composed.forEach((message, i) => {
      expect(message.body).toContain(results[i].url);
      const others = results.filter((_, n) => n !== i);
      for (const other of others) expect(message.body).not.toContain(other.url);
    });
  });

  it('readdresses the greeting to each coach', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(baseRequest(athleteId));

    expect(composed[0].body).toContain('Dear A. Whitfield,');
    expect(composed[1].body).toContain('Dear J. Marsden,');
    expect(composed[1].body).not.toContain('Dear A. Whitfield,');
  });
});

describe('the link always gets in', () => {
  it('substitutes the {{player_profile_url}} token where the template has one', async () => {
    const athleteId = makeAthlete();
    const { results } = await sendOutreach(baseRequest(athleteId, {
      body: 'Dear A. Whitfield,\n\nFilm: {{player_profile_url}}\n\nThriv3',
    }));

    expect(composed[0].body).toContain(results[0].url);
    expect(composed[0].body).not.toContain('{{player_profile_url}}');
  });

  it('appends the link to a template written before tracking existed', async () => {
    const athleteId = makeAthlete();
    const { results } = await sendOutreach(baseRequest(athleteId));
    expect(composed[0].body).toContain(results[0].url);
  });

  it('does not add the link twice', async () => {
    const athleteId = makeAthlete();
    const { results } = await sendOutreach(baseRequest(athleteId, {
      body: 'Dear A. Whitfield,\n\n{{player_profile_url}}\n\nThriv3',
    }));
    const occurrences = composed[0].body.split(results[0].url).length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('evidence logging', () => {
  // The browser composer posts no evidence — it receives rendered prose from
  // /api/players/:id/evidence and has no objects to send back — so the send
  // path derives it here. Without this every email drafted from the UI would
  // be unattributable, which is the one thing the log exists to prevent.
  it('derives and logs evidence when the caller supplied none', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(baseRequest(athleteId));

    const rows = db.prepare(`
      SELECT e.* FROM outreach_evidence e
      JOIN outreach o ON o.id = e.outreach_id WHERE o.athlete_id = ?
    `).all(athleteId);

    expect(rows).toHaveLength(2);            // one per coach
    expect(rows[0].college_name).toBe('Butler University');
    expect(rows[0].structure).toBeTruthy();
    // No roster rows in this fixture, so the honest answer is "no roster" —
    // not a graduating count of zero.
    expect(rows[0].had_roster).toBe(0);
  });

  it('records whether the evidence sentence survived into the body', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(baseRequest(athleteId, { body: 'Nothing about the programme here.' }));

    const row = db.prepare(`
      SELECT e.evidence_rendered FROM outreach_evidence e
      JOIN outreach o ON o.id = e.outreach_id WHERE o.athlete_id = ? LIMIT 1
    `).get(athleteId);

    // Null rather than 0: this fixture produces no sentence to look for, so
    // "was it carried" has no answer. A false here would read as the operator
    // having deleted something.
    expect(row.evidence_rendered).toBeNull();
  });

  it('does not fail a send when evidence cannot be worked out', async () => {
    const athleteId = makeAthlete();
    const { results } = await sendOutreach(baseRequest(athleteId, { collegeName: null }));
    expect(results.every((r) => r.status === 'drafted')).toBe(true);
  });
});

describe('persistence', () => {
  it('creates coach and outreach records carrying the match id', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(baseRequest(athleteId));

    const rows = db.prepare(`
      SELECT c.full_name, c.school, c.position_title, o.match_id, o.drafted_at, o.sent_at
      FROM outreach o JOIN coaches c ON c.id = o.coach_id WHERE o.athlete_id = ?
    `).all(athleteId);

    expect(rows).toHaveLength(2);
    expect(rows[0].school).toBe('Butler University');
    expect(rows[0].match_id).toBe('Butler University');
    // Drafted, and NOT claimed as sent. `baseRequest` does not pass
    // `send: true`, so the message went to Outlook as a draft and nothing
    // observed whether it was then sent — see server/lib/confirmSends.js.
    expect(rows[0].drafted_at).toMatch(/Z$/);
    expect(rows[0].sent_at).toBeNull();
  });

  it('reuses the same token when the same coach is contacted again', async () => {
    const athleteId = makeAthlete();
    const first = await sendOutreach(baseRequest(athleteId));
    const second = await sendOutreach(baseRequest(athleteId));
    expect(second.results[0].url).toBe(first.results[0].url);
    expect(db.prepare('SELECT COUNT(*) c FROM outreach WHERE athlete_id = ?').get(athleteId).c).toBe(2);
  });

  it('drafts by default and only sends when explicitly asked', async () => {
    const athleteId = makeAthlete();
    const drafted = await sendOutreach(baseRequest(athleteId));
    expect(drafted.results.every((r) => r.status === 'drafted')).toBe(true);
    expect(composed.every((m) => m.send === false)).toBe(true);

    composed.length = 0;
    const sent = await sendOutreach(baseRequest(athleteId, { send: true }));
    expect(sent.results.every((r) => r.status === 'sent')).toBe(true);
    expect(composed.every((m) => m.send === true)).toBe(true);
  });
});

describe('refusing to send a dead link', () => {
  it('refuses when the athlete cannot have a profile page generated', async () => {
    const athleteId = makeAthlete({ video_id: null });
    await expect(sendOutreach(baseRequest(athleteId))).rejects.toThrow(/cannot be generated yet/);
    expect(composed).toHaveLength(0);
  });

  it('names what is missing rather than failing vaguely', async () => {
    const athleteId = makeAthlete({ email: null });
    await expect(sendOutreach(baseRequest(athleteId))).rejects.toThrow(/contact email/);
  });

  it('sends happily for an athlete with no chapters at all', async () => {
    const athleteId = makeAthlete({ video_chapters: '[]' });
    const { results } = await sendOutreach(baseRequest(athleteId));
    expect(results.every((r) => r.status === 'drafted')).toBe(true);
  });

  it('reports one coach failing without abandoning the rest', async () => {
    const athleteId = makeAthlete();
    const { results } = await sendOutreach(baseRequest(athleteId, {
      coaches: [{ name: 'No Address', email: '', title: 'Head Coach' }, ...COACHES],
    }));

    expect(results[0].status).toBe('error');
    expect(results[1].status).toBe('drafted');
    expect(results[2].status).toBe('drafted');
  });

  it('flags that localhost links are not reachable by a coach', async () => {
    const athleteId = makeAthlete();
    const { reachable, baseUrl } = await sendOutreach(baseRequest(athleteId));
    expect(baseUrl).toMatch(/localhost/);
    expect(reachable).toBe(false);
  });
});


describe('compliance', () => {
  it('puts the sender, a postal address and an opt-out in every message', async () => {
    const id = makeAthlete();
    await sendOutreach(baseRequest(id));
    expect(composed).toHaveLength(2);
    for (const message of composed) {
      expect(message.body).toContain('Thriv3 (test)');
      expect(message.body).toContain('1 Test Street, Testville, TS 00000');
      expect(message.body).toMatch(/reply and we'll take you off our list/);
    }
  });

  // The footer is concatenated at send time rather than offered as a token,
  // so an operator cannot delete it out of a template without noticing.
  it('appends the footer even to a template that never mentioned it', async () => {
    const id = makeAthlete();
    await sendOutreach(baseRequest(id, { body: 'Hi.' }));
    expect(composed[0].body).toContain("If you'd rather not hear from us");
    expect(composed[0].body).toContain('1 Test Street, Testville, TS 00000');
  });

  // The opt-out moved from a per-coach link to a reply, so the long
  // unsubscribe URL — the clearest "this is bulk mail" signal in the message
  // — must be gone from what actually ships.
  it('no longer puts an unsubscribe URL in the body', async () => {
    const id = makeAthlete();
    await sendOutreach(baseRequest(id));
    for (const message of composed) {
      expect(message.body).not.toMatch(/\/u\/[A-Za-z0-9]{8,}/);
    }
  });

  // Nothing records a replied opt-out, so the tracked link must still be the
  // only per-coach thing in the message: attribution depends on it.
  it('still gives each coach their own tracked profile link', async () => {
    const id = makeAthlete();
    await sendOutreach(baseRequest(id));
    const refs = composed.map((m) => m.body.match(/[?&]ref=([A-Za-z0-9]+)/)[1]);
    expect(new Set(refs).size).toBe(2);
  });

  it('never mails a suppressed address, whatever the caller passes', async () => {
    const id = makeAthlete();
    suppress({ email: 'awhitfield@example.edu', reason: 'unsubscribed', source: 'edge' });
    const { results } = await sendOutreach(baseRequest(id));

    expect(composed).toHaveLength(1);
    expect(composed[0].to).toBe('jmarsden@example.edu');
    expect(results.find((r) => r.email === 'awhitfield@example.edu').status).toBe('suppressed');
    // And no outreach row, so nothing counts it as contacted.
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(1);
  });

  it('matches a suppressed address regardless of casing', async () => {
    const id = makeAthlete();
    suppress({ email: 'AWhitfield@Example.EDU' });
    const { results } = await sendOutreach(baseRequest(id));
    expect(results.find((r) => r.email === 'awhitfield@example.edu').status).toBe('suppressed');
  });

  /**
   * The gap check itself, on a fresh copy of config with the value cleared.
   * Re-importing sendOutreach would give it a fresh in-memory database too,
   * so the athlete would vanish before the compliance guard ever ran and the
   * test would pass for the wrong reason.
   *
   * That the send path consults this is proved by every other test in the
   * file: they all failed the moment the guard was added and before the suite
   * was given a valid configuration.
   */
  it('reports each missing piece by name', async () => {
    const saved = {
      identity: process.env.THRIV3_SENDER_IDENTITY,
      postal: process.env.THRIV3_POSTAL_ADDRESS,
      unsub: process.env.THRIV3_UNSUBSCRIBE_BASE_URL,
    };
    try {
      process.env.THRIV3_SENDER_IDENTITY = '';
      process.env.THRIV3_POSTAL_ADDRESS = '';
      process.env.THRIV3_UNSUBSCRIBE_BASE_URL = 'http://localhost:8787';
      const fresh = await import('../lib/config.js?unconfigured');
      const gaps = fresh.complianceGaps().join(' ');
      expect(gaps).toMatch(/THRIV3_SENDER_IDENTITY/);
      expect(gaps).toMatch(/THRIV3_POSTAL_ADDRESS/);
      // No longer a gap. The opt-out is a reply, so the unsubscribe URL is not
      // the mechanism any more and gating a send on it would assert something
      // nothing points at. What a reply opt-out needs is a person actioning
      // it, which no config check can verify — the trial preflight says so on
      // every run instead.
      expect(gaps).not.toMatch(/THRIV3_UNSUBSCRIBE_BASE_URL/);
    } finally {
      process.env.THRIV3_SENDER_IDENTITY = saved.identity;
      process.env.THRIV3_POSTAL_ADDRESS = saved.postal;
      process.env.THRIV3_UNSUBSCRIBE_BASE_URL = saved.unsub;
    }
  });

  it('is satisfied by the configuration this suite runs under', async () => {
    const { complianceGaps } = await import('../lib/config.js');
    expect(complianceGaps()).toEqual([]);
  });
});
