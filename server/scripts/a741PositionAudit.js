/**
 * A7.41: why 1,756 roster rows carry no readable position, and whether it
 * reaches the ranking.
 *
 *   node server/scripts/a741PositionAudit.js --out=docs/validation/A7.41-position-audit.json
 *
 * READ-ONLY. Writes one JSON file and touches no database row.
 *
 * -- THE DISTINCTION THIS SCRIPT EXISTS TO MAKE ----------------------------
 *
 * PREVALENCE IS NOT CONSEQUENCE. 1,756 rows is 2.8% of the roster, and the
 * number that matters is different: how many programme-position cells carry
 * doubt the scorer is never told about, and how many of those score a
 * confident zero anyway. The second number is two orders of magnitude smaller
 * and is the only one a ranking can feel.
 */
import fs from 'node:fs';
import db from '../db/client.js';
import { canonicalPosition, POSITIONS } from '../../shared/positions.js';
import { assessFieldCoverage, ACQUISITION_SIGNAL } from '../../shared/rosterAcquisitionGuard.js';
import { buildPositionIndex, returningDepthFor } from '../lib/v2/rosterEvidence.js';
import { ROSTER_COLUMNS } from '../lib/v2/poolContext.js';
import { returningCompetition, typicalStarters, isScoreable } from '../../shared/matching/v2/index.js';
import { maxAttainableLastSeason } from '../../shared/eligibility.js';

const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const SEASON = arg('season', '2026');
const ENTRY = Number(arg('entry', '2027'));
const SPORTS = ['mens-soccer', 'womens-soccer'];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

export function auditPositions({ season = SEASON, entryYear = ENTRY } = {}) {
  const out = {};
  for (const sport of SPORTS) {
    const rows = db.prepare(`SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport = ? AND season = ?`).all(sport, season);
    const idx = buildPositionIndex(rows);
    const divOf = new Map(rows.map((r) => [r.college_name, r.division]));

    /** Category A vs B, kept apart because they have different owners. */
    let absent = 0; let rejected = 0; let readable = 0;
    const rawValues = new Map();
    const unreadableByProgramme = new Map();
    for (const r of rows) {
      const raw = r.position;
      if (raw === null || String(raw).trim() === '') { absent += 1; } else if (canonicalPosition(raw) === 'UNKNOWN') {
        rejected += 1;
        rawValues.set(String(raw), (rawValues.get(String(raw)) || 0) + 1);
        unreadableByProgramme.set(r.college_name, (unreadableByProgramme.get(r.college_name) || 0) + 1);
      } else readable += 1;
    }

    /** The A7.40 guard, unchanged, pointed at `position`. */
    const guard = { CATASTROPHIC_FIELD_LOSS: [], FIELD_COVERAGE_DROP: [], OK: 0, NO_BASELINE: 0 };
    for (const programme of unreadableByProgramme.keys()) {
      const cur = db.prepare(
        `SELECT COUNT(*) rows, SUM(CASE WHEN position IS NOT NULL AND UPPER(position) <> 'UNKNOWN' THEN 1 ELSE 0 END) populated
           FROM roster_players WHERE sport = ? AND college_name = ? AND season = ?`).get(sport, programme, season);
      const history = db.prepare(
        `SELECT season, COUNT(*) rows, SUM(CASE WHEN position IS NOT NULL AND UPPER(position) <> 'UNKNOWN' THEN 1 ELSE 0 END) populated
           FROM roster_players WHERE sport = ? AND college_name = ? AND season <> ? GROUP BY season`).all(sport, programme, season);
      const r = assessFieldCoverage({ rows: cur.rows, populated: cur.populated, history });
      if (r.signal === ACQUISITION_SIGNAL.OK || r.signal === ACQUISITION_SIGNAL.NO_BASELINE) { guard[r.signal] += 1; continue; }
      /**
       * THE DISCRIMINATOR THAT TURNED THIS PHASE. A programme flagged for
       * losing its position field may have lost the field - or may have been
       * given a DIFFERENT SQUAD altogether. A genuine new roster repeats a
       * substantial share of last season's names; a wrong one repeats none.
       */
      const now = new Set(db.prepare('SELECT player_name FROM roster_players WHERE sport = ? AND college_name = ? AND season = ?')
        .all(sport, programme, season).map((x) => norm(x.player_name)));
      const prior = new Set(db.prepare('SELECT player_name FROM roster_players WHERE sport = ? AND college_name = ? AND season = ?')
        .all(sport, programme, String(Number(season) - 1)).map((x) => norm(x.player_name)));
      const overlap = prior.size ? [...now].filter((x) => prior.has(x)).length / prior.size : null;
      guard[r.signal].push({
        programme, rows: cur.rows, positioned: cur.populated, priorSquad: prior.size,
        nameOverlapWithPriorSeason: overlap === null ? null : Number(overlap.toFixed(3)),
        reading: overlap === null ? 'NO_BASELINE'
          : overlap === 0 ? 'DIFFERENT_SQUAD_SUSPECTED' : overlap < 0.15 ? 'SUSPECT' : 'PLAUSIBLE_CONTINUATION',
      });
    }

    /**
     * Consequence. A programme-level unreadable row is a gap in EVERY one of
     * that programme's position cells, and the scorer is told about none of it.
     */
    let cells = 0; let cellsInAffected = 0;
    for (const [, p] of idx) { cells += p.positions.size; if (p.unreadable > 0) cellsInAffected += p.positions.size; }

    let measuredZero = 0; let measuredZeroExposed = 0; let unaccounted = 0;
    for (const [programme, p] of idx) {
      const pu = unreadableByProgramme.get(programme) || 0;
      for (const position of POSITIONS) {
        const bucket = p.positions.get(position);
        if (!bucket || !bucket.rows) continue;
        const c = returningCompetition({
          returning: returningDepthFor(bucket, entryYear), position, places: typicalStarters(sport, position),
          rosterOnFile: true, eligibilityRuled: true, positionRows: bucket.rows, unreadable: bucket.unreadable,
          entryYear, rosterSeason: Number(season),
          maxLastSeason: maxAttainableLastSeason({ season: Number(season), division: divOf.get(programme) }),
        });
        if (!isScoreable(c) || c.value !== 1 || c.grade !== 'MEASURED') continue;
        measuredZero += 1;
        if (pu > 0) { measuredZeroExposed += 1; unaccounted += pu; }
      }
    }

    out[sport] = {
      rows: rows.length, readable, categoryA_absent: absent, categoryB_presentButRejected: rejected,
      distinctRejectedValues: [...rawValues.entries()].map(([value, n]) => ({ value, rows: n })),
      programmesAffected: unreadableByProgramme.size,
      guard: {
        catastrophic: guard.CATASTROPHIC_FIELD_LOSS.sort((a, b) => (a.nameOverlapWithPriorSeason ?? 9) - (b.nameOverlapWithPriorSeason ?? 9)),
        drop: guard.FIELD_COVERAGE_DROP.length,
        ok: guard.OK, noBaseline: guard.NO_BASELINE,
      },
      consequence: {
        entryYear,
        programmePositionCells: cells,
        cellsInProgrammesCarryingUnreadableRows: cellsInAffected,
        measuredZeroReturnerCells: measuredZero,
        measuredZeroCellsExposedToUnreadablePositions: measuredZeroExposed,
        unaccountedPlayersBehindThoseCells: unaccounted,
      },
    };
  }
  return out;
}

if (arg('out')) {
  const result = auditPositions();
  fs.writeFileSync(arg('out'), JSON.stringify({ phase: 'A7.41', season: SEASON, entryYear: ENTRY, sports: result }, null, 1));
  for (const [sport, r] of Object.entries(result)) {
    console.log(`${sport}: rejected ${r.categoryB_presentButRejected} (absent ${r.categoryA_absent}) across ${r.programmesAffected} programmes`);
    console.log(`   guard: catastrophic ${r.guard.catastrophic.length}, drop ${r.guard.drop}, ok ${r.guard.ok}`);
    console.log(`   consequence: ${r.consequence.measuredZeroCellsExposedToUnreadablePositions}/${r.consequence.measuredZeroReturnerCells} measured-zero cells exposed`);
  }
  console.log('written', arg('out'));
}
