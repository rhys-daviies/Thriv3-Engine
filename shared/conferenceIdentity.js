/**
 * WHICH CONFERENCE, AS AN IDENTITY RATHER THAN A STRING.
 *
 * The same conference arrives spelled five ways. Our own `colleges` table holds
 * `PSAC` for men and `Pennsylvania State Athletic Conference` for women, and a
 * conference's own standings page publishes a third spelling again. Comparing
 * raw strings therefore answers "did two sources write the same characters",
 * which is not the question. This module answers "is this the same conference",
 * and it does it by looking the spelling up, never by measuring how similar two
 * spellings are.
 *
 * NO FUZZY MATCHING, AND THE REASON IS IN THE HISTORY. Phase 12B.1 had a
 * normaliser that stripped the word "association", which merged the Southern
 * Conference (Division I) with the Southern Athletic Association (Division III)
 * into one entry sitting in two divisions — and since this file is what a
 * season's division is derived from, that single merge would have benchmarked
 * D1 programmes against D3 pools. Every alias here is written down. A spelling
 * that is not written down is REFUSED, and a refusal costs one programme-season
 * its structural history, which is recoverable. A wrong match is not.
 *
 * SPORT AND DIVISION ARE PART OF THE KEY WHERE THE SPELLING DEMANDS IT.
 * `MAC` is the Mid-American Conference in Division I and the Middle Atlantic
 * Conference in Division III. There is no correct sport-blind answer, so the
 * bare alias resolves only inside a scope, and outside one it is ambiguous.
 *
 * IT HOLDS NO DIVISION. A conference's division is evidence to be collected
 * (`programme_conference_seasons.historical_division`), not a property of its
 * name, and putting it here would make it an assertion of this file's author.
 */

/**
 * Deterministic, and deliberately shallow.
 *
 * Case, accents, punctuation and `&` are spelling. Words are not: nothing is
 * stripped, because stripping is what merged two conferences in 12B.1.
 */
export const normaliseConferenceKey = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/** Why a raw string produced no conference identity. */
export const CONFERENCE_UNRESOLVED = Object.freeze({
  NOT_A_CONFERENCE: 'NOT_A_CONFERENCE',   // "Independent" — a state, not a league
  AMBIGUOUS: 'AMBIGUOUS',                 // spelling belongs to two conferences and no scope was given
  UNKNOWN: 'UNKNOWN',                     // spelling is not on file
  EMPTY: 'EMPTY',
});

/** How an identity was reached. Stored, so a row can be re-examined. */
export const CONFERENCE_METHOD = Object.freeze({
  CANONICAL_NAME: 'CANONICAL_NAME',
  ALIAS: 'ALIAS',
  SCOPED_ALIAS: 'SCOPED_ALIAS',
});

/**
 * Spellings that name a programme's ABSENCE of a conference. They are not
 * conferences, they cannot carry a division, and they are refused by name so
 * that they never quietly become a 1-member conference with a derived division.
 */
const NOT_A_CONFERENCE = new Set([
  'independent', 'independents', 'naia independent', 'ncaa independent',
  'division i independent', 'd1 independent', 'none', 'n a', 'unaffiliated',
]);

/**
 * The canonical conferences, and every spelling that resolves to them.
 *
 * LIFECYCLE IS RECORDED, AND IT IS NOT THE SAME AS AN ALIAS.
 *
 *   `renamedFrom`  one conference, two names — the American Athletic
 *                  Conference became the American Conference, and a 2022 row
 *                  and a 2025 row are the same conference's history.
 *   `mergedInto`   two conferences became a third. The Commonwealth Coast
 *                  Conference and the New England Collegiate Conference both
 *                  became the Conference of New England in 2023, and they were
 *                  never each other. Each keeps its own id, so a 2022 season
 *                  reads as the conference actually played in, and only the
 *                  2023-and-after seasons read as the CNE.
 *   `dissolved`    the conference stopped existing. The Heartland Conference
 *                  (2019) and the Capital Athletic Conference (2020) are both
 *                  still written in `colleges.conference` for programmes that
 *                  have played four seasons somewhere else since. Recording the
 *                  dissolution is what makes that string legible as stale
 *                  rather than as a conference we failed to collect.
 *
 * A DISSOLVED CONFERENCE IS NEVER SILENTLY FORWARDED TO ITS SUCCESSOR. Every
 * Heartland programme in our data is in the Lone Star Conference now, and
 * mapping the string that way would be inferring 2022 membership from a 2019
 * fact. What the string resolves to is the Heartland Conference; what the
 * programme actually played in comes from collection.
 */
export const CONFERENCES = Object.freeze([
  // ── NCAA Division I ────────────────────────────────────────────────────────
  { id: 'acc', name: 'Atlantic Coast Conference', aliases: ['ACC'] },
  { id: 'america-east', name: 'America East Conference', aliases: ['America East'] },
  { id: 'american', name: 'American Conference', aliases: ['American', 'American Athletic Conference', 'AAC', 'The American'], renamedFrom: [{ name: 'American Athletic Conference', until: 2024 }] },
  { id: 'atlantic-10', name: 'Atlantic 10 Conference', aliases: ['Atlantic 10', 'A-10', 'A10'] },
  { id: 'asun', name: 'ASUN Conference', aliases: ['ASUN', 'Atlantic Sun Conference', 'Atlantic Sun'] },
  { id: 'big-12', name: 'Big 12 Conference', aliases: ['Big 12'] },
  { id: 'big-east', name: 'Big East Conference', aliases: ['Big East', 'BIG EAST'] },
  { id: 'big-sky', name: 'Big Sky Conference', aliases: ['Big Sky'] },
  { id: 'big-south', name: 'Big South Conference', aliases: ['Big South'] },
  { id: 'big-ten', name: 'Big Ten Conference', aliases: ['Big Ten', 'B1G'] },
  { id: 'big-west', name: 'Big West Conference', aliases: ['Big West'] },
  { id: 'caa', name: 'Coastal Athletic Association', aliases: ['CAA', 'Colonial Athletic Association'], renamedFrom: [{ name: 'Colonial Athletic Association', until: 2023 }] },
  { id: 'cusa', name: 'Conference USA', aliases: ['CUSA', 'C-USA'] },
  { id: 'horizon', name: 'Horizon League', aliases: ['Horizon'] },
  { id: 'ivy', name: 'Ivy League', aliases: ['Ivy'] },
  { id: 'maac', name: 'Metro Atlantic Athletic Conference', aliases: ['MAAC', 'Metro'] },
  { id: 'mac', name: 'Mid-American Conference', aliases: ['Mid-American Conference', 'Mid American Conference'], scopedAliases: [{ alias: 'MAC', division: 'NCAA D1' }] },
  { id: 'mvc', name: 'Missouri Valley Conference', aliases: ['Missouri Valley', 'MVC'] },
  { id: 'mountain-west', name: 'Mountain West Conference', aliases: ['Mountain West', 'MW'] },
  { id: 'nec', name: 'Northeast Conference', aliases: ['NEC', 'Northeast Conference'] },
  { id: 'ovc', name: 'Ohio Valley Conference', aliases: ['Ohio Valley', 'OVC'] },
  { id: 'pac-12', name: 'Pac-12 Conference', aliases: ['Pac-12', 'Pac 12', 'PAC-12'] },
  { id: 'patriot', name: 'Patriot League', aliases: ['Patriot'] },
  { id: 'sec', name: 'Southeastern Conference', aliases: ['SEC'] },
  { id: 'socon', name: 'Southern Conference', aliases: ['SoCon'], scopedAliases: [{ alias: 'Southern', division: 'NCAA D1' }] },
  { id: 'southland', name: 'Southland Conference', aliases: ['Southland'] },
  { id: 'summit', name: 'Summit League', aliases: ['Summit', 'The Summit League'] },
  { id: 'sun-belt', name: 'Sun Belt Conference', aliases: ['Sun Belt'] },
  { id: 'swac', name: 'Southwestern Athletic Conference', aliases: ['SWAC'] },
  { id: 'wcc', name: 'West Coast Conference', aliases: ['West Coast', 'WCC'] },
  { id: 'uac', name: 'United Athletic Conference', aliases: ['UAC'], formed: 2023 },

  // ── NCAA Division II ──────────────────────────────────────────────────────
  { id: 'cacc', name: 'Central Atlantic Collegiate Conference', aliases: ['CACC'] },
  { id: 'ccaa', name: 'California Collegiate Athletic Association', aliases: ['CCAA'] },
  { id: 'ciaa', name: 'Central Intercollegiate Athletic Association', aliases: ['CIAA'] },
  { id: 'conference-carolinas', name: 'Conference Carolinas', aliases: [] },
  { id: 'ecc', name: 'East Coast Conference', aliases: ['ECC'] },
  { id: 'gac', name: 'Great American Conference', aliases: ['GAC'] },
  { id: 'gliac', name: 'Great Lakes Intercollegiate Athletic Conference', aliases: ['GLIAC'] },
  { id: 'glvc', name: 'Great Lakes Valley Conference', aliases: ['GLVC'] },
  { id: 'gmac', name: 'Great Midwest Athletic Conference', aliases: ['GMAC', 'G-MAC'] },
  { id: 'gnac', name: 'Great Northwest Athletic Conference', aliases: ['GNAC'] },
  { id: 'gsc', name: 'Gulf South Conference', aliases: ['GSC'] },
  { id: 'lsc', name: 'Lone Star Conference', aliases: ['LSC', 'Lone Star'] },
  { id: 'heartland-d2', name: 'Heartland Conference', aliases: ['Heartland'], dissolved: 2019 },
  { id: 'miaa-d2', name: 'Mid-America Intercollegiate Athletics Association', aliases: ['MIAA'] },
  { id: 'mec', name: 'Mountain East Conference', aliases: ['MEC', 'Mountain East'] },
  { id: 'ne10', name: 'Northeast-10 Conference', aliases: ['Northeast-10', 'NE10', 'NE-10'] },
  { id: 'nsic', name: 'Northern Sun Intercollegiate Conference', aliases: ['NSIC'] },
  { id: 'pacwest', name: 'Pacific West Conference', aliases: ['PacWest', 'Pac West'] },
  { id: 'peach-belt', name: 'Peach Belt Conference', aliases: ['Peach Belt', 'PBC'] },
  { id: 'psac', name: 'Pennsylvania State Athletic Conference', aliases: ['PSAC'] },
  { id: 'rmac', name: 'Rocky Mountain Athletic Conference', aliases: ['RMAC'] },
  { id: 'sac', name: 'South Atlantic Conference', aliases: ['SAC'] },
  { id: 'sunshine-state', name: 'Sunshine State Conference', aliases: ['Sunshine State', 'SSC'] },

  // ── NCAA Division III ─────────────────────────────────────────────────────
  { id: 'amcc', name: 'Allegheny Mountain Collegiate Conference', aliases: ['AMCC'] },
  { id: 'arc', name: 'American Rivers Conference', aliases: ['A-R-C', 'Iowa Conference', 'IIAC'], renamedFrom: [{ name: 'Iowa Intercollegiate Athletic Conference', until: 2018 }] },
  { id: 'asc', name: 'American Southwest Conference', aliases: ['ASC'] },
  { id: 'atlantic-east', name: 'Atlantic East Conference', aliases: [] },
  { id: 'centennial', name: 'Centennial Conference', aliases: ['Centennial'] },
  { id: 'ccs', name: 'Collegiate Conference of the South', aliases: ['CCS'] },
  { id: 'ccc-d3', name: 'College Conference of Illinois & Wisconsin', aliases: ['CCIW'] },
  { id: 'cne', name: 'Conference of New England', aliases: ['CNE'], formedFrom: ['ccc', 'necc'], formed: 2023 },
  { id: 'ccc', name: 'Commonwealth Coast Conference', aliases: [], scopedAliases: [{ alias: 'CCC', division: 'NCAA D3' }], mergedInto: { id: 'cne', season: 2023 } },
  { id: 'necc', name: 'New England Collegiate Conference', aliases: ['NECC'], mergedInto: { id: 'cne', season: 2023 } },
  { id: 'capital', name: 'Capital Athletic Conference', scopedAliases: [{ alias: 'CAC', division: 'NCAA D3' }], dissolved: 2020 },
  { id: 'csac', name: 'Colonial States Athletic Conference', aliases: ['CSAC'] },
  { id: 'ctc', name: 'Coast-to-Coast Athletic Conference', aliases: ['C2C', 'Coast to Coast Athletic Conference'] },
  { id: 'cunyac', name: 'City University of New York Athletic Conference', aliases: ['CUNYAC'] },
  { id: 'empire-8', name: 'Empire 8', aliases: ['Empire 8', 'E8'] },
  { id: 'hcac', name: 'Heartland Collegiate Athletic Conference', aliases: ['HCAC'] },
  // The Great NORTHEAST Athletic Conference, Division III — not the Great
  // NORTHWEST one, which is Division II and already above under `gnac`. Our own
  // `colleges.conference` never names it, which is why the 12D inventory (built
  // from that vocabulary) did not look for it and Albertus Magnus has no
  // structural history. Two conferences, one abbreviation, and neither may hold
  // the bare "GNAC".
  { id: 'gnac-d3', name: 'Great Northeast Athletic Conference', aliases: [] },
  { id: 'landmark', name: 'Landmark Conference', aliases: ['Landmark', 'LANDMARK'] },
  { id: 'lec', name: 'Little East Conference', aliases: ['LEC'] },
  { id: 'liberty-league', name: 'Liberty League', aliases: [] },
  // The Middle Atlantic Conference runs its soccer as two divisions and
  // publishes ONE standings table for both, titled "Middle Atlantic
  // Conference". So the parent is what a source can establish, and the two
  // divisions are what our own `colleges.conference` records. Both are kept:
  // a member row collected from that table is a MAC member, and which of the
  // two divisions it sat in is not something the table says.
  { id: 'mac-d3', name: 'Middle Atlantic Conference', aliases: ['MAC-D3'], pods: ['mac-commonwealth', 'mac-freedom'] },
  { id: 'mac-commonwealth', name: 'Middle Atlantic Conference (Commonwealth)', aliases: ['MAC Commonwealth', 'MAC Commonwealth Conference'], podOf: 'mac-d3' },
  { id: 'mac-freedom', name: 'Middle Atlantic Conference (Freedom)', aliases: ['MAC Freedom', 'MAC Freedom Conference'], podOf: 'mac-d3' },
  { id: 'mascac', name: 'Massachusetts State Collegiate Athletic Conference', aliases: ['MASCAC'] },
  { id: 'miaa-d3', name: 'Michigan Intercollegiate Athletic Association', aliases: ['MIAA-D3'] },
  { id: 'miac', name: 'Minnesota Intercollegiate Athletic Conference', aliases: ['MIAC'] },
  { id: 'midwest', name: 'Midwest Conference', aliases: ['MWC-D3'] },
  { id: 'nac', name: 'North Atlantic Conference', aliases: ['NAC'] },
  { id: 'nacc', name: 'Northern Athletics Collegiate Conference', aliases: ['NACC'] },
  { id: 'ncac', name: 'North Coast Athletic Conference', aliases: ['NCAC'] },
  { id: 'nescac', name: 'New England Small College Athletic Conference', aliases: ['NESCAC'] },
  { id: 'newmac', name: "New England Women's and Men's Athletic Conference", aliases: ['NEWMAC'] },
  { id: 'njac', name: 'New Jersey Athletic Conference', aliases: ['NJAC'] },
  { id: 'nwc', name: 'Northwest Conference', aliases: ['NWC'] },
  { id: 'oac', name: 'Ohio Athletic Conference', aliases: ['OAC'] },
  { id: 'odac', name: 'Old Dominion Athletic Conference', aliases: ['ODAC'] },
  { id: 'pac-d3', name: "Presidents' Athletic Conference", aliases: ['PAC'] },
  { id: 'saa', name: 'Southern Athletic Association', aliases: ['SAA'] },
  { id: 'scac', name: 'Southern Collegiate Athletic Conference', aliases: ['SCAC'] },
  { id: 'sciac', name: 'Southern California Intercollegiate Athletic Conference', aliases: ['SCIAC'] },
  { id: 'skyline', name: 'Skyline Conference', aliases: ['Skyline'] },
  { id: 'sliac', name: 'St. Louis Intercollegiate Athletic Conference', aliases: ['SLIAC'] },
  { id: 'sunyac', name: 'State University of New York Athletic Conference', aliases: ['SUNYAC'] },
  { id: 'uaa', name: 'University Athletic Association', aliases: ['UAA'] },
  { id: 'umac', name: 'Upper Midwest Athletic Conference', aliases: ['UMAC'] },
  { id: 'united-east', name: 'United East Conference', aliases: ['NEAC', 'North Eastern Athletic Conference'], renamedFrom: [{ name: 'North Eastern Athletic Conference', until: 2021 }] },
  { id: 'usa-south', name: 'USA South Athletic Conference', aliases: ['USA South'] },
  { id: 'wiac', name: 'Wisconsin Intercollegiate Athletic Conference', aliases: ['WIAC'] },

  // ── NAIA ──────────────────────────────────────────────────────────────────
  { id: 'aac-naia', name: 'Appalachian Athletic Conference', aliases: ['Appalachian'] },
  { id: 'amc-naia', name: 'American Midwest Conference', aliases: ['AMC'] },
  { id: 'calpac', name: 'California Pacific Conference', aliases: ['Cal Pac', 'CalPac'] },
  { id: 'cascade', name: 'Cascade Collegiate Conference', aliases: ['Cascade', 'CCC-NAIA'] },
  { id: 'ccac-naia', name: 'Chicagoland Collegiate Athletic Conference', aliases: ['CCAC'] },
  { id: 'continental', name: 'Continental Athletic Conference', aliases: ['CAC-NAIA'] },
  { id: 'crossroads', name: 'Crossroads League', aliases: [] },
  { id: 'frontier', name: 'Frontier Conference', aliases: ['Frontier'] },
  { id: 'gpac', name: 'Great Plains Athletic Conference', aliases: ['GPAC'] },
  { id: 'gsac', name: 'Golden State Athletic Conference', aliases: ['GSAC', 'Golden State'] },
  { id: 'gsac-sw', name: 'Great Southwest Athletic Conference', aliases: ['GSAC-SW'] },
  { id: 'haac', name: 'Heart of America Athletic Conference', aliases: ['HAAC', 'Heart'] },
  { id: 'hbcuac', name: 'HBCU Athletic Conference', aliases: ['HBCUAC'] },
  { id: 'kcac', name: 'Kansas Collegiate Athletic Conference', aliases: ['KCAC'] },
  { id: 'mid-south', name: 'Mid-South Conference', aliases: ['Mid-South'] },
  { id: 'rrac', name: 'Red River Athletic Conference', aliases: ['RRAC'] },
  { id: 'rsc', name: 'River States Conference', aliases: ['RSC'] },
  { id: 'sooner', name: 'Sooner Athletic Conference', aliases: ['Sooner', 'SAC-NAIA'] },
  { id: 'ssac', name: 'Southern States Athletic Conference', aliases: ['SSAC'] },
  { id: 'sun-naia', name: 'Sun Conference', aliases: ['The Sun Conference'] },
  { id: 'whac', name: 'Wolverine-Hoosier Athletic Conference', aliases: ['WHAC'] },
]);

/**
 * The lookup, built once. A spelling claimed by two conferences is recorded as
 * a collision and resolves to nothing unless a scope names one of them — it is
 * NOT resolved by preferring the first, the biggest or the most recent.
 */
function buildIndex() {
  const byKey = new Map();
  const collisions = new Map();
  const scoped = new Map();
  const add = (raw, entry, method) => {
    const k = normaliseConferenceKey(raw);
    if (!k) return;
    const prev = byKey.get(k);
    if (prev && prev.id !== entry.id) {
      if (!collisions.has(k)) collisions.set(k, new Set([prev.id]));
      collisions.get(k).add(entry.id);
      return;
    }
    byKey.set(k, { id: entry.id, name: entry.name, method });
  };
  for (const c of CONFERENCES) {
    add(c.name, c, CONFERENCE_METHOD.CANONICAL_NAME);
    for (const a of c.aliases ?? []) add(a, c, CONFERENCE_METHOD.ALIAS);
    for (const r of c.renamedFrom ?? []) add(r.name, c, CONFERENCE_METHOD.ALIAS);
    for (const s of c.scopedAliases ?? []) {
      const k = `${normaliseConferenceKey(s.alias)}|${s.sport ?? '*'}|${s.division ?? '*'}`;
      scoped.set(k, { id: c.id, name: c.name, method: CONFERENCE_METHOD.SCOPED_ALIAS });
    }
  }
  return { byKey, collisions, scoped };
}
const INDEX = buildIndex();

/** Every canonical id, for callers that need to seed a table. */
export const conferenceById = (id) => CONFERENCES.find((c) => c.id === id) ?? null;

/** Spellings this file knows are claimed by more than one conference. */
export const aliasCollisions = () => [...INDEX.collisions.entries()]
  .map(([key, ids]) => ({ key, ids: [...ids].sort() }));

/**
 * One raw conference string to one conference, or a stated refusal.
 *
 * @param raw   the spelling as the source wrote it
 * @param scope `{ sport, division }` — used ONLY for spellings registered as
 *   scoped. A scope is never used to break a tie between two unscoped aliases,
 *   because that would make the answer depend on a division we may be trying to
 *   derive from the answer.
 */
export function resolveConference(raw, { sport = null, division = null } = {}) {
  const key = normaliseConferenceKey(raw);
  if (!key) return { id: null, name: null, raw: raw ?? null, reason: CONFERENCE_UNRESOLVED.EMPTY };
  if (NOT_A_CONFERENCE.has(key)) {
    return { id: null, name: null, raw, reason: CONFERENCE_UNRESOLVED.NOT_A_CONFERENCE };
  }
  for (const k of [`${key}|${sport ?? '*'}|${division ?? '*'}`, `${key}|*|${division ?? '*'}`, `${key}|${sport ?? '*'}|*`]) {
    const hit = INDEX.scoped.get(k);
    if (hit) return { ...hit, raw };
  }
  const hit = INDEX.byKey.get(key);
  if (hit) return { ...hit, raw };
  if (INDEX.collisions.has(key)) {
    return { id: null, name: null, raw, reason: CONFERENCE_UNRESOLVED.AMBIGUOUS, candidates: [...INDEX.collisions.get(key)].sort() };
  }
  return { id: null, name: null, raw, reason: CONFERENCE_UNRESOLVED.UNKNOWN };
}
