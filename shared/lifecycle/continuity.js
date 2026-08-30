/**
 * Track C — who came back, and who was not on the next roster.
 *
 * The distinction this file refuses to blur: a player who is not on next
 * season's roster has NOT transferred. They may have moved, graduated,
 * stopped playing, been injured, or be sitting behind a spelling the join
 * could not match. This layer reports RETURNED and NOT_OBSERVED and stops
 * there; where they went is Track D's question and it can only answer it for
 * about one in seven.
 *
 * TWO GATES, both from the audit.
 *
 * A transition is only readable when BOTH rosters are on file. 96 programme-
 * transitions in the men's game have a source roster and no destination one —
 * 2,995 player-seasons — and reading those as departures invents a mass exodus
 * for every programme that simply was not scraped that year.
 *
 * `eligibility_end_year` is NOT evidence. It is a deterministic function of
 * the class label (Fr+4, So+3, Jr+2, Sr+1, Gr+0, no exceptions in 51,000
 * rows), so treating it as an independent observation implies every senior has
 * one more season and classifies every graduation as an early departure. That
 * mistake put 87.9% of all departures in the "early" bucket. The class label
 * is the only real signal and this file uses it directly.
 */
import { classRank, roleBand, STARTER_MINUTES, playerKeyOf } from './lifecycle.js';
import { canonicalPosition } from '../positions.js';

export const TRANSITIONS = Object.freeze([
  ['2022', '2023'], ['2023', '2024'], ['2024', '2025'], ['2025', '2026'],
]);

export const EXIT_KIND = Object.freeze({
  /** Senior or graduate student: the class label says this was a last season. */
  EXPECTED_EXIT: 'EXPECTED_EXIT',
  /** First-year, sophomore or junior: seasons remained by the class label. */
  EARLY_EXIT: 'EARLY_EXIT',
  /** No readable class label, so neither can be claimed. */
  UNKNOWN_EXIT: 'UNKNOWN_EXIT',
});

export const CONTINUITY = Object.freeze({
  RETURNED: 'RETURNED',
  NOT_OBSERVED: 'NOT_OBSERVED',
  /** The next roster does not exist, so absence proves nothing. */
  UNREADABLE: 'UNREADABLE',
});

/** An index of who was where, by season, for fast lookup. */
export function buildRosterIndex(rows) {
  const bySeason = new Map();
  const programmeSeasons = new Map();
  for (const row of rows) {
    const season = String(row.season);
    const key = playerKeyOf(row.player_name);
    if (!key) continue;
    if (!bySeason.has(season)) bySeason.set(season, new Map());
    const m = bySeason.get(season);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(row);
    if (!programmeSeasons.has(row.college_name)) programmeSeasons.set(row.college_name, new Set());
    programmeSeasons.get(row.college_name).add(season);
  }
  return { bySeason, programmeSeasons };
}

/**
 * Every observation of "could this player have come back, and did they".
 *
 * One record per player-season entering a transition. `status` is what the
 * rosters show; `exitKind` is what the class label says about whether a return
 * was expected at all. They are separate on purpose: a senior who does not
 * return and a sophomore who does not return are the same `NOT_OBSERVED` and
 * very different facts.
 */
export function continuityObservations(rows, index = null) {
  const { bySeason, programmeSeasons } = index ?? buildRosterIndex(rows);
  const out = [];

  for (const [from, to] of TRANSITIONS) {
    const prev = bySeason.get(from);
    const next = bySeason.get(to);
    if (!prev) continue;

    for (const [key, prevRows] of prev) {
      for (const row of prevRows) {
        const hasNextRoster = programmeSeasons.get(row.college_name)?.has(to) ?? false;
        const atNext = next?.get(key) ?? [];
        const returned = atNext.some((x) => x.college_name === row.college_name);
        const rank = classRank(row.class_year_label);

        const status = returned ? CONTINUITY.RETURNED
          : !hasNextRoster ? CONTINUITY.UNREADABLE
            : CONTINUITY.NOT_OBSERVED;

        out.push({
          playerKey: key,
          name: row.player_name,
          programme: row.college_name,
          sport: row.sport ?? null,
          division: row.division ?? null,
          from,
          to,
          status,
          exitKind: rank == null ? EXIT_KIND.UNKNOWN_EXIT
            : rank >= 4 ? EXIT_KIND.EXPECTED_EXIT : EXIT_KIND.EARLY_EXIT,
          classLabel: row.class_year_label ?? null,
          classRank: rank,
          canonicalPosition: canonicalPosition(row.position),
          minutes: row.minutes_played == null ? null : Number(row.minutes_played),
          roleBand: roleBand(row.minutes_played == null ? null : Number(row.minutes_played)),
          measured: row.minutes_played != null,
          entryType: null,                    // filled by the caller from Track A
          sourceRow: row,
        });
      }
    }
  }
  return out;
}

/** A denominator-carrying summary of one slice of observations. */
function tallyOf(observations) {
  const readable = observations.filter((o) => o.status !== CONTINUITY.UNREADABLE);
  const returned = readable.filter((o) => o.status === CONTINUITY.RETURNED).length;
  const notObserved = readable.filter((o) => o.status === CONTINUITY.NOT_OBSERVED).length;
  return {
    observations: observations.length,
    returnable: readable.length,
    returned,
    notObserved,
    unreadable: observations.length - readable.length,
    retention: readable.length ? returned / readable.length : null,
  };
}

/**
 * Programme continuity, whole and sliced.
 *
 * Every slice keeps its own denominator, and a slice thinner than `minSlice`
 * reports counts with a null share rather than a rate nobody should read.
 */
export function continuitySummary(observations, { minSlice = 8 } = {}) {
  const overall = tallyOf(observations);

  const sliceBy = (name, keyFn) => {
    const groups = new Map();
    for (const o of observations) {
      const k = keyFn(o);
      if (k == null) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    return {
      by: name,
      groups: [...groups.entries()].map(([k, g]) => {
        const t = tallyOf(g);
        return {
          key: k,
          ...t,
          retention: t.returnable >= minSlice ? t.retention : null,
          suppressed: t.returnable < minSlice,
        };
      }).sort((a, b) => b.returnable - a.returnable),
    };
  };

  const readable = observations.filter((o) => o.status !== CONTINUITY.UNREADABLE);
  const notObserved = readable.filter((o) => o.status === CONTINUITY.NOT_OBSERVED);

  return {
    ...overall,
    exits: {
      expected: notObserved.filter((o) => o.exitKind === EXIT_KIND.EXPECTED_EXIT).length,
      early: notObserved.filter((o) => o.exitKind === EXIT_KIND.EARLY_EXIT).length,
      unknownClass: notObserved.filter((o) => o.exitKind === EXIT_KIND.UNKNOWN_EXIT).length,
    },
    // Starters specifically: the group a recruit cares most about.
    starterRetention: (() => {
      const g = readable.filter((o) => o.roleBand === '600+');
      const t = tallyOf(g);
      return { ...t, retention: t.returnable >= minSlice ? t.retention : null, suppressed: t.returnable < minSlice };
    })(),
    slices: [
      sliceBy('roleBand', (o) => o.roleBand),
      sliceBy('position', (o) => (o.canonicalPosition === 'UNKNOWN' ? null : o.canonicalPosition)),
      sliceBy('entryType', (o) => o.entryType),
      sliceBy('transition', (o) => `${o.from}→${o.to}`),
    ],
  };
}
