/**
 * Which staff on a programme should receive recruiting mail.
 *
 * Titles are free text off a hundred different staff pages, so this classifies
 * rather than matches: 'Assistant Coach', "Assistant Men's Soccer Coach",
 * 'Assistant Coach | Head of Goalkeeper Development' and
 * 'Assistant Coach/Equipment Manager' are all the same person to a recruit.
 *
 * What it deliberately does NOT do is exclude a title naming the other sport.
 * That looked like an obvious guard — 31 rows in the men's table carry a
 * women's title — until the rows were read: they are either team-email
 * addresses that are plainly men's (menssoccer@humboldt.edu, mislabelled), or
 * people who genuinely coach both ("Head Men's & Women's Soccer Coach"). In
 * both cases the contact is right and the title is noise.
 */

/**
 * Never written to, whatever else the title says. A volunteer or a graduate
 * assistant is not the person who decides, and a team inbox is not a person.
 */
const HARD_EXCLUDED = [
  [/team\s*email|general\s*inquir/i, 'team-email'],
  [/volunteer/i, 'volunteer'],
  [/graduate\s*(assistant|manager)|^\s*ga\b/i, 'graduate-assistant'],
  [/student\s*(assistant|manager)/i, 'support-staff'],
];

/**
 * Coaching roles, most senior first — order matters, since "Associate Head
 * Coach" contains "Head ... Coach" and would otherwise read as the head.
 */
const INCLUDED = [
  [/associate\s*head/i, 'associate-head'],
  // "head ... coach" within one role phrase. A slash is allowed between them
  // ("Head Men's/Women's Soccer Coach", "Director of Soccer / Head Coach"),
  // a pipe or bracket is not — those separate one job from another, and
  // "Assistant Coach | Head of Goalkeeper Development" is not a head coach.
  [/\bhead\b[^|(]*coach|director of soccer/i, 'head'],
  // Before goalkeeper on purpose: someone billed as an assistant who also runs
  // keeper development is an assistant, and should hear from every recruit
  // rather than only from keepers.
  [/assistant/i, 'assistant'],
  [/goalkeep|keeper\s*coach/i, 'goalkeeper'],
];

/**
 * Checked only after the coaching roles, so a title that is both — "Assistant
 * Coach/Equipment Manager" — is read as the coach they are rather than the
 * kit they also look after.
 */
const SOFT_EXCLUDED = [
  [/director of (operations|soccer operations)|operations coordinator/i, 'operations'],
  [/equipment|media|sports?\s*information|^\s*manager\s*$/i, 'support-staff'],
  [/strength|conditioning|athletic trainer|nutrition|academic advis/i, 'performance-staff'],
];

export const ROLE_ORDER = ['head', 'associate-head', 'assistant', 'goalkeeper'];

/**
 * Classifies a title into a role.
 *
 * Hard exclusions win outright: 'Volunteer Assistant Coach' is a volunteer and
 * 'Graduate Assistant Coach' is a graduate assistant, however much of the word
 * "assistant" is in them. Everything else is read as the coaching role first,
 * so a combined title is the coach they are rather than the second job.
 */
export function classifyRole(title) {
  const text = (title || '').trim();
  if (!text) return 'unknown';
  for (const [pattern, role] of HARD_EXCLUDED) if (pattern.test(text)) return role;
  for (const [pattern, role] of INCLUDED) if (pattern.test(text)) return role;
  for (const [pattern, role] of SOFT_EXCLUDED) if (pattern.test(text)) return role;
  return 'other';
}

/**
 * Should this coach be written to for this athlete?
 *
 * A goalkeeper coach is included only for a goalkeeper: to an outfield recruit
 * they are staff, but to a keeper they are the single most relevant person on
 * the staff and often the one who actually decides.
 */
export function shouldContact(coach, { roles = ['head', 'associate-head', 'assistant'], athletePosition } = {}) {
  const role = classifyRole(coach.position_title);
  if (role === 'goalkeeper') {
    return String(athletePosition || '').toUpperCase().startsWith('GOALKEEP');
  }
  return roles.includes(role);
}

/** Most senior first, so a truncated list keeps the people who matter. */
export function bySeniority(a, b) {
  const rank = (c) => {
    const i = ROLE_ORDER.indexOf(classifyRole(c.position_title));
    return i === -1 ? ROLE_ORDER.length : i;
  };
  return rank(a) - rank(b) || (a.full_name || '').localeCompare(b.full_name || '');
}
