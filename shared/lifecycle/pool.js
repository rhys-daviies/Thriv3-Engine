/**
 * The pool half of the lifecycle layer: everything one programme is read
 * against, and the one question a single programme's rows cannot answer.
 *
 * Continuity and development are computable from a programme's own rows —
 * whether a player came back is a question about that roster — so those are
 * built per programme, on demand, and nothing here holds them.
 *
 * Movement is not. "Where was this player next" is a question about every
 * other programme's rosters, so it can only be answered from the whole pool,
 * once. This module answers it for every programme in a sport and hands back
 * COMPACT records: the roster rows the matching was computed from are dropped
 * on the way out, because holding a quarter of a million of them for the life
 * of the process is the difference between 35 MB and half a gigabyte.
 *
 * NO RATE IS DIVIDED HERE that could be read as behaviour. `coverage` is the
 * share of departures whose destination could be observed and it is a
 * statement about the roster data — see the movement module's header.
 */
import { buildLifecycles, classRank } from './lifecycle.js';
import {
  continuityObservations, continuitySummary, buildRosterIndex, TRANSITIONS, EXIT_KIND,
} from './continuity.js';
import {
  movementObservations, compareProgrammes, attachRoleAndOutcome, isObserved, MATCH_STATUS,
} from './movement.js';
import { developmentSummary } from './development.js';
import { canonicalPosition, POSITIONS } from '../positions.js';
import { readableRows, minutesCoverage } from './readable.js';
import { positionPressure, MIN_CYCLES_FOR_POOL, MIN_INCOMING_FOR_MIX } from './pressure.js';
import { programmeUtilisation, MIN_SEASONS_FOR_POOL } from './utilisation.js';
import { programmeExperience, EXPERIENCE_GROUPS } from './experience.js';

export const LIFECYCLE_SEASONS = Object.freeze(['2022', '2023', '2024', '2025', '2026']);
/** The last season that carries minutes. 2026 is a named roster and nothing more. */
export const LAST_MEASURED_SEASON = '2025';
export const LAST_SEASON = '2026';

/** A programme needs this many returnable player-seasons before its retention is quoted. */
export const MIN_RETURNABLE = 20;
/** …and this many for the pool to carry it as a benchmark observation. */
export const MIN_RETURNABLE_FOR_POOL = 40;

const quantile = (sorted, q) => (sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);

function spread(values) {
  const s = [...values].filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return null;
  return {
    n: s.length,
    p10: quantile(s, 0.1),
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    p90: quantile(s, 0.9),
  };
}

/**
 * Drop the roster rows and keep the findings.
 *
 * `comparison` is resolved here rather than at render time because it needs
 * the colleges table, which the renderer has no business reading.
 */
function compactMovement(m, collegeOf) {
  const withOutcome = attachRoleAndOutcome(m);
  const src = collegeOf(m.sourceProgramme);
  const dst = m.destinationProgramme ? collegeOf(m.destinationProgramme) : null;
  return {
    name: m.name,
    playerKey: m.playerKey,
    sourceProgramme: m.sourceProgramme,
    sourceSeason: m.sourceSeason,
    sourceDivision: src?.division ?? m.sourceDivision ?? null,
    canonicalPosition: canonicalPosition(m.sourceRow?.position),
    classLabel: m.sourceRow?.class_year_label ?? null,
    // The same rule continuity uses, carried on the movement record so a
    // report can ask "of the players who left with seasons remaining, where
    // could we trace them" without joining the two layers back together.
    exitKind: (() => {
      const rank = classRank(m.sourceRow?.class_year_label);
      return rank == null ? EXIT_KIND.UNKNOWN_EXIT
        : rank >= 4 ? EXIT_KIND.EXPECTED_EXIT : EXIT_KIND.EARLY_EXIT;
    })(),
    priorRole: withOutcome.priorRole,
    status: m.status,
    signals: m.signals,
    signalCount: m.signalCount,
    commonName: m.commonName,
    // Every programme the name appeared at. Kept on an AMBIGUOUS record so a
    // person can look, and never rendered as a destination.
    candidates: m.ambiguousCandidates,
    destinationProgramme: m.destinationProgramme,
    destinationSeason: m.destinationSeason,
    destinationDivision: dst?.division ?? null,
    comparison: m.destinationProgramme ? compareProgrammes(src, dst) : null,
    outcome: withOutcome.outcome,
  };
}

/**
 * Everything the report layer compares a programme against, built once.
 *
 * Returns `sufficient: false` with nulls rather than zeros when a sport has
 * too little on file — the same contract `buildPoolBenchmarks` keeps, and for
 * the same reason: a zero here would be drawn as a measurement.
 */
export function buildLifecyclePool(rawRows, colleges, { sport = null } = {}) {
  const started = Date.now();
  const byName = new Map();
  for (const c of colleges) byName.set(c.name, c);
  const collegeOf = (name) => byName.get(name) ?? null;

  const empty = {
    sufficient: false, sport, reason: 'no roster seasons on file for this sport',
    seasons: LIFECYCLE_SEASONS, programmes: 0,
    movementByProgramme: new Map(), arrivalsByProgramme: new Map(),
    benchmarks: null, positionIntake: null, utilisation: null, experience: null,
    destinationCoverage: null,
    buildMs: Date.now() - started,
  };
  if (!rawRows.length) return empty;

  // The readability rule, applied once, before anything reads a minute.
  //
  // It cannot change a single match: identity here is hometown, position,
  // class progression and graduation year, and minutes are not among them.
  // What it does change is what a matched move REPORTS — a destination row
  // carrying a zero beside sixteen games played was being printed as "0 min"
  // next to a named player, which is a false statement about that person.
  const rows = readableRows(rawRows);
  const index = buildRosterIndex(rows);

  // ---- movement, the only cross-programme pass ----------------------------
  const movementByProgramme = new Map();
  const arrivalsByProgramme = new Map();
  for (const m of movementObservations(rows, index)) {
    const rec = compactMovement(m, collegeOf);
    if (!movementByProgramme.has(m.sourceProgramme)) movementByProgramme.set(m.sourceProgramme, []);
    movementByProgramme.get(m.sourceProgramme).push(rec);
    // The same record, filed under where the player went, so a programme can
    // also be asked who arrived with an observed origin.
    if (rec.destinationProgramme) {
      if (!arrivalsByProgramme.has(rec.destinationProgramme)) {
        arrivalsByProgramme.set(rec.destinationProgramme, []);
      }
      arrivalsByProgramme.get(rec.destinationProgramme).push(rec);
    }
  }

  // ---- benchmarks, per programme, then quantiled --------------------------
  const rowsByProgramme = new Map();
  for (const r of rows) {
    if (!rowsByProgramme.has(r.college_name)) rowsByProgramme.set(r.college_name, []);
    rowsByProgramme.get(r.college_name).push(r);
  }

  const series = () => ({
    retention: [], starterRetention: [], everStarter: [],
    starterByYear: [[], [], []], retentionAfter: [[], [], []],
  });
  const overall = series();
  const byDivision = new Map();
  const divisionOf = (name) => collegeOf(name)?.division ?? null;

  for (const [programme, progRows] of rowsByProgramme) {
    const cont = continuitySummary(continuityObservations(progRows));
    if (cont.returnable < MIN_RETURNABLE_FOR_POOL) continue;
    const cohort = buildLifecycles(progRows).filter((l) => l.entryType === 'FIRST_YEAR');
    const coverage = minutesCoverage(
      cohort.flatMap((l) => l.seasons.filter((x) => Number(x.season) <= Number(LAST_MEASURED_SEASON)))
        .map((x) => ({ minutes_played: x.minutes })),
    );
    const dev = developmentSummary(cohort,
      { lastSeason: LAST_SEASON, lastMeasuredSeason: LAST_MEASURED_SEASON });
    const div = divisionOf(programme);
    if (div && !byDivision.has(div)) byDivision.set(div, series());
    const targets = [overall, ...(div ? [byDivision.get(div)] : [])];
    for (const t of targets) {
      // Retention needs no minutes at all — it is a question about names on
      // two rosters — so it is contributed whatever the minutes look like.
      t.retention.push(cont.retention);
      if (!coverage.readable) continue;
      if (!cont.starterRetention.suppressed) t.starterRetention.push(cont.starterRetention.retention);
      if (!dev.everReachedStarter.suppressed) t.everStarter.push(dev.everReachedStarter.share);
      dev.starterLevelByYear.slice(0, 3).forEach((y, i) => {
        if (!y.suppressed) t.starterByYear[i].push(y.share);
      });
      dev.retentionByYear.forEach((y, i) => {
        if (!y.suppressed) t.retentionAfter[i].push(y.share);
      });
    }
  }

  const summarise = (s) => ({
    programmes: s.retention.length,
    retention: spread(s.retention),
    starterRetention: spread(s.starterRetention),
    everStarter: spread(s.everStarter),
    starterByYear: s.starterByYear.map(spread),
    retentionAfter: s.retentionAfter.map(spread),
  });

  // ---- squad utilisation and experience, over programme medians -----------
  //
  // Programme medians rather than pooled seasons, so a programme with four
  // readable seasons cannot outvote one with three. Both read the SAME rows
  // every other benchmark reads — `readableRows` has already applied the row
  // rule and the source rule — so a season whose stats page was never read is
  // absent here rather than contributing a distribution of zeros.
  const utilCells = new Map();
  const expCells = new Map();
  for (const [programme, progRows] of rowsByProgramme) {
    const div = divisionOf(programme);
    const keys = ['ALL', ...(div ? [div] : [])];
    const util = programmeUtilisation(progRows);
    if (util.seasonsObserved >= MIN_SEASONS_FOR_POOL) {
      for (const key of keys) {
        if (!utilCells.has(key)) {
          utilCells.set(key, {
            programmes: 0, top11: [], top14: [], top18: [], rotation: [], starters: [],
          });
        }
        const cell = utilCells.get(key);
        cell.programmes += 1;
        cell.top11.push(util.medianTop11Share);
        cell.top14.push(util.medianTop14Share);
        cell.top18.push(util.medianTop18Share);
        cell.rotation.push(util.medianPlayersWith200Plus);
        cell.starters.push(util.medianPlayersWith600Plus);
      }
    }
    const exp = programmeExperience(progRows);
    if (exp.loadSeasons.length >= MIN_SEASONS_FOR_POOL) {
      for (const key of keys) {
        if (!expCells.has(key)) {
          expCells.set(key, { programmes: 0, minuteShare: new Map(), rosterShare: new Map() });
        }
        const cell = expCells.get(key);
        cell.programmes += 1;
        for (const g of exp.groups) {
          if (!cell.minuteShare.has(g.group)) {
            cell.minuteShare.set(g.group, []);
            cell.rosterShare.set(g.group, []);
          }
          if (g.minuteShare != null) cell.minuteShare.get(g.group).push(g.minuteShare);
          if (g.rosterShare != null) cell.rosterShare.get(g.group).push(g.rosterShare);
        }
      }
    }
  }
  const utilisation = Object.fromEntries([...utilCells.entries()].map(([key, c]) => [key, {
    programmes: c.programmes,
    top11MinuteShare: spread(c.top11),
    top14MinuteShare: spread(c.top14),
    top18MinuteShare: spread(c.top18),
    playersWith200Plus: spread(c.rotation),
    playersWith600Plus: spread(c.starters),
  }]));
  const experience = Object.fromEntries([...expCells.entries()].map(([key, c]) => [key, {
    programmes: c.programmes,
    groups: Object.fromEntries(EXPERIENCE_GROUPS.map((g) => [g, {
      minuteShare: spread(c.minuteShare.get(g) ?? []),
      rosterShare: spread(c.rosterShare.get(g) ?? []),
    }])),
  }]));

  // ---- position intake, the one benchmark that needs no minutes -----------
  //
  // Invariant to both readability rules, and that is the point of it: intake
  // is a question about names and class labels, so a programme whose minutes
  // were never published contributes here exactly as any other, and the
  // rows it reads could be the raw ones or the readable ones without changing
  // a single count. It is quantiled over PROGRAMMES rather than over cycles,
  // because what a report compares is one programme's usual intake against
  // other programmes' usual intake, and pooling cycles would let a programme
  // with four readable cycles outvote one with two.
  const pressureCells = new Map();
  for (const [programme, progRows] of rowsByProgramme) {
    const div = divisionOf(programme);
    // No returnable-seasons gate: that one exists because retention needs a
    // measured squad, and this needs a roster.
    const pressure = positionPressure(progRows);
    for (const pos of pressure.positions) {
      // Both gates: enough cycles, and rosters that say what position these
      // players were. A programme whose pages carry no position column has a
      // suppressed median, and pushing that null would count it as an
      // observation of zero.
      if (pos.historical.cyclesWithReadableRosterPresence < MIN_CYCLES_FOR_POOL) continue;
      if (pos.historical.suppressed || pos.historical.medianTotalIncoming == null) continue;
      for (const key of [`ALL|${pos.position}`, ...(div ? [`${div}|${pos.position}`] : [])]) {
        if (!pressureCells.has(key)) pressureCells.set(key, { totals: [], experienced: [], programmes: 0 });
        const cell = pressureCells.get(key);
        cell.programmes += 1;
        cell.totals.push(pos.historical.medianTotalIncoming);
        if (!pos.historical.mix.suppressed) cell.experienced.push(pos.historical.mix.experiencedShare);
      }
    }
  }
  const positionIntake = {};
  for (const [key, cell] of pressureCells) {
    const [division, position] = key.split('|');
    if (!positionIntake[division]) positionIntake[division] = {};
    positionIntake[division][position] = {
      programmes: cell.programmes,
      totalIncoming: spread(cell.totals),
      // Reported with its own denominator: a programme too thin for a mix
      // contributes an intake figure and no share, so the two n's differ.
      experiencedShare: cell.experienced.length >= MIN_INCOMING_FOR_MIX
        ? spread(cell.experienced) : null,
      experiencedShareProgrammes: cell.experienced.length,
    };
  }

  // ---- how much movement each division can be seen at all -----------------
  //
  // This is what the destination pages are gated on, and it is measured rather
  // than assumed. The audit put Division I near one in five and Division III
  // near one in thirty; a constant in the source would go stale silently.
  const coverage = new Map();
  for (const [programme, movements] of movementByProgramme) {
    const div = divisionOf(programme) ?? 'unknown';
    if (!coverage.has(div)) coverage.set(div, { departures: 0, observed: 0, programmes: 0 });
    const c = coverage.get(div);
    c.departures += movements.length;
    c.observed += movements.filter(isObserved).length;
    c.programmes += 1;
  }

  return {
    sufficient: overall.retention.length > 0,
    sport,
    reason: overall.retention.length ? null
      : `no programme has ${MIN_RETURNABLE_FOR_POOL} returnable player-seasons`,
    seasons: LIFECYCLE_SEASONS,
    lastSeason: LAST_SEASON,
    lastMeasuredSeason: LAST_MEASURED_SEASON,
    programmes: rowsByProgramme.size,
    movementByProgramme,
    arrivalsByProgramme,
    benchmarks: {
      overall: summarise(overall),
      byDivision: Object.fromEntries([...byDivision.entries()].map(([d, s]) => [d, summarise(s)])),
    },
    /**
     * Position intake by division, and across every division as a fallback.
     *
     * Keyed `division -> position`, with an `ALL` division for a programme
     * whose own division is too thin to compare against.
     */
    positionIntake,
    /** Minute concentration by division, and across every division. */
    utilisation,
    /** Minute and roster share by year of study, same keying. */
    experience,
    destinationCoverage: Object.fromEntries([...coverage.entries()].map(([d, c]) => [d, {
      ...c, coverage: c.departures ? c.observed / c.departures : null,
    }])),
    buildMs: Date.now() - started,
  };
}

export { TRANSITIONS, MATCH_STATUS, EXIT_KIND };
export { POSITIONS };
