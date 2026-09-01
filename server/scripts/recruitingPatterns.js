#!/usr/bin/env node
/**
 * Inspecting what a programme's recruiting history actually contains.
 *
 *   npm run recruiting:patterns                       global coverage, both sports
 *   npm run recruiting:patterns -- --regions          the taxonomy against live data
 *   npm run recruiting:patterns -- --validate         the validation programme set
 *   npm run recruiting:patterns -- --programme Elon
 *   npm run recruiting:patterns -- --player "Rhys Davies" --programme Elon
 *
 * OBSERVATIONS ONLY. Nothing here writes a sentence about what a programme
 * likes, prefers, targets or needs. It prints counts, the transitions behind
 * them, and whether those transitions clear the floor — and stops there,
 * because the point of the phase is that the reading is a separate decision
 * made somewhere it can be reviewed.
 */
import 'dotenv/config';
import db from '../db/client.js';
import {
  loadPatternsForSport, loadProgrammePatterns,
} from '../lib/recruitingPatterns.js';
import {
  COVERAGE, COVERAGE_FLOOR, DATA_STATUS, POSITION_KEYS, observationsFor,
} from '../../shared/recruiting/patterns.js';
import {
  REGIONS, REGION_KEYS, canonicalCountry, regionOf, unmappedCountries,
} from '../../shared/recruiting/regions.js';
import { POSITION_PLURAL } from '../../shared/positions.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const SPORT = arg('sport', 'mens-soccer');

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const rule = (c = '=') => console.log(c.repeat(78));
const head = (t) => { console.log(); rule(); console.log(t); rule(); };
const sufficient = (c) => c?.status === COVERAGE.SUFFICIENT;

/* -------------------------------------------------------------------------- */
/* 1. The taxonomy, against the data it has to file                            */
/* -------------------------------------------------------------------------- */

function regionReport() {
  head(`CANONICAL INTERNATIONAL REGIONS  (${REGION_KEYS.length} regions)`);

  const rows = db.prepare(
    "SELECT country, sport, COUNT(*) n FROM recruiting_arrivals"
    + " WHERE country IS NOT NULL AND TRIM(country) <> '' GROUP BY country, sport",
  ).all();

  const byRegion = new Map(REGION_KEYS.map((k) => [k, { m: 0, w: 0, countries: new Map() }]));
  const raw = [];
  let placed = 0;
  let total = 0;
  for (const r of rows) {
    raw.push(...Array(r.n).fill(r.country));
    total += r.n;
    const region = regionOf(r.country);
    if (!region) continue;
    placed += r.n;
    const e = byRegion.get(region);
    const country = canonicalCountry(r.country);
    e.countries.set(country, (e.countries.get(country) ?? 0) + r.n);
    if (r.sport === 'mens-soccer') e.m += r.n; else e.w += r.n;
  }

  for (const key of REGION_KEYS) {
    const e = byRegion.get(key);
    const top = [...e.countries.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\n  ${key}  —  ${e.m + e.w} arrivals (m=${e.m} w=${e.w}) across `
      + `${top.length} countries observed, ${REGIONS[key].length} mapped`);
    // Every country with an arrival is printed. A "top 5" here would hide
    // exactly the misfiling this report exists to catch.
    const lines = [];
    for (let i = 0; i < top.length; i += 4) {
      lines.push(top.slice(i, i + 4).map(([c, n]) => `${c} ${n}`).join('  ·  '));
    }
    for (const l of lines) console.log(`      ${l}`);
  }

  const unmapped = unmappedCountries(raw);
  console.log(`\n  classified : ${placed} of ${total} arrivals with a country  (${pct(placed, total)})`);
  console.log(`  UNMAPPED   : ${unmapped.size} country values`
    + (unmapped.size ? `  ${[...unmapped.entries()].map(([c, n]) => `${c}=${n}`).join(', ')}` : ''));
  console.log('\n  Aliases normalised at this layer only; roster_players is untouched.');
}

/* -------------------------------------------------------------------------- */
/* 2. Global coverage: what could be evaluated, and what was actually found    */
/* -------------------------------------------------------------------------- */

/**
 * The two numbers the brief insists on keeping apart.
 *
 * EVALUABLE is "this programme has enough observed transitions that an answer —
 * including a zero — would mean something". POSITIVE is "the answer was not
 * zero". Reporting only the second makes a thin data set look like a decisive
 * one; reporting only the first makes an empty one look full.
 */
function coverageReport(sport) {
  const patterns = [...loadPatternsForSport(sport).values()];
  head(`GLOBAL COVERAGE — ${sport}   ${patterns.length} programmes, floor = ${COVERAGE_FLOOR} transitions`);

  const dist = {};
  for (const p of patterns) dist[p.coverage.observedTransitions] = (dist[p.coverage.observedTransitions] || 0) + 1;
  console.log('\n  comparable transitions per programme');
  for (const n of Object.keys(dist).sort()) {
    console.log(`    ${n}: ${String(dist[n]).padStart(5)} programmes  ${pct(dist[n], patterns.length)}`);
  }
  const evaluableProgrammes = patterns.filter((p) => sufficient(p.coverage));
  const evaluableCoach = patterns.filter((p) => sufficient(p.coach.coverage));
  console.log(`\n  SUFFICIENT programme coverage : ${evaluableProgrammes.length}  ${pct(evaluableProgrammes.length, patterns.length)}`);
  console.log(`  SUFFICIENT coach coverage     : ${evaluableCoach.length}  ${pct(evaluableCoach.length, patterns.length)}`);

  const TYPES = [
    ['position history', (p) => sufficient(p.coverage), (p) => p.arrivals > 0],
    ['country history', (p) => sufficient(p.coverage), (p) => p.countries.distinctCountries > 0],
    ['country x position', (p) => sufficient(p.coverage), (p) => Object.keys(p.countryPositions.pairs).length > 0],
    ['region history', (p) => sufficient(p.coverage), (p) => p.regions.distinctRegions > 0],
    ['region x position', (p) => sufficient(p.coverage), (p) => Object.keys(p.regionPositions.pairs).length > 0],
    ['freshman/experienced mix', (p) => sufficient(p.coverage), (p) => p.entryMix.total > 0],
    ['coach position history', (p) => sufficient(p.coach.coverage), (p) => p.coach.attributableArrivals > 0],
    ['coach country history', (p) => sufficient(p.coach.coverage), (p) => p.coach.countries.distinctCountries > 0],
    ['coach country x position', (p) => sufficient(p.coach.coverage), (p) => Object.keys(p.coach.countryPositions.pairs).length > 0],
  ];

  console.log('\n  INTELLIGENCE TYPE                 EVALUABLE   POSITIVE OBSERVATION');
  console.log('  ' + '-'.repeat(70));
  for (const [label, canEval, isPositive] of TYPES) {
    const ev = patterns.filter(canEval);
    const pos = ev.filter(isPositive);
    console.log(`  ${label.padEnd(30)} ${String(ev.length).padStart(8)}   ${String(pos.length).padStart(8)}  ${pct(pos.length, ev.length)}`);
  }

  /**
   * The narrow cuts, which is where the distinction stops being academic. A
   * programme is evaluable for "New Zealand x Defender" whenever it has three
   * transitions on file; almost none of them have a positive observation, and
   * that gap is the whole reason a zero has to be reported with its coverage.
   */
  const NARROW = [
    ['New Zealand x Defender', 'New Zealand||DEFENSE', 'OCEANIA||DEFENSE'],
    ['New Zealand x any position', 'New Zealand', null],
    ['Oceania x Defender', null, 'OCEANIA||DEFENSE'],
    ['United Kingdom x Midfielder', 'United Kingdom||MIDFIELD', null],
  ];
  console.log('\n  NARROW CUTS                       EVALUABLE   POSITIVE OBSERVATION');
  console.log('  ' + '-'.repeat(70));
  for (const [label, countryKey, regionKey] of NARROW) {
    const ev = patterns.filter((p) => sufficient(p.coverage));
    const pos = ev.filter((p) => {
      if (countryKey && countryKey.includes('||')) return (p.countryPositions.pairs[countryKey]?.total ?? 0) > 0;
      if (countryKey) return (p.countries.countries[countryKey]?.total ?? 0) > 0;
      return (p.regionPositions.pairs[regionKey]?.total ?? 0) > 0;
    });
    console.log(`  ${label.padEnd(30)} ${String(ev.length).padStart(8)}   ${String(pos.length).padStart(8)}  ${pct(pos.length, ev.length)}`);
  }

  const status = patterns[0]?.dataStatus;
  console.log(`\n  country/region data status : ${status?.status}`);
  console.log(`    ${status?.reason}`);
  if (status?.status === DATA_STATUS.UNVALIDATED) {
    console.log('    validation needed before any of this may become FACT evidence:');
    for (const v of status.validationNeeded) console.log(`      - ${v}`);
  }
  return patterns;
}

/* -------------------------------------------------------------------------- */
/* 3. One programme                                                            */
/* -------------------------------------------------------------------------- */

function programmeReport(p, { named = 6 } = {}) {
  const c = p.coverage;
  head(`PROGRAMME: ${p.programme}   (${p.sport})`);
  console.log(`  Comparable transitions : ${c.observedTransitions}/${c.possibleTransitions}`
    + `  [${c.transitions.join(', ') || 'none'}]`);
  console.log(`  Pattern status         : ${c.status}`);
  console.log(`  DIRECT arrivals        : ${p.arrivals}`);

  const gate = (a) => (a.reportable
    ? 'a zero here is an observation'
    : `a ZERO here is NOT reportable — ${a.reasons.join('; ')}`);

  console.log(`\n  POSITION INTAKE   (position recorded on `
    + `${p.positions.knownShare === null ? '—' : pct(p.positions.positionsKnown, p.arrivals)}`
    + ` of arrivals; ${gate(p.positions.absence)})`);
  for (const key of POSITION_KEYS) {
    const o = p.positions.positions[key];
    const per = c.transitions.map((t) => `${t.split('->')[1]}: ${o.byTransition[t]}`).join('   ');
    const label = POSITION_PLURAL[key] ?? 'unclassified';
    console.log(`    ${label.padEnd(13)} total ${String(o.total).padStart(3)}`
      + `  in ${o.transitionsWithArrival}/${c.observedTransitions} transitions`
      + `  mean ${o.meanPerTransition === null ? '—' : o.meanPerTransition.toFixed(2)}`
      + `  coach-attributed ${o.coachAttributed}`);
    if (per) console.log(`                  ${per}`);
  }

  const countries = Object.values(p.countries.countries).sort((a, b) => b.total - a.total);
  console.log(`\n  COUNTRIES  (${p.countries.distinctCountries} distinct, `
    + `${p.countries.international.total} international arrivals, `
    + `share ${p.countries.internationalShare === null ? '—' : pct(p.countries.international.total, p.arrivals)})`);
  console.log(`    ${gate(p.countries.absence)}`);
  for (const o of countries) {
    console.log(`    ${o.key.padEnd(24)} ${String(o.total).padStart(3)}`
      + `  seasons ${o.seasons.join(',')}`
      + `  positions ${Object.entries(o.positions).map(([k, v]) => `${k}:${v}`).join(' ')}`
      + `  coach ${o.coachAttributed}`);
  }
  if (!countries.length) console.log('    none');

  const pairs = Object.values(p.countryPositions.pairs).sort((a, b) => b.total - a.total);
  console.log('\n  COUNTRY x POSITION');
  for (const o of pairs.slice(0, 12)) {
    console.log(`    ${o.key.padEnd(30)} ${String(o.total).padStart(2)}  `
      + o.named.map((n) => `${n.playerName} (${n.arrivalSeason})`).join(', '));
  }
  if (!pairs.length) console.log('    none');

  const regions = Object.values(p.regions.regions).sort((a, b) => b.total - a.total);
  console.log('\n  REGIONS');
  for (const o of regions) {
    console.log(`    ${o.key.padEnd(16)} ${String(o.total).padStart(3)}`
      + `  countries ${Object.keys(o.countries).join(', ')}`
      + `  in ${o.transitionsWithArrival}/${c.observedTransitions} transitions`);
  }
  if (!regions.length) console.log('    none');
  if (p.regions.unplacedInternational) {
    console.log(`    UNPLACED: ${p.regions.unplacedInternational} (${p.regions.unplacedCountries.join(', ')})`);
  }

  const m = p.entryMix;
  console.log(`\n  ENTRY MIX   (${gate(p.entryMix.absence)})`);
  console.log(`    Freshman    ${String(m.counts.FRESHMAN).padStart(3)}  ${pct(m.counts.FRESHMAN, m.total)}`);
  console.log(`    Experienced ${String(m.counts.EXPERIENCED).padStart(3)}  ${pct(m.counts.EXPERIENCED, m.total)}`);
  console.log(`    Unknown     ${String(m.counts.UNKNOWN).padStart(3)}  ${pct(m.counts.UNKNOWN, m.total)}`);
  for (const [season, v] of Object.entries(m.bySeason)) {
    console.log(`      ${season}: F ${v.FRESHMAN}  E ${v.EXPERIENCED}  U ${v.UNKNOWN}   (${v.total})`);
  }

  const co = p.coach;
  console.log('\n  CURRENT COACH');
  console.log(`    Coach                    : ${co.coach ?? '(none on file)'}`);
  console.log(`    Attributable transitions : ${co.attributableTransitions}  [${co.coverage.transitions.join(', ') || 'none'}]`);
  console.log(`    Attributable arrivals    : ${co.attributableArrivals}`);
  console.log(`    Supported seasons        : ${co.earliestSupportedSeason ?? '—'} to ${co.latestSupportedSeason ?? '—'}`);
  console.log(`    Coach pattern status     : ${co.coverage.status}`);
  console.log(`    Excluded                 : inherited ${co.excluded.inherited}`
    + `, unknown ${co.excluded.unknown}, previous coach ${co.excluded.otherCoach}`);
  if (co.attributableArrivals) {
    const cc = Object.values(co.countries.countries).sort((a, b) => b.total - a.total);
    console.log(`    Countries                : ${cc.map((o) => `${o.key} ${o.total}`).join(', ') || 'none'}`);
    console.log(`    Positions                : ${POSITION_KEYS.map((k) => `${k} ${co.positions.positions[k].total}`).join('  ')}`);
    const cp = Object.values(co.countryPositions.pairs).sort((a, b) => b.total - a.total).slice(0, 8);
    console.log(`    Country x position       : ${cp.map((o) => `${o.key} ${o.total}`).join(', ') || 'none'}`);
    console.log(`    Entry mix                : F ${co.entryMix.counts.FRESHMAN}`
      + `  E ${co.entryMix.counts.EXPERIENCED}  U ${co.entryMix.counts.UNKNOWN}`);
  }

  if (named && p.source.length) {
    console.log(`\n  NAMED ARRIVALS (${Math.min(named, p.source.length)} of ${p.source.length}, most recent first)`);
    const rows = [...p.source].sort((a, b) => b.arrivalSeason.localeCompare(a.arrivalSeason));
    for (const a of rows.slice(0, named)) {
      console.log(`    ${a.arrivalSeason}  ${a.playerName.padEnd(26)} ${String(a.canonicalPosition).padEnd(11)}`
        + ` ${(a.country ?? 'domestic').padEnd(18)} ${a.entryType.padEnd(12)} ${a.coachAttribution}`
        + (a.priorProgramme ? `  <- ${a.priorProgramme}` : ''));
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 4. Player-relative                                                          */
/* -------------------------------------------------------------------------- */

function playerReport(player, patterns) {
  const o = observationsFor(player, patterns);
  head(`PLAYER-RELATIVE — ${player.name ?? 'player'} at ${patterns.programme}`);
  console.log(`  ${o.player.country ?? 'domestic'} · ${o.player.region ?? 'no region'}`
    + ` · ${o.player.canonicalPosition ?? 'no position'} · ${o.player.entryType ?? 'unknown entry'}`);
  console.log(`  programme coverage ${o.coverage.status} (${o.coverage.observedTransitions}/${o.coverage.possibleTransitions})`
    + `   coach coverage ${o.coachCoverage?.status ?? '—'} (${o.coachCoverage?.observedTransitions ?? 0})`);
  console.log(`  country/region data status: ${o.dataStatus.status}`);

  const line = (label, obs) => {
    if (!obs) { console.log(`    ${label.padEnd(32)} n/a`); return; }
    const names = obs.named?.length
      ? `  ${obs.named.map((n) => `${n.playerName} ${n.arrivalSeason}`).join(', ')}` : '';
    console.log(`    ${label.padEnd(32)} ${String(obs.total).padStart(3)}`
      + `  in ${obs.transitionsWithArrival}/${obs.coverage.observedTransitions} transitions`
      + `  [${obs.coverage.status}]${names}`);
  };

  console.log('\n  PROGRAMME');
  line('same country', o.sameCountry);
  line('same country x position', o.sameCountryPosition);
  line('same region', o.sameRegion);
  line('same region x position', o.sameRegionPosition);
  line('position history', o.positionHistory);
  line('international x position', o.internationalPositionHistory);
  line('international history', o.internationalHistory);
  if (o.entryTypeHistory) {
    console.log(`    ${'entry type history'.padEnd(32)} ${String(o.entryTypeHistory.count).padStart(3)}`
      + `  of ${o.entryTypeHistory.mix.total} arrivals were ${o.entryTypeHistory.entryType}`);
  }

  console.log('\n  CURRENT COACH');
  line('coach same country', o.coachSameCountry);
  line('coach same country x position', o.coachSameCountryPosition);
  line('coach same region', o.coachSameRegion);
  line('coach position history', o.coachPositionHistory);
  console.log(`\n  absence gates — country/region: `
    + `${patterns.countries.absence.reportable ? 'zero is reportable' : patterns.countries.absence.reasons.join('; ')}`);
  console.log(`                  position      : `
    + `${patterns.positions.absence.reportable ? 'zero is reportable' : patterns.positions.absence.reasons.join('; ')}`);
  console.log('\n  Data only. No ranking, no threshold, no claim.');
}

/* -------------------------------------------------------------------------- */
/* 5. Validation set                                                           */
/* -------------------------------------------------------------------------- */

function validate() {
  const mens = loadPatternsForSport('mens-soccer');
  const womens = loadPatternsForSport('womens-soccer');
  const all = [...mens.values()];

  const named = ['Jacksonville', 'Sacred Heart', 'Butler', 'Utah Valley', 'Elon', 'Calvin'];
  // Each criterion must land on a DIFFERENT programme. One programme that
  // happens to satisfy two of them would look like two independent checks and
  // be one, which is the sort of coverage that reads well and proves less.
  const taken = new Set(named);
  const pick = (label, fn) => {
    const found = all.filter((p) => !taken.has(p.programme)).filter(fn)
      .sort((a, b) => b.arrivals - a.arrivals)[0];
    if (!found) return null;
    taken.add(found.programme);
    return { label, p: found };
  };

  const chosen = [
    ...named.map((n) => (mens.has(n) ? { label: 'named in the brief', p: mens.get(n) } : null)),
    pick('4 transitions, no internationals',
      (p) => p.coverage.observedTransitions === 4 && p.countries.international.total === 0),
    pick('only 1 transition', (p) => p.coverage.observedTransitions === 1),
    pick('coach change inside the window',
      (p) => p.coach.excluded.inherited > 0 && p.coverage.observedTransitions >= 3),
    pick('3+ attributable coach transitions',
      (p) => p.coach.attributableTransitions >= 3),
  ].filter(Boolean);

  const w = [...womens.values()].find((p) => p.programme === 'Marshall')
    ?? [...womens.values()].sort((a, b) => b.arrivals - a.arrivals)[0];
  if (w) chosen.push({ label: "women's programme", p: w });

  for (const { label, p } of chosen) {
    programmeReport(p, { named: 8 });
    console.log(`\n  [selected as: ${label}]`);
  }
}

/* -------------------------------------------------------------------------- */

const programme = arg('programme');
const playerName = arg('player');

if (has('regions')) {
  regionReport();
} else if (playerName) {
  const row = db.prepare('SELECT * FROM players WHERE full_name = ?').get(playerName);
  if (!row) throw new Error(`no player named ${playerName}`);
  const patterns = loadProgrammePatterns(row.sport ?? SPORT, programme);
  if (!patterns) throw new Error(`no programme named ${programme}`);
  playerReport({
    name: row.full_name,
    country: row.nationality,
    canonicalPosition: { Defender: 'DEFENSE', Midfielder: 'MIDFIELD', Forward: 'FORWARD', Goalkeeper: 'GOALKEEPER' }[row.position] ?? 'UNKNOWN',
    entryType: 'FRESHMAN',
  }, patterns);
} else if (programme) {
  const patterns = loadProgrammePatterns(SPORT, programme);
  if (!patterns) throw new Error(`no programme named ${programme}`);
  programmeReport(patterns, { named: 20 });
} else if (has('validate')) {
  validate();
} else {
  regionReport();
  coverageReport('mens-soccer');
  coverageReport('womens-soccer');
}

console.log('\nObservations only — no interpretation, no evidence, no copy.\n');
