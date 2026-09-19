/**
 * The V1 RANKING baseline, as a file that can be diffed.
 *
 * WHY THIS EXISTS. `snapshotProgrammeIntelligence.js` pins the analytical
 * stack behind a Programme Intelligence Report; nothing pinned the thing the
 * product actually sells, which is a RANKED LIST. Every unit test in
 * shared/matching holds one criterion to its contract on fixtures. None of
 * them would notice if a weight, a coupling, a curve constant or a roster
 * column moved every athlete's list by thirty places — and one of those
 * silently did: a roster re-import dropped `projected_minutes`, every
 * departure downgraded from starter to squad, and 242 tests stayed green.
 *
 * This captures the ANSWERS. Eight athletes, chosen so that between them they
 * exercise every branch that decides a list: both sports, both origins, both
 * ends of the ability slider, both ends of the budget bands, the in-state
 * lever, and a position where the starter/squad split is decisive. Run it with
 * `--check` and it fails on any difference, naming the field.
 *
 * READ THIS BEFORE CHANGING A NUMBER IN IT. This file is not an assertion that
 * V1 is correct. It is a record of what V1 currently answers, taken after the
 * baseline repair, so that Matchmaking V2 can be compared against something
 * rather than against memory. A drift here is not automatically a bug — but it
 * is always a decision, and this is what makes the decision visible.
 *
 * WHAT IS NOT IN IT. Anything that moves on its own: no timestamp, no file
 * path, no row id, no count of programmes that a scrape could change on its
 * own. Scores are rounded to the integer the card shows and sub-scores to
 * three places, because a baseline that drifts on floating-point noise gets
 * ignored, and an ignored baseline is worse than none.
 *
 *   npm run snapshot:matching -- --write  # write the baseline
 *   npm run snapshot:matching -- --check  # compare against it, non-zero on drift
 *
 * WHY WRITING NEEDS A FLAG, WHICH IS NOT A STYLE CHOICE.
 *
 * `server/scripts/scripts.test.js` executes EVERY file in this directory with
 * no arguments and `RECRUITMATCH_DB=:memory:`, to prove that module resolution
 * works. A script that does its job when given no arguments therefore does its
 * job against an EMPTY DATABASE, in CI, on every run. This one wrote the
 * baseline at module scope on the first draft, and the test suite promptly
 * replaced 6,668 lines of real ranking with eight fixtures over a pool of zero
 * — a perfectly stable baseline that `--check` then agreed with, because both
 * sides were empty.
 *
 * So the default is to refuse, which is also what that test documents it
 * expects: "the scripts are invoked with no arguments and are expected to fail
 * on usage". A baseline that can be silently replaced by a harness is not a
 * baseline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { buildRosterIndex, rankMatches, normaliseAthlete, departures } from '../../shared/matching/pool.js';
import { rosterOpportunity } from '../../shared/matching/criteria.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(__dirname, '__baselines__', 'matching-v1-2026-09-19.json');

/**
 * The season the product ranks against, pinned here rather than imported from
 * `src/lib/divisions.js`: that module is client-side and pulls in the Vite
 * alias graph. The two must agree, and `--check` is what says so — a baseline
 * built against a different season drifts on every field at once, which is a
 * legible failure rather than a subtle one.
 */
const SEASON = '2026';

/** How many ranked programmes are recorded in full per fixture. */
const TOP_N = 10;

/**
 * The fixtures. Each is a `players` row as `normaliseAthlete` expects one, so
 * the baseline goes through exactly the code the product runs — no shortcut
 * athlete shape that could drift from the real one.
 *
 * Every field is stated on every fixture, including the ones left null. A
 * fixture that inherits a default is a fixture whose meaning changes when the
 * default does.
 */
const FIXTURES = [
  {
    id: 'A-strong-high-budget-strong-academics',
    why: 'The case where affordability saturates: every ceiling is cleared, so the list is decided by ability, level and location alone.',
    player: {
      sport: 'mens-soccer', football_ability: 9, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.9, sat_score: 1450, act_score: null,
      budget_range: '$40k+/yr', state: 'CA', city: 'Los Angeles', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'B-strong-low-budget',
    why: 'Three couplings fire together — location up, affordability up, athletic peak pushed above the programme level — so this is the fixture that pins the coupling layer end to end.',
    player: {
      sport: 'mens-soccer', football_ability: 9, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.2, sat_score: null, act_score: null,
      budget_range: '$5k-$10k/yr', state: 'CA', city: 'Los Angeles', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'C-developmental-high-budget-strong-academics',
    why: 'THE PATHOLOGY FIXTURE. An athlete who cannot play at an elite programme, carrying the two things that are supposed not to buy their way in. What rank an elite programme reaches here is the number the V2 recruitability ceiling exists to move.',
    player: {
      sport: 'mens-soccer', football_ability: 3, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 4.0, sat_score: 1550, act_score: null,
      budget_range: '$40k+/yr', state: 'MA', city: 'Boston', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'D-developmental-low-budget',
    why: 'The opposite corner of C, and the fixture that pins division composition at the bottom of the ability range.',
    player: {
      sport: 'mens-soccer', football_ability: 3, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 2.8, sat_score: null, act_score: null,
      budget_range: '$5k-$10k/yr', state: 'TX', city: 'Dallas', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'E-domestic-in-state-public',
    why: 'Texas carries public programmes across every division, so this fixture is where the residency lever and the in-state geography lift are both live and separable.',
    player: {
      sport: 'mens-soccer', football_ability: 6, position: 'Defender',
      recruiting_class_year: 2028, gpa: 3.4, sat_score: 1150, act_score: null,
      budget_range: '$10k-$15k/yr', state: 'TX', city: 'Austin', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'F-international',
    why: 'Location stops being distance and becomes internationalFit, which is the one criterion an international athlete is ranked on differently. England is chosen because the compatriot clusters are large enough for the same-country half to be live rather than uniformly zero.',
    player: {
      sport: 'mens-soccer', football_ability: 7, position: 'Forward',
      recruiting_class_year: 2028, gpa: 3.3, sat_score: null, act_score: null,
      budget_range: '$15k-$20k/yr', state: null, city: null, nationality: 'England',
      origin: 'International', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'G-goalkeeper-starter-evidence',
    why: 'THE STARTER-SPLIT FIXTURE. EXPECTED_ANNUAL_NEED is 1 for a goalkeeper, so one departing STARTER saturates roster opportunity at 1.0 where the same player read as squad scores 0.4. If projected_minutes is ever dropped again, this fixture moves and the probes below say by how much.',
    player: {
      sport: 'mens-soccer', football_ability: 6, position: 'Goalkeeper',
      recruiting_class_year: 2028, gpa: 3.5, sat_score: 1200, act_score: null,
      budget_range: '$20k-$25k/yr', state: 'OH', city: 'Columbus', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
  {
    id: 'H-womens-strong-mid-budget',
    why: 'The women\'s game has its own pool, its own aid constants (0.5/0.9 at D1 against 0.33/0.75) and no NJCAA at all, so a men\'s-only baseline would pin none of it.',
    player: {
      sport: 'womens-soccer', football_ability: 8, position: 'Defender',
      recruiting_class_year: 2028, gpa: 3.7, sat_score: 1300, act_score: null,
      budget_range: '$20k-$25k/yr', state: 'NC', city: 'Charlotte', nationality: 'USA',
      origin: 'USA', academic_minimum: null,
      preferred_divisions: '[]', preferred_conferences: '[]',
      match_weights: null, criterion_ranking: null,
    },
  },
];

/**
 * Named cells whose starter/squad split is recorded directly, independently of
 * where the programme happens to rank.
 *
 * The ranked lists above would eventually catch a regression in the starter
 * split, but only if the affected programme stayed in somebody's top ten.
 * These probes catch it wherever it happens: each records what the cohort
 * holds AND what the criterion would score if every departure were read as
 * squad — which is precisely the shape of the defect being guarded against.
 */
const PROBES = [
  ['Akron', 'womens-soccer', 'GOALKEEPER', 2028],
  ['Akron', 'mens-soccer', 'MIDFIELD', 2028],
  ['Adelphi', 'mens-soccer', 'GOALKEEPER', 2027],
  ['Missouri State', 'mens-soccer', 'DEFENSE', 2028],
  ['Albertus Magnus', 'mens-soccer', 'FORWARD', 2028],
];

const r3 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v ?? null);

const rosterFor = (sport) => db.prepare(`
  SELECT college_name, player_name, position, minutes_played, projected_minutes,
         estimated_graduation_year, eligibility_end_year, country
    FROM roster_players WHERE sport = ? AND season = ?
`).all(sport, SEASON);

const collegesFor = (sport) => db.prepare(
  'SELECT * FROM colleges WHERE sport = ? AND active = 1',
).all(sport);

/** One roster index per sport, not per fixture — six of the eight share one. */
const indexCache = new Map();
function indexFor(sport) {
  if (!indexCache.has(sport)) indexCache.set(sport, buildRosterIndex(rosterFor(sport)));
  return indexCache.get(sport);
}

/**
 * One ranked programme, reduced to what a drift would show up in.
 *
 * The criterion breakdown is carried in the declared CRITERIA order that
 * `scoreMatch` emits, so a reordering of the criteria is itself a drift.
 */
function entry(r, rank) {
  return {
    rank,
    name: r.name,
    division: r.division,
    score: r.match_score,
    confidence: r.confidence,
    labels: r.labels,
    breakdown: r.breakdown.map((b) => ({
      key: b.key, weight: r3(b.weight), score: r3(b.score),
      contribution: r3(b.contribution), confidence: b.confidence, status: b.status ?? null,
    })),
    // The roster evidence the card and the email both read. Carried in full
    // because "the numbers moved" and "the names stopped rendering" are
    // different regressions and the second is invisible in a score.
    roster: {
      atPosition: r.graduating_at_position,
      startersAtPosition: r.graduating_starters_at_position,
      starterNamesAtPosition: r.graduating_starter_names_at_position.length,
      namesAtPosition: r.graduating_names_at_position.length,
      total: r.graduating_total,
      startersTotal: r.graduating_starters_total,
      internationalPlayers: r.international_players,
      playersFromCountry: r.players_from_country,
    },
    soccerScore: r3(r.soccer_score),
    netPrice: r.net_price ?? null,
  };
}

function snapshotFixture(fixture) {
  const athlete = normaliseAthlete(fixture.player);
  const colleges = collegesFor(fixture.player.sport);
  const { results, excluded, weights, poolSize, adjustments, couplingsFired } =
    rankMatches({ athlete, colleges, rosterIndex: indexFor(fixture.player.sport) });

  const top100 = results.slice(0, 100);
  const divisions = {};
  for (const r of top100) divisions[r.division ?? 'null'] = (divisions[r.division ?? 'null'] ?? 0) + 1;

  // Where the strongest programmes land. The single most important number for
  // the V2 comparison, and one that no criterion test can express.
  const elite = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.soccer_score != null && r.soccer_score >= 85);
  const bestElite = elite.length
    ? { rank: elite[0].i + 1, name: elite[0].r.name, score: elite[0].r.match_score,
      athletic: r3(elite[0].r.breakdown.find((b) => b.key === 'athletic').score) }
    : null;

  const confidences = {};
  for (const r of top100) confidences[r.confidence] = (confidences[r.confidence] ?? 0) + 1;

  return {
    why: fixture.why,
    sport: fixture.player.sport,
    season: SEASON,
    weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, r3(v)])),
    couplingsFired: couplingsFired ?? [],
    adjustments: adjustments ?? [],
    poolSize,
    excluded,
    ranked: results.length,
    top: results.slice(0, TOP_N).map((r, i) => entry(r, i + 1)),
    top100Divisions: divisions,
    top100Confidence: confidences,
    // Not the mean of the top ten: the spread across the actionable hundred is
    // what a change to the combination rule moves, and a mean of ten hides it.
    top100ScoreRange: [top100[top100.length - 1]?.match_score ?? null, top100[0]?.match_score ?? null],
    // How many of the actionable hundred the athlete is athletically unable to
    // play for. Zero is not expected under V1; this is the number V2's
    // recruitability ceiling is meant to reduce.
    top100WithAthleticBelow: {
      '0.10': top100.filter((r) => r.breakdown.find((b) => b.key === 'athletic').score < 0.10).length,
      '0.25': top100.filter((r) => r.breakdown.find((b) => b.key === 'athletic').score < 0.25).length,
    },
    bestElite,
  };
}

function snapshotProbe([name, sport, position, classYear]) {
  const cohort = departures(indexFor(sport).get(name), classYear, position);
  const roster = indexFor(sport).get(name);
  if (!roster) return { present: false };
  const c = cohort.atPosition;
  const shared = {
    rosterRowsForSchool: roster.rows,
    rowsMissingGradYear: roster.missingGradYear,
    position,
  };
  const measured = rosterOpportunity({
    ...shared,
    graduatingStarters: c?.starters ?? 0,
    graduatingSquad: c?.squad ?? 0,
  });
  // The same cohort with the starter split thrown away, which is exactly what
  // a missing `projected_minutes` produces. Recorded beside the real figure so
  // a regression is visible as the distance between two numbers in one file.
  const ifStarterSplitLost = rosterOpportunity({
    ...shared,
    graduatingStarters: 0,
    graduatingSquad: (c?.starters ?? 0) + (c?.squad ?? 0),
  });
  return {
    present: true,
    starters: c?.starters ?? 0,
    squad: c?.squad ?? 0,
    starterNames: c?.starterNames.length ?? 0,
    squadTotalThatYear: cohort.total,
    squadStartersThatYear: cohort.totalStarters,
    opportunity: r3(measured.score),
    opportunityConfidence: measured.confidence,
    opportunityLabel: measured.label,
    opportunityIfStarterSplitLost: r3(ifStarterSplitLost.score),
  };
}

function build() {
  const out = { season: SEASON, fixtures: {}, probes: {} };
  for (const f of FIXTURES) out.fixtures[f.id] = snapshotFixture(f);
  for (const p of PROBES) out.probes[`${p[0]} (${p[1]}) ${p[2]} ${p[3]}`] = snapshotProbe(p);
  return out;
}

/** Every leaf that differs, by path. Same shape as the Programme Intelligence check. */
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
const write = process.argv.includes('--write');

/**
 * Neither flag is a usage error, not a default. See the header: this file
 * lives in a directory whose every script is executed with no arguments by
 * `scripts.test.js`, against an empty in-memory database.
 */
if (check === write) {
  console.error('usage: node server/scripts/snapshotMatchingBaseline.js (--write | --check)');
  console.error('  --write   rebuild the V1 ranking baseline from the working database');
  console.error('  --check   compare the working database against it; non-zero on drift');
  process.exit(2);
}

const now = build();

/**
 * A pool of zero is not a baseline, it is an empty database wearing one.
 * Checked on BOTH paths: writing one is the accident described in the header,
 * and checking against one would report "0 differences" and mean nothing.
 */
const emptyPools = Object.entries(now.fixtures).filter(([, f]) => !f.poolSize);
if (emptyPools.length) {
  console.error(`refusing: ${emptyPools.length} of ${Object.keys(now.fixtures).length} fixtures ranked an empty pool`);
  console.error(`  ${emptyPools.map(([id]) => id).join(', ')}`);
  console.error('  the database this ran against holds no colleges for those sports');
  process.exit(3);
}

/**
 * A roster with no starter split is a roster whose projections were dropped.
 *
 * THIS GUARD EXISTS BECAUSE IT HAPPENED TWICE. `projected_minutes` is not
 * produced by the roster import — `npm run project-minutes` derives it
 * afterwards — so any re-import, and at least one thing in this repository
 * nobody has yet identified, silently returns the 2026 season to zero
 * starters. Every departure then reads as a squad player at 0.4 weight, and
 * the ranking still looks entirely reasonable.
 *
 * It was caught the first time by the probes below, which is the baseline
 * doing its job, and only after a drift report had already been written
 * attributing the movement to a code change. A baseline taken in that state is
 * worse than none: it pins the wrong answer and then agrees with itself.
 *
 * The test is on the probes rather than a row count, because what matters is
 * that the split is READABLE where the fixtures look, not that some column is
 * non-null somewhere.
 */
const probed = Object.entries(now.probes).filter(([, p]) => p.present);
const withStarters = probed.filter(([, p]) => p.starters > 0);
if (probed.length && !withStarters.length) {
  console.error(`refusing: not one of ${probed.length} roster probes carries a graduating starter`);
  console.error('  every departure is reading as a squad player, which means the current');
  console.error('  season has no minutes and no projections to stand in for them.');
  console.error('  Run `npm run project-minutes` and try again.');
  process.exit(4);
}

if (write) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${JSON.stringify(now, null, 1)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), BASELINE)}`);
  console.log(`  ${Object.keys(now.fixtures).length} athlete fixtures, ${Object.keys(now.probes).length} roster probes`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(`no baseline at ${BASELINE}; run without --check to write one`);
  process.exit(2);
}
const differences = diff(JSON.parse(fs.readFileSync(BASELINE, 'utf-8')), now);
if (!differences.length) {
  console.log(`V1 ranking baseline matches: ${Object.keys(now.fixtures).length} fixtures, `
    + `${Object.keys(now.probes).length} probes, 0 differences`);
  process.exit(0);
}
console.error(`V1 ranking baseline DRIFTED: ${differences.length} field(s)`);
for (const d of differences.slice(0, 400)) {
  console.error(`  ${d.at}: ${JSON.stringify(d.baseline)} -> ${JSON.stringify(d.now)}`);
}
if (differences.length > 400) console.error(`  … and ${differences.length - 400} more`);
process.exit(1);
