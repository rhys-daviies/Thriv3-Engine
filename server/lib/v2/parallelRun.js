/**
 * Run two rankers over the same athlete and pool, and describe the difference.
 *
 * WHY THIS IS BUILT BEFORE THERE IS ANYTHING TO COMPARE. The A6.2 order put the
 * harness last. Built last, seven layers land one after another with no way to
 * see what any of them does to a real list, and by the time the harness exists
 * the question is "why has everything moved" rather than "what did this layer
 * do". Built first, against V1 alone, it proves the comparison machinery itself
 * before that machinery is load-bearing.
 *
 * At A7.1 there is no V2 scorer, so the only comparison available is V1 against
 * V1. That is not a trivial test: it is what establishes that the diff is
 * deterministic, that the rank join is correct, and that a zero difference is
 * reported as a zero rather than as an empty section that would also look like
 * agreement.
 *
 * READ-ONLY. This adopts nothing, writes nothing, and is not wired into any
 * route. Its output is a report for a person to read.
 *
 * THE ADOPTION RULE, written here so it cannot be quietly dropped: V2 is NOT
 * adopted on destination recall. The backtest ranks where athletes ended up,
 * which is decided as much by who recruited and offered first as by fit -
 * measured directly, opportunity at the chosen school (0.445) is no higher than
 * at a random programme (0.447). Recall may be REPORTED as a sanity check. It
 * may never be the acceptance criterion.
 */
import { rankMatches } from '../../../shared/matching/pool.js';
import { RANKING_STATE, isScoreable } from '../../../shared/matching/v2/index.js';

export const TOP_N = 100;

/**
 * The shape both rankers are reduced to before anything is compared.
 *
 * Deliberately small. A diff that reads twenty fields is a diff that fails for
 * twenty reasons, most of them presentation.
 */
function entry({ id, name, division, score, rankingState, layers = null, coverage = null, reasons = [] }) {
  return { id, name, division, score, rankingState, layers, coverage, reasons };
}

/**
 * V1, in that shape.
 *
 * V1 has no layers, no coverage and no ranking states - every programme it
 * returns is ranked, because being unable to say otherwise is the thing V2
 * exists to fix. Those fields are null here rather than filled with plausible
 * numbers: an empty column is a fact, and a fabricated one is a lie that would
 * make the harness agree with itself.
 */
export function v1Ranker({ athlete, colleges, rosterIndex }) {
  const ranked = rankMatches({ athlete, colleges, rosterIndex });
  return {
    label: 'v1',
    poolSize: ranked.poolSize,
    excluded: ranked.excluded?.length ?? 0,
    results: ranked.results.map((r) => entry({
      id: r.id,
      name: r.name,
      division: r.division,
      score: r.match_score,
      rankingState: RANKING_STATE.RANKED,
    })),
  };
}

function rankIndex(results) {
  return new Map(results.map((r, i) => [r.id, i + 1]));
}

function composition(results, n = TOP_N) {
  const counts = new Map();
  for (const r of results.slice(0, n)) counts.set(r.division, (counts.get(r.division) || 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function summarise(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  return {
    n: s.length,
    min: s[0],
    p25: at(25),
    median: at(50),
    p75: at(75),
    max: s[s.length - 1],
    mean: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(6)),
  };
}

/**
 * The layer, coverage and gate sections.
 *
 * `applicable: false` is the honest answer while the candidate is V1: these
 * metrics describe a layered model and there is not one yet. Every section
 * keeps its shape so that the report does not change structure the day a layer
 * lands - only its contents.
 */
function layerDiagnostics(results) {
  const layered = results.filter((r) => r.layers !== null);
  if (layered.length === 0) {
    return {
      applicable: false,
      note: 'the candidate reports no layers, so there are no layer or coverage distributions to describe',
      distributions: {},
      coverage: {},
    };
  }
  const keys = [...new Set(layered.flatMap((r) => Object.keys(r.layers)))].sort();
  const distributions = {};
  const coverage = {};
  for (const k of keys) {
    const scored = layered.map((r) => r.layers[k]).filter((x) => isScoreable(x));
    distributions[k] = summarise(scored.map((x) => x.value));
    coverage[k] = summarise(layered.map((r) => r.layers[k]).filter(Boolean).map((x) => x.coverage));
  }
  return { applicable: true, distributions, coverage };
}

function limitedDataDiagnostics(results) {
  const limited = results.filter((r) => r.rankingState === RANKING_STATE.LIMITED_DATA);
  const byDivision = {};
  const byReason = {};
  for (const r of limited) {
    byDivision[r.division] = (byDivision[r.division] || 0) + 1;
    for (const reason of r.reasons) byReason[reason] = (byReason[reason] || 0) + 1;
  }
  return { count: limited.length, byDivision, byReason };
}

/**
 * The violation that must always be zero.
 *
 * A programme with no pursuit priority must never appear above one that has
 * been measured. This is the neutral-prior inversion in its most direct form,
 * and it is checked as a count rather than described, so that it can be
 * asserted rather than read.
 */
function unscoreableOutranksMeasured(results) {
  let seenLimited = false;
  let violations = 0;
  const examples = [];
  for (const [i, r] of results.entries()) {
    if (r.rankingState === RANKING_STATE.LIMITED_DATA) { seenLimited = true; continue; }
    if (r.rankingState === RANKING_STATE.RANKED && seenLimited) {
      violations += 1;
      if (examples.length < 5) examples.push({ rank: i + 1, name: r.name });
    }
  }
  return { violations, examples };
}

/**
 * @param {object} p
 * @param {object} p.athlete    a normalised athlete
 * @param {Array}  p.colleges
 * @param {Map}    p.rosterIndex
 * @param {Function} [p.baseline]   defaults to frozen V1
 * @param {Function} [p.candidate]  defaults to frozen V1 - i.e. V1 against itself
 */
export function compare({ athlete, colleges, rosterIndex, baseline = v1Ranker, candidate = v1Ranker }) {
  const a = baseline({ athlete, colleges, rosterIndex });
  const b = candidate({ athlete, colleges, rosterIndex });

  const aRank = rankIndex(a.results);
  const bRank = rankIndex(b.results);
  const aTop = new Set(a.results.slice(0, TOP_N).map((r) => r.id));
  const bTop = new Set(b.results.slice(0, TOP_N).map((r) => r.id));

  const movements = [];
  for (const r of b.results) {
    const before = aRank.get(r.id);
    const after = bRank.get(r.id);
    if (before === undefined) {
      // In the candidate's pool and not the baseline's. Recorded, not scored -
      // a pool difference is a different finding from a rank difference.
      movements.push({ id: r.id, name: r.name, division: r.division, before: null, after, delta: null });
      continue;
    }
    movements.push({ id: r.id, name: r.name, division: r.division, before, after, delta: after - before });
  }

  const moved = movements.filter((m) => m.delta !== null && m.delta !== 0);
  const entered = [...bTop].filter((id) => !aTop.has(id));
  const left = [...aTop].filter((id) => !bTop.has(id));
  const name = new Map([...a.results, ...b.results].map((r) => [r.id, r.name]));

  return {
    athlete: { sport: athlete.sport, position: athlete.position, classYear: athlete.classYear },
    baseline: { label: a.label ?? 'baseline', poolSize: a.poolSize, ranked: a.results.length },
    candidate: { label: b.label ?? 'candidate', poolSize: b.poolSize, ranked: b.results.length },
    diagnostics: {
      rank: {
        compared: movements.filter((m) => m.delta !== null).length,
        moved: moved.length,
        onlyInCandidate: movements.filter((m) => m.before === null).length,
        onlyInBaseline: a.results.filter((r) => !bRank.has(r.id)).length,
        maxAbsDelta: moved.reduce((mx, m) => Math.max(mx, Math.abs(m.delta)), 0),
        meanAbsDelta: moved.length === 0 ? 0
          : Number((moved.reduce((s, m) => s + Math.abs(m.delta), 0) / movements.length).toFixed(6)),
        largest: [...moved].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 20),
      },
      topN: {
        n: TOP_N,
        entered: entered.map((id) => ({ id, name: name.get(id), rank: bRank.get(id) })),
        left: left.map((id) => ({ id, name: name.get(id), rank: aRank.get(id) })),
        enteredCount: entered.length,
        leftCount: left.length,
      },
      divisionComposition: {
        baseline: composition(a.results),
        candidate: composition(b.results),
        // Named separately from the two maps so a sweep is a boolean, not a
        // thing the reader has to spot by eye across two columns.
        identical: JSON.stringify(composition(a.results)) === JSON.stringify(composition(b.results)),
      },
      layers: layerDiagnostics(b.results),
      limitedData: limitedDataDiagnostics(b.results),
      // Gates do not exist yet. The section is present and empty rather than
      // absent, so that its appearance later is visible as a change.
      gates: { applicable: false, firedByDivision: {}, note: 'no gates at A7.1' },
      // Requires an athletic-plausibility layer, which A7.1 does not build.
      lowPlausibilityInTopN: { applicable: false, count: null, note: 'requires the athletic plausibility layer' },
      violations: {
        unscoreableOutranksMeasured: unscoreableOutranksMeasured(b.results),
      },
    },
    movements,
  };
}

/** True when the candidate reproduced the baseline exactly. */
export function isIdentical(report) {
  const d = report.diagnostics;
  return d.rank.moved === 0
    && d.rank.onlyInCandidate === 0
    && d.rank.onlyInBaseline === 0
    && d.topN.enteredCount === 0
    && d.topN.leftCount === 0
    && d.divisionComposition.identical
    && d.violations.unscoreableOutranksMeasured.violations === 0;
}
