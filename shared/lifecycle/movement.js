/**
 * Tracks D to G — where a player was next, and only where the evidence says so.
 *
 * A movement record carries its evidence. There is no `transfer: true` in this
 * file and no field that could be mistaken for one: the caller gets the
 * signals that fired, the candidates that did not win, and a status that is
 * honest about all four possible states.
 *
 * WHAT IS DELIBERATELY ABSENT.
 *
 * Nationality. It has two values; two strangers agree on it 62% of the time in
 * the men's game and 85% in the women's. In the audit's first draft it was
 * present in 97% of matches and it was carrying a coin flip. Removing it took
 * the false-positive rate against players who demonstrably stayed from 0.6% to
 * 0.3%, and requiring hometown took it to 0.04%.
 *
 * A transfer rate. The audit established that 84% of departures resolve to no
 * destination at all and that resolution varies six-fold by division — 18.8%
 * at Division I against 3.1% at Division III. A rate over that denominator
 * measures roster coverage, not behaviour. The programme summary exposes
 * observed destinations and match coverage instead, and there is no code path
 * that divides one by the other.
 *
 * A combined movement score. Division, football rating, academic rating and
 * national ranking move independently and a player can go up on one and down
 * on another. They are reported separately and never summed.
 */
import { classRank, roleBand, STARTER_MINUTES, playerKeyOf } from './lifecycle.js';
import { sameHometown } from './hometown.js';
import { canonicalPosition } from '../positions.js';
import { TRANSITIONS, buildRosterIndex } from './continuity.js';

export const MATCH_STATUS = Object.freeze({
  /** One destination, and the hometown agrees. */
  MATCH_A: 'MATCH_A',
  /** One destination, no hometown agreement, three other signals agree. */
  MATCH_B: 'MATCH_B',
  /** The name appears elsewhere but the evidence does not settle it. */
  AMBIGUOUS: 'AMBIGUOUS',
  /** The name appears at no other programme the following season. */
  UNRESOLVED: 'UNRESOLVED',
});

/** Statuses a caller may treat as an observed destination. Nothing else. */
export const OBSERVED = Object.freeze([MATCH_STATUS.MATCH_A, MATCH_STATUS.MATCH_B]);
export const isObserved = (m) => OBSERVED.includes(m.status);

/**
 * A name held by this many programmes is not usable as identity on its own.
 *
 * Three is where the audit drew it: 88.2% of men's name keys appear at exactly
 * one programme, 10.4% at two, and the tail from three upward is where the
 * Tyler Johnsons and Jacob Lees live — four distinct people each, in one
 * season, at four programmes.
 */
export const COMMON_NAME_PROGRAMMES = 3;

/**
 * The signals that may corroborate an identity across programmes.
 *
 * Nationality is not among them and must not be added; see the header.
 */
export function identitySignals(source, destination) {
  const srcPos = canonicalPosition(source.position);
  const dstPos = canonicalPosition(destination.position);
  const a = classRank(source.class_year_label);
  const b = classRank(destination.class_year_label);
  return {
    hometown: sameHometown(source.hometown, destination.hometown),
    position: srcPos !== 'UNKNOWN' && srcPos === dstPos,
    classProgression: a != null && b != null && b === a + 1,
    graduationYear: source.estimated_graduation_year != null
      && source.estimated_graduation_year === destination.estimated_graduation_year,
    // Recorded when the destination row names the source outright. Present
    // only on 2026 rows in this dataset, so it confirms rather than carries.
    priorProgramme: Boolean(destination.prior_programme)
      && String(destination.prior_programme).trim().toLowerCase()
        === String(source.college_name).trim().toLowerCase(),
  };
}

const countSignals = (s) => Object.values(s).filter(Boolean).length;

/**
 * Every departure, with a destination only where the evidence supports one.
 *
 * `nameProgrammes` is how many distinct programmes carry this name key across
 * the whole dataset — the common-name guard.
 */
export function movementObservations(rows, index = null) {
  const { bySeason, programmeSeasons } = index ?? buildRosterIndex(rows);

  const nameProgrammes = new Map();
  for (const row of rows) {
    const k = playerKeyOf(row.player_name);
    if (!k) continue;
    if (!nameProgrammes.has(k)) nameProgrammes.set(k, new Set());
    nameProgrammes.get(k).add(row.college_name);
  }

  const out = [];
  for (const [from, to] of TRANSITIONS) {
    const prev = bySeason.get(from);
    const next = bySeason.get(to);
    if (!prev) continue;

    for (const [key, prevRows] of prev) {
      for (const source of prevRows) {
        const atNext = next?.get(key) ?? [];
        if (atNext.some((x) => x.college_name === source.college_name)) continue;   // returned
        // The source programme has no next-season roster, so this player's
        // absence is a gap in the data rather than an observation.
        if (!programmeSeasons.get(source.college_name)?.has(to)) continue;

        const others = atNext.filter((x) => x.college_name !== source.college_name);
        const destinations = [...new Set(others.map((x) => x.college_name))];
        const common = (nameProgrammes.get(key)?.size ?? 1) >= COMMON_NAME_PROGRAMMES;

        const scored = others.map((x) => ({ row: x, signals: identitySignals(source, x) }))
          .sort((p, q) => countSignals(q.signals) - countSignals(p.signals));
        const best = scored[0] ?? null;

        let status = MATCH_STATUS.UNRESOLVED;
        let destination = null;
        if (others.length) {
          status = MATCH_STATUS.AMBIGUOUS;
          if (destinations.length === 1 && !common && best) {
            if (best.signals.hometown) { status = MATCH_STATUS.MATCH_A; destination = best.row; }
            else if (countSignals(best.signals) >= 3) { status = MATCH_STATUS.MATCH_B; destination = best.row; }
          }
        }

        out.push({
          playerKey: key,
          name: source.player_name,
          sport: source.sport ?? null,
          sourceProgramme: source.college_name,
          sourceSeason: from,
          sourceDivision: source.division ?? null,
          destinationProgramme: destination?.college_name ?? null,
          destinationSeason: destination ? to : null,
          status,
          signals: best?.signals ?? {
            hometown: false, position: false, classProgression: false,
            graduationYear: false, priorProgramme: false,
          },
          signalCount: best ? countSignals(best.signals) : 0,
          // Every programme the name appeared at, so a person can look. Kept
          // even on a match, because "one candidate" is itself evidence.
          ambiguousCandidates: destinations,
          commonName: common,
          sourceRow: source,
          destinationRow: destination,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Track E — what the destination is, compared with the source
// ---------------------------------------------------------------------------

const DIVISION_ORDER = Object.freeze({
  'NCAA D1': 5, 'NCAA D2': 4, NAIA: 3, 'NCAA D3': 2, NJCAA: 1, USCAA: 1,
});

/**
 * Similarity bands, derived from the observed distributions rather than chosen.
 *
 * Measured on the observed men's set (n=4,375) and checked against the
 * women's: soccer_score has an interquartile range of −11.1 to +9.1, academic
 * rating −1.3 to +1.6, national ranking −119 to +93. Each constant is that
 * range rounded, so roughly the middle half of real moves land in "similar"
 * and the outer quarters carry a claim of stronger or weaker.
 *
 * National ranking needed the widest band by two orders of magnitude, and an
 * earlier ±25 would have called almost every move a change. Re-derive with
 * `deriveBands` when the pool moves; do not hand-tune against a single case.
 */
export const SIMILARITY = Object.freeze({
  soccerScore: 10,
  academicRating: 1.5,
  nationalRanking: 100,
});

/** The bands the pool actually implies, for checking SIMILARITY against. */
export function deriveBands(movements) {
  const spread = (get) => {
    const a = movements.map(get).filter((v) => v != null).sort((x, y) => x - y);
    if (!a.length) return null;
    const at = (p) => a[Math.floor(p * (a.length - 1))];
    return { n: a.length, p25: at(0.25), median: at(0.5), p75: at(0.75) };
  };
  return {
    soccerScore: spread((m) => m.comparison?.soccerScore?.delta),
    academicRating: spread((m) => m.comparison?.academicRating?.delta),
    nationalRanking: spread((m) => m.comparison?.nationalRanking?.delta),
  };
}

const bandOf = (delta, tolerance, labels) => {
  if (delta == null) return null;
  if (delta > tolerance) return labels[0];
  if (delta < -tolerance) return labels[2];
  return labels[1];
};

/**
 * Four independent comparisons. Never combined, never given one verdict.
 *
 * `null` on any dimension means one side of the comparison is missing, which
 * is a different statement from "similar" and is kept that way.
 */
export function compareProgrammes(sourceCollege, destinationCollege) {
  const a = sourceCollege ?? null;
  const b = destinationCollege ?? null;
  const num = (v) => (v == null ? null : Number(v));

  const sa = num(a?.soccer_score); const sb = num(b?.soccer_score);
  const aa = num(a?.academic_rating); const ab = num(b?.academic_rating);
  const ra = num(a?.national_ranking); const rb = num(b?.national_ranking);
  const da = DIVISION_ORDER[a?.division]; const dbv = DIVISION_ORDER[b?.division];

  return {
    division: {
      source: a?.division ?? null,
      destination: b?.division ?? null,
      movement: (da != null && dbv != null)
        ? (dbv > da ? 'DIVISION_UP' : dbv < da ? 'DIVISION_DOWN' : 'DIVISION_SAME')
        : null,
    },
    soccerScore: {
      source: sa, destination: sb,
      delta: (sa != null && sb != null) ? sb - sa : null,
      band: bandOf((sa != null && sb != null) ? sb - sa : null, SIMILARITY.soccerScore,
        ['STRONGER_FOOTBALL_RATING', 'SIMILAR_FOOTBALL_RATING', 'LOWER_FOOTBALL_RATING']),
    },
    academicRating: {
      source: aa, destination: ab,
      delta: (aa != null && ab != null) ? ab - aa : null,
      band: bandOf((aa != null && ab != null) ? ab - aa : null, SIMILARITY.academicRating,
        ['HIGHER_ACADEMIC_RATING', 'SIMILAR_ACADEMIC_RATING', 'LOWER_ACADEMIC_RATING']),
    },
    nationalRanking: {
      source: ra, destination: rb,
      // Positive means a better (lower-numbered) rank at the destination.
      delta: (ra != null && rb != null) ? ra - rb : null,
      band: bandOf((ra != null && rb != null) ? ra - rb : null, SIMILARITY.nationalRanking,
        ['BETTER_NATIONAL_RANKING', 'SIMILAR_NATIONAL_RANKING', 'LOWER_NATIONAL_RANKING']),
      comparable: Boolean(a && b && a.division === b.division),
    },
  };
}

// ---------------------------------------------------------------------------
// Tracks F and G — the role before, and the minutes after
// ---------------------------------------------------------------------------

/**
 * Minutes that count as the same role rather than more or less.
 *
 * 120 minutes is a substitute appearance either way across a season. Below
 * that a delta is noise; a caller who wants none of this can read `delta`.
 */
export const SIMILAR_MINUTES = 120;

export function attachRoleAndOutcome(movement, { nextSeasonRow = null } = {}) {
  const src = movement.sourceRow;
  const dst = movement.destinationRow;
  const srcMin = src?.minutes_played == null ? null : Number(src.minutes_played);
  const dstMin = dst?.minutes_played == null ? null : Number(dst.minutes_played);

  const priorRole = {
    season: movement.sourceSeason,
    minutes: srcMin,
    games: src?.games_played == null ? null : Number(src.games_played),
    starts: src?.games_started == null ? null : Number(src.games_started),
    roleBand: roleBand(srcMin),
    measured: srcMin != null,
  };

  const outcome = dst == null ? null : {
    season: movement.destinationSeason,
    minutes: dstMin,
    games: dst.games_played == null ? null : Number(dst.games_played),
    starts: dst.games_started == null ? null : Number(dst.games_started),
    roleBand: roleBand(dstMin),
    measured: dstMin != null,
    delta: (srcMin != null && dstMin != null) ? dstMin - srcMin : null,
    change: (srcMin != null && dstMin != null)
      ? (dstMin - srcMin > SIMILAR_MINUTES ? 'PLAYED_MORE'
        : dstMin - srcMin < -SIMILAR_MINUTES ? 'PLAYED_LESS' : 'SIMILAR_MINUTES')
      : null,
    reachedStarter: dstMin == null ? null : dstMin >= STARTER_MINUTES,
    secondSeason: nextSeasonRow == null ? null : {
      season: String(nextSeasonRow.season),
      minutes: nextSeasonRow.minutes_played == null ? null : Number(nextSeasonRow.minutes_played),
      roleBand: roleBand(nextSeasonRow.minutes_played == null ? null : Number(nextSeasonRow.minutes_played)),
      measured: nextSeasonRow.minutes_played != null,
    },
  };

  return { ...movement, priorRole, outcome };
}

// ---------------------------------------------------------------------------
// Programme movement summary
// ---------------------------------------------------------------------------

/**
 * What a programme's departures look like, with coverage never divided away.
 *
 * There is no transfer rate here by design. `destinationMatchCoverage` is the
 * share of departures whose destination could be OBSERVED, and it is a
 * statement about the data, not about the programme.
 */
export function programmeMovementSummary(movements, continuity, { minSlice = 8 } = {}) {
  const observed = movements.filter(isObserved);
  const ambiguous = movements.filter((m) => m.status === MATCH_STATUS.AMBIGUOUS);
  const unresolved = movements.filter((m) => m.status === MATCH_STATUS.UNRESOLVED);

  const byBand = {};
  for (const b of ['0', '1-199', '200-599', '600+']) {
    const all = movements.filter((m) => roleBand(
      m.sourceRow?.minutes_played == null ? null : Number(m.sourceRow.minutes_played),
    ) === b);
    const seen = all.filter(isObserved);
    byBand[b] = {
      departures: all.length,
      observedDestinations: seen.length,
      coverage: all.length ? seen.length / all.length : null,
      suppressed: seen.length < minSlice,
    };
  }

  return {
    departuresObserved: movements.length,
    expectedExits: continuity?.exits?.expected ?? null,
    earlyDepartures: continuity?.exits?.early ?? null,
    unknownClassExits: continuity?.exits?.unknownClass ?? null,
    destinations: {
      matchedA: movements.filter((m) => m.status === MATCH_STATUS.MATCH_A).length,
      matchedB: movements.filter((m) => m.status === MATCH_STATUS.MATCH_B).length,
      observed: observed.length,
      ambiguous: ambiguous.length,
      unresolved: unresolved.length,
      // A statement about how much of this programme's movement is visible,
      // never a behavioural rate.
      destinationMatchCoverage: movements.length ? observed.length / movements.length : null,
    },
    byPriorRole: byBand,
    // Deliberately absent: transferRate. See the module header.
  };
}
