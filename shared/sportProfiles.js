/**
 * Per-sport display definitions for players.sport_attributes.
 *
 * Universal fields (name, height, weight, academics, NCAA ID, contacts) are
 * real columns on `players`. Everything that varies by sport lives in the
 * sport_attributes JSON blob and is described here — label, unit and display
 * order. Adding a sport is an entry in this file, never a migration.
 */

const SOCCER_GROUPS = [
  {
    key: 'physical_technical',
    label: 'Physical & technical',
    fields: [
      { key: 'preferred_foot', label: 'Preferred foot' },
      { key: 'sprint_30m', label: '30 m sprint', unit: 's' },
      { key: 'top_speed', label: 'Top speed', unit: 'km/h' },
      { key: 'yo_yo_ir1', label: 'Yo-Yo IR1' },
    ],
  },
  {
    key: 'season_output',
    label: 'Season output',
    fields: [
      { key: 'appearances', label: 'Appearances' },
      { key: 'goals', label: 'Goals', emphasis: true },
      { key: 'assists', label: 'Assists', emphasis: true },
      { key: 'minutes', label: 'Minutes' },
      { key: 'dribbles_per_90', label: 'Dribbles / 90' },
      { key: 'chances_per_90', label: 'Chances / 90' },
    ],
  },
];

export const SPORT_PROFILES = {
  'mens-soccer': { label: "Men's Soccer", groups: SOCCER_GROUPS },
  'womens-soccer': { label: "Women's Soccer", groups: SOCCER_GROUPS },
};

export const DEFAULT_SPORT = 'mens-soccer';

export function getSportProfile(sport) {
  return SPORT_PROFILES[sport] || SPORT_PROFILES[DEFAULT_SPORT];
}

function isPresent(value) {
  return value !== null && value !== undefined && value !== '';
}

/**
 * Projects a sport_attributes blob into ordered, labelled groups, dropping
 * every field with no value and every group left empty. Callers render what
 * comes back verbatim — a missing value must omit the row, never render
 * "N/A" or an empty cell.
 */
export function describeAttributes(sport, attributes) {
  const attrs = attributes || {};
  return getSportProfile(sport).groups
    .map((group) => ({
      key: group.key,
      label: group.label,
      fields: group.fields
        .filter((f) => isPresent(attrs[f.key]))
        .map((f) => ({ ...f, value: attrs[f.key] })),
    }))
    .filter((group) => group.fields.length > 0);
}
