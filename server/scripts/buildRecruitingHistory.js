#!/usr/bin/env node
/**
 * Rebuilds `recruiting_arrivals` from the roster data, and reports what it found.
 *
 * The table is DERIVED and DISPOSABLE. `roster_players` is the source; this
 * script is the only thing that writes here, it deletes the sport's rows before
 * writing, and dropping the table entirely costs nothing but a re-run.
 *
 *   npm run build:recruiting                    both sports, rebuild + report
 *   npm run build:recruiting -- --sport mens-soccer
 *   npm run build:recruiting -- --report        report only, no write
 *
 * The report is the point as much as the table. A recruiting history is only
 * usable as evidence where coverage supports it, and the per-programme
 * transition counts at the end are what a later phase will gate on.
 */
import 'dotenv/config';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import {
  arrivalsFor, buildPriorIndex, ARRIVAL_TRANSITIONS,
  ENTRY_TYPE, PRIOR_CONFIDENCE, COACH_ATTRIBUTION,
} from '../../shared/recruiting/arrivals.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const REPORT_ONLY = argv.includes('--report');
const SPORTS = arg('sport') ? [arg('sport')] : ['mens-soccer', 'womens-soccer'];

const insert = db.prepare(`
  INSERT INTO recruiting_arrivals (
    programme, sport, arrival_season, prior_season, source_transition, roster_row_id,
    player_name, name_key, arrival_confidence, identity_method, reconciled_from, canonical_position,
    nationality_flag, country, region, is_international,
    class_label_raw, entry_type,
    prior_programme, prior_confidence, prior_candidates,
    coach, coach_attribution, built_at
  ) VALUES (
    @programme, @sport, @arrivalSeason, @priorSeason, @sourceTransition, @rosterRowId,
    @playerName, @nameKey, @arrivalConfidence, @identityMethod, @reconciledFrom, @canonicalPosition,
    @nationalityFlag, @country, @region, @isInternational,
    @classLabelRaw, @entryType,
    @priorProgramme, @priorConfidence, @priorCandidates,
    @coach, @coachAttribution, @builtAt
  )
`);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const tally = (rows, key) => rows.reduce((m, r) => {
  const k = r[key] ?? '(null)';
  m[k] = (m[k] || 0) + 1;
  return m;
}, {});
const show = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k}=${v}`).join('  ');

function buildSport(sport) {
  const rows = db.prepare('SELECT * FROM roster_players WHERE sport = ?').all(sport);
  const coachRows = db.prepare('SELECT school, season, coach_name, reason FROM coach_seasons WHERE sport = ? ORDER BY season').all(sport);

  const coachBy = new Map();
  for (const c of coachRows) {
    if (!coachBy.has(c.school)) coachBy.set(c.school, []);
    coachBy.get(c.school).push(c);
  }
  const byProgramme = new Map();
  for (const r of rows) {
    if (!byProgramme.has(r.college_name)) byProgramme.set(r.college_name, []);
    byProgramme.get(r.college_name).push(r);
  }

  // One index over every programme, because "where else was this name last
  // season" cannot be answered from one programme's rows.
  const priorIndex = buildPriorIndex(rows);

  const allArrivals = [];
  let unknownRows = 0;
  let reconciled = 0;
  let sameSeasonMerges = 0;
  const transitionCounts = new Map();   // programme -> comparable transitions

  for (const [programme, progRows] of byProgramme) {
    const out = arrivalsFor(progRows, {
      coachRows: coachBy.get(programme) ?? [],
      priorIndex,
      transitions: ARRIVAL_TRANSITIONS,
    });
    allArrivals.push(...out.arrivals);
    unknownRows += out.coverage.unknownRows;
    reconciled += out.coverage.reconciledNames;
    sameSeasonMerges += out.coverage.sameSeasonMerges;
    transitionCounts.set(programme, out.coverage.comparableCount);
  }

  if (!REPORT_ONLY) {
    const builtAt = utcNow();
    db.transaction(() => {
      db.prepare('DELETE FROM recruiting_arrivals WHERE sport = ?').run(sport);
      for (const a of allArrivals) {
        insert.run({
          ...a,
          isInternational: a.isInternational ? 1 : 0,
          priorCandidates: a.priorCandidates?.length ? JSON.stringify(a.priorCandidates) : null,
          reconciledFrom: a.reconciledFrom?.length ? JSON.stringify(a.reconciledFrom) : null,
          builtAt,
        });
      }
    })();
  }

  return {
    sport, rows, allArrivals, unknownRows, reconciled, sameSeasonMerges, transitionCounts, byProgramme,
  };
}

function report(r) {
  const a = r.allArrivals;
  console.log(`\n${'='.repeat(74)}`);
  console.log(`${r.sport}   ${r.rows.length} roster rows across ${r.byProgramme.size} programmes`);
  console.log('='.repeat(74));

  const comparable = [...r.transitionCounts.values()].reduce((s, n) => s + n, 0);
  console.log(`\n  comparable transitions       : ${comparable}`);
  console.log(`  DIRECT arrivals              : ${a.length}`);
  console.log(`  rows with no prior roster    : ${r.unknownRows}  (recorded as UNKNOWN, not stored)`);
  console.log(`  middle-name reconciliations  : ${r.reconciled}  (would otherwise be false arrivals)`);
  console.log(`  same-season merges           : ${r.sameSeasonMerges}  (one roster, one player, two spellings)`);

  console.log('\n  arrivals by season           :', show(tally(a, 'arrivalSeason')));
  console.log('  by canonical position        :', show(tally(a, 'canonicalPosition')));
  console.log('  entry type                   :', show(tally(a, 'entryType')));
  console.log('  prior programme              :', show(tally(a, 'priorConfidence')));
  console.log('  coach attribution            :', show(tally(a, 'coachAttribution')));

  const intl = a.filter((x) => x.isInternational);
  const withCountry = a.filter((x) => x.country);
  const withRegion = a.filter((x) => x.region);
  console.log(`\n  international arrivals       : ${intl.length}  (${pct(intl.length, a.length)} of arrivals)`);
  console.log(`  with a known country         : ${withCountry.length}  (${pct(withCountry.length, intl.length)} of internationals)`);
  console.log(`  placed in a region           : ${withRegion.length}  (${pct(withRegion.length, intl.length)} of internationals)`);
  if (withRegion.length) console.log('    regions                    :', show(tally(withRegion, 'region')));

  /**
   * The number a later phase will gate on. A programme with one comparable
   * transition has one intake on file, and one intake is an anecdote — it
   * cannot support a claim about how a programme recruits.
   */
  const dist = {};
  for (const n of r.transitionCounts.values()) dist[n] = (dist[n] || 0) + 1;
  console.log('\n  PROGRAMME COVERAGE — comparable transitions per programme');
  for (const n of Object.keys(dist).sort()) {
    const progs = dist[n];
    console.log(`    ${n} transition(s): ${String(progs).padStart(5)} programmes`
      + `  ${pct(progs, r.byProgramme.size)}`);
  }

  const ambiguous = a.filter((x) => x.priorConfidence === PRIOR_CONFIDENCE.AMBIGUOUS);
  console.log(`\n  remaining identity ambiguity : ${ambiguous.length} arrivals whose prior programme`
    + ' is a name match to more than one school');
}

const results = SPORTS.map(buildSport);
results.forEach(report);

console.log(`\n${REPORT_ONLY ? 'REPORT ONLY — nothing written.' : 'recruiting_arrivals rebuilt.'}`);
console.log('The table is derived from roster_players and can be dropped and rebuilt at any time.\n');
