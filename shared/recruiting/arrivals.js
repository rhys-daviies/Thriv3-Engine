/**
 * Who appeared as a new player on a programme's roster, and how sure we are.
 *
 * This is the foundation the recruiting-history intelligence will be built on,
 * and it answers exactly one question:
 *
 *   Between two COMPARABLE seasons, which players are on the later roster and
 *   were not on the earlier one?
 *
 * It does not answer what to say about that. No evidence kind, no copy, no
 * selection — those are later phases, and the frozen outreach baseline is
 * untouched by this file.
 *
 * Pure, like shared/matching and shared/evidence: it takes rows a caller
 * fetched, so the build script, a future route and the tests run identical
 * code.
 *
 * ---------------------------------------------------------------------------
 * THE GATE, which is the whole point.
 *
 * An arrival is the ABSENCE of a name from an earlier roster. Absence is only
 * evidence when the earlier roster exists. 195 men's programmes have a 2025
 * roster and no 2024 one — 6,994 rows, 22.7% of that season — and reading
 * those as arrivals would invent an entire recruiting class for every one of
 * them.
 *
 * So there are two outcomes and no third: DIRECT, where both adjacent rosters
 * are on file, and UNKNOWN, where they are not. There is deliberately no
 * INFERRED: inference here means guessing from missing data, which is the
 * failure this gate exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * FOUR CONFIDENCES, KEPT APART.
 *
 *   arrivalConfidence   did this player appear?           DIRECT | UNKNOWN
 *   identityMethod      how did we match the name?        EXACT | RECONCILED
 *   priorConfidence     where did they come from?         NAME_MATCH |
 *                                                         AMBIGUOUS | NONE
 *   coachAttribution    whose recruit were they?          ATTRIBUTED |
 *                                                         INHERITED | UNKNOWN
 *
 * Collapsing any two of these loses something real. A player can be a DIRECT
 * arrival with an AMBIGUOUS prior programme — we are certain they are new here
 * and cannot say where they came from — and treating that as a confident
 * transfer is the mistake the separation prevents.
 */

import { nameKey } from '../philosophy.js';
import { canonicalPosition } from '../positions.js';
import { readClassYear } from '../classYear.js';
import { tenureFor, sameCoach } from '../coachTenure.js';
import { regionOf } from './regions.js';

/**
 * Every transition the roster data can support, oldest first.
 *
 * Wider than `TRANSITIONS` in philosophy.js, which stops at 2024->2025 because
 * it is describing seasons that have been PLAYED. An arrival into the
 * un-played 2026 season is still an arrival, and it is the one recruiting
 * history cares most about.
 */
export const ARRIVAL_TRANSITIONS = Object.freeze([
  ['2022', '2023'], ['2023', '2024'], ['2024', '2025'], ['2025', '2026'],
]);

export const ARRIVAL_CONFIDENCE = Object.freeze({
  /** Both adjacent rosters on file; the name is on the later one only. */
  DIRECT: 'DIRECT',
  /** The earlier roster is missing, so absence proves nothing. */
  UNKNOWN: 'UNKNOWN',
});

export const IDENTITY_METHOD = Object.freeze({
  /** The name matched itself, and nothing had to be decided. */
  EXACT: 'EXACT',
  /**
   * Two spellings of one person were merged — see `sameHuman`.
   *
   * Either across seasons (a middle name added between a 2023 page and a 2024
   * one) or WITHIN one season, where a roster printed the same player twice
   * under two spellings. The second case produces a stored row; the first only
   * ever suppresses one.
   */
  RECONCILED: 'RECONCILED',
});

export const PRIOR_CONFIDENCE = Object.freeze({
  /**
   * A field that says outright where the player came from. Nothing produces
   * one today — `roster_players.prior_programme` is itself derived by name
   * matching — and the value exists so that a future scraped source has
   * somewhere honest to land rather than being folded into NAME_MATCH.
   */
  OBSERVED: 'OBSERVED',
  /** Exactly one programme carried this name last season. */
  NAME_MATCH: 'NAME_MATCH',
  /** More than one did. Unusable as an origin, kept for debugging. */
  AMBIGUOUS: 'AMBIGUOUS',
  /** No programme did — new to college soccer, or from outside our coverage. */
  NONE: 'NONE',
});

export const COACH_ATTRIBUTION = Object.freeze({
  /** The coach was already in post the season before this intake. */
  ATTRIBUTED: 'ATTRIBUTED',
  /** Their first roster. Recruited by whoever held the job before them. */
  INHERITED: 'INHERITED',
  /** No coach on file for that season. */
  UNKNOWN: 'UNKNOWN',
});

export const ENTRY_TYPE = Object.freeze({
  FRESHMAN: 'FRESHMAN',
  EXPERIENCED: 'EXPERIENCED',
  UNKNOWN: 'UNKNOWN',
});

/**
 * FRESHMAN / EXPERIENCED / UNKNOWN, and nothing finer.
 *
 * Rules, in order:
 *
 *   1. A label that reads as FRESHMAN with no redshirt marker -> FRESHMAN.
 *      This is `isTrueFreshman`'s rule, reached through the same
 *      `readClassYear` parser so the two cannot diverge.
 *   2. A REDSHIRT freshman -> EXPERIENCED. They have been on a campus for a
 *      year, which is what the distinction is about; calling them a freshman
 *      would put a returning player in the intake bucket.
 *   3. Any other recognised class -> EXPERIENCED.
 *   4. Anything unrecognised, blank, or a bare graduation year -> UNKNOWN.
 *
 * EXPERIENCED is NOT a synonym for transfer. It says the player had college
 * years behind them, which is all a class label can support; where they were
 * is `priorConfidence`'s question and usually unanswerable.
 */
export function entryTypeOf(row) {
  const read = readClassYear(row?.class_year_label, { season: row?.season });
  if (!read.klass) return ENTRY_TYPE.UNKNOWN;
  if (read.klass === 'FRESHMAN') {
    return read.redshirt ? ENTRY_TYPE.EXPERIENCED : ENTRY_TYPE.FRESHMAN;
  }
  return ENTRY_TYPE.EXPERIENCED;
}

/** The name split into tokens, after `nameKey` has normalised it. */
const tokensOf = (name) => nameKey(name).split(' ').filter(Boolean);

/**
 * Is the shorter token list the longer one with middle names removed?
 *
 * Deliberately narrow. It requires the FIRST and LAST tokens to be identical
 * and every token of the shorter list to appear in the longer one in order —
 * so "jose corporan" reconciles with "jose navea corporan", and
 * "gerardo fonte" with "gerardo torres fonte".
 *
 * What it refuses is the point. "dylan brown" and "daniel brown" differ in the
 * first token; "ashton allen" and "liam allen" likewise. Both were among the
 * 466 same-surname pairs in the audit and both are different people. Fuzzy
 * matching would merge them, and merging two players is a worse error than
 * missing a reconciliation: it deletes an arrival AND corrupts a departure.
 *
 * A brothers-with-a-middle-name case — "juan garcia" and "juan carlos garcia"
 * — would merge wrongly. The build reports the count so the size of that risk
 * is visible rather than assumed; it was 24 rows in 12,781 on real data.
 */
export function sameHuman(a, b) {
  const x = tokensOf(a);
  const y = tokensOf(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  if (x.length === y.length) return false;          // same length, different names
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  if (short.length < 2) return false;               // a mononym is not enough to go on
  if (short[0] !== long[0]) return false;
  if (short[short.length - 1] !== long[long.length - 1]) return false;
  // Every token of the short name appears in the long one, in order.
  let i = 0;
  for (const t of long) if (t === short[i]) i += 1;
  return i === short.length;
}

/**
 * An index of where each name was in each season, across ALL programmes.
 *
 * Built once by the caller and handed in, because a single programme's rows
 * cannot answer "where else was this player last season" — and that question
 * is the only way to say anything about a transfer origin.
 *
 * @param {Array} allRows every roster row for the sport
 * @returns {Map<string, Map<string, Set<string>>>} season -> nameKey -> programmes
 */
export function buildPriorIndex(allRows = []) {
  const bySeason = new Map();
  for (const r of allRows) {
    const season = String(r.season);
    if (!bySeason.has(season)) bySeason.set(season, new Map());
    const byName = bySeason.get(season);
    const key = nameKey(r.player_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key).add(r.college_name);
  }
  return bySeason;
}

/**
 * Where this player was the season before, and how sure we are.
 *
 * Names that appear at two programmes in one season are AMBIGUOUS rather than
 * resolved to the first hit: 143 of 2,420 name-matched 2026 arrivals (5.9%)
 * are in that state, and picking one would produce a confident, wrong origin
 * for every one of them. The candidates are kept so a person can look.
 */
function priorProgrammeFor({ priorIndex, fromSeason, key, programme }) {
  const byName = priorIndex?.get(String(fromSeason));
  const at = byName?.get(key);
  if (!at || at.size === 0) {
    return { priorProgramme: null, priorConfidence: PRIOR_CONFIDENCE.NONE, priorCandidates: [] };
  }
  // The player's own programme is excluded: this function answers "where else",
  // and a name still present here is not an arrival in the first place.
  const elsewhere = [...at].filter((p) => p !== programme);
  if (elsewhere.length === 0) {
    return { priorProgramme: null, priorConfidence: PRIOR_CONFIDENCE.NONE, priorCandidates: [] };
  }
  if (elsewhere.length === 1) {
    return {
      priorProgramme: elsewhere[0],
      priorConfidence: PRIOR_CONFIDENCE.NAME_MATCH,
      priorCandidates: elsewhere,
    };
  }
  return {
    priorProgramme: null,
    priorConfidence: PRIOR_CONFIDENCE.AMBIGUOUS,
    priorCandidates: elsewhere.sort(),
  };
}

/** Who was in charge for this intake, and whether the intake is theirs. */
function coachFor(tenure, season) {
  if (!tenure) return { coach: null, attribution: COACH_ATTRIBUTION.UNKNOWN };
  const year = Number(season);
  const segment = (tenure.segments || []).find((s) => year >= s.from && year <= s.to);
  if (!segment) return { coach: null, attribution: COACH_ATTRIBUTION.UNKNOWN };
  /**
   * A coach's first roster is the previous regime's recruiting.
   *
   * `FIRST_SEASON_IS_INHERITED` already encodes this for the evidence layer and
   * is reused rather than restated. Attributing an inherited intake to the new
   * coach is the single most likely way to make a false claim about how a
   * programme recruits.
   */
  if (year === segment.from && (tenure.changes || []).some((c) => c.season === segment.from)) {
    return { coach: segment.coach, attribution: COACH_ATTRIBUTION.INHERITED };
  }
  // The first segment of our window has no observed predecessor, so we cannot
  // tell a new appointment from a coach who had been there for years.
  if (year === segment.from && segment === (tenure.segments || [])[0]) {
    return { coach: segment.coach, attribution: COACH_ATTRIBUTION.UNKNOWN };
  }
  return { coach: segment.coach, attribution: COACH_ATTRIBUTION.ATTRIBUTED };
}

/**
 * Which spelling of one person survives, when a roster printed both.
 *
 * Thirteen programme-seasons carry the same human twice: "Magnus Jacobsen" and
 * "Magnus Micha Jacobsen" on Elon's 2025 page, "Tim Baerwalde" and "Tim
 * Benjamin Baerwalde" on Presbyterian's. Both read as arrivals, so the intake
 * is one bigger than it was — and an evidence kind that states an exact count
 * would state it one too high.
 *
 * The ladder, in order, and every rung is evidence rather than taste:
 *
 *   1. The spelling that appears in MORE seasons at this programme. Elon's
 *      2026 roster says "Magnus Jacobsen"; Merrimack's says "Pedro Plantz
 *      Baisch". The programme settled on one of them and that is the one to
 *      keep.
 *   2. The row with more of its fields filled in. LIU printed the same player
 *      as a midfielder and as a blank; keeping the blank would delete a
 *      position we actually have.
 *   3. The shorter name. "Tim Baerwalde" over "Tim Benjamin Baerwalde", and
 *      "Jon arnar Hjalmarsson" over "Jon Arnar 'Eagle' Hjalmarsson" — the
 *      plainer form is the one a person would use.
 *   4. The name key, alphabetically, so the choice is deterministic when
 *      nothing above separates them.
 *
 * Deliberately built on `sameHuman` and nothing looser. Two brothers who share
 * a surname and differ in their first name are untouched by this, because
 * merging two people is a worse error than counting one twice: it deletes a
 * real arrival and invents a departure to go with it.
 */
function fieldsPresent(row) {
  return ['position', 'class_year_label', 'country', 'nationality', 'hometown']
    .filter((f) => String(row?.[f] ?? '').trim()).length;
}

function preferredOf(a, b, seasonsWithKey) {
  const rank = (r) => [
    -(seasonsWithKey.get(nameKey(r.player_name)) ?? 0),
    -fieldsPresent(r),
    nameKey(r.player_name).split(' ').length,
    nameKey(r.player_name),
  ];
  const [x, y] = [rank(a), rank(b)];
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] < y[i]) return a;
    if (x[i] > y[i]) return b;
  }
  return a;
}

/**
 * Merges duplicate spellings among ONE season's arrival candidates.
 *
 * Runs only on rows that already survived the returning check, so it can
 * remove a duplicated arrival and never create one. Returns the survivors plus
 * a provenance map from the surviving roster row to the rows it absorbed — the
 * merge has to be inspectable, or a count that quietly went down is
 * indistinguishable from a scrape that quietly lost a player.
 */
export function reconcileWithinSeason(candidates = [], seasonsWithKey = new Map()) {
  const kept = [];
  const absorbed = new Map();          // surviving row -> [absorbed rows]

  for (const row of candidates) {
    const key = nameKey(row.player_name);
    const twinIndex = kept.findIndex((k) => nameKey(k.player_name) !== key
      && sameHuman(k.player_name, row.player_name));
    if (twinIndex < 0) {
      kept.push(row);
      continue;
    }
    const twin = kept[twinIndex];
    const winner = preferredOf(twin, row, seasonsWithKey);
    const loser = winner === twin ? row : twin;
    const carried = absorbed.get(twin) ?? [];
    absorbed.delete(twin);
    kept[twinIndex] = winner;
    absorbed.set(winner, [...carried, loser]);
  }

  return { kept, absorbed };
}

/**
 * The transitions the CURRENT coach can be held responsible for.
 *
 * Derived from the tenure, never from the arrivals. A denominator built from
 * rows would only count transitions in which this coach actually signed
 * somebody, so a quiet year would disappear and "an international defender in
 * 3 of 3 transitions" would be measured against a denominator the observation
 * had chosen for itself. The transitions come from who held the job; only the
 * numerator comes from who arrived.
 *
 * INHERITED and UNKNOWN transitions are reported separately and never folded
 * in — a coach's first roster is their predecessor's recruiting, and the first
 * season of our window cannot tell a new appointment from a twenty-year
 * incumbent.
 *
 * @param {Array} opts.coachRows              the programme's coach_seasons rows
 * @param {Array} opts.comparableTransitions  ['2022->2023', ...] from coverage
 */
export function currentCoachScope({ coachRows = [], comparableTransitions = [] } = {}) {
  const tenure = coachRows.length ? tenureFor(coachRows) : null;
  if (!tenure?.current) return null;

  const current = tenure.current.coach;
  const attributableTransitions = [];
  const inheritedTransitions = [];
  const unknownTransitions = [];

  for (const transition of comparableTransitions) {
    const to = String(transition).split('->')[1];
    const { coach, attribution } = coachFor(tenure, to);
    if (!coach || !sameCoach(coach, current)) continue;
    if (attribution === COACH_ATTRIBUTION.ATTRIBUTED) attributableTransitions.push(transition);
    else if (attribution === COACH_ATTRIBUTION.INHERITED) inheritedTransitions.push(transition);
    else unknownTransitions.push(transition);
  }

  return {
    coach: current,
    since: tenure.current.since,
    attributableTransitions,
    inheritedTransitions,
    unknownTransitions,
  };
}

/**
 * Every arrival at one programme, across every comparable transition.
 *
 * @param {Array}  rows        ONE programme's roster rows, any seasons
 * @param {object} opts.coachRows    that programme's coach_seasons rows
 * @param {Map}    opts.priorIndex   from `buildPriorIndex`, for transfer origin
 * @param {Array}  opts.transitions  [[from, to], …]
 */
export function arrivalsFor(rows = [], {
  coachRows = [], priorIndex = null, transitions = ARRIVAL_TRANSITIONS,
} = {}) {
  // Everything below groups by season alone, so two programmes' rows handed in
  // together would merge into one fictional squad and every name would read as
  // an arrival from the other. Refusing is cheap; the silent version is a
  // recruiting history for a programme that does not exist.
  const programmes = new Set(rows.map((r) => `${r.college_name}||${r.sport}`));
  if (programmes.size > 1) {
    throw new Error(`arrivalsFor takes one programme's rows; got ${programmes.size}`);
  }

  const bySeason = new Map();
  for (const r of rows) {
    const season = String(r.season);
    if (!bySeason.has(season)) bySeason.set(season, []);
    bySeason.get(season).push(r);
  }

  // How many of this programme's seasons carry each name, which is what decides
  // the surviving spelling when one roster printed a player twice.
  const seasonsWithKey = new Map();
  for (const [, rows] of bySeason) {
    for (const key of new Set(rows.map((r) => nameKey(r.player_name)))) {
      seasonsWithKey.set(key, (seasonsWithKey.get(key) ?? 0) + 1);
    }
  }

  const tenure = coachRows.length ? tenureFor(coachRows) : null;
  const arrivals = [];
  const unknown = [];
  const comparable = [];
  let reconciled = 0;
  let sameSeasonMerges = 0;

  for (const [from, to] of transitions) {
    const prev = bySeason.get(from);
    const next = bySeason.get(to);
    if (!next) continue;

    // THE GATE. No earlier roster means absence proves nothing.
    if (!prev) {
      for (const r of next) {
        unknown.push({
          programme: r.college_name,
          sport: r.sport,
          season: to,
          priorSeason: from,
          playerName: r.player_name,
          nameKey: nameKey(r.player_name),
          arrivalConfidence: ARRIVAL_CONFIDENCE.UNKNOWN,
          reason: `no ${from} roster on file for this programme`,
        });
      }
      continue;
    }

    comparable.push(`${from}->${to}`);
    const prevKeys = new Set(prev.map((r) => nameKey(r.player_name)));
    const prevNames = prev.map((r) => r.player_name);
    const { coach, attribution } = coachFor(tenure, to);

    const candidates = [];
    for (const r of next) {
      const key = nameKey(r.player_name);
      if (prevKeys.has(key)) continue;                       // returning, exactly

      // Middle names added or dropped between two seasons' pages. Checked only
      // against names that did NOT match exactly, so it can never turn a
      // returning player into an arrival — only the reverse.
      const match = prevNames.find((n) => sameHuman(n, r.player_name));
      if (match) {
        reconciled += 1;
        continue;
      }
      candidates.push(r);
    }

    // One roster, one player, two spellings. Merged only among rows that are
    // already arrivals, so this can shrink an intake and never grow one.
    const { kept, absorbed } = reconcileWithinSeason(candidates, seasonsWithKey);
    sameSeasonMerges += [...absorbed.values()].reduce((n, rows) => n + rows.length, 0);

    for (const r of kept) {
      const key = nameKey(r.player_name);
      const merged = absorbed.get(r) ?? [];

      const prior = priorProgrammeFor({
        priorIndex, fromSeason: from, key, programme: r.college_name,
      });
      const position = canonicalPosition(r.position);
      const country = r.country || null;

      arrivals.push({
        programme: r.college_name,
        sport: r.sport,
        arrivalSeason: to,
        priorSeason: from,
        sourceTransition: `${from}->${to}`,
        playerName: r.player_name,
        nameKey: key,
        arrivalConfidence: ARRIVAL_CONFIDENCE.DIRECT,
        identityMethod: merged.length ? IDENTITY_METHOD.RECONCILED : IDENTITY_METHOD.EXACT,
        // The spellings this row absorbed, kept so a merged count can be walked
        // back to the rows behind it. A later phase gates naming a player in an
        // email on this being empty.
        reconciledFrom: merged.map((m) => m.player_name),
        reconciledRowIds: merged.map((m) => m.id),
        canonicalPosition: position,
        nationalityFlag: r.nationality || null,
        country,
        region: regionOf(country),
        isInternational: r.nationality === 'International',
        classLabelRaw: r.class_year_label || null,
        entryType: entryTypeOf(r),
        ...prior,
        coach,
        coachAttribution: attribution,
        rosterRowId: r.id,
      });
    }
  }

  return {
    arrivals,
    unknown,
    coverage: {
      programme: rows[0]?.college_name ?? null,
      sport: rows[0]?.sport ?? null,
      seasonsOnFile: [...bySeason.keys()].sort(),
      comparableTransitions: comparable,
      comparableCount: comparable.length,
      reconciledNames: reconciled,
      sameSeasonMerges,
      directArrivals: arrivals.length,
      unknownRows: unknown.length,
    },
  };
}
