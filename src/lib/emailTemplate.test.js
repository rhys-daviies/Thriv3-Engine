import { describe, it, expect } from 'vitest';
import { buildEmailContext, fillTemplate, unresolvedTokens, TEMPLATE_VARIABLES, DEFAULT_EMAIL_TEMPLATE } from './emailTemplate.js';

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

describe('position grammar in the email', () => {
  const ctx = (position, graduating) => buildEmailContext(
    { ...player, position },
    { ...college, graduating_seniors_at_position: graduating, graduating_senior_names_at_position: [] },
    'Coach',
  );

  // "a talented Defense who is exploring" went to coaches. Every position now
  // reads as the person, in the same form, whatever the stored key says.
  it.each([
    ['Goalkeeper', 'Goalkeeper', 'goalkeepers'],
    ['Defense', 'Defender', 'defenders'],
    ['Midfield', 'Midfielder', 'midfielders'],
    ['Forward', 'Forward', 'forwards'],
  ])('%s renders as %s / %s', (stored, label, plural) => {
    const c = ctx(stored, 4);
    expect(c.player_position).toBe(label);
    expect(c.player_position_plural).toBe(plural);
  });

  it('agrees the position word with the graduating count', () => {
    expect(ctx('Defense', 1).graduating_seniors_position).toBe('defender');
    expect(ctx('Defense', 4).graduating_seniors_position).toBe('defenders');
    // Zero takes the plural, which is correct English.
    expect(ctx('Defense', 0).graduating_seniors_position).toBe('defenders');
  });

  it('never renders the raw stored key in the default template', () => {
    for (const stored of ['Goalkeeper', 'Defense', 'Midfield', 'Forward']) {
      const out = fillTemplate(DEFAULT_EMAIL_TEMPLATE, ctx(stored, 2));
      expect(out).not.toMatch(/\bDefense\b|\bMidfield\b/);
      expect(out).not.toMatch(/\(s\)/);
    }
  });

  it('gives the secondary position the same treatment', () => {
    const c = buildEmailContext({ ...player, secondary_position: 'Midfield' }, college, 'Coach');
    expect(c.player_secondary_position).toBe(' / Midfielder');
  });

  it('omits the secondary position entirely when there is none', () => {
    expect(buildEmailContext({ ...player, secondary_position: 'None' }, college, 'Coach').player_secondary_position).toBe('');
  });
});

describe('the highlights link is gone from emails', () => {
  // Removed 2026-08-26. A raw YouTube URL beside the tracked one let a coach
  // watch the film without touching the profile, so the visit went unrecorded
  // and Tab 3 read cold. The film is on the profile page the tracked link
  // opens, so nothing is lost by dropping it.
  it('no longer resolves player_highlights_url', () => {
    const c = buildEmailContext({ ...player, highlights_url: 'https://youtube.test/watch?v=abc' }, college, 'Coach');
    expect(c).not.toHaveProperty('player_highlights_url');
  });

  it('does not offer it in the picker', () => {
    expect(TEMPLATE_VARIABLES.map((v) => v.token)).not.toContain('player_highlights_url');
  });

  // A template still carrying it is now reported rather than silently
  // emitting braces to a coach.
  it('reports it as unresolved if a saved template still uses it', () => {
    const c = buildEmailContext(player, college, 'Coach');
    expect(unresolvedTokens('film: {{player_highlights_url}}', c)).toEqual(['player_highlights_url']);
  });

  it('leaves the tracked profile link as the only link a template carries', () => {
    const c = buildEmailContext(player, college, 'Coach');
    expect(c.player_profile_url).toBe('{{player_profile_url}}');
    expect(fillTemplate(DEFAULT_EMAIL_TEMPLATE, c)).not.toMatch(/youtube|highlights_url/i);
  });
});

describe('nested conditionals', () => {
  const ctx = (over) => buildEmailContext({ ...player, ...over.player }, { ...college, ...over.college }, 'Coach');

  // Until 2026-08-26 the non-greedy body matched to the FIRST {{/if}}, so an
  // outer block closed early and the inner tags survived into the message —
  // a coach would have read "graduating this year{{#if has_graduating_names}}".
  it('resolves an inner block inside an outer one', () => {
    const t = '{{#if has_gpa}}gpa {{player_gpa}}{{#if has_sat_score}} sat {{player_sat_score}}{{/if}} end{{/if}}';
    expect(fillTemplate(t, ctx({}))).toBe('gpa 3.6 sat 1210 end');
  });

  it('drops the whole outer block, inner one included, when the outer is false', () => {
    const t = 'a{{#if has_act_score}}act{{#if has_sat_score}} and sat{{/if}}{{/if}}b';
    expect(fillTemplate(t, ctx({ player: { act_score: null } }))).toBe('ab');
  });

  it('keeps the outer and drops only the inner', () => {
    const t = '{{#if has_gpa}}gpa{{#if has_act_score}} act{{/if}}{{/if}}';
    expect(fillTemplate(t, ctx({ player: { act_score: null } }))).toBe('gpa');
  });

  it('leaves a template with an unclosed block alone rather than hanging', () => {
    const t = 'a {{#if has_gpa}} b';
    expect(fillTemplate(t, ctx({}))).toBe('a {{#if has_gpa}} b');
  });
});

describe('the pilot template degrades with the data', () => {
  const render = (over) => fillTemplate(
    DEFAULT_EMAIL_TEMPLATE,
    buildEmailContext({ ...player, ...over.player }, { ...college, ...over.college }, 'Coach Smith'),
  );

  // The two sentences that would embarrass a send: a programme losing nobody
  // at the position, and one whose departing names we could not read.
  it('drops the roster hook rather than saying "0 defenders graduating"', () => {
    const out = render({ college: { graduating_seniors_at_position: 0, graduating_senior_names_at_position: [] } });
    expect(out).not.toMatch(/\b0 defenders?\b/);
    expect(out).not.toMatch(/Part of why/);
  });

  it('never tells a coach his own roster could not be verified', () => {
    const out = render({ college: { graduating_seniors_at_position: 2, graduating_senior_names_at_position: [] } });
    expect(out).toContain('2 defenders graduating this year,');
    expect(out).not.toMatch(/could not be verified/i);
  });

  it('omits an academic line rather than sending "N/A"', () => {
    const out = render({ player: { gpa: null, act_score: null } });
    expect(out).not.toContain('N/A');
    expect(out).not.toMatch(/GPA/);
    expect(out).toContain('• SAT 1210');
  });

  it('leaves no blank line where a skipped line was', () => {
    expect(render({ player: { gpa: null, act_score: null } })).not.toMatch(/\n\n•/);
  });

  // A negotiating position, not a selling point.
  it('never states the athlete budget', () => {
    const out = render({ player: { budget_range: '$15k-$20k/yr' } });
    expect(out).not.toMatch(/budget/i);
    expect(out).not.toContain('$15k');
  });

  it('carries exactly one link, the tracked profile', () => {
    const out = render({});
    expect(out.match(/\{\{player_profile_url\}\}/g)).toHaveLength(1);
    expect(out).not.toMatch(/youtube/i);
  });

  it('resolves completely for a school with nothing but a name', () => {
    const ctx = buildEmailContext(player, { name: 'Some College' }, 'Coach');
    expect(unresolvedTokens(DEFAULT_EMAIL_TEMPLATE, ctx)).toEqual([]);
  });
});
