import { positionLabel } from '@shared/positions.js';

/**
 * What one piece of evidence rests on, prepared for display.
 *
 * ONE MODULE FOR ALL SIX SECTIONS. Every row on the Decision Evidence page
 * carries the same serialized `qualification` object, so the drill-down behind
 * every row is built here rather than six times. It takes a wire item and
 * returns labelled rows; it knows nothing about generators.
 *
 * IT IS NOT A DEBUG DRAWER. `dedupeGroup`, `decisionClass`, `polarity`, rank,
 * specificity and the validation flags are not on this payload at all, and
 * nothing here dumps an object. Every row is a decision to show a field, in
 * words, because an operator asked a question it answers.
 */

/**
 * Whether this kind's freshness describes its own source.
 *
 * `rosterFreshness` measures `roster_players.updated_date` — its own reason
 * strings say "these roster rows" — but the shared programme context hands it
 * to every generator regardless of where that generator reads. Showing it
 * indiscriminately puts a staleness warning about the roster underneath a
 * conference title, which describes the wrong table.
 *
 * Audited kind by kind against each generator's declared source:
 *
 *   SAFE            reads roster_players AND makes a present-tense or
 *                   projected claim, so the scrape date is the age of the
 *                   data behind the claim — 11 kinds.
 *   UNSAFE          reads a different table entirely (colleges:*,
 *                   coach_seasons, recruiting_arrivals) — 8 kinds. The two
 *                   found earlier during the academic and context sections
 *                   turned out to be five more than that.
 *   NOT_APPLICABLE  either sends no freshness at all, or reads roster rows
 *                   for a historical claim, where a 2022 roster row does not
 *                   go stale and the current-squad stamp does not describe it
 *                   — 7 kinds.
 *
 * Listed explicitly rather than derived from `source` at runtime, so adding a
 * kind is a decision somebody makes rather than a prefix match that quietly
 * approves itself. An unlisted kind gets no freshness.
 */
export const FRESHNESS_SAFE = Object.freeze(new Set([
  'CURRENT_SAME_COUNTRY',
  'ELIGIBILITY_CLIFF',
  'INTERNATIONAL_ROSTER',
  'INTERNATIONAL_SHARE',
  'POSITION_GRADUATION',
  'POSITION_GRADUATION_STARTERS',
  'POSITION_GROUP_SCARCITY',
  'POSITION_GROUP_SIZE',
  'RETURNING_POSITION_DEPTH',
  'SQUAD_GRADUATION',
  'TRANSFER_BEHAVIOUR',
]));

/**
 * Operator words for each source identifier.
 *
 * The wire carries table and column names — `roster_players:eligibility_end_year`,
 * `colleges:notable_majors` — which are precise and mean nothing to somebody
 * deciding whether to write to a coach. Every one of the twelve real values is
 * mapped explicitly; an unmapped source renders as an explicit gap rather than
 * being guessed at from its prefix, because a wrong provenance label is worse
 * than a missing one.
 */
export const SOURCE_LABEL = Object.freeze({
  roster_players: 'Roster records',
  'roster_players:projected_minutes': 'Roster records — projected minutes',
  'roster_players:eligibility_end_year': 'Roster records — eligibility years',
  'roster_players:prior_programme': 'Roster records — prior programme',
  'roster_players:freshman-minutes': 'Roster records — first-year minutes',
  'roster_players:pool-benchmarks': 'Roster records — compared across programmes',
  recruiting_arrivals: 'Recruiting history',
  coach_seasons: 'Coaching staff records',
  'colleges:notable_majors': 'Programme academic record',
  'colleges:recent_win_pct': 'Programme results record',
  'colleges:postseason_2025_round': 'Programme results record',
  'colleges:conference_champion_2025': 'Programme results record',
});

/**
 * The cohort keys that name a real narrowing, their words, and how to print
 * the value.
 *
 * `region` is ABSENT on purpose. Its value is a bucket name from the
 * recruiting tables — OCEANIA — which means nothing to an operator and which
 * no other surface has ever shown; the row above the drawer already names the
 * countries, which are checkable against the programme's own roster. Printing
 * the key here would have leaked it for the first time.
 *
 * `position` is printed through the shared label helper for the same reason:
 * the cohort carries DEFENSE and a person reads "Defender".
 */
const COHORT_LABEL = Object.freeze({
  position: { label: 'Position', format: (v) => positionLabel(v) || String(v) },
  origin: { label: 'Origin', format: String },
  country: { label: 'Country', format: String },
  coach: { label: 'Coach', format: String },
});

const TEMPORALITY_LABEL = Object.freeze({
  CURRENT: 'Describes the current squad',
  PROJECTED: 'Projected from current data',
  HISTORICAL: 'Describes earlier seasons',
  STATIC: 'A standing fact, not tied to a season',
});

/** Words for a freshness state, used only where the state is not current. */
const FRESHNESS_LABEL = Object.freeze({
  ACCEPTABLE: 'Roster last read a while ago',
  STALE: 'Roster reading is out of date',
  UNKNOWN: 'No read date on the roster rows',
});

/** A season list, spanned only when it genuinely runs without a gap. */
function seasonSpan(seasons = []) {
  const list = seasons.map(String);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const years = list.map(Number);
  const contiguous = years[years.length - 1] - years[0] + 1 === years.length;
  // A window of 2022, 2023, 2025 is never written 2022–2025: the missing year
  // is the whole point of showing the window.
  return contiguous ? `${list[0]}–${list[list.length - 1]}` : list.join(', ');
}

/**
 * The provenance rows for one wire evidence item.
 *
 * @returns {{label: string, value: string}[]} — possibly empty, never null
 *   entries. A field with nothing to say produces no row rather than a row
 *   reading "unknown"; the only "unknown" printed is the one the contract
 *   defines, where `seasonsUnread` is null.
 */
export function provenanceRows(item) {
  const q = item?.qualification;
  if (!q) return [];
  const rows = [];
  const add = (label, value) => { if (value) rows.push({ label, value }); };

  // ---- What period it describes -----------------------------------------
  const window = q.window;
  const seasons = window?.seasons?.length ? seasonSpan(window.seasons) : null;
  add('Seasons read', seasons ?? (q.season || null));

  /**
   * The three unread states, kept three.
   *
   * `[]` means the window was checked and nothing was missing, which needs no
   * row at all. A populated list names the seasons. `null` means readability
   * cannot be stated for this window, and saying so is the only "unknown" this
   * component prints — rendering it as "0 unread" would turn a gap in what we
   * know into a clean bill of health.
   */
  if (window) {
    const unread = window.seasonsUnread;
    if (unread === null || unread === undefined) {
      add('Season coverage', 'Not established for this measurement');
    } else if (unread.length) {
      add(unread.length === 1 ? 'Season not readable' : 'Seasons not readable', unread.join(', '));
    }
  }

  // ---- Who or what it describes ------------------------------------------
  if (window?.cohort) {
    for (const [key, spec] of Object.entries(COHORT_LABEL)) {
      const value = window.cohort[key];
      // Only populated axes. A null one is not narrowed, and printing "any"
      // would describe a cohort the measurement never applied.
      if (value) add(spec.label, spec.format(value));
    }
    // Not an axis: it records the country a regional count left OUT, which
    // narrows nothing. Labelled for what it is rather than as a cohort key.
    if (window.cohort.excludingCountry) {
      add('Counted separately from', String(window.cohort.excludingCountry));
    }
  }

  /**
   * `window.n` IS DELIBERATELY NOT SHOWN.
   *
   * It counts players for the cohort ladder, SEASONS for the programme
   * development pattern, and the whole first-year total for two more. One
   * "Sample: 4" row would carry three meanings across the page and sit beside
   * a section that says "32 first-year players". Each section already states
   * its own sample in its own words, from its own facts, which is the only
   * place the number's meaning is known.
   */

  // ---- What kind of claim it is ------------------------------------------
  add('Nature', TEMPORALITY_LABEL[q.temporality]);
  add('Confidence', q.confidence ? String(q.confidence).toLowerCase() : null);
  // Only ever shown when freshness actually changed the grade. Null on every
  // real item today, so this line is unexercised outside its own test.
  if (q.confidenceBeforeFreshness && q.confidenceBeforeFreshness !== q.confidence) {
    add('Reduced from', `${String(q.confidenceBeforeFreshness).toLowerCase()}, because of the roster reading`);
  }

  // Only for the kinds whose own source is the thing freshness measures.
  if (FRESHNESS_SAFE.has(item.kind) && q.freshness && q.freshness.state !== 'CURRENT') {
    add('Roster reading', q.freshness.reason || FRESHNESS_LABEL[q.freshness.state] || null);
  }

  // ---- What it was compared against --------------------------------------
  const c = q.comparison;
  if (c) {
    add('Compared against', c.basis);
    add('Pool size', Number.isFinite(c.poolSize) ? `${c.poolSize} programmes` : null);
    /**
     * A real percentile if the server sends one, otherwise the band and
     * nothing else. `percentile` is null on all 1,878 real benchmark items,
     * and turning "above-p75" into "roughly the 80th" would be a number
     * nobody computed.
     */
    if (Number.isFinite(c.percentile)) add('Percentile', String(c.percentile));
    else if (c.band) add('Band', String(c.band));
  }

  // ---- Where it came from ------------------------------------------------
  if (q.source) {
    add('Source', SOURCE_LABEL[q.source] ?? `Unrecognised source (${q.source})`);
  }
  /**
   * A page that shows what this claim says, when there is one.
   *
   * FOUR KINDS CARRY IT, on the 74% of programmes whose 2026 roster URL
   * verifies as that school's own athletics site. Everything else stays as it
   * was: the source family and the window, and no link — which is the normal
   * state for a claim derived across seasons, not a gap to apologise for. The
   * panel says nothing about the absence.
   *
   * `href` rather than `value` so the renderer can tell a row it should link
   * from a row it should print. Nothing else in the drawer is a link.
   */
  if (q.sourceUrl) rows.push({ label: 'Roster page', value: 'View source', href: q.sourceUrl });
  /**
   * NO LINK, AND NONE IMPLIED. `sourceUrl` is null on every one of 10,206
   * live objects, so there is nothing to render — and this is the right
   * behaviour rather than a gap waiting to be filled. H11 measured both
   * reasons: nine kinds rest on several seasons and no single page shows
   * what they claim, and of the 4,038 roster pages that do exist, 943 are on
   * a host unverified for that school and one points at a different school
   * altogether. A "View source" that lands on the wrong programme would cost
   * more trust than the missing link does.
   */

  return rows;
}

/** True when there is anything worth opening for this item. */
export function hasProvenance(item) {
  return provenanceRows(item).length > 0;
}
