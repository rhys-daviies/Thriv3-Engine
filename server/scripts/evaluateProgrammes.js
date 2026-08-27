#!/usr/bin/env node
/**
 * What kind of programme is this, and which of its seasons still describe it?
 *
 * Joins the freshman-minutes series to the coaching history and reports the
 * verdict for every programme, plus what the verdicts look like across the
 * pool. Read-only.
 *
 *   node server/scripts/evaluateProgrammes.js
 *   node server/scripts/evaluateProgrammes.js --school "Bentley" --sport womens-soccer
 *   node server/scripts/evaluateProgrammes.js --verdict regime-change --limit 20
 */
import db from '../db/client.js';
import { freshmanProfile, classifyProgramme, weightsFromVerdict, ladderByRank } from '../../shared/freshmanMinutes.js';
import { tenureFor } from '../../shared/coachTenure.js';

const SEASONS = ['2022', '2023', '2024', '2025'];
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ONLY_SCHOOL = arg('school');
const ONLY_SPORT = arg('sport');
const ONLY_VERDICT = arg('verdict');
const LIMIT = Number(arg('limit', 12));

function load() {
  const roster = db.prepare(`
    SELECT college_name, sport, season, player_name, position, minutes_played,
           games_played, games_started, class_year_label
    FROM roster_players WHERE season IN ('2022','2023','2024','2025')
  `).all();
  const byProg = new Map();
  for (const r of roster) {
    const k = `${r.college_name}||${r.sport}`;
    if (!byProg.has(k)) byProg.set(k, []);
    byProg.get(k).push({ ...r, season: String(r.season) });
  }

  const coaches = new Map();
  for (const r of db.prepare('SELECT school, sport, season, coach_name FROM coach_seasons').all()) {
    const k = `${r.school}||${r.sport}`;
    if (!coaches.has(k)) coaches.set(k, []);
    coaches.get(k).push({ season: r.season, coach_name: r.coach_name || '' });
  }
  return { byProg, coaches };
}

function main() {
  const { byProg, coaches } = load();
  const results = [];

  for (const [k, rows] of byProg) {
    const [school, sport] = k.split('||');
    if (ONLY_SCHOOL && school !== ONLY_SCHOOL) continue;
    if (ONLY_SPORT && sport !== ONLY_SPORT) continue;

    const profile = freshmanProfile(rows, { seasons: SEASONS });
    if (!profile) continue;
    const tenure = tenureFor(coaches.get(k) || []);
    const verdict = classifyProgramme(profile, tenure);
    if (!verdict) continue;

    // The projection a recruit reads, re-cut so it describes the programme
    // they would actually join rather than the one a previous coach ran.
    const weights = weightsFromVerdict(verdict, profile.seasons);
    const plain = ladderByRank(profile.seasons, { maxRank: 3 });
    const weighted = weights ? ladderByRank(profile.seasons, { maxRank: 3, weights }) : plain;

    results.push({ school, sport, verdict, tenure, profile, plain, weighted });
  }

  const counts = {};
  let moved = 0;
  let movedBy = 0;
  for (const r of results) {
    counts[r.verdict.verdict] = (counts[r.verdict.verdict] || 0) + 1;
    const a = r.plain[0]?.median ?? null;
    const b = r.weighted[0]?.median ?? null;
    if (a !== null && b !== null && a !== b) { moved += 1; movedBy += Math.abs(b - a); }
  }

  if (!ONLY_SCHOOL && !ONLY_VERDICT) {
    console.log(`\n${results.length} programmes evaluated\n`);
    for (const [v, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${v.padEnd(28)} ${String(n).padStart(4)}  ${String(Math.round(100 * n / results.length)).padStart(3)}%`);
    }
    console.log(`\n  weighting moved the top-freshman projection at ${moved} programmes`);
    if (moved) console.log(`  average move where it did: ${Math.round(movedBy / moved)} minutes`);
  }

  const show = results
    .filter((r) => !ONLY_VERDICT || r.verdict.verdict === ONLY_VERDICT)
    .sort((a, b) => Math.abs(b.verdict.step ?? 0) - Math.abs(a.verdict.step ?? 0))
    .slice(0, ONLY_SCHOOL ? results.length : LIMIT);

  if (show.length) console.log('\n── programmes ──');
  for (const r of show) {
    const seq = (r.tenure?.segments || []).map((s) => `${s.coach} ${s.from}-${s.to}`).join(' → ') || 'no coach on file';
    const shares = r.profile.seasons.map((s) => `${Math.round((s.shareOfSquadMinutes ?? 0) * 100)}%`).join(' ');
    console.log(`\n  ${r.school} — ${r.sport.replace('-soccer', '')}`);
    console.log(`    freshman share  ${shares}`);
    console.log(`    coaches         ${seq}`);
    console.log(`    verdict         ${r.verdict.verdict}`);
    console.log(`    ${r.verdict.note}`);
    const a = r.plain[0]?.median, b = r.weighted[0]?.median;
    if (a != null) {
      console.log(`    best freshman   ${a} min` + (b != null && b !== a ? `  →  ${b} min once weighted` : ''));
    }
  }
  console.log();
}

main();
