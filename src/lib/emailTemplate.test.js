import { describe, it, expect } from 'vitest';
import { buildEmailContext, fillTemplate, unresolvedTokens, TEMPLATE_VARIABLES } from './emailTemplate.js';

const player = {
  full_name: 'Test Athlete', position: 'DEFENSE', secondary_position: 'None',
  gpa: 3.6, sat_score: 1210, act_score: null, budget_range: '$15k-$20k/yr',
  recruiting_class_year: 2027,
};
const college = {
  name: 'SMU', city: 'Dallas', state: 'TX', division: 'NCAA D1', conference: 'ACC',
  nickname: 'Mustangs', nickname_plural: 1, mascot: 'Peruna',
  conference_champion_2025: 1, conference_champion_name: 'ACC',
};

describe('buildEmailContext', () => {
  it('resolves the personalisation the ranker now carries through', () => {
    const c = buildEmailContext(player, college, 'Coach');
    expect(c.college_nickname).toBe('Mustangs');
    expect(c.college_mascot).toBe('Peruna');
    expect(c.has_real_nickname).toBe('true');
    expect(c.has_mascot).toBe('true');
    expect(c.is_conference_champion).toBe('true');
    expect(c.college_nickname_have).toBe('have');
  });

  // These were dropped by rankMatches, so every conditional gated on them was
  // dead and {{college_nickname}} fell back to the plain school name.
  it('falls back to the school name only when there really is no nickname', () => {
    const c = buildEmailContext(player, { ...college, nickname: null, mascot: null }, 'Coach');
    expect(c.college_nickname).toBe('SMU');
    expect(c.has_real_nickname).toBe('');
    expect(c.has_mascot).toBe('');
    expect(c.college_nickname_have).toBe('has');
  });

  // colleges.location is empty on all 2,374 rows, so this token rendered as
  // nothing until it was derived from the columns that are populated.
  it('builds the location from city and state', () => {
    expect(buildEmailContext(player, college, 'Coach').college_location).toBe('Dallas, TX');
  });

  it('resolves the academic and budget tokens saved templates already used', () => {
    const c = buildEmailContext(player, college, 'Coach');
    expect(c.player_sat_score).toBe('1210');
    expect(c.player_yearly_budget).toBe('$15k-$20k/yr');
    expect(c.player_act_score).toBe('N/A');
  });
});

describe('unresolvedTokens', () => {
  const context = buildEmailContext(player, college, 'Coach');

  it('finds a token nothing will fill', () => {
    expect(unresolvedTokens('Hi {{player_name}}, {{position}} {{graduation_year}}', context).sort())
      .toEqual(['graduation_year', 'position']);
  });

  it('says nothing about a template that fully resolves', () => {
    expect(unresolvedTokens('{{player_name}} — {{college_nickname}}', context)).toEqual([]);
  });

  it('ignores template syntax and filters', () => {
    expect(unresolvedTokens('{{#if has_mascot}}{{player_position|lowercase}}{{else}}x{{/if}}', context)).toEqual([]);
  });

  it('reports each unknown token once', () => {
    expect(unresolvedTokens('{{nope}} {{nope}}', context)).toEqual(['nope']);
  });

  it('is empty for an empty template', () => {
    expect(unresolvedTokens('', context)).toEqual([]);
    expect(unresolvedTokens(null, context)).toEqual([]);
  });
});

describe('the token picker', () => {
  // A token offered in the UI that nothing resolves would be a trap: the
  // operator inserts it and it reaches the coach in braces.
  it('offers nothing that buildEmailContext cannot resolve', () => {
    const context = buildEmailContext(player, college, 'Coach');
    const missing = TEMPLATE_VARIABLES.map((v) => v.token).filter((t) => !(t in context));
    expect(missing).toEqual([]);
  });

  it('every snippet it offers resolves too', () => {
    const context = buildEmailContext(player, college, 'Coach');
    for (const v of TEMPLATE_VARIABLES) {
      if (v.snippet) expect(unresolvedTokens(v.snippet, context), v.token).toEqual([]);
    }
  });
});

describe('fillTemplate', () => {
  it('leaves an unknown token alone rather than blanking it', () => {
    expect(fillTemplate('a {{nope}} b', buildEmailContext(player, college, 'Coach'))).toBe('a {{nope}} b');
  });
});
