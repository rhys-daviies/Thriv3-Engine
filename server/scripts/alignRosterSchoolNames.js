#!/usr/bin/env node
/**
 * Rewrites `roster_players.college_name` to the registry's spelling of the
 * school, for rows already imported.
 *
 *   node server/scripts/alignRosterSchoolNames.js            # dry run
 *   node server/scripts/alignRosterSchoolNames.js --apply
 *
 * The importer now resolves these on the way in, so this exists only for rows
 * loaded before it did. It updates one column and touches nothing else, which
 * is why it is a targeted UPDATE rather than a re-import: several scripts write
 * to roster_players after an import (projectRosterMinutes, refreshGraduationYears),
 * and re-importing four seasons to fix a name would discard their work.
 *
 * Every join in the product is `roster_players.college_name = colleges.name`,
 * so a school spelled two ways is a school no feature can read at all.
 */
import db from '../db/client.js';
import { ROSTER_SCHOOL_ALIASES } from '../lib/rosterSchoolAliases.js';

const APPLY = process.argv.includes('--apply');

function main() {
  const count = db.prepare(
    'SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ? AND division = ?',
  );
  const update = db.prepare(
    'UPDATE roster_players SET college_name = ? WHERE college_name = ? AND sport = ? AND division = ?',
  );
  const registryHas = db.prepare(
    'SELECT COUNT(*) n FROM colleges WHERE name = ? AND sport = ?',
  );

  const planned = [];
  const missingTarget = [];
  for (const [scope, table] of Object.entries(ROSTER_SCHOOL_ALIASES)) {
    const [sport, division] = scope.split('|');
    for (const [from, to] of Object.entries(table)) {
      const rows = count.get(from, sport, division).n;
      if (!rows) continue;
      // Renaming onto a school the registry does not hold would move rows from
      // one invisible name to another while looking like a fix.
      if (!registryHas.get(to, sport).n) { missingTarget.push({ from, to, sport, rows }); continue; }
      planned.push({ from, to, sport, division, rows });
    }
  }

  planned.sort((a, b) => b.rows - a.rows);
  const total = planned.reduce((n, p) => n + p.rows, 0);
  console.log(`${planned.length} school name(s), ${total} roster row(s)${APPLY ? '' : ' (dry run)'}`);
  for (const p of planned) {
    console.log(`  ${String(p.rows).padStart(5)}  ${p.from.padEnd(44)} -> ${p.to}`);
  }
  if (missingTarget.length) {
    console.log(`\n!! ${missingTarget.length} alias target(s) are not in colleges — SKIPPED, fix the table:`);
    for (const m of missingTarget) console.log(`   ${m.from} -> ${m.to} (${m.sport}, ${m.rows} rows)`);
  }

  if (!APPLY) { console.log('\nPass --apply to write.'); return; }

  const run = db.transaction((items) => {
    for (const p of items) update.run(p.to, p.from, p.sport, p.division);
  });
  run(planned);
  console.log(`\nUpdated ${total} row(s).`);

  const orphans = db.prepare(`
    SELECT r.division, r.sport, COUNT(DISTINCT r.college_name) names, COUNT(*) rows
    FROM roster_players r
    WHERE NOT EXISTS (SELECT 1 FROM colleges c WHERE c.name = r.college_name AND c.sport = r.sport)
    GROUP BY 1, 2 ORDER BY 4 DESC`).all();
  if (!orphans.length) { console.log('No roster row is left on a school the registry does not hold.'); return; }
  console.log('\nStill unjoined (these need a colleges row, not an alias):');
  for (const o of orphans) console.log(`  ${o.division} ${o.sport}: ${o.names} school(s), ${o.rows} row(s)`);
}

main();
