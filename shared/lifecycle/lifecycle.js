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
import { readClassYear } from '../classYear.js';
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

/** The rank each class the label reader recognises corresponds to. */
const RANK_OF_CLASS = Object.freeze({
  FRESHMAN: 1, SOPHOMORE: 2, JUNIOR: 3, SENIOR: 4, GRADUATE: 5,
});

/**
 * Class labels ranked so progression can be tested.
 *
 * Returns `null` for anything unreadable rather than guessing, because a wrong
 * rank is worse than none: class progression is a matching signal, and a
 * fabricated one is a fabricated match.
 *
 * This USED TO carry its own regexes, and they were narrower than the reader
 * the freshman layer has always used. They could not read `Fy.`, `FY`,
 * `F.Y.`, `Rf.`, or any ordinal — `1st`, `2nd`, `1st Year`, `Second Year` —
 * which is 8,192 roster rows across 330 programmes, `Fy.` alone accounting for
 * 4,982 of them at 115 programmes. The consequence was invisible from the
 * freshman pages, which resolve the same column through `readClassYear` and
 * were always right: 161 programmes had first-years that `buildLifecycles`
 * placed in NO cohort, and 121 of them — Harvard, Yale, Columbia, Dartmouth,
 * Lehigh, Colgate, Quinnipiac, Sacred Heart, East Carolina among them — could
 * not print a multi-year development figure at all, because their roster page
 * spells first year "Fy." rather than "Fr.".
 *
 * So there is one reader now. The two never disagreed on a row they both
 * read — measured across 276,745 rows, zero conflicts — one was simply blind,
 * and a second parser of the same column is a second thing to keep in step.
 *
 * `klass` is the class the label NAMES, so a redshirt sophomore ranks 2 here
 * exactly as it did before: `readClassYear` advances a redshirt only when
 * computing the years they have left, which is a different question.
 */
export function classRank(label) {
  return RANK_OF_CLASS[readClassYear(label).klass] ?? null;
}

export const CLASS_NAMES = Object.freeze({
  1: 'first-year', 2: 'sophomore', 3: 'junior', 4: 'senior', 5: 'graduate',
});

/** The abbreviation a table column shows, one per rank. */
export const CLASS_ABBREVIATIONS = Object.freeze({
  1: 'FY', 2: 'SO', 3: 'JR', 4: 'SR', 5: 'GR',
});

/**
 * THE CLASS A TABLE PRINTS — 13I, and PRESENTATION ONLY.
 *
 * 276,745 roster rows carry 222 distinct raw class labels. 205 of those forms
 * resolve through `readClassYear` and account for 98.3% of rows, but they
 * resolve from 47 different spellings of a first-year alone — "Fr.", "Fy.",
 * "FY", "FR", "First Year", "1st", "Fr. (1st)", "Redshirt Freshman", "R-Fr.",
 * "F.Y." — and the tables printed whichever one the source happened to use. A
 * single Albright roster showed "So." beside "FY" and Rochester's showed
 * "SO" beside "JR", which reads as two different fields.
 *
 * DERIVED FROM THE RANK THE ANALYSIS ALREADY READ, deliberately. A second
 * mapping table would be a second reader for one column, which is the defect
 * that cost 121 programmes their development page in 13F: this way a row shown
 * as "SO" is a row every aggregate counted as a sophomore, by construction.
 *
 * NOT "Fr.". The report says "first-year" in every sentence it writes and has
 * since v1, because "freshman" is neither accurate for a redshirt nor the word
 * the analysis uses. The abbreviations follow the report, not the roster.
 *
 * AN UNRESOLVED LABEL IS SHOWN AS IT WAS STORED. 574 rows in 16 forms carry
 * something that is not a class at all — a graduation year ("2026", "'29"), or
 * a redshirt with no year attached ("Rs.", "RS", "Medical Redshirt"). Printing
 * a guess for those would misclassify a player; printing the raw string keeps
 * the gap visible, which is the same rule every other column in this report
 * follows. A null label stays null and the table draws its own dash.
 *
 * NOTHING ANALYTICAL READS THIS. `classRank`, `readClassYear`,
 * `experienceGroup`, `isTerminalClass` and the continuity and movement models
 * all read the stored label exactly as they did before; the model still carries
 * `classLabel` verbatim, so no model hash moves.
 */
export function classDisplay(label) {
  if (label == null || String(label).trim() === '') return null;
  return CLASS_ABBREVIATIONS[classRank(label)] ?? String(label);
}

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
