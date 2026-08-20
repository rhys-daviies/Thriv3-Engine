/**
 * Synthetic watch activity for the seeded fixtures, so Tab 3 can be exercised
 * with more than one coach and with return visits days apart.
 *
 *   npm run seed:activity              create
 *   npm run seed:activity -- --clean   remove
 *
 * DEVELOPMENT ONLY. Every row it writes carries token 'demo' so it can be
 * removed precisely, and it refuses to touch anything but seeded athletes.
 * Real events written by the collector always carry a real 32-char token.
 */
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { rebuildAllRollups } from '../lib/engagementRollup.js';
import { SEED_MARKER } from './seedEngagement.js';

const DEMO_TOKEN = 'demo';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const REEL_SECONDS = 221;

const insert = db.prepare(`
  INSERT INTO tracking_events
    (token, outreach_id, session_id, event_type, coverage_pct, watched_seconds,
     duration_seconds, dwell_seconds, rewinds, skips, payload, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/** Coaches watch differently; the shapes below are the ones worth designing for. */
const PROFILES = [
  { visits: [0, 4 * DAY, 9 * DAY], stopAt: 0.95, rewinds: 4, chapters: [0, 3, 5] },
  { visits: [1 * DAY, 6 * DAY], stopAt: 0.72, rewinds: 2, chapters: [0, 3] },
  { visits: [2 * DAY], stopAt: 0.58, rewinds: 1, chapters: [3] },
  { visits: [3 * DAY], stopAt: 0.34, rewinds: 0, chapters: [0] },
  { visits: [5 * DAY], stopAt: 0.28, rewinds: 0, chapters: [] },
  { visits: [6 * DAY], stopAt: 0.18, rewinds: 0, chapters: [] },
  { visits: [], stopAt: 0, rewinds: 0, chapters: [] },   // opened nothing
  { visits: [], stopAt: 0, rewinds: 0, chapters: [], scannerOnly: true },
];

function writeSession(outreachId, startMs, profile, chapters) {
  const sessionId = randomUUID();
  let t = startMs;
  const at = () => new Date(t).toISOString();
  const write = (type, cov, watched, rewinds, payload = {}) =>
    insert.run(DEMO_TOKEN, outreachId, sessionId, type, cov, watched, REEL_SECONDS, Math.round((t - startMs) / 1000), rewinds, 0, JSON.stringify(payload), at());

  write('visit_start', 0, 0, 0);

  // A scanner fetches the page and does nothing else. It must never qualify.
  if (profile.scannerOnly) return;

  t += 4000;
  write('visit_qualified', 0, 0, 0, { reason: 'video_play' });

  for (const index of profile.chapters) {
    const chapter = chapters[index];
    if (!chapter) continue;
    t += 3000;
    write('chapter_jump', 0, 0, 0, { toSeconds: chapter.t, label: chapter.label });
  }

  const watchedTo = Math.round(REEL_SECONDS * profile.stopAt);
  const ranges = [[0, watchedTo]];
  const coverage = Math.round((watchedTo / REEL_SECONDS) * 100);

  for (const milestone of [10, 25, 50, 75, 95]) {
    if (coverage < milestone) continue;
    t += 8000;
    const partial = Math.round(REEL_SECONDS * (milestone / 100));
    write('coverage_' + milestone, milestone, partial, profile.rewinds, { coverageRanges: [[0, partial]] });
  }

  t += 5000;
  write('session_end', coverage, watchedTo, profile.rewinds, {
    reason: 'unload', qualified: true, played: true, coverageRanges: ranges,
  });
}

export function seedActivity({ now = Date.now() } = {}) {
  const athletes = db.prepare('SELECT id, video_chapters FROM players WHERE created_by_id = ?').all(SEED_MARKER);
  if (athletes.length === 0) {
    throw new Error('No seeded athletes found — run `npm run seed:engagement` first');
  }

  const base = now - 12 * DAY;
  let sessions = 0;

  db.transaction(() => {
    for (const athlete of athletes) {
      const chapters = JSON.parse(athlete.video_chapters || '[]');
      const outreach = db.prepare('SELECT id FROM outreach WHERE athlete_id = ? ORDER BY created_at').all(athlete.id);
      outreach.forEach((row, i) => {
        const profile = PROFILES[i % PROFILES.length];
        if (profile.scannerOnly) {
          writeSession(row.id, base, profile, chapters);
          sessions++;
          return;
        }
        for (const offset of profile.visits) {
          writeSession(row.id, base + offset, profile, chapters);
          sessions++;
        }
      });
    }
  })();

  const rollups = rebuildAllRollups();
  return { athletes: athletes.length, sessions, rollups: rollups.length };
}

export function cleanActivity() {
  const result = db.prepare('DELETE FROM tracking_events WHERE token = ?').run(DEMO_TOKEN);
  rebuildAllRollups();
  return { removed: result.changes };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('seedEngagementActivity.js');
if (invokedDirectly) {
  if (process.argv.includes('--clean')) console.log('[seed:activity] removed', cleanActivity());
  else console.log('[seed:activity] created', seedActivity());
}
