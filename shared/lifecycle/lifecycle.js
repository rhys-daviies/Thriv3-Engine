/**
 * Track A — a player's observed history at a programme.
 *
 * One rule runs through this whole layer and it is the reason the layer
 * exists: `null` is not zero. 12.2% of men's roster rows carry a stored zero
 * and 14.7% carry no minutes at all in a season that was played, and those are
 * different facts. A player who appeared and did not play is not a player
 * whose programme never published a number, and every function here keeps them
 * apart.
 *
 * The model is OBSERVED history only. It carries what the rosters say and
 * nothing derived from absence: a season with no row is a season with no row,
 * not a zero and not a departure. What absence means is Track C's question.
 *
 * Identity uses the primitives the rest of the codebase already uses —
 * `cleanRosterName` then `nameKey` — so a player joins to themselves here the
 * same way they join in `shared/recruiting/arrivals.js` and in the philosophy
 * model. A parallel normalisation would silently produce a different set of
 * people.
 */
import { nameKey } from '../philosophy.js';
import { canonicalPosition } from '../positions.js';
import { cleanRosterName } from '../../server/lib/rosterName.js';

/** Minutes that count as a starter's season, shared with the philosophy model. */
export const STARTER_MINUTES = 600;

/** The role a season's minutes put a player in. `null` minutes are unknown. */
export const ROLE_BANDS = Object.freeze(['0', '1-199', '200-599', '600+']);

export function roleBand(minutes) {
  if (minutes == null) return null;
  if (minutes >= STARTER_MINUTES) return '600+';
  if (minutes >= 200) return '200-599';
  if (minutes >= 1) return '1-199';
  return '0';
}

/** The identity key for a roster row. */
export const playerKeyOf = (name) => nameKey(cleanRosterName(name));

/**
 * Class labels ranked so progression can be tested.
 *
 * Returns `null` for anything unreadable rather than guessing. 4.5% of men's
 * rows carry a label this cannot rank, and a wrong rank is worse than none:
 * class progression is a matching signal, and a fabricated one is a
 * fabricated match.
 */
export function classRank(label) {
  const s = String(label ?? '').toLowerCase();
  if (!s) return null;
  if (/\b(gr|grad|graduate|5th|fifth)\b/.test(s) || /^gr/.test(s)) return 5;
  if (/\b(sr|sen|senior)\b/.test(s) || /^r?-?sr/.test(s)) return 4;
  if (/\b(jr|jun|junior)\b/.test(s) || /^r?-?jr/.test(s)) return 3;
  if (/\b(so|soph|sophomore)\b/.test(s) || /^r?-?so/.test(s)) return 2;
  if (/\b(fr|fresh|freshman|first)\b/.test(s) || /^r?-?fr/.test(s)) return 1;
  return null;
}

export const CLASS_NAMES = Object.freeze({
  1: 'first-year', 2: 'sophomore', 3: 'junior', 4: 'senior', 5: 'graduate',
});

/** Whether the class label says this was a season the player could return from. */
export function isTerminalClass(label) {
  const r = classRank(label);
  return r == null ? null : r >= 4;
}

/**
 * Origin, as the roster records it — and only as it records it.
 *
 * Two values, because that is what the data holds. Never used as identity
 * evidence; it is here so a cohort can be described, not matched.
 */
export function originOf(row) {
  const n = String(row?.nationality ?? '').trim();
  if (!n) return null;
  return /^(usa|united states|us)$/i.test(n) ? 'domestic' : 'international';
}

/**
 * One observed season.
 *
 * `measured` is the single most important field on it: false means the
 * programme published no minutes for this player that season, and every
 * aggregate downstream must exclude the row rather than treat it as a zero.
 */
export function seasonObservation(row) {
  const minutes = row.minutes_played == null ? null : Number(row.minutes_played);
  return {
    season: String(row.season),
    programme: row.college_name,
    classLabel: row.class_year_label ?? null,
    classRank: classRank(row.class_year_label),
    canonicalPosition: canonicalPosition(row.position),
    rawPosition: row.position ?? null,
    minutes,
    games: row.games_played == null ? null : Number(row.games_played),
    starts: row.games_started == null ? null : Number(row.games_started),
    origin: originOf(row),
    hometown: row.hometown ?? null,
    // Kept for completeness and explicitly NOT used as evidence anywhere: it
    // is a deterministic function of the class label (Fr+4, So+3, Jr+2, Sr+1,
    // Gr+0, no exceptions in 51,000 rows), so it carries no information the
    // class label does not already carry.
    eligibilityEndYear: row.eligibility_end_year == null ? null : Number(row.eligibility_end_year),
    measured: minutes != null,
    roleBand: roleBand(minutes),
    rowId: row.id ?? null,
  };
}

/**
 * Every player's observed history, keyed by identity and programme.
 *
 * A player who appears at two programmes gets two histories: this is a record
 * of time AT a programme, and joining them into one career is Track D's job
 * and needs evidence this function does not have.
 */
export function buildLifecycles(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const playerKey = playerKeyOf(row.player_name);
    if (!playerKey) continue;
    const id = `${playerKey}|${row.college_name}`;
    if (!byKey.has(id)) {
      byKey.set(id, {
        playerKey,
        programme: row.college_name,
        sport: row.sport ?? null,
        name: cleanRosterName(row.player_name),
        seasons: [],
      });
    }
    byKey.get(id).seasons.push(seasonObservation(row));
  }

  for (const life of byKey.values()) {
    life.seasons.sort((a, b) => Number(a.season) - Number(b.season));
    life.firstSeason = life.seasons[0].season;
    life.lastSeason = life.seasons[life.seasons.length - 1].season;
    life.seasonsObserved = life.seasons.length;
    life.measuredSeasons = life.seasons.filter((s) => s.measured).length;
    // The position the player is most often recorded at, ignoring UNKNOWN.
    const counts = new Map();
    for (const s of life.seasons) {
      if (s.canonicalPosition === 'UNKNOWN') continue;
      counts.set(s.canonicalPosition, (counts.get(s.canonicalPosition) ?? 0) + 1);
    }
    life.position = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UNKNOWN';
    life.positionChanged = counts.size > 1;
    life.entryClassRank = life.seasons[0].classRank;
    // "Entry type" is only claimed where the class label at first appearance
    // supports it. A player first seen as a junior may have transferred in or
    // may simply predate the data, and this cannot tell which.
    life.entryType = life.entryClassRank == null ? null
      : life.entryClassRank === 1 ? 'FIRST_YEAR' : 'EXPERIENCED';
    life.gapSeasons = gapsIn(life.seasons);
  }
  return [...byKey.values()];
}

/** Seasons missing between the first and last observation, if any. */
function gapsIn(seasons) {
  const out = [];
  for (let i = 1; i < seasons.length; i += 1) {
    const prev = Number(seasons[i - 1].season);
    const cur = Number(seasons[i].season);
    for (let y = prev + 1; y < cur; y += 1) out.push(String(y));
  }
  return out;
}

/** Narrow a set of lifecycles to one programme, and optionally one position. */
export function lifecyclesAt(lifecycles, programme, { position = null } = {}) {
  return lifecycles.filter((l) => l.programme === programme
    && (position == null || l.position === canonicalPosition(position)));
}

/** The two cohorts the report layer will care about. */
export const firstYearCohort = (lifecycles) => lifecycles.filter((l) => l.entryType === 'FIRST_YEAR');
export const experiencedCohort = (lifecycles) => lifecycles.filter((l) => l.entryType === 'EXPERIENCED');
