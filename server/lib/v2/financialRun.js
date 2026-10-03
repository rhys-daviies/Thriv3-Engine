/**
 * Evaluate Financial Viability across a pool, and describe what came out.
 *
 * DELIBERATELY NOT A RANKER. It produces no order, no top 100 and no pursuit
 * priority, and it is not passed to `compare` in parallelRun.js. Sorting a
 * pool by one layer would produce a list that looks like a recommendation and
 * answers a question nobody asked: "which school is cheapest for this family"
 * is not "which school should this athlete pursue", and a financial-only list
 * compared against V1's overall rank would be comparing two different
 * questions and calling the difference a result.
 *
 * What it is for: seeing what the layer does to real data before anything
 * depends on it - how much of the pool it can price, where the unscoreable
 * ones are, and whether the distribution has collapsed or saturated.
 */
import { financialViability, isScoreable, GRADE, AID_POLICY_STATUS, CONTROL } from '../../../shared/matching/v2/index.js';

function summarise(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  return {
    n: s.length,
    min: Number(s[0].toFixed(4)),
    p10: Number(at(10).toFixed(4)),
    p25: Number(at(25).toFixed(4)),
    median: Number(at(50).toFixed(4)),
    p75: Number(at(75).toFixed(4)),
    p90: Number(at(90).toFixed(4)),
    max: Number(s[s.length - 1].toFixed(4)),
    mean: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(4)),
  };
}

function bump(map, key, scoreable, value) {
  if (!map[key]) map[key] = { n: 0, scoreable: 0, values: [] };
  map[key].n += 1;
  if (scoreable) { map[key].scoreable += 1; map[key].values.push(value); }
}

function finish(map) {
  return Object.fromEntries(Object.entries(map)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => [k, {
      n: v.n,
      scoreable: v.scoreable,
      scoreableRate: Number((v.scoreable / v.n).toFixed(4)),
      viability: summarise(v.values),
    }]));
}

/**
 * @param {object} p
 * @param {object} p.athlete  normalised athlete: { budgetRange, state, origin, sport }
 * @param {Array}  p.colleges raw college rows
 * @param {string} p.sport
 */
export function evaluateFinancial({ athlete, colleges, sport }) {
  const results = colleges.map((college) => ({
    id: college.id,
    name: college.name,
    division: college.division,
    control: college.control,
    state: college.state,
    result: financialViability({ athlete, college, sport }),
  }));

  const scored = results.filter((r) => isScoreable(r.result));
  const unscored = results.filter((r) => !isScoreable(r.result));
  const n = results.length || 1;

  const byDivision = {};
  const byControl = {};
  const byCostBasis = {};
  const byReason = {};
  const byAidPolicy = {};
  const grades = { [GRADE.MEASURED]: 0, [GRADE.PARTIAL]: 0 };

  for (const r of results) {
    const ok = isScoreable(r.result);
    const value = ok ? r.result.value : null;
    bump(byDivision, r.division ?? 'UNKNOWN', ok, value);
    const control = Number(r.control) === CONTROL.PUBLIC ? 'public'
      : (r.control === null || r.control === undefined ? 'control unknown' : 'private');
    bump(byControl, control, ok, value);

    // Present on both shapes: the aid state must survive a refusal to price.
    const aid = ok ? r.result.basis.aidPolicy : r.result.detail?.aidPolicy;
    byAidPolicy[aid ?? 'ABSENT'] = (byAidPolicy[aid ?? 'ABSENT'] || 0) + 1;

    if (ok) {
      grades[r.result.grade] += 1;
      byCostBasis[r.result.basis.costBasis] = (byCostBasis[r.result.basis.costBasis] || 0) + 1;
    } else {
      byReason[r.result.reason] = (byReason[r.result.reason] || 0) + 1;
    }
  }

  const unknownAid = byAidPolicy[AID_POLICY_STATUS.UNKNOWN] || 0;

  return {
    athlete: {
      sport, budgetRange: athlete.budgetRange ?? null,
      state: athlete.state ?? null, origin: athlete.origin ?? null,
      isInternational: String(athlete.origin || '').toUpperCase() === 'INTERNATIONAL',
    },
    counts: {
      programmes: results.length,
      scoreable: scored.length,
      unscoreable: unscored.length,
      scoreableRate: Number((scored.length / n).toFixed(4)),
      unscoreableRate: Number((unscored.length / n).toFixed(4)),
      // As a share of the WHOLE pool, so the three read as parts of one
      // hundred rather than two different denominators.
      measuredRate: Number((grades[GRADE.MEASURED] / n).toFixed(4)),
      partialRate: Number((grades[GRADE.PARTIAL] / n).toFixed(4)),
      aidPolicyUnknownRate: Number((unknownAid / n).toFixed(4)),
    },
    viability: summarise(scored.map((r) => r.result.value)),
    byDivision: finish(byDivision),
    byControl: finish(byControl),
    byCostBasis,
    byAidPolicy,
    unscoreableReasons: byReason,
    results,
  };
}

/** One programme, flattened to the fields a fixture report shows. */
export function financialRow(entry) {
  const r = entry.result;
  const common = { id: entry.id, name: entry.name, division: entry.division };
  if (!isScoreable(r)) {
    return {
      ...common,
      scoreable: false,
      reason: r.reason,
      coverage: r.coverage,
      missing: [...r.missing],
      aidPolicy: r.detail?.aidPolicy ?? null,
    };
  }
  const b = r.basis;
  return {
    ...common,
    scoreable: true,
    viability: Number(r.value.toFixed(4)),
    viabilityRange: b.viabilityRange.map((v) => Number(v.toFixed(4))),
    grade: r.grade,
    coverage: r.coverage,
    costBasis: b.costBasis,
    applicableCostRange: b.applicableCostRange,
    budgetRange: b.budgetRange,
    familyContributionRange: b.familyContributionRange,
    fundingGapRange: b.fundingGapRange,
    aidPolicy: b.aidPolicy,
    aidPolicyKnown: b.aidPolicyKnown,
    aidRule: b.aidRule,
    aidHeadroomFraction: b.aidHeadroomFraction,
  };
}
