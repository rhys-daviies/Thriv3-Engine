import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';
import { recentSendCount, isSendCapped, capReport, overlapAcrossAthletes } from './sendCap.js';

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

function coach(email, { school = 'Example State', sport = 'mens-soccer' } = {}) {
  const id = randomUUID();
  db.prepare('INSERT INTO coaches (id, created_at, full_name, email, school, sport) VALUES (?,?,?,?,?,?)')
    .run(id, utcNow(), 'A Coach', email, school, sport);
  return id;
}

/** outreach.athlete_id is a real foreign key, so the athlete has to exist. */
function athlete(name = 'athlete-1') {
  const existing = db.prepare('SELECT id FROM players WHERE full_name = ?').get(name);
  if (existing) return existing.id;
  const id = randomUUID();
  const ts = utcNow();
  db.prepare('INSERT INTO players (id, created_date, updated_date, full_name, position) VALUES (?,?,?,?,?)')
    .run(id, ts, ts, name, 'Midfield');
  return id;
}

function outreachRow(coachId, { sentAt = utcNow(), athleteId } = {}) {
  db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, token, sent_at, created_at) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), athleteId || athlete(), coachId, randomUUID(), sentAt, utcNow());
}

beforeEach(() => { db.exec('DELETE FROM outreach; DELETE FROM coaches; DELETE FROM players;'); });

describe('recentSendCount', () => {
  it('ignores a draft that was never sent', () => {
    const id = coach('head@example.edu');
    outreachRow(id, { athleteId: athlete('sent') });
    db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, token, created_at) VALUES (?,?,?,?,?)')
      .run(randomUUID(), athlete('drafted'), id, randomUUID(), utcNow());
    expect(recentSendCount('head@example.edu')).toBe(1);
  });

  // outreach carries UNIQUE (athlete_id, coach_id), so there is one row per
  // pair and nowhere that records individual messages. This cap therefore
  // counts campaigns, and sequencing will need its own record of steps.
  it('counts one campaign per athlete, because the schema allows only one', () => {
    const id = coach('head@example.edu');
    const a = athlete('solo');
    outreachRow(id, { athleteId: a });
    expect(() => outreachRow(id, { athleteId: a })).toThrow(/UNIQUE/i);
    expect(recentSendCount('head@example.edu')).toBe(1);
  });

  it('counts across athletes — the inbox is what is being protected', () => {
    const id = coach('head@example.edu');
    outreachRow(id, { athleteId: athlete('a1') });
    outreachRow(id, { athleteId: athlete('a2') });
    outreachRow(id, { athleteId: athlete('a3') });
    expect(recentSendCount('head@example.edu')).toBe(3);
  });

  // coaches is keyed on (email, school, sport), so one human staffing both
  // programmes is two rows and would otherwise receive two full campaigns.
  it('counts one person across both sports at the same school', () => {
    outreachRow(coach('dual@example.edu', { sport: 'mens-soccer' }), { athleteId: athlete('m') });
    outreachRow(coach('dual@example.edu', { sport: 'womens-soccer' }), { athleteId: athlete('w') });
    expect(recentSendCount('dual@example.edu')).toBe(2);
  });

  it('ignores sends older than the window', () => {
    const id = coach('head@example.edu');
    outreachRow(id, { sentAt: daysAgo(45), athleteId: athlete('old') });
    outreachRow(id, { sentAt: daysAgo(5), athleteId: athlete('recent') });
    expect(recentSendCount('head@example.edu', { days: 30 })).toBe(1);
  });

  it('is case-insensitive on both sides', () => {
    outreachRow(coach('Head@Example.EDU'));
    expect(recentSendCount('head@example.edu')).toBe(1);
    expect(recentSendCount('HEAD@EXAMPLE.EDU')).toBe(1);
  });

  it('returns zero for an address nobody has written to', () => {
    expect(recentSendCount('stranger@example.edu')).toBe(0);
    expect(recentSendCount('')).toBe(0);
  });
});

describe('isSendCapped', () => {
  it('caps at the limit, not past it', () => {
    const id = coach('head@example.edu');
    outreachRow(id, { athleteId: athlete('a1') });
    outreachRow(id, { athleteId: athlete('a2') });
    expect(isSendCapped('head@example.edu', { max: 3 })).toBe(false);
    outreachRow(id, { athleteId: athlete('a3') });
    expect(isSendCapped('head@example.edu', { max: 3 })).toBe(true);
  });

  it('can be disabled deliberately, and only deliberately', () => {
    const id = coach('head@example.edu');
    for (let i = 0; i < 9; i++) outreachRow(id, { athleteId: athlete(`bulk-${i}`) });
    expect(isSendCapped('head@example.edu', { max: 3 })).toBe(true);
    expect(isSendCapped('head@example.edu', { max: 0 })).toBe(false);
  });
});

describe('capReport', () => {
  it('separates capped from near-limit, so a partial is not read as fine', () => {
    const capped = coach('full@example.edu');
    for (let i = 0; i < 3; i++) outreachRow(capped, { athleteId: athlete(`c-${i}`) });
    const near = coach('nearly@example.edu');
    outreachRow(near, { athleteId: athlete('n-1') });
    outreachRow(near, { athleteId: athlete('n-2') });
    coach('fresh@example.edu');

    const r = capReport(['full@example.edu', 'nearly@example.edu', 'fresh@example.edu'], { max: 3 });
    expect(r.capped.map((c) => c.email)).toEqual(['full@example.edu']);
    expect(r.nearLimit.map((c) => c.email)).toEqual(['nearly@example.edu']);
    expect(r.total).toBe(3);
  });

  it('deduplicates a list that names the same address twice', () => {
    coach('head@example.edu');
    expect(capReport(['head@example.edu', 'HEAD@example.edu']).total).toBe(1);
  });
});

describe('overlapAcrossAthletes', () => {
  it('finds addresses on more than one athlete list, busiest first', () => {
    const overlap = overlapAcrossAthletes({
      Ana: ['a@x.edu', 'b@x.edu', 'c@x.edu'],
      Ben: ['b@x.edu', 'c@x.edu'],
      Cara: ['c@x.edu'],
    });
    expect(overlap[0]).toMatchObject({ email: 'c@x.edu', count: 3 });
    expect(overlap[1]).toMatchObject({ email: 'b@x.edu', count: 2 });
    expect(overlap.find((o) => o.email === 'a@x.edu')).toBeUndefined();
  });

  it('does not count one athlete listing the same coach twice as an overlap', () => {
    expect(overlapAcrossAthletes({ Ana: ['a@x.edu', 'A@X.edu'] })).toEqual([]);
  });
});
