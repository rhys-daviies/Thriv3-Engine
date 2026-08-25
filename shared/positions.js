/**
 * Positions: the stored key, and the word a person reads.
 *
 * These are two different things and the codebase had only the first, so the
 * key leaked into prose. The keys are a mixed bag grammatically — GOALKEEPER
 * and FORWARD name a person, DEFENSE names an abstraction and MIDFIELD names
 * a region of grass — which is invisible while they are only map keys and
 * obvious the moment they are printed. Coaches were reading "a talented
 * Defense who is exploring collegiate opportunities" and "4 graduating
 * defense(s) this season".
 *
 * The keys do not change. 114,434 roster rows use them, the cohort index is
 * built from them, and EXPECTED_ANNUAL_NEED is keyed on them. What changes is
 * that nothing renders them directly any more.
 */

export const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];

/** The person who plays there, which is what a sentence about a recruit needs. */
export const POSITION_NOUN = {
  GOALKEEPER: 'goalkeeper',
  DEFENSE: 'defender',
  MIDFIELD: 'midfielder',
  FORWARD: 'forward',
};

/** Regular plurals, spelled out rather than derived, so a future irregular fits. */
export const POSITION_PLURAL = {
  GOALKEEPER: 'goalkeepers',
  DEFENSE: 'defenders',
  MIDFIELD: 'midfielders',
  FORWARD: 'forwards',
};

const GK = ['GK', 'G', 'GOALKEEPER', 'GOALIE', 'KEEPER'];
const DEF = ['D', 'DEF', 'DEFENSE', 'DEFENCE', 'DEFENDER', 'CB', 'RB', 'LB', 'FB', 'WB', 'RWB', 'LWB', 'SW'];
const MID = ['M', 'MID', 'MIDFIELD', 'MIDFIELDER', 'CM', 'DM', 'AM', 'CDM', 'CAM', 'RM', 'LM'];
const FWD = ['F', 'FWD', 'FORWARD', 'ST', 'STRIKER', 'W', 'WING', 'WINGER', 'RW', 'LW', 'CF', 'ATTACKER'];

const LOOKUP = new Map();
for (const [key, labels] of [['GOALKEEPER', GK], ['DEFENSE', DEF], ['MIDFIELD', MID], ['FORWARD', FWD]]) {
  for (const label of labels) LOOKUP.set(label, key);
}

/**
 * Any spelling of a position to the one key everything else is indexed by.
 *
 * A dual label ("M/F", "D/M") reads as its left side, which is the convention
 * the roster import already follows. Anything unrecognised is UNKNOWN rather
 * than a guess — a mis-assigned position moves an athlete into the wrong
 * cohort and quietly changes their whole match list.
 */
export function canonicalPosition(raw) {
  if (!raw) return 'UNKNOWN';
  const first = String(raw).split(/[/,]/)[0].trim().toUpperCase();
  return LOOKUP.get(first) || 'UNKNOWN';
}

/**
 * The word for one of them, capitalised for a label and lower for prose.
 *
 * Falls back to the input rather than to "unknown" when the position is not
 * recognised: a profile that reads "Sweeper" is better than one that reads
 * "Unknown", and worse data should not be laundered into a confident word.
 */
export function positionNoun(raw) {
  const key = canonicalPosition(raw);
  return POSITION_NOUN[key] || String(raw || '').trim().toLowerCase();
}

export function positionPlural(raw) {
  const key = canonicalPosition(raw);
  if (POSITION_PLURAL[key]) return POSITION_PLURAL[key];
  const fallback = String(raw || '').trim().toLowerCase();
  return fallback ? `${fallback}s` : '';
}

/** Title case, for a chip, a heading, or a form option. */
export function positionLabel(raw) {
  const noun = positionNoun(raw);
  return noun ? noun[0].toUpperCase() + noun.slice(1) : '';
}
