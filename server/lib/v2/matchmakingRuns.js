/**
 * DURABLE, VERSIONED V2 MATCHMAKING RUNS — A9.2.
 *
 * A run is IMMUTABLE. Nothing here updates a rank, a score or a state after
 * the fact: recomputing writes a new run, and the old one keeps what it said.
 * That is what makes outreach attributable - "this coach was emailed when
 * Thriv3 ranked them #37, under run X, on this corpus, from this engine".
 *
 * V1 IS NOT TOUCHED. `players.recommendations` still points at its JSON blob
 * in server/uploads/, campaigns still resolve it, and `identifyModel()` still
 * classifies it. Nothing in this module reads or writes that column.
 *
 * -- WHAT IS STORED, AND WHAT IS A PURE FUNCTION OF IT ---------------------
 *
 * Stored: everything a later reader cannot recompute - rank, Pursuit, each
 * layer's value, grade, coverage and refusal reason, and the athlete inputs
 * that produced them.
 *
 * Derived on read: the ranking band (`bandForRank`), each layer's state
 * (SCOREABLE exactly when the value is not null) and `missingLayers`. Storing
 * those would be a second copy of a fact that could disagree with the first,
 * and `result_schema_version` is what pins which band map applied.
 *
 * Explanation prose is also derived. It is generated from the frozen
 * vocabulary over the state stored here, so persisting sentences would freeze
 * a RENDERING rather than a fact - and A8.2 is the worked example: the
 * engine's answer changed and every sentence had to change with it.
 */
import { MATCHING_INPUT_FIELDS_V1, MATCHING_UNORDERED_LIST_FIELDS } from '../../../shared/matchingInputFields.js';
import crypto from 'node:crypto';
import { FREEZE_ENGINE_HEAD } from '../../../shared/matching/v2/freeze.js';
import { bandForRank, STATUS, SEASON, TOP_N, serviceError } from './matchmakingService.js';
import { cachedCorpusDigests } from './corpusIdentity.js';
import { UNIVERSE } from './validationUniverse.js';

/**
 * Bumped when the RESULT shape changes - a new stored column, or a change to
 * one of the derived functions above. A reader compares it before trusting a
 * derivation, which is what lets `bandForRank` be a pure function rather than
 * a column.
 */
export const RESULT_SCHEMA_VERSION = 1;

/**
 * Bumped when the INPUT snapshot's field set changes. Moves independently.
 *
 * 2: the recruitment preferences joined - location (read by `locationFit`)
 * and the four lists the match card checks each programme against.
 */
export const INPUT_SCHEMA_VERSION = 2;

/**
 * THE ATHLETE FIELDS A RANKING ACTUALLY READ, AND NOTHING ELSE.
 *
 * Not the player row. A historical run must stay interpretable after the
 * athlete's rating, position, major, contribution or preferences change, and
 * the mutable row cannot do that - but a snapshot of the WHOLE row would put
 * guardian email, club coach email and contact windows into permanent storage
 * for no ranking purpose at all. Every field below is read by a layer or a
 * preference; nothing else is.
 */
// Phase 5 (#5): the lists live in shared/matchingInputFields.js, so the edit form can ask the
// same question this file asks - "does this change anything matching reads?" - from one list.
const INPUT_FIELDS_V1 = MATCHING_INPUT_FIELDS_V1;
const UNORDERED_LIST_FIELDS = MATCHING_UNORDERED_LIST_FIELDS;

export const INPUT_FIELDS = Object.freeze([...INPUT_FIELDS_V1, ...UNORDERED_LIST_FIELDS]);

/** The field set a run was snapshotted under, so an older run is compared like for like. */
function inputFieldsFor(version) {
  return Number(version) >= 2 ? INPUT_FIELDS : INPUT_FIELDS_V1;
}

function unorderedList(value) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return null; }
  }
  if (!Array.isArray(list) || list.length === 0) return null;
  return [...new Set(list.map(String))].sort();
}

/** The snapshot, and a digest of it so a change is detectable without a diff. */
export function inputSnapshot(player) {
  const snap = {};
  for (const f of INPUT_FIELDS) {
    snap[f] = UNORDERED_LIST_FIELDS.includes(f) ? unorderedList(player[f]) : (player[f] ?? null);
  }
  return snap;
}

export function inputDigest(snapshot, fields = INPUT_FIELDS) {
  /** Key order fixed by the field list, so the digest cannot depend on insertion order. */
  const canonical = fields.map((f) => [f, snapshot[f] ?? null]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Persist one computed result as an immutable run.
 *
 * ONE TRANSACTION. A run and its programme rows are a single fact; a half
 * written run - metadata with no programmes, or 400 of 1,205 rows - would be
 * indistinguishable from a real one with a small universe, which is the worst
 * possible failure for a historical record.
 */
/**
 * WHAT OF AN EXPLANATION IS WORTH STORING — A11.
 *
 * ===========================================================================
 * TWO THINGS COME OUT, AND BOTH FOR A REASON.
 *
 * `layerReasons` is DROPPED because it is not a second fact: it is the same
 * reason objects as `reasons`, grouped by the `layer` each one already
 * carries. Storing both duplicated 2.5 KB per programme row — 3 MB per run —
 * to save a `groupBy` at read time. `hydrate` regroups it.
 *
 * `gateEffects` and `evidenceQuality` are DROPPED because `render.js` marks
 * them CLIENT_UNSAFE: they are model-internal, and no surface this phase
 * builds may render them. Storing what nothing may display is cost without
 * a reader.
 *
 * Measured: 6,581 bytes per row before, and what remains is the part a screen
 * can actually say out loud.
 * ===========================================================================
 */
export function storableExplanation(explanation) {
  if (!explanation) return null;
  const {
    layerReasons, gateEffects, evidenceQuality, ...keep
  } = explanation;
  return keep;
}

/** The inverse: `layerReasons` regrouped from the reasons' own `layer`. */
function withLayerReasons(explanation) {
  if (!explanation) return null;
  if (explanation.layerReasons) return explanation;
  const layerReasons = { recruitability: [], financial: [], opportunity: [] };
  for (const r of explanation.reasons ?? []) {
    if (layerReasons[r.layer]) layerReasons[r.layer].push(r);
  }
  return { ...explanation, layerReasons };
}

/**
 * WHICH PROGRAMMES GET A PERSISTED EXPLANATION — A11.1 §3.
 *
 * ===========================================================================
 * THE TOP 100, AND NOTHING ELSE.
 *
 * A11 persisted one for all 1,205 programmes in a run, which measured 3.6 MB
 * PER RUN. Runs are immutable and never deleted, so that is unbounded growth
 * on a persistent disk to carry prose for programmes nobody expands.
 *
 * The bound is the Top 100 because that is the set this product asks an
 * operator to act on, and it is the set the explanation was designed to
 * justify. Everything else keeps its full scoring row — the universe is
 * persisted exactly as before — and simply carries no prose.
 *
 * WHAT THIS DOES NOT TOUCH, and the tests say so: `resultDigest`, the
 * ranking, layer values, evidence grades, full-universe persistence, Specific
 * Search standing, selection provenance. An explanation has never been an
 * input to any of them, which is why it can be bounded without consequence.
 *
 * NON-RANKED STATES GET NOTHING, DELIBERATELY. A SUPPORTED_LIMITED_DATA or
 * UNSUPPORTED_ASSOCIATION programme has no ranking to explain, and generating
 * prose for one "for UI completeness" would be manufacturing an explanation
 * of a rank that does not exist.
 * ===========================================================================
 */
export function explanationToStore(programme) {
  if (!programme?.explanation) return null;
  if (programme.status !== STATUS.RANKED) return null;
  if (!Number.isFinite(programme.rank) || programme.rank > TOP_N) return null;
  return JSON.stringify(storableExplanation(programme.explanation));
}

export function persistRun(db, player, result, { runId = crypto.randomUUID(), now = new Date().toISOString() } = {}) {
  if (!result || result.matcherVersion !== 'v2') {
    throw serviceError('RESULT_REQUIRED', 'A computed V2 result is required.');
  }
  const snapshot = inputSnapshot(player);

  const insertRun = db.prepare(`
    INSERT INTO matchmaking_runs (
      id, player_id, matcher_version, engine_freeze, corpus_digest, computed_at,
      result_schema_version, input_schema_version, sport, input_snapshot,
      pool_size, supported_universe_count, ranked_count, limited_data_count,
      unsupported_count, contribution_state, created_at
    ) VALUES (
      @id, @player_id, @matcher_version, @engine_freeze, @corpus_digest, @computed_at,
      @result_schema_version, @input_schema_version, @sport, @input_snapshot,
      @pool_size, @supported_universe_count, @ranked_count, @limited_data_count,
      @unsupported_count, @contribution_state, @created_at
    )`);

  const insertResult = db.prepare(`
    INSERT INTO matchmaking_programme_results (
      run_id, college_name, sport, college_id, division, status, rank,
      pursuit, pursuit_grade,
      recruitability, recruitability_grade, recruitability_coverage, recruitability_reason,
      financial, financial_grade, financial_coverage, financial_reason,
      opportunity, opportunity_grade, opportunity_coverage, opportunity_reason,
      explanation
    ) VALUES (
      @run_id, @college_name, @sport, @college_id, @division, @status, @rank,
      @pursuit, @pursuit_grade,
      @recruitability, @recruitability_grade, @recruitability_coverage, @recruitability_reason,
      @financial, @financial_grade, @financial_coverage, @financial_reason,
      @opportunity, @opportunity_grade, @opportunity_coverage, @opportunity_reason,
      @explanation
    )`);

  const write = db.transaction(() => {
    insertRun.run({
      id: runId,
      player_id: player.id,
      matcher_version: result.matcherVersion,
      engine_freeze: result.engineFreeze,
      corpus_digest: result.corpusDigest,
      computed_at: result.computedAt,
      result_schema_version: RESULT_SCHEMA_VERSION,
      input_schema_version: INPUT_SCHEMA_VERSION,
      sport: result.sport,
      input_snapshot: JSON.stringify(snapshot),
      pool_size: result.counts.poolSize,
      supported_universe_count: result.counts.supportedUniverse,
      ranked_count: result.counts.ranked,
      limited_data_count: result.counts.limitedData,
      unsupported_count: result.counts.unsupported,
      contribution_state: result.contributionState ?? 'UNKNOWN',
      created_at: now,
    });
    for (const p of result.programmes) {
      insertResult.run({
        run_id: runId,
        college_name: p.name,
        sport: result.sport,
        college_id: p.programmeId ?? null,
        division: p.division ?? null,
        status: p.status,
        rank: p.rank ?? null,
        pursuit: p.pursuit ?? null,
        pursuit_grade: p.pursuitGrade ?? null,
        recruitability: p.recruitability.value ?? null,
        recruitability_grade: p.recruitability.grade ?? null,
        recruitability_coverage: p.recruitability.coverage ?? null,
        recruitability_reason: p.recruitability.reason ?? null,
        financial: p.financial.value ?? null,
        financial_grade: p.financial.grade ?? null,
        financial_coverage: p.financial.coverage ?? null,
        financial_reason: p.financial.reason ?? null,
        opportunity: p.opportunity.value ?? null,
        opportunity_grade: p.opportunity.grade ?? null,
        opportunity_coverage: p.opportunity.coverage ?? null,
        opportunity_reason: p.opportunity.reason ?? null,
        /**
         * A11. Captured WITH the run, because it explains THIS ranking. A run
         * computed before A11 stores null, and that is a true record of a run
         * whose explanation was never captured — not a row to backfill.
         */
        explanation: explanationToStore(p),
      });
    }
  });
  write();
  return runId;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * THE CURRENT RUN IS THE LATEST ONE, QUERIED - not a pointer and not a flag.
 *
 * A pointer column on `players` is exactly what V1 has, and it is the reason
 * a campaign could be one profile save away from losing its Top 100. A
 * `is_current` flag needs two writes to move and has a window where a player
 * has none or two. The latest immutable run needs neither: nothing updates,
 * so nothing can be torn, and a rollback is "ignore the newer run" rather
 * than a compensating write.
 */
export function currentRun(db, playerId) {
  return db.prepare(`
    SELECT * FROM matchmaking_runs
     WHERE player_id = ?
     ORDER BY computed_at DESC, rowid DESC
     LIMIT 1`).get(playerId) ?? null;
}

export function runById(db, runId) {
  return db.prepare('SELECT * FROM matchmaking_runs WHERE id = ?').get(runId) ?? null;
}

/** The derived half, rebuilt from what was stored. */
function hydrate(row, { resultSchemaVersion, skipExplanation = false }) {
  const layer = (value, grade, coverage, reason) => (value === null || value === undefined
    ? { state: 'UNSCOREABLE', reason: reason ?? null, ...(coverage === null ? {} : { coverage }) }
    : {
      state: 'SCOREABLE', value, grade: grade ?? null, coverage: coverage ?? null,
    });
  const out = {
    programmeId: row.college_id,
    name: row.college_name,
    division: row.division,
    status: row.status,
    universe: row.status === STATUS.UNSUPPORTED_ASSOCIATION ? UNIVERSE.UNSUPPORTED : UNIVERSE.SUPPORTED,
    recruitability: layer(row.recruitability, row.recruitability_grade, row.recruitability_coverage, row.recruitability_reason),
    financial: layer(row.financial, row.financial_grade, row.financial_coverage, row.financial_reason),
    opportunity: layer(row.opportunity, row.opportunity_grade, row.opportunity_coverage, row.opportunity_reason),
  };
  /**
   * Parsed back to the object the explainer produced. A row written before
   * A11 has none; `explanation: null` is how the UI knows to say so rather
   * than render an empty one.
   */
  if (row.explanation && !skipExplanation) {
    try {
      out.explanation = withLayerReasons(JSON.parse(row.explanation));
    } catch {
      /* A stored explanation that will not parse is not an explanation. Say
         nothing rather than render a fragment of one. */
      out.explanation = null;
    }
  }
  if (row.status === STATUS.RANKED) {
    out.rank = row.rank;
    /** Derived, and only trusted for a schema version whose band map we know. */
    out.band = resultSchemaVersion === RESULT_SCHEMA_VERSION ? bandForRank(row.rank) : null;
    out.pursuit = row.pursuit;
    out.pursuitGrade = row.pursuit_grade;
  } else {
    out.missingLayers = ['recruitability', 'financial', 'opportunity']
      .filter((L) => out[L].state !== 'SCOREABLE').sort();
  }
  return out;
}

/** A persisted run, in the same product shape the live service returns. */
export function readRun(db, runRow) {
  if (!runRow) return null;
  /**
   * THE SAME ORDER THE LIVE SERVICE EMITS: ranked by rank, then everything
   * else by programme id.
   *
   * A first version ordered the unranked tail by `college_name`, which holds
   * identical DATA in a different sequence - and every field-by-field
   * comparison passed while `resultDigest` disagreed. The digest is computed
   * over the array, so a persisted run has to be byte-comparable with the
   * live one or round-trip parity can only ever be argued, not checked.
   */
  const rows = db.prepare(`
    SELECT * FROM matchmaking_programme_results
     WHERE run_id = ?
     ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END, rank, college_id, college_name`).all(runRow.id);
  return {
    runId: runRow.id,
    matcherVersion: runRow.matcher_version,
    engineFreeze: runRow.engine_freeze,
    corpusDigest: runRow.corpus_digest,
    computedAt: runRow.computed_at,
    resultSchemaVersion: runRow.result_schema_version,
    inputSchemaVersion: runRow.input_schema_version,
    playerId: runRow.player_id,
    sport: runRow.sport,
    contributionState: runRow.contribution_state,
    inputSnapshot: JSON.parse(runRow.input_snapshot),
    counts: {
      poolSize: runRow.pool_size,
      supportedUniverse: runRow.supported_universe_count,
      ranked: runRow.ranked_count,
      limitedData: runRow.limited_data_count,
      unsupported: runRow.unsupported_count,
    },
    /**
     * EXPLANATIONS ARE NOT IN THE LIST PAYLOAD — A11 §11.
     *
     * One is ~2.8 KB and a run holds 1,205 of them. Including them would take
     * `runs/current` from ~500 KB to several megabytes on a request every
     * surface makes on mount, to carry prose that is only ever read for the
     * one card somebody expands. `programmeResult` serves that one.
     */
    programmes: rows.map((r) => hydrate(r, {
      resultSchemaVersion: runRow.result_schema_version, skipExplanation: true,
    })),
  };
}

/**
 * One programme inside one run, without reading the run.
 *
 * A9.5's Specific Search answers "what rank did this school have" from here
 * rather than by recomputing a historical run - which it could not do anyway,
 * because the corpus has moved on.
 */
export function programmeResult(db, runId, { collegeId = null, collegeName = null, sport = null } = {}) {
  /**
   * Name and sport is the INDEXED path - it is the primary key, and it is the
   * programme identity athlete_programmes and programme_campaigns both use.
   * The college_id path is a scan within one run, which measured 0.082ms
   * against 0.034ms; a dedicated index for that difference cost 21% of the
   * table's storage, so it does not exist.
   */
  const row = collegeId
    ? db.prepare('SELECT * FROM matchmaking_programme_results WHERE run_id = ? AND college_id = ?').get(runId, collegeId)
    : db.prepare('SELECT * FROM matchmaking_programme_results WHERE run_id = ? AND college_name = ? AND sport = ?')
      .get(runId, collegeName, sport);
  if (!row) return null;
  const run = runById(db, runId);
  return hydrate(row, { resultSchemaVersion: run?.result_schema_version ?? RESULT_SCHEMA_VERSION });
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

export const STALE_REASON = Object.freeze({
  PLAYER_INPUT_CHANGED: 'PLAYER_INPUT_CHANGED',
  CORPUS_CHANGED: 'CORPUS_CHANGED',
  ENGINE_CHANGED: 'ENGINE_CHANGED',
});

/**
 * Is a persisted run still what the engine would say today?
 *
 * Three independent reasons, reported together rather than as one boolean,
 * because they mean different things to an operator: a changed input is their
 * own edit, a changed corpus is new evidence arriving, and a changed engine is
 * a freeze that moved and should be rare by construction.
 *
 * NOTHING IS RECOMPUTED HERE and nothing is deleted. A stale run is still the
 * truth about what Thriv3 said at the time, which is the only reason to keep
 * history at all.
 */
export function runStaleness(db, player, runRow, { season = SEASON } = {}) {
  if (!runRow) return { current: false, reasons: ['NO_RUN'] };
  const reasons = [];

  /**
   * Compared over the fields THIS run recorded. A run snapshotted before the
   * recruitment preferences existed has no opinion about them, and reading
   * their absence as a change would tell every operator, on deploy, that they
   * had edited every athlete.
   */
  const fields = inputFieldsFor(runRow.input_schema_version);
  const snapshotNow = inputSnapshot(player);
  if (inputDigest(snapshotNow, fields) !== inputDigest(JSON.parse(runRow.input_snapshot), fields)) {
    reasons.push(STALE_REASON.PLAYER_INPUT_CHANGED);
  }
  /**
   * CACHED, NOT CHEAPENED — A9.4. Still the full `corpusDigests` identity and
   * still compared against the digest this run was computed under; the cache
   * only skips RECOMPUTING it when nothing has been written since it last ran.
   * A9.3 measured this single line at ~890ms on every current-run request,
   * against 5.7ms to build the entire 1,205-programme payload beside it.
   */
  if (cachedCorpusDigests(db, { season })[UNIVERSE.SUPPORTED].digest !== runRow.corpus_digest) {
    reasons.push(STALE_REASON.CORPUS_CHANGED);
  }
  if (runRow.engine_freeze !== FREEZE_ENGINE_HEAD) {
    reasons.push(STALE_REASON.ENGINE_CHANGED);
  }
  return { current: reasons.length === 0, reasons };
}
