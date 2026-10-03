/**
 * THE SERVER-SIDE V2 MATCHMAKING SERVICE — A9.1.
 *
 * One canonical place that turns a stored Thriv3 player into the accepted V2
 * full-universe result. It is an ADAPTER AROUND A FROZEN ENGINE and contains
 * no scoring of its own: every number it returns was produced by `runPursuit`,
 * and the only things added are a ranking band, a product state and the
 * version stamps A9.2 will persist.
 *
 * The freeze is the contract. `docs/validation/V2-FREEZE.md` is adopted and
 * `shared/matching/v2/freeze.test.js` enforces it, so where the engine's shape
 * is awkward for a product, THE PRODUCT BENDS. Three places where that shows:
 *
 *   - Unresolved contribution is refused here rather than smoothed over,
 *     because the engine would otherwise return 1,400 truthful refusals and a
 *     caller would read an empty list as "no good matches".
 *   - A refusal carries `null`, never `0`. Any consumer that sorts on a number
 *     must check `status` first, and the contract makes that unavoidable by
 *     omitting the value rather than zeroing it.
 *   - Bands are presentation over the exact rank. The rank stays.
 *
 * V1 IS UNTOUCHED. Nothing here imports `playerAnalysis`, writes
 * `players.recommendations`, or changes a route the product already serves.
 */
import crypto from 'node:crypto';
import { canonicalPosition } from '../../../shared/positions.js';
import { normaliseAthlete } from '../../../shared/matching/pool.js';
import {
  buildValidationAthlete, RANKING_STATE, TOP_N, isScoreable, explainProgramme,
} from '../../../shared/matching/v2/index.js';
import { REQUIRED_INPUTS, NOT_COLLECTED } from '../../../shared/matching/v2/validation/athleteInput.js';
import { familyContribution, contributionPairError } from '../../../shared/matching/v2/financialRules.js';
import { FREEZE_ENGINE_HEAD } from '../../../shared/matching/v2/freeze.js';
import { buildPoolContext } from './poolContext.js';
import { runPursuit } from './pursuitRun.js';
import { universeOf, UNIVERSE } from './validationUniverse.js';
import { cachedCorpusDigests } from './corpusIdentity.js';
import { corpusRevisionToken } from '../../db/corpusIdentity.js';

export const MATCHER_VERSION = 'v2';

/** The roster season V2 reads. Kept beside the service that asks for it. */
export const SEASON = '2026';

/** A domain failure the route maps to a status code, in the repo's idiom. */
export function serviceError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Ranking bands — presentation only
// ---------------------------------------------------------------------------

/**
 * A8 measured 600-975 adjacent pairs per athlete differing by less than 0.001,
 * so a UI that renders #100 and #101 as materially different is asserting a
 * precision the engine does not have. Bands are the honest unit.
 *
 * They change NOTHING. The exact rank is still on every programme, the
 * ordering is the engine's, and the boundaries are the ones A8's outlier
 * selector already treated as operationally meaningful.
 */
export const BAND = Object.freeze({
  PRIORITY_OUTREACH: 'PRIORITY_OUTREACH',
  STRONG_PURSUIT: 'STRONG_PURSUIT',
  VIABLE_CONSIDERATION: 'VIABLE_CONSIDERATION',
  BROADER_UNIVERSE: 'BROADER_UNIVERSE',
});

export function bandForRank(rank) {
  if (!Number.isFinite(rank)) return null;
  if (rank <= 25) return BAND.PRIORITY_OUTREACH;
  if (rank <= 50) return BAND.STRONG_PURSUIT;
  if (rank <= TOP_N) return BAND.VIABLE_CONSIDERATION;
  return BAND.BROADER_UNIVERSE;
}

/**
 * The three product states.
 *
 * None of them is "bad match". A programme is ranked, or it is missing the
 * evidence to be ranked, or Thriv3 holds no eligibility rule for its
 * association - and the last two are statements about Thriv3, not about the
 * programme.
 */
export const STATUS = Object.freeze({
  RANKED: 'RANKED',
  SUPPORTED_LIMITED_DATA: 'SUPPORTED_LIMITED_DATA',
  UNSUPPORTED_ASSOCIATION: 'UNSUPPORTED_ASSOCIATION',
});

// ---------------------------------------------------------------------------
// Pool-context cache
// ---------------------------------------------------------------------------

/**
 * Keyed by sport AND the data identity that can change a score, in TWO LEVELS.
 *
 * NOT by the engine freeze digest: the engine is frozen and the corpus is not,
 * so a freeze-keyed cache would never invalidate.
 *
 * -- WHY TWO LEVELS, MEASURED ----------------------------------------------
 *
 * The obvious key is the SUPPORTED corpus digest, and the first version of
 * this used it. That made the warm path SLOWER THAN THE WORK IT WAS CACHING:
 * computing the digest reads every college, roster row and arrival and hashes
 * them, which costs ~1,400ms, so a warm request spent 1,000ms deciding it
 * could skip a 500ms build. A cache whose key costs more than its miss is not
 * a cache.
 *
 *   level 1  corpusChangeToken  ~0.01ms  SQLite's own data_version plus
 *                                        total_changes. Any commit, by this
 *                                        connection or another, moves it.
 *   level 2  corpusDigests      ~1,400ms the content identity, computed only
 *                                        when level 1 moved, and carried on
 *                                        the result for provenance. Since A9.4
 *                                        it is reached through
 *                                        `cachedCorpusDigests`, which applies
 *                                        this same token gate once for every
 *                                        caller rather than once per caller.
 *
 * The token is a CHANGE DETECTOR, not an identity: it moves on writes that
 * touch nothing V2 reads. That is the right direction to be wrong in - it
 * costs a rebuild, never a stale answer - and level 2 then confirms whether
 * the supported universe actually moved, so a 7B coach write re-verifies and
 * keeps serving the same digest.
 *
 * Bounded to one entry per sport, which is the whole universe today.
 */
const contextCache = new Map();

export function clearContextCache() { contextCache.clear(); }

export function contextCacheState() {
  return [...contextCache.entries()]
    .map(([sport, e]) => ({ sport, corpusDigest: e.corpusDigest, changeToken: e.changeToken }));
}

/**
 * @returns {{ ctx, colleges, corpusDigest, built: boolean, buildMs: number }}
 */
export function poolContextFor(db, sport, { season = SEASON } = {}) {
  const token = corpusRevisionToken(db);
  const hit = contextCache.get(sport);
  if (hit && hit.changeToken === token) {
    return { ...hit, built: false, buildMs: 0, digestRecomputed: false };
  }

  /** Level 1 moved (or there is no entry): find out whether it mattered. */
  /**
   * A9.4: the same shared cache `runStaleness` reads. The level-2 computation
   * described above is unchanged - this is still the authoritative identity -
   * but when the token moved because of a 7B coach write, the service and the
   * staleness check now pay for ONE recomputation between them rather than two.
   */
  const digests = cachedCorpusDigests(db, { season });
  const corpusDigest = digests[UNIVERSE.SUPPORTED].digest;
  if (hit && hit.corpusDigest === corpusDigest) {
    /**
     * Something was written, but nothing V2 reads. Re-stamp the token and keep
     * the context: this is the 7B case, where coach and junior-college work
     * commits continuously and no supported cell moves.
     */
    const refreshed = { ...hit, changeToken: token };
    contextCache.set(sport, refreshed);
    return { ...refreshed, built: false, buildMs: 0, digestRecomputed: true };
  }

  const started = Date.now();
  const ctx = buildPoolContext({ db, sport, season });
  const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
  const buildMs = Date.now() - started;
  /**
   * Written only after BOTH reads succeed. A half-built entry keyed by a
   * digest it does not match is the one failure mode a cache must not have:
   * it would serve a context for a corpus that no longer exists and look
   * exactly like a correct answer.
   */
  const entry = {
    ctx, colleges, corpusDigest, changeToken: token,
    unsupportedDigest: digests[UNIVERSE.UNSUPPORTED].digest,
  };
  contextCache.set(sport, entry);
  return { ...entry, built: true, buildMs, digestRecomputed: true };
}

// ---------------------------------------------------------------------------
// Contribution precondition
// ---------------------------------------------------------------------------

/**
 * Resolved means the engine can price the pool. It is the engine's own
 * predicate - `familyContribution` returns null to mean REFUSE - rather than a
 * restatement of it here, so the two cannot drift.
 */
export function contributionReadiness(player) {
  const pair = {
    contributionState: player.contribution_state ?? null,
    maxAnnualContributionUsd: player.max_annual_contribution_usd ?? null,
  };
  const malformed = contributionPairError(pair);
  if (malformed) {
    return { resolved: false, malformed, state: pair.contributionState };
  }
  const resolved = familyContribution({ ...pair, budgetRange: player.budget_range ?? null });
  return {
    resolved: resolved !== null,
    malformed: null,
    state: pair.contributionState ?? (resolved ? 'LEGACY_BAND' : null),
    source: resolved?.source ?? null,
  };
}

// ---------------------------------------------------------------------------
// Adapter: engine output -> product contract
// ---------------------------------------------------------------------------

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(6)) : null);

/**
 * One layer.
 *
 * A refusal has no `value` KEY AT ALL rather than `value: null`. A consumer
 * that reaches for a number gets `undefined` and fails visibly, where a null
 * would quietly sort to the bottom and read as "worst", which is the one
 * reading V2 exists to prevent.
 */
function layerView(result) {
  if (!result) return { state: 'ABSENT' };
  if (!isScoreable(result)) {
    const out = { state: 'UNSCOREABLE', reason: result.reason ?? null };
    if (typeof result.coverage === 'number') out.coverage = num(result.coverage);
    if (Array.isArray(result.missing) && result.missing.length) out.missing = [...result.missing].sort();
    return out;
  }
  return {
    state: 'SCOREABLE',
    value: num(result.value),
    grade: result.grade ?? null,
    coverage: num(result.coverage),
  };
}

function programmeView(entry, { rank, status, explanationFor }) {
  const view = {
    programmeId: entry.id,
    name: entry.name,
    division: entry.division,
    status,
    universe: status === STATUS.UNSUPPORTED_ASSOCIATION ? UNIVERSE.UNSUPPORTED : UNIVERSE.SUPPORTED,
    recruitability: layerView(entry.recruitability),
    financial: layerView(entry.financial),
    opportunity: layerView(entry.opportunity),
  };
  if (status === STATUS.RANKED) {
    view.rank = rank;
    view.band = bandForRank(rank);
    view.pursuit = num(entry.pursuitPriority.value);
    view.pursuitGrade = entry.pursuitPriority.grade ?? null;
  } else {
    view.missingLayers = Array.isArray(entry.missingLayers) && entry.missingLayers.length
      ? [...entry.missingLayers].sort() : [];
  }
  const explanation = explanationFor ? explanationFor(entry, status) : null;
  if (explanation) view.explanation = explanation;
  return view;
}

/**
 * Why an unsupported programme says what it says.
 *
 * Phrased as a fact about Thriv3's rules, never about the institution. A
 * consultant reading "we hold no eligibility rule for NJCAA" can act on it;
 * "not a good match" would be false.
 */
export const UNSUPPORTED_EXPLANATION = Object.freeze({
  headline: 'Not ranked: no eligibility model on file for this association.',
  detail: 'Thriv3 holds eligibility rules for NCAA Divisions I-III and the NAIA. '
    + 'Without a rule for this association it cannot read how many seasons a player has left, '
    + 'so there is nothing to rank. This is a gap in what Thriv3 knows, not a judgement about the programme.',
});

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/**
 * Compute the accepted V2 result for a stored player.
 *
 * @param {object}  db      an open better-sqlite3 handle
 * @param {object}  player  a stored `players` row
 * @returns the A9.0 product contract
 */
/**
 * THE ENGINE'S OWN EXPLANATION, FOR EVERY PROGRAMME IN A RUN — A11 §7, §8.
 *
 * ===========================================================================
 * READS ONLY. CHANGES NOTHING.
 *
 * `explainProgramme` is documented, and tested, as recomputing nothing: every
 * number it reports comes out of a basis object a scorer already produced.
 * Turning it on therefore cannot move a score, a rank or a ranking state, and
 * the regression that proves it is the whole-suite parity check.
 *
 * -- WHY THIS IS BUILT HERE AND NOT IN THE ROUTE ---------------------------
 *
 * The explanation's context is `{ rank, outOf, poolSize }`, and only this
 * function knows them: `outOf` is the size of the ranked list, which is not
 * known until the pipeline has run. A route-level closure would have to be
 * handed the pipeline to compute them, which is the pipeline leaking.
 *
 * -- WHY IT IS OPT-IN ------------------------------------------------------
 *
 * The GET that previews a run does not need it and should not pay for it.
 * The POST that PERSISTS a run does, because an explanation is only worth
 * anything if it is the explanation of the run actually stored — recomputing
 * one later against a moved corpus would explain a different ranking than the
 * one on screen.
 * ===========================================================================
 */
function explanationsFor(pipeline) {
  const ranked = pipeline?.ranked ?? [];
  const outOf = ranked.length;
  const poolSize = outOf
    + (pipeline?.limited?.length ?? 0)
    + (pipeline?.ineligible?.length ?? 0)
    + (pipeline?.suppressed?.length ?? 0);
  return (entry) => explainProgramme(entry, {
    rank: entry.rank ?? null,
    outOf,
    poolSize,
  });
}

export function computeMatchmakingV2(db, player, {
  season = SEASON, explanationFor = null, withExplanations = false,
} = {}) {
  if (!player || !player.id) throw serviceError('PLAYER_REQUIRED', 'A stored player is required.');

  const sport = player.sport ?? null;
  if (!sport) {
    throw serviceError('ATHLETE_SPORT_UNKNOWN', 'This athlete has no sport, so no calibration exists and nothing can be scored.');
  }

  const readiness = contributionReadiness(player);
  if (readiness.malformed) {
    throw serviceError('CONTRIBUTION_INVALID', `The recorded family contribution is not a legal pair: ${readiness.malformed}`);
  }
  if (!readiness.resolved) {
    throw serviceError('CONTRIBUTION_UNRESOLVED',
      'Matchmaking needs a resolved family contribution before it can rank. '
      + 'Nothing is assumed, and an unanswered contribution is not treated as zero.');
  }

  /**
   * Required inputs are checked BEFORE the builder, against the engine's own
   * `REQUIRED_INPUTS` declaration rather than a restatement of it.
   *
   * Order matters and was found by a test: the builder calls
   * `abilityToPercentile` while assembling, so an athlete with no rating threw
   * out of calibration before the `missing` list it also produces could be
   * read - and a 500 is the wrong thing to tell an operator whose athlete is
   * simply not finished.
   */
  const blocking = Object.entries(REQUIRED_INPUTS)
    .filter(([field, spec]) => spec.required && !NOT_COLLECTED.includes(field))
    .filter(([field]) => {
      const v = player[field];
      return v === null || v === undefined || v === '';
    })
    .map(([field]) => field);
  if (blocking.length) {
    throw serviceError('ATHLETE_PROFILE_INCOMPLETE',
      `This athlete cannot be ranked until these are recorded: ${blocking.join(', ')}.`);
  }

  const position = canonicalPosition(player.position);
  const v1Shape = normaliseAthlete({ ...player, preferred_divisions: '[]', preferred_conferences: '[]' });
  let athlete;
  try {
    ({ athlete } = buildValidationAthlete({
      record: player, v1Shape, position, label: player.id, recruitType: player.recruit_type ?? null,
    }));
  } catch (err) {
    /**
     * The engine refuses an intake defect loudly - a rating outside 1-10 is
     * not clamped, because clamping would hide it. That refusal is about the
     * ATHLETE'S DATA, not about the server, so it leaves as a typed 4xx
     * carrying the engine's own sentence, which names the field and the value
     * and no path or table.
     */
    throw serviceError('ATHLETE_PROFILE_INVALID',
      `This athlete's profile cannot be read by the matcher: ${err.message}`);
  }

  const {
    ctx, colleges, corpusDigest, built, buildMs, digestRecomputed,
  } = poolContextFor(db, sport, { season });
  if (!colleges.length) {
    throw serviceError('EMPTY_PROGRAMME_UNIVERSE', `No active ${sport} programmes are on file.`);
  }

  const started = Date.now();
  const run = runPursuit({ athlete, sport, colleges, ctx });
  const evaluateMs = Date.now() - started;

  const adaptStarted = Date.now();
  const universeOfProgramme = (division) => universeOf({ division, season: Number(season) });

  /** An explicit `explanationFor` wins; `withExplanations` is the ordinary way in. */
  const explain = explanationFor ?? (withExplanations ? explanationsFor(run.pipeline) : null);

  const programmes = [];
  for (const entry of run.pipeline.ranked) {
    programmes.push(programmeView(entry, { rank: entry.rank, status: STATUS.RANKED, explanationFor: explain }));
  }
  for (const entry of [...run.pipeline.limited,
    ...(run.pipeline.ineligible ?? []), ...(run.pipeline.suppressed ?? [])]) {
    const unsupported = universeOfProgramme(entry.division) === UNIVERSE.UNSUPPORTED;
    const view = programmeView(entry, {
      rank: null,
      status: unsupported ? STATUS.UNSUPPORTED_ASSOCIATION : STATUS.SUPPORTED_LIMITED_DATA,
      explanationFor: explain,
    });
    if (unsupported && !view.explanation) view.explanation = UNSUPPORTED_EXPLANATION;
    programmes.push(view);
  }

  /**
   * Ranked first in rank order, then everything else by programme id.
   *
   * Deterministic by construction: the ranked half is the engine's ordering
   * and the unranked half has no ordering to assert, so it is sorted by a
   * stable key rather than left in pool-iteration order.
   */
  programmes.sort((a, b) => {
    if (a.status === STATUS.RANKED && b.status === STATUS.RANKED) return a.rank - b.rank;
    if (a.status === STATUS.RANKED) return -1;
    if (b.status === STATUS.RANKED) return 1;
    return String(a.programmeId).localeCompare(String(b.programmeId));
  });

  const supportedUniverseCount = colleges
    .filter((c) => universeOfProgramme(c.division) === UNIVERSE.SUPPORTED).length;
  const adaptMs = Date.now() - adaptStarted;

  return {
    matcherVersion: MATCHER_VERSION,
    engineFreeze: FREEZE_ENGINE_HEAD,
    corpusDigest,
    computedAt: new Date().toISOString(),
    playerId: player.id,
    sport,
    season,
    contributionState: readiness.state,
    counts: {
      poolSize: colleges.length,
      supportedUniverse: supportedUniverseCount,
      ranked: programmes.filter((p) => p.status === STATUS.RANKED).length,
      limitedData: programmes.filter((p) => p.status === STATUS.SUPPORTED_LIMITED_DATA).length,
      unsupported: programmes.filter((p) => p.status === STATUS.UNSUPPORTED_ASSOCIATION).length,
    },
    timings: {
      contextBuiltThisCall: built, contextBuildMs: buildMs, digestRecomputed, evaluateMs, adaptMs,
    },
    programmes,
  };
}

/**
 * One programme's result, by id.
 *
 * A9.5 will need this for Specific Search, and it exists now so that nobody is
 * tempted to build a second scoring path to answer "where does this school
 * rank". There is one ordering; this reads from it.
 */
export function findProgrammeResult(result, programmeId) {
  return result?.programmes?.find((p) => p.programmeId === programmeId) ?? null;
}

/** The Top 100, as a prefix of the one ordering. Never a separate list. */
export function topSlice(result, n = TOP_N) {
  return (result?.programmes ?? []).filter((p) => p.status === STATUS.RANKED && p.rank <= n);
}

/** A stable digest of the engine facts, for A9.2 persistence and parity tests. */
export function resultDigest(result) {
  const facts = (result?.programmes ?? []).map((p) => [
    p.programmeId, p.status, p.rank ?? null, p.pursuit ?? null,
    p.recruitability.value ?? null, p.financial.value ?? null, p.opportunity.value ?? null,
    p.recruitability.reason ?? null, p.financial.reason ?? null, p.opportunity.reason ?? null,
  ]);
  return crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

/**
 * `TOP_N` RE-EXPORTED, because the route layer needs the bound and may not
 * reach into `shared/matching/v2/` for it — the V2 import boundary allows
 * `server/lib/v2/` and not `server/routes/`. One definition, reached through
 * the doorway that is allowed to hold it.
 */
export { RANKING_STATE, TOP_N };
