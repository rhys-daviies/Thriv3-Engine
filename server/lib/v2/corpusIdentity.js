/**
 * WHICH DATA V2 ACTUALLY READS, AS AN IDENTITY.
 *
 * A9.1 moved this out of `server/scripts/a8CorpusGuard.js` without changing a
 * line of the computation, so the validation guard and the production service
 * share one definition of "the corpus". The script keeps its CLI and re-exports
 * from here; every digest it has ever printed still reproduces.
 *
 * -- WHAT CONTRIBUTES, AND WHAT DELIBERATELY DOES NOT ----------------------
 *
 * Exactly the three tables `buildPoolContext` reads, and only the columns it
 * selects:
 *
 *   colleges            every column, for active programmes of the sport
 *   roster_players      the columns named in ROSTER_COLUMNS, for the season
 *   recruiting_arrivals programme, sport, arrival_season, canonical_position,
 *                       is_international
 *
 * `coaches`, `athletics_domains`, `programme_membership_periods` and the
 * `refresh_*` ledger are NOT included, because V2 does not read them. Phase 7B
 * writes coach data continuously, and a cache that invalidated on a coach edit
 * would rebuild a 939ms context for data no layer can see.
 *
 * The identity is taken TWICE, split by universe, for the reason A8.0 found:
 * 7B's staged work lands in NJCAA and USCAA, and a single whole-corpus digest
 * would report a scoring-relevant change every time two-year data arrived when
 * not one supported cell had moved.
 */
import crypto from 'node:crypto';
import { universeOf, UNIVERSE } from './validationUniverse.js';
import { ROSTER_COLUMNS } from './poolContext.js';

export const GUARD_SEASON = '2026';

const SPORTS = Object.freeze(['mens-soccer', 'womens-soccer']);

/**
 * The columns `buildPoolContext` actually selects from `roster_players`,
 * read off that constant rather than copied, so a column added to the pool
 * context cannot be left out of the thing that guards it.
 */
const rosterCols = ROSTER_COLUMNS.split(',').map((s) => s.trim()).filter(Boolean);

function hashRows(rows) {
  const h = crypto.createHash('sha256');
  for (const r of rows) h.update(JSON.stringify(r));
  return h.digest('hex');
}

export function corpusDigests(db, { season = GUARD_SEASON } = {}) {
  const out = {};
  for (const universe of [UNIVERSE.SUPPORTED, UNIVERSE.UNSUPPORTED]) {
    const colleges = []; const roster = []; const arrivals = [];
    for (const sport of SPORTS) {
      const all = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1 ORDER BY id').all(sport);
      const keep = new Set();
      for (const c of all) {
        if (universeOf({ division: c.division, season: Number(season) }) !== universe) continue;
        keep.add(c.name);
        colleges.push(c);
      }
      const rr = db.prepare(
        `SELECT ${rosterCols.join(', ')} FROM roster_players WHERE sport = ? AND season = ?
          ORDER BY college_name, player_name, position`,
      ).all(sport, season);
      for (const r of rr) if (keep.has(r.college_name)) roster.push(r);
      const ar = db.prepare(
        `SELECT programme, sport, arrival_season, canonical_position, is_international
           FROM recruiting_arrivals WHERE sport = ? ORDER BY programme, arrival_season, canonical_position`,
      ).all(sport);
      for (const a of ar) if (keep.has(a.programme)) arrivals.push(a);
    }
    out[universe] = {
      digest: hashRows([...colleges, ...roster, ...arrivals]),
      colleges: colleges.length,
      rosterRows: roster.length,
      arrivals: arrivals.length,
    };
  }
  return out;
}
