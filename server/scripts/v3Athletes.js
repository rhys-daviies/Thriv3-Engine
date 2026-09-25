/**
 * The six athletes A7.13 validates. Data only. Nothing here runs.
 *
 * -- PRODUCTION SHAPE, NOT HARNESS SHAPE ----------------------------------
 *
 * Every one of these states all three preferences and an EXACT family
 * contribution, because that is what an athlete created through the product
 * after 3056215 carries. A7.12 found the harness could build shapes
 * production could not; generating V3 on one of those would validate a model
 * nobody can actually run.
 *
 * -- WHY THE CONTRIBUTIONS ARE STATED RATHER THAN BANDS -------------------
 *
 * The A-H fixtures carry legacy budget bands, which A7.9.3 retired from new
 * intake. For the two `$40k+/yr` athletes the conversion is free and proven:
 * A7.9.2 established that an open band with no ceiling is scored at the floor
 * the family did state, and re-measured here at A7.13 the substitution moves
 * 0 of 858 programmes on F, on P or on rank - it only lifts Financial from
 * PARTIAL to MEASURED, which is a statement about evidence and not about
 * money.
 *
 * FOR THE BOUNDED BANDS IT IS NOT A CONVERSION AND IS NOT PRESENTED AS ONE.
 * A band states an interval; a maximum is a point inside it, and deriving one
 * would manufacture the number A7.9.1 spent a phase proving we did not have.
 * Those athletes state a new exact figure, `contributionIsNewAnswer` says so,
 * and their lists are NOT claimed to reproduce the fixture's.
 */

/** Shared by every V3 athlete: the columns `normaliseAthlete` reads. */
const BASE = {
  act_score: null,
  academic_minimum: null,
  preferred_divisions: '[]',
  preferred_conferences: '[]',
  match_weights: null,
  criterion_ranking: null,
  budget_range: null,
};

export const V3_ATHLETES = [
  {
    id: 'V3-A-elite-level-focused',
    role: 'ELITE / LEVEL-FOCUSED',
    basedOn: 'A-strong-high-budget-strong-academics',
    eliteOversample: true,
    contributionIsNewAnswer: false,
    /**
     * The athlete A7.12's open question is about. A rating-9 midfielder who
     * has said, in the product's own words, that competing at the highest
     * realistic level is extremely important and a clear path to playing time
     * is not. If the model's preference for weaker programmes with better
     * vacancy evidence is wrong anywhere, it is wrong here.
     */
    why: 'A7.12 measured that 97 of this athlete\'s first hundred sit more than 15 strength points '
      + 'below them and near-level programmes take 0 places, with the mechanism identified: athletic '
      + 'plausibility is saturated on 99 of the top 100, so Recruitability orders on vacancy and '
      + 'market alone. This pack asks a human whether that list is the right outreach list.',
    player: {
      ...BASE,
      sport: 'mens-soccer', football_ability: 9, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.9, sat_score: 1450,
      state: 'CA', city: 'Los Angeles', nationality: 'USA', origin: 'USA',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 40000,
      competitive_level_priority: 5,
      playing_opportunity_priority: 1,
      academic_strength_priority: 3,
    },
  },
  {
    id: 'V3-B-elite-balanced',
    role: 'ELITE / BALANCED',
    basedOn: 'A-strong-high-budget-strong-academics',
    eliteOversample: true,
    contributionIsNewAnswer: false,
    /**
     * The control for V3-A. Same athlete, same money, same universe; the only
     * difference is that they have not told us level matters more than
     * anything. If the reviewer wants a stronger list here too, the finding is
     * about the model rather than about the preference.
     */
    why: 'The same athlete as V3-A with every preference at the neutral midpoint, so the effect of '
      + 'the stated level preference can be read off the difference rather than assumed.',
    player: {
      ...BASE,
      sport: 'mens-soccer', football_ability: 9, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 3.9, sat_score: 1450,
      state: 'CA', city: 'Los Angeles', nationality: 'USA', origin: 'USA',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 40000,
      competitive_level_priority: 3,
      playing_opportunity_priority: 3,
      academic_strength_priority: 3,
    },
  },
  {
    id: 'V3-C-strong-playing-focused',
    role: 'STRONG / PLAYING-FOCUSED',
    basedOn: 'F-international',
    eliteOversample: false,
    contributionIsNewAnswer: true,
    /**
     * The opposite preference to V3-A on the same axis, on an athlete strong
     * enough to have options and not elite enough for plausibility to
     * saturate. Also the only international in the set, so the market arm and
     * the non-resident cost basis are exercised.
     */
    why: 'A strong but not elite athlete who has said playing time matters far more than level. '
      + 'Tests the other end of the axis V3-A tests, on a profile where athletic plausibility still '
      + 'discriminates (A7.12: 56% MEASURED against the elite athlete\'s saturation).',
    player: {
      ...BASE,
      sport: 'mens-soccer', football_ability: 7, position: 'Forward',
      recruiting_class_year: 2028, gpa: 3.3, sat_score: null,
      state: null, city: null, nationality: 'England', origin: 'International',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 18000,
      competitive_level_priority: 2,
      playing_opportunity_priority: 5,
      academic_strength_priority: 3,
    },
  },
  {
    id: 'V3-D-developmental-balanced',
    role: 'DEVELOPMENTAL / BALANCED',
    basedOn: 'C-developmental-high-budget-strong-academics',
    eliteOversample: false,
    contributionIsNewAnswer: false,
    /**
     * The case the model already handles well, on A7.12's own numbers: 71 of
     * the top hundred near level, nothing far above, the R gate firing on 87%
     * of the pool. It is in the set as a control - a reviewer who also wants
     * this list changed is telling us something different from one who wants
     * only the elite lists changed.
     */
    why: 'The developmental control. A7.12 found this athlete\'s list behaves as designed, so a '
      + 'reviewer dissatisfied here is reporting something other than the elite-saturation finding.',
    player: {
      ...BASE,
      sport: 'mens-soccer', football_ability: 3, position: 'Midfielder',
      recruiting_class_year: 2028, gpa: 4.0, sat_score: 1550,
      state: 'MA', city: 'Boston', nationality: 'USA', origin: 'USA',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 40000,
      competitive_level_priority: 3,
      playing_opportunity_priority: 3,
      academic_strength_priority: 3,
    },
  },
  {
    id: 'V3-E-academic-priority',
    role: 'ACADEMIC-PRIORITY',
    basedOn: 'E-domestic-in-state-public',
    eliteOversample: false,
    contributionIsNewAnswer: true,
    /**
     * The only athlete in the set with an intended major, which makes this the
     * only pack where majorFit scores at all. A7.12 recorded that it is a
     * binary keyword match carrying 0.233 of a declared athlete's Opportunity;
     * "Engineering" is chosen over "Business" because it matches 33% of the
     * universe rather than 94%, so the component actually discriminates and
     * the reviewer can see whether it discriminates sensibly.
     */
    why: 'Academic strength stated as the highest priority, with an intended major, on a mid-level '
      + 'domestic athlete. The only pack in which majorFit and academicStrengthFit both score.',
    player: {
      ...BASE,
      sport: 'mens-soccer', football_ability: 6, position: 'Defender',
      recruiting_class_year: 2028, gpa: 3.4, sat_score: 1150,
      state: 'TX', city: 'Austin', nationality: 'USA', origin: 'USA',
      intended_major: 'Engineering',
      contribution_state: 'STATED', max_annual_contribution_usd: 13000,
      competitive_level_priority: 3,
      playing_opportunity_priority: 3,
      academic_strength_priority: 5,
    },
  },
  {
    id: 'V3-F-financially-constrained',
    role: 'FINANCIALLY CONSTRAINED',
    basedOn: 'B-strong-low-budget',
    eliteOversample: true,
    contributionIsNewAnswer: true,
    /**
     * Broad athletic options, tight money. A7.12 measured the financial gate
     * firing on 87% of this athlete's ranked pool and Financial correlating
     * more strongly with Pursuit than Recruitability does - the one fixture
     * where money, not level, decides the list. The reviewer is the only one
     * who can say whether that is the right outreach list for a family who
     * stated $8,000.
     */
    why: 'The fixture where Financial has more authority over the ranking than Recruitability '
      + '(A7.12: corr F x P 0.752 against R x P 0.546, gate firing on 87%). Tests whether money '
      + 'reshapes the list in a way a consultant would actually stand behind.',
    /**
     * -- A7.15: AN AUTHORISED EDIT TO A FROZEN SPECIFICATION ----------------
     *
     * A7.13 cut this athlete from fixture B and V3-B from fixture A, so the
     * two arrived carrying different academic profiles as well as different
     * money. A7.15 asks one question - does a restrictive Financial layer
     * counterbalance the Recruitability pathology V3-B established - and that
     * question needs contribution to be the only thing that moved.
     *
     * GPA and SAT were measured against the full 1,166-programme universe
     * BEFORE this edit, not after: substituting V3-B's 3.9/1450 for the
     * original 3.2/null moved 0 of 858 ranked programmes, gave a maximum
     * |dPursuit| and |dOpportunity| of exactly 0, left the top 100 identical
     * by membership and left the equivalent programme strength at 83.58. They
     * are not scoring inputs, which is what athleteInput.js has always said
     * and what this now demonstrates rather than asserts.
     *
     * They ARE printed on the blind sheet, so an evaluator would have seen a
     * different academic profile beside the different budget and could quite
     * reasonably have let it move their answer on a selective programme. That
     * is the confound this edit removes, and it is an evaluator confound
     * rather than a model one.
     *
     * `contributionIsNewAnswer` stays true. The $8,000 is still a newly
     * stated figure rather than a band conversion, and that provenance is
     * unaffected by anything here.
     */
    controlledModification: Object.freeze({
      phase: 'A7.15',
      authorisedBy: 'explicit operator instruction, recorded in the A7.15 brief',
      reason: 'isolate Financial as the sole experimental variable against V3-B',
      preregistered: { gpa: 3.2, sat_score: null, max_annual_contribution_usd: 8000 },
      applied: { gpa: 3.9, sat_score: 1450, max_annual_contribution_usd: 8000 },
      proofBeforeModification: {
        rankMovements: '0 of 858 ranked programmes',
        maxAbsPursuitDelta: 0,
        maxAbsOpportunityDelta: 0,
        top100Membership: 'identical',
        equivalentProgrammeStrength: 'identical at 83.58',
      },
      unchanged: ['contributionIsNewAnswer', 'basedOn', 'every preference', 'every other player field'],
    }),
    player: {
      ...BASE,
      sport: 'mens-soccer', football_ability: 9, position: 'Midfielder',
      // A7.15 controlled modification; preregistered at A7.13 as 3.2 / null.
      recruiting_class_year: 2028, gpa: 3.9, sat_score: 1450,
      state: 'CA', city: 'Los Angeles', nationality: 'USA', origin: 'USA',
      intended_major: null,
      contribution_state: 'STATED', max_annual_contribution_usd: 8000,
      competitive_level_priority: 3,
      playing_opportunity_priority: 3,
      academic_strength_priority: 3,
    },
  },
];

export const v3Athlete = (key) => V3_ATHLETES.find(
  (a) => a.id.toUpperCase().startsWith(`V3-${String(key).toUpperCase()}-`),
) ?? null;
