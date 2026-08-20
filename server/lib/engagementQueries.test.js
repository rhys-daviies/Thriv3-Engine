import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';
import { findOrCreateCoach } from './coaches.js';
import { createOutreach } from './outreach.js';
import { rebuildAllRollups, rebuildRollup } from './engagementRollup.js';
import {
  outreachFunnel, coachEngagement, coachSessions, retentionCurve, chapterEngagement,
} from './engagementQueries.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const T0 = Date.parse('2026-08-01T10:00:00.000Z');
const REEL = 200;

let athleteId;

const insert = db.prepare(`
  INSERT INTO tracking_events
    (token, outreach_id, session_id, event_type, coverage_pct, watched_seconds,
     duration_seconds, dwell_seconds, rewinds, skips, payload, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)
`);

function makeAthlete(chapters = [{ t: 10, label: 'Opening' }, { t: 100, label: 'Middle' }]) {
  const id = randomUUID();
  const ts = utcNow();
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, public_slug, video_chapters)
    VALUES (?, ?, ?, 'A', 'Winger', ?, ?)
  `).run(id, ts, ts, randomUUID().slice(0, 10), JSON.stringify(chapters));
  return id;
}

function makeCoach(name) {
  return findOrCreateCoach({ full_name: name, email: `${randomUUID()}@example.edu`, school: 'S', sport: 'mens-soccer' });
}

function addOutreach(name) {
  return createOutreach({ athleteId, coachId: makeCoach(name).id });
}

/** Writes one session. `watchedTo` null means the session never qualified. */
function watch(outreachId, { at, watchedTo = null, rewinds = 0, chapters = [] }) {
  const sessionId = randomUUID();
  let t = at;
  const write = (type, cov, watched, payload = {}) =>
    insert.run('tok', outreachId, sessionId, type, cov, watched, REEL, rewinds, JSON.stringify(payload), new Date(t).toISOString());

  write('visit_start', 0, 0);
  if (watchedTo === null) return sessionId; // scanner: fetched and did nothing

  t += 2000;
  write('visit_qualified', 0, 0, { reason: 'video_play' });
  for (const c of chapters) {
    t += 1000;
    write('chapter_jump', 0, 0, { toSeconds: c.t, label: c.label });
  }
  t += 2000;
  const coverage = Math.round((watchedTo / REEL) * 100);
  write('session_end', coverage, watchedTo, { coverageRanges: [[0, watchedTo]] });
  return sessionId;
}

beforeEach(() => {
  db.exec('DELETE FROM engagement_rollup; DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
  athleteId = makeAthlete();
});

describe('outreach funnel', () => {
  it('counts each stage', () => {
    const deep = addOutreach('Deep');
    const half = addOutreach('Half');
    const shallow = addOutreach('Shallow');
    addOutreach('Untouched');

    watch(deep.id, { at: T0, watchedTo: 190 });
    watch(deep.id, { at: T0 + 4 * DAY, watchedTo: 190 });   // a return
    watch(half.id, { at: T0, watchedTo: 150 });             // 75%
    watch(shallow.id, { at: T0, watchedTo: 20 });           // 10%
    rebuildAllRollups();

    expect(outreachFunnel(athleteId)).toEqual({ sent: 4, qualified: 3, watchedHalf: 2, returned: 1 });
  });

  it('drops revoked outreach from the sent count', () => {
    const live = addOutreach('Live');
    const revoked = addOutreach('Revoked');
    db.prepare('UPDATE outreach SET revoked_at = ? WHERE id = ?').run(utcNow(), revoked.id);
    expect(outreachFunnel(athleteId).sent).toBe(1);
    expect(live).toBeTruthy();
  });
});

describe('coach table', () => {
  it('shows zero qualified views for a coach whose only activity was a scanner pre-fetch', () => {
    const scanned = addOutreach('Scanned');
    watch(scanned.id, { at: T0, watchedTo: null });
    watch(scanned.id, { at: T0 + 2 * DAY, watchedTo: null });
    rebuildAllRollups();

    const [row] = coachEngagement(athleteId);
    expect(row.qualified_visits).toBe(0);
    expect(row.engagement_score).toBe(0);
    expect(row.tier).toBe('cold');
  });

  it('shows two visits for a coach with qualified sessions four days apart', () => {
    const o = addOutreach('Returner');
    watch(o.id, { at: T0, watchedTo: 100 });
    watch(o.id, { at: T0 + 4 * DAY, watchedTo: 180 });
    rebuildAllRollups();

    expect(coachEngagement(athleteId)[0].qualified_visits).toBe(2);
  });

  it('sorts by score descending', () => {
    const low = addOutreach('Low');
    const high = addOutreach('High');
    watch(low.id, { at: T0, watchedTo: 20 });
    watch(high.id, { at: T0, watchedTo: 190 });
    watch(high.id, { at: T0 + 4 * DAY, watchedTo: 190 });
    rebuildAllRollups();

    const scores = coachEngagement(athleteId).map((c) => c.engagement_score);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it('lists a coach with no activity at all rather than hiding them', () => {
    addOutreach('Silent');
    expect(coachEngagement(athleteId)).toHaveLength(1);
    expect(coachEngagement(athleteId)[0].qualified_visits).toBe(0);
  });
});

describe('coach session timeline', () => {
  it('numbers sessions by visit, so the timeline agrees with the coach table', () => {
    const o = addOutreach('C');
    watch(o.id, { at: T0, watchedTo: 100 });
    watch(o.id, { at: T0 + 7 * MINUTE, watchedTo: 120 });  // same visit
    watch(o.id, { at: T0 + 4 * DAY, watchedTo: 150 });     // a real return
    const rollup = rebuildRollup(o.id);

    const sessions = coachSessions(o.id);
    expect(sessions).toHaveLength(3);
    expect(new Set(sessions.map((s) => s.visit_number)).size).toBe(rollup.qualified_visits);
    expect(rollup.qualified_visits).toBe(2);
    expect(sessions.filter((s) => s.starts_visit)).toHaveLength(2);
  });

  it('excludes sessions that never qualified', () => {
    const o = addOutreach('C');
    watch(o.id, { at: T0, watchedTo: null });
    watch(o.id, { at: T0 + 4 * DAY, watchedTo: 100 });
    expect(coachSessions(o.id)).toHaveLength(1);
  });

  it('lists the chapters jumped to in each session', () => {
    const o = addOutreach('C');
    watch(o.id, { at: T0, watchedTo: 100, chapters: [{ t: 10, label: 'Opening' }] });
    expect(coachSessions(o.id)[0].chapters).toEqual(['Opening']);
  });
});

describe('retention curve', () => {
  it('has a defined empty state', () => {
    addOutreach('C');
    const curve = retentionCurve(athleteId);
    expect(curve.viewers).toBe(0);
    expect(curve.points).toEqual([]);
  });

  it('renders with a single viewer', () => {
    const o = addOutreach('C');
    watch(o.id, { at: T0, watchedTo: 100 });

    const curve = retentionCurve(athleteId);
    expect(curve.viewers).toBe(1);
    expect(curve.points.length).toBeGreaterThan(0);
    expect(curve.points[0].pct).toBe(100);
    expect(curve.points[curve.points.length - 1].pct).toBe(0); // dropped before the end
  });

  it('renders with fifty viewers and decays monotonically when they stop progressively', () => {
    for (let i = 0; i < 50; i++) {
      const o = addOutreach(`C${i}`);
      watch(o.id, { at: T0 + i * DAY, watchedTo: 20 + i * 3 });
    }

    const curve = retentionCurve(athleteId);
    expect(curve.viewers).toBe(50);
    expect(curve.points[0].pct).toBe(100);

    const pcts = curve.points.map((p) => p.pct);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeLessThanOrEqual(pcts[i - 1]);
  });

  it('ignores sessions that never qualified', () => {
    const o = addOutreach('C');
    watch(o.id, { at: T0, watchedTo: null });
    expect(retentionCurve(athleteId).viewers).toBe(0);
  });

  it('carries the athlete chapters for overlay', () => {
    const o = addOutreach('C');
    watch(o.id, { at: T0, watchedTo: 100 });
    expect(retentionCurve(athleteId).chapters).toHaveLength(2);
  });
});

describe('chapter engagement', () => {
  it('ranks clips by jumps, counting distinct coaches', () => {
    const a = addOutreach('A');
    const b = addOutreach('B');
    watch(a.id, { at: T0, watchedTo: 100, chapters: [{ t: 10, label: 'Opening' }, { t: 100, label: 'Middle' }] });
    watch(a.id, { at: T0 + 4 * DAY, watchedTo: 100, chapters: [{ t: 10, label: 'Opening' }] });
    watch(b.id, { at: T0, watchedTo: 100, chapters: [{ t: 10, label: 'Opening' }] });

    const ranked = chapterEngagement(athleteId);
    expect(ranked[0]).toMatchObject({ label: 'Opening', jumps: 3, coaches: 2 });
    expect(ranked[1]).toMatchObject({ label: 'Middle', jumps: 1, coaches: 1 });
  });

  it('has a defined empty state', () => {
    addOutreach('C');
    expect(chapterEngagement(athleteId)).toEqual([]);
  });
});

describe('rollups do not outlive their events', () => {
  it('resets an outreach whose events have been deleted', () => {
    const o = addOutreach('C');
    watch(o.id, { at: T0, watchedTo: 190 });
    watch(o.id, { at: T0 + 4 * DAY, watchedTo: 190 });
    rebuildAllRollups();
    expect(coachEngagement(athleteId)[0].qualified_visits).toBe(2);

    db.prepare('DELETE FROM tracking_events WHERE outreach_id = ?').run(o.id);
    rebuildAllRollups();

    const [row] = coachEngagement(athleteId);
    expect(row.qualified_visits).toBe(0);
    expect(row.best_coverage_pct).toBe(0);
    expect(row.engagement_score).toBe(0);
  });
});
