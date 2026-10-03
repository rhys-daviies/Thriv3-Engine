/**
 * Derive the positional constants Coach Recruitability normalises by.
 *
 * TWO MEASUREMENTS, both pinned to shared/matching/v2/calibration/.
 *
 * 1. typicalStarters - how many players hold a starting place at a position.
 *    The median count reaching STARTER_MINUTES in a programme-season. This is
 *    the denominator that turns "two places open" into "two places out of
 *    how many", and it is the ONLY positional normaliser the layer uses.
 *
 *    THIS IS WHAT UNBLOCKS GOALKEEPERS. `positionUtilisation` excludes them,
 *    and the exclusion is real but it answers a different question: it
 *    describes how widely minutes are SPREAD, and a position where one player
 *    takes almost all of them has no spread to describe. That degeneracy is
 *    exactly what makes the starter COUNT well determined - the interquartile
 *    range for goalkeepers is zero in every sport and division measured.
 *
 * 2. fillPropensity - given a starting place vacated at a position, how often
 *    a newcomer holds a starting place there the following season. Measured,
 *    not assumed, and it differs enormously by position: a vacated goalkeeping
 *    place becomes a newcomer's about half the time, a midfield place about
 *    five times in six.
 *
 * WHAT IS DELIBERATELY NOT DERIVED: a programme-level fill rate. We hold three
 * season transitions, so a programme-position has at most three observations
 * and a median of two. The spread of programme rates around the pooled rate is
 * what three Bernoulli trials produce by chance, and reading it as programme
 * character would be reading noise. The hierarchy is built to accept that
 * level when the seasons exist; today nothing reaches the floor.
 *
 *   node server/scripts/derivePositionalNorms.js --write
 *   node server/scripts/derivePositionalNorms.js --check
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../../shared/matching/v2/calibration/positionalNorms.data.json');

/** Completed seasons only. The current season is in progress and carries no minutes. */
const SEASONS = ['2022', '2023', '2024', '2025'];
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const SPORTS = ['mens-soccer', 'womens-soccer'];

/** The same threshold V1 uses to call a season a starter's season. */
const STARTER_MINUTES = 600;

/** A programme-season is only read when its minutes are actually recorded. */
const MIN_SQUAD = 14;
const MIN_MINUTES_COVERAGE = 0.5;

/**
 * Observations a programme-position needs before its own fill rate may be
 * used instead of its division's. Nothing reaches it today - see the header.
 */
const MIN_PROGRAMME_OBSERVATIONS = 8;
/** Observations a division-position needs before it is used instead of the sport's. */
const MIN_DIVISION_OBSERVATIONS = 30;

const nameKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };

function loadCells(db) {
  const rows = db.prepare(`
    SELECT college_name, sport, division, season, position, player_name, minutes_played
      FROM roster_players
     WHERE season IN (${SEASONS.map(() => '?').join(',')})
       AND position IS NOT NULL AND player_name IS NOT NULL
  `).all(...SEASONS);

  const cells = new Map();
  const divisionOf = new Map();
  for (const r of rows) {
    const position = String(r.position).toUpperCase();
    if (!POSITIONS.includes(position)) continue;
    const key = `${r.sport}|${r.college_name}|${r.season}`;
    if (!cells.has(key)) cells.set(key, {});
    (cells.get(key)[position] ||= []).push({ key: nameKey(r.player_name), minutes: r.minutes_played ?? 0 });
    divisionOf.set(`${r.sport}|${r.college_name}`, r.division);
  }
  return { cells, divisionOf };
}

/** A programme-season whose minutes we can actually read. */
function readable(cell) {
  const all = POSITIONS.flatMap((p) => cell[p] || []);
  if (all.length < MIN_SQUAD) return false;
  return all.filter((x) => x.minutes > 0).length >= all.length * MIN_MINUTES_COVERAGE;
}

function deriveTypicalStarters(cells) {
  const counts = new Map();
  for (const [key, cell] of cells) {
    if (!readable(cell)) continue;
    const sport = key.split('|')[0];
    for (const position of POSITIONS) {
      if (!cell[position]?.length) continue;
      const k = `${sport}|${position}`;
      (counts.get(k) ?? counts.set(k, []).get(k)).push(cell[position].filter((x) => x.minutes >= STARTER_MINUTES).length);
    }
  }
  const out = {};
  for (const [k, values] of counts) {
    const [sport, position] = k.split('|');
    (out[sport] ||= {})[position] = {
      typicalStarters: median(values),
      mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)),
      p25: q(values, 25),
      p75: q(values, 75),
      programmeSeasons: values.length,
      // The share landing exactly on the median. For goalkeepers this is the
      // number that makes the constant defensible rather than conventional.
      shareAtMedian: Number((values.filter((v) => v === median(values)).length / values.length).toFixed(3)),
    };
  }
  return out;
}

function deriveFillPropensity(cells, divisionOf) {
  const tally = { programme: new Map(), division: new Map(), sport: new Map() };
  const add = (map, key, hit) => {
    const v = map.get(key) || { trials: 0, hits: 0 };
    v.trials += 1; v.hits += hit; map.set(key, v);
  };

  for (const [key, cell] of cells) {
    const [sport, programme, season] = key.split('|');
    const next = cells.get(`${sport}|${programme}|${Number(season) + 1}`);
    if (!next || !readable(cell) || !readable(next)) continue;
    const division = divisionOf.get(`${sport}|${programme}`);
    for (const position of POSITIONS) {
      const now = cell[position] || [];
      const then = next[position] || [];
      if (!now.length || !then.length) continue;
      const returning = new Set(then.map((x) => x.key));
      // A vacated STARTING place, not a departing body: a squad player leaving
      // does not open a place anyone was holding.
      const vacated = now.filter((x) => x.minutes >= STARTER_MINUTES && !returning.has(x.key)).length;
      if (vacated === 0) continue;
      const wasHere = new Set(now.map((x) => x.key));
      const hit = then.some((x) => !wasHere.has(x.key) && x.minutes >= STARTER_MINUTES) ? 1 : 0;
      add(tally.programme, `${sport}|${programme}|${position}`, hit);
      add(tally.division, `${sport}|${division}|${position}`, hit);
      add(tally.sport, `${sport}|${position}`, hit);
    }
  }

  const asObject = (map, minimum) => Object.fromEntries([...map.entries()]
    .filter(([, v]) => v.trials >= minimum)
    .map(([k, v]) => [k, { hits: v.hits, trials: v.trials, rate: Number((v.hits / v.trials).toFixed(4)) }]));

  const programmeSizes = [...tally.programme.values()].map((v) => v.trials);
  return {
    sport: asObject(tally.sport, 1),
    division: asObject(tally.division, MIN_DIVISION_OBSERVATIONS),
    programme: asObject(tally.programme, MIN_PROGRAMME_OBSERVATIONS),
    programmeEvidence: {
      cells: programmeSizes.length,
      maxObservations: programmeSizes.length ? Math.max(...programmeSizes) : 0,
      medianObservations: programmeSizes.length ? median(programmeSizes) : 0,
      reachingFloor: programmeSizes.filter((n) => n >= MIN_PROGRAMME_OBSERVATIONS).length,
      note: 'A programme-position rate is not used below the floor. With three season transitions on file nothing reaches it, and the spread of programme rates around the pooled rate is what that many Bernoulli trials produce by chance.',
    },
  };
}

function build(db) {
  const { cells, divisionOf } = loadCells(db);
  const typicalStarters = deriveTypicalStarters(cells);
  const fillPropensity = deriveFillPropensity(cells, divisionOf);
  const payload = {
    normsId: 'positional-norms-2026-09-20',
    createdAt: '2026-09-20',
    seasons: SEASONS,
    starterMinutes: STARTER_MINUTES,
    minProgrammeObservations: MIN_PROGRAMME_OBSERVATIONS,
    minDivisionObservations: MIN_DIVISION_OBSERVATIONS,
    note: 'Generated by server/scripts/derivePositionalNorms.js. Do not hand-edit.',
    typicalStarters,
    fillPropensity,
  };
  payload.digest = crypto.createHash('sha256')
    .update(JSON.stringify({ typicalStarters, fillPropensity }))
    .digest('hex').slice(0, 16);
  return payload;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (write === check) {
    console.error('Usage: derivePositionalNorms.js --write | --check');
    process.exit(2);
  }

  const { default: db } = await import('../db/client.js');
  const built = build(db);

  for (const sport of SPORTS) {
    const t = built.typicalStarters[sport];
    if (!t || POSITIONS.some((p) => !t[p])) {
      console.error(`Refusing to derive: ${sport} is missing a position. Normalising by a constant we did not measure is the defect this script exists to avoid.`);
      process.exit(3);
    }
  }

  if (write) {
    fs.writeFileSync(OUT, `${JSON.stringify(built, null, 2)}\n`);
    console.log(`Wrote ${path.relative(process.cwd(), OUT)}  digest ${built.digest}`);
    for (const sport of SPORTS) {
      console.log(`  ${sport}`);
      for (const p of POSITIONS) {
        const t = built.typicalStarters[sport][p];
        const f = built.fillPropensity.sport[`${sport}|${p}`];
        console.log(`    ${p.padEnd(11)} typicalStarters ${t.typicalStarters}  (mean ${t.mean}, p25 ${t.p25}, p75 ${t.p75}, ${(t.shareAtMedian * 100).toFixed(0)}% exactly, n=${t.programmeSeasons})`);
        console.log(`    ${''.padEnd(11)} fill ${f.rate}  (${f.hits}/${f.trials})`);
      }
    }
    const e = built.fillPropensity.programmeEvidence;
    console.log(`  programme-level fill: ${e.reachingFloor}/${e.cells} reach ${MIN_PROGRAMME_OBSERVATIONS} observations (max ${e.maxObservations}, median ${e.medianObservations})`);
    return;
  }

  const pinned = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (pinned.digest === built.digest) {
    console.log(`positional norms unchanged (digest ${built.digest})`);
    return;
  }
  console.log('POSITIONAL NORMS MOVED');
  for (const sport of SPORTS) {
    for (const p of POSITIONS) {
      const a = pinned.typicalStarters[sport]?.[p]?.typicalStarters;
      const b = built.typicalStarters[sport][p].typicalStarters;
      const fa = pinned.fillPropensity.sport[`${sport}|${p}`]?.rate;
      const fb = built.fillPropensity.sport[`${sport}|${p}`]?.rate;
      if (a !== b || fa !== fb) console.log(`  ${sport} ${p}: starters ${a} -> ${b}, fill ${fa} -> ${fb}`);
    }
  }
  console.log('');
  console.log('Nothing has been rewritten. What a position is worth is a measurement to review, not an event.');
  process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
