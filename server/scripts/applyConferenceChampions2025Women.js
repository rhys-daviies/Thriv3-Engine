#!/usr/bin/env node
/**
 * Applies the D2/D3/NAIA 2025 women's-soccer conference champion research in
 * populateConferenceChampions2025DataWomen.js. See applyConferenceChampions2025.js
 * (the men's version) for the matching approach this mirrors -- exact name
 * match first, falling back to a light normalization, scoped to
 * {division, sport} rather than the conference the researcher started from.
 *
 * Usage:
 *   node server/scripts/applyConferenceChampions2025Women.js [--apply]
 */
import { College } from '../db/entities/college.js';
import { CHAMPIONS_2025_WOMEN } from './populateConferenceChampions2025DataWomen.js';

const APPLY = process.argv.includes('--apply');

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/university|college|community|technology|institute of|institute|\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMatch(division, sport, championName) {
  const rows = College.filter({ division, sport });
  const exact = rows.filter((r) => r.name.toLowerCase() === championName.toLowerCase());
  if (exact.length > 0) return exact;

  const target = normalize(championName);
  const fuzzy = rows.filter((r) => normalize(r.name) === target);
  return fuzzy;
}

function main() {
  console.log(`${CHAMPIONS_2025_WOMEN.length} women's conference champions to apply${APPLY ? '' : ' (dry run)'}.\n`);

  let matched = 0;
  let unmatched = 0;
  const unmatchedList = [];

  for (const entry of CHAMPIONS_2025_WOMEN) {
    const rows = findMatch(entry.division, entry.sport, entry.champion);
    if (rows.length === 0) {
      unmatched++;
      unmatchedList.push(entry);
      console.log(`NO MATCH  [${entry.division}] ${entry.conference} champion "${entry.champion}" -- no school row found`);
      continue;
    }

    matched++;
    console.log(`OK        [${entry.division}] ${entry.conference.padEnd(18)} -> ${rows[0].name}`);
    if (!APPLY) continue;
    for (const row of rows) {
      College.update(row.id, {
        conference_champion_2025: 1,
        conference_champion_name: entry.conference,
        conference_champion_source: entry.source,
        conference_champion_notes: entry.notes || null,
      });
    }
  }

  console.log(`\nDone. ${matched} matched, ${unmatched} unmatched, out of ${CHAMPIONS_2025_WOMEN.length}.`);
  if (unmatchedList.length > 0) {
    console.log('\nUnmatched champions (not in our database under that division/sport, or a name mismatch worth checking by hand):');
    for (const e of unmatchedList) console.log(`  [${e.division}] ${e.conference}: ${e.champion}`);
  }
  if (!APPLY) console.log('\nDry run only -- re-run with --apply to write these to the database.');
}

main();
