#!/usr/bin/env node
/**
 * Which programme-seasons cannot have their performance column read, and
 * whether the ones that can add up to a season somebody played.
 *
 * A diagnostic, not a gate. `performanceUnreadableSeasons` is the production
 * rule and it runs at every read boundary; this script exists so the rule can
 * be watched — the fabricated seasons are an artefact of one acquisition run,
 * and the next run can produce more of them without anything failing.
 *
 * The team-minute ratio is the independent check. Eleven players for ninety
 * minutes is what a match contains, so a season's published minutes have a
 * size they must be near, and that size is derived from nothing this codebase
 * computes. Where it disagrees with the readability rule, one of the two is
 * wrong and it is worth knowing which.
 *
 *   npm run audit:performance
 *   npm run audit:performance -- --sport womens-soccer --list
 */
import db from '../db/client.js';
import {
  performanceUnreadableSeasons, teamMinuteRatio, teamMinutesArePlausible,
  programmeSeasonKey, MIN_SOURCE_ROSTER,
} from '../../shared/performanceSource.js';
import { minutesAreMissing } from '../../shared/freshmanMinutes.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const SPORTS = flag('sport') ? [flag('sport')] : ['mens-soccer', 'womens-soccer'];
const LIST = args.includes('--list');
/** 2026 carries no minutes by design and is not a season this can judge. */
const MEASURED = ['2022', '2023', '2024', '2025'];

const select = db.prepare(`SELECT college_name, sport, division, season, player_name,
  class_year_label, minutes_played, games_played, games_started, notes
  FROM roster_players WHERE sport = ? AND season IN (${MEASURED.map(() => '?').join(',')})`);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');

let worstCase = 0;
for (const sport of SPORTS) {
  const raw = select.all(sport, ...MEASURED).map((r) => ({ ...r, season: String(r.season) }));
  if (!raw.length) { console.log(`\n${sport}: no rows on file`); continue; }

  // The row rule first and the source rule second, which is the order
  // `readableRows` runs them in. Running `readableRows` itself here would
  // answer nothing: it has already applied the source rule, so asking the
  // source rule again would find every offending season blanked and report
  // none of them.
  const rows = raw.map((r) => (minutesAreMissing(r) ? { ...r, minutes_played: null } : { ...r }));
  const unreadable = performanceUnreadableSeasons(rows);

  const bySeason = new Map();
  const byDivision = new Map();
  const ratios = [];
  const disagreements = [];
  let assumed = 0;

  const groups = new Map();
  for (const r of rows) {
    const key = programmeSeasonKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
    if (/Assumed 0 minutes/.test(r.notes ?? '')) assumed += 1;
  }

  for (const [key, group] of groups) {
    const [, , season] = key.split('|');
    const division = group[0].division ?? 'unknown';
    if (unreadable.has(key)) {
      bySeason.set(season, (bySeason.get(season) ?? 0) + 1);
      byDivision.set(division, (byDivision.get(division) ?? 0) + 1);
      if (LIST) console.log(`  UNREADABLE  ${key}  roster ${group.length}  division ${division}`);
      continue;
    }
    if (group.length < MIN_SOURCE_ROSTER) continue;
    const measured = group.filter((r) => r.minutes_played != null);
    if (measured.length / group.length < 0.5) continue;
    const ratio = teamMinuteRatio(group);
    if (ratio == null) continue;
    ratios.push(ratio);
    if (teamMinutesArePlausible(ratio) === false) {
      disagreements.push({ key, ratio, roster: group.length });
    }
  }

  const sorted = [...ratios].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const inBand = ratios.filter((r) => teamMinutesArePlausible(r)).length;

  console.log(`\n=== ${sport} ===`);
  console.log(`  rows carrying the assumed-zero note: ${assumed}`);
  console.log(`  programme-seasons ruled PERFORMANCE_UNREADABLE: ${unreadable.size} of ${groups.size} (${pct(unreadable.size, groups.size)})`);
  console.log(`    by season:   ${[...bySeason.entries()].sort().map(([s, n]) => `${s}:${n}`).join('  ') || 'none'}`);
  console.log(`    by division: ${[...byDivision.entries()].sort().map(([d, n]) => `${d}:${n}`).join('  ') || 'none'}`);
  console.log(`  team-minute ratio over the readable ones (n=${ratios.length}): p10 ${q(0.1)?.toFixed(2)}  median ${q(0.5)?.toFixed(2)}  p90 ${q(0.9)?.toFixed(2)}`);
  console.log(`    inside ${'0.85–1.15'}: ${inBand} (${pct(inBand, ratios.length)})`);
  console.log(`  readable seasons the invariant still doubts: ${disagreements.length}`);
  for (const d of disagreements.sort((a, b) => a.ratio - b.ratio).slice(0, 12)) {
    console.log(`    ${d.key.padEnd(56)} ratio ${d.ratio.toFixed(2)}  roster ${d.roster}`);
  }
  worstCase = Math.max(worstCase, disagreements.length);
}

console.log('\nA season named UNREADABLE keeps its stored rows; the decision is taken at read time.');
