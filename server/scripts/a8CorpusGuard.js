/**
 * IS THE EVIDENCE THE A8 BASELINE RESTS ON STILL THE EVIDENCE IT WAS?
 *
 * A8.0. V2 reads exactly three tables - `colleges`, `roster_players` and
 * `recruiting_arrivals` - and Phase 7B writes two of them on a database shared
 * by both branches. A8 therefore cannot be validated against "the database";
 * it is validated against a corpus whose identity is stated, and this computes
 * that identity.
 *
 *   node server/scripts/a8CorpusGuard.js
 *   node server/scripts/a8CorpusGuard.js --expect=<supported digest>
 *
 * -- WHY THE DIGEST IS SPLIT ------------------------------------------------
 *
 * A single whole-corpus digest answers the wrong question. It moved when 7B
 * staged 5,004 NJCAA and USCAA roster rows, and a reader would conclude the
 * baseline was invalid - when in fact not one supported-universe cell changed
 * value, state or rank, because no eligibility rule exists for those
 * associations and the engine refuses them either way. A digest that cries
 * wolf is a digest people learn to override.
 *
 * So the identity is taken TWICE, over the two universes separately:
 *
 *   SUPPORTED    the rows a ranking actually rests on. If this moves, the A8
 *                baseline is stale and must be rebuilt. No exceptions.
 *   UNSUPPORTED  the rows for associations V2 holds no rule for. This moves
 *                whenever 7B lands two-year data, and that is expected,
 *                healthy and not a reason to rebuild anything.
 *
 * It is the same lesson as the release-gate digest that tracked the corpus
 * rather than the payload: gate on the thing whose movement would change an
 * answer, not on everything that can move.
 */
import crypto from 'node:crypto';
import { universeOf, UNIVERSE } from '../lib/v2/validationUniverse.js';
import { ROSTER_COLUMNS } from '../lib/v2/poolContext.js';

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

async function main() {
  const { default: db } = await import('../db/client.js');
  const expect = process.argv.slice(2).find((a) => a.startsWith('--expect='))?.split('=')[1] ?? null;
  const d = corpusDigests(db);
  for (const [universe, v] of Object.entries(d)) {
    console.log(`${universe.padEnd(12)} colleges ${String(v.colleges).padStart(5)}  `
      + `roster ${String(v.rosterRows).padStart(6)}  arrivals ${String(v.arrivals).padStart(6)}`);
    console.log(`${''.padEnd(12)} ${v.digest}`);
  }
  if (expect) {
    const ok = d[UNIVERSE.SUPPORTED].digest === expect;
    console.log(ok
      ? '\nSUPPORTED universe unchanged: the A8 baseline still describes this corpus.'
      : `\nSUPPORTED universe MOVED.\n  expected ${expect}\n  actual   ${d[UNIVERSE.SUPPORTED].digest}\n`
        + '  The A8 baseline no longer describes this corpus and must be rebuilt.');
    process.exit(ok ? 0 : 1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('a8CorpusGuard.js')) await main();
