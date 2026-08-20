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
  db.exec('DELETE FROM engagement_rollup; DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
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

describe('persistence', () => {
  it('creates coach and outreach records carrying the match id', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(baseRequest(athleteId));

    const rows = db.prepare(`
      SELECT c.full_name, c.school, c.position_title, o.match_id, o.sent_at
      FROM outreach o JOIN coaches c ON c.id = o.coach_id WHERE o.athlete_id = ?
    `).all(athleteId);

    expect(rows).toHaveLength(2);
    expect(rows[0].school).toBe('Butler University');
    expect(rows[0].match_id).toBe('Butler University');
    expect(rows[0].sent_at).toMatch(/Z$/);
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
