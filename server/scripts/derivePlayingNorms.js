/**
 * Derive how widely each programme shares the minutes at each position.
 *
 * THE ATHLETE-SIDE QUESTION, and deliberately not A7.3's. Coach Recruitability
 * asks whether a place is opening. This asks: if I joined this position group,
 * how likely am I to be one of the players who actually plays? It is a
 * statement about how a coach USES a squad, not about whether they happen to
 * have a vacancy, and the two measure r = 0.061 against each other.
 *
 *   playingShare = effectivePlayers / positionGroupSize
 *   effectivePlayers = 1 / sum((player minutes / position minutes)^2)
 *
 * The inverse Herfindahl: the number of players the minutes behave as though
 * they were split evenly between. Divided by the group so that it answers
 * "what share of the players here get a real share of the time" rather than
 * "how big is this squad".
 *
 * WHY THIS QUANTITY AND NOT THE OBVIOUS ONE. Newcomer minutes share was the
 * first candidate and it fails a split-half test: a programme's newcomer share
 * in even seasons predicts its odd seasons at r = 0.05 pooled, and at 0.002
 * for goalkeepers. It is not a programme trait, it is who happened to leave.
 * Playing share survives the same test at r = 0.43-0.61 within position.
 *
 * GROUP SIZE IS IN THIS ON PURPOSE. It correlates at about -0.6, and unlike
 * A7.3 - where group size confounded a recruiting-need signal and was excluded
 * - here the number of players at your position IS the competition, which is
 * the question being asked.
 *
 *   node server/scripts/derivePlayingNorms.js --write
 *   node server/scripts/derivePlayingNorms.js --check
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../../shared/matching/v2/calibration/playingNorms.data.json');

const SEASONS = ['2022', '2023', '2024', '2025'];
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const SPORTS = ['mens-soccer', 'womens-soccer'];

const MIN_SQUAD = 14;
const MIN_MINUTES_COVERAGE = 0.5;
/** Programme-seasons a programme-position needs before its own share is used. */
const MIN_PROGRAMME_SEASONS = 2;
/** Programme-seasons a division-position needs before it is used over the sport. */
const MIN_DIVISION_SEASONS = 30;

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function playingShare(minutes) {
  const total = minutes.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const herfindahl = minutes.reduce((a, b) => a + ((b / total) ** 2), 0);
  if (!herfindahl) return null;
  return (1 / herfindahl) / minutes.length;
}

function load(db) {
  const rows = db.prepare(`
    SELECT college_name, sport, division, season, position, minutes_played
      FROM roster_players
     WHERE season IN (${SEASONS.map(() => '?').join(',')}) AND position IS NOT NULL
  `).all(...SEASONS);
  const cells = new Map();
  const divisionOf = new Map();
  for (const r of rows) {
    const position = String(r.position).toUpperCase();
    if (!POSITIONS.includes(position)) continue;
    const key = `${r.sport}|${r.college_name}|${r.season}`;
    if (!cells.has(key)) cells.set(key, {});
    (cells.get(key)[position] ||= []).push(r.minutes_played ?? 0);
    divisionOf.set(`${r.sport}|${r.college_name}`, r.division);
  }
  return { cells, divisionOf };
}

const readable = (cell) => {
  const all = POSITIONS.flatMap((p) => cell[p] || []);
  return all.length >= MIN_SQUAD && all.filter((m) => m > 0).length >= all.length * MIN_MINUTES_COVERAGE;
};

function build(db) {
  const { cells, divisionOf } = load(db);
  const programme = new Map();
  const division = new Map();
  const sport = new Map();
  const push = (map, key, value) => { (map.get(key) ?? map.set(key, []).get(key)).push(value); };

  for (const [key, cell] of cells) {
    if (!readable(cell)) continue;
    const [sp, prog] = key.split('|');
    const div = divisionOf.get(`${sp}|${prog}`);
    for (const position of POSITIONS) {
      const minutes = cell[position];
      if (!minutes?.length) continue;
      const share = playingShare(minutes);
      if (share === null) continue;
      push(programme, `${sp}|${prog}|${position}`, share);
      push(division, `${sp}|${div}|${position}`, share);
      push(sport, `${sp}|${position}`, share);
    }
  }

  const summarise = (map, minimum) => Object.fromEntries([...map.entries()]
    .filter(([, v]) => v.length >= minimum)
    .map(([k, v]) => [k, { share: Number(mean(v).toFixed(4)), seasons: v.length }]));

  /**
   * The bounds each share is read against. A raw share of 0.57 means nothing
   * on its own; what an athlete needs is where it sits among programmes at the
   * same position, so the scale is pinned with the table.
   */
  const scale = Object.fromEntries([...sport.entries()].map(([k, v]) => [k, {
    p10: Number(q(v, 10).toFixed(4)),
    median: Number(q(v, 50).toFixed(4)),
    p90: Number(q(v, 90).toFixed(4)),
    programmeSeasons: v.length,
  }]));

  const payload = {
    playingNormsId: 'playing-norms-2026-09-20',
    createdAt: '2026-09-20',
    seasons: SEASONS,
    measure: 'effectivePlayers / positionGroupSize, effectivePlayers = 1 / sum(minuteShare^2)',
    minProgrammeSeasons: MIN_PROGRAMME_SEASONS,
    minDivisionSeasons: MIN_DIVISION_SEASONS,
    note: 'Generated by server/scripts/derivePlayingNorms.js. Do not hand-edit.',
    scale,
    programme: summarise(programme, MIN_PROGRAMME_SEASONS),
    division: summarise(division, MIN_DIVISION_SEASONS),
    sport: summarise(sport, 1),
  };
  payload.digest = crypto.createHash('sha256')
    .update(JSON.stringify({ s: payload.scale, p: payload.programme, d: payload.division, sp: payload.sport }))
    .digest('hex').slice(0, 16);
  return payload;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (write === check) {
    console.error('Usage: derivePlayingNorms.js --write | --check');
    process.exit(2);
  }
  const { default: db } = await import('../db/client.js');
  const built = build(db);

  for (const sp of SPORTS) {
    for (const p of POSITIONS) {
      if (!built.sport[`${sp}|${p}`]) {
        console.error(`Refusing to derive: no readable seasons for ${sp} ${p}. A scale built from a partial pool would redefine every programme.`);
        process.exit(3);
      }
    }
  }

  if (write) {
    fs.writeFileSync(OUT, `${JSON.stringify(built, null, 2)}\n`);
    console.log(`Wrote ${path.relative(process.cwd(), OUT)}  digest ${built.digest}`);
    for (const sp of SPORTS) {
      console.log(`  ${sp}`);
      for (const p of POSITIONS) {
        const s = built.scale[`${sp}|${p}`];
        console.log(`    ${p.padEnd(11)} p10 ${s.p10}  median ${s.median}  p90 ${s.p90}   (${s.programmeSeasons} programme-seasons)`);
      }
    }
    console.log(`  programme-level entries: ${Object.keys(built.programme).length}`);
    console.log(`  division-level entries:  ${Object.keys(built.division).length}`);
    return;
  }

  const pinned = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (pinned.digest === built.digest) {
    console.log(`playing norms unchanged (digest ${built.digest})`);
    return;
  }
  console.log('PLAYING NORMS MOVED');
  for (const sp of SPORTS) {
    for (const p of POSITIONS) {
      const a = pinned.scale[`${sp}|${p}`]?.median;
      const b = built.scale[`${sp}|${p}`]?.median;
      if (a !== b) console.log(`  ${sp} ${p}: median ${a} -> ${b}`);
    }
  }
  console.log('');
  console.log('Nothing has been rewritten. What counts as a wide share of the minutes is a measurement to review.');
  process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
