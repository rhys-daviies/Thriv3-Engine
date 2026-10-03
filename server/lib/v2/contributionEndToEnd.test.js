/**
 * A7.9.3 — the whole path, once, for each answer a family can give.
 *
 *   form payload -> sanitiser -> Player entity -> players row
 *     -> normaliseAthlete -> V2 Financial -> explanation
 *
 * Every earlier test in this phase covers one link. This covers the joins,
 * which is where a field quietly stops existing: the sanitiser deleting a
 * null, the entity not carrying a column, `normaliseAthlete` not passing it
 * through. Each of those would look like "Financial is a bit off" rather than
 * like a missing field.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { normaliseAthlete } from '../../../shared/matching/pool.js';
import { financialViability } from '../../../shared/matching/v2/layers/financial.js';
import { explainProgramme } from '../../../shared/matching/v2/explain/explain.js';
import { renderReason } from '../../../shared/matching/v2/explain/render.js';
import { GRADE, REASON, RANKING_STATE } from '../../../shared/matching/v2/types.js';
import { sanitizePlayerData } from '../../../src/lib/playerPayload.js';
import { contributionPayload, CONTRIBUTION_STATE } from '../../../src/lib/contributionIntake.js';

const { STATED, NOT_A_CONSTRAINT, NEEDS_CONFIRMATION } = CONTRIBUTION_STATE;
const SPORT = 'mens-soccer';

/** Furman's real figures: a private the athlete can afford at $40,000. */
const AFFORDABLE = {
  name: 'Affordable Private', net_price: 30308, control: 2,
  tuition_in_state: 59770, tuition_out_state: 59770,
  state: 'SC', division: 'NCAA D1', conference: 'Southern Conference',
};
/** Penn State's real figures: a public whose non-resident price clears $40,000. */
const ABOVE_MAXIMUM = {
  name: 'Above Maximum Public', net_price: 32875, control: 1,
  tuition_in_state: 20644, tuition_out_state: 41790,
  state: 'PA', division: 'NCAA D1', conference: 'Big Ten Conference',
};

const created = [];

/** Exactly what the form hands NewPlayer, through the real sanitiser and entity. */
function athleteFromForm(form, extra = {}) {
  const payload = sanitizePlayerData({
    full_name: `E2E ${form.choice}${form.amount ? ` ${form.amount}` : ''}${extra.origin ?? ''}`,
    position: 'Midfielder', sport: SPORT, recruiting_class_year: 2028,
    state: 'CA', origin: 'USA', budget_range: '',
    ...contributionPayload(form), ...extra,
  });
  const row = Player.create(payload);
  created.push(row.id);
  // Read BACK from the database, so a column that does not persist fails here.
  return { row: Player.get(row.id), athlete: normaliseAthlete(Player.get(row.id)) };
}

const score = (athlete, college) => financialViability({ athlete, college, sport: SPORT });

/**
 * The financial lines an operator would actually read on the programme.
 *
 * Built as a LIMITED_DATA entry deliberately: the other two layers are not
 * what is under test here, and a limited-data explanation renders the same
 * financial reasons a ranked one does without needing a whole pool to
 * produce a standing.
 */
function financialLines(result) {
  const entry = {
    id: 'x', name: 'Programme', division: 'NCAA D1',
    rankingState: RANKING_STATE.LIMITED_DATA,
    missingLayers: ['recruitability', 'opportunity'],
    recruitability: { ok: false, reason: REASON.NO_ATHLETE_LEVEL, missing: [], coverage: 0 },
    financial: result,
    opportunity: { ok: false, reason: REASON.NO_STATED_PREFERENCE, missing: [], coverage: 0 },
    pursuitPriority: { ok: false, reason: REASON.BELOW_COVERAGE_FLOOR, missing: [], coverage: 0 },
  };
  return explainProgramme(entry, {}).layerReasons.financial.map(renderReason);
}

beforeAll(() => {
  // A pool is not needed: Financial scores one programme at a time.
});
afterAll(() => {
  for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id);
});

describe('STATED $40,000', () => {
  it('persists the pair and reaches Financial as an exact maximum', () => {
    const made = athleteFromForm({ choice: STATED, amount: '40000' });
    expect(made.row.contribution_state).toBe(STATED);
    expect(made.row.max_annual_contribution_usd).toBe(40000);
    expect(made.row.budget_range).toBeNull();
    expect(athleteOf(made).maxAnnualContributionUsd).toBe(40000);
  });

  it('scores the affordable programme at 1.0, MEASURED, and says so plainly', () => {
    const made = athleteFromForm({ choice: STATED, amount: '40000' });
    const r = score(athleteOf(made), AFFORDABLE);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(1);
    expect(r.grade).toBe(GRADE.MEASURED);
    expect(r.basis.statedMaximumUsd).toBe(40000);
    expect(financialLines(r).join(' '))
      .toContain("The estimated annual cost of $30,308 is within the family's stated maximum annual contribution of $40,000.");
  });

  it('demotes the programme above the maximum, and names the shortfall and the premium', () => {
    const made = athleteFromForm({ choice: STATED, amount: '40000' });
    const r = score(athleteOf(made), ABOVE_MAXIMUM);
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThan(1);
    expect(r.basis.fundingGapRange).toEqual([14021, 14021]);
    const lines = financialLines(r).join(' ');
    expect(lines).toContain("$14,021 above the family's stated maximum annual contribution of $40,000");
    expect(lines).toContain('the out-of-state premium adds roughly $21,146');
  });
});

describe('STATED $60,000', () => {
  it('clears both programmes, and beats $40,000 on the dearer one', () => {
    const at60 = athleteOf(athleteFromForm({ choice: STATED, amount: '60000' }));
    const at40 = athleteOf(athleteFromForm({ choice: STATED, amount: '40000' }));
    expect(score(at60, AFFORDABLE).value).toBe(1);
    expect(score(at60, ABOVE_MAXIMUM).value).toBe(1);
    expect(score(at60, ABOVE_MAXIMUM).value).toBeGreaterThan(score(at40, ABOVE_MAXIMUM).value);
  });
});

describe('cost is not a meaningful constraint', () => {
  it('stores a null maximum and scores both programmes 1.0, MEASURED', () => {
    const made = athleteFromForm({ choice: NOT_A_CONSTRAINT, amount: '' });
    expect(made.row.max_annual_contribution_usd).toBeNull();
    for (const c of [AFFORDABLE, ABOVE_MAXIMUM]) {
      const r = score(athleteOf(made), c);
      expect(r.value).toBe(1);
      expect(r.grade).toBe(GRADE.MEASURED);
      expect(r.basis.costNotAConstraint).toBe(true);
    }
  });

  it('keeps the dearer programme\'s real cost on screen, so it never reads as cheap', () => {
    const made = athleteFromForm({ choice: NOT_A_CONSTRAINT, amount: '' });
    const r = score(athleteOf(made), ABOVE_MAXIMUM);
    expect(r.basis.applicableCostRange).toEqual([54021, 54021]);
    expect(financialLines(r).join(' '))
      .toContain('The family has recorded that cost is not a meaningful constraint. The estimated annual cost here is $54,021.');
  });
});

describe('needs confirmation', () => {
  it('REFUSES rather than scoring zero, on both programmes', () => {
    const made = athleteFromForm({ choice: NEEDS_CONFIRMATION, amount: '' });
    expect(made.row.max_annual_contribution_usd).toBeNull();
    for (const c of [AFFORDABLE, ABOVE_MAXIMUM]) {
      const r = score(athleteOf(made), c);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe(REASON.NO_FAMILY_CONTRIBUTION);
      expect(r).not.toHaveProperty('value');
    }
  });

  it('is not a zero contribution — a stated $0 scores where this refuses', () => {
    const unknown = athleteOf(athleteFromForm({ choice: NEEDS_CONFIRMATION, amount: '' }));
    const zero = athleteOf(athleteFromForm({ choice: STATED, amount: '0' }));
    expect(score(unknown, AFFORDABLE).ok).toBe(false);
    const z = score(zero, AFFORDABLE);
    expect(z.ok).toBe(true);
    expect(z.value).toBeGreaterThan(0);
  });

  it('says what is missing, in words, without model vocabulary', () => {
    const made = athleteFromForm({ choice: NEEDS_CONFIRMATION, amount: '' });
    const line = financialLines(score(athleteOf(made), AFFORDABLE)).join(' ');
    expect(line).toContain("maximum annual contribution has not been confirmed");
  });
});

describe('an international athlete', () => {
  /**
   * A7.9.3 §17. An exact contribution is evidence about the FAMILY. It says
   * nothing about the cost side, where net price is measured on domestically
   * aided students — so the caveat and the PARTIAL grade must both survive.
   */
  it('keeps the international cost caveat and PARTIAL evidence beside an exact maximum', () => {
    const made = athleteFromForm({ choice: STATED, amount: '40000' }, { origin: 'International', nationality: 'England', state: null });
    const athlete = athleteOf(made);
    expect(athlete.origin).toBe('International');
    expect(athlete.maxAnnualContributionUsd).toBe(40000);
    const r = score(athlete, ABOVE_MAXIMUM);
    expect(r.ok).toBe(true);
    expect(r.basis.statedMaximumUsd).toBe(40000);
    expect(r.grade).toBe(GRADE.PARTIAL);
    expect(r.basis.isInternational).toBe(true);
    expect(r.basis.internationalCostCaveat).toBeTruthy();
    // Priced as a non-resident everywhere, by rule rather than by a null state.
    expect(r.basis.costBasis).toBe('NET_PRICE_PUBLIC_OUT_OF_STATE');
  });

  it('is PARTIAL for the cost, not for the contribution — a domestic twin is MEASURED', () => {
    const intl = athleteOf(athleteFromForm({ choice: STATED, amount: '40000' }, { origin: 'International', nationality: 'England', state: null }));
    const dom = athleteOf(athleteFromForm({ choice: STATED, amount: '40000' }, { state: 'CA' }));
    expect(score(intl, ABOVE_MAXIMUM).grade).toBe(GRADE.PARTIAL);
    expect(score(dom, ABOVE_MAXIMUM).grade).toBe(GRADE.MEASURED);
    expect(score(intl, ABOVE_MAXIMUM).value).toBe(score(dom, ABOVE_MAXIMUM).value);
  });
});

function athleteOf(made) { return made.athlete; }
