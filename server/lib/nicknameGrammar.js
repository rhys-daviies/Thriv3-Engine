/**
 * Whether a team nickname takes a plural verb ("the Blue Devils have...")
 * or singular ("the Cardinal has..."). Most college nicknames are plainly
 * plural (ends in "s"); the handful of well-known exceptions that read as a
 * singular collective (Cardinal, Orange, Crimson Tide, Wolf Pack, Green
 * Wave...) fall through to the singular default since they don't end in
 * "s" and aren't "-men"/"-women"/"Irish" compounds.
 *
 * A dual name ("Bears & Sugar Bears", men's + women's teams differing) is
 * judged by its first segment -- in practice both sides agree anyway.
 */
export function isPluralNickname(nickname) {
  if (!nickname) return null;
  const firstSegment = nickname.split('&')[0].trim();
  const words = firstSegment.split(/\s+/);
  const last = (words[words.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!last) return null;
  if (last === 'irish') return true;
  if (last.endsWith('men') || last.endsWith('women')) return true;
  return last.endsWith('s');
}
