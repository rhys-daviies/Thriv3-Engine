import express from 'express';
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import { computeMatchmakingV2, TOP_N } from '../lib/v2/matchmakingService.js';
import { programmeContext } from '../lib/v2/programmeContext.js';
import {
  persistRun, currentRun, runById, readRun, runStaleness,
} from '../lib/v2/matchmakingRuns.js';
import {
  lookupProgramme, resolveRun, topSelectionCandidates, recordSelection, selectionsFor,
} from '../lib/v2/matchmakingSelection.js';

/**
 * THE V2 MATCHMAKING API — a doorway, in the shape athlete-programmes set.
 *
 * All the thinking is in `server/lib/v2/matchmakingService.js`, which is
 * itself an adapter around a frozen engine. This module decides who may ask,
 * maps a domain failure to a status code, and decides what leaves the
 * building.
 *
 * -- READ-ONLY, AND NOT YET THE PRODUCT ------------------------------------
 *
 * A9.1 computes and returns; it persists nothing. `players.recommendations`
 * still holds V1's answer and the Matching tab still reads it, so adding this
 * route changes nothing a user sees. A9.2 adds durable versioned storage once
 * this boundary is proven.
 *
 * -- WHY GET ---------------------------------------------------------------
 *
 * The computation is deterministic and writes nothing: the same athlete over
 * the same corpus returns the same engine facts, and A9.1 proved that against
 * the A8.3 acceptance artifact with zero differences. The only varying field
 * is `computedAt`. So it is safely cacheable and idempotent, which is what GET
 * is for. When A9.2 makes storing a result an explicit act, that act gets its
 * own POST rather than this handler acquiring a side effect.
 *
 * -- ACCESS ----------------------------------------------------------------
 *
 * Exactly what every other player route does, and nothing more. `players`
 * carries no ownership column - it is a shared operator store - and
 * `requireOperator` in server/index.js is the whole boundary. Inventing a
 * per-operator rule here would be a new access model smuggled in beside a
 * matchmaking feature, and it would be the only one in the application.
 */
export const matchmakingRouter = express.Router();

/**
 * Domain failure -> status code.
 *
 * CONTRIBUTION_UNRESOLVED is a 409 rather than a 422 on purpose: nothing about
 * the request is wrong and nothing about the athlete is impossible. The record
 * is in a state this operation cannot run against, and the operator resolves
 * it and asks again. The machine code is stable because the frontend will
 * branch on it to render the contribution prompt rather than an empty list.
 */
const STATUS_BY_CODE = Object.freeze({
  PLAYER_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,

  CONTRIBUTION_UNRESOLVED: 409,

  /**
   * A9.5. A run that is not this athlete's, and a programme that is not in the
   * run, are both 422s rather than 404s: the thing asked for exists, and the
   * COMBINATION is what is not allowed to be true. Distinct codes, because one
   * is a routing mistake and the other is an operator searching for a school
   * outside their athlete's evaluated universe.
   */
  RUN_PLAYER_MISMATCH: 422,
  PROGRAMME_NOT_IN_RUN: 422,
  PROGRAMME_REQUIRED: 400,
  SELECTION_SOURCE_INVALID: 422,

  // Well-formed, and asking for something not allowed to be true.
  ATHLETE_SPORT_UNKNOWN: 422,
  ATHLETE_PROFILE_INCOMPLETE: 422,
  ATHLETE_PROFILE_INVALID: 422,
  CONTRIBUTION_INVALID: 422,
  EMPTY_PROGRAMME_UNIVERSE: 422,
  PLAYER_REQUIRED: 400,
  RESULT_REQUIRED: 400,
});

/** One handler for every route, so no endpoint invents its own 404. */
function handle(label, fn) {
  return (req, res) => {
    try {
      const { status = 200, body } = fn(req);
      return res.status(status).json(body);
    } catch (err) {
      const status = STATUS_BY_CODE[err.code];
      if (status) return res.status(status).json({ error: err.message, code: err.code });

      /**
       * Anything else - a SQLite constraint, a bug in the adapter - is ours,
       * and its text may name a table, a column or a path. Logged in full,
       * reported as nothing.
       */
      console.error(`[${label}]`, err);
      return res.status(500).json({ error: 'Unexpected error.' });
    }
  };
}

const notFound = (id) => {
  const err = new Error(`Unknown player: ${id}`);
  err.code = 'PLAYER_NOT_FOUND';
  return err;
};

/**
 * The accepted V2 result for one athlete, over the full supported universe.
 *
 * Returns every evaluated programme, not the Top 100: the band is how a
 * hundred becomes the operational slice, and #101+ are real results a
 * consultant can search. See §K of the A9.0 architecture report.
 */
matchmakingRouter.get('/players/:id/matchmaking', handle('matchmaking', (req) => {
  const player = Player.get(req.params.id);
  if (!player || player.archived_at) throw notFound(req.params.id);
  return { body: computeMatchmakingV2(db, player) };
}));

/**
 * Compute and PERSIST, as an immutable run.
 *
 * The write is an explicit act, which is why it is a POST and why the GET
 * above stayed read-only: an operator asking to see the current answer must
 * never silently create a historical record, or the history becomes a log of
 * page views.
 *
 * NO DEDUPLICATION, and that is a decision rather than an omission. A POST is
 * somebody asking for a recomputation; recording that they asked, and what
 * came back, is the point of an immutable run. Collapsing two identical runs
 * would lose the fact that the second was requested - and "identical" is not
 * free to establish, since it means comparing 1,205 programme rows. The
 * cheaper and truer answer is `staleness` on the GET below: it tells a caller
 * whether anything has moved, so a UI can decline to ask rather than ask and
 * be deduplicated.
 */
matchmakingRouter.post('/players/:id/matchmaking', handle('matchmaking:persist', (req) => {
  const player = Player.get(req.params.id);
  if (!player || player.archived_at) throw notFound(req.params.id);
  /**
   * A11. Explanations are captured WITH the run. The GET above still does not
   * ask for them: previewing a ranking should not pay for prose nobody stores.
   */
  const result = computeMatchmakingV2(db, player, { withExplanations: true });
  const runId = persistRun(db, player, result);
  return { status: 201, body: { runId, ...result } };
}));

/**
 * The persisted current run, with whether it still describes today.
 *
 * `staleness` is reported, never acted on. Nothing here recomputes: a stale
 * run is still the truth about what Thriv3 said at the time, and deciding to
 * refresh is an operator's call in A9.3, not a side effect of reading.
 */
matchmakingRouter.get('/players/:id/matchmaking/runs/current', handle('matchmaking:current', (req) => {
  const player = Player.get(req.params.id);
  if (!player || player.archived_at) throw notFound(req.params.id);
  const row = currentRun(db, player.id);
  if (!row) return { status: 404, body: { error: 'No matchmaking run has been persisted for this athlete.', code: 'RUN_NOT_FOUND' } };
  return { body: { ...readRun(db, row), staleness: runStaleness(db, player, row) } };
}));

/** One run by id. Immutable, so it needs no freshness qualification. */
matchmakingRouter.get('/matchmaking/runs/:runId', handle('matchmaking:run', (req) => {
  const row = runById(db, req.params.runId);
  if (!row) {
    const err = new Error(`Unknown run: ${req.params.runId}`);
    err.code = 'RUN_NOT_FOUND';
    throw err;
  }
  return { body: readRun(db, row) };
}));


/**
 * SPECIFIC SEARCH — where one programme sits in this athlete's universe.
 *
 * A thin read over the persisted run and nothing more. It computes no score,
 * ranks no programme and never falls back to a live evaluation: if there is no
 * run, it answers RUN_NOT_FOUND and the UI offers to generate one, because a
 * rank is a position in a population and a single-programme score would be a
 * number with no denominator.
 *
 * `programme: null` inside a 200 is a real answer - the registry holds this
 * school but this athlete's pool does not - and is deliberately not a 404,
 * which would be indistinguishable from "no run" to a caller.
 */
matchmakingRouter.get('/players/:id/matchmaking/programme', handle('matchmaking:programme', (req) => {
  const player = Player.get(req.params.id);
  if (!player || player.archived_at) throw notFound(req.params.id);
  return {
    body: lookupProgramme(db, player, {
      collegeName: req.query.name,
      sport: req.query.sport || null,
      runId: req.query.runId || null,
    }),
  };
}));

/**
 * PROGRAMME CONTEXT FOR A BOUNDED SET OF PROGRAMMES — A11 §5, §6, §11.
 *
 * ===========================================================================
 * ONE REQUEST FOR A PAGE OF CARDS, NOT ONE PER CARD.
 *
 * The run holds scores; `colleges` and `roster_players` hold the cost, the
 * ratings and the roster. A card that wants both would otherwise make a
 * request per programme, and a hundred cards would make a hundred — the N+1
 * this endpoint exists to prevent.
 *
 * A READ, AND ONLY A READ. It creates no relationship row, records no
 * selection, writes no observation and computes no score. Expanding a card
 * must never be a write; see the no-side-effect tests.
 *
 * BOUNDED BY CONSTRUCTION. At most TOP_N names are honoured, because the
 * largest honest caller is one page of the Top 100. A longer list is a caller
 * bug, and truncating it quietly would hide that, so it is refused.
 * ===========================================================================
 */
matchmakingRouter.get('/players/:id/matchmaking/context', handle('matchmaking:context', (req) => {
  const player = Player.get(req.params.id);
  if (!player || player.archived_at) throw notFound(req.params.id);

  const raw = String(req.query.names ?? '').split('\u001F').map((n) => n.trim()).filter(Boolean);
  const names = [...new Set(raw)];
  if (names.length === 0) return { body: { programmes: [] } };
  if (names.length > TOP_N) {
    const err = new Error(`At most ${TOP_N} programmes may be asked for at once; received ${names.length}.`);
    err.code = 'TOO_MANY_PROGRAMMES';
    err.status = 400;
    throw err;
  }

  return {
    body: programmeContext(db, {
      sport: req.query.sport || player.sport,
      names,
      position: player.position ?? null,
      /** The athlete's own entry class — see programmeContext's own note. */
      entryYear: player.recruiting_class_year,
      withNames: req.query.players === '1',
    }),
  };
}));

/** The Top 100 of a run, as selection candidates. Ranked only, by construction. */
matchmakingRouter.get('/players/:id/matchmaking/top', handle('matchmaking:top', (req) => {
  const player = Player.get(req.params.id);
  if (!player || player.archived_at) throw notFound(req.params.id);
  const { row, staleness } = resolveRun(db, player, { runId: req.query.runId || null });
  return {
    body: {
      runId: row.id, computedAt: row.computed_at, staleness,
      programmes: topSelectionCandidates(db, row),
    },
  };
}));

/**
 * Record that a programme was chosen for outreach out of a specific run.
 *
 * WRITES PROVENANCE ONLY. It creates no campaign, drafts no message and sends
 * nothing - A9.5 §L is explicit that outreach is never launched automatically,
 * and this endpoint is the record of a decision rather than the decision's
 * execution.
 */
matchmakingRouter.post('/players/:id/matchmaking/selections', handle('matchmaking:select', (req) => {
  const player = Player.get(req.params.id);
  if (!player || player.archived_at) throw notFound(req.params.id);
  const { collegeName, sport, runId, source } = req.body ?? {};
  return {
    status: 201,
    body: recordSelection(db, player, { collegeName, sport, runId, source }),
  };
}));

/** This athlete's selection history. Append-only, so this is the whole of it. */
matchmakingRouter.get('/players/:id/matchmaking/selections', handle('matchmaking:selections', (req) => {
  const player = Player.get(req.params.id);
  if (!player || player.archived_at) throw notFound(req.params.id);
  return { body: { selections: selectionsFor(db, player.id) } };
}));
