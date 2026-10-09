/**
 * THE §4 ELIGIBILITY GATE — pure. Compares two measurement results
 * (coachEligibilityMeasurement.js), production against development. Opens no
 * database and decides nothing about any coach.
 */

/** The six pilot cells the §4 gate judges, each on its own. */
export const PILOT_DIVISIONS = Object.freeze(['NCAA D1', 'NCAA D2', 'NCAA D3']);
export const PILOT_SPORTS = Object.freeze(['mens-soccer', 'womens-soccer']);
export const PILOT_CELLS = Object.freeze(PILOT_DIVISIONS.flatMap((d) => PILOT_SPORTS.map((s) => `${d}|${s}`)));

/** The §4 criteria, as set on 2026-10-09 (preliminary). */
export const GATE = Object.freeze({ minCoverageRatio: 0.9, maxOptOutViolations: 0, maxUnexplainedLosses: 0 });

/**
 * The §4 criteria, production against development. Pure: compares two
 * results, decides nothing about any coach.
 */
export function evaluateGate(prod, dev, gate = GATE) {
  const cells = PILOT_CELLS.map((cell) => {
    const p = prod.e4[cell] ?? null; const d = dev.e4[cell] ?? null;
    const ratio = p?.coverage != null && d?.coverage ? p.coverage / d.coverage : null;
    // a hair of tolerance, so exactly 90% is not failed by floating point (0.72 / 0.8 = 0.8999...)
    const pass = d?.coverage ? ratio != null && ratio + 1e-9 >= gate.minCoverageRatio : null;
    return { cell, production: p?.coverage ?? null, development: d?.coverage ?? null, ratio, pass };
  });
  const coveragePass = cells.every((c) => c.pass === true);
  const optOutPass = prod.e8.violations <= gate.maxOptOutViolations;
  const explainedPass = prod.e5.unexplained <= gate.maxUnexplainedLosses;
  return {
    pass: coveragePass && optOutPass && explainedPass && prod.scope === dev.scope,
    scopeMatches: prod.scope === dev.scope,
    coverage: { pass: coveragePass, minRatio: gate.minCoverageRatio, cells },
    optOut: { pass: optOutPass, violations: prod.e8.violations },
    losses: { pass: explainedPass, lost: prod.e5.lost, unexplained: prod.e5.unexplained },
  };
}
