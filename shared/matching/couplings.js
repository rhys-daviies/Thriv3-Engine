/**
 * How one stated priority changes the scoring of the others.
 *
 * The six criteria are not independent, and treating them as a flat weighted
 * sum quietly gets things wrong. An athlete who needs a scholarship does not
 * merely "care about cost more" — for them, staying in state is cheaper by
 * $5,245 to $17,871 a year, D3 is the most expensive option on the board
 * *and* forbidden from offering athletic money, junior college costs a third
 * of everything else, and being clearly the best player in a squad is worth
 * real money in a sport where the scholarship pool is split by hand.
 *
 * None of that is expressible as a weight on affordability alone. So this
 * layer runs before scoring and produces two things:
 *
 *   weights  multipliers on the base weights — "this priority makes that
 *            other criterion matter more"
 *   shapes   parameter overrides for a criterion's own curve — "this
 *            priority changes what a good result even looks like"
 *
 * Every rule is named, carries its reasoning, and declares whether it rests on
 * something measured or on a domain assumption. Read `evidence` before
 * trusting one: `measured` rules were checked against this database, `assumed`
 * rules are recruiting knowledge nothing here can currently verify, and they
 * should be the first suspects when results look wrong.
 */

/**
 * How badly the athlete needs money, 0..1.
 *
 * Derived from the budget band rather than asked directly, because the form
 * asks what a family can pay and that is the same question from the other end.
 */
export function scholarshipNeed(budgetRange) {
  switch (budgetRange) {
    case 'Need Full Scholarship': return 1;
    case 'Under $15k/yr': return 0.8;
    case '$15k-$30k/yr': return 0.5;
    case '$30k-$50k/yr': return 0.2;
    case '$50k+/yr': return 0;
    default: return null; // not stated — no coupling fires
  }
}

/**
 * Normalised academic weight at which academics counts as a stated priority.
 *
 * 0.16 is roughly where the retired importance slider used to trip at 7/10,
 * so behaviour is unchanged for an athlete who had set it there — it is just
 * now derived from what academics actually carries rather than from a second
 * control that a ranking had already overruled.
 */
export const ACADEMIC_PRIORITY_THRESHOLD = 0.16;

/** Where athleticFit peaks for an athlete with no particular money pressure. */
export const BASE_PEAK_OFFSET = 4;
/** Where it peaks for an athlete who needs a full scholarship. */
export const MAX_NEED_PEAK_OFFSET = 18;

export const COUPLINGS = [
  {
    name: 'need-favours-staying-in-state',
    why: 'Out-of-state study at a public institution costs $5,245 more a year at NJCAA and $17,871 more at NCAA D1. For a family at the "Under $15k" band that premium alone exceeds the whole budget, so proximity stops being a preference and becomes a cost constraint.',
    evidence: 'measured',
    apply: ({ need, origin }, out) => {
      if (need === null || need < 0.4) return;
      // There is no in-state rate for someone with no home state. The
      // international coupling below covers that case on its own terms.
      if (origin === 'International') return;
      out.weights.geography *= 1 + 0.8 * need;
      out.notes.push(`Location weighted up: in-state study is materially cheaper and this athlete needs it to be.`);
    },
  },
  {
    name: 'need-raises-affordability',
    why: 'Stating a low budget is stating that cost is a first-order criterion. Left on the default weight it is outvoted by fit and location on almost every card.',
    evidence: 'measured',
    apply: ({ need }, out) => {
      if (need === null || need < 0.4) return;
      out.weights.affordability *= 1 + 1.2 * need;
      out.notes.push('Affordability weighted up to match the stated budget.');
    },
  },
  {
    name: 'need-shifts-athletic-peak-upward',
    why: 'Soccer scholarships are equivalencies split across a squad by hand, so the money follows the players a coach most wants. A recruit clearly above a programme\'s level is a priority signing and commands a larger share; the marginal signing at a stronger programme commands little or none. For an athlete who needs money, the best-fitting programme is therefore a weaker one than pure playing-level fit would choose.',
    evidence: 'assumed — no per-player award data exists anywhere in this database to test it against',
    // Sibling of expectedAward() in criteria.js, which prices the same effect
    // rather than steering by it: there, being above a programme's level
    // raises the award we expect; here, it moves where "best fit" sits.
    apply: ({ need }, out) => {
      if (need === null || need < 0.4) return;
      out.shapes.athletic.peakOffset = BASE_PEAK_OFFSET + (MAX_NEED_PEAK_OFFSET - BASE_PEAK_OFFSET) * need;
      out.notes.push('Steered toward programmes where this athlete would be a standout, which is where scholarship money goes.');
    },
  },
  {
    name: 'international-raises-location',
    why: 'For an athlete coming from overseas the location criterion stops measuring preference and starts measuring feasibility: a programme with no international players has none of the machinery — visa paperwork, the eligibility clearinghouse, a recruiting network abroad — and 105 of the men\'s programmes in this database carry none at all. Weighted at its default it is outvoted by criteria that assume the athlete can get there.',
    evidence: 'assumed — the spread is measured (105 programmes carry no internationals, 116 are above 60%), but that it predicts where an international athlete lands is reasoning. Accepted deliberately on 2026-08-25; the backtest builds domestic athletes only and cannot test it.',
    apply: ({ origin }, out) => {
      if (origin !== 'International') return;
      out.weights.geography *= 1.6;
      out.notes.push('Location weighted up: it now measures whether this program recruits internationally at all, not how far from home it is.');
    },
  },
  {
    name: 'academic-priority-needs-admissibility',
    why: 'An athlete who ranks academics highly is being shown selective institutions, and a selective institution they cannot get into is not a match. Weighting academics up without also caring whether they are admissible produces a list of impossible schools.',
    evidence: 'measured',
    // Reads the weight academics actually carries, not the retired 0-10
    // slider. While it read the slider the two could contradict each other:
    // academics ranked first with the slider at "Not Important" got a 26.7%
    // weight and no tightening, and academics ranked last with the slider at 9
    // got 7% and the strictest test. Safe to read the pre-coupling weight
    // because no coupling multiplies academic's own weight.
    apply: ({ academicWeight }, out) => {
      if (!Number.isFinite(academicWeight) || academicWeight < ACADEMIC_PRIORITY_THRESHOLD) return;
      out.shapes.academic.admissibilityFloor = 0.25;
      out.notes.push('Academic reaches discounted harder, since academics are a stated priority.');
    },
  },
];

/**
 * Resolve an athlete's priorities into weight multipliers and shape overrides.
 *
 * Returns `notes` alongside them: every coupling that fired explains itself in
 * one sentence, so a card can say *why* it was ranked the way it was rather
 * than presenting a number the athlete has to take on faith.
 */
export function resolveCouplings(athlete, { academicWeight = null } = {}) {
  const out = {
    weights: { athletic: 1, roster: 1, academic: 1, affordability: 1, programQuality: 1, geography: 1 },
    shapes: { athletic: {}, academic: {}, affordability: {}, geography: {}, roster: {}, programQuality: {} },
    notes: [],
    fired: [],
  };
  const context = {
    need: scholarshipNeed(athlete?.budgetRange),
    academicWeight,
    state: athlete?.state,
    origin: athlete?.origin,
  };
  for (const rule of COUPLINGS) {
    const before = out.notes.length;
    rule.apply(context, out);
    if (out.notes.length > before) out.fired.push(rule.name);
  }
  return out;
}

/**
 * Turn an operator's ranking of the criteria into weights.
 *
 * The deck's promise is that the athlete ranks what matters to them and the
 * list re-orders accordingly, so a ranking has to be a first-class input
 * rather than something the operator translates into numbers by hand.
 *
 * Ranks are 1-best, and the decay is geometric rather than linear.
 *
 * It was linear — top rank four times bottom — and first place came out at
 * 26.7% of the total, which did not mean what an operator ranking academics
 * first expected it to mean: a programme merely good on the other five could
 * still outrank a strong one on the criterion they had named as most
 * important. Steepening a linear ramp barely helps, because lowering the tail
 * lowers the denominator too — going from 4x to 8x moves first place from
 * 26.7% only as far as 29.6%. Geometric decay concentrates the weight where a
 * ranking says it should be: first place is now ~38%.
 *
 * Not so steep that the tail disappears. Sixth place still carries ~4.4%,
 * because a ranking says which criteria matter *more*, not which to switch
 * off — anything the operator wants genuinely excluded should be set to zero
 * through the weight override, which is a different and deliberate statement.
 */
export const RANKING_DECAY = 0.65;

export function weightsFromRanking(ranking, base) {
  if (!Array.isArray(ranking) || !ranking.length) return { ...base };
  const out = { ...base };
  ranking.forEach((key, i) => {
    if (!(key in out)) return;
    out[key] = 40 * RANKING_DECAY ** i;
  });
  return out;
}
