/**
 * A8.0B — THE COVERAGE FIXTURE, AND THE COUNTERFACTUALS BUILT FROM IT.
 *
 * A8.0 froze with one acceptance category unassessable: no reference athlete
 * declares a major, so `majorFit` returned `notApplicable` for all 12,484
 * cells and the component could not be validated at all.
 *
 * -- WHY THIS IS A SEPARATE FILE ------------------------------------------
 *
 * The obvious place for a new athlete is `v2ValidationFixtures.js`. That file
 * is read by `a8Baseline.js`, so adding anything to it would change the A8.0
 * baseline the next time it was rebuilt - silently retiring the digest this
 * phase exists to preserve. A-H and the two A8.0 validation athletes are
 * untouched, and nothing here is imported by `a8Baseline.js`.
 *
 * Everything below is a VALIDATION FIXTURE, not a reference athlete. None of
 * it is pinned in a regression baseline and none of it describes a person.
 */

/**
 * WHY KINESIOLOGY, DECIDED AND WRITTEN DOWN BEFORE ANY RANKING WAS GENERATED.
 *
 * The major was selected on the distribution of `colleges.notable_majors`
 * alone - programme evidence, never a ranking - against four criteria fixed in
 * advance:
 *
 *   1. BOTH BRANCHES CARRY MASS. Of the 917 supported men's programmes, 457
 *      list Kinesiology and 451 do not (49.8%); women's is 617 / 604 (50.2%).
 *      It is the most balanced of the fourteen families in both sports, so
 *      neither the match arm nor the non-match arm is a corner case. Business
 *      (92.8%) and Mathematics (7.9%) would each have made one branch a
 *      rounding error.
 *
 *   2. A NON-EMPTY THIRD BUCKET. 9 men's and 8 women's supported programmes
 *      carry no major evidence at all, so NO_PROGRAMME_MAJOR_EVIDENCE is
 *      exercised rather than hypothetical.
 *
 *   3. THE SMALLEST DIVISION SKEW AVAILABLE. Major provision genuinely differs
 *      by institution type, so no family is evenly spread. Kinesiology's
 *      spread across the four supported divisions is 25.6 points (D1 36.6% to
 *      NAIA 62.2%); the next most balanced family, Art & Design, spreads 32.0.
 *
 *   4. THE SKEW RUNS AGAINST THE INCUMBENT ORDERING. Kinesiology is RAREST at
 *      Division I - which is where V2's top ranks already concentrate, 25 of
 *      25 in the A8.0 top 25 for fixture A. A declared Kinesiology major
 *      therefore pushes AGAINST the schools currently at the top, so this
 *      choice cannot flatter the existing ranking. That is the property that
 *      matters most: the major was picked to be awkward, not favourable.
 *
 * `intended_major` is stored as the free text `'exercise science'` rather than
 * the canonical label, because that is how intake data actually arrives and it
 * exercises the synonym mapping in `academicMajors.js` end to end.
 */
export const MAJOR_SELECTION = Object.freeze({
  major: 'exercise science',
  canonicalFamily: 'Kinesiology',
  decidedBefore: 'any ranking was generated',
  mensMatch: 457,
  mensNonMatch: 451,
  mensNoEvidence: 9,
  womensMatch: 617,
  womensNonMatch: 604,
  womensNoEvidence: 8,
  divisionSpreadPoints: 25.6,
  rarestDivision: 'NCAA D1',
});

/**
 * The one new athlete. Deliberately unremarkable in every dimension except the
 * declared major, so the counterfactual in §D isolates `majorFit` rather than
 * some interaction with an extreme rating or budget.
 *
 * Women's soccer, because the major balance is marginally better there
 * (50.2% against 49.8%) and because A8.0 recorded the women's game as thinly
 * covered - two athletes of ten.
 */
export const COVERAGE_FIXTURE = Object.freeze({
  id: 'X-declared-major',
  validationOnly: true,
  synthetic: true,
  why: 'The only athlete that declares a major. Exercises majorFit end to end; '
    + 'everything else about her is mid-distribution so the major is the variable.',
  recruitType: 'HIGH_SCHOOL',
  player: Object.freeze({
    sport: 'womens-soccer',
    football_ability: 6,
    position: 'Midfielder',
    recruiting_class_year: 2028,
    gpa: 3.4,
    sat_score: 1150,
    act_score: null,
    budget_range: '$20k-$25k/yr',
    state: 'PA',
    city: 'Allentown',
    nationality: 'USA',
    origin: 'USA',
    academic_minimum: null,
    intended_major: 'exercise science',
    preferred_divisions: '[]',
    preferred_conferences: '[]',
    match_weights: null,
    criterion_ranking: null,
  }),
});

/**
 * One counterfactual arm.
 *
 * `patch` is applied over the fixture's player and NOTHING else changes, which
 * is what makes each arm a controlled comparison rather than a second athlete.
 * `differsBy` names the fields the arm is allowed to differ in; the tests
 * assert that no other field moved, so an arm cannot quietly become a
 * different person.
 */
const arm = (id, base, patch, { against, differsBy, why }) => Object.freeze({
  id, baseId: base.id, patch: Object.freeze(patch), against, differsBy: Object.freeze(differsBy), why,
  player: Object.freeze({ ...base.player, ...patch }),
});

/** §D. The same athlete with no major stated. Not a permanent athlete. */
export const MAJOR_ARMS = Object.freeze([
  arm('X-declared-major', COVERAGE_FIXTURE, {}, {
    against: null, differsBy: [],
    why: 'The declared-major condition.',
  }),
  arm('X-null-major', COVERAGE_FIXTURE, { intended_major: null }, {
    against: 'X-declared-major', differsBy: ['intended_major'],
    why: 'Byte-identical but for the major. Establishes majorFit authority without '
      + 'anyone deciding which schools SHOULD rise.',
  }),
]);

/**
 * §E. The supported contribution states, on one existing A8.0 validation
 * athlete rather than a new one.
 *
 * `V-WMID-womens` already declares `$20k-$25k/yr` through the legacy
 * `budget_range` path. These arms drive the three states A7.48B reconciled -
 * STATED, NOT_A_CONSTRAINT, NEEDS_CONFIRMATION - plus the fully undeclared
 * case, so that "no financial answer" can be shown not to collapse to zero.
 */
export const FINANCIAL_PATCHES = Object.freeze([
  { id: 'F-stated-10k', patch: { budget_range: null, contribution_state: 'STATED', max_annual_contribution_usd: 10000 }, why: 'A modest stated contribution.' },
  { id: 'F-stated-40k', patch: { budget_range: null, contribution_state: 'STATED', max_annual_contribution_usd: 40000 }, why: 'A large stated contribution. Price should bind almost nowhere.' },
  { id: 'F-not-a-constraint', patch: { budget_range: null, contribution_state: 'NOT_A_CONSTRAINT', max_annual_contribution_usd: null }, why: 'Must NOT become a high number by accident; it is the absence of a limit.' },
  { id: 'F-needs-confirmation', patch: { budget_range: null, contribution_state: 'NEEDS_CONFIRMATION', max_annual_contribution_usd: null }, why: 'A record nobody can account for. Must follow the frozen semantics.' },
  { id: 'F-undeclared', patch: { budget_range: null, contribution_state: null, max_annual_contribution_usd: null }, why: 'Nobody asked. Must NOT become $0.' },
]);

/**
 * §F. The A7.37 horizon boundary.
 *
 * `depth = entryYear - rosterSeason` and the roster season is 2026, so depth 1
 * is 2027 and `MEASURED_HORIZON_DEPTH` is 1. EVERY frozen athlete enters in
 * 2028 - depth 2 - which is why A8.0 could only ever observe the PARTIAL side
 * of this rule. 2027 is the only entry year on file that reaches the MEASURED
 * side, and 2029 is the control that should look like 2028 in grade while
 * differing in value for the ordinary reason that fewer of today's squad are
 * still eligible.
 */
export const ENTRY_YEARS = Object.freeze([
  { id: 'Y-2027', year: 2027, depth: 1, expect: 'inside the measured horizon' },
  { id: 'Y-2028', year: 2028, depth: 2, expect: 'outside it - the condition every frozen athlete sits in' },
  { id: 'Y-2029', year: 2029, depth: 3, expect: 'further outside; grade must not differ from 2028 on horizon grounds' },
]);
