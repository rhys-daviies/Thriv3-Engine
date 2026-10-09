/**
 * THE PROGRAMME DATABASE — Phase 4 (docs/IMMEDIATE_CHANGES_ROADMAP.md).
 *
 * One read surface over the programmes Thriv3 holds, replacing the College
 * Database and Graduating Database pages. READ-ONLY: nothing here writes, and
 * no column or table is added, because any write to `colleges` or
 * `roster_players` moves the matchmaking corpus digest and stales every saved
 * run.
 *
 * -- IDENTITY ---------------------------------------------------------------
 *
 * A programme is one `colleges` row: a school IN A SPORT. `colleges.id` is the
 * programme id, the same id Matcher V2 returns as `programmeId`. The men's and
 * women's programmes of one school are two programmes and are never merged; the
 * other sport is offered as a link only through the exact athletics-entity id,
 * never by name. Every name-keyed table (roster, arrivals, coaches) is read
 * with that row's own `name`, which is the spelling those tables are aligned
 * to. The School filter is the registry search's own predicate (name, plus
 * global aliases joined on UNITID) - no fuzzy matching anywhere.
 *
 * -- DEPARTURES ARE THE ENGINE'S, NOT OURS ----------------------------------
 *
 * Openings come from `programmeContext`, which reads `positionEvidence` - the
 * function Athlete Opportunity scores from - and per-player standing comes from
 * `availabilityAtEntry`, the same `eligibilityCeiling` predicate. Nothing here
 * re-derives "who is leaving". The stored `estimated_graduation_year` the old
 * Graduating Database grouped by is NOT used: it is a different basis and can
 * disagree with the engine.
 *
 * WHAT THE RECRUITING CLASS MEANS. The season an athlete would arrive
 * (`players.recruiting_class_year`, the engine's `entryYear`). A place is open
 * for that class when its holder's last eligible season is BEFORE it. These are
 * projections from eligibility rules applied to the current roster - not
 * confirmed graduates, not retention forecasts.
 *
 * WHICH CLASSES ARE OFFERED, and why the range is not ours to widen:
 *   - from the season after the roster on file (a class arriving in the
 *     roster's own season has no openings to measure), and
 *   - up to the furthest season any current player could still be eligible
 *     for under a ruled association (`maxAttainableLastSeason`, A7.37).
 * At or past a division's own ceiling every current player has run out, so
 * the count is decided by the calendar; the engine refuses to score that, and
 * this marks it `windowExhausted` rather than presenting it as a measurement.
 */
import db from '../db/client.js';
import { readClassYear } from '../../shared/classYear.js';
import {
  availabilityAtEntry, eligibilityRuleFor, maxAttainableLastSeason, ELIGIBILITY_MODEL,
} from '../../shared/eligibility.js';
import { DIVISIONS } from '../../shared/divisions.js';
import { resolveConference } from '../../shared/conferenceIdentity.js';
import { readPositionState, starterState, STARTER_STATE } from './v2/rosterEvidence.js';
import { programmeContext } from './v2/programmeContext.js';
import { SEASON } from './v2/matchmakingService.js';
import { SCHOOL_MATCH_SQL, SEARCH_LIMITS } from './collegeSearch.js';
import { allStatuses, programmeKey } from './programmeStatus.js';
import { activeForSeason } from '../../shared/roster/programmeStatus.js';

export const ROSTER_SEASON = Number(SEASON);

/** The recruiting classes the engine's rules can speak to from the roster on file. */
export function classYearRange(rosterSeason = ROSTER_SEASON) {
  const ceilings = DIVISIONS
    .map((division) => maxAttainableLastSeason({ season: rosterSeason, division }))
    .filter((n) => Number.isFinite(n));
  const max = ceilings.length ? Math.max(...ceilings) : rosterSeason + 1;
  const years = [];
  for (let y = rosterSeason + 1; y <= max; y += 1) years.push(y);
  return years;
}

export const CLASS_YEARS = Object.freeze(classYearRange());
export const DEFAULT_CLASS_YEAR = CLASS_YEARS[0];

export const PAGE_SIZE = Object.freeze({ DEFAULT: 50, MAX: 100 });

/** Ordering, whitelisted. A sort is never caller text inside SQL. */
const ORDER_BY = Object.freeze({
  strength: 'CASE WHEN c.soccer_score IS NULL THEN 1 ELSE 0 END, c.soccer_score DESC, c.name',
  academic: 'CASE WHEN c.academic_rating IS NULL THEN 1 ELSE 0 END, c.academic_rating DESC, c.name',
  name: 'c.name',
});
export const SORTS = Object.freeze(Object.keys(ORDER_BY));

export class ProgrammeQueryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** Parse and refuse, rather than silently widen, every filter. */
export function parseProgrammeQuery(q = {}) {
  const sport = text(q.sport);
  if (!sport) {
    throw new ProgrammeQueryError('SPORT_REQUIRED',
      'Choose a sport. The same school is a different programme in each sport.');
  }
  const classYear = q.classYear === undefined || q.classYear === '' ? DEFAULT_CLASS_YEAR : Number(q.classYear);
  if (!CLASS_YEARS.includes(classYear)) {
    throw new ProgrammeQueryError('CLASS_YEAR_OUT_OF_RANGE',
      `Recruiting class must be one of ${CLASS_YEARS.join(', ')}: openings are projected from the ${ROSTER_SEASON} roster `
      + 'and the eligibility rules on file, which say nothing outside that window.');
  }
  const division = text(q.division) || null;
  /**
   * The canonical six, or a division the registry actually stores for this
   * sport (CCCAA, NCCAA and NWAC rows exist). Anything else is refused rather
   * than returning an empty page that looks like "no programmes".
   */
  if (division && !DIVISIONS.includes(division)
    && !db.prepare('SELECT 1 FROM colleges WHERE sport = ? AND division = ? LIMIT 1').get(sport, division)) {
    throw new ProgrammeQueryError('UNKNOWN_DIVISION', `"${division}" is not a division held for this sport.`);
  }
  const conference = text(q.conference) || null;
  const school = text(q.school) || null;
  if (school && school.length < SEARCH_LIMITS.MIN_QUERY_LENGTH) {
    throw new ProgrammeQueryError('SEARCH_QUERY_TOO_SHORT',
      `Type at least ${SEARCH_LIMITS.MIN_QUERY_LENGTH} characters to search for a school.`);
  }
  const sort = text(q.sort) || 'strength';
  if (!SORTS.includes(sort)) throw new ProgrammeQueryError('UNKNOWN_SORT', `Sort must be one of ${SORTS.join(', ')}.`);
  const page = q.page === undefined || q.page === '' ? 1 : Number(q.page);
  if (!Number.isInteger(page) || page < 1) throw new ProgrammeQueryError('BAD_PAGE', 'Page must be a whole number from 1.');
  let pageSize = q.pageSize === undefined || q.pageSize === '' ? PAGE_SIZE.DEFAULT : Number(q.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new ProgrammeQueryError('BAD_PAGE_SIZE', 'Page size must be a whole number from 1.');
  pageSize = Math.min(pageSize, PAGE_SIZE.MAX);
  const includeInactive = q.includeInactive === true || q.includeInactive === '1' || q.includeInactive === 'true';
  return { sport, classYear, division, conference, school, sort, page, pageSize, includeInactive };
}

/**
 * CONFERENCE AS AN IDENTITY. `colleges.conference` spells one conference
 * several ways even within a sport ("Sooner" and "Sooner Athletic Conference").
 * The filter value is either `id:<canonical id>` - every stored spelling that
 * `resolveConference` maps to that id, scoped by the row's own sport and
 * division, so a scoped alias like "MAC" is read as the conference it is in
 * that division - or a raw spelling the resolver does not hold, matched
 * exactly. Written-down aliases only; nothing is matched by similarity.
 */
export const CONFERENCE_ID_PREFIX = 'id:';

function conferenceKey(raw, sport, division) {
  const r = resolveConference(raw, { sport, division });
  return r.id ? { value: `${CONFERENCE_ID_PREFIX}${r.id}`, label: r.name } : { value: raw, label: raw };
}

/**
 * The (division, stored spelling) pairs a filter value stands for. Pairs, not
 * spellings: "MAC" is the Mid-American Conference in Division I and a
 * different conference in Division III, so the spelling alone would leak one
 * into the other.
 */
function pairsFor(conference, { sport, division, includeInactive }) {
  const stored = db.prepare(`SELECT DISTINCT division, conference FROM colleges
     WHERE sport = ? AND conference IS NOT NULL ${includeInactive ? '' : 'AND (active IS NULL OR active != 0)'}`).all(sport);
  return stored.filter((p) => (!division || p.division === division)
    && conferenceKey(p.conference, sport, p.division).value === conference);
}

function whereFor({ sport, division, conference, school, includeInactive }) {
  const clauses = ['c.sport = @sport'];
  const params = { sport };
  // `active` defaults to 1; a row predating the column is kept, as everywhere else.
  if (!includeInactive) clauses.push('(c.active IS NULL OR c.active != 0)');
  if (division) { clauses.push('c.division = @division'); params.division = division; }
  if (conference) {
    const pairs = pairsFor(conference, { sport, division, includeInactive });
    if (!pairs.length) {
      clauses.push('0'); // a conference no stored row resolves to matches nothing, honestly
    } else {
      clauses.push(`(${pairs.map((_, i) => `(c.division IS @cd${i} AND c.conference = @cn${i})`).join(' OR ')})`);
      pairs.forEach((p, i) => { params[`cd${i}`] = p.division; params[`cn${i}`] = p.conference; });
    }
  }
  if (school) { clauses.push(SCHOOL_MATCH_SQL); params.q = school; }
  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

/** Whether the eligibility window, not the programme, decides the count for this class. */
export function windowFor(division, classYear, rosterSeason = ROSTER_SEASON) {
  const rule = eligibilityRuleFor({ division, season: classYear });
  const ruled = rule?.model !== ELIGIBILITY_MODEL.UNKNOWN;
  const maxLastSeason = ruled ? maxAttainableLastSeason({ season: rosterSeason, division }) : null;
  return {
    ruled,
    model: rule?.model ?? ELIGIBILITY_MODEL.UNKNOWN,
    transitional: Boolean(rule?.transitional),
    note: rule?.note ?? null,
    source: rule?.source ?? null,
    maxLastSeason,
    windowExhausted: Number.isFinite(maxLastSeason) && classYear >= maxLastSeason,
  };
}

function seasonStatusFor(statuses, name, sport, classYear) {
  const s = statuses.get(programmeKey(name, sport)) ?? null;
  if (!s) return null;
  return {
    status: s.status,
    reason: s.reason,
    activeFromSeason: s.activeFromSeason,
    activeToSeason: s.activeToSeason,
    fieldedInClassYear: activeForSeason(s, classYear),
    evidence: s.evidence,
  };
}

const DEPARTURE_FIELDS = ['state', 'openings', 'vacatedStarters', 'eligibleToRemain', 'positionRows', 'unreadable'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));

/**
 * One page of programmes, with each one's projected openings for the class.
 *
 * Departures are computed for the PAGE only, from the engine's cached pool
 * context; inactive programmes are outside that pool and are listed as not
 * assessed rather than given numbers from a context they are not in.
 */
export function listProgrammes(query) {
  const f = parseProgrammeQuery(query);
  const where = whereFor(f);
  const total = db.prepare(`SELECT COUNT(*) n FROM colleges c ${where.sql}`).get(where.params).n;
  const rows = db.prepare(`
    SELECT c.id, c.name, c.sport, c.division, c.conference, c.city, c.state, c.active,
           c.soccer_score, c.academic_rating, c.academic_rating_source, c.athletics_entity_id
      FROM colleges c ${where.sql}
     ORDER BY ${ORDER_BY[f.sort]}
     LIMIT @limit OFFSET @offset`).all({ ...where.params, limit: f.pageSize, offset: (f.page - 1) * f.pageSize });

  const activeNames = rows.filter((r) => r.active !== 0).map((r) => r.name);
  const ctx = activeNames.length
    ? programmeContext(db, { sport: f.sport, names: activeNames, entryYear: f.classYear })
    : { programmes: [] };
  const byName = new Map(ctx.programmes.map((p) => [p.collegeName, p]));
  const statuses = allStatuses();

  return {
    filters: f,
    rosterSeason: ROSTER_SEASON,
    classYears: CLASS_YEARS,
    total,
    page: f.page,
    pageSize: f.pageSize,
    pages: Math.max(1, Math.ceil(total / f.pageSize)),
    programmes: rows.map((r) => {
      const c = r.active !== 0 ? byName.get(r.name) ?? null : null;
      const window = windowFor(r.division, f.classYear);
      return {
        id: r.id,
        name: r.name,
        sport: r.sport,
        division: r.division,
        conference: r.conference,
        city: r.city,
        state: r.state,
        active: r.active === 0 ? 0 : 1,
        seasonStatus: seasonStatusFor(statuses, r.name, r.sport, f.classYear),
        programStrength: c?.programStrength ?? null,
        academicRating: c?.academicRating ?? null,
        assessed: Boolean(c),
        notAssessedReason: c ? null : 'INACTIVE',
        rosterOnFile: c?.rosterOnFile ?? null,
        eligibility: { ruled: window.ruled, model: window.model, transitional: window.transitional },
        windowExhausted: window.windowExhausted,
        departures: c
          ? Object.fromEntries(Object.entries(c.departures).map(([pos, d]) => [pos, pick(d, DEPARTURE_FIELDS)]))
          : null,
      };
    }),
  };
}

/** What the filters can offer for a sport: divisions and conferences that exist in the data. */
export function programmeFacets({ sport, includeInactive = false } = {}) {
  const s = text(sport);
  if (!s) throw new ProgrammeQueryError('SPORT_REQUIRED', 'Choose a sport.');
  const active = includeInactive ? '' : 'AND (active IS NULL OR active != 0)';
  const divisions = db.prepare(`SELECT division, COUNT(*) n FROM colleges WHERE sport = ? ${active} GROUP BY division`).all(s);
  const raw = db.prepare(`
    SELECT division, conference, COUNT(*) n FROM colleges
     WHERE sport = ? ${active} AND conference IS NOT NULL AND trim(conference) != ''
     GROUP BY division, conference`).all(s);
  /** One option per (division, conference identity), carrying every spelling folded into it. */
  const grouped = new Map();
  for (const r of raw) {
    const k = conferenceKey(r.conference, s, r.division);
    const key = `${r.division}\u001F${k.value}`;
    if (!grouped.has(key)) grouped.set(key, { division: r.division, value: k.value, label: k.label, n: 0, spellings: [] });
    const g = grouped.get(key);
    g.n += r.n;
    g.spellings.push(r.conference);
  }
  const conferences = [...grouped.values()]
    .map((g) => ({ ...g, spellings: g.spellings.sort() }))
    .sort((a, b) => String(a.division).localeCompare(String(b.division)) || a.label.localeCompare(b.label));
  const order = (d) => { const i = DIVISIONS.indexOf(d); return i === -1 ? DIVISIONS.length : i; };
  return {
    sport: s,
    rosterSeason: ROSTER_SEASON,
    classYears: CLASS_YEARS,
    defaultClassYear: DEFAULT_CLASS_YEAR,
    divisions: divisions.sort((a, b) => order(a.division) - order(b.division)),
    conferences,
  };
}

const ROSTER_SELECT = `
  SELECT id, player_name, position, class_year_label, season, division,
         minutes_played, projected_minutes, projected_minutes_season,
         games_played, games_started, projected_games_started, projected_games_played,
         prior_programme, data_confidence, source_roster_url, source_fetched_at
    FROM roster_players
   WHERE sport = ? AND season = ? AND college_name = ?`;

/** Each player's standing against the class, read through the engine's own predicate. */
function rosterPlayer(row, classYear) {
  const { position } = readPositionState(row.position);
  const read = readClassYear(row.class_year_label, { season: row.season });
  const a = availabilityAtEntry({
    klass: read.klass, redshirt: read.redshirt, season: row.season, division: row.division, entryYear: classYear,
  });
  return {
    id: row.id,
    name: row.player_name,
    position,
    positionRaw: row.position,
    classYear: row.class_year_label,
    availability: a.state,
    lastSeason: a.lastSeason,
    basis: a.basis,
    starter: starterState(row),
    minutesPlayed: row.minutes_played,
    projectedMinutes: row.projected_minutes,
    projectedMinutesSeason: row.projected_minutes_season,
    gamesStarted: row.games_started,
    priorProgramme: row.prior_programme,
    dataConfidence: row.data_confidence,
  };
}

function majority(values) {
  const counts = {};
  for (const v of values) if (v) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The programme row, or null. Sport comes off the row, never off the request. */
export function programmeRow(id) {
  return db.prepare('SELECT * FROM colleges WHERE id = ?').get(String(id ?? '')) ?? null;
}

/**
 * Overview plus Roster & Openings for one programme and class.
 */
export function programmeDetail(id, { classYear: rawClass } = {}) {
  const col = programmeRow(id);
  if (!col) return null;
  const { classYear } = parseProgrammeQuery({ sport: col.sport, classYear: rawClass });
  const active = col.active !== 0;
  const statuses = allStatuses();
  const ctx = active
    ? programmeContext(db, { sport: col.sport, names: [col.name], entryYear: classYear, withNames: true }).programmes[0]
    : null;
  const window = windowFor(col.division, classYear);

  const roster = db.prepare(ROSTER_SELECT).all(col.sport, String(ROSTER_SEASON), col.name);
  const players = roster.map((r) => rosterPlayer(r, classYear))
    .sort((a, b) => String(a.position ?? 'ZZ').localeCompare(String(b.position ?? 'ZZ'))
      || String(a.name).localeCompare(String(b.name)));
  const fetched = roster.map((r) => r.source_fetched_at).filter(Boolean).sort();
  const minutesKnown = roster.filter((r) => r.minutes_played !== null && r.minutes_played !== undefined).length;

  /**
   * The other sport, through the athletics-entity identity only. A school with
   * no entity id simply offers no link: a name match is exactly the join that
   * has put the wrong school beside the right one before.
   */
  const siblings = col.athletics_entity_id
    ? db.prepare(`SELECT id, name, sport, division, active FROM colleges
                   WHERE athletics_entity_id = ? AND sport != ? ORDER BY sport, name`).all(col.athletics_entity_id, col.sport)
    : [];

  return {
    classYear,
    classYears: CLASS_YEARS,
    rosterSeason: ROSTER_SEASON,
    overview: {
      id: col.id,
      name: col.name,
      sport: col.sport,
      division: col.division,
      conference: col.conference,
      city: col.city,
      state: col.state,
      location: col.location,
      nickname: col.nickname ?? null,
      logoUrl: col.logo_url ?? null,
      websiteDomain: col.website_domain,
      control: col.control ?? null,
      active: active ? 1 : 0,
      seasonStatus: seasonStatusFor(statuses, col.name, col.sport, classYear),
      programStrength: ctx?.programStrength ?? null,
      academicRating: ctx?.academicRating ?? null,
      academicRatingSource: col.academic_rating_source ?? null,
      netPrice: Number.isFinite(col.net_price) ? col.net_price : null,
      postseason2025: col.postseason_2025_round ?? null,
      conferenceChampion2025: col.conference_champion_2025 ?? null,
      conferenceChampion2025Name: col.conference_champion_name ?? null,
      athleticsEntityId: col.athletics_entity_id ?? null,
      siblings,
    },
    roster: {
      assessed: Boolean(ctx),
      notAssessedReason: ctx ? null : 'INACTIVE',
      rosterOnFile: roster.length > 0,
      eligibility: window,
      departures: ctx?.departures ?? null,
      departingPlayers: ctx?.departingPlayers ?? null,
      evidence: {
        rows: roster.length,
        minutesKnown,
        positionUnreadable: players.filter((p) => !p.position).length,
        classUnreadable: players.filter((p) => p.availability === 'UNREADABLE').length,
        starterUnknown: players.filter((p) => p.starter === STARTER_STATE.UNKNOWN).length,
        dataConfidence: majority(roster.map((r) => r.data_confidence)),
        fetchedFrom: fetched[0] ?? null,
        fetchedTo: fetched[fetched.length - 1] ?? null,
        sourceUrl: roster.find((r) => r.source_roster_url)?.source_roster_url ?? null,
      },
      players,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Recruiting Intelligence and Programme Intelligence                          */
/* -------------------------------------------------------------------------- */

const tallyList = (obj, key) => Object.entries(obj ?? {})
  .map(([k, v]) => ({ [key]: k, total: v.total }))
  .sort((a, b) => b.total - a.total || String(a[key]).localeCompare(String(b[key])));

const gate = (absence) => ({ reportable: Boolean(absence?.reportable), reasons: absence?.reasons ?? [] });

/**
 * Where and how this programme has recruited, from the materialised arrivals.
 *
 * Three different answers are kept apart: STALE (the materialisation no longer
 * describes the roster, so nothing may be said), NO_HISTORY (we looked and hold
 * no seasons for it) and AVAILABLE. Every cut carries its own absence gate, so
 * a zero is only ever shown where it was observed.
 */
export async function programmeRecruiting(id) {
  const col = programmeRow(id);
  if (!col) return null;
  const { loadProgrammePatterns } = await import('./recruitingPatterns.js');
  const { materialisationState } = await import('./recruitingMaterialisation.js');
  const { programmeIntelligence } = await import('./v2/recruitingObservations.js');
  const programme = { id: col.id, name: col.name, sport: col.sport };
  const observations = programmeIntelligence(db, { collegeName: col.name, sport: col.sport })
    .map((o) => ({
      // The programme's statement only: never which athlete it was recorded against.
      id: o.id, kind: o.kind, observedAt: o.observed_at ?? null, note: o.note ?? null,
      source: o.source, reviewState: o.review_state, confidence: o.confidence ?? null,
    }));

  let state;
  try {
    state = materialisationState(col.sport);
  } catch (err) {
    return { programme, state: 'UNAVAILABLE', reason: err.message, observations };
  }
  let p;
  try {
    p = loadProgrammePatterns(col.sport, col.name);
  } catch (err) {
    if (err.code === 'MATERIALISATION_STALE') {
      return { programme, state: 'STALE', materialisation: { state: state.state, builtAt: state.builtAt }, reason: err.message, observations };
    }
    throw err;
  }
  const materialisation = { state: state.state, builtAt: state.builtAt ?? null };
  if (!p) return { programme, state: 'NO_HISTORY', materialisation, observations };
  return {
    programme,
    state: 'AVAILABLE',
    materialisation,
    coverage: {
      status: p.coverage.status,
      observedTransitions: p.coverage.observedTransitions,
      possibleTransitions: p.coverage.possibleTransitions,
      seasons: p.coverage.seasons,
      floor: p.coverage.floor,
    },
    arrivals: p.arrivals,
    positions: {
      absence: gate(p.positions.absence),
      knownShare: p.positions.knownShare,
      byPosition: Object.fromEntries(Object.entries(p.positions.positions)
        .map(([pos, o]) => [pos, { total: o.total, meanPerTransition: o.meanPerTransition }])),
    },
    entryMix: { absence: gate(p.entryMix.absence), counts: p.entryMix.counts, proportions: p.entryMix.proportions },
    international: {
      absence: gate(p.countries.absence),
      dataStatus: p.countries.dataStatus?.status ?? null,
      total: p.countries.international.total,
      share: p.countries.internationalShare,
      countries: tallyList(p.countries.countries, 'country').slice(0, 12),
      regions: tallyList(p.regions.regions, 'region'),
    },
    coach: {
      coach: p.coach.coach,
      status: p.coach.coverage.status,
      attributableTransitions: p.coach.attributableTransitions,
      attributableArrivals: p.coach.attributableArrivals,
      earliestSupportedSeason: p.coach.earliestSupportedSeason,
      latestSupportedSeason: p.coach.latestSupportedSeason,
    },
    observations,
  };
}

/**
 * Philosophy (how the programme uses freshmen), coach tenure and competitive
 * history - the generic programme report's own data, as JSON. Each half fails
 * on its own, so one unreadable source never blanks the other.
 */
export async function programmeIntelligenceFor(id) {
  const col = programmeRow(id);
  if (!col) return null;
  const { philosophySummaries } = await import('../routes/philosophy.js');
  const { competitivePackageFor } = await import('./conferenceQueries.js');

  let philosophy;
  try {
    const s = philosophySummaries({ collegeIds: [col.id] }).summaries[col.id];
    philosophy = s.unavailable
      ? { state: 'UNAVAILABLE', reason: s.unavailable }
      : {
        state: 'AVAILABLE',
        verdict: s.verdict,
        coach: s.coach,
        coachForRecruitSeason: s.coachForRecruitSeason,
        coachStillInPost: s.coachStillInPost,
        seasonsObserved: s.seasonsObserved,
        ladderTop: s.ladderTop,
        dials: s.dials,
      };
  } catch (err) {
    philosophy = { state: 'UNAVAILABLE', reason: err.message };
  }

  let competitive;
  try {
    const c = competitivePackageFor(col.id);
    competitive = !c || !c.available
      ? { state: 'UNAVAILABLE', refusals: (c?.refusals ?? []).map((r) => r.text) }
      : {
        state: 'AVAILABLE',
        seasons: c.seasons.map((s) => ({
          season: s.season,
          overallRecord: s.overallRecord,
          winPercentage: s.winPercentage,
          historicalDivision: s.historicalDivision,
          historicalConference: s.historicalConference,
          conferenceRecord: s.conferenceRecord,
        })),
        structuralFacts: (c.structuralFacts ?? []).map((f) => f.text ?? String(f)),
        coverage: { readableSeasons: c.coverage.readableSeasons, expectedSeasons: c.coverage.expectedSeasons },
        refusals: (c.refusals ?? []).map((r) => r.text),
      };
  } catch (err) {
    competitive = { state: 'UNAVAILABLE', refusals: [err.message] };
  }

  return {
    programme: { id: col.id, name: col.name, sport: col.sport, division: col.division },
    philosophy,
    competitive,
    reportUrl: `/api/philosophy/${encodeURIComponent(col.id)}/report.pdf`,
  };
}
