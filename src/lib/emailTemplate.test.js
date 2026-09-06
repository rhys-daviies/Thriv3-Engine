import { describe, it, expect } from 'vitest';
import { buildEmailContext, fillTemplate, unresolvedTokens, TEMPLATE_VARIABLES, DEFAULT_EMAIL_TEMPLATE, coachFirstName } from './emailTemplate.js';

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
    // is_conference_champion is gone at J6 — it recreated CONFERENCE_TITLE.
    expect(c.is_conference_champion).toBeUndefined();
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

describe('the graduating cohort is the evidence engine\'s to state', () => {
  /**
   * These tokens rebuilt POSITION_GRADUATION from the recommendations blob,
   * outside qualification, freshness, dedupe and the body cap. J5 removed the
   * three that recreated DENIED kinds; J6 removed the rest. What a template
   * may say about evidence is `{{evidence_paragraph}}`, which is the engine's
   * own words.
   */
  const RETIRED = ['graduating_seniors_count', 'graduating_seniors_names',
    'graduating_seniors_position', 'has_graduating_seniors', 'has_graduating_names',
    'graduating_starters_count', 'graduating_starters_names',
    'graduating_total_count', 'has_graduating_total'];

  it('resolves none of them, under either field name the blobs use', () => {
    const ctx = buildEmailContext(player, {
      ...college,
      graduating_at_position: 4,
      graduating_names_at_position: ['A Smith', 'B Jones'],
      graduating_seniors_at_position: 4,
      graduating_senior_names_at_position: ['A Smith', 'B Jones'],
      graduating_starters_at_position: 2,
      graduating_total: 11,
    }, 'Coach');
    for (const t of RETIRED) expect(ctx[t], t).toBeUndefined();
  });

  it('offers none of them to a template author', () => {
    const offered = TEMPLATE_VARIABLES.map((t) => t.token);
    for (const t of RETIRED) expect(offered, t).not.toContain(t);
  });

  it('leaves a template using one visibly unresolved rather than silent', () => {
    const ctx = buildEmailContext(player, college, 'Coach');
    const out = fillTemplate('{{graduating_seniors_count}} leaving', ctx);
    expect(out).toBe('{{graduating_seniors_count}} leaving');
    expect(unresolvedTokens('{{graduating_seniors_count}} leaving', ctx))
      .toContain('graduating_seniors_count');
  });
});

describe('position grammar in the email', () => {
  /**
   * The count-agreeing position word belonged to the retired graduating
   * tokens. The engine's own copy agrees its nouns in `outreachCopy.js`
   * (`noun(position, n)`), which is where the sentence is written.
   */
  it('still exposes the position in both forms as a raw fact', () => {
    const ctx = buildEmailContext(player, college, 'Coach');
    expect(ctx.player_position).toBe('Defender');
    expect(ctx.player_position_plural).toBe('defenders');
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

describe('the default scaffold degrades with the data', () => {
  const render = (p, c = college) => fillTemplate(DEFAULT_EMAIL_TEMPLATE, buildEmailContext(p, c, 'Coach'));

  it('never tells a coach his own roster could not be verified', () => {
    // The sentence that could say it is gone; so is the phrase.
    expect(render(player)).not.toContain('could not be verified');
    expect(DEFAULT_EMAIL_TEMPLATE).not.toContain('graduating');
  });

  it('leaves no blank line where a skipped line was', () => {
    const bare = render({ ...player, gpa: null, sat_score: null, budget_range: null });
    expect(bare).not.toMatch(/\n{3,}/);
    expect(bare).toContain('Rhys Davies');
  });

  it('does not double the secondary-position separator', () => {
    const ctx = buildEmailContext({ ...player, secondary_position: 'None' }, college, 'Coach');
    expect(ctx.player_secondary_position).toBe('');
    const withSecond = buildEmailContext({ ...player, secondary_position: 'MIDFIELD' }, college, 'Coach');
    expect(withSecond.player_secondary_position).toBe(' / Midfielder');
  });

  it('says nothing about the programme when the engine found nothing', () => {
    const out = render(player);
    expect(out).not.toContain('particularly with');
    expect(out).not.toContain('We believe');
    expect(out).not.toContain('needs');
  });
});

/**
 * Greeting a coach by their first name.
 *
 * "Hi Ali Simmons," opened all fifteen emails in the QA sample, and a full-name
 * greeting is the line that most reliably marks a message as generated.
 */
describe('coachFirstName', () => {
  it('takes the first name from an ordinary name', () => {
    expect(coachFirstName('Ali Simmons')).toBe('Ali');
    expect(coachFirstName('Stephen Gorton')).toBe('Stephen');
    expect(coachFirstName('Krystian Witkowski')).toBe('Krystian');
    expect(coachFirstName('Cale Wassermann')).toBe('Cale');
  });

  /**
   * Accents, hyphens and apostrophes are part of a person's name. Stripping
   * them "to be safe" misspells the one word the reader is guaranteed to read.
   */
  it('leaves accents, hyphens and apostrophes exactly as written', () => {
    expect(coachFirstName('Jean-Pierre Dubois')).toBe('Jean-Pierre');
    expect(coachFirstName('José Núñez')).toBe('José');
    expect(coachFirstName("Se'an O'Brien")).toBe("Se'an");
    expect(coachFirstName('Tønnes Daland')).toBe('Tønnes');
  });

  it('flips a surname-first listing', () => {
    expect(coachFirstName('Simmons, Ali')).toBe('Ali');
    expect(coachFirstName('Mauzy-Fleming, Meghan')).toBe('Meghan');
  });

  it('does not read a suffix as a first name', () => {
    expect(coachFirstName('Smith, Jr.')).toBe('');
    expect(coachFirstName('Ryan Hopkins Jr.')).toBe('Ryan');
  });

  it('strips a title before taking the name', () => {
    expect(coachFirstName('Coach Danny Frid')).toBe('Danny');
    expect(coachFirstName('Dr. Marc Reeves')).toBe('Marc');
  });

  /**
   * Every refusal below falls back to the full name at the call site, so the
   * greeting is never empty and never a leftover token.
   */
  it('refuses when it cannot tell a first name from a surname', () => {
    expect(coachFirstName('Coach Smith')).toBe('');   // one token once the title is gone
    expect(coachFirstName('Simmons')).toBe('');
    expect(coachFirstName('J. Smith')).toBe('');      // an initial is not a first name
    expect(coachFirstName('A Smith')).toBe('');
    expect(coachFirstName('')).toBe('');
    expect(coachFirstName(null)).toBe('');
  });

  it('falls back to the full name in the email context', () => {
    const ctx = buildEmailContext(
      { full_name: 'Rhys Davies', position: 'Defender' },
      { name: 'Example University' },
      'Coach Smith',
    );
    expect(ctx.coach_first_name).toBe('Coach Smith');
    expect(ctx.coach_name).toBe('Coach Smith');
  });

  it('keeps the full name beside the first name', () => {
    const ctx = buildEmailContext(
      { full_name: 'Rhys Davies', position: 'Defender' },
      { name: 'Example University' },
      'Ali Simmons',
    );
    expect(ctx.coach_first_name).toBe('Ali');
    expect(ctx.coach_name).toBe('Ali Simmons');
  });
});

/**
 * The athlete's words and the college's, kept apart.
 *
 * Rhys typed "exercise science"; Jacksonville publishes "Kinesiology". The
 * introduction was printing the college's label as the athlete's plan.
 */
describe('intended major attribution', () => {
  /**
   * The athlete's own words stay; the MATCH between their major and the
   * programme's listing is ACADEMIC_FIT, and the engine owns it.
   */
  it('keeps the athlete\'s own words as a raw fact', () => {
    const ctx = buildEmailContext({ ...player, intended_major: 'exercise science' }, college, 'Coach');
    expect(ctx.intended_major_stated).toBe('Exercise Science');
  });

  it('does not offer the matched programme label to templates', () => {
    const offered = TEMPLATE_VARIABLES.map((t) => t.token);
    expect(offered).not.toContain('intended_major_label');
    expect(offered).not.toContain('offers_intended_major');
  });
});
