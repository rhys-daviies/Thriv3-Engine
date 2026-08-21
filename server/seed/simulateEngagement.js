/**
 * Simulated coach engagement, for reviewing Tab 3 before real outreach exists.
 *
 *   npm run simulate -- --athlete "Rhys Davies"
 *   npm run simulate -- --clean
 *
 * DEVELOPMENT ONLY. Everything it writes is marked so it can be removed
 * exactly: events carry the token 'demo', and the coaches it invents use
 * addresses at a .invalid domain, which by RFC 2606 can never resolve. A demo
 * coach therefore cannot be emailed by accident even if one is left in place.
 *
 * The spread below is meant to be plausible rather than flattering — roughly
 * two thirds of a send producing a qualified visit, a handful of scanner-only
 * fetches that must never count, and one coach who genuinely engages.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { findOrCreateCoach } from '../lib/coaches.js';
import { createOutreach, markOutreachSent } from '../lib/outreach.js';
import { rebuildAllRollups, markResponded } from '../lib/engagementRollup.js';
import { Player } from '../db/entities/player.js';

const DEMO_TOKEN = 'demo';
const DEMO_DOMAIN = 'demo.thriv3.invalid';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const REEL = 168; // 2:48, a typical highlight reel

/**
 * One entry per coach contacted. `visits` are days since the send; `stopAt` is
 * the share of the reel reached in the deepest session.
 */
const COACHES = [
  { name: 'A. Whitfield',  school: 'Clemson',              division: 'NCAA Division I',  title: 'Head Coach',            visits: [0.2, 3, 9], stopAt: 0.96, rewinds: 5, responded: true },
  { name: 'M. Okonjo',     school: 'Duke',                 division: 'NCAA Division I',  title: 'Head Coach',            visits: [1, 6],      stopAt: 0.88, rewinds: 3 },
  { name: 'T. Lindqvist',  school: 'Stanford',             division: 'NCAA Division I',  title: 'Recruiting Coordinator', visits: [0.5, 8],   stopAt: 0.71, rewinds: 2 },
  { name: 'R. Delgado',    school: 'Indiana',              division: 'NCAA Division I',  title: 'Head Coach',            visits: [2],         stopAt: 0.64, rewinds: 1 },
  { name: 'S. Ferreira',   school: 'Virginia',             division: 'NCAA Division I',  title: 'Assistant Coach',       visits: [4],         stopAt: 0.55, rewinds: 1 },
  { name: 'K. Boateng',    school: 'Wake Forest',          division: 'NCAA Division I',  title: 'Head Coach',            visits: [3],         stopAt: 0.42 },
  { name: 'J. Marsden',    school: 'Georgetown',           division: 'NCAA Division I',  title: 'Head Coach',            visits: [5],         stopAt: 0.28 },
  { name: 'P. Nakamura',   school: 'Washington',           division: 'NCAA Division I',  title: 'Assistant Coach',       visits: [6],         stopAt: 0.19 },
  { name: 'L. Haddad',     school: 'Maryland',             division: 'NCAA Division I',  title: 'Head Coach',            visits: [7],         stopAt: 0.11 },
  { name: 'D. Novak',      school: 'Ohio State',           division: 'NCAA Division I',  title: 'Head Coach',            scannerOnly: true },
  { name: 'C. Abara',      school: 'Syracuse',             division: 'NCAA Division I',  title: 'Recruiting Coordinator', scannerOnly: true },
  { name: 'F. Rossi',      school: 'Notre Dame',           division: 'NCAA Division I',  title: 'Head Coach',            scannerOnly: true },
  { name: 'B. Kowalski',   school: 'North Carolina',       division: 'NCAA Division I',  title: 'Assistant Coach',       silent: true },
  { name: 'H. Tavares',    school: 'Penn',                 division: 'NCAA Division I',  title: 'Head Coach',            silent: true },
];

const insert = db.prepare(`
  INSERT INTO tracking_events
    (token, outreach_id, session_id, event_type, coverage_pct, watched_seconds,
     duration_seconds, dwell_seconds, rewinds, skips, payload, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function writeSession(outreachId, startMs, { stopAt, rewinds = 0, chapters = [], scannerOnly = false }) {
  const sessionId = randomUUID();
  let t = startMs;
  const write = (type, cov, watched, rew, payload = {}) =>
    insert.run(DEMO_TOKEN, outreachId, sessionId, type, cov, watched, REEL,
      Math.round((t - startMs) / 1000), rew, 0, JSON.stringify(payload), new Date(t).toISOString());

  write('visit_start', 0, 0, 0);

  // A scanner fetches the page and does nothing else. It must never qualify.
  if (scannerOnly) return;

  t += 6000;
  write('visit_qualified', 0, 0, 0, { reason: 'video_play' });
  t += 1000;
  write('play_start', 0, 0, 0);

  for (const chapter of chapters) {
    t += 4000;
    write('chapter_jump', 0, 0, 0, { toSeconds: chapter.t, label: chapter.label });
  }

  const watchedTo = Math.round(REEL * stopAt);
  const coverage = Math.round((watchedTo / REEL) * 100);

  for (const milestone of [10, 25, 50, 75, 95]) {
    if (coverage < milestone) continue;
    t += Math.round(REEL * (milestone / 100)) * 250;
    const partial = Math.round(REEL * (milestone / 100));
    write(`coverage_${milestone}`, milestone, partial, rewinds, { coverageRanges: [[0, partial]] });
  }

  t += 4000;
  write('session_end', coverage, watchedTo, rewinds, {
    reason: 'unload', qualified: true, played: true, coverageRanges: [[0, watchedTo]],
  });
}

export function simulate(athleteName) {
  const athlete = Player.filter({ full_name: athleteName })[0] || Player.get(athleteName);
  if (!athlete) throw new Error(`No athlete matching "${athleteName}"`);

  const chapters = athlete.video_chapters || [];
  const sentAt = Date.now() - 11 * DAY;
  let sessions = 0;

  db.transaction(() => {
    for (const spec of COACHES) {
      const coach = findOrCreateCoach({
        full_name: spec.name,
        email: `${spec.name.toLowerCase().replace(/[^a-z]/g, '')}@${DEMO_DOMAIN}`,
        school: spec.school,
        division: spec.division,
        sport: athlete.sport,
        position_title: spec.title,
      });
      const outreach = createOutreach({ athleteId: athlete.id, coachId: coach.id, matchId: spec.school });
      markOutreachSent(outreach.id, new Date(sentAt).toISOString());

      if (spec.silent) continue; // never opened the email at all

      if (spec.scannerOnly) {
        writeSession(outreach.id, sentAt + 2 * MINUTE, { scannerOnly: true });
        sessions++;
        continue;
      }

      // A coach's later visits go deeper than their first.
      spec.visits.forEach((dayOffset, i) => {
        const depth = spec.visits.length > 1 && i === 0 ? spec.stopAt * 0.45 : spec.stopAt;
        writeSession(outreach.id, sentAt + dayOffset * DAY, {
          stopAt: depth,
          rewinds: i === spec.visits.length - 1 ? (spec.rewinds || 0) : 0,
          chapters: chapters.length ? chapters.slice(0, i === 0 ? 1 : 3) : [],
        });
        sessions++;
      });
    }
  })();

  rebuildAllRollups();
  for (const spec of COACHES.filter((c) => c.responded)) {
    const row = db.prepare(`
      SELECT o.id FROM outreach o JOIN coaches c ON c.id = o.coach_id
      WHERE o.athlete_id = ? AND c.full_name = ?
    `).get(athlete.id, spec.name);
    if (row) markResponded(row.id);
  }

  return { athlete: athlete.full_name, coaches: COACHES.length, sessions, chapters: chapters.length };
}

export function cleanSimulation() {
  return db.transaction(() => {
    const events = db.prepare('DELETE FROM tracking_events WHERE token = ?').run(DEMO_TOKEN);
    const coachIds = db.prepare('SELECT id FROM coaches WHERE email LIKE ?').all(`%@${DEMO_DOMAIN}`).map((r) => r.id);
    let outreach = 0;
    if (coachIds.length) {
      const ph = coachIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM engagement_rollup WHERE outreach_id IN (SELECT id FROM outreach WHERE coach_id IN (${ph}))`).run(...coachIds);
      outreach = db.prepare(`DELETE FROM outreach WHERE coach_id IN (${ph})`).run(...coachIds).changes;
      db.prepare(`DELETE FROM coaches WHERE id IN (${ph})`).run(...coachIds);
    }
    rebuildAllRollups();
    return { events: events.changes, outreach, coaches: coachIds.length };
  })();
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('simulateEngagement.js');
if (invokedDirectly) {
  if (process.argv.includes('--clean')) {
    console.log('[simulate] removed', cleanSimulation());
  } else {
    const idx = process.argv.indexOf('--athlete');
    const name = idx !== -1 ? process.argv[idx + 1] : 'Rhys Davies';
    console.log('[simulate] created', simulate(name));
  }
}
