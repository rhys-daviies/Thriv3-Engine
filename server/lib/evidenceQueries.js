/**
 * The database half of the evidence engine.
 *
 * shared/evidence is pure and takes rows somebody else fetched. This is the
 * somebody, for callers that have a database in hand — the drafting CLI today,
 * a route when the composer wants it.
 *
 * Every read here is one philosophyQueries already does. That is deliberate
 * reuse rather than convenience: the Program Philosophy report and an outreach
 * email must describe the same squad in the same seasons, and the surest way
 * to guarantee that is for both to run the same query. A second, subtly
 * different roster read is how two screens come to disagree about a programme.
 */

import db from '../db/client.js';
import { squadRows, programmeRows, programmeCoachRows, poolBenchmarks } from './philosophyQueries.js';
import { loadProgrammePatterns } from './recruitingPatterns.js';
import { SQUAD_SEASON, programmePhilosophy, playerFit } from '../../shared/philosophy.js';
import { evidenceStrategyForMessage } from '../../shared/evidence/sequenceStrategy.js';
import {
  campaignLocalStep, sentEvidenceForContact, openDraftEvidenceForContact,
} from './evidenceHistory.js';
import { selectEvidence, MAX_EMAIL_EVIDENCE } from '../../shared/evidence/index.js';
import { buildRosterIndex, departures } from '../../shared/matching/pool.js';
import { canonicalPosition } from '../../shared/positions.js';
import { verifyRosterSource, canonicalHost } from '../../shared/evidence/sourceVerification.js';
import { classifyRegistry } from '../../shared/evidence/registryIntegrity.js';

const selectCollege = db.prepare('SELECT * FROM colleges WHERE name = ? AND sport = ?');

/**
 * Hosts we would follow, and the institution each belongs to.
 *
 * Built ONCE per process. 918 rows, and resolving it per evidence object would
 * mean a query for each of the ten thousand a composer batch produces —
 * `athletics_domains` is small and static enough that reading it repeatedly
 * would be the only expensive thing about provenance.
 */
let domainCache = null;
let integrityCache = null;
let trustedCache = null;
/** The trust filter, read once. Both callers below share this one result. */
function trustedRows() {
  if (trustedCache) return trustedCache;
  trustedCache = db.prepare(`
    SELECT domain, unitid FROM athletics_domains
    WHERE status IN ('VERIFIED','VERIFIED_ALIAS') AND role = 'ATHLETICS_SITE'
      AND confidence IN ('CERTAIN','CORROBORATED') AND unitid IS NOT NULL
  `).all();
  return trustedCache;
}
function verifiedDomains() {
  if (domainCache) return domainCache;
  domainCache = new Map();
  for (const d of trustedRows()) domainCache.set(canonicalHost(d.domain), d.unitid);
  return domainCache;
}

/**
 * The registry's own contradictions, classified once per process.
 *
 * Four registry facts were not enough — H15 found ten hosts carrying all of
 * them and still assigned to the wrong school. This is the fifth check, and it
 * needs roster usage across every sport and season, so it is built beside the
 * domain map rather than per request.
 */
function registryIntegrity() {
  if (integrityCache) return integrityCache;
  const unit = new Map(db.prepare('SELECT name, sport, unitid FROM colleges').all()
    .map((c) => [`${c.name}|${c.sport}`, c.unitid]));
  const usage = [];
  for (const r of db.prepare(`
    SELECT DISTINCT college_name, sport, source_roster_url AS url
    FROM roster_players WHERE source_roster_url IS NOT NULL
  `).all()) {
    let host; try { host = canonicalHost(new URL(r.url).hostname); } catch { continue; }
    const unitid = unit.get(`${r.college_name}|${r.sport}`);
    if (unitid != null) usage.push({ unitid, host });
  }
  integrityCache = classifyRegistry(trustedRows(), usage);
  return integrityCache;
}

/**
 * The page an operator may open to check a current-roster claim, or null.
 *
 * Resolved once for the programme and handed to the context, so a generator
 * asks a field rather than a database. `verifyRosterSource` owns the rule; this
 * only supplies it with the three things it needs and the season the SQUAD
 * rows came from — never a different one, because a 2026 claim linked to a
 * 2025 page would show a squad that has since turned over.
 */
function rosterSourceFor(college, squad) {
  const urls = [...new Set(squad.map((r) => r.source_roster_url).filter(Boolean))];
  // More than one URL for one programme-season happens on 37 of 4,038 and
  // there is no rule for choosing between them, so none is offered.
  if (urls.length !== 1) return { status: urls.length ? 'AMBIGUOUS_SOURCE' : 'MISSING', url: null };
  return verifyRosterSource({
    url: urls[0],
    unitid: college?.unitid ?? null,
    season: SQUAD_SEASON,
    urlSeason: squad[0]?.season ?? null,
    verifiedDomains: verifiedDomains(),
    registryIntegrity: registryIntegrity(),
  });
}

/**
 * Has the calendar moved past the roster season we are pinned to?
 *
 * A college season runs autumn to autumn, so the 2026 roster describes the
 * squad through roughly mid-2027. Past that the pinned season is last year's
 * and no present-tense claim built on it is safe, however recently the page
 * was scraped. Deliberately generous — this is a backstop against nobody
 * having advanced SQUAD_SEASON, not a precise calendar.
 */
export function seasonIsBehind(now = Date.now()) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  // A season is stale once the following calendar year is under way past June,
  // by which point the next intake has been signed.
  return year > Number(SQUAD_SEASON) || (year === Number(SQUAD_SEASON) + 1 && d.getUTCMonth() >= 6);
}

/**
 * The departure numbers for one programme, without ranking the whole pool.
 *
 * Built from `buildRosterIndex` and `departures` — the matching engine's own
 * functions, not a second implementation of them. That is the point: an email
 * saying "four defenders are graduating" and a match card saying three would
 * be worse than either being wrong on its own, and the only durable way to
 * prevent it is for both to run the same code over the same rows.
 *
 * This exists so the browser composer does not have to send the numbers to the
 * server. It could — it holds them from the matching run — but then the facts
 * in an email would come from whatever the client posted, and the server would
 * have no way to tell a stale tab from a current one.
 */
export function departureFields(collegeName, sport, athlete) {
  const index = buildRosterIndex(squadRows(collegeName, sport));
  const classYear = athlete?.recruiting_class_year ?? athlete?.graduation_year ?? null;
  const d = departures(index.get(collegeName), classYear, canonicalPosition(athlete?.position));
  const cohort = d.atPosition;
  return {
    roster_season: SQUAD_SEASON,
    graduating_at_position: (cohort?.starters || 0) + (cohort?.squad || 0),
    graduating_starters_at_position: cohort?.starters || 0,
    graduating_names_at_position: cohort?.names || [],
    graduating_starter_names_at_position: cohort?.starterNames || [],
    graduating_total: d.total,
    graduating_starters_total: d.totalStarters,
    graduating_names_total: d.names,
  };
}

/**
 * Everything shared/evidence needs about one programme.
 *
 * `match` is the row this programme got from `rankMatches`, passed in rather
 * than recomputed: ranking the whole pool per programme would be absurd, and
 * the caller ran it once already. Without it the departure evidence is simply
 * absent, which is honest — a caller who did not rank has no departure numbers
 * and should not appear to.
 */
export function programmeInputs(collegeName, sport, { match = null, now = Date.now() } = {}) {
  const college = selectCollege.get(collegeName, sport) ?? null;
  const squad = squadRows(collegeName, sport);
  const history = programmeRows(collegeName, sport);
  const coachRows = programmeCoachRows(collegeName, sport);

  /**
   * The freshman-minutes intelligence, computed ONCE for this programme.
   *
   * Same function the programme report calls, over the same rows already
   * fetched above — no extra query, and no second answer to the question. The
   * adapter in shared/evidence/philosophyEvidence.js translates this into
   * evidence and performs no arithmetic of its own, so a report and an operator
   * panel cannot come to disagree about a programme's ladder.
   *
   * Wrapped because a programme whose rows cannot support a profile is not an
   * error: it is a programme with no development evidence, and the twenty other
   * kinds must still be generated for it.
   */
  let philosophy = null;
  try {
    philosophy = programmePhilosophy({ rows: history, coachRows });
  } catch (err) {
    console.error(`[evidence/philosophy] ${collegeName}:`, err.message);
  }

  return {
    /**
     * The page an operator may open to check a current-roster claim, or null.
     *
     * One resolution per programme, handed to the generators as a field. See
     * `rosterSourceFor`.
     */
    rosterSource: rosterSourceFor(college, squad),
    /**
     * Whether the name we were asked about is a programme we hold.
     *
     * Recorded here because this is the only place that knows. The line below
     * substitutes a stub for a name with no `colleges` row, so that every
     * generator can read `college.name` without a null check — and from that
     * point on an unknown programme is indistinguishable from a known one with
     * nothing on file. `hasSquad` does not answer it either: 247 men's and 33
     * women's programmes we hold have no roster rows at all, and 94 more have
     * earlier seasons but no current squad. Answering it costs nothing — the
     * lookup already happened above — and guessing it wrong in either
     * direction is a claim about a school.
     */
    resolved: college !== null,
    college: college ?? { name: collegeName, sport },
    // Freshness inputs. The stamp comes off the rows themselves — every
    // roster_players row carries `updated_date` — so there is no second query
    // and no way for the rows and their age to disagree.
    now,
    // The pinned squad season is not the season being recruited into once the
    // calendar moves past it. A roster read yesterday is still the wrong
    // roster for a present-tense claim if its season has finished, and a date
    // alone cannot show that.
    seasonBehind: seasonIsBehind(now),
    squad,
    // Passed through UNSTAMPED. This used to write `roster_season: SQUAD_SEASON`
    // onto whatever match it was handed, which asserted a season it had not
    // verified — and that is what hid the drafting CLI feeding 2025 departure
    // numbers into evidence labelled 2026. A match now carries its own season
    // or is not trusted; see evidenceFor.
    match,
    history,
    coachRows,
    philosophy,
    /**
     * The pool this programme's ladder is read against.
     *
     * Cached by sport in philosophyQueries with its own fingerprint and recheck
     * window, so a twenty-programme page builds it at most once. Returns
     * `sufficient: false` rather than zeros when there is not enough on file —
     * every `:memory:` test database is in that state — and the benchmark
     * evidence declines to generate rather than comparing against nothing.
     */
    benchmarks: poolBenchmarks(sport),
    /**
     * The recruiting-history patterns behind the arrival evidence.
     *
     * Derived from `recruiting_arrivals`, which is itself derived from the same
     * `roster_players` rows `history` above reads — so an email cannot say a
     * defender arrived from a season the roster evidence has never seen. Null
     * for a programme with no build behind it, which removes the arrival
     * evidence rather than weakening it.
     */
    recruiting: loadProgrammePatterns(sport, collegeName),
    sport,
  };
}

/**
 * The evidence picture for one athlete at one programme.
 *
 * `athlete` is a raw `players` row; normalisation happens inside
 * selectEvidence so every caller gets the same treatment.
 */
/**
 * `now` is threaded, not read, for one reason: freshness is clock-derived.
 *
 * `programmeInputs` already takes it and already defaults it, so this is that
 * convention carried one level up rather than a new idea. Every caller that
 * omits it gets `Date.now()` and is byte-identical to before.
 *
 * K3A is why it exists. `rosterUpdatedAt` feeds `rosterFreshness`, which puts
 * `ageDays` and a `reason` naming that number into the operator wire, the log
 * payload and the operator evidence — so three committed behavioural baselines
 * changed value once a day, at the instant a programme's roster aged past a
 * whole-day boundary, with no code and no data having moved. A harness that
 * cannot say what time it is cannot hash a clock-dependent payload.
 */
/**
 * THE ONE SEQUENCE-AWARE COMPOSITION PATH.
 *
 * Everything that composes an outbound email for a real athlete at a real
 * programme comes through `evidenceFor`, so the sequence decision is made here
 * and once. A browser composer, a CLI and a route asking the same question get
 * the same answer, and none of them holds an interpretation of ESP1 of its own.
 *
 * NO CAMPAIGN ATTRIBUTION, NO SEQUENCE. A manual send and a legacy
 * relationship keep every line of their current behaviour: `programmeCampaignId`
 * is what turns this on, and a lifetime sequence of 2 on an unattributed
 * relationship is emphatically not an ESP1 follow-up.
 *
 * FAILS CLOSED ON A THIRD MESSAGE. PP1 plans one initial message and one
 * follow-up per coach and ESP1 describes exactly those two, so a third throws
 * rather than composing a generic email nobody chose to send.
 */
function sequenceFor({ programmeCampaignId, coachId, athleteId, evidenceResult }) {
  if (!programmeCampaignId || !coachId || !athleteId) return null;
  const scope = { programmeCampaignId, athleteId, coachId };
  return evidenceStrategyForMessage({
    outreach: evidenceResult.roles,
    step: campaignLocalStep(scope),
    previouslySentKinds: sentEvidenceForContact(scope),
    openDraftKinds: openDraftEvidenceForContact(scope),
  });
}

/**
 * @param {string|null} [opts.programmeCampaignId]  turns the sequence policy on.
 * @param {string|null} [opts.coachId]  whose conversation this is. The step is
 *   per COACH, not per programme: an assistant approached after the head coach
 *   starts at step 1 and receives an initial email.
 */
export function evidenceFor(athlete, collegeName, {
  sport = null, match = null, maxEmail = MAX_EMAIL_EVIDENCE, prefer = null,
  preferStructure = null, now = Date.now(),
  programmeCampaignId = null, coachId = null,
} = {}) {
  const resolved = sport || athlete.sport || 'mens-soccer';

  /**
   * A supplied match is trusted only when it says which season it describes.
   *
   * `rankMatches` rows carry no season, and the caller's roster index may be
   * any season at all — the drafting CLI ranks on 2025. Trusting such a row
   * built departure evidence out of last season's roster while the rest of the
   * picture described 2026, and named four Evansville defenders who had all
   * left. Freshness could not catch it: the 2026 squad rows were a day old, so
   * the staleness was in the match, not in the data.
   *
   * Anything that does not declare the current season is recomputed here from
   * the current squad. That is the safe default and costs one indexed read.
   */
  const usable = match && match.roster_season === SQUAD_SEASON ? match : null;
  const resolvedMatch = usable ?? departureFields(collegeName, resolved, athlete);
  const inputs = programmeInputs(collegeName, resolved, { match: resolvedMatch, now });

  /**
   * The athlete's own view of this programme's freshman ladder.
   *
   * Computed HERE rather than in `programmeInputs` because it is the first
   * point that holds both the athlete and the programme — `playerFit` narrows
   * the ladder to the cohort this recruit would compete with, so it cannot be
   * cached against the programme alone. Same call `philosophyQueries.fitFor`
   * makes, over the rows already fetched, so there is one ladder and not two.
   */
  let fit = null;
  if (inputs.philosophy) {
    try {
      fit = playerFit(inputs.philosophy, athlete, inputs.history);
    } catch (err) {
      console.error(`[evidence/playerFit] ${collegeName}:`, err.message);
    }
  }

  /**
   * Resolution rides on the RESULT, not inside `programme`.
   *
   * `toWire` copies `result.programme` wholesale to the composer, so putting it
   * there would change the email panel's payload for a field only the operator
   * surface asked for. A new top-level key is invisible to that allowlist.
   */
  /**
   * TWO PASSES, AND ONLY WHEN A CAMPAIGN IS ATTRIBUTED.
   *
   * The sequence strategy narrows a LICENCE DECISION, so that decision has to
   * exist before it can be asked — and `outreachEvidenceFor` runs inside
   * `selectEvidence`. The first pass produces it; the second composes under the
   * strategy the first made possible. Both are pure and neither reads the
   * database beyond the queries already made above, so the second pass costs
   * arithmetic rather than I/O.
   *
   * The unattributed path runs once, exactly as it always has.
   */
  const composed = selectEvidence(athlete, { ...inputs, fit }, { maxEmail, prefer, preferStructure });
  const sequence = sequenceFor({
    programmeCampaignId, coachId, athleteId: athlete?.id, evidenceResult: composed,
  });
  if (!sequence) return { ...composed, programmeResolved: inputs.resolved };

  return {
    ...selectEvidence(athlete, { ...inputs, fit }, { maxEmail, prefer, preferStructure, sequence }),
    programmeResolved: inputs.resolved,
  };
}

/**
 * The same, for a whole ranked list.
 *
 * One programme is a handful of indexed reads, so a top-20 run is well under a
 * second and there is nothing to gain from batching. Kept as a helper so the
 * CLI and any future route agree on how a list is built.
 */
export function evidenceForMatches(athlete, matches, {
  sport = null, maxEmail = MAX_EMAIL_EVIDENCE,
} = {}) {
  const resolved = sport || athlete.sport || 'mens-soccer';
  return matches.map((match) => ({
    match,
    evidence: evidenceFor(athlete, match.name, { sport: resolved, match, maxEmail }),
  }));
}
