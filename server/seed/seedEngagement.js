/**
 * Local test fixtures for the engagement subsystem: 3 athletes x 8 coaches
 * = 24 outreach rows with unique tokens.
 *
 *   npm run seed:engagement          create (idempotent)
 *   npm run seed:engagement -- --clean   remove everything it created
 *
 * Seeded athletes carry created_by_id = 'seed:engagement' so cleanup is exact
 * and never touches real players. Coach names are fictional; school names are
 * real because the matching data uses them.
 */
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { extractVideoId } from '../lib/youtube.js';
import { generateSlug, generateUnique } from '../lib/tokens.js';
import { findOrCreateCoach } from '../lib/coaches.js';
import { createOutreach } from '../lib/outreach.js';

export const SEED_MARKER = 'seed:engagement';

const ATHLETES = [
  {
    full_name: 'Nikau Brennan',
    position: 'Left Winger',
    secondary_position: 'Attacking Midfielder',
    graduation_year: 2027,
    sport: 'mens-soccer',
    email: 'nikau.brennan@example.com',
    phone: '+64 21 555 0184',
    gpa: 3.76,
    sat_score: 1310,
    height_cm: 178,
    weight_kg: 71,
    nationality: 'New Zealand',
    commitment_status: 'Uncommitted',
    club_name: 'Auckland City FC Academy',
    ncaa_eligibility_id: '2110042886',
    intended_major: 'Sport Science',
    guardian_name: 'S. Brennan',
    guardian_email: 'guardian.brennan@example.com',
    club_coach_name: 'R. Tuilagi',
    club_coach_email: 'coach.tuilagi@example.org',
    time_zone: 'NZST · UTC+12',
    best_contact_window: '16:00-20:00 ET',
    highlights_url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    evaluation:
      'Direct, left-sided attacker most dangerous receiving to feet in the wide channel with '
      + 'space to attack the fullback. Scanning before receiving is the most encouraging habit '
      + 'on the reel. Final-third decision-making is streaky and pressing triggers are '
      + 'inconsistent; physically he is not finished growing into his frame.',
    video_chapters: [
      { t: 18, label: '1v1 isolation, inside cut and strike' },
      { t: 66, label: 'Receiving on the half-turn under pressure' },
      { t: 122, label: 'Counter-press and recovery run' },
      { t: 167, label: 'Cutback from the byline — assist' },
      { t: 202, label: 'Inswinging corner delivery' },
      { t: 215, label: 'Weak-foot finish, far post' },
    ],
    sport_attributes: {
      preferred_foot: 'Right',
      sprint_30m: 4.02,
      top_speed: 33.4,
      yo_yo_ir1: 19.6,
      appearances: 24,
      goals: 11,
      assists: 14,
      minutes: 1880,
      dribbles_per_90: 4.8,
      chances_per_90: 2.3,
    },
  },
  {
    full_name: 'Marco Ferreira',
    position: 'Centre Back',
    graduation_year: 2026,
    sport: 'mens-soccer',
    email: 'marco.ferreira@example.com',
    gpa: 3.41,
    height_cm: 188,
    weight_kg: 82,
    nationality: 'Portugal',
    commitment_status: 'Uncommitted',
    club_name: 'Estoril Praia Sub-19',
    intended_major: 'Business',
    time_zone: 'WEST · UTC+1',
    highlights_url: 'https://youtu.be/aqz-KE-bpKQ?t=12',
    evaluation:
      'Front-foot defender who steps into midfield to intercept rather than waiting to react. '
      + 'Aerially dominant on both boxes. Distribution under a high press is the clearest '
      + 'development area — tends to go long when a line-breaking pass is available.',
    video_chapters: [
      { t: 24, label: 'Stepping in to intercept' },
      { t: 88, label: 'Defensive header, set piece' },
      { t: 141, label: 'Line-breaking pass out of the back' },
      { t: 198, label: 'Recovery pace, one-on-one' },
    ],
    sport_attributes: {
      preferred_foot: 'Left',
      sprint_30m: 4.18,
      appearances: 28,
      goals: 3,
      assists: 1,
      minutes: 2410,
    },
  },
  {
    // Deliberately sparse: exercises the "omit the row, never render N/A" rule
    // and the export refusal for an athlete with fewer than three chapters.
    full_name: 'Dai Okonkwo',
    position: 'Goalkeeper',
    graduation_year: 2027,
    sport: 'mens-soccer',
    email: 'dai.okonkwo@example.com',
    height_cm: 191,
    commitment_status: 'Uncommitted',
    highlights_url: 'https://www.youtube.com/embed/aqz-KE-bpKQ',
    video_chapters: [
      { t: 15, label: 'Reflex save, close range' },
      { t: 97, label: 'Claiming the cross' },
      { t: 160, label: 'Distribution to start the counter' },
    ],
    sport_attributes: { preferred_foot: 'Right', appearances: 22 },
  },
];

const COACHES = [
  { full_name: 'A. Whitfield', email: 'awhitfield@example.edu', school: 'Butler University', division: 'NCAA Division I', position_title: 'Head Coach' },
  { full_name: 'J. Marsden', email: 'jmarsden@example.edu', school: 'Butler University', division: 'NCAA Division I', position_title: 'Assistant Coach' },
  { full_name: 'P. Okafor', email: 'pokafor@example.edu', school: 'Creighton University', division: 'NCAA Division I', position_title: 'Head Coach' },
  { full_name: 'L. Vasquez', email: 'lvasquez@example.edu', school: 'Creighton University', division: 'NCAA Division I', position_title: 'Recruiting Coordinator' },
  { full_name: 'T. Hollis', email: 'thollis@example.edu', school: 'University of Denver', division: 'NCAA Division I', position_title: 'Head Coach' },
  { full_name: 'S. Nakamura', email: 'snakamura@example.edu', school: 'Seattle University', division: 'NCAA Division I', position_title: 'Head Coach' },
  { full_name: 'R. Delacroix', email: 'rdelacroix@example.edu', school: 'Rollins College', division: 'NCAA Division II', position_title: 'Head Coach' },
  { full_name: 'M. Ibrahim', email: 'mibrahim@example.edu', school: 'Amherst College', division: 'NCAA Division III', position_title: 'Head Coach' },
];

const slugTaken = (candidate) => !!db.prepare('SELECT 1 FROM players WHERE public_slug = ?').get(candidate);

function upsertAthlete(spec) {
  const existing = db
    .prepare('SELECT * FROM players WHERE full_name = ? AND created_by_id = ?')
    .get(spec.full_name, SEED_MARKER);
  if (existing) return existing;

  const ts = utcNow();
  const row = {
    ...spec,
    id: randomUUID(),
    created_date: ts,
    updated_date: ts,
    created_by_id: SEED_MARKER,
    status: 'New',
    video_id: extractVideoId(spec.highlights_url),
    video_chapters: JSON.stringify(spec.video_chapters ?? []),
    sport_attributes: JSON.stringify(spec.sport_attributes ?? {}),
    public_slug: generateUnique(generateSlug, slugTaken),
  };

  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO players (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`
  ).run(row);
  return row;
}

export function seedEngagement() {
  return db.transaction(() => {
    const athletes = ATHLETES.map(upsertAthlete);
    const coaches = COACHES.map((c) => findOrCreateCoach({ ...c, sport: 'mens-soccer' }));
    let outreach = 0;
    for (const athlete of athletes) {
      for (const coach of coaches) {
        createOutreach({ athleteId: athlete.id, coachId: coach.id });
        outreach++;
      }
    }
    return { athletes: athletes.length, coaches: coaches.length, outreach };
  })();
}

export function cleanEngagementSeed() {
  return db.transaction(() => {
    const ids = db.prepare('SELECT id FROM players WHERE created_by_id = ?').all(SEED_MARKER).map((r) => r.id);
    if (ids.length === 0) return { athletes: 0, outreach: 0, coaches: 0 };
    const placeholders = ids.map(() => '?').join(',');
    const scope = `SELECT id FROM outreach WHERE athlete_id IN (${placeholders})`;

    db.prepare(`DELETE FROM tracking_events WHERE outreach_id IN (${scope})`).run(...ids);
    db.prepare(`DELETE FROM engagement_rollup WHERE outreach_id IN (${scope})`).run(...ids);
    const outreach = db.prepare(`DELETE FROM outreach WHERE athlete_id IN (${placeholders})`).run(...ids);
    const coaches = db.prepare(
      `DELETE FROM coaches WHERE email IN (${COACHES.map(() => '?').join(',')})
       AND id NOT IN (SELECT coach_id FROM outreach)`
    ).run(...COACHES.map((c) => c.email));
    const athletes = db.prepare(`DELETE FROM players WHERE id IN (${placeholders})`).run(...ids);
    return { athletes: athletes.changes, outreach: outreach.changes, coaches: coaches.changes };
  })();
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('seedEngagement.js');
if (invokedDirectly) {
  if (process.argv.includes('--clean')) {
    console.log('[seed:engagement] removed', cleanEngagementSeed());
  } else {
    console.log('[seed:engagement] created', seedEngagement());
  }
}
