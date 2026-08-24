#!/usr/bin/env node
/**
 * Applies the D2/D3/NAIA/NJCAA 2025 conference champion research in
 * populateConferenceChampions2025.data.js (gathered by parallel research
 * agents doing per-conference web searches, since Wikipedia only documents
 * this at conference granularity for D1 -- see that file's header and
 * populateConferenceChampions2025.js for the D1 case).
 *
 * Matches each entry's `champion` name against every school in the given
 * `division` by name (exact match, falling back to a light normalization
 * for common suffix differences) -- NOT scoped to the conference the
 * researcher started from, since our own `conference` field can be stale
 * after realignment and the champion may be a real member we didn't
 * happen to list as a disambiguation sample.
 *
 * Usage:
 *   node server/scripts/applyConferenceChampions2025.js [--apply]
 */
import { College } from '../db/entities/college.js';
import { CHAMPIONS_2025 } from './populateConferenceChampions2025.data.js';

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
  console.log(`${CHAMPIONS_2025.length} conference champions to apply${APPLY ? '' : ' (dry run)'}.\n`);

  let matched = 0;
  let unmatched = 0;
  const unmatchedList = [];

  for (const entry of CHAMPIONS_2025) {
    const rows = findMatch(entry.division, entry.sport || 'mens-soccer', entry.champion);
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

  console.log(`\nDone. ${matched} matched, ${unmatched} unmatched, out of ${CHAMPIONS_2025.length}.`);
  if (unmatchedList.length > 0) {
    console.log('\nUnmatched champions (not in our database under that division, or a name mismatch worth checking by hand):');
    for (const e of unmatchedList) console.log(`  [${e.division}] ${e.conference}: ${e.champion}`);
  }
  if (!APPLY) console.log('\nDry run only -- re-run with --apply to write these to the database.');
}

main();
