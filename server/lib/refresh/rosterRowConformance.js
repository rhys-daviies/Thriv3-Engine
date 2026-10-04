/**
 * ROSTER ROW CONFORMANCE — Phase 8B.2.
 *
 * `applyOp` INSERT_ROSTER_ROW writes the staged `proposed_json` into `roster_players`. That proposal
 * is built from a gathered page, and it is NOT shaped like the rows the established importer
 * (`importRosterSheets.js`) writes. Left as-is, every roster batch promoted through
 * `integrity:promote` would store:
 *
 *   minutes_played     the column is `DEFAULT 0` and the proposal omits it, so a player whose season has
 *                      not been played gets a recorded ZERO. (The importer writes NULL when blank.)
 *   source_page_season a bound JS number in a TEXT column is stored as "2026.0"; the importer and every
 *                      existing row hold '2026'.
 *   data_confidence    the classifier says 'High'; the importer normalises to high|medium|low.
 *   position           absent -> NULL here; the importer and the table use the sentinel 'UNKNOWN'.
 *   nationality        some pages put a COUNTRY NAME there; the table's convention is nationality in
 *                      {USA, International} with the name in `country`.
 *
 * This is a pure function so the same rule is applied by the promoter, the fixture builder and the
 * tests. It never invents a value: unknown stays NULL, and a country it cannot place is left NULL
 * rather than guessed.
 */
import { canonicalCountry, regionOf } from '../../../shared/recruiting/regions.js';

const CONFIDENCE = new Set(['high', 'medium', 'low']);
const US = /^(united states( of america)?|u\.?s\.?a\.?|us)$/i;
const textOrNull = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

/** nationality -> { nationality, country } under the table's convention. */
export function conformNationality(nationality, country) {
  const c = textOrNull(country);
  const v = textOrNull(nationality);
  if (c !== null) return { nationality: v === 'USA' || v === 'International' ? v : 'International', country: c };
  if (v === null || v === 'USA' || v === 'International') return { nationality: v, country: null };
  if (US.test(v)) return { nationality: 'USA', country: null };
  const named = canonicalCountry(v);
  if (named && regionOf(named)) return { nationality: 'International', country: named };
  return { nationality: null, country: null };   // a name we cannot place is not guessed
}

/** A roster row, conformed to the table's conventions. Does not mutate its input. */
export function conformRosterRow(row) {
  const nat = conformNationality(row.nationality, row.country);
  const conf = String(row.data_confidence ?? '').trim().toLowerCase();
  return {
    ...row,
    season: row.season == null ? row.season : String(row.season),
    source_page_season: row.source_page_season == null ? null : String(row.source_page_season),
    minutes_played: row.minutes_played ?? null,
    games_played: row.games_played ?? null,
    games_started: row.games_started ?? null,
    position: textOrNull(row.position) ?? 'UNKNOWN',
    data_confidence: CONFIDENCE.has(conf) ? conf : 'medium',
    nationality: nat.nationality,
    country: nat.country,
  };
}
