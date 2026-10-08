import {
  positionDetailLabel, positionLabel, canonicalPosition, hasSecondaryPosition,
} from '@shared/positions.js';
import {
  REGIONS, INSTITUTION_TYPES, CHECK, CHECK_STATUS, recruitmentPreferencesOf,
} from '@shared/recruitmentPreferences.js';

/**
 * WHAT AN OPERATOR READS ABOUT POSITIONS AND RECRUITMENT PREFERENCES.
 *
 * Every word here is derived from the shared modules' own vocabularies - the
 * region names, the institution types, the check statuses - so the form, the
 * profile, the ranking bar and the match card cannot describe the same answer
 * four ways.
 *
 * Two promises the sentences keep:
 *   - A preference the matcher SCORES says so, and one it only CHECKS says
 *     that, so nobody reads "outside their divisions" as "filtered out".
 *   - UNKNOWN is said as "not on file", never as a pass or a miss.
 */

/** The athlete's positions as the screen shows them. */
export function positionSummary(player) {
  const primary = player?.position ? positionDetailLabel(player.position) : null;
  const group = canonicalPosition(player?.position);
  const secondary = hasSecondaryPosition(player?.secondary_position)
    ? positionDetailLabel(player.secondary_position) : null;
  return {
    primary,
    /** The group the matcher ranks on, shown when the detail is finer than it. */
    rankedAs: group === 'UNKNOWN' ? null : positionLabel(group),
    secondary,
  };
}

const list = (items) => items.join(', ');

/** "Northeast, plus TX" - regions by name, then any individually chosen states. */
export function locationText(prefs) {
  const regions = prefs.regions.map((r) => REGIONS[r].label);
  const covered = new Set(prefs.regions.flatMap((r) => REGIONS[r].states));
  const extra = prefs.states.filter((s) => !covered.has(s));
  if (!regions.length) return list(extra);
  return extra.length ? `${list(regions)}, plus ${list(extra)}` : list(regions);
}

/**
 * The recruitment preferences, one row each, stated or not. `ranked` is true
 * only for location, which the matcher scores; the rest are checked per match.
 */
export function recruitmentPreferenceRows(player) {
  const p = recruitmentPreferencesOf(player);
  const row = (field, label, stated, text, ranked) => ({
    field, label, stated, text: stated ? text : 'No preference', ranked,
  });
  return [
    row('location', 'Where', !!p.locationStates, locationText(p), true),
    row('preferred_divisions', 'Divisions', p.divisions.length > 0, list(p.divisions), false),
    row('preferred_conferences', 'Conferences', p.conferences.length > 0, list(p.conferences), false),
    row('preferred_institution_types', 'School type', p.institutionTypes.length > 0,
      list(p.institutionTypes.map((t) => INSTITUTION_TYPES[t].label)), false),
    row('academic_minimum', 'Academic minimum', p.academicMinimum !== null, `${p.academicMinimum} or higher`, false),
  ];
}

/** Which snapshot fields a summary row reads, for the "changed since this ranking" mark. */
export const ROW_FIELDS = Object.freeze({
  location: ['preferred_states', 'preferred_regions'],
  preferred_divisions: ['preferred_divisions'],
  preferred_conferences: ['preferred_conferences'],
  preferred_institution_types: ['preferred_institution_types'],
  academic_minimum: ['academic_minimum'],
});

const NOT_ON_FILE = {
  [CHECK.DIVISION]: 'Division not on file, so it cannot be checked against their preference.',
  [CHECK.CONFERENCE]: 'Conference not on file, so it cannot be checked against their preference.',
  [CHECK.LOCATION]: 'State not on file, so it cannot be checked against where they want to be.',
  [CHECK.INSTITUTION_TYPE]: 'Public or private is not on file for this school, so it cannot be checked.',
  [CHECK.ACADEMIC_MINIMUM]: 'Academic rating not on file, so their minimum cannot be checked.',
};

function statedText(check) {
  switch (check.check) {
    case CHECK.LOCATION: {
      const s = check.stated ?? {};
      return locationText({ regions: s.regions ?? [], states: s.states ?? [] });
    }
    case CHECK.INSTITUTION_TYPE: return list(check.stated.map((t) => INSTITUTION_TYPES[t]?.label ?? t));
    case CHECK.ACADEMIC_MINIMUM: return String(check.stated);
    default: return list(check.stated);
  }
}

function actualText(check) {
  if (check.check === CHECK.INSTITUTION_TYPE) return INSTITUTION_TYPES[check.actual]?.label ?? check.actual;
  return String(check.actual);
}

const WHAT = {
  [CHECK.DIVISION]: ['one of the divisions they asked for', 'outside the divisions they asked for'],
  [CHECK.CONFERENCE]: ['one of the conferences they asked for', 'outside the conferences they asked for'],
  [CHECK.LOCATION]: ['inside where they want to be', 'outside where they want to be'],
  [CHECK.INSTITUTION_TYPE]: ['the kind of school they asked for', 'not the kind of school they asked for'],
};

/**
 * One check as a sentence, plus a tone for the marker beside it. The tone is
 * never carried by colour alone: the sentence always says inside, outside or
 * not on file.
 */
export function checkView(check) {
  if (!check) return null;
  const tone = check.status === CHECK_STATUS.INSIDE ? 'fit'
    : check.status === CHECK_STATUS.OUTSIDE ? 'short' : 'unknown';
  let text;
  if (check.status === CHECK_STATUS.UNKNOWN) {
    text = NOT_ON_FILE[check.check];
  } else if (check.check === CHECK.ACADEMIC_MINIMUM) {
    text = check.status === CHECK_STATUS.INSIDE
      ? `Academic rating ${check.actual} meets their minimum of ${check.stated}.`
      : `Academic rating ${check.actual} is below their minimum of ${check.stated}.`;
  } else {
    const [inside, outside] = WHAT[check.check];
    text = `${actualText(check)} is ${check.status === CHECK_STATUS.INSIDE ? inside : outside} (${statedText(check)}).`;
  }
  return {
    key: check.check,
    tone,
    text,
    note: check.ranked ? 'Counted in the ranking' : 'Checked, not ranked',
  };
}

export function checksView(checks) {
  return (checks ?? []).map(checkView).filter(Boolean);
}
