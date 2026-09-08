/**
 * The Programme Intelligence analytical baseline, as a file that can be diffed.
 *
 * WHY THIS EXISTS. Every number in the report is computed from the roster
 * tables at request time, through eleven analytical modules and a benchmark
 * pool built across every programme in the sport. The unit tests hold each
 * module to its contract on fixtures; nothing held the WHOLE STACK to its
 * answers on real data. So a change to a pool percentile, a readability gate
 * or a median could move a figure on a client page and every test would still
 * pass.
 *
 * This captures the answers. Four programmes, chosen because between them they
 * exercise every branch that matters: a deep D1 record (Akron men), a second
 * D1 shape with a very different squad profile (Missouri State), a programme
 * whose minutes were never published (Albertus Magnus), and the women's game
 * with its own pool (Akron women). Run it with `--check` and it fails on any
 * difference, naming the field.
 *
 * STRICTLY READ-ONLY, and deliberately so. It never inserts an athlete: the
 * programme model already carries `pressure.positions` and
 * `positionUtilisation.byPosition` for every position, so the athlete-position
 * answers are read from there rather than by writing a fixture to the players
 * table and hoping the delete runs.
 *
 * WHAT IS NOT IN IT. Anything that moves on its own: no timestamp, no file
 * path, no page number. Page numbers are a property of a rendered document,
 * not of the analysis, and the report QA sweep is what holds those.
 *
 *   npm run snapshot:pi           # write the baseline
 *   npm run snapshot:pi -- --check  # compare against it, non-zero on drift
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { programReportModel } from '../routes/philosophy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(__dirname, '__baselines__', 'programme-intelligence-2026-08-31.json');

const PROGRAMMES = [
  ['Akron', 'mens-soccer'],
  ['Missouri State', 'mens-soccer'],
  ['Albertus Magnus', 'mens-soccer'],
  ['Akron', 'womens-soccer'],
];

/** The four athlete-position readings the baseline names explicitly. */
const ATHLETE_POSITIONS = [
  ['Akron', 'mens-soccer', 'FORWARD'],
  ['Akron', 'mens-soccer', 'MIDFIELD'],
  ['Missouri State', 'mens-soccer', 'DEFENSE'],
  ['Akron', 'womens-soccer', 'DEFENSE'],
];

const r3 = (v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(4)) : v ?? null);
const pick = (o, keys) => (o ? Object.fromEntries(keys.map((k) => [k, r3(o[k])])) : null);

/** A benchmark, reduced to the four figures a page can print. */
const band = (b) => (b ? {
  programmes: b.programmes ?? null,
  median: r3(b.median),
  p25: r3(b.p25),
  p75: r3(b.p75),
} : null);

function positionIntake(p) {
  const h = p.historical ?? {};
  return {
    position: p.position,
    suppressed: Boolean(h.suppressed),
    perCycle: h.totalIncomingPerCycle ?? null,
    median: r3(h.medianTotalIncoming),
    cyclesRead: h.cyclesWithReadableRosterPresence ?? null,
    cyclesWithExperienced: h.cyclesWithAnExperiencedArrival ?? null,
    poolMiddleHalf: h.pool ? [r3(h.pool.middleHalf.low), r3(h.pool.middleHalf.high)] : null,
    current: pick(p.current, ['season', 'readable', 'totalIncoming', 'firstYears',
      'experiencedArrivals']),
  };
}

function positionMinutes(u) {
  return {
    position: u.position,
    supported: u.supported,
    available: u.available,
    reason: u.reason ?? null,
    seasons: u.seasons?.length ?? null,
    readableSeasons: u.readableSeasons ?? null,
    with600: r3(u.medianPlayersWith600Plus),
    for75: r3(u.medianPlayersFor75),
    used: r3(u.medianPlayersWithMinutes),
    range600: u.rangePlayersWith600Plus
      ? [r3(u.rangePlayersWith600Plus.low), r3(u.rangePlayersWith600Plus.high)] : null,
    pool600: band(u.pool?.playersWith600Plus),
    poolFor75: band(u.pool?.playersFor75),
  };
}

function snapshotProgramme(name, sport) {
  const col = db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?').get(name, sport);
  if (!col) throw new Error(`no programme ${name} / ${sport}`);
  const m = programReportModel({ collegeId: col.id, playerId: null });
  const s = m.summary.programme;
  const l = m.lifecycle ?? {};
  const u = m.squadProfile?.utilisation ?? {};
  const e = m.squadProfile?.experience ?? {};

  return {
    college: { name: m.college.name, division: m.college.division, sport },
    seasonsOnFile: m.describes,
    recruitSeason: m.recruitSeason,
    squadSeason: m.squadSeason ?? null,
    verdict: m.verdict?.verdict ?? null,

    freshman: {
      ...pick(s.freshmanOpportunity, ['classification', 'measuredFreshmen', 'rowsWithoutMinutes']),
      unreadableSeasons: s.freshmanOpportunity.unreadableSeasons ?? null,
      ladderTopMedian: r3(s.freshmanOpportunity.ladderTop?.median),
      ladder: (m.ladder ?? []).map((x) => ({ rank: x.rank, median: r3(x.median) })),
    },
    arrivals: pick(s.experiencedArrivalReliance,
      ['measurable', 'density', 'arrivals', 'shareOfMeasuredLoad', 'classification']),
    replacement: pick(s.replacementBehaviour, ['observations', 'totalObservations', 'route']),

    development: l.development ? {
      players: l.development.players,
      minutesReadable: l.development.minutesCoverage.readable,
      measured: l.development.minutesCoverage.measured,
      playerSeasons: l.development.minutesCoverage.playerSeasons,
      everStarter: pick(l.development.everStarter, ['reached', 'denominator', 'share', 'band']),
      byYear: (l.development.byYear ?? []).map((y) => r3(y.share)),
    } : null,
    continuity: pick(l.continuity, ['returnable', 'returned', 'retention', 'band']),
    departures: l.departures ? {
      gateAllowed: l.departures.gate.allowed,
      gateReason: l.departures.gate.reason ?? null,
      total: l.departures.departures.total,
      observed: l.departures.tracing.observed,
      coverage: r3(l.departures.tracing.coverage),
    } : null,

    utilisation: {
      ...pick(u, ['available', 'reason', 'seasonsObserved', 'medianTop11Share', 'medianTop14Share',
        'medianTop18Share', 'medianPlayersWith600Plus', 'medianRosterPlayers', 'poolScope']),
      poolTop11: band(u.pool?.top11MinuteShare),
    },
    experience: {
      compositionAvailable: e.compositionAvailable ?? null,
      loadAvailable: e.loadAvailable ?? null,
      loadReason: e.loadReason ?? null,
      groups: (e.groups ?? []).map((g) => ({
        group: g.group, rosterShare: r3(g.rosterShare), minuteShare: r3(g.minuteShare),
      })),
      yearFourPlus: pick(e.yearFourPlus, ['rosterShare', 'minuteShare', 'playersWith600Plus']),
    },

    positionIntake: (m.pressure?.positions ?? []).map(positionIntake),
    positionMinutes: (m.positionUtilisation?.byPosition ?? []).map(positionMinutes),

    // The document's shape, without its page numbers.
    sections: (m.sections ?? []).map((x) => `${x.id}:${x.layer}:${x.act}`),
    evidenceLimits: (m.evidenceLimits ?? []).map((x) => x.id),
  };
}

function build() {
  const out = { programmes: {}, athletePositions: {} };
  for (const [name, sport] of PROGRAMMES) {
    out.programmes[`${name} (${sport})`] = snapshotProgramme(name, sport);
  }
  for (const [name, sport, position] of ATHLETE_POSITIONS) {
    const p = out.programmes[`${name} (${sport})`];
    out.athletePositions[`${name} (${sport}) ${position}`] = {
      intake: p.positionIntake.find((x) => x.position === position) ?? null,
      minutes: p.positionMinutes.find((x) => x.position === position) ?? null,
    };
  }
  return out;
}

/** Every leaf that differs, by path. */
function diff(a, b, at = '', out = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const isObj = (x) => x && typeof x === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ at, baseline: a ?? null, now: b ?? null });
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    diff(a[k], b[k], at ? `${at}.${k}` : k, out);
  }
  return out;
}

const check = process.argv.includes('--check');
const now = build();

if (!check) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${JSON.stringify(now, null, 1)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), BASELINE)}`);
  console.log(`  ${Object.keys(now.programmes).length} programmes, `
    + `${Object.keys(now.athletePositions).length} athlete positions`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(`no baseline at ${BASELINE}; run without --check to write one`);
  process.exit(2);
}
const differences = diff(JSON.parse(fs.readFileSync(BASELINE, 'utf-8')), now);
if (!differences.length) {
  console.log(`analytical baseline matches: ${Object.keys(now.programmes).length} programmes, `
    + `${Object.keys(now.athletePositions).length} athlete positions, 0 differences`);
  process.exit(0);
}
console.error(`analytical baseline DRIFTED: ${differences.length} field(s)`);
/**
 * 400 rather than 40 since Phase 13C. A structural change to the section
 * registry drifts one line per section per programme — 60 lines for one
 * inserted page — and truncating at 40 hid whether the tail was section
 * ordering or an analytical value, which is the only question this check
 * exists to answer.
 */
for (const d of differences.slice(0, 400)) {
  console.error(`  ${d.at}: ${JSON.stringify(d.baseline)} -> ${JSON.stringify(d.now)}`);
}
if (differences.length > 400) console.error(`  … and ${differences.length - 400} more`);
process.exit(1);
