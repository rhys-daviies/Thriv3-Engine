// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import MatchmakingPreferences from './MatchmakingPreferences';
import MatchmakingExplanation, { missingInformation } from './MatchmakingExplanation';
import { runView, summaryView, changedSinceRun, runInputs } from '@/lib/matchmakingV2View';
import { persistedRun, PLAYER } from '@/lib/__fixtures__/matchmakingV2Run.js';
import { CONTRIBUTION_STATE } from '@/lib/contributionIntake';
import { preferenceChecks, recruitmentPreferencesOf } from '@shared/recruitmentPreferences.js';

/**
 * POSITIONS AND RECRUITMENT PREFERENCES ON THE MATCHING SCREEN.
 *
 *   - The bar names the position group the ranking used, and says of each
 *     preference whether it was RANKED or only CHECKED.
 *   - "Changed since this ranking" marks a real change, not a reordering, and
 *     never a field the run never recorded.
 *   - The card says where a programme fits the athlete's stated preferences,
 *     where it falls outside them, and what is not on file - plus the
 *     engine's own unknowns that the three-line summary did not reach.
 */

let container;
let root;
const mount = (ui) => act(() => { root.render(createElement(MemoryRouter, null, ui)); });
const q = (sel) => container.querySelector(sel);

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const ATHLETE = {
  ...PLAYER,
  contribution_state: CONTRIBUTION_STATE.STATED,
  max_annual_contribution_usd: 25000,
  position: 'CB',
  secondary_position: 'DM',
  preferred_regions: ['NORTHEAST'],
  preferred_states: ['TX'],
  preferred_divisions: ['NCAA D1', 'NCAA D2'],
  preferred_institution_types: ['PUBLIC'],
};

const snapshotOf = (p, over = {}) => ({
  intended_major: p.intended_major ?? null,
  competitive_level_priority: p.competitive_level_priority ?? null,
  playing_opportunity_priority: p.playing_opportunity_priority ?? null,
  academic_strength_priority: p.academic_strength_priority ?? null,
  contribution_state: p.contribution_state,
  max_annual_contribution_usd: p.max_annual_contribution_usd,
  position: p.position,
  academic_minimum: null,
  preferred_states: ['TX'],
  preferred_regions: ['NORTHEAST'],
  preferred_divisions: ['NCAA D1', 'NCAA D2'],
  preferred_conferences: null,
  preferred_institution_types: ['PUBLIC'],
  ...over,
});

describe('the ranking-preferences bar', () => {
  it('shows the detailed position, the group it ranked as, and the unranked secondary', () => {
    mount(createElement(MatchmakingPreferences, { player: ATHLETE, run: runView(persistedRun({ inputSnapshot: snapshotOf(ATHLETE) })) }));
    expect(q('[data-testid="preference-position"]').textContent)
      .toBe('Position: Center back (ranked as defender); also Defensive midfielder, not ranked');
  });

  it('says which preferences were ranked and which only checked, and "No preference" for the rest', () => {
    mount(createElement(MatchmakingPreferences, { player: ATHLETE, run: runView(persistedRun({ inputSnapshot: snapshotOf(ATHLETE) })) }));
    expect(q('[data-testid="preference-location"]').textContent).toBe('Where: Northeast, plus TX · ranked');
    expect(q('[data-testid="preference-preferred_divisions"]').textContent).toBe('Divisions: NCAA D1, NCAA D2 · checked');
    expect(q('[data-testid="preference-preferred_conferences"]').textContent).toBe('Conferences: No preference');
    expect(container.textContent).not.toContain('changed');
  });

  it('a reordered list is not a change; a new state is', () => {
    const reordered = { ...ATHLETE, preferred_divisions: ['NCAA D2', 'NCAA D1'] };
    const run = runView(persistedRun({ inputSnapshot: snapshotOf(ATHLETE) }));
    expect([...changedSinceRun(reordered, run.inputs)]).toEqual([]);

    const moved = { ...ATHLETE, preferred_states: ['TX', 'FL'], position: 'FB' };
    expect([...changedSinceRun(moved, run.inputs)].sort()).toEqual(['position', 'preferred_states']);
    mount(createElement(MatchmakingPreferences, { player: moved, run }));
    expect(q('[data-testid="preference-location"]').textContent).toContain('changed');
    expect(q('[data-testid="preference-position"]').textContent).toContain('changed');
  });

  it('a run recorded before the preferences existed marks none of them changed', () => {
    const legacy = {
      intended_major: ATHLETE.intended_major ?? null,
      competitive_level_priority: ATHLETE.competitive_level_priority ?? null,
      playing_opportunity_priority: ATHLETE.playing_opportunity_priority ?? null,
      academic_strength_priority: ATHLETE.academic_strength_priority ?? null,
      contribution_state: ATHLETE.contribution_state,
      max_annual_contribution_usd: ATHLETE.max_annual_contribution_usd,
      position: 'CB',
      academic_minimum: null,
    };
    expect([...changedSinceRun(ATHLETE, runInputs(legacy))]).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

const reasons = [
  {
    code: 'ATHLETIC_AT_OR_ABOVE_LEVEL', layer: 'recruitability', polarity: 'strength', band: 2, sub: 0, listLevel: false,
    evidence: { athletePercentile: 0.64, programmePercentile: 0.608, levelGap: 0.032, plausibility: 0.867, rating: 6 },
  },
  {
    code: 'POSITION_OPENING_MEASURED', layer: 'opportunity', polarity: 'strength', band: 2, sub: 0, listLevel: false,
    evidence: { vacatedStarters: 1, typicalStarters: 4, position: 'DEFENSE' },
  },
  {
    code: 'COST_WITHIN_BUDGET', layer: 'financial', polarity: 'strength', band: 2, sub: 0, listLevel: false,
    evidence: { stated: 20000, cost: [19638, 19638], budget: [0, 20000] },
  },
  { code: 'ACADEMIC_STRENGTH_UNKNOWN', layer: 'opportunity', polarity: 'unknown', band: 6, sub: 0, listLevel: false, evidence: {} },
  { code: 'MARKET_UNKNOWN', layer: 'recruitability', polarity: 'unknown', band: 6, sub: 0, listLevel: false, evidence: { arrivals: 1, minArrivals: 3 } },
];

const prefs = recruitmentPreferencesOf(ATHLETE);
const explanation = (college) => ({
  subject: { id: 'p1', name: 'Seed', division: college.division, rankingState: 'RANKED' },
  standing: { rank: 4, outOf: 800, poolSize: 1200 },
  reasons,
  nextChecks: [],
  preferenceChecks: preferenceChecks(prefs, college),
});

describe('the match card', () => {
  it('says where the programme fits, falls outside, or is not on file, and which of those were ranked', () => {
    mount(createElement(MatchmakingExplanation, {
      explanation: explanation({ division: 'NAIA', state: 'MA', control: null }),
    }));
    const items = [...container.querySelectorAll('[data-testid="preference-checks"] li')];
    expect(items.map((li) => li.dataset.tone)).toEqual(['short', 'fit', 'unknown']);
    expect(items[0].textContent).toBe('Outside: NAIA is outside the divisions they asked for (NCAA D1, NCAA D2). (checked, not ranked)');
    expect(items[1].textContent).toBe('Fits: MA is inside where they want to be (Northeast, plus TX). (counted in the ranking)');
    expect(items[2].textContent).toMatch(/^Not on file: Public or private is not on file/);
  });

  it('lists what the ranking does not know, which the three-line summary did not reach', () => {
    mount(createElement(MatchmakingExplanation, { explanation: explanation({ division: 'NCAA D1', state: 'TX', control: 1 }) }));
    const missing = q('[data-testid="missing-information"]').textContent;
    expect(missing).toContain('no measured academic rating');
    expect(missing).toContain('recruiting history');
    // Shown once, not in both places.
    const summary = q('[data-testid="explanation-overall-reasons"]').textContent;
    expect(summary).not.toContain('no measured academic rating');
  });

  it('never repeats an unknown the summary already showed', () => {
    const e = { ...explanation({}), reasons: reasons.filter((r) => r.polarity === 'unknown') };
    const summary = summaryView(e);
    expect(missingInformation(e, summary)).toEqual([]);
  });

  it('a run from before the checks existed shows no checks block at all', () => {
    const { preferenceChecks: _ignored, ...older } = explanation({ division: 'NAIA' });
    mount(createElement(MatchmakingExplanation, { explanation: older }));
    expect(q('[data-testid="preference-checks"]')).toBeNull();
  });
});
