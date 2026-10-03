/**
 * A7.12.1 — the whole path, once, for each thing an athlete can say.
 *
 *   form payload -> sanitiser -> Player entity -> players row
 *     -> buildValidationAthlete -> V2 Opportunity -> explanation
 *
 * Every other test in this phase covers one link. This covers the JOINS,
 * which is where a field quietly stops existing: the sanitiser deleting a
 * null, the entity not carrying a column, the athlete builder not reading it.
 * Each of those looks like "the preference does not seem to do much" rather
 * than like a missing field, which is exactly how A7.12 found these three
 * had no column at all.
 *
 * The full-universe parity runs live in server/scripts/v2PreferenceParity.js;
 * this is the fast proof that the plumbing carries the values.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { normaliseAthlete } from '../../../shared/matching/pool.js';
import { canonicalPosition } from '../../../shared/positions.js';
import { buildValidationAthlete } from '../../../shared/matching/v2/validation/athleteInput.js';
import { athleteOpportunity } from '../../../shared/matching/v2/layers/opportunity.js';
import { athleticOutcome, academicStrengthFit } from '../../../shared/matching/v2/layers/opportunityComponents.js';
import { scoreable, notApplicable, GRADE } from '../../../shared/matching/v2/types.js';
import { sanitizePlayerData } from '../../../src/lib/playerPayload.js';
import { preferencePayload } from '../../../src/lib/preferenceIntake.js';

const SPORT = 'mens-soccer';
const created = [];

/** Exactly what the form hands NewPlayer, through the real sanitiser and entity. */
function persist(preferences, extra = {}) {
  const payload = sanitizePlayerData({
    full_name: `A7.12.1 e2e ${JSON.stringify(preferences)}${extra.tag ?? ''}`,
    position: 'Midfielder', sport: SPORT, recruiting_class_year: 2028,
    state: 'CA', origin: 'USA', football_ability: 9,
    ...preferencePayload(preferences), ...extra,
  });
  delete payload.tag;
  const row = Player.create(payload);
  created.push(row.id);
  // Read BACK from the database. A column that does not persist fails here.
  return Player.get(row.id);
}

/** The production V2 construction path, from a row the database handed back. */
function v2AthleteFrom(row) {
  return buildValidationAthlete({
    record: row,
    v1Shape: normaliseAthlete(row),
    position: canonicalPosition(row.position),
    label: row.full_name,
  });
}

/**
 * The objective half, fixed, plus the two preference components built by the
 * REAL component functions.
 *
 * Handing `athleteOpportunity` a ready-made scoreable outcome would test a
 * pipeline that does not exist: in production it is `athleticOutcome` itself
 * that returns NOT_APPLICABLE when nobody stated a level, and the layer never
 * sees a value at all. Modelling that wrong is how an undeclared athlete
 * comes to look like a declared one in a test and nowhere else.
 */
const PROGRAMME = { athletePercentile: 0.96, programmePercentile: 0.55, academicPercentile: 0.9 };

const inputs = (athlete = {}) => ({
  pathway: scoreable({ value: 0.6, grade: GRADE.MEASURED, coverage: 1, basis: {} }),
  trajectory: scoreable({ value: 0.5, grade: GRADE.MEASURED, coverage: 1, basis: {} }),
  major: notApplicable({ why: 'no major stated' }),
  location: notApplicable({ why: 'no location preference collected' }),
  outcome: athleticOutcome({
    competitiveLevelPriority: athlete.competitiveLevelPriority ?? null,
    athletePercentile: PROGRAMME.athletePercentile,
    programmePercentile: PROGRAMME.programmePercentile,
  }),
  academic: academicStrengthFit({
    academicStrengthPriority: athlete.academicStrengthPriority ?? null,
    academicPercentile: PROGRAMME.academicPercentile,
  }),
});

/**
 * Opportunity, run the way the pipeline runs it - the preferences taken from
 * the persisted athlete, not from a literal.
 */
function opportunityFor(row) {
  const { athlete } = v2AthleteFrom(row);
  return athleteOpportunity({
    ...inputs(athlete.opportunity),
    priorityRanking: athlete.opportunity.priorityRanking,
    competitiveLevelPriority: athlete.opportunity.competitiveLevelPriority,
    playingOpportunityPriority: athlete.opportunity.playingOpportunityPriority,
    academicStrengthPriority: athlete.opportunity.academicStrengthPriority,
  });
}

afterAll(() => {
  for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

describe('a persisted athlete reaches the scorer with their answers intact', () => {
  let row;
  let built;
  beforeAll(() => {
    row = persist({
      competitive_level_priority: 5,
      playing_opportunity_priority: 3,
      academic_strength_priority: 4,
    });
    built = v2AthleteFrom(row);
  });

  it('stores 5 / 3 / 4 and reads them back off the row', () => {
    expect(row.competitive_level_priority).toBe(5);
    expect(row.playing_opportunity_priority).toBe(3);
    expect(row.academic_strength_priority).toBe(4);
  });

  it('hands 5 / 3 / 4 to the V2 athlete builder', () => {
    expect(built.athlete.opportunity.competitiveLevelPriority).toBe(5);
    expect(built.athlete.opportunity.playingOpportunityPriority).toBe(3);
    expect(built.athlete.opportunity.academicStrengthPriority).toBe(4);
  });

  it('shows 5 / 3 / 4 in the reviewer-facing input block, with nothing undeclared', () => {
    expect(built.inputs.competitiveLevelPriority).toBe(5);
    expect(built.inputs.playingOpportunityPriority).toBe(3);
    expect(built.inputs.academicStrengthPriority).toBe(4);
    expect(built.inputs.undeclaredPreferences).toEqual([]);
    expect(built.inputs.preferenceProfile).toBe('MIXED');
  });

  it('reaches the Opportunity basis as 5 / 3 / 4', () => {
    const o = opportunityFor(row);
    expect(o.ok).toBe(true);
    expect(o.basis.ambition.competitiveLevelPriority).toBe(5);
    expect(o.basis.ambition.playingOpportunityPriority).toBe(3);
    expect(o.basis.ambition.academicStrengthPriority).toBe(4);
    expect(o.basis.ambition.declared).toBe(true);
  });

  it('activates the components those answers own', () => {
    const o = opportunityFor(row);
    expect(Object.keys(o.basis.components)).toContain('athleticOutcome');
    expect(Object.keys(o.basis.components)).toContain('academicStrengthFit');
    expect(o.basis.notApplicable).not.toContain('athleticOutcome');
    expect(o.basis.notApplicable).not.toContain('academicStrengthFit');
    expect(o.basis.preferencesDeclared).toBeGreaterThan(0);
    expect(o.basis.preferenceKnown).toBe(true);
  });

  it('moves the weight of each component in the stated direction', () => {
    const o = opportunityFor(row);
    const m = o.basis.ambition.multipliers;
    // 5 lifts, 3 leaves alone, 4 lifts less than 5.
    expect(m.athleticOutcome).toBeGreaterThan(1);
    expect(m.playingPathway).toBeCloseTo(1, 10);
    expect(m.academicStrengthFit).toBeGreaterThan(1);
    expect(m.academicStrengthFit).toBeLessThan(m.athleticOutcome);
  });
});

describe('all three NULL reproduces the undeclared production shape', () => {
  let row;
  beforeAll(() => {
    row = persist({
      competitive_level_priority: null,
      playing_opportunity_priority: null,
      academic_strength_priority: null,
    }, { tag: ' null' });
  });

  it('persists as NULL, not as a midpoint', () => {
    expect(row.competitive_level_priority).toBeNull();
    expect(row.playing_opportunity_priority).toBeNull();
    expect(row.academic_strength_priority).toBeNull();
  });

  it('reports all three as undeclared to the builder', () => {
    const { athlete, inputs: i } = v2AthleteFrom(row);
    expect(athlete.opportunity.competitiveLevelPriority).toBeNull();
    expect(athlete.opportunity.playingOpportunityPriority).toBeNull();
    expect(athlete.opportunity.academicStrengthPriority).toBeNull();
    expect(i.undeclaredPreferences.sort()).toEqual([
      'academic_strength_priority', 'competitive_level_priority', 'playing_opportunity_priority',
    ]);
    expect(i.preferenceProfile).toBe('UNDECLARED');
  });

  it('leaves the preference components out of the denominator entirely', () => {
    const o = opportunityFor(row);
    expect(o.basis.notApplicable).toContain('athleticOutcome');
    expect(o.basis.notApplicable).toContain('academicStrengthFit');
    expect(o.basis.ambition.declared).toBe(false);
    expect(o.basis.ambition.multipliers).toEqual({});
  });

  /** The regression that matters: NULL must score exactly as before the columns existed. */
  it('scores identically to an athlete whose columns do not exist at all', () => {
    const withColumns = opportunityFor(row);
    /**
     * The call as it read before A7.12.1: no preference arguments at all, so
     * `academic` takes its NOT_APPLICABLE default and `outcome` is passed the
     * NOT_APPLICABLE the component returns for an unasked athlete.
     */
    const withoutColumns = athleteOpportunity({
      pathway: inputs().pathway,
      trajectory: inputs().trajectory,
      major: notApplicable({ why: 'no major stated' }),
      location: notApplicable({ why: 'no location preference collected' }),
      outcome: athleticOutcome({ athletePercentile: 0.96, programmePercentile: 0.55 }),
      priorityRanking: null,
    });
    expect(withColumns.value).toBeCloseTo(withoutColumns.value, 12);
    expect(withColumns.coverage).toBeCloseTo(withoutColumns.coverage, 12);
    expect(withColumns.grade).toBe(withoutColumns.grade);
  });
});

describe('the sanitiser carries a cleared answer, not just a given one', () => {
  it('sends an explicit null rather than dropping the key', () => {
    const payload = sanitizePlayerData({
      full_name: 'x', position: 'Midfielder',
      ...preferencePayload({
        competitive_level_priority: 5,
        playing_opportunity_priority: null,
        academic_strength_priority: null,
      }),
    });
    expect(payload).toHaveProperty('playing_opportunity_priority', null);
    expect(payload).toHaveProperty('academic_strength_priority', null);
    expect(payload.competitive_level_priority).toBe(5);
  });

  it('clears a stored answer through the real update path', () => {
    const row = persist({
      competitive_level_priority: 5, playing_opportunity_priority: 5, academic_strength_priority: 5,
    }, { tag: ' clear' });
    const payload = sanitizePlayerData({
      ...preferencePayload({
        competitive_level_priority: null, playing_opportunity_priority: null, academic_strength_priority: 2,
      }),
    });
    Player.update(row.id, payload);
    const back = Player.get(row.id);
    expect(back.competitive_level_priority).toBeNull();
    expect(back.playing_opportunity_priority).toBeNull();
    expect(back.academic_strength_priority).toBe(2);
  });
});

describe('nothing else on the record produces a preference', () => {
  it('leaves an athlete with a full profile and no answers undeclared', () => {
    const row = persist({
      competitive_level_priority: null, playing_opportunity_priority: null, academic_strength_priority: null,
    }, {
      tag: ' rich',
      gpa: 4.0, sat_score: 1550, act_score: 36, intended_major: 'Engineering',
      budget_range: '$40k+/yr',
      criterion_ranking: ['athletic', 'roster', 'academic', 'geography', 'affordability', 'programQuality'],
    });
    const { athlete, inputs: i } = v2AthleteFrom(row);
    expect(athlete.opportunity.competitiveLevelPriority).toBeNull();
    expect(athlete.opportunity.academicStrengthPriority).toBeNull();
    expect(athlete.opportunity.playingOpportunityPriority).toBeNull();
    expect(i.preferenceProfile).toBe('UNDECLARED');
    // The legacy ranking still reaches the layer, as its own coarser thing.
    expect(athlete.opportunity.priorityRanking).toBeTruthy();
  });

  /**
   * THE PRECEDENCE RULE, asserted rather than described. The legacy ranking's
   * `roster` token and the explicit playing priority both aim at
   * playingPathway, and the explicit answer wins. Nothing else overlaps.
   */
  it('lets an explicit answer override the legacy ranking for the one component they share', () => {
    const ranking = ['roster', 'academic', 'geography', 'affordability', 'athletic', 'programQuality'];
    const legacyOnly = athleteOpportunity({ ...inputs({}), priorityRanking: ranking });
    const explicit = athleteOpportunity({
      ...inputs({}), priorityRanking: ranking, playingOpportunityPriority: 1,
    });
    expect(legacyOnly.basis.components.playingPathway.weight)
      .not.toBeCloseTo(explicit.basis.components.playingPathway.weight, 6);
    expect(explicit.basis.ambition.overrodeRanking).toContain('playingPathway');
    // The ranking still owns the components no explicit field claims.
    expect(explicit.basis.priorities.multipliers.majorFit).toBeDefined();
  });

  it('refuses a legacy token that belongs to another layer, rather than ignoring it', () => {
    const o = athleteOpportunity({ ...inputs({}), priorityRanking: ['athletic', 'affordability', 'roster'] });
    const ignored = o.basis.priorities.ignored.map((x) => x.key);
    expect(ignored).toContain('athletic');
    expect(ignored).toContain('affordability');
  });
});
