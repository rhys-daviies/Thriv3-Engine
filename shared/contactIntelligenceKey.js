/**
 * PROGRAMME IDENTITY FOR THE CONTACT-INTELLIGENCE READ MODEL.
 *
 * A programme is a COLLEGE AND A SPORT, never a college alone. `coaches`,
 * `athlete_programmes` and `outreach_send` all carry both columns, and one
 * institution runs a men's and a women's programme with different staff,
 * different outreach and different history.
 *
 * So the key is compound everywhere: the server groups on it, the client
 * indexes on it, and every card looks up with its own sport. Keyed on the name
 * alone, Duke men's and Duke women's collapse into one entry — last write wins
 * — and a card then shows another programme's outreach as its own. That is
 * worse than showing nothing, because it is confidently wrong about whether a
 * coach has already been written to.
 *
 * The separator is the ASCII unit separator, which cannot occur in a college
 * name or a sport slug, so no pair of real values can collide by concatenation.
 */
const SEP = '\u001F';

/**
 * @param {string} collegeName canonical `colleges.name`.
 * @param {string} sport canonical sport slug, e.g. `mens-soccer`.
 * @returns {string} the map key for that programme.
 *
 * Both parts are stringified rather than validated: a missing sport yields a
 * key that matches nothing, which a card renders as "no history" — never as
 * another programme's history. The one thing this must not do is silently
 * match a DIFFERENT programme.
 */
export function contactIntelligenceKey(collegeName, sport) {
  return `${collegeName ?? ''}${SEP}${sport ?? ''}`;
}
