import express from 'express';
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import { computeMatchmakingV2 } from '../lib/v2/matchmakingService.js';

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

  CONTRIBUTION_UNRESOLVED: 409,

  // Well-formed, and asking for something not allowed to be true.
  ATHLETE_SPORT_UNKNOWN: 422,
  ATHLETE_PROFILE_INCOMPLETE: 422,
  ATHLETE_PROFILE_INVALID: 422,
  CONTRIBUTION_INVALID: 422,
  EMPTY_PROGRAMME_UNIVERSE: 422,
  PLAYER_REQUIRED: 400,
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
