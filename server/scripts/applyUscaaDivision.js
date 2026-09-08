#!/usr/bin/env node
/**
 * Puts the three Penn-State-adjacent women's programmes in the division they
 * actually play in.
 *
 *   node server/scripts/applyUscaaDivision.js            # dry run
 *   node server/scripts/applyUscaaDivision.js --apply
 *
 * The roster CSVs carry no division column — a row's division is the file it
 * sits in — so filing a school under `ncaa_d3_womens_soccer_*` asserts NCAA D3
 * by location alone. Three schools were filed there wrongly, in two different
 * directions:
 *
 *   Penn State Schuylkill  PSUAC, and contested the 2025 USCAA Division II
 *                          national championship. Never NCAA. -> USCAA
 *   Bay Path University    Its own match reports say "in USCAA Soccer Action",
 *                          and it played 0 conference games in every season on
 *                          file. -> USCAA, independent
 *   Penn State Brandywine  Was PSUAC through 2023, but its 2024 and 2025
 *                          conference schedules are entirely United East and
 *                          it played the United East tournament. It IS NCAA D3
 *                          now — the earlier judgement that it was not has
 *                          been overtaken. Reactivated, with the record that
 *                          was missing entirely.
 *
 * The two USCAA rows lose their soccer_score deliberately. Those numbers were
 * produced by mapping onto the NCAA D3 band, so they describe where a school
 * would sit among D3 programmes it does not play. With two USCAA programmes on
 * file there is no distribution to scale within, and soccer_score_v6 now
 * refuses rather than handing one the band floor and the other its ceiling.
 * `programQuality` falls back to its prior on a null, which is the honest
 * answer until the USCAA field is acquired.
 */
import db from '../db/client.js';

const APPLY = process.argv.includes('--apply');

const ROSTER_MOVES = [
  { name: 'Pennsylvania State University-Penn State Schuylkill', sport: 'womens-soccer',
    division: 'USCAA', conference: 'Pennsylvania State University Athletic Conference' },
  { name: 'Bay Path University', sport: 'womens-soccer',
    division: 'USCAA', conference: 'USCAA Independent' },
];

const COLLEGE_EDITS = [
  { name: 'Bay Path University', sport: 'womens-soccer',
    set: { division: 'USCAA', conference: 'USCAA Independent',
           soccer_score: null, national_ranking: null } },
  { name: 'Penn State Brandywine', sport: 'womens-soccer',
    set: { division: 'NCAA D3', conference: 'United East Conference',
           soccer_score: 35.8, national_ranking: 1059, active: 1 } },
];

/** Schuylkill has no row at all — it was refused when it looked like NCAA D3. */
const COLLEGE_CREATE = [
  { name: 'Pennsylvania State University-Penn State Schuylkill', sport: 'womens-soccer',
    division: 'USCAA', conference: 'Pennsylvania State University Athletic Conference' },
];

function main() {
  const count = db.prepare(
    'SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ?');
  const seasons = db.prepare(
    'SELECT DISTINCT season FROM roster_players WHERE college_name = ? AND sport = ? ORDER BY season');
  const college = db.prepare('SELECT * FROM colleges WHERE name = ? AND sport = ?');

  console.log(`roster rows${APPLY ? '' : ' (dry run)'}:`);
  for (const m of ROSTER_MOVES) {
    const n = count.get(m.name, m.sport).n;
    const ss = seasons.all(m.name, m.sport).map((r) => r.season).join(', ');
    console.log(`  ${m.name.slice(0, 50).padEnd(52)} ${n} rows [${ss}] -> ${m.division}`);
  }
  console.log('\ncolleges:');
  for (const e of COLLEGE_EDITS) {
    const c = college.get(e.name, e.sport);
    if (!c) { console.log(`  ${e.name}: NO ROW — skipped`); continue; }
    const changes = Object.entries(e.set)
      .filter(([k, v]) => c[k] !== v)
      .map(([k, v]) => `${k}: ${JSON.stringify(c[k])} -> ${JSON.stringify(v)}`);
    console.log(`  ${e.name.padEnd(52)} ${changes.length ? changes.join(', ') : 'already correct'}`);
  }
  for (const c of COLLEGE_CREATE) {
    console.log(`  ${c.name.slice(0, 50).padEnd(52)} ${college.get(c.name, c.sport) ? 'already exists' : 'CREATE'}`);
  }
  if (!APPLY) { console.log('\nPass --apply to write.'); return; }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const m of ROSTER_MOVES) {
      db.prepare('UPDATE roster_players SET division = ?, conference = ? WHERE college_name = ? AND sport = ?')
        .run(m.division, m.conference, m.name, m.sport);
    }
    for (const e of COLLEGE_EDITS) {
      const c = college.get(e.name, e.sport);
      if (!c) continue;
      const cols = Object.keys(e.set);
      db.prepare(`UPDATE colleges SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_date = ? WHERE id = ?`)
        .run(...cols.map((k) => e.set[k]), now, c.id);
    }
    for (const c of COLLEGE_CREATE) {
      if (college.get(c.name, c.sport)) continue;
      const twinId = db.prepare('SELECT id FROM colleges WHERE name = ? LIMIT 1').get(c.name);
      if (twinId) continue;
      db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division,
        conference, active, notable_majors, academic_rating_source)
        VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, 1, '[]', ?)`)
        .run(now, now, c.name, c.sport, c.division, c.conference,
          'no College Scorecard match for this institution');
    }
  });
  tx();
  console.log('\nwritten');
}

main();
