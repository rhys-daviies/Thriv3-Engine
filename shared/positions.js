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
const MID = ['M', 'MID', 'MIDFIELD', 'MIDFIELDER', 'CM', 'DM', 'AM', 'CDM', 'CAM', 'RM', 'LM', 'WM'];
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

/**
 * DETAILED POSITIONS — the athlete's own, never the roster's.
 *
 * An operator can say "centre-back, can cover at defensive midfield" and the
 * engine still reads DEFENSE: every detailed key below is ALREADY a label
 * `canonicalPosition` resolves, so the cohort an athlete is matched against
 * cannot move because somebody was more specific about them.
 *
 * WHY THE LONG NAMES ARE NOT ALIASES. "Center Back", "Central Midfielder" and
 * friends appear on about sixty corpus roster rows that read as UNKNOWN today.
 * Teaching the lookup those words would quietly move those players into
 * cohorts and shift every athlete's roster opportunity - a ranking change
 * made by a vocabulary edit. The stored key is the short code; the long name
 * is only ever printed. The one key added to the lookup, WM, appears on no
 * roster row (checked against the corpus when it was added).
 *
 * Per sport, because the request is a sport-appropriate model: both soccer
 * programmes share one today, and a sport with no model falls back to the
 * four coarse groups rather than borrowing soccer's detail.
 */
const SOCCER_DETAIL = Object.freeze([
  { key: 'GK', label: 'Goalkeeper', group: 'GOALKEEPER' },
  { key: 'CB', label: 'Center back', group: 'DEFENSE' },
  { key: 'FB', label: 'Fullback', group: 'DEFENSE' },
  { key: 'WB', label: 'Wingback', group: 'DEFENSE' },
  { key: 'DM', label: 'Defensive midfielder', group: 'MIDFIELD' },
  { key: 'CM', label: 'Central midfielder', group: 'MIDFIELD' },
  { key: 'AM', label: 'Attacking midfielder', group: 'MIDFIELD' },
  { key: 'WM', label: 'Wide midfielder', group: 'MIDFIELD' },
  { key: 'W', label: 'Winger', group: 'FORWARD' },
  { key: 'ST', label: 'Striker', group: 'FORWARD' },
].map(Object.freeze));

const COARSE_ONLY = Object.freeze(POSITIONS.map((group) => Object.freeze({
  key: group, label: POSITION_NOUN[group][0].toUpperCase() + POSITION_NOUN[group].slice(1), group,
})));

export const POSITION_MODELS = Object.freeze({
  'mens-soccer': SOCCER_DETAIL,
  'womens-soccer': SOCCER_DETAIL,
});

/** The detailed positions an operator can choose for an athlete in `sport`. */
export function positionModelFor(sport) {
  return POSITION_MODELS[sport] ?? COARSE_ONLY;
}

/**
 * The options grouped under the coarse group the engine reads, each group led
 * by an "any" entry so a legacy coarse value ('Defender', 'DEFENSE') is still
 * a choice the picker can show rather than a blank trigger.
 */
export function positionOptionGroups(sport) {
  const model = positionModelFor(sport);
  return POSITIONS.map((group) => {
    const coarse = COARSE_ONLY.find((c) => c.group === group);
    /**
     * A detail that only restates its group (GK is "Goalkeeper") would sit
     * beside "Goalkeeper (no detail)" as two names for one answer. The coarse
     * entry stands alone there, under the group's plain name.
     */
    const details = model === COARSE_ONLY ? [] : model.filter((d) => d.group === group && d.label !== coarse.label);
    return {
      group,
      label: POSITION_PLURAL[group][0].toUpperCase() + POSITION_PLURAL[group].slice(1),
      options: [
        { key: coarse.label, label: details.length ? `${coarse.label} (no detail)` : coarse.label, group, coarse: true },
        ...details,
      ],
    };
  });
}

const DETAIL_BY_KEY = new Map(SOCCER_DETAIL.map((d) => [d.key, d]));

/**
 * The detailed key a stored value names, or null when it names only a group.
 * Case-insensitive so 'cb' written by a script is the same answer as 'CB'.
 */
export function positionDetail(raw) {
  if (!raw) return null;
  return DETAIL_BY_KEY.get(String(raw).trim().toUpperCase()) ?? null;
}

/**
 * The most specific true name for a stored position: "Center back" for CB,
 * "Defender" for a coarse value, and the raw text for something unrecognised
 * (the same no-laundering rule as `positionNoun`).
 */
export function positionDetailLabel(raw) {
  const d = positionDetail(raw);
  return d ? d.label : positionLabel(raw);
}

/** Whether a value names a position the engine can place in a group. */
export function isKnownPosition(raw) {
  return canonicalPosition(raw) !== 'UNKNOWN';
}

/**
 * The secondary position's sentinel. Stored as written since the column was
 * added; read here so no caller compares against a string literal.
 */
export const NO_SECONDARY_POSITION = 'None';

export function hasSecondaryPosition(raw) {
  return !!raw && String(raw).trim() !== '' && raw !== NO_SECONDARY_POSITION;
}
