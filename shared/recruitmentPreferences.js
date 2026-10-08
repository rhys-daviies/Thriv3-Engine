/**
 * RECRUITMENT PREFERENCES — where an athlete wants to be, and what kind of
 * school, read one way by the form, the matcher and the match card.
 *
 * ===========================================================================
 * TWO KINDS OF PREFERENCE, AND THE DIFFERENCE IS STATED, NOT HIDDEN.
 *
 *   RANKED   Location (states and regions). The frozen V2 engine already has
 *            a `locationFit` component in Opportunity; until this module it
 *            was never handed an answer, so every programme read "location
 *            not collected". A region is expanded to its states HERE, at the
 *            input boundary, because the engine's own region branch is not
 *            implemented - an athlete who said "the Northeast" must not be
 *            scored as having said nothing.
 *
 *   CHECKED  Division, conference, institution type and the academic floor.
 *            V2 does not filter or score on any of them (the service hands the
 *            engine an empty division list on purpose), so they are reported on
 *            each match as a fact about the programme against what the athlete
 *            said - inside, outside, or unknown - and never as a number.
 *
 * NOTHING UNSTATED IS INFERRED. An empty list is "no preference", and a
 * programme whose state, conference, ownership or academic rating Thriv3 does
 * not hold is UNKNOWN for that check - not a match, and not a miss.
 * ===========================================================================
 */

/** The four US Census regions, which is the grouping a family already uses. */
export const REGIONS = Object.freeze({
  NORTHEAST: Object.freeze({ label: 'Northeast', states: Object.freeze(['CT', 'MA', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT']) }),
  MIDWEST: Object.freeze({ label: 'Midwest', states: Object.freeze(['IA', 'IL', 'IN', 'KS', 'MI', 'MN', 'MO', 'ND', 'NE', 'OH', 'SD', 'WI']) }),
  SOUTH: Object.freeze({ label: 'South', states: Object.freeze(['AL', 'AR', 'DC', 'DE', 'FL', 'GA', 'KY', 'LA', 'MD', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA', 'WV']) }),
  WEST: Object.freeze({ label: 'West', states: Object.freeze(['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NM', 'NV', 'OR', 'UT', 'WA', 'WY']) }),
});

export const REGION_KEYS = Object.freeze(Object.keys(REGIONS));

/** Every state code a preference may name: the union of the regions (50 states + DC). */
export const STATE_CODES = Object.freeze(REGION_KEYS.flatMap((r) => REGIONS[r].states).sort());

export function regionOfState(code) {
  const c = String(code ?? '').trim().toUpperCase();
  return REGION_KEYS.find((r) => REGIONS[r].states.includes(c)) ?? null;
}

/**
 * Institutional control, as College Scorecard codes it on `colleges.control`.
 * 339 active programmes carry no code; those are UNKNOWN, never assumed public.
 */
export const INSTITUTION_TYPES = Object.freeze({
  PUBLIC: Object.freeze({ label: 'Public', control: 1 }),
  PRIVATE_NONPROFIT: Object.freeze({ label: 'Private (non-profit)', control: 2 }),
  PRIVATE_FOR_PROFIT: Object.freeze({ label: 'Private (for-profit)', control: 3 }),
});

export const INSTITUTION_TYPE_KEYS = Object.freeze(Object.keys(INSTITUTION_TYPES));

export function institutionTypeOfControl(control) {
  const n = Number(control);
  return INSTITUTION_TYPE_KEYS.find((k) => INSTITUTION_TYPES[k].control === n) ?? null;
}

/** The new list columns on `players`. JSON arrays; empty or NULL means "not stated". */
export const PREFERENCE_LIST_FIELDS = Object.freeze(['preferred_states', 'preferred_regions', 'preferred_institution_types']);

/**
 * A stored list, whichever way it arrives: an array from the entity layer, a
 * JSON string from a raw row, or NULL. Anything unparseable is treated as no
 * answer rather than guessed at.
 */
export function readList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const upperSet = (list) => [...new Set(readList(list).map((v) => String(v).trim().toUpperCase()).filter(Boolean))].sort();

/**
 * Refuse a list that names something this module does not know, so a typo in
 * a script cannot become a preference that silently matches nothing. Returns
 * an error sentence, or null when every list is valid.
 */
export function preferenceListError(data) {
  const checks = [
    ['preferred_states', STATE_CODES, 'state code'],
    ['preferred_regions', REGION_KEYS, 'region'],
    ['preferred_institution_types', INSTITUTION_TYPE_KEYS, 'institution type'],
  ];
  for (const [field, allowed, noun] of checks) {
    if (!Object.prototype.hasOwnProperty.call(data ?? {}, field)) continue;
    const raw = data[field];
    if (raw !== null && raw !== undefined && !Array.isArray(raw) && typeof raw !== 'string') {
      return `${field} must be a list`;
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
      try { if (!Array.isArray(JSON.parse(raw))) return `${field} must be a list`; } catch { return `${field} must be a list`; }
    }
    const bad = upperSet(raw).filter((v) => !allowed.includes(v));
    if (bad.length) return `${field} names an unknown ${noun}: ${bad.join(', ')}`;
  }
  return null;
}

/**
 * The states a location preference covers, or null when none was stated.
 * Regions are expanded and merged with any individually chosen states.
 */
export function preferredStatesOf(record) {
  const states = upperSet(record?.preferred_states).filter((s) => STATE_CODES.includes(s));
  for (const r of upperSet(record?.preferred_regions)) {
    if (REGIONS[r]) states.push(...REGIONS[r].states);
  }
  const out = [...new Set(states)].sort();
  return out.length ? out : null;
}

const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Every recruitment preference an athlete has stated, normalised. */
export function recruitmentPreferencesOf(record) {
  return {
    divisions: readList(record?.preferred_divisions).map(String),
    conferences: readList(record?.preferred_conferences).map(String),
    states: upperSet(record?.preferred_states).filter((s) => STATE_CODES.includes(s)),
    regions: upperSet(record?.preferred_regions).filter((r) => REGION_KEYS.includes(r)),
    locationStates: preferredStatesOf(record),
    institutionTypes: upperSet(record?.preferred_institution_types).filter((t) => INSTITUTION_TYPE_KEYS.includes(t)),
    academicMinimum: toNumber(record?.academic_minimum),
  };
}

export const CHECK = Object.freeze({
  DIVISION: 'DIVISION',
  CONFERENCE: 'CONFERENCE',
  LOCATION: 'LOCATION',
  INSTITUTION_TYPE: 'INSTITUTION_TYPE',
  ACADEMIC_MINIMUM: 'ACADEMIC_MINIMUM',
});

export const CHECK_STATUS = Object.freeze({ INSIDE: 'INSIDE', OUTSIDE: 'OUTSIDE', UNKNOWN: 'UNKNOWN' });

/**
 * One programme against what the athlete said - only for preferences they
 * actually stated. `ranked` says whether the matcher scored the preference
 * (location) or only checks it here, so a card cannot imply a filter that did
 * not run.
 */
export function preferenceChecks(prefs, college) {
  if (!prefs) return [];
  const c = college ?? {};
  const out = [];
  const inList = (list, value) => (value === null || value === undefined || value === ''
    ? CHECK_STATUS.UNKNOWN
    : (list.includes(value) ? CHECK_STATUS.INSIDE : CHECK_STATUS.OUTSIDE));

  if (prefs.divisions?.length) {
    out.push({ check: CHECK.DIVISION, status: inList(prefs.divisions, c.division ?? null), actual: c.division ?? null, stated: prefs.divisions, ranked: false });
  }
  if (prefs.conferences?.length) {
    out.push({ check: CHECK.CONFERENCE, status: inList(prefs.conferences, c.conference ?? null), actual: c.conference ?? null, stated: prefs.conferences, ranked: false });
  }
  if (prefs.locationStates?.length) {
    const state = c.state ? String(c.state).toUpperCase() : null;
    out.push({
      check: CHECK.LOCATION, status: inList(prefs.locationStates, state), actual: state,
      stated: { states: prefs.states ?? [], regions: prefs.regions ?? [] }, ranked: true,
    });
  }
  if (prefs.institutionTypes?.length) {
    const type = institutionTypeOfControl(c.control);
    out.push({ check: CHECK.INSTITUTION_TYPE, status: inList(prefs.institutionTypes, type), actual: type, stated: prefs.institutionTypes, ranked: false });
  }
  if (prefs.academicMinimum !== null && prefs.academicMinimum !== undefined) {
    const rating = toNumber(c.academic_rating);
    out.push({
      check: CHECK.ACADEMIC_MINIMUM,
      status: rating === null ? CHECK_STATUS.UNKNOWN : (rating >= prefs.academicMinimum ? CHECK_STATUS.INSIDE : CHECK_STATUS.OUTSIDE),
      actual: rating, stated: prefs.academicMinimum, ranked: false,
    });
  }
  return out;
}
