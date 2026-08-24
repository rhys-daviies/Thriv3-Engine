// Section 11: The Email Template System — ported exactly.

export const TEMPLATE_VARIABLES = [
  { token: 'coach_name', label: 'Coach Name' },
  { token: 'college_name', label: 'College Name' },
  { token: 'college_division', label: 'Division' },
  { token: 'college_conference', label: 'Conference' },
  { token: 'college_location', label: 'Location' },
  { token: 'college_nickname', label: 'Team Nickname' },
  { token: 'college_mascot', label: 'Mascot' },
  { token: 'college_nickname_have', label: 'Have/Has (use with the nickname as subject)' },
  { token: 'college_nickname_are', label: 'Are/Is (use with the nickname as subject)' },
  {
    token: 'has_mascot',
    label: 'If mascot known… (conditional sentence)',
    snippet: '{{#if has_mascot}}I can\'t wait to represent the {{college_mascot}}.{{/if}}',
  },
  {
    token: 'has_real_nickname',
    label: 'If nickname known… (conditional sentence)',
    snippet: '{{#if has_real_nickname}}Go {{college_nickname}}!{{/if}}',
  },
  { token: 'conference_champion_name', label: 'Conference Won (2025)' },
  {
    token: 'is_conference_champion',
    label: 'If 2025 conference champs… (conditional sentence)',
    snippet: '{{#if is_conference_champion}}Congratulations on winning the {{conference_champion_name}} last year!{{/if}}',
  },
  { token: 'graduating_seniors_count', label: 'Graduating Seniors Count' },
  { token: 'graduating_seniors_names', label: 'Graduating Seniors Names' },
  { token: 'graduating_starters_count', label: 'Graduating Starters Count' },
  { token: 'graduating_starters_names', label: 'Graduating Starters Names' },
  { token: 'player_name', label: 'Player Name' },
  { token: 'player_position', label: 'Player Position' },
  { token: 'player_secondary_position', label: 'Secondary Position' },
  { token: 'player_gpa', label: 'GPA' },
  { token: 'player_graduation_year', label: 'Graduation Year' },
  { token: 'player_highlights_url', label: 'Highlights URL' },
  { token: 'player_profile_url', label: 'Tracked Profile Link' },
];

export const DEFAULT_EMAIL_SUBJECT = 'Recruitment Inquiry – {{player_name}} ({{player_position}})';

export const DEFAULT_EMAIL_TEMPLATE = `Dear {{coach_name}},

I hope this message finds you well. I am reaching out on behalf of
{{player_name}}, a talented {{player_position}} who is exploring
collegiate opportunities for the {{player_graduation_year}} season.

I noticed that {{college_name}} has {{graduating_seniors_count}}
graduating {{player_position|lowercase}}(s) this season
{{graduating_seniors_names}} — which may create a roster opportunity
for the {{college_nickname}} at the {{player_position}} position.

{{player_name}} brings strong qualities that could make them an
excellent fit for your program:
• Position: {{player_position}}{{player_secondary_position}}
• GPA: {{player_gpa}}
• Graduation Year: {{player_graduation_year}}

Profile and highlight film:
{{player_profile_url}}

We would love the opportunity to discuss {{player_name}}'s potential
fit within your program...

Best regards,
[Your Name]
[Your Contact Information]`;

function formatNameList(names) {
  const list = (names || []).filter(Boolean);
  if (list.length === 0) return 'names could not be verified from official sources';
  if (list.length === 1) return `(${list[0]})`;
  if (list.length === 2) return `(${list[0]} and ${list[1]})`;
  return `(${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]})`;
}

/**
 * Builds the token-resolution context from the player profile, a matched
 * college/CollegeCard result object, and the specific coach being addressed.
 */
export function buildEmailContext(player, college, coachName) {
  const secondary = player.secondary_position && player.secondary_position !== 'None'
    ? ` / ${player.secondary_position}`
    : '';
  const highlights = player.highlights_url
    ? `• Highlights: ${player.highlights_url}`
    : '';

  return {
    coach_name: coachName || 'Coach',
    college_name: college.name || '',
    college_division: college.division || '',
    college_conference: college.conference || '',
    college_location: college.location || '',
    // Falls back to the plain school name so a template referencing the
    // nickname never reads broken for a school we haven't backfilled yet.
    college_nickname: college.nickname || college.name || '',
    college_mascot: college.mascot || '',
    // For templates that use the nickname as the sentence's own subject
    // ("{{college_nickname}} {{college_nickname_have}} real depth..."),
    // where "have"/"has" has to agree with whether the nickname reads as
    // plural ("Blue Devils") or singular ("Cardinal"). Defaults to singular
    // when we don't know (nickname missing, or not yet classified) since
    // that's what agrees with the college_name fallback above.
    college_nickname_have: college.nickname_plural ? 'have' : 'has',
    college_nickname_are: college.nickname_plural ? 'are' : 'is',
    // college_nickname above always resolves (it falls back to the plain
    // school name), so it can't be used to gate a {{#if}} block on whether
    // we actually HAVE a real nickname -- these two exist for exactly that,
    // checking the underlying data rather than the display value.
    has_real_nickname: college.nickname ? 'true' : '',
    has_mascot: college.mascot ? 'true' : '',
    // Kept separate from college_conference (which can be stale after
    // realignment) -- this is whichever conference Wikipedia's own 2025
    // results actually credited the win to, so the sentence stays correct
    // even when that drifts from our stored conference field.
    conference_champion_name: college.conference_champion_name || '',
    is_conference_champion: college.conference_champion_2025 ? 'true' : '',
    graduating_seniors_count: String(college.graduating_seniors_at_position ?? 0),
    graduating_seniors_names: formatNameList(college.graduating_senior_names_at_position),
    graduating_starters_count: String(college.graduating_starters_at_position ?? 0),
    graduating_starters_names: formatNameList(college.graduating_starter_names_at_position),
    player_name: player.full_name || '',
    player_position: player.position || '',
    player_secondary_position: secondary,
    player_gpa: player.gpa != null && player.gpa !== '' ? String(player.gpa) : 'N/A',
    player_graduation_year: player.graduation_year != null ? String(player.graduation_year) : '',
    player_highlights_url: highlights,
    // Resolved per coach on the server at send time, because the link carries
    // that coach's own tracking token. Left as-is here so the composer preview
    // shows where it will land.
    player_profile_url: '{{player_profile_url}}',
  };
}

function applyFilter(value, filter) {
  if (!filter) return value;
  if (filter === 'lowercase') return String(value).toLowerCase();
  if (filter === 'uppercase') return String(value).toUpperCase();
  return value;
}

function resolveToken(key, context) {
  if (Object.prototype.hasOwnProperty.call(context, key)) return context[key];
  return undefined;
}

/**
 * Resolves {{#if token}}...{{/if}} and {{#if token}}...{{else}}...{{/if}}
 * blocks against the context, keeping only the branch that applies, BEFORE
 * plain token substitution runs -- so a sentence built around optional data
 * (mascot, a real nickname) can be dropped or swapped entirely instead of
 * just leaving a blank where the missing value would have gone. An unknown
 * or empty-string token counts as false. Blocks don't nest.
 */
function resolveConditionals(template, context) {
  return template.replace(/\{\{#if\s+([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, inner) => {
    const resolved = resolveToken(key, context);
    const [truthyPart, falsyPart = ''] = inner.split(/\{\{else\}\}/);
    return resolved ? truthyPart : falsyPart;
  });
}

/**
 * Replaces every {{token}} or {{token|filter}} occurrence using the given
 * context. Unknown tokens are left as-is. Resolves {{#if}} blocks first
 * (see resolveConditionals), then collapses any resulting run of 3+
 * blank lines left behind by a removed block back down to one blank line.
 */
export function fillTemplate(template, context) {
  if (!template) return '';
  const withConditionals = resolveConditionals(template, context);
  const filled = withConditionals.replace(/\{\{[^}]+\}\}/g, (match) => {
    const inner = match.slice(2, -2).trim();
    const [rawKey, filter] = inner.split('|').map((s) => s.trim());
    const resolved = resolveToken(rawKey, context);
    if (resolved === undefined) return match;
    return applyFilter(resolved, filter);
  });
  return filled.replace(/\n{3,}/g, '\n\n');
}
