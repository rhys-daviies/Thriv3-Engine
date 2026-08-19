import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow, daysAgoIso } from './time.js';
import { findOrCreateCoach } from './coaches.js';
import { createOutreach, resolveToken } from './outreach.js';
import { deactivateAthlete, reactivateAthlete, purgeExpiredEngagementData } from './athleteLifecycle.js';
import { ENGAGEMENT_RETENTION_GRACE_DAYS } from './config.js';

function makeAthlete(name = 'Test Athlete') {
  const id = randomUUID();
  const ts = utcNow();
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, public_slug)
    VALUES (?, ?, ?, ?, 'Left Winger', ?)
  `).run(id, ts, ts, name, randomUUID().slice(0, 10));
  return id;
}

function makeCoaches(count) {
  return Array.from({ length: count }, (_, i) =>
    findOrCreateCoach({
      full_name: `Coach ${i}`,
      email: `coach${i}@example.edu`,
      school: `School ${i}`,
      sport: 'mens-soccer',
    })
  );
}

function addEvent(outreachId, eventType = 'visit_qualified') {
  db.prepare(`
    INSERT INTO tracking_events (token, outreach_id, session_id, event_type, created_at)
    VALUES ('t', ?, ?, ?, ?)
  `).run(outreachId, randomUUID(), eventType, utcNow());
}

describe('deactivation cascade', () => {
  let athleteId;
  let outreachRows;

  beforeEach(() => {
    db.exec('DELETE FROM tracking_events; DELETE FROM engagement_rollup; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
    athleteId = makeAthlete();
    outreachRows = makeCoaches(8).map((coach) => createOutreach({ athleteId, coachId: coach.id }));
  });

  it('mints a unique token per athlete-coach pair', () => {
    expect(outreachRows).toHaveLength(8);
    expect(new Set(outreachRows.map((o) => o.token)).size).toBe(8);
  });

  it('is idempotent for the same pair', () => {
    const again = createOutreach({ athleteId, coachId: outreachRows[0].coach_id });
    expect(again.id).toBe(outreachRows[0].id);
    expect(again.token).toBe(outreachRows[0].token);
  });

  it('resolves a live token to its outreach row', () => {
    expect(resolveToken(outreachRows[0].token).id).toBe(outreachRows[0].id);
  });

  it('revokes every outreach row immediately on deactivation', () => {
    const result = deactivateAthlete(athleteId);
    expect(result.revokedOutreach).toBe(8);

    const live = db.prepare('SELECT COUNT(*) c FROM outreach WHERE athlete_id = ? AND revoked_at IS NULL').get(athleteId);
    expect(live.c).toBe(0);
  });

  it('stops revoked tokens resolving, without distinguishing them from unknown ones', () => {
    deactivateAthlete(athleteId);
    expect(resolveToken(outreachRows[0].token)).toBeNull();
    expect(resolveToken('a-token-that-never-existed')).toBeNull();
  });

  it('restores tokens on reactivation', () => {
    deactivateAthlete(athleteId);
    reactivateAthlete(athleteId);
    expect(resolveToken(outreachRows[0].token).id).toBe(outreachRows[0].id);
  });

  it('writes archived_at as ISO-8601 UTC with an explicit Z', () => {
    deactivateAthlete(athleteId);
    const { archived_at } = db.prepare('SELECT archived_at FROM players WHERE id = ?').get(athleteId);
    expect(archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('retention grace period', () => {
  let athleteId;
  let outreachId;

  beforeEach(() => {
    db.exec('DELETE FROM tracking_events; DELETE FROM engagement_rollup; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
    athleteId = makeAthlete();
    const [coach] = makeCoaches(1);
    outreachId = createOutreach({ athleteId, coachId: coach.id }).id;
    addEvent(outreachId);
    db.prepare('INSERT INTO engagement_rollup (outreach_id) VALUES (?)').run(outreachId);
  });

  it('keeps data for an active athlete', () => {
    expect(purgeExpiredEngagementData()).toMatchObject({ athletes: 0, events: 0 });
  });

  it('keeps data inside the grace period', () => {
    deactivateAthlete(athleteId, daysAgoIso(ENGAGEMENT_RETENTION_GRACE_DAYS - 1));
    expect(purgeExpiredEngagementData()).toMatchObject({ athletes: 0, events: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM tracking_events').get().c).toBe(1);
  });

  it('purges events and rollups once the grace period has passed', () => {
    deactivateAthlete(athleteId, daysAgoIso(ENGAGEMENT_RETENTION_GRACE_DAYS + 1));
    expect(purgeExpiredEngagementData()).toMatchObject({ athletes: 1, events: 1, rollups: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM tracking_events').get().c).toBe(0);
  });

  it('keeps the outreach row revoked after a purge, so sent links never resolve again', () => {
    deactivateAthlete(athleteId, daysAgoIso(ENGAGEMENT_RETENTION_GRACE_DAYS + 1));
    purgeExpiredEngagementData();
    const row = db.prepare('SELECT * FROM outreach WHERE id = ?').get(outreachId);
    expect(row).toBeTruthy();
    expect(row.revoked_at).not.toBeNull();
  });
});

describe('tracking_events is append-only', () => {
  it('rejects any UPDATE at the database level', () => {
    db.exec('DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
    const athleteId = makeAthlete();
    const [coach] = makeCoaches(1);
    const { id } = createOutreach({ athleteId, coachId: coach.id });
    addEvent(id);

    expect(() => db.prepare('UPDATE tracking_events SET coverage_pct = 100').run())
      .toThrow(/append-only/);
  });
});
