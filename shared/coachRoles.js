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
  /**
   * A title that OPENS with "assistant … coach" is an assistant, whatever it
   * says afterwards.
   *
   * Checked before the head rule because the head pattern is not anchored, so
   * it matched the second job in "Assistant Coach / Head EDS Coach" and
   * "Assistant Coach/Head Reserves Coach", and matched "Head Coach" inside
   * "Assistant Head Coach". All three then sorted ahead of the actual head
   * coach and took the greeting.
   *
   * Deliberately requires the word "coach" straight after the assistant
   * phrase, so "Assistant Athletic Director / Head Soccer Coach" — a genuine
   * head coach who is also an AD — is untouched.
   */
  [/^\s*(senior\s+)?assistant\s+(head\s+)?((men|women)'?s?\s+|m\s+|w\s+)?(soccer\s+)?coach\b/i, 'assistant'],
  // "head ... coach" within one role phrase. A slash is allowed between them
  // ("Head Men's/Women's Soccer Coach", "Director of Soccer / Head Coach"),
  // a pipe or bracket is not — those separate one job from another, and
  // "Assistant Coach | Head of Goalkeeper Development" is not a head coach.
  //
  // "director of soccer" is here because at some programmes it IS the senior
  // coaching job. "Director of Soccer OPERATIONS" is not — it is an
  // administrator, and reading it as the head put Abby Williams ahead of head
  // coach Michael Chesler on Utah Valley's email. The lookahead excludes only
  // that variant; "Director of Soccer Operations/Head Coach" still reads as a
  // head through the head-coach alternative beside it.
  [/\bhead\b[^|(]*coach|director of soccer(?!\s*operations)/i, 'head'],
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
  [/director of (operations|soccer operations)|director,?\s*soccer operations|soccer operations|operations coordinator|coordinator of operations/i, 'operations'],
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

/**
 * The title field, wherever it lives.
 *
 * Staff reach this module from two places with two different column names:
 * `coaches.position_title` in the database, and `title` on the
 * `coaching_staff` JSON the matching tab renders. Reading both here is what
 * lets one classifier serve the scripts and the UI instead of the UI growing
 * its own — which it had, and which missed 35% of head coaches because
 * /head coach/i does not match "Head Men's Soccer Coach".
 */
export function titleOf(coach) {
  return coach?.position_title ?? coach?.title ?? '';
}

/** An address we could actually write to. Imports leave 'N/A' for unknown. */
export function hasUsableEmail(coach) {
  const email = (coach?.email || '').trim();
  return Boolean(email) && email.toUpperCase() !== 'N/A';
}

/**
 * Who to write to at a programme, best first.
 *
 * Ends at the shared team inbox on purpose. `classifyRole` hard-excludes that
 * address from a normal staff sweep — a team inbox is not a person and should
 * never receive one of several messages to the same programme — but as the
 * *only* contact on file it is the difference between reaching a programme and
 * skipping it. It is last, and it is labelled.
 *
 * Volunteers and graduate assistants stay excluded at every level. They are
 * not who decides, and a recruit writing to one has spent their single
 * approach on the wrong person.
 */
export const CONTACT_LADDER = ['head', 'associate-head', 'assistant', 'goalkeeper', 'team-email'];

/**
 * Which assistant, when a programme lists several.
 *
 * A recruiting coordinator is not merely senior, they are the person whose job
 * this email is — 53 of them are on file, usually titled "Assistant
 * Coach/Recruiting Coordinator". After that the explicit seniority markers,
 * then whoever the staff page listed first, which is the only ordering the
 * data actually carries.
 */
const ASSISTANT_PRIORITY = [
  [/recruit/i, 0],
  [/\bfirst\b|\bsenior\b|associate/i, 1],
];

function assistantRank(title) {
  for (const [pattern, rank] of ASSISTANT_PRIORITY) if (pattern.test(title || '')) return rank;
  return 2;
}

/**
 * The one person on a staff a recruit writes to first.
 *
 * Walks CONTACT_LADDER and takes the best available. 1,924 of the 1,986
 * school-sports have a head coach; the ladder is what reaches the other 60 —
 * 15 with only an associate head, 21 with only assistants and 24 with only a
 * shared inbox, all of which were previously dropped entirely.
 *
 * The role that actually matched comes back with the coach, so a caller can
 * say who this is rather than quietly passing an assistant off as the head.
 * Returns null only when a programme has no usable address at all (2).
 */
export function pickBestContact(staff = []) {
  const usable = staff.filter(hasUsableEmail);

  for (const role of CONTACT_LADDER) {
    const matches = usable.filter((c) => classifyRole(titleOf(c)) === role);
    if (!matches.length) continue;
    if (role === 'assistant') {
      matches.sort((a, b) => assistantRank(titleOf(a)) - assistantRank(titleOf(b)));
    }
    return { ...matches[0], role };
  }
  return null;
}
