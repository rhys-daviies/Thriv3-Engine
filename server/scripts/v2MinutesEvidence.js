/**
 * A7.7.2: how much starter evidence actually exists, and where a truthful
 * refusal rule would fall.
 *
 * READ-ONLY. It classifies; it changes nothing.
 *
 *   node server/scripts/v2MinutesEvidence.js --coverage
 *   node server/scripts/v2MinutesEvidence.js --thresholds
 *   node server/scripts/v2MinutesEvidence.js --tiers
 */
import db from '../db/client.js';
import { canonicalPosition } from '../../shared/positions.js';
import {
  buildPositionIndex, positionEvidence, starterState, STARTER_STATE,
} from '../lib/v2/rosterEvidence.js';

const SEASON = '2026';
const ENTRY = 2028;
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');

const load = (sport) => {
  const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
  const roster = db.prepare(`
    SELECT college_name, player_name, position, minutes_played, projected_minutes,
           games_played, games_started, projected_games_started, projected_games_played,
           estimated_graduation_year, eligibility_end_year, country, season, division, class_year_label
      FROM roster_players WHERE sport = ? AND season = ?`).all(sport, SEASON);
  return { colleges, roster, rosterIndex: buildPositionIndex(roster) };
};

/**
 * Why a row cannot be classified. The buckets the brief asks for, decided by
 * what the row and its prior season actually carry rather than by guesswork.
 */
function missingCause(row, priorByKey) {
  if (starterState(row) !== STARTER_STATE.UNKNOWN) return null;
  const key = `${row.college_name}|${String(row.player_name || '').toLowerCase().replace(/[^a-z]/g, '')}`;
  const prior = priorByKey.get(key);
  if (!prior) return 'STRUCTURALLY_UNAVAILABLE_NEWCOMER';
  if (prior.minutes_played === null && prior.games_started === null) return 'SOURCE_MISSING_PRIOR_SEASON';
  return 'PROJECTION_MISSING';
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('Usage: v2MinutesEvidence.js [--coverage] [--thresholds] [--tiers]'); process.exit(2); }

  for (const sport of ['mens-soccer', 'womens-soccer']) {
    const { colleges, roster, rosterIndex } = load(sport);
    const priorRows = db.prepare(`
      SELECT college_name, player_name, minutes_played, games_started
        FROM roster_players WHERE sport = ? AND season = '2025'`).all(sport);
    const priorByKey = new Map(priorRows.map((r) => [
      `${r.college_name}|${String(r.player_name || '').toLowerCase().replace(/[^a-z]/g, '')}`, r]));

    if (args.includes('--coverage')) {
      console.log(`\n== ROW-LEVEL STARTER EVIDENCE — ${sport}, season ${SEASON} ==`);
      const byDiv = {};
      for (const row of roster) {
        const d = row.division || '?';
        byDiv[d] ??= { rows: 0, mp: 0, gs: 0, pm: 0, pgs: 0, starter: 0, squad: 0, unknown: 0, causes: {} };
        const b = byDiv[d];
        b.rows += 1;
        if (row.minutes_played !== null) b.mp += 1;
        if (row.games_started !== null) b.gs += 1;
        if (row.projected_minutes !== null) b.pm += 1;
        if (row.projected_games_started !== null) b.pgs += 1;
        const st = starterState(row);
        if (st === STARTER_STATE.STARTER) b.starter += 1;
        else if (st === STARTER_STATE.SQUAD) b.squad += 1;
        else {
          b.unknown += 1;
          const c = missingCause(row, priorByKey);
          b.causes[c] = (b.causes[c] || 0) + 1;
        }
      }
      console.log(`  ${'division'.padEnd(10)}${'rows'.padStart(7)}${'mins'.padStart(8)}${'starts'.padStart(8)}${'projMin'.padStart(9)}${'projSt'.padStart(8)}${'STARTER'.padStart(9)}${'SQUAD'.padStart(8)}${'UNKNOWN'.padStart(9)}  classified`);
      for (const [d, b] of Object.entries(byDiv).sort()) {
        console.log(`  ${d.padEnd(10)}${String(b.rows).padStart(7)}${String(b.mp).padStart(8)}${String(b.gs).padStart(8)}${String(b.pm).padStart(9)}${String(b.pgs).padStart(8)}${String(b.starter).padStart(9)}${String(b.squad).padStart(8)}${String(b.unknown).padStart(9)}  ${pct(b.starter + b.squad, b.rows)}`);
      }
      console.log('  why a row is UNKNOWN:');
      for (const [d, b] of Object.entries(byDiv).sort()) {
        const parts = Object.entries(b.causes).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${v}`);
        console.log(`    ${d.padEnd(10)} ${parts.join('  ') || '—'}`);
      }
    }

    if (args.includes('--thresholds') || args.includes('--tiers')) {
      /**
       * The departing cohort is the only group `vacatedStarters` counts, so
       * its coverage is the only coverage that decides whether a zero there
       * means anything. A whole-roster figure would be dominated by freshmen,
       * who cannot have prior minutes and never vacate a place.
       */
      const cells = [];
      for (const c of colleges) {
        for (const position of POSITIONS) {
          const ev = positionEvidence({
            programme: c.name, position, sport, division: c.division, entryYear: ENTRY,
            rosterIndex, arrivalIndex: null, arrivalsHorizon: 2026,
          });
          if (!ev.rosterOnFile || !ev.eligibilityRuled || !ev.positionRows) continue;
          const se = ev.starterEvidence;
          cells.push({
            division: c.division, position, sport,
            departing: se.departing, departingUnknown: se.departingUnknown,
            departingKnown: se.departing - se.departingUnknown,
            positionRows: se.positionRows, classified: se.classified,
            vacated: ev.vacatedStarters,
          });
        }
      }
      if (args.includes('--thresholds')) {
        console.log(`\n== EVIDENCE SUFFICIENCY CANDIDATES — ${sport} (${cells.length} programme-position cells with a readable roster) ==`);
        const zero = cells.filter((x) => x.vacated === 0);
        console.log(`  cells scoring a zero today: ${zero.length} (${pct(zero.length, cells.length)})`);
        console.log(`    of those, departing cohort EMPTY (a true zero, nothing to classify): ${zero.filter((x) => x.departing === 0).length}`);
        console.log(`    of those, departing cohort FULLY classified (a measured zero):       ${zero.filter((x) => x.departing > 0 && x.departingUnknown === 0).length}`);
        console.log(`    of those, departing cohort PARTLY classified:                        ${zero.filter((x) => x.departing > 0 && x.departingUnknown > 0 && x.departingKnown > 0).length}`);
        console.log(`    of those, departing cohort ENTIRELY unclassified (a silence):        ${zero.filter((x) => x.departing > 0 && x.departingKnown === 0).length}`);
        console.log('');
        console.log(`  ${'rule'.padEnd(44)}${'MEASURED'.padStart(10)}${'PARTIAL'.padStart(9)}${'UNSCOREABLE'.padStart(13)}${'false-zero risk'.padStart(17)}`);
        const rules = [
          ['R-a  any departing row classified', (x) => (x.departing === 0 ? 'M' : x.departingKnown > 0 ? 'M' : 'U')],
          ['R-b  all departing rows classified', (x) => (x.departing === 0 ? 'M' : x.departingUnknown === 0 ? 'M' : x.departingKnown > 0 ? 'P' : 'U')],
          ['R-c  >= half the departing cohort', (x) => (x.departing === 0 ? 'M' : x.departingKnown >= x.departing / 2 ? 'M' : x.departingKnown > 0 ? 'P' : 'U')],
          ['R-d  all departing + >= half the position', (x) => (x.departing === 0 ? (x.classified >= x.positionRows / 2 ? 'M' : 'U') : x.departingUnknown === 0 ? 'M' : x.departingKnown > 0 ? 'P' : 'U')],
          ['R-e  current rule (everything MEASURED)', () => 'M'],
        ];
        for (const [label, fn] of rules) {
          const t = { M: 0, P: 0, U: 0 };
          let falseZero = 0;
          for (const x of cells) {
            const s = fn(x); t[s] += 1;
            // A cell that scores zero, is called MEASURED, and rests on a
            // departing cohort nobody could classify.
            if (s === 'M' && x.vacated === 0 && x.departing > 0 && x.departingKnown === 0) falseZero += 1;
          }
          console.log(`  ${label.padEnd(44)}${String(t.M).padStart(10)}${String(t.P).padStart(9)}${String(t.U).padStart(13)}${String(falseZero).padStart(17)}`);
        }
        console.log('');
        console.log('  by position, under R-b (all departing rows classified):');
        console.log(`    ${'position'.padEnd(12)}${'cells'.padStart(7)}${'MEASURED'.padStart(10)}${'PARTIAL'.padStart(9)}${'UNSCOREABLE'.padStart(13)}`);
        for (const position of POSITIONS) {
          const sub = cells.filter((x) => x.position === position);
          const t = { M: 0, P: 0, U: 0 };
          for (const x of sub) {
            t[x.departing === 0 ? 'M' : x.departingUnknown === 0 ? 'M' : x.departingKnown > 0 ? 'P' : 'U'] += 1;
          }
          console.log(`    ${position.padEnd(12)}${String(sub.length).padStart(7)}${String(t.M).padStart(10)}${String(t.P).padStart(9)}${String(t.U).padStart(13)}`);
        }
        console.log('  by division, under R-b:');
        for (const d of [...new Set(cells.map((x) => x.division))].sort()) {
          const sub = cells.filter((x) => x.division === d);
          const t = { M: 0, P: 0, U: 0 };
          for (const x of sub) {
            t[x.departing === 0 ? 'M' : x.departingUnknown === 0 ? 'M' : x.departingKnown > 0 ? 'P' : 'U'] += 1;
          }
          console.log(`    ${d.padEnd(12)}${String(sub.length).padStart(7)}${String(t.M).padStart(10)}${String(t.P).padStart(9)}${String(t.U).padStart(13)}`);
        }
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
