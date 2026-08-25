/**
 * The tuning surface: how much each criterion counts.
 *
 * These are the numbers the backtest harness moves and the operator UI
 * exposes. Nothing here describes the sport — that is constants.js — and
 * nothing here computes a sub-score — that is criteria.js. Keeping the knobs
 * in one file is what makes "re-run matching on weight change" a small change
 * rather than a rewrite.
 */

import { weightsFromRanking } from './couplings.js';

/** Stable order — the card renders the breakdown in this sequence. */
export const CRITERIA = [
  { key: 'athletic', label: 'Athletic fit' },
  { key: 'roster', label: 'Roster opportunity' },
  { key: 'academic', label: 'Academic fit' },
  { key: 'affordability', label: 'Affordability' },
  { key: 'programQuality', label: 'Program quality' },
  { key: 'geography', label: 'Location' },
];

export const CRITERION_KEYS = CRITERIA.map((c) => c.key);

/**
 * Starting weights, on an arbitrary scale that is normalised to sum to 1
 * before use. Only the ratios matter.
 *
 * Academic is absent because it is not a constant: it comes from the
 * athlete's own academic_import { weightsFromRanking } from './couplings.js';
importance slider. See academicWeight().
 *
 * Set from evidence on 2026-08-25, not by feel. `npm run backtest` ranks 600
 * real 2025 arrivals per sport using only 2024 data; against that,
 * geography:10 / roster:25 scored a mean percentile of 60.6% (men) and 60.0%
 * (women), and these weights score 83.3% and 80.9%.
 *
 * The two that moved, and why:
 *
 *   geography 10 -> 25   Half of all athletes enrol in their home state
 *                        (50.4% men, 45.8% women) at a median 145-165 miles
 *                        from home. It was the single most underweighted
 *                        thing in the model. Tuning alone would push it
 *                        higher still — a geography-only model scores 86.4%,
 *                        beating every mixed configuration — but that
 *                        describes a proximity sorter, not a recruiting tool,
 *                        so it is capped here well short of what the metric
 *                        would reward.
 *
 *   roster 25 -> 10      Held at 25 it actively hurt: departures at a
 *                        position correlate with arrivals across programmes
 *                        (r=0.375), but the school an athlete actually chose
 *                        scores no higher on opportunity (0.445) than a
 *                        programme drawn at random (0.447), so at 25 it was
 *                        mostly diluting the criteria that do discriminate.
 *
 * Keeping roster at 10 rather than 0 is a deliberate, measured trade: it
 * costs about 2 points of mean percentile and 6 of recall@25 against the
 * backtest. It is kept because that backtest measures where athletes *ended
 * up*, and opportunity is a claim about which coach *replies* — which
 * nothing can test until Phase 1.1 puts real engagement data in the database.
 * Revisit this number first when it does.
 */
export const DEFAULT_WEIGHTS = {
  athletic: 30,
  geography: 25,
  academic: 15,
  affordability: 15,
  roster: 10,
  programQuality: 10,
};

/**
 * Merge defaults, the athlete's ranking, any couplings and any operator
 * override into a single weight per criterion, normalised to sum to 1.
 *
 * An override of 0 is honoured — an operator who zeroes location means it.
 *
 * Academics used to come from a 0-10 importance slider on the intake form
 * rather than from the defaults. That slider was retired on 2026-08-25: once
 * criteria could be ranked, a ranking said the same thing better — "academics
 * matter more than cost, less than playing level" is a question a family can
 * answer, where "academics are 7/10 important" in a vacuum is not — and
 * whenever a ranking existed the slider was already being ignored. Two
 * controls on adjacent form steps expressing one preference is worse than
 * one. Intensity beyond what a ranking can express lives in `overrides`,
 * persisted as players.match_weights.
 */
export function resolveWeights({ overrides, ranking, couplings } = {}) {
  let raw = { ...DEFAULT_WEIGHTS };

  // An explicit ranking replaces the defaults outright — the athlete has said
  // what matters to them, and a default is only a stand-in for that.
  if (ranking) raw = weightsFromRanking(ranking, raw);

  // Then couplings: one stated priority making another criterion matter more.
  if (couplings) {
    for (const key of CRITERION_KEYS) {
      const m = couplings[key];
      if (Number.isFinite(m) && m > 0) raw[key] *= m;
    }
  }

  // Explicit overrides land last and win outright. An operator who has set a
  // number has overruled both the defaults and any coupling that fired.
  if (overrides) {
    for (const key of CRITERION_KEYS) {
      const v = overrides[key];
      if (v === null || v === undefined || v === '') continue;
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (Number.isFinite(n) && n >= 0) raw[key] = n;
    }
  }
  return normalise(raw);
}

/** Scale a weight map so its values sum to 1. An all-zero map falls back to equal weights. */
export function normalise(weights) {
  const total = CRITERION_KEYS.reduce((sum, k) => sum + (weights[k] || 0), 0);
  const out = {};
  if (total <= 0) {
    for (const k of CRITERION_KEYS) out[k] = 1 / CRITERION_KEYS.length;
    return out;
  }
  for (const k of CRITERION_KEYS) out[k] = (weights[k] || 0) / total;
  return out;
}
