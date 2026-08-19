import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';
import { findOrCreateCoach } from './coaches.js';
import { createOutreach } from './outreach.js';
import {
  rebuildRollup, collapseSessions, engagementScore, tierFor, markResponded, clearResponded,
} from './engagementRollup.js';
import { SESSION_COLLAPSE_MINUTES } from './config.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const T0 = Date.parse('2026-08-01T10:00:00.000Z');

function makeOutreach() {
  const athleteId = randomUUID();
  const ts = utcNow();
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, public_slug)
    VALUES (?, ?, ?, 'A', 'Winger', ?)
  `).run(athleteId, ts, ts, randomUUID().slice(0, 10));
  const coach = findOrCreateCoach({ full_name: 'C', email: `${randomUUID()}@example.edu`, school: 'S', sport: 'mens-soccer' });
  return createOutreach({ athleteId, coachId: coach.id });
}

const insert = db.prepare(`
  INSERT INTO tracking_events
    (token, outreach_id, session_id, event_type, coverage_pct, watched_seconds, rewinds, skips, payload, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
`);

/** Writes one session's worth of events, mirroring what the tracker emits. */
function session(outreachId, { at, qualified = true, coverage = 0, watched = 0, rewinds = 0, chapterJumps = 0, events = 4, stepMs = 1000 }) {
  const sessionId = randomUUID();
  let t = at;
  const write = (type, cov, w, r) => insert.run('tok', outreachId, sessionId, type, cov, w, r, 0, new Date(t).toISOString());

  write('visit_start', 0, 0, 0);
  if (qualified) {
    t += stepMs;
    write('visit_qualified', 0, 0, 0);
  }
  for (let i = 0; i < chapterJumps; i++) {
    t += stepMs;
    write('chapter_jump', 0, 0, 0);
  }
  // Counters arrive as running totals; the last event of the session carries
  // the session's final figures.
  for (let i = 1; i <= events; i++) {
    t += stepMs;
    write('play_start', Math.round((coverage * i) / events), Math.round((watched * i) / events), Math.round((rewinds * i) / events));
  }
  t += stepMs;
  write('session_end', coverage, watched, rewinds);
  return sessionId;
}

beforeEach(() => {
  db.exec('DELETE FROM engagement_rollup; DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
});

describe('qualified visits only', () => {
  it('ignores a session that never qualified — the Safe Links case', () => {
    const o = makeOutreach();
    session(o.id, { at: T0, qualified: false, coverage: 0, watched: 0, events: 0 });

    const row = rebuildRollup(o.id);
    expect(row.qualified_visits).toBe(0);
    expect(row.engagement_score).toBe(0);
    expect(row.tier).toBe('cold');
  });

  it('counts a session that did qualify', () => {
    const o = makeOutreach();
    session(o.id, { at: T0, coverage: 40, watched: 90 });
    expect(rebuildRollup(o.id).qualified_visits).toBe(1);
  });

  it('excludes unqualified sessions from every total, not just the visit count', () => {
    const o = makeOutreach();
    session(o.id, { at: T0, qualified: false, coverage: 99, watched: 600, rewinds: 9, chapterJumps: 5 });

    const row = rebuildRollup(o.id);
    expect(row.best_coverage_pct).toBe(0);
    expect(row.total_watched_seconds).toBe(0);
    expect(row.total_rewinds).toBe(0);
    expect(row.chapter_jumps).toBe(0);
  });
});

describe('session collapse', () => {
  it('treats sessions five minutes apart as one visit', () => {
    const o = makeOutreach();
    session(o.id, { at: T0 });
    session(o.id, { at: T0 + 5 * MINUTE });
    expect(rebuildRollup(o.id).qualified_visits).toBe(1);
  });

  it('treats sessions four days apart as two visits', () => {
    const o = makeOutreach();
    session(o.id, { at: T0 });
    session(o.id, { at: T0 + 4 * DAY });
    expect(rebuildRollup(o.id).qualified_visits).toBe(2);
  });

  it('splits exactly at the collapse window', () => {
    const inside = collapseSessions([
      { started_at: new Date(T0).toISOString(), ended_at: new Date(T0).toISOString() },
      { started_at: new Date(T0 + (SESSION_COLLAPSE_MINUTES - 1) * MINUTE).toISOString(), ended_at: new Date(T0).toISOString() },
    ]);
    const outside = collapseSessions([
      { started_at: new Date(T0).toISOString(), ended_at: new Date(T0).toISOString() },
      { started_at: new Date(T0 + (SESSION_COLLAPSE_MINUTES + 1) * MINUTE).toISOString(), ended_at: new Date(T0).toISOString() },
    ]);
    expect(inside).toHaveLength(1);
    expect(outside).toHaveLength(2);
  });

  it('measures the gap from the previous session end, so a long watch is still one visit', () => {
    const o = makeOutreach();
    session(o.id, { at: T0, events: 40, stepMs: MINUTE }); // a 43-minute sitting
    session(o.id, { at: T0 + 45 * MINUTE, events: 2 });    // resumed 2 minutes after it ended
    expect(rebuildRollup(o.id).qualified_visits).toBe(1);
  });
});

describe('cumulative counters', () => {
  it('takes the session maximum rather than summing every event', () => {
    const o = makeOutreach();
    // 10 events each carrying a running total, ending at 120s watched.
    session(o.id, { at: T0, coverage: 60, watched: 120, rewinds: 3, events: 10 });

    const row = rebuildRollup(o.id);
    expect(row.total_watched_seconds).toBe(120); // not 120 x 10
    expect(row.total_rewinds).toBe(3);
    expect(row.best_coverage_pct).toBe(60);
  });

  it('sums the per-session maxima across separate visits', () => {
    const o = makeOutreach();
    session(o.id, { at: T0, coverage: 40, watched: 100, rewinds: 1 });
    session(o.id, { at: T0 + 4 * DAY, coverage: 75, watched: 150, rewinds: 2 });

    const row = rebuildRollup(o.id);
    expect(row.total_watched_seconds).toBe(250);
    expect(row.total_rewinds).toBe(3);
    expect(row.best_coverage_pct).toBe(75); // best, not last
  });
});

describe('score and tier — brief §10', () => {
  it('scores a first visit with nothing else as cold', () => {
    expect(engagementScore({ qualifiedVisits: 1, bestCoveragePct: 0, totalRewinds: 0, chapterJumps: 0, totalWatchedSeconds: 0 })).toBe(0);
  });

  it('gives no return-visit credit for a single visit', () => {
    const once = engagementScore({ qualifiedVisits: 1, bestCoveragePct: 100, totalRewinds: 0, chapterJumps: 0, totalWatchedSeconds: 0 });
    expect(once).toBe(25); // coverage only
  });

  it('weights return visits most heavily', () => {
    const returned = engagementScore({ qualifiedVisits: 3, bestCoveragePct: 0, totalRewinds: 0, chapterJumps: 0, totalWatchedSeconds: 0 });
    expect(returned).toBe(40);
  });

  it('caps at 100 for maximal engagement', () => {
    expect(engagementScore({ qualifiedVisits: 9, bestCoveragePct: 100, totalRewinds: 9, chapterJumps: 9, totalWatchedSeconds: 900 })).toBe(100);
  });

  it.each([
    [0, 'cold'], [19, 'cold'], [20, 'warm'], [49, 'warm'],
    [50, 'hot'], [79, 'hot'], [80, 'priority'], [100, 'priority'],
  ])('maps score %i to %s', (score, tier) => {
    expect(tierFor(score)).toBe(tier);
  });

  it('lets a staff-set reply override the score', () => {
    expect(tierFor(0, '2026-08-20T00:00:00.000Z')).toBe('responded');
    expect(tierFor(95, '2026-08-20T00:00:00.000Z')).toBe('responded');
  });

  it('keeps responded set across a rebuild, and restores the score when cleared', () => {
    const o = makeOutreach();
    session(o.id, { at: T0, coverage: 80, watched: 200, rewinds: 3 });

    markResponded(o.id);
    expect(rebuildRollup(o.id).tier).toBe('responded');

    const cleared = clearResponded(o.id);
    expect(cleared.tier).not.toBe('responded');
    expect(cleared.responded_at).toBeNull();
  });
});

describe('acceptance: 500 events across 40 sessions', () => {
  it('counts qualified visits as distinct sessions, with sub-30-minute ones collapsed', () => {
    const o = makeOutreach();

    // 40 sessions. 30 qualify. They are laid out as 10 clusters four days
    // apart, each cluster holding 3 sessions a few minutes apart — so the
    // correct answer is 10 visits, not 30 sessions and not 40 page loads.
    let written = 0;
    for (let cluster = 0; cluster < 10; cluster++) {
      for (let n = 0; n < 3; n++) {
        session(o.id, {
          at: T0 + cluster * 4 * DAY + n * 5 * MINUTE,
          coverage: 30 + cluster,
          watched: 60,
          events: 12,
        });
        written++;
      }
    }
    // 10 further sessions that never qualified — scanners and abandoned loads.
    for (let i = 0; i < 10; i++) {
      session(o.id, { at: T0 + 200 * DAY + i * DAY, qualified: false, events: 3 });
      written++;
    }

    const totalEvents = db.prepare('SELECT COUNT(*) c FROM tracking_events WHERE outreach_id = ?').get(o.id).c;
    const distinctSessions = db.prepare('SELECT COUNT(DISTINCT session_id) c FROM tracking_events WHERE outreach_id = ?').get(o.id).c;
    expect(written).toBe(40);
    expect(distinctSessions).toBe(40);
    expect(totalEvents).toBe(500);

    const row = rebuildRollup(o.id);
    expect(row.qualified_visits).toBe(10);
    expect(row.best_coverage_pct).toBe(39);
    expect(row.first_qualified_at).toBeTruthy();
    expect(row.last_qualified_at).toBeTruthy();
    expect(Date.parse(row.last_qualified_at)).toBeGreaterThan(Date.parse(row.first_qualified_at));
  });
});

describe('rebuild is idempotent', () => {
  it('produces the same figures when run twice', () => {
    const o = makeOutreach();
    session(o.id, { at: T0, coverage: 50, watched: 120, rewinds: 2, chapterJumps: 2 });
    session(o.id, { at: T0 + 4 * DAY, coverage: 70, watched: 200, rewinds: 1 });

    const first = rebuildRollup(o.id);
    const second = rebuildRollup(o.id);
    expect({ ...first, updated_at: null }).toEqual({ ...second, updated_at: null });
  });

  it('never writes to tracking_events', () => {
    const o = makeOutreach();
    session(o.id, { at: T0, coverage: 50, watched: 120 });
    const before = db.prepare('SELECT COUNT(*) c FROM tracking_events').get().c;
    rebuildRollup(o.id);
    expect(db.prepare('SELECT COUNT(*) c FROM tracking_events').get().c).toBe(before);
  });
});
